// Sistema robusto de Cola Offline - GallOli Cloud Sync
// Garantiza que los cambios NO se pierdan aunque el dispositivo se desconecte

const OFFLINE_QUEUE_CONFIG = {
    DB_STORE: 'syncQueue',
    RETRY_INTERVALS: [1000, 2000, 5000, 10000, 30000], // Backoff exponencial: 1s, 2s, 5s, 10s, 30s
    MAX_RETRIES: 5,
    BATCH_SIZE: 20, // Enviar máximo 20 cambios por batch
    CHECK_INTERVAL: 30000, // Revisar cola cada 30 segundos
};

class OfflineQueueManager {
    constructor() {
        this.isProcessing = false;
        this.queue = [];
        this.processInterval = null;
    }

    async init() {
        console.log('📋 Inicializando gestor de cola offline...');
        
        // Crear object store si no existe
        try {
            if (window.DB?.db) {
                const tx = window.DB.db.transaction([OFFLINE_QUEUE_CONFIG.DB_STORE], 'readwrite');
                if (!tx.objectStore) {
                    console.log('⚠️ Creando tienda syncQueue...');
                }
            }
        } catch (e) {
            console.log('ℹ️ syncQueue ya existe');
        }

        // Cargar cambios pendientes desde IndexedDB
        await this.loadQueueFromDB();
        
        // Comenzar a procesar cambios en la cola
        this.startProcessing();
        
        console.log(`✅ Cola offline lista (${this.queue.length} cambios pendientes)`);
    }

    async loadQueueFromDB() {
        try {
            const items = await window.DB?.getAll('syncQueue') || [];
            this.queue = items.map(item => ({
                ...item,
                retries: item.retries || 0,
                lastRetryTime: item.lastRetryTime || 0
            }));
            
            if (this.queue.length > 0) {
                console.log(`📋 Cargados ${this.queue.length} cambios pendientes de sincronizar`);
            }
        } catch (error) {
            console.error('❌ Error cargando cola:', error);
        }
    }

