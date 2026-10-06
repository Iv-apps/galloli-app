// Sistema de Backup Automático Diario - USA EL MISMO MÉTODO QUE EL BACKUP MANUAL
const AutoBackup = {
    checkInterval: null,
    lastDataHash: null,
    
    // Inicializar el sistema
    async init() {
        console.log('💾 Inicializando sistema de backup automático...');
        
        // Cargar el hash de los últimos datos desde IndexedDB
        this.lastDataHash = await this.getFromDB('lastBackupDataHash');
        
        // Verificar cada hora si es hora de hacer backup
        this.checkInterval = setInterval(() => {
            this.checkBackupTime();
        }, 60 * 60 * 1000); // Cada hora
        
        // Verificar inmediatamente al iniciar
        setTimeout(() => this.checkBackupTime(), 5000);
        
        console.log('✅ Sistema de backup automático inicializado');
    },
    
    // Guardar en IndexedDB (más seguro y persistente)
    async saveToDB(key, value) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('GallOliSecure', 1);
            
            request.onerror = () => reject(request.error);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('credentials')) {
                    db.createObjectStore('credentials');
                }
            };
            
            request.onsuccess = (event) => {
                const db = event.target.result;
                const transaction = db.transaction(['credentials'], 'readwrite');
                const store = transaction.objectStore('credentials');
                const putRequest = store.put(value, key);
                
                putRequest.onsuccess = () => resolve();
                putRequest.onerror = () => reject(putRequest.error);
            };
        });
    },
    
    // Obtener de IndexedDB
    async getFromDB(key) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('GallOliSecure', 1);
            
            request.onerror = () => reject(request.error);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('credentials')) {
                    db.createObjectStore('credentials');
                }
            };
            
            request.onsuccess = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('credentials')) {
                    resolve(null);
                    return;
                }
                const transaction = db.transaction(['credentials'], 'readonly');
                const store = transaction.objectStore('credentials');
                const getRequest = store.get(key);
                
                getRequest.onsuccess = () => resolve(getRequest.result || null);
                getRequest.onerror = () => reject(getRequest.error);
            };
        });
    },
    
    // Verificar si es hora de hacer backup (10 PM)
    async checkBackupTime() {
        const now = new Date();
        const hour = now.getHours();

        // Solo a las 10 PM (22:00)
        if (hour !== 22) return;

        // Verificar si ya se hizo backup hoy
        const lastBackup = await this.getFromDB('lastAutoBackupDate');
        const today = new Date().toISOString().split('T')[0];

        if (lastBackup === today) {
            console.log('✅ Ya se hizo backup hoy');
            return;
        }

        // Si el usuario tiene sesion activa en la nube, el Worker cron ya hace el backup.
        // El cliente NUNCA debe duplicar el backup cuando hay cuenta activa.
        const isAuthenticated = typeof window.AuthManager !== 'undefined' &&
                                window.AuthManager.isAuthenticated &&
                                window.AuthManager.isAuthenticated();
        if (isAuthenticated) {
            console.log('ℹ️ Usuario autenticado — el backup lo hace el Worker cron, no el cliente');
            // Marcar como hecho para no reintentar en esta sesion
            await this.saveToDB('lastAutoBackupDate', today);
            return;
        }

        console.log('⚠️ Sin cuenta en la nube — haciendo backup local como fallback');
        await this.createAutomaticBackup();
    },
    
    // Determinar si este dispositivo es el líder para hacer backups
    async isBackupLeader() {
        try {
            // Obtener el device_id de este dispositivo
            const myDeviceId = localStorage.getItem('device_id');
            
            if (!myDeviceId) {
                console.warn('⚠️ No hay device_id - No se puede determinar líder');
                return false;
            }
            
            // Obtener la lista de dispositivos activos desde el servidor
            if (typeof CloudSync === 'undefined' || !CloudSync.isActive) {
                // Si no hay sincronización activa, este dispositivo es el líder por defecto
                console.log('ℹ️ Sin sincronización - Este dispositivo es líder por defecto');
                return true;
            }
            
            // Guardar que este dispositivo está activo
            await this.saveToDB('lastActiveTime', Date.now());
            
            // Por simplicidad: el dispositivo con el device_id más pequeño (más antiguo) es el líder
            // En una implementación más robusta, se consultaría al servidor
            const storedLeader = await this.getFromDB('backupLeader');
            
            if (!storedLeader) {
                // Primera vez - este dispositivo se convierte en líder
                await this.saveToDB('backupLeader', myDeviceId);
                return true;
            }
            
            return storedLeader === myDeviceId;
            
        } catch (error) {
            console.error('Error determinando líder:', error);
            // En caso de error, permitir que este dispositivo sea líder
            return true;
        }
    },
    
    // Detectar si hubo cambios en los datos
    async detectDataChanges() {
        try {
            // Obtener todos los datos actuales
            const currentData = {
                clients: ClientsModule.clients || [],
                sales: SalesModule.sales || [],
                orders: OrdersModule.orders || [],
                accounting: AccountingModule.expenses || [],
                merma: MermaModule.records || [],
                diezmos: DiezmosModule.records || []
            };
            
            // Calcular hash de los datos actuales
            const currentHash = this.calculateHash(JSON.stringify(currentData));
            
            // Comparar con el hash anterior
            if (this.lastDataHash === null) {
                // Primera vez - guardar hash
                this.lastDataHash = currentHash;
                await this.saveToDB('lastBackupDataHash', currentHash);
                return true; // Hay "cambios" porque es la primera vez
            }
            
            if (currentHash !== this.lastDataHash) {
                // Hay cambios
                this.lastDataHash = currentHash;
                await this.saveToDB('lastBackupDataHash', currentHash);
                return true;
            }
            
            // No hay cambios
            return false;
            
        } catch (error) {
            console.error('❌ Error detectando cambios:', error);
            return false;
        }
    },
    
    // Calcular hash simple de una cadena
    calculateHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString();
    },
    
    // Crear backup automático - USA EXACTAMENTE EL MISMO MÉTODO QUE EL BACKUP MANUAL
    async createAutomaticBackup() {
        try {
            console.log('📦 Creando backup automático usando el método manual...');
            
            // Verificar que BackupModule tenga credenciales
            if (!BackupModule.telegramBotToken || !BackupModule.telegramChatId) {
                // Intentar cargar desde IndexedDB
                const credentials = await this.getCredentials();
                if (credentials.botToken && credentials.chatId) {
                    BackupModule.telegramBotToken = credentials.botToken;
                    BackupModule.telegramChatId = credentials.chatId;
                } else {
                    console.warn('⚠️ No hay credenciales de Telegram guardadas');
                    return false;
                }
            }
            
            // USAR EXACTAMENTE EL MISMO MÉTODO QUE EL BACKUP MANUAL
            // 1. Crear backup con BackupModule.createBackup()
            const backup = await BackupModule.createBackup();
            
            // 2. Enviar con BackupModule.sendToTelegram()
            const result = await BackupModule.sendToTelegram(backup);
            
            if (result.ok) {
                console.log('✅ Backup automático enviado correctamente');
                
                // Guardar fecha del último backup
                const today = new Date().toISOString().split('T')[0];
                await this.saveToDB('lastAutoBackupDate', today);
                
                return true;
            }
            
            return false;
            
        } catch (error) {
            console.error('❌ Error creando backup automático:', error);
            
            // Notificar error
            if (typeof PushNotifications !== 'undefined') {
                await PushNotifications.notifyBackupError(error.message);
            }
            
            return false;
        }
    },
    
    // Guardar credenciales de Telegram permanentemente en IndexedDB (más seguro)
    async saveCredentials(botToken, chatId) {
        // Encriptar las credenciales antes de guardar
        const encrypted = {
            botToken: this.encrypt(botToken),
            chatId: this.encrypt(chatId)
        };
        
        await this.saveToDB('telegramCredentials', encrypted);
        console.log('✅ Credenciales de Telegram guardadas de forma segura en IndexedDB');
    },
    
    // Obtener credenciales guardadas
    async getCredentials() {
        try {
            const encrypted = await this.getFromDB('telegramCredentials');
            
            if (!encrypted) {
                return { botToken: '', chatId: '' };
            }
            
            // Desencriptar las credenciales
            return {
                botToken: this.decrypt(encrypted.botToken),
                chatId: this.decrypt(encrypted.chatId)
            };
        } catch (error) {
            console.error('Error obteniendo credenciales:', error);
            return { botToken: '', chatId: '' };
        }
    },
    
    // Verificar si hay credenciales guardadas
    async hasCredentials() {
        const credentials = await this.getCredentials();
        return !!(credentials.botToken && credentials.chatId);
    },
    
    // Encriptación mejorada (AES-like con múltiples capas)
    encrypt(text) {
        if (!text) return '';
        
        // Capa 1: Reverse y Base64
        const layer1 = btoa(text.split('').reverse().join(''));
        
        // Capa 2: XOR con clave
        const key = 'GallOli2024SecureKey';
        let layer2 = '';
        for (let i = 0; i < layer1.length; i++) {
            layer2 += String.fromCharCode(layer1.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        
        // Capa 3: Base64 final
        return btoa(layer2);
    },
    
    // Desencriptación
    decrypt(encrypted) {
        if (!encrypted) return '';
        
        try {
            // Capa 3: Decodificar Base64
            const layer2 = atob(encrypted);
            
            // Capa 2: XOR con clave
            const key = 'GallOli2024SecureKey';
            let layer1 = '';
            for (let i = 0; i < layer2.length; i++) {
                layer1 += String.fromCharCode(layer2.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            
            // Capa 1: Decodificar Base64 y reverse
            return atob(layer1).split('').reverse().join('');
        } catch (error) {
            console.error('Error desencriptando:', error);
            return '';
        }
    },
    
    // Forzar backup manual (para pruebas) - USA EL MISMO MÉTODO
    async forceBackup() {
        console.log('🔧 Forzando backup manual (mismo método que el automático)...');
        return await this.createAutomaticBackup();
    }
};
