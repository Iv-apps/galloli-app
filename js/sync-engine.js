// Motor de Sincronización P2P en Tiempo Real - GallOli Cloud Sync
// Arquitectura: WebSocket para tiempo real + API REST para persistencia

const SYNC_CONFIG = {
    API_URL: 'https://galloli-sync.ivanbj-96.workers.dev',
    WS_URL: 'wss://galloli-sync.ivanbj-96.workers.dev/ws',
    SYNC_INTERVAL: 30000, // 30 segundos (fallback)
    RETRY_DELAY: 3000,
    WS_RECONNECT_TIMEOUT: 5000 // Reconectar cada 5 segundos
};

class SyncEngine {
    constructor() {
        this.ws = null;
        this.isOnline = navigator.onLine;
        this.isSyncing = false;
        this.syncInterval = null;
        this.reconnectTimeout = null;
        this.wsReconnectAttempts = 0;
        this.wsMaxReconnectAttempts = 10;
        this.SYNC_CONFIG = SYNC_CONFIG;
    }

    async init() {
        console.log('🔄 Inicializando sincronización P2P...');
        console.log('📊 Estado de autenticación:', {
            hasAuthManager: !!window.AuthManager,
            isAuthenticated: window.AuthManager?.isAuthenticated(),
            user: window.AuthManager?.user,
            business: window.AuthManager?.business
        });
        
        if (!window.AuthManager?.isAuthenticated()) {
            console.log('⚠️ No autenticado - sincronización no iniciada');
            return;
        }

        console.log('✅ Usuario autenticado - iniciando sincronización...');

        // 1. Inicializar cola offline
        if (window.OfflineQueueManager) {
            await window.OfflineQueueManager.init();
        }

        // 2. Conectar WebSocket
        this.connectWebSocket();

        // 3. Sincronización inicial inteligente con merge
        await this.smartSync();

        // 4. Esperar a que los módulos estén listos antes de interceptar
        setTimeout(() => {
            this.interceptChanges();
        }, 2000);

        // 5. Detectar online/offline
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());

        console.log('✅ Sincronización P2P activa');
        