    /**
     * Agregar un cambio a la cola
     */
    async addChange(dataType, dataId, action, data, priority = 'normal') {
        const change = {
            id: `${dataId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            dataType,
            dataId,
            action,
            data,
            priority,
            createdAt: Date.now(),
            retries: 0,
            lastRetryTime: 0,
            lastError: null,
            status: 'pending' // pending, sending, success, failed
        };

        // Guardar en IndexedDB
        try {
            await window.DB?.set('syncQueue', change);
            this.queue.push(change);
            
            console.log(`📤 Cambio agregado a cola: ${dataType}/${dataId}`);
            
            // Si estamos online, intentar enviar inmediatamente
            if (navigator.onLine) {
                await this.processBatch();
            }
        } catch (error) {
            console.error('❌ Error agregando a cola:', error);
        }

        return change;
    }

    /**
     * Procesar la cola de cambios
     */
    startProcessing() {
        // Limpiar intervalo anterior si existe
        if (this.processInterval) {
            clearInterval(this.processInterval);
        }

        // Procesar cambios pendientes cada 30 segundos
        this.processInterval = setInterval(() => {
            if (navigator.onLine && !this.isProcessing) {
                this.processBatch();
            }
        }, OFFLINE_QUEUE_CONFIG.CHECK_INTERVAL);

        // Intentar procesar inmediatamente
        if (navigator.onLine) {
            this.processBatch();
        }
    }

    stopProcessing() {
        if (this.processInterval) {
            clearInterval(this.processInterval);
            this.processInterval = null;
        }
    }

    /**
     * Procesar un batch de cambios
     */
    async processBatch() {
        if (this.isProcessing || !navigator.onLine) {
            return;
        }

        if (this.queue.length === 0) {
            return;
        }

        this.isProcessing = true;

        try {
            // Ordenar por prioridad y fecha
            const sortedQueue = this.queue.sort((a, b) => {
                const priorityOrder = { 'high': 0, 'normal': 1, 'low': 2 };
                const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
                if (priorityDiff !== 0) return priorityDiff;
                return a.createdAt - b.createdAt;
            });

            // Dividir en batches
            const batches = [];
            for (let i = 0; i < sortedQueue.length; i += OFFLINE_QUEUE_CONFIG.BATCH_SIZE) {
                batches.push(sortedQueue.slice(i, i + OFFLINE_QUEUE_CONFIG.BATCH_SIZE));
            }

            console.log(`📨 Procesando ${this.queue.length} cambios en ${batches.length} batch(es)...`);

            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batch = batches[batchIndex];
                const changes = batch.map(change => ({
                    data_type: change.dataType,
                    data_id: change.dataId,
                    action: change.action,
                    data: change.data,
                    timestamp: change.createdAt
                }));

                try {
                    const response = await fetch(`${window.SyncEngine?.SYNC_CONFIG?.API_URL || 'https://galloli-sync.ivanbj-96.workers.dev'}/api/sync/push`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...window.AuthManager?.getAuthHeaders?.() || {}
                        },
                        body: JSON.stringify({ changes })
                    });

                    if (response.ok) {
                        const result = await response.json();
                        
                        // Marcar cambios como enviados
                        for (let i = 0; i < batch.length; i++) {
                            const changeResult = result.results?.[i];
                            if (changeResult?.success) {
                                batch[i].status = 'success';
                                
                                // Eliminar de IndexedDB
                                try {
                                    await window.DB?.delete('syncQueue', batch[i].id);
                                } catch (e) {
                                    console.warn('Error eliminando de cola:', e);
                                }
                                
                                // Eliminar de la cola en memoria
                                const queueIndex = this.queue.findIndex(c => c.id === batch[i].id);
                                if (queueIndex >= 0) {
                                    this.queue.splice(queueIndex, 1);
                                }
                            } else {
                                batch[i].status = 'failed';
                                batch[i].lastError = changeResult?.error || 'Unknown error';
                                batch[i].retries++;
                            }
                        }
                        
                        console.log(`✅ Batch ${batchIndex + 1}/${batches.length} procesado`);
                    } else if (response.status === 401 || response.status === 403) {
                        // Sesion invalida o rol insuficiente: reintentar no sirve (dead-letter)
                        const errPermanente = new Error(`HTTP ${response.status}`);
                        errPermanente.permanent = true;
                        throw errPermanente;
                    } else {
                        throw new Error(`HTTP ${response.status}`);
                    }
                } catch (error) {
                    console.error(`❌ Error procesando batch ${batchIndex + 1}:`, error);

                    const esPermanente = !!error.permanent;

                    // Incrementar reintentos (o descartar definitivamente si es 401/403)
                    batch.forEach(change => {
                        change.retries++;
                        change.lastError = error.message;
                        if (esPermanente) {
                            change.status = 'dead-letter';
                            console.error(`⛔ Cambio ${change.id} descartado sin reintentos: ${error.message}`);
                        } else if (change.retries >= OFFLINE_QUEUE_CONFIG.MAX_RETRIES) {
                            change.status = 'failed';
                            console.error(`⚠️ Cambio ${change.id} falló después de ${OFFLINE_QUEUE_CONFIG.MAX_RETRIES} reintentos`);
                        }
                    });

                    if (esPermanente && typeof Utils !== 'undefined' && Utils.showNotification) {
                        Utils.showNotification('Un cambio no se pudo sincronizar por falta de permisos. Pide acceso a un administrador.', 'error', 6000);
                    }

                    // Guardar cambios fallidos en DB
                    for (const change of batch) {
                        try {
                            await window.DB?.set('syncQueue', change);
                        } catch (e) {
                            console.warn('Error guardando cambio en cola:', e);
                        }
                    }
                }

                // Esperar un poco entre batches para no sobrecargar
                await new Promise(resolve => setTimeout(resolve, 500));
            }

        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Obtener estado de la cola
     */
    getQueueStatus() {
        return {
            total: this.queue.length,
            pending: this.queue.filter(c => c.status === 'pending').length,
            sending: this.queue.filter(c => c.status === 'sending').length,
            failed: this.queue.filter(c => c.status === 'failed' && c.retries >= OFFLINE_QUEUE_CONFIG.MAX_RETRIES).length,
            isProcessing: this.isProcessing,
            queue: this.queue
        };
    }

    /**
     * Limpiar cola (marcar todos como procesados)
     */
    async clearQueue() {
        console.log('🗑️ Limpiando cola de sincronización...');
        try {
            for (const change of this.queue) {
                await window.DB?.delete('syncQueue', change.id);
            }
            this.queue = [];
            console.log('✅ Cola limpiada');
        } catch (error) {
            console.error('❌ Error limpiando cola:', error);
        }
    }

    /**
     * Reintentar cambios fallidos
     */
    async retryFailed() {
        const failed = this.queue.filter(c => c.status === 'failed' && c.retries < OFFLINE_QUEUE_CONFIG.MAX_RETRIES);
        if (failed.length > 0) {
            console.log(`🔄 Reintentando ${failed.length} cambios fallidos...`);
            failed.forEach(c => c.status = 'pending');
            await this.processBatch();
        }
    }
}

// Crear instancia global
window.OfflineQueueManager = new OfflineQueueManager();