        // Sincronizar eliminaciones pendientes de ventas
        if (typeof SalesModule !== 'undefined' && typeof SalesModule.syncPendingDeletions === 'function') {
            try {
                await SalesModule.syncPendingDeletions();
            } catch (error) {
                console.warn('⚠️ Error sincronizando eliminaciones pendientes:', error);
            }
        }
    }

    connectWebSocket() {
        if (!window.AuthManager?.isAuthenticated()) return;

        const user = window.AuthManager.user;
        const business = window.AuthManager.business;
        
        // Generar ID único por dispositivo/sesión
        let deviceId = localStorage.getItem('device_id');
        if (!deviceId) {
            deviceId = `${user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem('device_id', deviceId);
        }
        
        const wsUrl = `${SYNC_CONFIG.WS_URL}?business_id=${business.id}&user_id=${deviceId}&user_name=${encodeURIComponent(user.name)}`;
        
        console.log(`🔌 Conectando WebSocket... (intento ${this.wsReconnectAttempts + 1})`);
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('✅ WebSocket conectado');
                this.wsReconnectAttempts = 0; // Reset reintentos al conectarse
                
                // Si hay cambios en la cola, procesarlos
                if (window.OfflineQueueManager?.queue?.length > 0) {
                    console.log('📤 Conectado - procesando cambios pendientes...');
                    window.OfflineQueueManager.processBatch();
                }
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleWebSocketMessage(message);
                } catch (error) {
                    console.error('Error procesando mensaje:', error);
                }
            };
            
            this.ws.onerror = (error) => {
                console.error('❌ Error WebSocket:', error);
            };
            
            this.ws.onclose = () => {
                console.log('🔌 WebSocket desconectado - reintentando...');
                this.ws = null;
                
                // Reconectar con backoff exponencial (máximo 30 segundos)
                if (this.wsReconnectAttempts < this.wsMaxReconnectAttempts) {
                    const delayMs = Math.min(1000 * Math.pow(2, this.wsReconnectAttempts), 30000);
                    this.wsReconnectAttempts++;
                    
                    console.log(`⏳ Reconectando en ${delayMs}ms...`);
                    
                    this.reconnectTimeout = setTimeout(() => {
                        if (navigator.onLine) {
                            this.connectWebSocket();
                        }
                    }, delayMs);
                } else {
                    console.warn('⚠️ Max reintentos de WebSocket alcanzado - usa poll fallback');
                }
            };
        } catch (error) {
            console.error('Error creando WebSocket:', error);
        }
    }

    async handleWebSocketMessage(message) {
        console.log('📨 Mensaje recibido:', message.type);
        
        switch (message.type) {
            case 'connected':
                console.log('✅ Conectado al servidor');
                break;
                
            case 'change':
                // Otro usuario hizo un cambio
                const dataType = message.data?.data_type;
                const dataId = message.data?.data_id;
                const action = message.data?.action;
                
                if (dataType) {
                    console.log('🔔 Cambio remoto detectado:', dataType, action || 'update');
                    
                    // CASO ESPECIAL: Eliminación remota
                    if (action === 'delete' && dataId) {
                        console.log(`🗑️ Procesando eliminación remota: ${dataType}/${dataId}`);
                        await this.handleRemoteDeletion(dataType, dataId);
                    } else {
                        // Sincronizar normalmente
                        this.syncDataType(dataType);
                    }
                }
                break;
                
            case 'presence':
                console.log(`👥 ${message.users?.length || 0} usuarios online`);
                break;
        }
    }

    async handleRemoteDeletion(dataType, dataId) {
        try {
            console.log(`🗑️ Eliminando localmente: ${dataType}/${dataId}`);
            
            // Eliminar de IndexedDB
            await this.deleteLocal(dataType, dataId);
            
            // Eliminar del array en memoria del módulo correspondiente
            switch(dataType) {
                case 'sales':
                    if (window.SalesModule && window.SalesModule.sales) {
                        const index = window.SalesModule.sales.findIndex(s => s.id == dataId);
                        if (index !== -1) {
                            const deletedSale = window.SalesModule.sales[index];
                            window.SalesModule.sales.splice(index, 1);
                            
                            // Actualizar estadísticas del cliente
                            if (window.ClientsModule) {
                                const client = window.ClientsModule.getClientById(deletedSale.clientId);
                                if (client) {
                                    client.totalSales -= 1;
                                    client.totalAmount -= deletedSale.total;
                                    client.totalWeight -= deletedSale.weight;
                                    client.totalQuantity -= deletedSale.quantity;
                                    await window.ClientsModule.saveClients();
                                }
                            }
                            
                            console.log(`✅ Venta ${dataId} eliminada localmente`);
                        }
                    }
                    break;
                    
                case 'clients':
                    if (window.ClientsModule && window.ClientsModule.clients) {
                        const index = window.ClientsModule.clients.findIndex(c => c.id == dataId);
                        if (index !== -1) {
                            window.ClientsModule.clients.splice(index, 1);
                            console.log(`✅ Cliente ${dataId} eliminado localmente`);
                        }
                    }
                    break;

                case 'orders':
                    if (window.OrdersModule && window.OrdersModule.orders) {
                        const index = window.OrdersModule.orders.findIndex(o => o.id == dataId);
                        if (index !== -1) {
                            window.OrdersModule.orders.splice(index, 1);
                            console.log(`✅ Pedido ${dataId} eliminado localmente`);
                        }
                    }
                    break;

                case 'expenses':
                    if (window.AccountingModule && window.AccountingModule.expenses) {
                        const index = window.AccountingModule.expenses.findIndex(e => e.id == dataId);
                        if (index !== -1) {
                            window.AccountingModule.expenses.splice(index, 1);
                            console.log(`✅ Gasto ${dataId} eliminado localmente`);
                        }
                    }
                    break;
            }
            
            // Actualizar la interfaz
            await this.reloadUI(dataType);
            
        } catch (error) {
            console.error(`❌ Error procesando eliminación remota ${dataType}/${dataId}:`, error);
        }
    }

    async forceFullSync() {
        console.log('🔄 Iniciando sincronización completa forzada...');
        try {
            await this.smartSync();
            console.log('✅ Sincronización completa forzada exitosa');
        } catch (error) {
            console.error('❌ Error en sincronización completa forzada:', error);
        }
    }

    async syncDataType(dataType) {
        console.log('🔄 Sincronizando:', dataType);
        
        try {
            // Obtener datos remotos de ese tipo
            const response = await fetch(`${SYNC_CONFIG.API_URL}/api/sync/full?data_type=${dataType}`, {
                headers: window.AuthManager.getAuthHeaders()
            });
            
            if (!response.ok) return;
            
            const result = await response.json();
            const remoteItems = (result.data || []).map(item => item.data);
            
            // Obtener datos locales
            const storeName = this.getStoreName(dataType);
            const localItems = await DB.getAll(storeName) || [];
            
            // Hacer merge
            const itemsMap = new Map();
            
            // Agregar items remotos
            remoteItems.forEach(item => {
                const id = this.getItemId(item, dataType);
                itemsMap.set(id, item);
            });
            
            // Agregar/sobrescribir con items locales si son más recientes
            localItems.forEach(item => {
                const id = this.getItemId(item, dataType);
                const existing = itemsMap.get(id);
                
                if (!existing) {
                    itemsMap.set(id, item);
                } else {
                    const localTime = this.getItemTimestamp(item);
                    const remoteTime = this.getItemTimestamp(existing);
                    
                    if (localTime > remoteTime) {
                        itemsMap.set(id, item);
                    }
                }
            });
            
            // Guardar items merged
            const mergedItems = Array.from(itemsMap.values());
            
            // Limpiar y guardar
            for (const item of localItems) {
                const id = this.getItemId(item, dataType);
                await DB.delete(storeName, id);
            }
            
            for (const item of mergedItems) {
                await DB.set(storeName, item);
            }
            
            // Recargar UI
            await this.reloadUI(dataType);
            
            console.log(`✅ ${mergedItems.length} items sincronizados (${dataType})`);
            
        } catch (error) {
            console.error('Error sincronizando:', error);
        }
    }
    
    getStoreName(dataType) {
        const storeMap = {
            'clients': 'clients',
            'sales': 'sales',
            'orders': 'orders',
            'expenses': 'expenses',
            'prices': 'prices',
            'mermaRecords': 'mermaRecords',
            'diezmos': 'diezmos',
            'paymentHistory': 'paymentHistory',
            'config': 'config'
        };
        return storeMap[dataType] || dataType;
    }

    async saveLocal(dataType, data) {
        const storeMap = {
            'clients': 'clients',
            'sales': 'sales',
            'orders': 'orders',
            'expenses': 'expenses',
            'prices': 'prices',
            'mermaRecords': 'mermaRecords',
            'diezmos': 'diezmos',
            'paymentHistory': 'paymentHistory',
            'config': 'config'
        };
        
        const store = storeMap[dataType];
        if (store) {
            await DB.set(store, data);
        }
    }

    async deleteLocal(dataType, id) {
        const storeMap = {
            'clients': 'clients',
            'sales': 'sales',
            'orders': 'orders',
            'expenses': 'expenses',
            'prices': 'prices',
            'mermaRecords': 'mermaRecords',
            'diezmos': 'diezmos',
            'paymentHistory': 'paymentHistory',
            'config': 'config'
        };
        
        const store = storeMap[dataType];
        if (store) {
            await DB.delete(store, id);
        }
    }

    async reloadUI(dataType) {
        console.log('🔄 Recargando UI:', dataType);
        
        // Recargar módulo específico
        switch(dataType) {
            case 'clients':
                if (window.ClientsModule) {
                    await ClientsModule.loadClients();
                    ClientsModule.updateClientList();
                    ClientsModule.updateClientSelect();
                }
                break;
                
            case 'sales':
                if (window.SalesModule) {
                    await SalesModule.loadSales();
                    // CRITICO: Actualizar la lista visual de ventas
                    SalesModule.updateSalesList();
                }
                break;
                
            case 'orders':
                if (window.OrdersModule) {
                    await OrdersModule.loadOrders();
                }
                break;
                
            case 'expenses':
                if (window.AccountingModule) {
                    await AccountingModule.loadExpenses();
                }
                break;
                
            case 'prices':
            case 'mermaRecords':
                if (window.MermaModule) {
                    await MermaModule.loadDailyPrices();
                    await MermaModule.loadMermaRecords();
                }
                break;
                
            case 'diezmos':
                if (window.DiezmosModule) {
                    await DiezmosModule.loadRecords();
                }
                break;
                
            case 'config':
                if (window.ConfigModule) {
                    await ConfigModule.loadConfig();
                    ConfigModule.applyConfig();
                }
                break;
        }
        
        // SIEMPRE recargar la página actual para reflejar cambios
        if (window.App?.currentPage) {
            console.log('🔄 Recargando página actual:', window.App.currentPage);
            window.App.loadPage(window.App.currentPage);
        }
    }

    async smartSync() {
        if (this.isSyncing) return;
        
        this.isSyncing = true;
        console.log('🔄 Sincronización inteligente iniciada...');
        
        try {
            // 1. Obtener datos locales
            const localData = await this.getLocalData();
            console.log('📦 Datos locales:', this.countItems(localData));
            
            // 2. Obtener datos remotos
            const remoteData = await this.getRemoteData();
            console.log('☁️ Datos remotos:', this.countItems(remoteData));
            
            // 3. Hacer merge inteligente
            const mergedData = await this.mergeData(localData, remoteData);
            console.log('🔀 Datos después del merge:', this.countItems(mergedData));
            
            // 4. Subir datos que faltan en el servidor
            await this.uploadMissingData(mergedData, remoteData);
            
            // 5. Aplicar datos localmente
            await this.applyMergedData(mergedData);
            
            // 6. Limpiar duplicados del servidor (solo si hubo duplicados)
            const totalDuplicates = Object.values(mergedData).reduce((sum, items) => {
                // Contar cuántos duplicados había en remoteData vs mergedData
                const remoteCount = (remoteData[Object.keys(mergedData).find(k => mergedData[k] === items)] || []).length;
                const mergedCount = items.length;
                return sum + (remoteCount - mergedCount);
            }, 0);
            
            if (totalDuplicates > 0) {
                console.log(`🧹 Limpiando ${totalDuplicates} duplicados del servidor...`);
                await this.cleanupServerDuplicates();
            }
            
            // 7. Recargar toda la UI
            await this.reloadAllModules();
            
            console.log('✅ Sincronización inteligente completada');
            
        } catch (error) {
            console.error('❌ Error en sincronización:', error);
        } finally {
            this.isSyncing = false;
        }
    }
    
    countItems(data) {
        const counts = {};
        for (const [type, items] of Object.entries(data)) {
            counts[type] = items.length;
        }
        return counts;
    }
    
    async mergeData(localData, remoteData) {
        console.log('🔀 Haciendo merge inteligente...');
        
        const merged = {};
        const dataTypes = ['clients', 'sales', 'orders', 'expenses', 'prices', 'mermaRecords', 'diezmos', 'paymentHistory', 'config', 'telegramCredentials'];
        
        for (const type of dataTypes) {
            const local = localData[type] || [];
            const remote = remoteData[type] || [];
            
            // Crear mapa por ID
            const itemsMap = new Map();
            
            // DIAGNÓSTICO: Contar IDs duplicados
            const remoteIds = new Map();
            remote.forEach(item => {
                const id = this.getItemId(item, type);
                if (!remoteIds.has(id)) {
                    remoteIds.set(id, []);
                }
                remoteIds.get(id).push(item);
            });
            
            const duplicates = Array.from(remoteIds.entries()).filter(([id, items]) => items.length > 1);
            if (duplicates.length > 0) {
                console.warn(`⚠️ ${type}: ${duplicates.length} IDs duplicados en servidor - limpiando...`);
                
                // Para cada ID duplicado, mantener solo el más reciente
                duplicates.forEach(([id, items]) => {
                    const newest = items.reduce((prev, current) => {
                        const prevTime = this.getItemTimestamp(prev);
                        const currentTime = this.getItemTimestamp(current);
                        return currentTime > prevTime ? current : prev;
                    });
                    
                    console.log(`  🧹 ID ${id}: ${items.length} duplicados → manteniendo el más reciente`);
                });
            }
            
            // Agregar items remotos (solo el más reciente si hay duplicados)
            remoteIds.forEach((items, id) => {
                if (items.length === 1) {
                    itemsMap.set(id, {
                        ...items[0],
                        _source: 'remote'
                    });
                } else {
                    // Mantener el más reciente
                    const newest = items.reduce((prev, current) => {
                        const prevTime = this.getItemTimestamp(prev);
                        const currentTime = this.getItemTimestamp(current);
                        return currentTime > prevTime ? current : prev;
                    });
                    
                    itemsMap.set(id, {
                        ...newest,
                        _source: 'remote_deduped'
                    });
                }
            });
            
            // Agregar/sobrescribir con items locales (comparando timestamps)
            local.forEach(item => {
                const id = this.getItemId(item, type);
                const existing = itemsMap.get(id);
                
                if (!existing) {
                    // Item solo existe localmente
                    itemsMap.set(id, {
                        ...item,
                        _source: 'local'
                    });
                } else {
                    // Item existe en ambos - comparar timestamps
                    const localTime = this.getItemTimestamp(item);
                    const remoteTime = this.getItemTimestamp(existing);
                    
                    if (localTime > remoteTime) {
                        // Local es más reciente
                        itemsMap.set(id, {
                            ...item,
                            _source: 'local_newer'
                        });
                    }
                    // Si remote es más reciente o igual, mantener el que ya está
                }
            });
            
            // Convertir mapa a array y FILTRAR VENTAS ELIMINADAS
            merged[type] = Array.from(itemsMap.values())
                .filter(item => {
                    // Si es una venta, filtrar las eliminadas
                    if (type === 'sales' && item.deleted) {
                        return false;
                    }
                    return true;
                })
                .map(item => {
                    const { _source, ...cleanItem } = item;
                    return cleanItem;
                });
            
            console.log(`  ${type}: ${local.length} local + ${remote.length} remote = ${merged[type].length} merged (${duplicates.length} duplicados limpiados)`);
        }
        
        return merged;
    }
    
    getItemId(item, type) {
        // Obtener ID único del item según su tipo
        if (item.id) return String(item.id);
        if (item.key) return String(item.key);
        if (item.date) return String(item.date);
        
        // Fallback: crear ID basado en contenido
        return `${type}_${JSON.stringify(item).substring(0, 50)}`;
    }
    
    getItemTimestamp(item) {
        // Obtener timestamp del item (priorizar lastModified para cambios)
        if (item.lastModified) {
            if (typeof item.lastModified === 'number') return item.lastModified;
            return new Date(item.lastModified).getTime();
        }
        if (item.timestamp) {
            if (typeof item.timestamp === 'number') return item.timestamp;
            return new Date(item.timestamp).getTime();
        }
        if (item.date) {
            return new Date(item.date).getTime();
        }
        if (item.created_at) {
            return new Date(item.created_at).getTime();
        }
        return 0;
    }
    
    async uploadMissingData(mergedData, remoteData) {
        console.log('📤 Subiendo datos que faltan en el servidor...');
        
        const changes = [];
        
        for (const [dataType, items] of Object.entries(mergedData)) {
            const remoteItems = remoteData[dataType] || [];
            const remoteIds = new Set(remoteItems.map(item => this.getItemId(item, dataType)));
            
            // Encontrar items que no están en el servidor
            const missingItems = items.filter(item => {
                const id = this.getItemId(item, dataType);
                return !remoteIds.has(id);
            });
            
            if (missingItems.length > 0) {
                console.log(`  ${dataType}: ${missingItems.length} items nuevos`);
                
                missingItems.forEach(item => {
                    const itemId = this.getItemId(item, dataType);
                    changes.push({
                        data_type: dataType,
                        data_id: itemId,
                        action: 'upsert',
                        data: item,
                        timestamp: this.getItemTimestamp(item) || Date.now()
                    });
                });
            }
        }
        
        if (changes.length === 0) {
            console.log('✅ Todos los datos ya están sincronizados');
            return;
        }
        
        console.log(`📤 Subiendo ${changes.length} cambios...`);
        
        // Subir en lotes de 50
        const batchSize = 50;
        for (let i = 0; i < changes.length; i += batchSize) {
            const batch = changes.slice(i, i + batchSize);
            
            try {
                await fetch(`${SYNC_CONFIG.API_URL}/api/sync/push`, {
                    method: 'POST',
                    headers: window.AuthManager.getAuthHeaders(),
                    body: JSON.stringify({ changes: batch })
                });
                
                console.log(`✅ Lote ${Math.floor(i / batchSize) + 1}/${Math.ceil(changes.length / batchSize)} subido`);
            } catch (error) {
                console.error('Error subiendo lote:', error);
            }
        }
    }
    
    async applyMergedData(mergedData) {
        console.log('💾 Aplicando datos localmente...');
        
        for (const [dataType, items] of Object.entries(mergedData)) {
            // Caso especial: credenciales de Telegram - SIEMPRE mantener las locales si existen
            if (dataType === 'telegramCredentials') {
                // Primero verificar si ya hay credenciales locales
                const existingCreds = await AutoBackup.getCredentials();
                
                if (existingCreds.botToken && existingCreds.chatId) {
                    // Ya hay credenciales locales - mantenerlas
                    console.log('  telegramCredentials: manteniendo credenciales locales existentes');
                } else if (items.length > 0) {
                    // No hay credenciales locales pero sí remotas - usar las remotas
                    const creds = items[0];
                    if (creds.botToken && creds.chatId && typeof AutoBackup !== 'undefined') {
                        await AutoBackup.saveCredentials(creds.botToken, creds.chatId);
                        console.log('  telegramCredentials: sincronizadas desde servidor');
                    }
                }
                continue;
            }
            
            const storeName = this.getStoreName(dataType);
            
            // Limpiar store actual
            const existingItems = await DB.getAll(storeName) || [];
            for (const item of existingItems) {
                const id = this.getItemId(item, dataType);
                await DB.delete(storeName, id);
            }
            
            // Guardar items merged
            for (const item of items) {
                await DB.set(storeName, item);
            }
            
            console.log(`  ${dataType}: ${items.length} items guardados`);
        }
    }

    async getLocalData() {
        console.log('📦 Obteniendo datos locales...');
        
        // Obtener credenciales de Telegram desde AutoBackup
        let telegramCredentials = null;
        if (typeof AutoBackup !== 'undefined') {
            try {
                const creds = await AutoBackup.getCredentials();
                if (creds.botToken && creds.chatId) {
                    telegramCredentials = creds;
                }
            } catch (error) {
                console.warn('No se pudieron obtener credenciales de Telegram:', error);
            }
        }
        
        return {
            clients: await DB.getAll('clients') || [],
            sales: await DB.getAll('sales') || [],
            orders: await DB.getAll('orders') || [],
            expenses: await DB.getAll('expenses') || [],
            prices: await DB.getAll('prices') || [],
            mermaRecords: await DB.getAll('mermaRecords') || [],
            diezmos: await DB.getAll('diezmos') || [],
            paymentHistory: await DB.getAll('paymentHistory') || [],
            config: await DB.getAll('config') || [],
            telegramCredentials: telegramCredentials ? [telegramCredentials] : []
        };
    }

    async getRemoteData() {
        console.log('☁️ Obteniendo datos remotos...');
        
        try {
            const response = await fetch(`${SYNC_CONFIG.API_URL}/api/sync/full`, {
                headers: window.AuthManager.getAuthHeaders()
            });
            
            if (!response.ok) throw new Error('Error obteniendo datos remotos');
            
            const result = await response.json();
            
            // Organizar por tipo
            const data = {
                clients: [],
                sales: [],
                orders: [],
                expenses: [],
                prices: [],
                mermaRecords: [],
                diezmos: [],
                paymentHistory: [],
                config: [],
                telegramCredentials: []
            };
            
            (result.data || []).forEach(item => {
                if (data[item.data_type]) {
                    data[item.data_type].push(item.data);
                }
            });
            
            return data;
        } catch (error) {
            console.error('Error obteniendo datos remotos:', error);
            return { 
                clients: [], 
                sales: [], 
                orders: [], 
                expenses: [], 
                prices: [], 
                mermaRecords: [], 
                diezmos: [], 
                paymentHistory: [], 
                config: [],
                telegramCredentials: []
            };
        }
    }

    async uploadData(localData) {
        console.log('📤 Subiendo datos locales...');
        
        const changes = [];
        
        for (const [dataType, items] of Object.entries(localData)) {
            items.forEach(item => {
                const itemId = item.id || item.key || item.date || `${dataType}_${Date.now()}`;
                changes.push({
                    data_type: dataType,
                    data_id: itemId,
                    action: 'upsert',
                    data: item,
                    timestamp: Date.now()
                });
            });
        }
        
        if (changes.length === 0) return;
        
        // Subir en lotes de 50
        const batchSize = 50;
        for (let i = 0; i < changes.length; i += batchSize) {
            const batch = changes.slice(i, i + batchSize);
            
            try {
                await fetch(`${SYNC_CONFIG.API_URL}/api/sync/push`, {
                    method: 'POST',
                    headers: window.AuthManager.getAuthHeaders(),
                    body: JSON.stringify({ changes: batch })
                });
                
                console.log(`✅ Lote ${Math.floor(i / batchSize) + 1} subido`);
            } catch (error) {
                console.error('Error subiendo lote:', error);
            }
        }
    }

    async downloadData(remoteData) {
        console.log('📥 Descargando datos remotos...');
        
        for (const [dataType, items] of Object.entries(remoteData)) {
            for (const item of items) {
                await this.saveLocal(dataType, item);
            }
        }
    }

    async cleanupServerDuplicates() {
        try {
            const response = await fetch(`${SYNC_CONFIG.API_URL}/api/sync/cleanup-duplicates`, {
                method: 'POST',
                headers: window.AuthManager.getAuthHeaders()
            });
            
            if (!response.ok) {
                console.warn('No se pudieron limpiar duplicados del servidor');
                return;
            }
            
            const result = await response.json();
            console.log(`✅ ${result.duplicates_deleted} duplicados eliminados del servidor`);
            
        } catch (error) {
            console.error('Error limpiando duplicados del servidor:', error);
        }
    }

    async reloadAllModules() {
        console.log('🔄 Recargando todos los módulos...');
        
        try {
            if (window.ClientsModule) {
                await ClientsModule.loadClients();
                ClientsModule.updateClientList();
                ClientsModule.updateClientSelect();
            }
            
            if (window.SalesModule) {
                await SalesModule.loadSales();
            }
            
            if (window.OrdersModule) {
                await OrdersModule.loadOrders();
            }
            
            if (window.AccountingModule) {
                await AccountingModule.loadExpenses();
            }
            
            if (window.MermaModule) {
                await MermaModule.loadDailyPrices();
                await MermaModule.loadMermaRecords();
            }
            
            if (window.DiezmosModule) {
                await DiezmosModule.loadConfig();
                await DiezmosModule.loadRecords();
            }
            
            if (window.ConfigModule) {
                await ConfigModule.loadConfig();
                ConfigModule.applyConfig();
            }
            
            // PaymentHistoryModule ya no necesita loadPayments - se construye dinámicamente
            
            // Recargar página actual
            if (window.App?.currentPage) {
                window.App.loadPage(window.App.currentPage);
            }
            
        } catch (error) {
            console.error('Error recargando módulos:', error);
        }
    }

    interceptChanges() {
        console.log('🎯 Interceptando cambios locales...');
        console.log('📊 Módulos disponibles:', {
            ClientsModule: !!window.ClientsModule?.saveClients,
            SalesModule: !!window.SalesModule?.saveSales,
            OrdersModule: !!window.OrdersModule?.saveOrders,
            AccountingModule: !!window.AccountingModule?.saveExpenses,
            MermaModule: !!window.MermaModule?.saveDailyPrices,
            DiezmosModule: !!window.DiezmosModule?.saveConfig,
            ConfigModule: !!window.ConfigModule?.saveConfig
        });
        
        let interceptorsInstalled = 0;
        
        // Clientes
        if (window.ClientsModule?.saveClients) {
            const original = ClientsModule.saveClients;
            ClientsModule.saveClients = async () => {
                await original.call(ClientsModule);
                console.log('📤 Cambio detectado: clients');
                this.notifyChange('clients');
            };
            interceptorsInstalled++;
        } else {
            console.warn('⚠️ ClientsModule.saveClients no disponible');
        }
        
        // Ventas
        if (window.SalesModule?.saveSales) {
            const original = SalesModule.saveSales;
            SalesModule.saveSales = async () => {
                await original.call(SalesModule);
                console.log('📤 Cambio detectado: sales');
                this.notifyChange('sales');
            };
            interceptorsInstalled++;
        } else {
            console.warn('⚠️ SalesModule.saveSales no disponible');
        }
        
        // Pedidos
        if (window.OrdersModule?.saveOrders) {
            const original = OrdersModule.saveOrders;
            OrdersModule.saveOrders = async () => {
                await original.call(OrdersModule);
                console.log('📤 Cambio detectado: orders');
                this.notifyChange('orders');
            };
            interceptorsInstalled++;
        } else {
            console.warn('⚠️ OrdersModule.saveOrders no disponible');
        }
        
        // Gastos
        if (window.AccountingModule?.saveExpenses) {
            const original = AccountingModule.saveExpenses;
            AccountingModule.saveExpenses = async () => {
                await original.call(AccountingModule);
                console.log('📤 Cambio detectado: expenses');
                this.notifyChange('expenses');
            };
            interceptorsInstalled++;
        } else {
            console.warn('⚠️ AccountingModule.saveExpenses no disponible');
        }
        
        // Precios
        if (window.MermaModule?.saveDailyPrices) {
            const original = MermaModule.saveDailyPrices;
            MermaModule.saveDailyPrices = async () => {
                await original.call(MermaModule);
                console.log('📤 Cambio detectado: prices');
                this.notifyChange('prices');
            };
            interceptorsInstalled++;
        } else {
            console.warn('⚠️ MermaModule.saveDailyPrices no disponible');
        }
        
        // Merma
        if (window.MermaModule?.saveMermaRecords) {
            const original = MermaModule.saveMermaRecords;
            MermaModule.saveMermaRecords = async () => {
                await original.call(MermaModule);
                console.log('📤 Cambio detectado: mermaRecords');
                this.notifyChange('mermaRecords');
            };
            interceptorsInstalled++;
        } else {
            console.warn('⚠️ MermaModule.saveMermaRecords no disponible');
        }
        
        // PaymentHistoryModule ya no tiene savePayments - los datos vienen de sale.paymentHistory
        // que se sincronizan automáticamente con SalesModule.saveSales
        
        // Diezmos - Configuración
        if (window.DiezmosModule?.saveConfig) {
            const original = DiezmosModule.saveConfig;
            DiezmosModule.saveConfig = async () => {
                await original.call(DiezmosModule);
                console.log('📤 Cambio detectado: config (diezmos)');
                this.notifyChange('config');
            };
            interceptorsInstalled++;
        } else {
            console.warn('⚠️ DiezmosModule.saveConfig no disponible');
        }
        
        // Diezmos - Registros
        if (window.DiezmosModule?.saveRecords) {
            const original = DiezmosModule.saveRecords;
            DiezmosModule.saveRecords = async () => {
                await original.call(DiezmosModule);
                console.log('📤 Cambio detectado: diezmos');
                this.notifyChange('diezmos');
            };
            interceptorsInstalled++;
        } else {
            console.warn('⚠️ DiezmosModule.saveRecords no disponible');
        }
        
        // Configuración de la app
        if (window.ConfigModule?.saveConfig) {
            const original = ConfigModule.saveConfig;
            ConfigModule.saveConfig = function() {
                original.call(ConfigModule);
                console.log('📤 Cambio detectado: config (app)');
                window.SyncEngine.notifyChange('config');
            };
            interceptorsInstalled++;
        } else {
            console.warn('⚠️ ConfigModule.saveConfig no disponible');
        }
        
        console.log(`✅ ${interceptorsInstalled} interceptores instalados`);
    }

    async notifyChange(dataType, dataId = null, action = 'update') {
        console.log(`📤 Cambio detectado: ${dataType}${dataId ? '/' + dataId : ''} (${action})`);
        
        // 1. Enviar notificación simple via WebSocket para tiempo real
        if (this.ws?.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({
                    type: 'change',
                    data: {
                        data_type: dataType,
                        data_id: dataId,
                        action: action,
                        timestamp: Date.now()
                    }
                }));
                console.log('✅ Notificación enviada via WebSocket:', dataType, action);
            } catch (error) {
                console.warn('⚠️ Error enviando notificación WebSocket:', error);
            }
        } else {
            console.warn('⚠️ WebSocket no conectado - usando cola offline');
        }
        
        // 2. Para updates, subir datos al backend (con fallback a cola offline)
        try {
            await this.uploadChanges(dataType, dataId, action);
        } catch (error) {
            console.error('❌ Error subiendo cambios:', error);
            
            // Si falla, agregar a la cola offline
            if (window.OfflineQueueManager && dataId) {
                const storeName = this.getStoreName(dataType);
                const item = await DB.get(storeName, dataId);
                if (item) {
                    await window.OfflineQueueManager.addChange(dataType, dataId, action, item);
                }
            }
        }
    }
    
    async uploadChanges(dataType, specificDataId = null, action = 'update') {
        try {
            // CASO ESPECIAL: Para eliminaciones, enviar directamente al servidor
            if (action === 'delete' && specificDataId) {
                console.log(`🗑️ Enviando eliminación al servidor: ${dataType}/${specificDataId}`);
                
                const response = await fetch(`${SYNC_CONFIG.API_URL}/api/sync/push`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...window.AuthManager.getAuthHeaders()
                    },
                    body: JSON.stringify({
                        changes: [{
                            data_type: dataType,
                            data_id: specificDataId,
                            action: 'delete',
                            data: null // No necesitamos datos para eliminación
                        }]
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`Error ${response.status}: ${response.statusText}`);
                }
                
                const result = await response.json();
                console.log('✅ Eliminación registrada en servidor:', result);
                return;
            }
            
            // CASO NORMAL: Para updates y creaciones
            const storeName = this.getStoreName(dataType);
            let localData = await DB.getAll(storeName) || [];
            
            // Si se especifica un ID específico, solo procesar ese
            if (specificDataId) {
                const item = await DB.get(storeName, specificDataId);
                localData = item ? [item] : [];
            }
            
            if (localData.length === 0) return;
            
            // Obtener datos remotos para comparar
            const response = await fetch(`${SYNC_CONFIG.API_URL}/api/sync/full?data_type=${dataType}`, {
                headers: window.AuthManager.getAuthHeaders()
            });
            
            if (!response.ok) {
                console.warn('No se pudo obtener datos remotos, subiendo todo');
                await this.uploadAllData(dataType, localData);
                return;
            }
            
            const result = await response.json();
            const remoteItems = (result.data || []).map(item => item.data);
            const remoteIds = new Set(remoteItems.map(item => this.getItemId(item, dataType)));
            
            // Encontrar items que no están en el servidor o son más recientes
            const itemsToUpload = localData.filter(item => {
                const id = this.getItemId(item, dataType);
                
                if (!remoteIds.has(id)) {
                    return true; // Item nuevo
                }
                
                // Comparar timestamps
                const remoteItem = remoteItems.find(r => this.getItemId(r, dataType) === id);
                if (remoteItem) {
                    const localTime = this.getItemTimestamp(item);
                    const remoteTime = this.getItemTimestamp(remoteItem);
                    return localTime > remoteTime; // Local es más reciente
                }
                
                return false;
            });
            
            if (itemsToUpload.length === 0) {
                console.log(`✅ ${dataType} ya está sincronizado`);
                return;
            }
            
            console.log(`📤 Subiendo ${itemsToUpload.length} items de ${dataType}...`);
            await this.uploadAllData(dataType, itemsToUpload);
            
        } catch (error) {
            console.error('Error subiendo cambios:', error);
        }
    }
    
    async uploadAllData(dataType, items) {
        const changes = items.map(item => {
            const itemId = this.getItemId(item, dataType);
            return {
                data_type: dataType,
                data_id: itemId,
                action: 'upsert',
                data: item,
                timestamp: this.getItemTimestamp(item) || Date.now()
            };
        });
        
        // Subir en lotes de 50
        const batchSize = 50;
        for (let i = 0; i < changes.length; i += batchSize) {
            const batch = changes.slice(i, i + batchSize);
            
            await fetch(`${SYNC_CONFIG.API_URL}/api/sync/push`, {
                method: 'POST',
                headers: window.AuthManager.getAuthHeaders(),
                body: JSON.stringify({ changes: batch })
            });
        }
        
        console.log(`✅ ${changes.length} cambios subidos (${dataType})`);
    }

    startPeriodicSync() {
        // Sincronización periódica desactivada - solo WebSocket en tiempo real
        console.log('⏰ Sincronización periódica desactivada (solo WebSocket)');
    }

    handleOnline() {
        console.log('🌐 Conexión restaurada');
        this.isOnline = true;
        
        // Primero intentar WebSocket
        this.connectWebSocket();
        
        // Procesar cambios en la cola offline
        if (window.OfflineQueueManager) {
            console.log('📤 Procesando cambios pendientes...');
            window.OfflineQueueManager.processBatch();
        }
        
        // Hacer sincronización completa
        setTimeout(() => {
            this.smartSync();
        }, 1000);
    }

    handleOffline() {
        console.log('📴 Sin conexión');
        this.isOnline = false;
        
        // Detener procesamiento de cola
        if (window.OfflineQueueManager) {
            window.OfflineQueueManager.stopProcessing();
        }
    }
}

// Instancia global
window.SyncEngine = new SyncEngine();
