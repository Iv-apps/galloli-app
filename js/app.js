// app.js - COMPLETO Y FUNCIONAL
const App = {
    currentPage: 'dashboard',
    currentDate: Utils.getTodayDate(),
    tempMermaResult: null,
    isReceiptOpen: false,
    selectedCoordinates: null,
    selectedAddress: '',
    mapaDashboardInicializado: false, // NUEVO: Para controlar si el mapa del dashboard ya fue inicializado
    devModeCheckInterval: null, // NUEVO: Para el intervalo de verificación del modo desarrollo
    handleDevModeChange: null, // NUEVO: Para almacenar la referencia del event listener

    // Inicialización
    async init() {
        // Registrar Service Worker primero y guardar la registration
        if ('serviceWorker' in navigator) {
            try {
                App._swRegistration = await navigator.serviceWorker.register('sw.js');
                PushNotifications.swRegistration = App._swRegistration;
                console.log('ServiceWorker registrado:', App._swRegistration.scope);
            } catch(e) {
                console.warn('Error registrando SW:', e.message);
            }
        }

        // Inicializar IndexedDB primero
        try {
            await DB.init();
            console.log('IndexedDB inicializado');
        } catch (error) {
            console.error('Error inicializando IndexedDB:', error);
            Utils.showNotification('Usando almacenamiento local', 'warning', 3000);
        }
        
        // INICIALIZAR SISTEMA DE AUTENTICACIÓN Y SINCRONIZACIÓN
        try {
            await window.AuthManager.init();
            
            // Si hay sesión activa, iniciar sincronización
            if (window.AuthManager.isAuthenticated()) {
                console.log('🔐 Sesión activa detectada:', window.AuthManager.user.name);
                await window.SyncEngine.init();
                // Enviar al servidor cualquier eliminación que haya quedado pendiente offline
                if (typeof SalesModule !== 'undefined' && SalesModule.syncPendingDeletions) {
                    SalesModule.syncPendingDeletions().catch(e => console.warn('syncPendingDeletions:', e.message));
                }
            } else {
                console.log('⚠️ No hay sesión activa');
            }
        } catch (error) {
            console.error('Error inicializando autenticación:', error);
        }
        
        // Inicializar sistema de modales
        Utils.initModals();
        
        // Ocultar fecha/hora completamente
        const dateTimeElement = document.getElementById('current-date-time');
        if (dateTimeElement) {
            dateTimeElement.style.display = 'none';
        }
        
        // INICIALIZAR TOGGLE DE MODO DESARROLLO INMEDIATAMENTE
        this.initDevModeToggle();
        
        // Inicializar toggle de notificaciones (después de que SW esté listo)
        setTimeout(() => App.initNotifToggle(), 3000);

        // Inicializar balanza BLE
        BluetoothScale.init();

        // SINCRONIZAR CON SERVICE WORKER
        this.syncDevModeWithServiceWorker();
        
        // Inicializar configuración PRIMERO
        await ConfigModule.init();
        
        // Cargar datos
        await this.loadAllData();

        // Sincronizar al servicio nativo DESPUES de loadAllData (clientes y precio ya disponibles)
        if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
            App._syncDataToNativeService();
            App._processPendingNativeSales();
            App._registerNativeFcmToken();
            if (typeof initNativeAutoSale === 'function') {
                initNativeAutoSale({
                    mode: 'auto',
                    minWeightLb: 3.50,
                    stableReadings: 3,
                    stableWindowMs: 2000,
                    minIntervalSamePlaceMs: 60000,
                    geofenceRadiusM: 150,
                    sriEnabled: false
                });
            }
        }
        this.setupNavigation();
        this.setupEventListeners();
        this.loadPage('dashboard');
        this.setupPWA();

        // App lista — ocultar splash inmediatamente
        this.hideSplash();

        // INICIALIZAR NOTIFICACIONES PUSH — sin await, no debe bloquear el arranque
        this.initPushNotifications();

        // INICIALIZAR FCM NATIVO (APK Capacitor) — registrar token con el worker
        if (typeof PushNotifications !== 'undefined') {
            PushNotifications.initNativeFcm();
        }
        
        // INICIALIZAR BACKUP AUTOMATICO
        await AutoBackup.init();
        
        // Configurar recordatorio diario
        this.setupDailyReminder();
        
        // Ocultar recibo al iniciar
        this.closeReceipt();
        
        // Ocultar notificación al iniciar
        Utils.hideNotification();
        
        // Aplicar configuración después de cargar
        setTimeout(() => {
            ConfigModule.applyLogo();
            ConfigModule.updateDynamicManifest();
        }, 500);
        
        // Procesar acción de notificación desde URL
        this.checkNotificationActionFromURL();

        // Detectar ?reset=token para recuperación de contraseña
        this._checkPasswordResetFromURL();

        // Manejar file_handlers (archivos abiertos desde el explorador)
        this.handleFileHandlers();

        // Manejar share_target (archivos recibidos por compartir)
        this.handleShareTarget();
        
        // NUEVO: Detectar cuando la app se vuelve visible y recargar datos
        this.setupVisibilityChangeHandler();
    },

    hideSplash() {
        const splash = document.getElementById('splash-screen');
        if (!splash) return;
        splash.style.opacity = '0';
        splash.style.visibility = 'hidden';
        setTimeout(() => splash.remove(), 500);
    },
    
    // NUEVO: Detectar cuando la app se vuelve visible y recargar datos
    setupVisibilityChangeHandler() {
        let lastVisibilityChange = Date.now();
        
        document.addEventListener('visibilitychange', async () => {
            if (document.hidden) {
                // App va a background — ceder BLE al servicio nativo
                await App._handoffBleToNativeService();
                return;
            }

            // App vuelve a primer plano
            const now = Date.now();
            const timeSinceLastChange = now - lastVisibilityChange;

            console.log('👁️ App visible - Tiempo desde último cambio:', timeSinceLastChange, 'ms');

            // Procesar ventas registradas en segundo plano (APK nativo)
            await App._processPendingNativeSales();
            // Resincronizar datos al servicio nativo
            App._syncDataToNativeService();
            // Reconectar balanza JS si hace falta
            if (window.BluetoothScale && !BluetoothScale.isConnected && BluetoothScale.activeScaleId) {
                BluetoothScale._autoReconnect && BluetoothScale._autoReconnect();
            }

            // Si pasaron mas de 2 segundos desde el último cambio, recargar datos
            if (timeSinceLastChange > 2000) {
                console.log('🔄 Recargando datos...');
                await this.loadAllData();
                this.loadPage(this.currentPage);
                console.log('✅ Datos actualizados');
            }

            lastVisibilityChange = now;
        });
        
        // También detectar cuando la ventana recibe foco
        window.addEventListener('focus', async () => {
            const now = Date.now();
            const timeSinceLastChange = now - lastVisibilityChange;
            
            if (timeSinceLastChange > 2000) {
                console.log('🔄 Ventana enfocada - Recargando datos...');
                await App._processPendingNativeSales();
                await this.loadAllData();
                this.loadPage(this.currentPage);
                console.log('✅ Datos actualizados');
                lastVisibilityChange = now;
            }
        });
    },

    // Cargar datos
    async loadAllData() {
        await ClientsModule.init();
        await OrdersModule.init();
        await SalesModule.init();
        await AccountingModule.init();
        await MermaModule.init();
        await DiezmosModule.init();
        await CreditosModule.init();
        await PaymentHistoryModule.init();
    },

    // Configurar navegación
    setupNavigation() {
        // Sidebar
        const sidebarItems = document.querySelectorAll('.sidebar-item');
        sidebarItems.forEach(item => {
            item.addEventListener('click', () => {
                sidebarItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        });
        
        // Bottom navigation
        const navItems = document.querySelectorAll('.bottom-nav-item');
        navItems.forEach(item => {
            if (item.getAttribute('data-page')) {
                item.addEventListener('click', () => {
                    const page = item.getAttribute('data-page');
                    this.loadPage(page);
                    
                    // Actualizar estado activo
                    navItems.forEach(i => {
                        if (i.getAttribute('data-page')) {
                            i.classList.remove('active');
                        }
                    });
                    item.classList.add('active');
                    
                    // Cerrar recibo al cambiar de pagina
                    this.closeReceipt();
                });
            }
        });
    },

    // Configurar event listeners
    setupEventListeners() {
        // Cerrar modales con tecla ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAllModals();
            }
        });
        
        // Cerrar modales al hacer clic fuera de ellos
        document.addEventListener('click', (e) => {
            // Cerrar modal de mapa si se hace clic fuera
            const mapModal = document.getElementById('map-modal');
            if (mapModal && mapModal.classList.contains('active')) {
                if (e.target === mapModal) {
                    this.closeMapModal();
                    return;
                }
            }
            // Cerrar modales dinámicos (sin id) al hacer clic en el overlay oscuro
            if (e.target.classList.contains('modal') && e.target.classList.contains('active')) {
                e.target.remove();
            }
        });
        
        // Escuchar mensajes del Service Worker (acciones de notificaciones)
        navigator.serviceWorker.addEventListener('message', (event) => {
            console.log('========================================');
            console.log('📨 MENSAJE RECIBIDO DEL SERVICE WORKER');
            console.log('Tipo:', event.data?.type);
            console.log('Acción:', event.data?.action);
            console.log('Datos:', event.data?.data);
            console.log('========================================');
            
            if (event.data && event.data.type === 'notification-action') {
                console.log('✅ Procesando acción de notificación...');
                this.handleNotificationAction(event.data.action, event.data.data);
            }
            
            // NUEVO: Procesar pagos desde notificaciones
            if (event.data && event.data.type === 'process-payment') {
                console.log('💰 Procesando pago desde notificación...');
                PaymentProcessor.processPaymentFromNotification(event.data);
            }
        });
    },
    
    // Detectar ?reset=token en la URL y abrir modal de nueva contraseña
    _checkPasswordResetFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        const resetToken = urlParams.get('reset');
        if (!resetToken) return;
        // El token se inyecta en un atributo onclick: validar formato hex antes de usarlo
        if (!/^[a-f0-9]{32,128}$/i.test(resetToken)) {
            console.warn('⚠️ Token de recuperación con formato inválido, ignorado');
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
        }
        window.history.replaceState({}, document.title, window.location.pathname);
        setTimeout(() => {
            const modal = document.createElement('div');
            modal.className = 'modal active';
            modal.innerHTML = `
                <div class="modal-content" style="max-width:400px;">
                    <div class="modal-header" style="background:linear-gradient(135deg,#4CAF50,#388E3C);color:white;">
                        <h3><i class="fas fa-key"></i> Nueva contraseña</h3>
                    </div>
                    <div class="modal-body" style="padding:1.5rem;">
                        <p style="margin-bottom:1rem;color:#666;font-size:.9rem;">Ingresa tu nueva contraseña para completar la recuperación.</p>
                        <div class="form-group">
                            <label style="font-weight:600;font-size:.9rem;">Nueva contraseña</label>
                            <input type="password" id="reset-pwd-input" class="form-input" placeholder="Mínimo 6 caracteres" style="margin-top:.4rem;">
                        </div>
                        <div class="form-group" style="margin-top:.75rem;">
                            <label style="font-weight:600;font-size:.9rem;">Confirmar contraseña</label>
                            <input type="password" id="reset-pwd-confirm" class="form-input" placeholder="Repite la contraseña" style="margin-top:.4rem;">
                        </div>
                        <div id="reset-pwd-msg" style="margin-top:.75rem;font-size:.85rem;display:none;"></div>
                        <button onclick="App._submitPasswordReset('${resetToken}')"
                                style="width:100%;margin-top:1rem;padding:1rem;background:linear-gradient(135deg,#4CAF50,#388E3C);color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;">
                            <i class="fas fa-check"></i> Guardar nueva contraseña
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            setTimeout(() => { const el = document.getElementById('reset-pwd-input'); if (el) el.focus(); }, 100);
        }, 1500);
    },

    async _submitPasswordReset(token) {
        const pwd = (document.getElementById('reset-pwd-input') || {}).value || '';
        const confirm = (document.getElementById('reset-pwd-confirm') || {}).value || '';
        const msgEl = document.getElementById('reset-pwd-msg');
        if (pwd.length < 6) {
            if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = '#f44336'; msgEl.textContent = 'La contraseña debe tener al menos 6 caracteres.'; }
            return;
        }
        if (pwd !== confirm) {
            if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = '#f44336'; msgEl.textContent = 'Las contraseñas no coinciden.'; }
            return;
        }
        try {
            await window.AuthManager.resetPassword(token, pwd);
            if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = '#4CAF50'; msgEl.textContent = 'Contraseña actualizada. Ahora puedes iniciar sesión.'; }
            setTimeout(() => {
                const m = document.querySelector('.modal.active');
                if (m) m.remove();
                this.loadPage('cloud-sync');
            }, 2000);
        } catch (e) {
            if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = '#f44336'; msgEl.textContent = e.message || 'Token inválido o expirado.'; }
        }
    },

    // Verificar si hay una acción de notificación en la URL
    checkNotificationActionFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        const action = urlParams.get('action');
        const clientId = urlParams.get('clientId');
        const clientName = urlParams.get('clientName');
        const totalDebt = urlParams.get('totalDebt');
        
        if (action) {
            console.log('🔔 Acción de notificación desde URL:', action);
            console.log('📋 Parametros:', { clientId, clientName, totalDebt });
            
            // Limpiar la URL
            window.history.replaceState({}, document.title, window.location.pathname);
            
            // Procesar la acción después de que la app esté lista
            setTimeout(() => {
                this.handleNotificationAction(action, {
                    clientId: clientId,
                    clientName: clientName,
                    totalDebt: totalDebt ? parseFloat(totalDebt) : 0
                });
            }, 1500);
        }
    },

    // Manejar archivos abiertos desde el explorador (file_handlers)
    async handleFileHandlers() {
        if (!('launchQueue' in window)) return;

        window.launchQueue.setConsumer(async (launchParams) => {
            if (!launchParams.files || launchParams.files.length === 0) return;

            console.log('📂 Archivo recibido via file_handler:', launchParams.files.length);

            for (const fileHandle of launchParams.files) {
                try {
                    const file = await fileHandle.getFile();
                    if (file.type === 'application/json' || file.name.endsWith('.json')) {
                        const text = await file.text();
                        const data = JSON.parse(text);
                        // Reutilizar la lógica de importación existente
                        await BackupModule.importFromData(data);
                        Utils.showNotification(`Backup "${file.name}" importado correctamente`, 'success');
                        this.loadPage('dashboard');
                    }
                } catch (err) {
                    console.error('Error procesando archivo:', err);
                    Utils.showNotification('Error al importar el archivo', 'error');
                }
            }
        });
    },

    // Manejar archivos recibidos por share_target
    async handleShareTarget() {
        const urlParams = new URLSearchParams(window.location.search);
        const action = urlParams.get('action');
        if (action !== 'import-backup') return;

        // Limpiar URL
        window.history.replaceState({}, document.title, window.location.pathname);

        try {
            // Verificar si hay datos en el cache del service worker (share_target POST)
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                const messageChannel = new MessageChannel();
                navigator.serviceWorker.controller.postMessage(
                    { type: 'GET_SHARED_FILE' },
                    [messageChannel.port2]
                );
                messageChannel.port1.onmessage = async (event) => {
                    if (event.data && event.data.file) {
                        try {
                            const data = JSON.parse(event.data.file);
                            await BackupModule.importFromData(data);
                            Utils.showNotification('Backup compartido importado correctamente', 'success');
                            this.loadPage('dashboard');
                        } catch (err) {
                            Utils.showNotification('Error al importar el backup compartido', 'error');
                        }
                    }
                };
            }
        } catch (err) {
            console.error('Error procesando share_target:', err);
        }
    },

    // Cargar pagina
    async loadPage(page) {
        this.currentPage = page;
        const mainContent = document.getElementById('main-content');
        if (!mainContent) return;
        
        // Actualizar sidebar
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.classList.remove('active');
        });
        const activeSidebarItem = document.querySelector(`.sidebar-item[onclick*="${page}"]`);
        if (activeSidebarItem) {
            activeSidebarItem.classList.add('active');
        }
        
        switch(page) {
            case 'dashboard':
                this.loadDashboardPage();
                break;
            case 'sales':
                this.loadSalesPage();
                break;
            case 'orders':
                this.loadOrdersPage();
                break;
            case 'clients':
                this.loadClientsPage();
                break;
            case 'merma':
                this.loadMermaPage();
                break;
            case 'stats':
                this.loadStatsPage();
                break;
            case 'accounting':
                this.loadAccountingPage();
                break;
            case 'backup':
                await this.loadBackupPage(); // ESPERAR carga asíncrona
                break;
            case 'cloud-sync':
                await this.loadCloudSyncPage();
                break;
            case 'rutas':
                this.loadRutasPage();
                break;
            case 'config':
                this.loadConfigPage();
                break;
            case 'diezmos':
                this.loadDiezmosPage();
                break;
            case 'creditos':
                this.loadCreditosPage();
                break;
            case 'payment-history':
                this.loadPaymentHistoryPage();
                break;
        }
        
        // REINICIALIZAR TOGGLE DE MODO DESARROLLO DESPUES DE CARGAR PAGINA
        setTimeout(() => {
            this.initDevModeToggle();
        }, 100);
        
        // Si hay recibo abierto, mantenerlo visible
        if (this.isReceiptOpen) {
            const receipt = document.getElementById('receipt-preview');
            if (receipt) {
                receipt.style.display = 'block';
            }
        }
    },
    
    // Pagina de Diezmos y Ofrendas
    loadDiezmosPage() {
        const preview = DiezmosModule.getPreview(this.currentDate);
        const sales = SalesModule.getSalesByDate(this.currentDate);
        const expenses = AccountingModule.getExpensesByDate(this.currentDate);
        
        const html = `
            <div class="page active" id="diezmos-page">
                <h2><i class="fas fa-hand-holding-heart"></i> Diezmos y Ofrendas</h2>
                <p style="margin: 10px 0 20px; color: var(--gray);">Calculo automatico basado en ganancia neta</p>
                
                <div class="date-filter">
                    <input type="date" class="date-input" id="diezmos-date-filter" value="${this.currentDate}">
                    <button class="btn btn-outline" onclick="App.filterDiezmosByDate()">
                        <i class="fas fa-filter"></i> Filtrar
                    </button>
                </div>
                
                ${sales.length === 0 ? `
                    <div class="card" style="background: #FFF3CD; border-left: 4px solid #FF9800;">
                        <p style="margin: 0; color: #856404;">
                            <i class="fas fa-info-circle"></i> No hay ventas registradas para ${this.currentDate}. 
                            Registra ventas primero para calcular diezmos y ofrendas.
                        </p>
                    </div>
                ` : ''}
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-label">Diezmo (${preview.diezmoPercent}%)</div>
                        <div class="stat-value" style="color: var(--primary)">${Utils.formatCurrency(preview.diezmo)}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Ofrenda (${preview.ofrendaPercent}%)</div>
                        <div class="stat-value" style="color: var(--secondary)">${Utils.formatCurrency(preview.ofrenda)}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Total a Apartar</div>
                        <div class="stat-value" style="color: var(--warning)">${Utils.formatCurrency(preview.total)}</div>
                    </div>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-cog"></i> Configuración de Porcentajes</h3>
                    <form id="diezmos-config-form">
                        <div class="form-group">
                            <label class="form-label">Porcentaje de Diezmo (%)</label>
                            <input type="number" step="0.1" min="0" max="100" class="form-input" 
                                   id="diezmo-percent" value="${DiezmosModule.config.diezmoPercent}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Porcentaje de Ofrenda (%)</label>
                            <input type="number" step="0.1" min="0" max="100" class="form-input" 
                                   id="ofrenda-percent" value="${DiezmosModule.config.ofrendaPercent}" required>
                        </div>
                        <button type="submit" class="btn btn-primary" style="width: 100%;">
                            <i class="fas fa-save"></i> Guardar Configuración
                        </button>
                    </form>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-save"></i> Guardar Registro del Día</h3>
                    <p style="color: var(--gray); margin-bottom: 15px;">Guarda el calculo de diezmos y ofrendas para ${this.currentDate}</p>
                    <button class="btn btn-success" onclick="App.saveDiezmosRecord()" style="width: 100%;" ${sales.length === 0 ? 'disabled' : ''}>
                        <i class="fas fa-check"></i> Guardar Registro de Hoy
                    </button>
                    ${sales.length === 0 ? '<p style="color: var(--gray); font-size: 0.85rem; margin-top: 10px;"><i class="fas fa-info-circle"></i> Necesitas tener ventas para guardar un registro</p>' : ''}
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-history"></i> Historial de Registros</h3>
                    
                    <!-- Filtro por rango de fechas -->
                    <div style="margin-bottom: 20px;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                            <div class="form-group" style="margin: 0;">
                                <label class="form-label" style="font-size: 0.85rem;">Fecha Inicio</label>
                                <input type="date" class="form-input" id="diezmos-start-date">
                            </div>
                            <div class="form-group" style="margin: 0;">
                                <label class="form-label" style="font-size: 0.85rem;">Fecha Fin</label>
                                <input type="date" class="form-input" id="diezmos-end-date">
                            </div>
                        </div>
                        <button class="btn btn-primary" onclick="App.filterDiezmosRecords()" style="width: 100%;">
                            <i class="fas fa-filter"></i> Filtrar por Rango
                        </button>
                    </div>
                    
                    <ul class="sales-list" id="diezmos-records-list">
                        <!-- Los registros se agregaran aquí -->
                    </ul>
                </div>
            </div>
        `;
        
        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = html;
            this.updateDiezmosRecordsList();
            
            const configForm = document.getElementById('diezmos-config-form');
            if (configForm) {
                configForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.saveDiezmosConfig();
                });
            }
            
            const dateFilter = document.getElementById('diezmos-date-filter');
            if (dateFilter) {
                dateFilter.addEventListener('change', (e) => {
                    this.currentDate = e.target.value;
                });
            }
        }
    },

    filterDiezmosByDate() {
        const dateInput = document.getElementById('diezmos-date-filter');
        if (dateInput) {
            this.currentDate = dateInput.value;
            // Actualizar vista previa inmediatamente
            this.updateDiezmosPreview();
        }
    },

    saveDiezmosConfig() {
        const diezmoPercent = parseFloat(document.getElementById('diezmo-percent').value);
        const ofrendaPercent = parseFloat(document.getElementById('ofrenda-percent').value);
        
        DiezmosModule.updateConfig(diezmoPercent, ofrendaPercent);
        Utils.showNotification('Configuración guardada correctamente', 'success', 3000);
        this.loadDiezmosPage();
    },

    async saveDiezmosRecord() {
        const dateInput = document.getElementById('diezmos-date-filter');
        const date = dateInput ? dateInput.value : Utils.getTodayDate();
        
        await DiezmosModule.saveDailyRecord(date);
        Utils.showNotification('Registro guardado correctamente', 'success', 3000);
        this.updateDiezmosRecordsList();
    },

    async saveDailyDiezmos() {
        const today = Utils.getTodayDate();
        await DiezmosModule.saveDailyRecord(today);
        Utils.showNotification('Diezmos guardados correctamente', 'success', 3000);
        
        // Notificación push
        if (NotificationsModule) {
            const preview = DiezmosModule.getPreview(today);
            NotificationsModule.show('Diezmos Guardados', `Total: ${Utils.formatCurrency(preview.total)}`).catch(err => {
                console.warn('No se pudo enviar notificación:', err);
            });
        }
        
        this.loadDiezmosPage();
    },

    // NUEVO: Recalcular todos los diezmos pendientes
    async recalcularTodosDiezmos() {
        const confirmed = await Utils.showConfirm(
            '¿Recalcular diezmos para TODOS los días con ganancias? Esto puede tomar unos segundos.',
            'Recalcular Diezmos',
            'Recalcular',
            'Cancelar'
        );
        
        if (!confirmed) {
            return;
        }
        
        Utils.showLoading(true);
        
        try {
            const resultado = await DiezmosModule.forzarRecalculoCompleto();
            
            if (resultado.creados > 0 || resultado.actualizados > 0) {
                // Recargar la pagina para mostrar los nuevos registros
                this.loadDiezmosPage();
            } else {
                Utils.showNotification('No se encontraron días con ganancias pendientes de calcular', 'info', 3000);
            }
        } catch (error) {
            Utils.showNotification('Error al recalcular diezmos: ' + error.message, 'error', 5000);
        } finally {
            Utils.showLoading(false);
        }
    },

    filterDiezmosRecords() {
        const startDate = document.getElementById('diezmos-start-date').value;
        const endDate = document.getElementById('diezmos-end-date').value;
        
        if (!startDate || !endDate) {
            Utils.showNotification('Selecciona ambas fechas', 'error', 3000);
            return;
        }
        
        if (startDate > endDate) {
            Utils.showNotification('La fecha inicio debe ser menor a la fecha fin', 'error', 3000);
            return;
        }
        
        this.updateDiezmosRecordsList(startDate, endDate);
        
        const records = DiezmosModule.records.filter(r => r.date >= startDate && r.date <= endDate);
        const total = records.reduce((sum, r) => sum + r.total, 0);
        
        Utils.showNotification(`${records.length} registros encontrados. Total: ${Utils.formatCurrency(total)}`, 'success', 5000);
    },

    updateDiezmosRecordsList(startDate = null, endDate = null) {
        const recordsList = document.getElementById('diezmos-records-list');
        if (!recordsList) return;
        
        recordsList.innerHTML = '';
        
        let records = [...DiezmosModule.records];
        
        // Filtrar por rango si se proporciona
        if (startDate && endDate) {
            records = records.filter(r => r.date >= startDate && r.date <= endDate);
        }
        
        records = records.sort((a, b) => b.timestamp - a.timestamp);
        
        if (records.length === 0) {
            recordsList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-hand-holding-heart empty-state-icon"></i>
                    <p>No hay registros guardados</p>
                </div>
            `;
            return;
        }
        
        records.forEach(record => {
            const li = document.createElement('li');
            li.className = 'sale-item';
            li.innerHTML = `
                <div class="sale-info">
                    <h3><i class="fas fa-calendar"></i> ${record.date}</h3>
                    <p class="sale-details">
                        <i class="fas fa-hand-holding-heart"></i> Diezmo: ${Utils.formatCurrency(record.diezmo)} (${record.diezmoPercent}%)
                    </p>
                    <p class="sale-details">
                        <i class="fas fa-gift"></i> Ofrenda: ${Utils.formatCurrency(record.ofrenda)} (${record.ofrendaPercent}%)
                    </p>
                </div>
                <div class="sale-amount" style="color: var(--warning);">
                    ${Utils.formatCurrency(record.total)}
                </div>
            `;
            recordsList.appendChild(li);
        });
    },

    loadCreditosPage() {
        const creditSales = SalesModule.getCreditSales();
        const totalDebt = creditSales.reduce((sum, sale) => sum + sale.remainingDebt, 0);
        
        const clientsWithDebt = {};
        creditSales.forEach(sale => {
            if (!clientsWithDebt[sale.clientId]) {
                const client = ClientsModule.getClientById(sale.clientId);
                clientsWithDebt[sale.clientId] = {
                    client,
                    totalDebt: 0,
                    sales: []
                };
            }
            clientsWithDebt[sale.clientId].totalDebt += sale.remainingDebt;
            clientsWithDebt[sale.clientId].sales.push(sale);
        });

        const html = `
            <div class="page active" id="creditos-page">
                <h2><i class="fas fa-credit-card"></i> Control de Créditos</h2>
                <p style="margin: 10px 0 20px; color: var(--gray);">Gestiona ventas a crédito y pagos</p>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-label">Créditos Activos</div>
                        <div class="stat-value" style="color: var(--warning)">${creditSales.length}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Deuda Total</div>
                        <div class="stat-value" style="color: var(--danger)">${Utils.formatCurrency(totalDebt)}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Clientes con Deuda</div>
                        <div class="stat-value">${Object.keys(clientsWithDebt).length}</div>
                    </div>
                </div>

                ${Object.keys(clientsWithDebt).length > 0 ? `
                <!-- Buscador de creditos -->
                <div style="position: relative; margin-bottom: 15px;">
                    <i class="fas fa-search" style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--gray); pointer-events: none;"></i>
                    <input type="text" id="creditos-search" class="form-input"
                           placeholder="Buscar por nombre o teléfono..."
                           style="padding-left: 40px;"
                           oninput="App._filterCreditosPage(this.value)">
                </div>
                ` : ''}

                ${Object.keys(clientsWithDebt).length === 0 ? `
                    <div class="card" style="background: #E8F5E9; border-left: 4px solid var(--success);">
                        <p style="margin: 0; color: var(--success);">
                            <i class="fas fa-check-circle"></i> No hay créditos pendientes
                        </p>
                    </div>
                ` : ''}

                <div id="creditos-list">
                ${Object.values(clientsWithDebt).map(data => `
                    <div class="card credito-card" data-client-name="${(data.client.name || '').toLowerCase()}" data-client-phone="${(data.client.phone || '').toLowerCase()}">
                        <h3>
                            <i class="fas fa-user"></i> ${Utils.escapeHtml(data.client.name)}
                            <span style="float: right; color: var(--danger); font-size: 1.2rem;">
                                ${Utils.formatCurrency(data.totalDebt)}
                            </span>
                        </h3>
                        <p style="color: var(--gray); margin: 5px 0 15px;">
                            <i class="fas fa-phone"></i> ${Utils.escapeHtml(data.client.phone)}
                        </p>
                        
                        ${data.sales.length > 1 ? `
                        <div style="background: linear-gradient(135deg, #4CAF50, #388E3C); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                                <div style="color: white;">
                                    <div style="font-size: 0.9rem; opacity: 0.9;">Pago Inteligente</div>
                                    <div style="font-size: 1.3rem; font-weight: bold;">${data.sales.length} créditos activos</div>
                                </div>
                                <button class="btn" onclick="App.showSmartPaymentModal(${data.client.id})" 
                                        style="background: white; color: #4CAF50; font-weight: bold; padding: 12px 24px;">
                                    <i class="fas fa-magic"></i> Pagar Todo
                                </button>
                            </div>
                        </div>
                        ` : ''}
                        
                        <ul class="sales-list">
                            ${data.sales.map(sale => `
                                <li class="sale-item">
                                    <div class="sale-info">
                                        <h4>${sale.date} ${sale.time}</h4>
                                        <p class="sale-details">
                                            <i class="fas fa-weight"></i> ${sale.weight.toFixed(2)} lb × 
                                            <i class="fas fa-egg"></i> ${sale.quantity} pollos
                                        </p>
                                        <p class="sale-details">
                                            <i class="fas fa-dollar-sign"></i> Total: ${Utils.formatCurrency(sale.total)} | 
                                            <i class="fas fa-check"></i> Pagado: ${Utils.formatCurrency(sale.paidAmount)}
                                        </p>
                                        ${sale.paymentHistory && sale.paymentHistory.length > 0 ? `
                                            <details style="margin-top: 10px;">
                                                <summary style="cursor: pointer; color: var(--primary);">Ver pagos (${sale.paymentHistory.length})</summary>
                                                <ul style="margin: 10px 0 0 20px; font-size: 0.9rem;">
                                                    ${sale.paymentHistory.map(p => `
                                                        <li>${p.date} ${p.time}: ${Utils.formatCurrency(p.amount)}</li>
                                                    `).join('')}
                                                </ul>
                                            </details>
                                        ` : ''}
                                    </div>
                                    <div style="text-align: right;">
                                        <div class="sale-amount" style="color: var(--danger);">
                                            ${Utils.formatCurrency(sale.remainingDebt)}
                                        </div>
                                        <button class="btn btn-success" onclick="App.showPaymentModal(${sale.id})" 
                                                style="margin-top: 5px; padding: 5px 10px; font-size: 0.8rem;">
                                            <i class="fas fa-dollar-sign"></i> Pagar
                                        </button>
                                    </div>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                `).join('')}
                </div>
            </div>
        `;

        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = html;
        }
    },

    // Filtrar lista de creditos por nombre o telefono
    _filterCreditosPage(query) {
        const q = query.toLowerCase().trim();
        document.querySelectorAll('.credito-card').forEach(card => {
            const name = card.dataset.clientName || '';
            const phone = card.dataset.clientPhone || '';
            card.style.display = (!q || name.includes(q) || phone.includes(q)) ? '' : 'none';
        });
    },

    showPaymentModal(saleId) {
        const sale = SalesModule.getSaleById(saleId);
        if (!sale) return;

        const client = ClientsModule.getClientById(sale.clientId);
        if (!client) return;

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-dollar-sign"></i> Registrar Pago</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p><strong>Cliente:</strong> ${Utils.escapeHtml(client.name)}</p>
                    <p><strong>Venta:</strong> ${sale.date} ${sale.time}</p>
                    <p><strong>Total:</strong> ${Utils.formatCurrency(sale.total)}</p>
                    <p><strong>Pagado:</strong> ${Utils.formatCurrency(sale.paidAmount)}</p>
                    <p style="color: var(--danger); font-weight: bold;"><strong>Deuda:</strong> ${Utils.formatCurrency(sale.remainingDebt)}</p>
                    
                    <form id="payment-form">
                        <div class="form-group">
                            <label class="form-label">Monto a Pagar</label>
                            <input type="number" step="0.01" min="0.01" 
                                   class="form-input" id="payment-amount" required 
                                   placeholder="Máximo: ${sale.remainingDebt.toFixed(2)}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Fecha del Pago</label>
                            <input type="date" class="form-input" id="payment-date" 
                                   value="${Utils.getTodayDate()}" required>
                        </div>
                        <button type="submit" class="btn btn-success" style="width: 100%;">
                            <i class="fas fa-check"></i> Registrar Pago
                        </button>
                    </form>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const form = modal.querySelector('#payment-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const amount = parseFloat(document.getElementById('payment-amount').value);
            const date = document.getElementById('payment-date').value;
            
            if (await SalesModule.registerPayment(saleId, amount, date)) {
                Utils.showNotification(`Pago registrado: ${Utils.formatCurrency(amount)}`, 'success', 3000);
                modal.remove();
                this.loadCreditosPage();
                CreditosModule.updateCreditBadges();
            } else {
                Utils.showNotification('Error al registrar pago', 'error', 3000);
            }
        });
    },

    showSmartPaymentModal(clientId) {
        const client = ClientsModule.getClientById(clientId);
        if (!client) return;

        const clientSales = SalesModule.getCreditSales().filter(s => s.clientId === clientId);
        const totalDebt = clientSales.reduce((sum, sale) => sum + sale.remainingDebt, 0);

        // Ordenar ventas por fecha (mas antiguas primero - FIFO)
        clientSales.sort((a, b) => {
            const dateA = new Date(a.date + ' ' + a.time);
            const dateB = new Date(b.date + ' ' + b.time);
            return dateA - dateB;
        });

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header" style="background: linear-gradient(135deg, #4CAF50, #388E3C); color: white;">
                    <h3><i class="fas fa-magic"></i> Pago Inteligente</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()" style="color: white;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div style="background: #E8F5E9; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                        <p style="margin: 0 0 10px 0;"><strong>Cliente:</strong> ${Utils.escapeHtml(client.name)}</p>
                        <p style="margin: 0 0 10px 0;"><strong>Créditos activos:</strong> ${clientSales.length}</p>
                        <p style="margin: 0; font-size: 1.2rem; color: #4CAF50; font-weight: bold;">
                            <strong>Deuda total:</strong> ${Utils.formatCurrency(totalDebt)}
                        </p>
                    </div>

                    <div style="background: #FFF3CD; padding: 12px; border-radius: 8px; border-left: 4px solid #FF9800; margin-bottom: 20px;">
                        <p style="margin: 0; color: #856404; font-size: 0.9rem;">
                            <i class="fas fa-info-circle"></i> <strong>¿Cómo funciona?</strong>
                        </p>
                        <p style="margin: 5px 0 0 0; color: #856404; font-size: 0.85rem;">
                            El pago se distribuira automaticamente entre los créditos mas antiguos primero (FIFO).
                        </p>
                    </div>

                    <form id="smart-payment-form">
                        <div class="form-group">
                            <label class="form-label">Monto a Pagar</label>
                            <input type="number" step="0.01" min="0.01" max="${totalDebt.toFixed(2)}"
                                   class="form-input" id="smart-payment-amount" required 
                                   placeholder="Máximo: ${totalDebt.toFixed(2)}">
                            <div style="display: flex; gap: 5px; margin-top: 10px; flex-wrap: wrap;">
                                <button type="button" class="btn btn-outline" onclick="document.getElementById('smart-payment-amount').value = ${(totalDebt / 4).toFixed(2)}" style="flex: 1; min-width: 60px; padding: 8px; font-size: 0.85rem;">
                                    25%
                                </button>
                                <button type="button" class="btn btn-outline" onclick="document.getElementById('smart-payment-amount').value = ${(totalDebt / 2).toFixed(2)}" style="flex: 1; min-width: 60px; padding: 8px; font-size: 0.85rem;">
                                    50%
                                </button>
                                <button type="button" class="btn btn-outline" onclick="document.getElementById('smart-payment-amount').value = ${(totalDebt * 0.75).toFixed(2)}" style="flex: 1; min-width: 60px; padding: 8px; font-size: 0.85rem;">
                                    75%
                                </button>
                                <button type="button" class="btn btn-success" onclick="document.getElementById('smart-payment-amount').value = ${totalDebt.toFixed(2)}" style="flex: 1; min-width: 60px; padding: 8px; font-size: 0.85rem;">
                                    100%
                                </button>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">Fecha del Pago</label>
                            <input type="date" class="form-input" id="smart-payment-date" 
                                   value="${Utils.getTodayDate()}" required>
                        </div>

                        <div id="payment-preview" style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 15px; display: none;">
                            <h4 style="margin: 0 0 10px 0; font-size: 0.9rem; color: var(--gray);">
                                <i class="fas fa-eye"></i> Vista Previa de Distribución
                            </h4>
                            <div id="preview-content"></div>
                        </div>

                        <button type="submit" class="btn btn-success" style="width: 100%; padding: 15px; font-size: 1.1rem;">
                            <i class="fas fa-magic"></i> Aplicar Pago Inteligente
                        </button>
                    </form>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Preview en tiempo real
        const amountInput = document.getElementById('smart-payment-amount');
        amountInput.addEventListener('input', () => {
            const amount = parseFloat(amountInput.value) || 0;
            if (amount > 0) {
                this.showPaymentPreview(clientSales, amount);
            } else {
                document.getElementById('payment-preview').style.display = 'none';
            }
        });

        const form = modal.querySelector('#smart-payment-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const amount = parseFloat(document.getElementById('smart-payment-amount').value);
            const date = document.getElementById('smart-payment-date').value;
            
            if (amount > totalDebt) {
                Utils.showNotification('El monto no puede ser mayor a la deuda total', 'error', 3000);
                return;
            }

            await this.processSmartPayment(clientSales, amount, date);
            modal.remove();
            this.loadCreditosPage();
            CreditosModule.updateCreditBadges();
        });
    },

    showPaymentPreview(sales, amount) {
        const preview = document.getElementById('payment-preview');
        const content = document.getElementById('preview-content');
        
        let remaining = amount;
        const distribution = [];

        for (const sale of sales) {
            if (remaining <= 0) break;
            
            const payment = Math.min(remaining, sale.remainingDebt);
            distribution.push({
                date: sale.date,
                time: sale.time,
                debt: sale.remainingDebt,
                payment: payment,
                remaining: sale.remainingDebt - payment
            });
            remaining -= payment;
        }

        content.innerHTML = distribution.map((d, i) => `
            <div style="padding: 10px; background: white; border-radius: 6px; margin-bottom: 8px; font-size: 0.85rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span><strong>${i + 1}.</strong> ${d.date} ${d.time}</span>
                    <span style="color: var(--danger);">Deuda: ${Utils.formatCurrency(d.debt)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: var(--success);">
                        <i class="fas fa-arrow-right"></i> Pago: ${Utils.formatCurrency(d.payment)}
                    </span>
                    <span style="color: ${d.remaining === 0 ? 'var(--success)' : 'var(--warning)'}; font-weight: bold;">
                        ${d.remaining === 0 ? 'Liquidado' : `Resta: ${Utils.formatCurrency(d.remaining)}`}
                    </span>
                </div>
            </div>
        `).join('');

        preview.style.display = 'block';
    },

    async processSmartPayment(sales, totalAmount, date) {
        let remaining = totalAmount;
        let paymentsProcessed = 0;
        const processedSaleIds = [];

        for (const sale of sales) {
            if (remaining <= 0) break;
            
            const payment = Math.min(remaining, sale.remainingDebt);
            
            if (await SalesModule.registerPayment(sale.id, payment, date, true)) {
                paymentsProcessed++;
                remaining -= payment;
                processedSaleIds.push(sale.id);
            }
        }

        // Esperar a que se guarden todos los cambios
        await SalesModule.saveSales();

        // CRITICO: Notificar al sistema de sincronización sobre los pagos procesados
        if (paymentsProcessed > 0 && typeof SyncEngine !== 'undefined' && SyncEngine.notifyChange) {
            // Notificar cada venta modificada
            for (const saleId of processedSaleIds) {
                await SyncEngine.notifyChange('sales', saleId, 'update');
            }
        }

        if (paymentsProcessed > 0) {
            Utils.showNotification(
                `Pago inteligente aplicado: ${Utils.formatCurrency(totalAmount - remaining)} distribuido en ${paymentsProcessed} credito${paymentsProcessed > 1 ? 's' : ''}`,
                'success',
                5000
            );
        } else {
            Utils.showNotification('Error al procesar el pago', 'error', 3000);
        }
    },

    markSaleAsCredit(saleId) {
        if (SalesModule.markAsCredit(saleId)) {
            Utils.showNotification('Venta marcada como crédito', 'success', 3000);
            CreditosModule.updateCreditBadges();
            return true;
        }
        return false;
    },

    // Pagina de Historial de Pagos
    loadPaymentHistoryPage() {
        const allPayments = PaymentHistoryModule.getAllPayments();
        const stats = PaymentHistoryModule.getStats();
        const clients = ClientsModule.clients;
        
        const html = `
            <div class="page active" id="payment-history-page">
                <h2><i class="fas fa-history"></i> Historial de Pagos</h2>
                <p style="margin: 10px 0 20px; color: var(--gray);">Registro permanente de todos los pagos recibidos</p>
                
                <div class="stats-grid" style="margin-bottom: 25px;">
                    <div class="stat-card" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none;">
                        <div class="stat-label" style="color: rgba(255,255,255,0.9);">Total de Pagos</div>
                        <div class="stat-value" style="color: white; font-size: 2.5rem;">${stats.totalPayments}</div>
                        <div style="margin-top: 5px; font-size: 0.85rem; opacity: 0.9;">
                            <i class="fas fa-receipt"></i> Transacciones
                        </div>
                    </div>
                    <div class="stat-card" style="background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%); color: white; border: none;">
                        <div class="stat-label" style="color: rgba(255,255,255,0.9);">Monto Total</div>
                        <div class="stat-value" style="color: white; font-size: 2.5rem;">${Utils.formatCurrency(stats.totalAmount)}</div>
                        <div style="margin-top: 5px; font-size: 0.85rem; opacity: 0.9;">
                            <i class="fas fa-money-bill-wave"></i> Recaudado
                        </div>
                    </div>
                    <div class="stat-card" style="background: linear-gradient(135deg, #3498db 0%, #2980b9 100%); color: white; border: none;">
                        <div class="stat-label" style="color: rgba(255,255,255,0.9);">Clientes Únicos</div>
                        <div class="stat-value" style="color: white; font-size: 2.5rem;">${stats.uniqueClients}</div>
                        <div style="margin-top: 5px; font-size: 0.85rem; opacity: 0.9;">
                            <i class="fas fa-users"></i> Clientes
                        </div>
                    </div>
                    <div class="stat-card" style="background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%); color: white; border: none;">
                        <div class="stat-label" style="color: rgba(255,255,255,0.9);">Promedio por Pago</div>
                        <div class="stat-value" style="color: white; font-size: 2.5rem;">${Utils.formatCurrency(stats.averagePayment)}</div>
                        <div style="margin-top: 5px; font-size: 0.85rem; opacity: 0.9;">
                            <i class="fas fa-chart-line"></i> Promedio
                        </div>
                    </div>
                </div>
                
                <div class="card" style="background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); border: none; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                    <h3 style="margin-bottom: 20px;"><i class="fas fa-filter"></i> Filtros de Búsqueda</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 15px;">
                        <div class="form-group" style="margin: 0;">
                            <label class="form-label" style="font-weight: 600;">
                                <i class="fas fa-user"></i> Cliente
                            </label>
                            <select class="form-input" id="filter-client" onchange="App.filterPaymentHistory()" style="border: 2px solid var(--border);">
                                <option value="">Todos los clientes</option>
                                ${clients.map(c => `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group" style="margin: 0;">
                            <label class="form-label" style="font-weight: 600;">
                                <i class="fas fa-calendar-alt"></i> Fecha Inicio
                            </label>
                            <input type="date" class="form-input" id="filter-start-date" onchange="App.filterPaymentHistory()" style="border: 2px solid var(--border);">
                        </div>
                        <div class="form-group" style="margin: 0;">
                            <label class="form-label" style="font-weight: 600;">
                                <i class="fas fa-calendar-check"></i> Fecha Fin
                            </label>
                            <input type="date" class="form-input" id="filter-end-date" onchange="App.filterPaymentHistory()" style="border: 2px solid var(--border);">
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button class="btn btn-outline" onclick="App.clearPaymentFilters()" style="flex: 1; min-width: 150px;">
                            <i class="fas fa-times"></i> Limpiar Filtros
                        </button>
                        <button class="btn btn-primary" onclick="App.exportPaymentHistory()" style="flex: 1; min-width: 150px;">
                            <i class="fas fa-download"></i> Exportar Historial
                        </button>
                    </div>
                </div>
                
                <div id="payment-history-list">
                    ${this.renderPaymentHistoryList(allPayments)}
                </div>
            </div>
        `;
        
        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = html;
        }
    },

    renderPaymentHistoryList(payments) {
        if (payments.length === 0) {
            return `
                <div class="card" style="background: #FFF3CD; border-left: 4px solid #FF9800;">
                    <p style="margin: 0; color: #856404;">
                        <i class="fas fa-info-circle"></i> No hay pagos registrados con los filtros seleccionados
                    </p>
                </div>
            `;
        }

        // Agrupar pagos por fecha
        const paymentsByDate = {};
        payments.forEach(payment => {
            if (!paymentsByDate[payment.date]) {
                paymentsByDate[payment.date] = [];
            }
            paymentsByDate[payment.date].push(payment);
        });

        return Object.keys(paymentsByDate).sort().reverse().map(date => `
            <div class="card" style="margin-bottom: 20px;">
                <h3 style="margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid var(--border);">
                    <i class="fas fa-calendar-day"></i> ${date}
                    <span style="float: right; color: var(--success); font-size: 1rem;">
                        ${paymentsByDate[date].length} pago${paymentsByDate[date].length > 1 ? 's' : ''}
                    </span>
                </h3>
                
                <div style="display: grid; gap: 15px;">
                    ${paymentsByDate[date].map(payment => `
                        <div style="
                            background: var(--bg);
                            border: 1px solid var(--border);
                            border-radius: 12px;
                            padding: 12px;
                            transition: all 0.3s ease;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                        " onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)'; this.style.transform='translateY(-2px)';" 
                           onmouseout="this.style.boxShadow='0 2px 4px rgba(0,0,0,0.05)'; this.style.transform='translateY(0)';">
                            
                            <!-- Fila 1: Icono + Cliente -->
                            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                                <!-- Icono -->
                                <div style="flex-shrink: 0;">
                                    <div style="
                                        width: 45px;
                                        height: 45px;
                                        border-radius: 50%;
                                        background: linear-gradient(135deg, var(--success) 0%, #27ae60 100%);
                                        display: flex;
                                        align-items: center;
                                        justify-content: center;
                                        color: white;
                                        font-size: 1.1rem;
                                        box-shadow: 0 4px 8px rgba(46, 204, 113, 0.3);
                                    ">
                                        <i class="fas fa-dollar-sign"></i>
                                    </div>
                                </div>
                                
                                <!-- Cliente + Hora -->
                                <div style="flex: 1; min-width: 0;">
                                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 3px;">
                                        <i class="fas fa-user" style="color: var(--primary); font-size: 0.85rem; flex-shrink: 0;"></i>
                                        <strong style="font-size: 0.95rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${payment.clientName}</strong>
                                    </div>
                                    <div style="font-size: 0.75rem; color: var(--gray);">
                                        <i class="fas fa-clock"></i> ${payment.time}
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Fila 2: Monto + Badge -->
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 10px; background: #E8F5E9; border-radius: 8px;">
                                <div>
                                    <div style="font-size: 0.75rem; color: var(--gray); margin-bottom: 3px;">Monto Pagado</div>
                                    <div style="font-size: 1.5rem; font-weight: bold; color: var(--success); line-height: 1;">
                                        ${Utils.formatCurrency(payment.amount)}
                                    </div>
                                </div>
                                <div style="
                                    padding: 6px 12px;
                                    background: var(--success);
                                    color: white;
                                    border-radius: 20px;
                                    font-size: 0.7rem;
                                    font-weight: 500;
                                    white-space: nowrap;
                                ">
                                    <i class="fas fa-check"></i> Pagado
                                </div>
                            </div>
                            
                            <!-- Fila 3: Detalles de la venta -->
                            <div style="
                                display: grid; 
                                grid-template-columns: repeat(2, 1fr); 
                                gap: 8px; 
                                padding-top: 10px; 
                                border-top: 1px solid var(--border);
                            ">
                                <div style="font-size: 0.75rem; color: var(--gray); overflow: hidden; text-overflow: ellipsis;">
                                    <i class="fas fa-calendar" style="width: 14px;"></i> 
                                    ${payment.saleDetails.saleDate}
                                </div>
                                <div style="font-size: 0.75rem; color: var(--gray); white-space: nowrap;">
                                    <i class="fas fa-weight" style="width: 14px;"></i> 
                                    ${payment.saleDetails.weight.toFixed(2)} lb
                                </div>
                                <div style="font-size: 0.75rem; color: var(--gray); white-space: nowrap;">
                                    <i class="fas fa-egg" style="width: 14px;"></i> 
                                    ${payment.saleDetails.quantity} pollos
                                </div>
                                <div style="font-size: 0.75rem; color: var(--gray); white-space: nowrap;">
                                    <i class="fas fa-receipt" style="width: 14px;"></i> 
                                    ${Utils.formatCurrency(payment.saleDetails.totalAmount)}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    },

    filterPaymentHistory() {
        const clientId = document.getElementById('filter-client').value;
        const startDate = document.getElementById('filter-start-date').value;
        const endDate = document.getElementById('filter-end-date').value;
        
        let payments = PaymentHistoryModule.getAllPayments();
        
        // Filtrar por cliente
        if (clientId) {
            payments = payments.filter(p => p.clientId == clientId);
        }
        
        // Filtrar por rango de fechas
        if (startDate && endDate) {
            payments = payments.filter(p => p.date >= startDate && p.date <= endDate);
        } else if (startDate) {
            payments = payments.filter(p => p.date >= startDate);
        } else if (endDate) {
            payments = payments.filter(p => p.date <= endDate);
        }
        
        // Actualizar la lista
        const listContainer = document.getElementById('payment-history-list');
        if (listContainer) {
            listContainer.innerHTML = this.renderPaymentHistoryList(payments);
        }
    },

    clearPaymentFilters() {
        document.getElementById('filter-client').value = '';
        document.getElementById('filter-start-date').value = '';
        document.getElementById('filter-end-date').value = '';
        this.filterPaymentHistory();
    },

    exportPaymentHistory() {
        const clientId = document.getElementById('filter-client').value;
        PaymentHistoryModule.exportPayments(clientId || null);
        Utils.showNotification('Historial exportado correctamente', 'success', 3000);
    },

    // Pagina de Configuración (NUEVA)
loadConfigPage() {
    ConfigModule.init();
    
    const html = `
        <div class="page active" id="config-page">
            <h2><i class="fas fa-cog"></i> Configuración de la App</h2>
            <p style="margin: 10px 0 20px; color: var(--gray);">Personaliza colores, nombre y logo de la aplicación</p>
            
            <!-- Configuración de Colores -->
            <div class="config-group">
                <h4><i class="fas fa-palette"></i> Colores de la Interfaz</h4>
                
                <!-- Temas predefinidos -->
                <div style="margin-bottom: 20px;">
                    <p style="margin-bottom: 10px; font-weight: 600;">Temas predefinidos:</p>
                    <div class="themes-grid">
                        ${Object.entries(ConfigModule.themes).map(([key, theme]) => `
                            <div class="theme-option ${ConfigModule.currentConfig.theme === key ? 'active' : ''}" 
                                 onclick="ConfigModule.setTheme('${key}'); ConfigModule.saveConfig(); App.updateConfigUI()">
                                <div class="theme-preview" style="background: linear-gradient(90deg, ${theme.colors.primary}, ${theme.colors.secondary})"></div>
                                <div class="theme-info">
                                    <div class="theme-name">${Utils.escapeHtml(theme.name)}</div>
                                    <div class="theme-colors">
                                        <div class="theme-color-dot" style="background: ${theme.colors.primary}"></div>
                                        <div class="theme-color-dot" style="background: ${theme.colors.secondary}"></div>
                                        <div class="theme-color-dot" style="background: ${theme.colors.light}"></div>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <!-- Selector de colores individuales -->
                <p style="margin: 20px 0 10px; font-weight: 600;">Colores personalizados:</p>
                <div class="color-picker-container">
                    ${Object.entries(ConfigModule.currentConfig.colors).map(([key, value]) => `
                        <div class="color-option" onclick="App.openColorPicker('${key}', '${value}')">
                            <div class="color-preview ${'color-' + key}" style="background: ${value}"></div>
                            <div class="color-name">${key}</div>
                            <div class="color-value">${value}</div>
                        </div>
                    `).join('')}
                </div>
                
                <!-- Inputs de color personalizados -->
                <div class="custom-color-inputs">
                    <div class="color-input-group">
                        <label>Color Primario:</label>
                        <div class="color-input-wrapper">
                            <input type="color" class="color-input" value="${ConfigModule.currentConfig.colors.primary}" 
                                   onchange="ConfigModule.currentConfig.colors.primary = this.value; ConfigModule.applyConfig(); ConfigModule.saveConfig();">
                            <input type="text" class="color-hex-input" value="${ConfigModule.currentConfig.colors.primary}" 
                                   onchange="ConfigModule.currentConfig.colors.primary = this.value; ConfigModule.applyConfig(); ConfigModule.saveConfig();">
                        </div>
                    </div>
                    
                    <div class="color-input-group">
                        <label>Color Secundario:</label>
                        <div class="color-input-wrapper">
                            <input type="color" class="color-input" value="${ConfigModule.currentConfig.colors.secondary}" 
                                   onchange="ConfigModule.currentConfig.colors.secondary = this.value; ConfigModule.applyConfig(); ConfigModule.saveConfig();">
                            <input type="text" class="color-hex-input" value="${ConfigModule.currentConfig.colors.secondary}" 
                                   onchange="ConfigModule.currentConfig.colors.secondary = this.value; ConfigModule.applyConfig(); ConfigModule.saveConfig();">
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Configuración de Nombre y Logo -->
            <div class="config-group">
                <h4><i class="fas fa-font"></i> Nombre y Logo</h4>
                
                <!-- Nombre de la App -->
                <div class="form-group">
                    <label class="form-label">Nombre de la Aplicación</label>
                    <input type="text" class="form-input" id="config-app-name" 
                           value="${ConfigModule.currentConfig.appName}"
                           onchange="ConfigModule.setAppName(this.value)">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Nombre Corto (para PWA)</label>
                    <input type="text" class="form-input" id="config-app-shortname" 
                           value="${ConfigModule.currentConfig.appShortName}"
                           onchange="ConfigModule.currentConfig.appShortName = this.value">
                </div>
                
                <!-- Selector de Logo -->
                <div style="margin: 20px 0;">
                    <p style="margin-bottom: 10px; font-weight: 600;">Logo de la App:</p>
                    
                    <!-- Emojis -->
                    <div>
                        <p style="margin-bottom: 10px; color: var(--gray); font-size: 0.9rem;">Selecciona un emoji:</p>
                        <div class="emoji-grid">
                            ${ConfigModule.emojis.map(emoji => `
                                <div class="emoji-option ${ConfigModule.currentConfig.logoEmoji === emoji ? 'active' : ''}" 
                                     onclick="ConfigModule.setLogoEmoji('${emoji}')">
                                    ${emoji}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    
                    <!-- Logo personalizado -->
<div style="margin-top: 20px;">
    <p style="margin-bottom: 10px; color: var(--gray); font-size: 0.9rem;">O sube una imagen:</p>
    <div class="logo-upload-container" onclick="document.getElementById('logo-upload').click()">
        <i class="fas fa-cloud-upload-alt"></i>
        <p>Haz clic para subir un logo</p>
        <p style="font-size: 0.8rem; color: var(--gray);">PNG, JPG o SVG (recomendado 512x512, máximo 2MB)</p>
        <input type="file" id="logo-upload" accept="image/*" style="display: none;" 
               onchange="App.handleLogoUpload(this.files[0])">
        ${ConfigModule.currentConfig.logoImage ? `
            <div class="logo-preview">
                <img src="${ConfigModule.currentConfig.logoImage}" alt="Logo actual" 
                     onerror="this.style.display='none'">
            </div>
        ` : ''}
    </div>
    ${ConfigModule.currentConfig.logoImage ? `
        <button class="btn btn-outline" onclick="ConfigModule.currentConfig.logoType='emoji'; ConfigModule.currentConfig.logoImage=null; ConfigModule.applyLogo(); App.updateConfigUI();" 
                style="margin-top: 10px; width: 100%;">
            <i class="fas fa-times"></i> Quitar imagen y usar emoji
        </button>
    ` : ''}
</div>
                </div>
            </div>
            
            <!-- Acciones -->
            <div class="config-group">
                <h4><i class="fas fa-tools"></i> Acciones</h4>
                <div class="config-actions">
                    <button class="btn btn-primary" onclick="ConfigModule.saveConfig()">
                        <i class="fas fa-save"></i> Guardar Cambios
                    </button>
                    <button class="btn btn-outline" onclick="App.exportConfig()">
                        <i class="fas fa-download"></i> Exportar Config
                    </button>
                    <button class="btn btn-outline" onclick="document.getElementById('config-import').click()">
                        <i class="fas fa-upload"></i> Importar Config
                    </button>
                    <input type="file" id="config-import" accept=".json" style="display: none;" 
                           onchange="App.importConfig(this.files[0])">
                </div>
                <div style="margin-top: 15px;">
                    <button class="btn btn-danger" onclick="ConfigModule.resetToDefault()" style="width: 100%;">
                        <i class="fas fa-undo"></i> Restaurar Valores por Defecto
                    </button>
                </div>
            </div>
            
            <!-- Depuración -->
            <div class="config-group">
                <h4><i class="fas fa-bug"></i> Depuración</h4>
                <p style="margin-bottom: 15px; color: var(--gray); font-size: 0.9rem;">
                    <i class="fas fa-info-circle"></i> Herramientas para diagnosticar problemas en la app
                </p>
                <div class="config-actions">
                    <button class="btn btn-outline" onclick="showErrorLog()" style="width: 100%; margin-bottom: 10px;">
                        <i class="fas fa-list"></i> Ver Log de Errores
                    </button>
                    <button class="btn btn-outline" onclick="clearErrorLog()" style="width: 100%; margin-bottom: 10px;">
                        <i class="fas fa-trash"></i> Limpiar Log
                    </button>
                    <button class="btn btn-success" onclick="PushNotifications.test()" style="width: 100%;">
                        <i class="fas fa-bell"></i> Probar Notificaciones Push
                    </button>
                </div>
            </div>
            
            <!-- Zona de Peligro -->
            <div class="config-group" style="border: 2px solid var(--danger); border-radius: 12px; padding: 20px;">
                <h4 style="color: var(--danger);"><i class="fas fa-exclamation-triangle"></i> Zona de Peligro</h4>
                <p style="color: var(--gray); font-size: 0.9rem; margin-bottom: 15px;">
                    Estas acciones son irreversibles. Todos tus datos serán eliminados permanentemente.
                </p>
                ${window.AuthManager && window.AuthManager.isAuthenticated() ? `
                <button class="btn btn-danger" onclick="App.confirmDeleteAccount()" style="width: 100%;">
                    <i class="fas fa-user-times"></i> Eliminar mi cuenta y datos
                </button>
                ` : `
                <p style="color: var(--gray); font-size: 0.9rem;">
                    <i class="fas fa-info-circle"></i> Debes iniciar sesión en la nube para eliminar tu cuenta.
                </p>
                `}
            </div>
            
            <!-- Vista Previa (solo escritorio) -->
            <div class="config-preview" id="config-preview">
                <h5><i class="fas fa-eye"></i> Vista Previa</h5>
                <div class="preview-item">
                    <div class="preview-color" style="background: ${ConfigModule.currentConfig.colors.primary}"></div>
                    <span>Color Primario</span>
                </div>
                <div class="preview-item">
                    <div class="preview-color" style="background: ${ConfigModule.currentConfig.colors.secondary}"></div>
                    <span>Color Secundario</span>
                </div>
                <div class="preview-item">
                    <div class="preview-color" style="background: ${ConfigModule.currentConfig.colors.light}"></span>
                    <span>Fondo Claro</span>
                </div>
            </div>
        </div>
    `;
    
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        mainContent.innerHTML = html;
        
        // Mostrar vista previa solo en escritorio
        if (window.innerWidth > 768) {
            setTimeout(() => {
                const preview = document.getElementById('config-preview');
                if (preview) preview.style.display = 'block';
            }, 500);
        }
    }
},


// Métodos auxiliares para configuración
openColorPicker(colorName, currentValue) {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = currentValue;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.appendChild(input);
    input.click();
    input.addEventListener('change', () => {
        const newValue = input.value;
        if (newValue && newValue !== currentValue) {
            ConfigModule.currentConfig.colors[colorName] = newValue;
            ConfigModule.applyConfig();
            ConfigModule.saveConfig();
            App.updateConfigUI();
        }
        document.body.removeChild(input);
    });
    input.addEventListener('blur', () => {
        setTimeout(() => document.body.contains(input) && document.body.removeChild(input), 500);
    });
},

updateConfigUI() {
    // Actualizar inputs de color
    Object.entries(ConfigModule.currentConfig.colors).forEach(([key, value]) => {
        const colorInputs = document.querySelectorAll(`input[value="${value}"]`);
        colorInputs.forEach(input => {
            if (input.type === 'color' || input.type === 'text') {
                input.value = value;
            }
        });
    });
    
    // Actualizar tema activo
    document.querySelectorAll('.theme-option').forEach(option => {
        option.classList.remove('active');
    });
    const activeTheme = document.querySelector(`.theme-option[onclick*="${ConfigModule.currentConfig.theme}"]`);
    if (activeTheme) activeTheme.classList.add('active');
    
    // Actualizar emoji activo
    document.querySelectorAll('.emoji-option').forEach(option => {
        option.classList.remove('active');
        if (option.textContent.trim() === ConfigModule.currentConfig.logoEmoji) {
            option.classList.add('active');
        }
    });
    
    // Actualizar vista previa
    const preview = document.getElementById('config-preview');
    if (preview) {
        preview.querySelectorAll('.preview-color')[0].style.background = ConfigModule.currentConfig.colors.primary;
        preview.querySelectorAll('.preview-color')[1].style.background = ConfigModule.currentConfig.colors.secondary;
        preview.querySelectorAll('.preview-color')[2].style.background = ConfigModule.currentConfig.colors.light;
    }
},

async confirmDeleteAccount() {
    // Modal de confirmación con texto que el usuario debe escribir
    const html = `
        <div class="modal active" id="delete-account-modal">
            <div class="modal-content" style="max-width: 420px;">
                <div class="modal-header" style="background: var(--danger); color: white;">
                    <h3><i class="fas fa-exclamation-triangle"></i> Eliminar cuenta</h3>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 15px;">Esta acción es <strong>irreversible</strong>. Se eliminarán:</p>
                    <ul style="margin: 0 0 20px 20px; color: var(--gray); font-size: 0.9rem;">
                        <li>Tu cuenta de usuario</li>
                        <li>Todos tus clientes, ventas, pedidos y gastos</li>
                        <li>Historial de pagos y créditos</li>
                        <li>Datos de merma y diezmos</li>
                        <li>Configuración y backups en la nube</li>
                    </ul>
                    <p style="margin-bottom: 10px; font-weight: 600;">Escribe <span style="color: var(--danger);">ELIMINAR</span> para confirmar:</p>
                    <input type="text" id="delete-confirm-input" class="form-input" placeholder="ELIMINAR" autocomplete="off">
                    <div style="display: flex; gap: 10px; margin-top: 20px;">
                        <button class="btn btn-outline" onclick="document.getElementById('delete-account-modal').remove()" style="flex: 1;">
                            Cancelar
                        </button>
                        <button class="btn btn-danger" id="delete-confirm-btn" onclick="App.executeDeleteAccount()" style="flex: 1;" disabled>
                            <i class="fas fa-trash"></i> Eliminar todo
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);

    const input = document.getElementById('delete-confirm-input');
    const btn = document.getElementById('delete-confirm-btn');
    input.addEventListener('input', () => {
        btn.disabled = input.value.trim() !== 'ELIMINAR';
    });
    input.focus();
},

async executeDeleteAccount() {
    const modal = document.getElementById('delete-account-modal');
    if (modal) modal.remove();

    Utils.showLoading(true);
    try {
        await window.AuthManager.deleteAccount();
        Utils.showLoading(false);
        Utils.showNotification('Cuenta eliminada correctamente', 'success', 3000);
        setTimeout(() => window.location.reload(), 2000);
    } catch (error) {
        Utils.showLoading(false);
        Utils.showNotification('Error al eliminar la cuenta: ' + error.message, 'error', 5000);
    }
},

handleLogoUpload(file) {
    if (!file) return;
    
    const validTypes = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        Utils.showNotification('Formato no valido. Usa JPG, PNG, SVG o GIF', 'error', 5000);
        return;
    }
    
    if (file.size > 2 * 1024 * 1024) {
        Utils.showNotification('La imagen es muy grande. Máximo 2MB', 'error', 5000);
        return;
    }
    
    Utils.showLoading(true);
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const imageData = e.target.result;
        
        const img = new Image();
        img.onload = () => {
            let finalImageData = imageData;
            
            if (img.width > 512 || img.height > 512) {
                finalImageData = this.resizeImage(img, 512, 512);
            }
            
            ConfigModule.currentConfig.logoType = 'image';
            ConfigModule.currentConfig.logoImage = finalImageData;
            ConfigModule.currentConfig.logoEmoji = null;
            
            ConfigModule.applyLogo();
            ConfigModule.saveConfig();
            
            this.updateLogoPreview(finalImageData);
            
            Utils.showLoading(false);
            Utils.showNotification('Logo actualizado y guardado correctamente', 'success', 3000);
        };
        
        img.onerror = () => {
            Utils.showLoading(false);
            Utils.showNotification('Error al cargar la imagen', 'error', 5000);
        };
        
        img.src = imageData;
    };
    
    reader.onerror = () => {
        Utils.showLoading(false);
        Utils.showNotification('Error al leer el archivo', 'error', 5000);
    };
    
    reader.readAsDataURL(file);
},

// Método para redimensionar imagen
resizeImage(img, maxWidth, maxHeight) {
    const canvas = document.createElement('canvas');
    let width = img.width;
    let height = img.height;
    
    // Calcular nuevas dimensiones manteniendo proporción
    if (width > height) {
        if (width > maxWidth) {
            height = Math.round(height * maxWidth / width);
            width = maxWidth;
        }
    } else {
        if (height > maxHeight) {
            width = Math.round(width * maxHeight / height);
            height = maxHeight;
        }
    }
    
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    
    return canvas.toDataURL('image/png', 0.9);
},

// Método para actualizar vista previa del logo
updateLogoPreview(imageData) {
    const uploadContainer = document.querySelector('.logo-upload-container');
    if (!uploadContainer) return;
    
    // Remover vista previa anterior
    const oldPreview = uploadContainer.querySelector('.logo-preview');
    if (oldPreview) oldPreview.remove();
    
    // Crear nueva vista previa
    const previewDiv = document.createElement('div');
    previewDiv.className = 'logo-preview';
    
    const img = document.createElement('img');
    img.src = imageData;
    img.alt = 'Logo preview';
    img.style.maxWidth = '200px';
    img.style.maxHeight = '80px';
    img.style.borderRadius = '8px';
    img.style.display = 'block';
    img.style.margin = '20px auto';
    
    previewDiv.appendChild(img);
    uploadContainer.appendChild(previewDiv);
},


exportConfig() {
    ConfigModule.exportConfig();
},

async importConfig(file) {
    if (!file) return;
    
    try {
        await ConfigModule.importConfig(file);
        Utils.showNotification('Configuración importada correctamente', 'success', 3000);
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    } catch (error) {
        Utils.showNotification('Error al importar configuración: ' + error.message, 'error', 5000);
    }
},

async cleanDuplicatePayments() {
    try {
        Utils.showLoading(true);
        const count = await PaymentHistoryModule.removeDuplicates();
        
        if (count > 0) {
            // Subir los datos limpios al servidor para sincronizar
            if (window.SyncEngine && window.AuthManager?.isAuthenticated()) {
                console.log('📤 Subiendo historial limpio al servidor...');
                try {
                    await SyncEngine.uploadAllData('paymentHistory', PaymentHistoryModule.payments);
                    console.log('✅ Historial limpio sincronizado con el servidor');
                } catch (error) {
                    console.error('❌ Error sincronizando con servidor:', error);
                }
            }
            
            Utils.showLoading(false);
            
            // Recargar la pagina actual para reflejar los cambios
            if (this.currentPage === 'payment-history') {
                this.loadPaymentHistoryPage();
            } else {
                this.loadPage(this.currentPage);
            }
        } else {
            Utils.showLoading(false);
            Utils.showNotification('No se encontraron pagos duplicados', 'info', 3000);
        }
    } catch (error) {
        console.error('Error al limpiar duplicados:', error);
        Utils.showLoading(false);
        Utils.showNotification('Error al limpiar pagos duplicados', 'error', 3000);
    }
},

    // Pagina Dashboard (ACTUALIZADA con mapa)
    loadDashboardPage() {
        const todaySales = SalesModule.getTodaySales();
        const todayIncome = todaySales.reduce((sum, sale) => sum + sale.total, 0);
        const todayWeight = SalesModule.getTotalWeightByDate(this.currentDate);
        const pendingOrders = OrdersModule.getPendingOrders().length;
        
        const html = `
            <div class="page active" id="dashboard-page">
                <h2><i class="fas fa-home"></i> Dashboard</h2>
                <p style="margin: 10px 0 20px; color: var(--gray);">Resumen general del negocio</p>
                
                <div class="dashboard-stats">
                    <div class="dashboard-card">
                        <div class="dashboard-icon">
                            <i class="fas fa-cash-register"></i>
                        </div>
                        <div class="dashboard-info">
                            <h3>Ventas Hoy</h3>
                            <div class="dashboard-value">${todaySales.length}</div>
                            <div class="dashboard-subtitle">${Utils.formatCurrency(todayIncome)}</div>
                        </div>
                    </div>
                    
                    <div class="dashboard-card">
                        <div class="dashboard-icon">
                            <i class="fas fa-weight"></i>
                        </div>
                        <div class="dashboard-info">
                            <h3>Libras Vendidas</h3>
                            <div class="dashboard-value">${todayWeight.toFixed(2)} lb</div>
                            <div class="dashboard-subtitle">Promedio: ${SalesModule.getAverageWeightByDate(this.currentDate).toFixed(2)} lb/pollo</div>
                        </div>
                    </div>
                    
                    <div class="dashboard-card">
                        <div class="dashboard-icon">
                            <i class="fas fa-clipboard-list"></i>
                        </div>
                        <div class="dashboard-info">
                            <h3>Pedidos Pendientes</h3>
                            <div class="dashboard-value">${pendingOrders}</div>
                            <div class="dashboard-subtitle">Requieren atención</div>
                        </div>
                    </div>
                    
                    <div class="dashboard-card">
                        <div class="dashboard-icon">
                            <i class="fas fa-users"></i>
                        </div>
                        <div class="dashboard-info">
                            <h3>Clientes Activos</h3>
                            <div class="dashboard-value">${[...new Set(todaySales.map(sale => sale.clientId))].length}</div>
                            <div class="dashboard-subtitle">Hoy</div>
                        </div>
                    </div>
                </div>
                
                <!-- NUEVO: Mapa reducido en Dashboard -->
                <div class="card" style="margin-bottom: 20px;">
                    <h3><i class="fas fa-map-marked-alt"></i> Mapa de Entregas</h3>
                    <p style="margin: 5px 0 15px; color: var(--gray); font-size: 0.9rem;">
                        ${pendingOrders > 0 ? 
                          `${pendingOrders} pedidos pendientes para entrega` : 
                          'No hay pedidos pendientes'}
                    </p>
                    <div id="mapa-dashboard" style="height: 250px; width: 100%; border-radius: 8px; overflow: hidden; margin-top: 10px;"></div>
                    <div style="margin-top: 15px; display: flex; gap: 10px;">
                        <button class="btn btn-outline" onclick="App.loadPage('rutas')" style="flex: 1;">
                            <i class="fas fa-route"></i> Ver Ruta Completa
                        </button>
                        <button class="btn btn-outline" onclick="App.loadPage('orders')" style="flex: 1;">
                            <i class="fas fa-plus"></i> Agregar Pedido
                        </button>
                    </div>
                </div>
                
                <div class="quick-actions">
                    <div class="quick-action-btn" onclick="App.loadPage('sales')">
                        <i class="fas fa-plus-circle"></i>
                        <span>Nueva Venta</span>
                    </div>
                    <div class="quick-action-btn" onclick="App.loadPage('orders')">
                        <i class="fas fa-clipboard-list"></i>
                        <span>Nuevo Pedido</span>
                    </div>
                    <div class="quick-action-btn" onclick="App.loadPage('clients')">
                        <i class="fas fa-user-plus"></i>
                        <span>Agregar Cliente</span>
                    </div>
                    <div class="quick-action-btn" onclick="App.loadPage('merma')">
                        <i class="fas fa-calculator"></i>
                        <span>Calcular Merma</span>
                    </div>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-history"></i> Actividad Reciente</h3>
                    <div style="margin-top: 15px;">
                        ${this.getRecentActivity()}
                    </div>
                </div>
            </div>
        `;

        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = html;
            
            // Inicializar mapa del dashboard después de un breve delay
            setTimeout(() => {
                this.inicializarMapaDashboard();
            }, 300);
        }
    },

    // NUEVO: Inicializar mapa del dashboard
    inicializarMapaDashboard() {
        const pedidosPendientes = OrdersModule.getPendingOrders();
        
        if (pedidosPendientes.length === 0) {
            const mapaElement = document.getElementById('mapa-dashboard');
            if (mapaElement) {
                mapaElement.innerHTML = `
                    <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--gray);">
                        <i class="fas fa-route" style="font-size: 3rem; margin-bottom: 10px; opacity: 0.5;"></i>
                        <p>No hay pedidos pendientes</p>
                        <button class="btn btn-outline" onclick="App.loadPage('orders')" style="margin-top: 15px;">
                            <i class="fas fa-plus"></i> Crear primer pedido
                        </button>
                    </div>
                `;
            }
            return;
        }
        
        // Si ya hay un mapa, actualizarlo
        if (this.mapaDashboardInicializado) {
            this.actualizarMapaDashboard();
        } else {
            // Crear nuevo mapa
            const mapaElement = document.getElementById('mapa-dashboard');
            if (!mapaElement) return;
            
            // Limpiar contenido previo
            mapaElement.innerHTML = '';
            
            // Crear contenedor para Leaflet
            const mapContainer = document.createElement('div');
            mapContainer.style.width = '100%';
            mapContainer.style.height = '100%';
            mapaElement.appendChild(mapContainer);
            
            // Inicializar mapa con ubicación actual o por defecto
            let mapa;
            
            // Obtener clientes con coordenadas primero
            const clientesConCoordenadas = pedidosPendientes
                .map(pedido => {
                    const cliente = ClientsModule.getClientById(pedido.clientId);
                    return cliente && cliente.coordinates ? {
                        ...cliente,
                        pedidoId: pedido.id,
                        pedidoStatus: pedido.status,
                        peso: pedido.weight,
                        cantidad: pedido.quantity
                    } : null;
                })
                .filter(cliente => cliente !== null);
            
            if (clientesConCoordenadas.length === 0) {
                mapaElement.innerHTML = `
                    <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--gray);">
                        <i class="fas fa-map-marker-alt" style="font-size: 3rem; margin-bottom: 10px; opacity: 0.5;"></i>
                        <p>Los clientes no tienen ubicación</p>
                    </div>
                `;
                return;
            }
            
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        mapa = L.map(mapContainer).setView([position.coords.latitude, position.coords.longitude], 12);
                        this.configurarMapaDashboard(mapa, clientesConCoordenadas);
                    },
                    (error) => {
                        mapa = L.map(mapContainer).setView([19.4326, -99.1332], 12);
                        this.configurarMapaDashboard(mapa, clientesConCoordenadas);
                    }
                );
            } else {
                mapa = L.map(mapContainer).setView([19.4326, -99.1332], 12);
                this.configurarMapaDashboard(mapa, clientesConCoordenadas);
            }
        }
    },

    // Método auxiliar para configurar el mapa del dashboard
    configurarMapaDashboard(mapa, clientesConCoordenadas) {
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(mapa);
            
        // Obtener clientes con coordenadas
        if (clientesConCoordenadas.length === 0) {
            return;
        }
            
        // Ordenar por proximidad
        const rutaOptimizada = RutasModule.optimizarRuta(clientesConCoordenadas);
            
        // Agregar marcadores
        const marcadores = [];
        const coordenadas = [];
            
        rutaOptimizada.forEach((cliente, index) => {
            if (cliente.coordinates && cliente.coordinates.lat) {
                // Determinar color según estado del pedido
                let colorIcono = 'var(--primary)';
                if (cliente.pedidoStatus === 'delivered') {
                    colorIcono = 'var(--success)';
                } else if (cliente.pedidoStatus === 'cancelled') {
                    colorIcono = 'var(--danger)';
                }
                    
                    // Crear marcador con número
                    const icon = L.divIcon({
                        className: 'numero-marcador',
                        html: `
                            <div style="
                                background: ${colorIcono}; 
                                color: white; 
                                width: 24px; 
                                height: 24px; 
                                border-radius: 50%; 
                                display: flex; 
                                align-items: center; 
                                justify-content: center; 
                                font-weight: bold; 
                                border: 2px solid white;
                                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                            ">
                                ${index + 1}
                            </div>
                        `,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    });
                    
                    const marker = L.marker([cliente.coordinates.lat, cliente.coordinates.lng], { icon })
                        .addTo(mapa)
                        .bindPopup(`
                            <div style="min-width: 180px;">
                                <b>${index + 1}. ${Utils.escapeHtml(cliente.name)}</b><br>
                                <small>${Utils.escapeHtml(cliente.address)}</small><br>
                                <hr style="margin: 5px 0;">
                                <strong>Pedido:</strong> ${cliente.peso.toFixed(2)} lb • ${cliente.cantidad} pollos<br>
                                <strong>Estado:</strong> <span class="order-status ${cliente.pedidoStatus}">${OrdersModule.getStatusText(cliente.pedidoStatus)}</span>
                            </div>
                        `);
                    
                    marcadores.push(marker);
                    coordenadas.push([cliente.coordinates.lat, cliente.coordinates.lng]);
                }
            });
            
            // Dibujar línea que conecta los puntos
            if (coordenadas.length >= 2) {
                L.polyline(coordenadas, {
                    color: 'var(--primary)',
                    weight: 2,
                    opacity: 0.7,
                    dashArray: '5, 5'
                }).addTo(mapa);
            }
            
            // Ajustar vista para mostrar todos los marcadores
            if (marcadores.length > 0) {
                const group = new L.featureGroup(marcadores);
                mapa.fitBounds(group.getBounds().pad(0.1));
            }
            
            // Guardar referencia al mapa
            this.mapaDashboard = mapa;
            this.mapaDashboardInicializado = true;
            this.marcadoresDashboard = marcadores;
            this.polylineDashboard = coordenadas.length >= 2 ? true : false;
    },

    // NUEVO: Actualizar mapa del dashboard
    actualizarMapaDashboard() {
        if (!this.mapaDashboard || !this.mapaDashboardInicializado) {
            this.inicializarMapaDashboard();
            return;
        }
        
        const pedidosPendientes = OrdersModule.getPendingOrders();
        
        if (pedidosPendientes.length === 0) {
            const mapaElement = document.getElementById('mapa-dashboard');
            if (mapaElement && this.mapaDashboard) {
                this.mapaDashboard.remove();
                this.mapaDashboard = null;
                this.mapaDashboardInicializado = false;
                
                mapaElement.innerHTML = `
                    <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--gray);">
                        <i class="fas fa-route" style="font-size: 3rem; margin-bottom: 10px; opacity: 0.5;"></i>
                        <p>No hay pedidos pendientes</p>
                        <button class="btn btn-outline" onclick="App.loadPage('orders')" style="margin-top: 15px;">
                            <i class="fas fa-plus"></i> Crear primer pedido
                        </button>
                    </div>
                `;
            }
            return;
        }
        
        // Limpiar marcadores anteriores
        if (this.marcadoresDashboard) {
            this.marcadoresDashboard.forEach(marker => {
                if (this.mapaDashboard && marker) {
                    this.mapaDashboard.removeLayer(marker);
                }
            });
        }
        
        // Obtener clientes con coordenadas
        const clientesConCoordenadas = pedidosPendientes
            .map(pedido => {
                const cliente = ClientsModule.getClientById(pedido.clientId);
                return cliente && cliente.coordinates ? {
                    ...cliente,
                    pedidoId: pedido.id,
                    pedidoStatus: pedido.status,
                    peso: pedido.weight,
                    cantidad: pedido.quantity
                } : null;
            })
            .filter(cliente => cliente !== null);
        
        if (clientesConCoordenadas.length === 0) {
            const mapaElement = document.getElementById('mapa-dashboard');
            if (mapaElement && this.mapaDashboard) {
                this.mapaDashboard.remove();
                this.mapaDashboard = null;
                this.mapaDashboardInicializado = false;
                
                mapaElement.innerHTML = `
                    <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--gray);">
                        <i class="fas fa-map-marker-alt" style="font-size: 3rem; margin-bottom: 10px; opacity: 0.5;"></i>
                        <p>Los clientes no tienen ubicación</p>
                    </div>
                `;
            }
            return;
        }
        
        // Ordenar por proximidad
        const rutaOptimizada = RutasModule.optimizarRuta(clientesConCoordenadas);
        
        // Agregar nuevos marcadores
        this.marcadoresDashboard = [];
        const coordenadas = [];
        
        rutaOptimizada.forEach((cliente, index) => {
            if (cliente.coordinates && cliente.coordinates.lat) {
                // Determinar color según estado del pedido
                let colorIcono = 'var(--primary)';
                if (cliente.pedidoStatus === 'delivered') {
                    colorIcono = 'var(--success)';
                } else if (cliente.pedidoStatus === 'cancelled') {
                    colorIcono = 'var(--danger)';
                }
                
                // Crear marcador con número
                const icon = L.divIcon({
                    className: 'numero-marcador',
                    html: `
                        <div style="
                            background: ${colorIcono}; 
                            color: white; 
                            width: 24px; 
                            height: 24px; 
                            border-radius: 50%; 
                            display: flex; 
                            align-items: center; 
                            justify-content: center; 
                            font-weight: bold; 
                            border: 2px solid white;
                            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                        ">
                            ${index + 1}
                        </div>
                    `,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                });
                
                const marker = L.marker([cliente.coordinates.lat, cliente.coordinates.lng], { icon })
                    .addTo(this.mapaDashboard)
                    .bindPopup(`
                        <div style="min-width: 180px;">
                            <b>${index + 1}. ${Utils.escapeHtml(cliente.name)}</b><br>
                            <small>${Utils.escapeHtml(cliente.address)}</small><br>
                            <hr style="margin: 5px 0;">
                            <strong>Pedido:</strong> ${cliente.peso.toFixed(2)} lb • ${cliente.cantidad} pollos<br>
                            <strong>Estado:</strong> <span class="order-status ${cliente.pedidoStatus}">${OrdersModule.getStatusText(cliente.pedidoStatus)}</span>
                        </div>
                    `);
                
                this.marcadoresDashboard.push(marker);
                coordenadas.push([cliente.coordinates.lat, cliente.coordinates.lng]);
            }
        });
        
        // Limpiar polyline anterior
        if (this.polylineDashboard) {
            this.mapaDashboard.eachLayer(layer => {
                if (layer instanceof L.Polyline) {
                    this.mapaDashboard.removeLayer(layer);
                }
            });
        }
        
        // Dibujar nueva línea que conecta los puntos
        if (coordenadas.length >= 2) {
            L.polyline(coordenadas, {
                color: 'var(--primary)',
                weight: 2,
                opacity: 0.7,
                dashArray: '5, 5'
            }).addTo(this.mapaDashboard);
            this.polylineDashboard = true;
        }
        
        // Ajustar vista para mostrar todos los marcadores
        if (this.marcadoresDashboard.length > 0) {
            const group = new L.featureGroup(this.marcadoresDashboard);
            this.mapaDashboard.fitBounds(group.getBounds().pad(0.1));
        }
    },

    getRecentActivity() {
        const sales = SalesModule.sales.slice(-5).reverse();
        const orders = OrdersModule.orders.slice(-5).reverse();
        
        const allActivity = [...sales, ...orders]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 5);
        
        if (allActivity.length === 0) {
            return '<p class="empty-state">No hay actividad reciente</p>';
        }
        
        let html = '';
        allActivity.forEach(activity => {
            // Verificar que ClientsModule esté disponible
            if (typeof ClientsModule === 'undefined' || !ClientsModule.getClientById) {
                return; // Saltar si el módulo no esta listo
            }
            
            const client = ClientsModule.getClientById(activity.clientId);
            const clientName = client ? client.name : 'Cliente desconocido';
            
            if (activity.hasOwnProperty('status')) {
                // Es un pedido
                html += `
                    <div style="padding: 10px; border-bottom: 1px solid #eee;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong><i class="fas fa-clipboard-list"></i> ${clientName}</strong>
                                <div style="font-size: 0.9rem; color: var(--gray);">
                                    Pedido ${OrdersModule.getStatusText ? OrdersModule.getStatusText(activity.status) : activity.status} - ${activity.weight} lb
                                </div>
                            </div>
                            <div style="color: var(--gray); font-size: 0.8rem;">
                                ${activity.createdTime || activity.time}
                            </div>
                        </div>
                    </div>
                `;
            } else {
                // Es una venta
                html += `
                    <div style="padding: 10px; border-bottom: 1px solid #eee;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong><i class="fas fa-cash-register"></i> ${clientName}</strong>
                                <div style="font-size: 0.9rem; color: var(--gray);">
                                    Venta - ${Utils.formatCurrency(activity.total)}
                                </div>
                            </div>
                            <div style="color: var(--gray); font-size: 0.8rem;">
                                ${activity.time}
                            </div>
                        </div>
                    </div>
                `;
            }
        });
        
        return html || '<p class="empty-state">No hay actividad reciente</p>';
    },

    // Pagina de Ventas
    loadSalesPage() {
        const html = `
            <div class="page active" id="sales-page">
                <h2><i class="fas fa-cash-register"></i> Registro de Ventas</h2>
                <p style="margin: 10px 0 20px; color: var(--gray);">Registra las ventas de pollos pelados</p>
                
                <div class="date-filter">
                    <input type="date" class="date-input" id="sales-date-filter" value="${this.currentDate}">
                    <button class="btn btn-outline" onclick="App.filterSalesByDate()">
                        <i class="fas fa-filter"></i> Filtrar
                    </button>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-plus-circle"></i> Nueva Venta</h3>
                    ${(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? `
                    <div id="auto-sale-status-bar" style="width:100%;margin-bottom:15px;padding:14px;background:var(--light);border-radius:10px;font-size:0.95rem;border:2px solid var(--border);">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <i class="fas fa-robot" style="font-size:1.3rem;color:var(--primary);"></i>
                            <div style="flex:1;">
                                <div style="font-weight:600;">Venta automática en segundo plano</div>
                                <small style="color:var(--gray);">${BluetoothScale.isConnected ? 'Balanza conectada — pesando en segundo plano' : 'Conecta la balanza para activar'}</small>
                            </div>
                            <label class="switch" style="margin:0;" onclick="event.stopPropagation()">
                                <input type="checkbox" id="auto-sale-toggle"
                                       ${localStorage.getItem('autoSale.enabled') === '1' ? 'checked' : ''}
                                       onchange="App._onAutoSaleToggle(this.checked)">
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div style="margin-top:8px;">
                            <button type="button" class="btn btn-outline" style="width:100%;font-size:0.85rem;padding:8px;" onclick="App.startChainWeighing()">
                                <i class="fas fa-weight"></i> Abrir modo pesaje manual
                            </button>
                        </div>
                    </div>` : `
                    <button type="button" class="btn btn-primary" style="width:100%;margin-bottom:15px;padding:14px;font-size:1rem;" onclick="App.startChainWeighing()">
                        <i class="fas fa-weight"></i> Modo Pesaje en Cadena
                        <small style="display:block;font-size:0.8rem;opacity:0.85;margin-top:2px;">${BluetoothScale.isConnected ? 'Balanza conectada — captura automatica' : 'Ingresa pesos manualmente uno por uno'}</small>
                    </button>`}
                    <form id="sale-form">
                        <div class="form-group">
                            <label class="form-label" for="sale-date">Fecha de la Venta</label>
                            <input type="date" class="form-input" id="sale-date" value="${this.currentDate}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="sale-client">Cliente</label>
                            <div style="display: flex; gap: 10px;">
                                <select class="form-input" id="sale-client" required style="flex: 1;">
                                    <option value="">Seleccionar cliente</option>
                                </select>
                                <button type="button" class="btn btn-outline" onclick="App.toggleQuickClientForm()" 
                                        style="padding: 10px 15px; white-space: nowrap;">
                                    <i class="fas fa-user-plus"></i>
                                </button>
                            </div>
                        </div>
                        
                        <!-- Formulario rapido de cliente (oculto por defecto) -->
                        <div id="quick-client-form" style="display: none; background: var(--light); padding: 15px; border-radius: 8px; margin: 15px 0; box-sizing: border-box; width: 100%;">
                            <h4 style="margin: 0 0 12px 0; color: var(--primary); font-size: 0.95rem;">
                                <i class="fas fa-user-plus"></i> Agregar Cliente Rapido
                            </h4>
                            <div class="form-group" style="margin-bottom: 10px;">
                                <input type="text" class="form-input" id="quick-client-name" placeholder="Nombre" style="width: 100%; box-sizing: border-box;">
                            </div>
                            <div class="form-group" style="margin-bottom: 10px;">
                                <input type="tel" class="form-input" id="quick-client-phone" placeholder="Telefono" style="width: 100%; box-sizing: border-box;">
                            </div>
                            <div class="form-group" style="margin-bottom: 12px;">
                                <input type="text" class="form-input" id="quick-client-address" placeholder="Direccion" style="width: 100%; box-sizing: border-box;">
                            </div>
                            <div style="display: flex; gap: 10px;">
                                <button type="button" class="btn btn-primary" onclick="App.saveQuickClient()" style="flex: 1; min-width: 0;">
                                    <i class="fas fa-save"></i> Guardar
                                </button>
                                <button type="button" class="btn btn-outline" onclick="App.toggleQuickClientForm()" style="flex: 1; min-width: 0;">
                                    <i class="fas fa-times"></i> Cancelar
                                </button>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label" for="sale-weight">Peso Total (lb)</label>
                            <div style="display:flex; gap:8px; align-items:center;">
                                <input type="number" step="0.01" min="0.01" class="form-input" id="sale-weight" required 
                                       placeholder="Ej: 45.5" oninput="App.updateSalePreview()" style="flex:1;">
                                <button type="button" class="btn btn-outline scale-capture-btn" 
                                        onclick="BluetoothScale.captureWeight('sale-weight')"
                                        style="display:none; padding:10px 12px; white-space:nowrap;" title="Capturar peso de balanza">
                                    <i class="fas fa-weight"></i>
                                </button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="sale-quantity">Cantidad de Pollos</label>
                            <input type="number" min="1" class="form-input" id="sale-quantity" required 
                                   placeholder="Ej: 10" oninput="App.updateSalePreview()">
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="sale-price">Precio por lb ($)</label>
                            <input type="number" step="0.01" min="0" class="form-input" id="sale-price" 
                                   placeholder="Dejar vacío para usar precio de merma" oninput="App.updateSalePreview()">
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label" for="sale-cost">
                                Costo por lb ($) 
                                <i class="fas fa-info-circle" style="color: var(--gray); cursor: help;" 
                                   title="Opcional: Para pollos pelados con costo diferente a la merma"></i>
                            </label>
                            <input type="number" step="0.01" min="0" class="form-input" id="sale-cost" 
                                   placeholder="Dejar vacío para usar costo de merma" oninput="App.updateSalePreview()">
                            <small style="color: var(--gray); display: block; margin-top: 5px;">
                                <i class="fas fa-drumstick-bite"></i> Usa este campo solo para pollos pelados con costo directo
                            </small>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label" for="sale-payment-method">Método de Pago</label>
                            <select class="form-input" id="sale-payment-method" required onchange="App.toggleInitialPayment()">
                                <option value="cash">Efectivo (Pagado)</option>
                                <option value="credit">Crédito (A deber)</option>
                            </select>
                        </div>
                        
                        <div class="form-group" id="initial-payment-group" style="display: none;">
                            <label class="form-label" for="sale-initial-payment">Abono Inicial (Entrada)</label>
                            <input type="number" step="0.01" min="0" class="form-input" id="sale-initial-payment" 
                                   placeholder="Monto del abono inicial" oninput="App.updateSalePreview()">
                            <small style="color: var(--gray); display: block; margin-top: 5px;">
                                <i class="fas fa-info-circle"></i> Opcional: Deja vacío si no hay abono inicial
                            </small>
                        </div>
                        
                        <!-- VISTA PREVIA EN TIEMPO REAL -->
                        <div id="sale-preview" style="background: var(--light); padding: 15px; border-radius: 8px; margin: 15px 0; display: none;">
                            <h4 style="margin: 0 0 10px 0; color: var(--primary);"><i class="fas fa-eye"></i> Vista Previa</h4>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.9rem;">
                                <div>
                                    <strong>Peso Promedio:</strong><br>
                                    <span id="preview-avg-weight" style="color: var(--primary); font-size: 1.1rem; font-weight: bold;">0.00 lb/pollo</span>
                                </div>
                                <div>
                                    <strong>Precio por lb:</strong><br>
                                    <span id="preview-price" style="color: var(--secondary); font-size: 1.1rem; font-weight: bold;">$0.00</span>
                                </div>
                                <div>
                                    <strong>Costo por lb:</strong><br>
                                    <span id="preview-cost" style="color: var(--warning); font-size: 1.1rem; font-weight: bold;">$0.00</span>
                                </div>
                                <div>
                                    <strong>Ganancia por lb:</strong><br>
                                    <span id="preview-profit" style="color: var(--success); font-size: 1.1rem; font-weight: bold;">$0.00</span>
                                </div>
                            </div>
                            <hr style="margin: 10px 0; border: none; border-top: 1px solid #ddd;">
                            <div style="text-align: center;">
                                <strong style="font-size: 0.9rem; color: var(--gray);">TOTAL A COBRAR</strong><br>
                                <span id="preview-total" style="color: var(--success); font-size: 2rem; font-weight: bold;">$0.00</span>
                            </div>
                            <div style="text-align: center; margin-top: 10px;">
                                <strong style="font-size: 0.9rem; color: var(--gray);">GANANCIA TOTAL</strong><br>
                                <span id="preview-total-profit" style="color: var(--primary); font-size: 1.5rem; font-weight: bold;">$0.00</span>
                            </div>
                        </div>
                        
                        <button type="submit" class="btn btn-primary" style="width: 100%;">
                            <i class="fas fa-save"></i> Registrar Venta
                        </button>
                    </form>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-list"></i> Ventas del ${this.currentDate}</h3>
                    <ul class="sales-list" id="sales-list">
                        <!-- Las ventas se agregaran aquí dinamicamente -->
                    </ul>
                </div>
            </div>
        `;

        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = html;
            ClientsModule.updateClientSelect();
            SalesModule.updateSalesList(this.currentDate);
            
            // Configurar formulario de venta
            const saleForm = document.getElementById('sale-form');
            if (saleForm) {
                saleForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.addSale();
                });
            }
            
            // Configurar filtro de fecha
            const dateFilter = document.getElementById('sales-date-filter');
            if (dateFilter) {
                dateFilter.addEventListener('change', (e) => {
                    this.currentDate = e.target.value;
                });
            }
            
            // Inicializar select personalizado
            setTimeout(() => {
                if (typeof CustomSelect !== 'undefined') {
                    CustomSelect.init('sale-client', {
                        placeholder: 'Seleccionar cliente',
                        searchPlaceholder: 'Buscar cliente...'
                    });
                    CustomSelect.init('sale-payment-method', {
                        placeholder: 'Método de pago'
                    });
                }
            }, 100);
        }
    },

    // Pagina de Pedidos
    loadOrdersPage() {
        // Limpiar cualquier modal huérfano antes de cargar
        document.querySelectorAll('.modal.active').forEach(m => {
            if (!m.querySelector('.modal-content')) m.remove();
        });
        const html = `
            <div class="page active" id="orders-page">
                <h2><i class="fas fa-clipboard-list"></i> Gestión de Pedidos</h2>
                <p style="margin: 10px 0 20px; color: var(--gray);">Registra y gestiona pedidos de clientes</p>
                
                <div class="order-status-filter">
                    <button class="status-btn active" onclick="App.filterOrders('all')">Todos</button>
                    <button class="status-btn" onclick="App.filterOrders('pending')">Pendientes</button>
                    <button class="status-btn" onclick="App.filterOrders('delivered')">Entregados</button>
                    <button class="status-btn" onclick="App.filterOrders('cancelled')">Cancelados</button>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-plus-circle"></i> Nuevo Pedido</h3>
                    <form id="order-form">
                        <div class="form-group">
                            <label class="form-label" for="order-client">Cliente</label>
                            <div style="display: flex; gap: 10px;">
                                <select class="form-input" id="order-client" required style="flex: 1;">
                                    <option value="">Seleccionar cliente</option>
                                </select>
                                <button type="button" class="btn btn-outline" onclick="App.toggleQuickClientFormOrder()" 
                                        style="padding: 10px 15px; white-space: nowrap;">
                                    <i class="fas fa-user-plus"></i>
                                </button>
                            </div>
                        </div>
                        
                        <!-- Formulario rxpido de cliente -->
                        <div id="quick-client-form-order" style="display: none; background: var(--light); padding: 15px; border-radius: 8px; margin: 15px 0; box-sizing: border-box; width: 100%;">
                            <h4 style="margin: 0 0 12px 0; color: var(--primary); font-size: 0.95rem;">
                                <i class="fas fa-user-plus"></i> Agregar Cliente Rapido
                            </h4>
                            <div class="form-group" style="margin-bottom: 10px;">
                                <input type="text" class="form-input" id="quick-client-name-order" placeholder="Nombre" style="width: 100%; box-sizing: border-box;">
                            </div>
                            <div class="form-group" style="margin-bottom: 10px;">
                                <input type="tel" class="form-input" id="quick-client-phone-order" placeholder="Telefono" style="width: 100%; box-sizing: border-box;">
                            </div>
                            <div class="form-group" style="margin-bottom: 12px;">
                                <input type="text" class="form-input" id="quick-client-address-order" placeholder="Direccion" style="width: 100%; box-sizing: border-box;">
                            </div>
                            <div style="display: flex; gap: 10px;">
                                <button type="button" class="btn btn-primary" onclick="App.saveQuickClientOrder()" style="flex: 1; min-width: 0;">
                                    <i class="fas fa-save"></i> Guardar
                                </button>
                                <button type="button" class="btn btn-outline" onclick="App.toggleQuickClientFormOrder()" style="flex: 1; min-width: 0;">
                                    <i class="fas fa-times"></i> Cancelar
                                </button>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label" for="order-weight">Peso Total (lb)</label>
                            <input type="number" step="0.01" min="0.01" class="form-input" id="order-weight" required 
                                   placeholder="Ej: 45.5">
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="order-quantity">Cantidad de Pollos</label>
                            <input type="number" min="1" class="form-input" id="order-quantity" required 
                                   placeholder="Ej: 10">
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="order-price">Precio por lb ($)</label>
                            <input type="number" step="0.01" min="0" class="form-input" id="order-price" 
                                   placeholder="Dejar vacío para usar precio de merma">
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="order-delivery-date">Fecha de Entrega (opcional)</label>
                            <input type="datetime-local" class="form-input" id="order-delivery-date">
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="order-notes">Notas (opcional)</label>
                            <textarea class="form-input" id="order-notes" rows="2" placeholder="Instrucciones especiales..."></textarea>
                        </div>
                        <button type="submit" class="btn btn-primary" style="width: 100%;">
                            <i class="fas fa-save"></i> Registrar Pedido
                        </button>
                    </form>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-list"></i> Lista de Pedidos</h3>
                    <ul class="orders-list" id="orders-list">
                        <!-- Los pedidos se agregaran aquí dinamicamente -->
                    </ul>
                </div>
            </div>
        `;

        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = html;
            ClientsModule.updateClientSelect();
            OrdersModule.updateOrdersList();
            
            // Configurar formulario de pedido
            const orderForm = document.getElementById('order-form');
            if (orderForm) {
                orderForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.addOrder();
                });
            }
            
            // Inicializar select personalizado
            setTimeout(() => {
                if (typeof CustomSelect !== 'undefined') {
                    CustomSelect.init('order-client', {
                        placeholder: 'Seleccionar cliente',
                        searchPlaceholder: 'Buscar cliente...'
                    });
                }
            }, 100);
        }
    },

    // Pagina de Clientes
    loadClientsPage() {
        const html = `
            <div class="page active" id="clients-page">
                <h2><i class="fas fa-users"></i> Gestión de Clientes</h2>
                <p style="margin: 10px 0 20px; color: var(--gray);">Agrega nuevos clientes con ubicación</p>
                
                <div class="card">
                    <h3><i class="fas fa-user-plus"></i> Agregar Cliente</h3>
                    
                    <form id="client-form">
                        <div class="form-group">
                            <label class="form-label" for="client-name">Nombre</label>
                            <input type="text" class="form-input" id="client-name" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="client-phone">Teléfono</label>
                            <input type="tel" class="form-input" id="client-phone" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="client-address">Dirección</label>
                            <input type="text" class="form-input" id="client-address" required>
                        </div>
                        <div class="location-info">
                            <i class="fas fa-map-marker-alt location-icon"></i>
                            <span id="current-location">Obteniendo ubicación actual...</span>
                            <button type="button" class="btn btn-outline" onclick="App.openMapModal()" 
                                    style="margin-left: auto; padding: 5px 10px; font-size: 0.8rem;">
                                <i class="fas fa-map"></i> Seleccionar en Mapa
                            </button>
                        </div>
                        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 15px;">
                            <i class="fas fa-save"></i> Guardar Cliente
                        </button>
                    </form>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-list"></i> Lista de Clientes</h3>
                    
                    <!-- Buscador de clientes -->
                    <div class="form-group" style="margin-bottom: 15px;">
                        <div style="position: relative;">
                            <input type="text" class="form-input" id="client-search" 
                                   placeholder="Buscar por nombre, teléfono o dirección..." 
                                   style="padding-left: 40px;">
                            <i class="fas fa-search" style="position: absolute; left: 15px; top: 50%; transform: translateY(-50%); color: var(--gray);"></i>
                        </div>
                        <small style="color: var(--gray); display: block; margin-top: 5px;">
                            <span id="client-count">0 clientes</span> • 
                            <span id="client-filtered" style="display: none;">0 encontrados</span>
                        </small>
                    </div>
                    
                    <ul class="client-list" id="client-list">
                        <!-- Los clientes se agregaran aquí dinamicamente -->
                    </ul>
                </div>
            </div>
        `;

        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = html;
            ClientsModule.updateClientList();
            
            // Obtener ubicación actual
            this.getCurrentLocation();
            
            // Configurar formulario de cliente
            const clientForm = document.getElementById('client-form');
            if (clientForm) {
                clientForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.addClient();
                });
            }
            
            // Configurar buscador de clientes
            const searchInput = document.getElementById('client-search');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    this.filterClients(e.target.value);
                });
            }
        }
    },

    // Pagina de Merma
    loadMermaPage() {
        const todayMermaPrice = MermaModule.getTodayMermaPrice();
        const selectedMermaRecord = MermaModule.getMermaRecordByDate(this.currentDate);
        
        const html = `
            <div class="page active" id="merma-page">
                <h2><i class="fas fa-calculator"></i> Calculo de Merma</h2>
                <p style="margin: 10px 0 20px; color: var(--gray);">Calcula el costo real por lb de pollo pelado</p>

                <!-- Días pendientes del mes -->
                <div class="card">
                    <h3><i class="fas fa-calendar-check"></i> Días del mes</h3>
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
                        <input type="month" class="form-input" id="merma-month-filter"
                               value="${this.currentDate.substring(0,7)}"
                               style="max-width:180px;"
                               onchange="App.renderMermaDaysList(this.value)">
                        <span style="font-size:0.85rem; color:var(--gray);">Selecciona el mes a revisar</span>
                    </div>
                    <div id="merma-days-list"></div>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-chart-line"></i> Datos de Producción</h3>
                    <form id="merma-form">
                        <div class="form-group">
                            <label class="form-label" for="merma-date">Fecha del Calculo</label>
                            <input type="date" class="form-input" id="merma-date" value="${this.currentDate}" required>
                            <small style="color: var(--gray); display: block; margin-top: 5px;">
                                <i class="fas fa-info-circle"></i> Puedes calcular merma de días anteriores
                            </small>
                        </div>
                        <div class="merma-form">
                            <div class="form-group">
                                <label class="form-label" for="live-weight">Peso total pollos vivos (lb)</label>
                                <div style="display:flex; gap:8px; align-items:center;">
                                    <input type="number" step="0.01" min="0" class="form-input" id="live-weight"
                                           placeholder="Dejar vacío para calcular" oninput="App.updateMermaPreview()" 
                                           value="${selectedMermaRecord ? selectedMermaRecord.liveWeight : ''}" style="flex:1;">
                                    <button type="button" class="btn btn-outline scale-capture-btn"
                                            onclick="BluetoothScale.captureWeight('live-weight')"
                                            style="display:none; padding:10px 12px;" title="Capturar peso de balanza">
                                        <i class="fas fa-weight"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="live-cost">Costo por lb pollo vivo ($)</label>
                                <input type="number" step="0.01" min="0" class="form-input" id="live-cost"
                                       placeholder="Dejar vacío para calcular" oninput="App.updateMermaPreview()"
                                       value="${selectedMermaRecord ? selectedMermaRecord.liveCost : ''}">
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="processed-weight">Peso total pollos pelados (lb)</label>
                                <div style="display:flex; gap:8px; align-items:center;">
                                    <input type="number" step="0.01" min="0" class="form-input" id="processed-weight"
                                           placeholder="Dejar vacío para calcular" oninput="App.updateMermaPreview()"
                                           value="${selectedMermaRecord ? selectedMermaRecord.processedWeight : ''}" style="flex:1;">
                                    <button type="button" class="btn btn-outline scale-capture-btn"
                                            onclick="BluetoothScale.captureWeight('processed-weight')"
                                            style="display:none; padding:10px 12px;" title="Capturar peso de balanza">
                                        <i class="fas fa-weight"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="chicken-count">Cantidad de pollos procesados</label>
                                <input type="number" min="1" class="form-input" id="chicken-count" required
                                       placeholder="Número de pollos" oninput="App.updateMermaPreview()"
                                       value="${selectedMermaRecord ? selectedMermaRecord.chickenCount : ''}">
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="processing-cost-per-chicken">Costo por pelar cada pollo ($)</label>
                                <input type="number" step="0.01" min="0" class="form-input" id="processing-cost-per-chicken"
                                       placeholder="Dejar vacío para calcular" oninput="App.updateMermaPreview()"
                                       value="${selectedMermaRecord ? selectedMermaRecord.processingCostPerChicken : ''}">
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="real-cost-per-lb">Costo real por lb ($) - Opcional</label>
                                <input type="number" step="0.01" min="0" class="form-input" id="real-cost-per-lb"
                                       placeholder="Dejar vacío para calcular" oninput="App.updateMermaPreview()"
                                       value="${selectedMermaRecord ? selectedMermaRecord.realCostPerLb : ''}">
                                <small style="color: var(--gray); display: block; margin-top: 5px;">
                                    <i class="fas fa-info-circle"></i> Puedes dejar vacío cualquier campo excepto "Cantidad de pollos"
                                </small>
                            </div>
                            <div class="form-group" style="background:linear-gradient(135deg,#e8f5e9,#f1f8e9);padding:15px;border-radius:10px;border:2px solid var(--primary);">
                                <label class="form-label" for="sale-price-per-lb" style="color:var(--primary);font-weight:700;">
                                    <i class="fas fa-tag"></i> Precio de venta por lb ($) — Precio del día
                                </label>
                                <input type="number" step="0.01" min="0" class="form-input" id="sale-price-per-lb"
                                       placeholder="Ej: 1.20" 
                                       value="${MermaModule.getTodaySalePrice() || (selectedMermaRecord ? selectedMermaRecord.salePrice || '' : '')}"
                                       style="font-size:1.2rem;font-weight:bold;">
                                <small style="color:var(--primary);display:block;margin-top:5px;">
                                    <i class="fas fa-bolt"></i> Este precio se usara automaticamente en todas las ventas del día
                                </small>
                            </div>
                        </div>
                        
                        <!-- VISTA PREVIA EN TIEMPO REAL -->
                        <div id="merma-preview" style="background: linear-gradient(135deg, var(--light) 0%, #e8f5e9 100%); padding: 20px; border-radius: 12px; margin: 20px 0; display: none; border: 2px solid var(--primary);">
                            <h4 style="margin: 0 0 15px 0; color: var(--primary); text-align: center;">
                                <i class="fas fa-eye"></i> Vista Previa del Calculo
                            </h4>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
                                <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                    <div style="color: var(--gray); font-size: 0.85rem; margin-bottom: 5px;">
                                        <i class="fas fa-percentage"></i> Merma
                                    </div>
                                    <div id="preview-merma-percent" style="color: var(--danger); font-size: 1.8rem; font-weight: bold;">0%</div>
                                </div>
                                <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                    <div style="color: var(--gray); font-size: 0.85rem; margin-bottom: 5px;">
                                        <i class="fas fa-dollar-sign"></i> Costo Real/lb
                                    </div>
                                    <div id="preview-real-cost" style="color: var(--primary); font-size: 1.8rem; font-weight: bold;">$0.00</div>
                                </div>
                                <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                    <div style="color: var(--gray); font-size: 0.85rem; margin-bottom: 5px;">
                                        <i class="fas fa-chart-line"></i> Pérdida
                                    </div>
                                    <div id="preview-loss-amount" style="color: var(--warning); font-size: 1.8rem; font-weight: bold;">$0.00</div>
                                </div>
                                <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                    <div style="color: var(--gray); font-size: 0.85rem; margin-bottom: 5px;">
                                        <i class="fas fa-calculator"></i> Costo Total
                                    </div>
                                    <div id="preview-total-cost" style="color: var(--secondary); font-size: 1.8rem; font-weight: bold;">$0.00</div>
                                </div>
                            </div>
                            <div style="margin-top: 15px; padding: 12px; background: rgba(76, 175, 80, 0.1); border-radius: 8px; text-align: center;">
                                <div style="color: var(--gray); font-size: 0.85rem; margin-bottom: 5px;">Libras Perdidas</div>
                                <div id="preview-weight-loss" style="color: var(--primary); font-size: 1.3rem; font-weight: bold;">0.00 lb</div>
                            </div>
                        </div>
                        
                        <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 15px;">
                            <i class="fas fa-calculator"></i> ${selectedMermaRecord ? 'Actualizar' : 'Calcular y Guardar'} Merma
                        </button>
                        ${selectedMermaRecord ? `
                            <p style="text-align: center; margin-top: 10px; color: var(--success);">
                                <i class="fas fa-check-circle"></i> Ya existe calculo para ${this.currentDate}
                            </p>
                        ` : ''}
                    </form>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-history"></i> Historial de Merma</h3>
                    <div id="merma-history-list">
                        ${this.getMermaHistoryHTML()}
                    </div>
                </div>
            </div>
        `;

        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = html;
            
            // Configurar formulario de merma
            const mermaForm = document.getElementById('merma-form');
            if (mermaForm) {
                mermaForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.calculateAndSaveMerma();
                });
            }
            
            // NUEVO: Listener para cambio de fecha - solo actualiza currentDate
            const dateInput = document.getElementById('merma-date');
            if (dateInput) {
                dateInput.addEventListener('change', (e) => {
                    this.currentDate = e.target.value;
                    // Recargar pagina para mostrar datos de la nueva fecha
                    this.loadMermaPage();
                });
            }
            
            // Actualizar vista previa si hay datos
            if (selectedMermaRecord) {
                setTimeout(() => this.updateMermaPreview(), 100);
            }

            // Renderizar lista de días del mes
            this.renderMermaDaysList(this.currentDate.substring(0, 7));
        }
    },

    // Lista de días del mes con estado de merma calculada
    renderMermaDaysList(yearMonth) {
        const container = document.getElementById('merma-days-list');
        if (!container) return;

        const today = Utils.getTodayDate();
        const parts = yearMonth.split('-');
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);

        const lastDay = new Date(year, month, 0).getDate();
        const days = [];

        for (let d = 1; d <= lastDay; d++) {
            const dateStr = yearMonth + '-' + String(d).padStart(2, '0');
            if (dateStr > today) break;
            const record = MermaModule.getMermaRecordByDate(dateStr);
            const hasSales = SalesModule.getSalesByDate(dateStr).length > 0;
            days.push({ date: dateStr, record, hasSales });
        }

        if (days.length === 0) {
            container.innerHTML = '<p style="color:var(--gray); font-size:0.9rem; text-align:center; padding:10px;">No hay días registrados en este mes.</p>';
            return;
        }

        const pending = days.filter(function(d) { return !d.record; }).length;
        const done = days.filter(function(d) { return d.record; }).length;
        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sab'];

        let html = '<div style="display:flex; gap:12px; margin-bottom:14px; flex-wrap:wrap;">'
            + '<span style="display:flex; align-items:center; gap:6px; font-size:0.85rem;"><span style="width:12px; height:12px; border-radius:50%; background:var(--success); display:inline-block;"></span>Calculada (' + done + ')</span>'
            + '<span style="display:flex; align-items:center; gap:6px; font-size:0.85rem;"><span style="width:12px; height:12px; border-radius:50%; background:var(--danger); display:inline-block;"></span>Pendiente (' + pending + ')</span>'
            + '<span style="display:flex; align-items:center; gap:6px; font-size:0.85rem;"><span style="width:12px; height:12px; border-radius:50%; background:var(--gray); display:inline-block; opacity:0.4;"></span>Sin ventas</span>'
            + '</div>'
            + '<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:6px;">';

        for (let i = 0; i < days.length; i++) {
            const day = days[i];
            const dayName = dayNames[new Date(day.date + 'T12:00:00').getDay()];
            const dayNum = day.date.split('-')[2];
            const isToday = day.date === today;
            const todayBadge = isToday ? '<span style="font-size:0.75rem; background:var(--primary); color:white; padding:2px 8px; border-radius:10px;">Hoy</span>' : '';

            if (day.record) {
                const price = day.record.realCostPerLb ? Utils.formatCurrency(day.record.realCostPerLb) + '/lb' : '';
                html += '<li style="display:flex; align-items:center; gap:12px; padding:10px 14px; border-radius:8px; background:#E8F5E9; border-left:4px solid var(--success);">'
                    + '<span style="font-weight:700; min-width:42px; color:var(--success);">' + dayName + ' ' + dayNum + '</span>'
                    + '<span style="flex:1; font-size:0.88rem; color:#2e7d32;"><i class="fas fa-check-circle"></i> Merma calculada' + (price ? ' — ' + price : '') + '</span>'
                    + todayBadge
                    + '</li>';
            } else if (day.hasSales) {
                html += '<li onclick="App.goToMermaDate(\'' + day.date + '\')" style="display:flex; align-items:center; gap:12px; padding:10px 14px; border-radius:8px; background:#FFEBEE; border-left:4px solid var(--danger); cursor:pointer;">'
                    + '<span style="font-weight:700; min-width:42px; color:var(--danger);">' + dayName + ' ' + dayNum + '</span>'
                    + '<span style="flex:1; font-size:0.88rem; color:#c62828;"><i class="fas fa-exclamation-circle"></i> Pendiente — toca para calcular</span>'
                    + todayBadge
                    + '<i class="fas fa-chevron-right" style="color:var(--danger); font-size:0.8rem;"></i>'
                    + '</li>';
            } else {
                html += '<li style="display:flex; align-items:center; gap:12px; padding:10px 14px; border-radius:8px; background:#f5f5f5; border-left:4px solid #ccc; opacity:0.6;">'
                    + '<span style="font-weight:700; min-width:42px; color:var(--gray);">' + dayName + ' ' + dayNum + '</span>'
                    + '<span style="flex:1; font-size:0.88rem; color:var(--gray);"><i class="fas fa-minus-circle"></i> Sin ventas</span>'
                    + todayBadge
                    + '</li>';
            }
        }

        html += '</ul>';
        container.innerHTML = html;
    },

    // Navegar a merma con fecha preseleccionada
    goToMermaDate(date) {
        this.currentDate = date;
        this.loadMermaPage();
        // Scroll al formulario
        setTimeout(() => {
            const form = document.getElementById('merma-form');
            if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
    },

    // Actualizar vista previa de merma en tiempo real
    updateMermaPreview() {
        if (this._updatingMerma) return;
        this._updatingMerma = true;
        
        const preview = document.getElementById('merma-preview');
        if (!preview) {
            this._updatingMerma = false;
            return;
        }
        
        try {
            const liveWeightEl = document.getElementById('live-weight');
            const liveCostEl = document.getElementById('live-cost');
            const processedWeightEl = document.getElementById('processed-weight');
            const chickenCountEl = document.getElementById('chicken-count');
            const processingCostEl = document.getElementById('processing-cost-per-chicken');
            const realCostEl = document.getElementById('real-cost-per-lb');
            
            if (!liveWeightEl || !liveCostEl || !processedWeightEl || !chickenCountEl || !processingCostEl) {
                this._updatingMerma = false;
                return;
            }
            
            const liveWeight = liveWeightEl.value.trim() ? parseFloat(liveWeightEl.value) : null;
            const liveCost = liveCostEl.value.trim() ? parseFloat(liveCostEl.value) : null;
            const processedWeight = processedWeightEl.value.trim() ? parseFloat(processedWeightEl.value) : null;
            const chickenCount = chickenCountEl.value.trim() ? parseInt(chickenCountEl.value) : 0;
            const processingCostPerChicken = processingCostEl.value.trim() ? parseFloat(processingCostEl.value) : null;
            const realCostPerLb = realCostEl && realCostEl.value.trim() ? parseFloat(realCostEl.value) : null;
        
            // Mostrar vista previa solo si hay datos suficientes
            const filledValues = [liveWeight, liveCost, processedWeight, processingCostPerChicken, realCostPerLb].filter(v => v != null && v > 0).length;
            
            if (filledValues < 4 || chickenCount === 0) {
                preview.style.display = 'none';
                this._updatingMerma = false;
                return;
            }
            
            preview.style.display = 'block';
            
            const totalProcessingCost = processingCostPerChicken != null
                ? chickenCount * processingCostPerChicken
                : null;
            const result = MermaModule.calculateMerma(liveWeight, liveCost, processedWeight, totalProcessingCost, realCostPerLb);
                
            // Mostrar indicador si se dedujo un valor
            let deducedMessage = '';
            if (result.deducedValue) {
                const labels = {
                    liveWeight: 'Peso vivo',
                    liveCost: 'Costo por lb vivo',
                    processedWeight: 'Peso pelado',
                    processingCost: 'Costo de procesamiento',
                    realCostPerLb: 'Costo real por lb'
                };
                deducedMessage = `<div style="background: #E3F2FD; padding: 10px; border-radius: 8px; margin-bottom: 15px; text-align: center;">
                    <i class="fas fa-calculator" style="color: var(--primary);"></i> 
                    <strong style="color: var(--primary);">${labels[result.deducedValue]}</strong> calculado automaticamente
                </div>`;
            }
            
            preview.innerHTML = `
                <h4 style="margin: 0 0 15px 0; color: var(--primary); text-align: center;">
                    <i class="fas fa-eye"></i> Vista Previa del Calculo
                </h4>
                ${deducedMessage}
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px;">
                    <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <div style="color: var(--gray); font-size: 0.85rem; margin-bottom: 5px;">
                            <i class="fas fa-percentage"></i> Merma
                        </div>
                        <div style="color: ${result.merma > 20 ? 'var(--danger)' : result.merma > 10 ? 'var(--warning)' : 'var(--success)'}; font-size: 1.8rem; font-weight: bold;">${result.merma}%</div>
                    </div>
                    <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <div style="color: var(--gray); font-size: 0.85rem; margin-bottom: 5px;">
                            <i class="fas fa-dollar-sign"></i> Costo Real/lb
                        </div>
                        <div style="color: var(--primary); font-size: 1.8rem; font-weight: bold;">$${result.realCostPerLb.toFixed(2)}</div>
                    </div>
                    <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <div style="color: var(--gray); font-size: 0.85rem; margin-bottom: 5px;">
                            <i class="fas fa-chart-line"></i> Pérdida
                        </div>
                        <div style="color: var(--warning); font-size: 1.8rem; font-weight: bold;">$${result.lossAmount.toFixed(2)}</div>
                    </div>
                    <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <div style="color: var(--gray); font-size: 0.85rem; margin-bottom: 5px;">
                            <i class="fas fa-calculator"></i> Costo Total
                        </div>
                        <div style="color: var(--secondary); font-size: 1.8rem; font-weight: bold;">$${result.totalCost.toFixed(2)}</div>
                    </div>
                </div>
                <div style="margin-top: 15px; padding: 12px; background: rgba(76, 175, 80, 0.1); border-radius: 8px; text-align: center;">
                    <div style="color: var(--gray); font-size: 0.85rem; margin-bottom: 5px;">Libras Perdidas</div>
                    <div style="color: var(--primary); font-size: 1.3rem; font-weight: bold;">${(result.liveWeight - result.processedWeight).toFixed(2)} lb</div>
                </div>
                <div style="margin-top: 15px; padding: 12px; background: #fff3cd; border-radius: 8px; font-size: 0.85rem; color: #856404;">
                    <strong><i class="fas fa-info-circle"></i> Fórmula aplicada:</strong><br>
                    Costo real/lb = (${result.liveWeight.toFixed(2)} lb × $${result.liveCost.toFixed(2)} + $${result.processingCost.toFixed(2)}) ÷ ${result.processedWeight.toFixed(2)} lb pelado<br>
                    = ($${(result.liveWeight * result.liveCost).toFixed(2)} + $${result.processingCost.toFixed(2)}) ÷ ${result.processedWeight.toFixed(2)}<br>
                    = <strong>$${result.realCostPerLb.toFixed(4)}/lb</strong>
                </div>
            `;
        } catch (error) {
            console.error('Error en updateMermaPreview:', error);
            preview.innerHTML = `
                <div style="background: #FFEBEE; padding: 15px; border-radius: 8px; text-align: center; color: var(--danger);">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 10px;"></i>
                    <p style="margin: 0; font-weight: bold;">${error.message}</p>
                </div>
            `;
        } finally {
            this._updatingMerma = false;
        }
    },

    // Pagina de Estadísticas
    loadStatsPage() {
        const html = `
            <div class="page active" id="stats-page">
                <h2><i class="fas fa-chart-line"></i> Estadísticas de Ventas</h2>
                <p style="margin: 10px 0 20px; color: var(--gray);">Resumen de ventas y rendimiento</p>
                
                <div class="date-filter">
                    <input type="date" class="date-input" id="stats-date-filter" value="${this.currentDate}">
                    <button class="btn btn-outline" onclick="App.filterStatsByDate()">
                        <i class="fas fa-filter"></i> Filtrar
                    </button>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-label">Ventas</div>
                        <div class="stat-value" id="sales-today">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Ingresos</div>
                        <div class="stat-value" id="income-today">$0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Libras Totales</div>
                        <div class="stat-value" id="weight-today">0 lb</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Pollos Totales</div>
                        <div class="stat-value" id="total-quantity-today">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Peso Promedio</div>
                        <div class="stat-value" id="average-weight-today">0 lb</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Clientes</div>
                        <div class="stat-value" id="active-clients">0</div>
                    </div>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-layer-group"></i> Desglose por Tipo de Pollo</h3>
                    <div id="chicken-type-breakdown" style="padding: 15px; background: var(--light); border-radius: 8px;">
                        <!-- Desglose se agregará aquí -->
                    </div>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-money-bill-wave"></i> Precio de Merma del Día</h3>
                    <div class="stat-value" id="merma-price-today" style="text-align: center; margin: 10px 0;">
                        No definido
                    </div>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-user-chart"></i> Ventas por Cliente</h3>
                    <ul class="client-list" id="client-stats">
                        <!-- Las estadísticas por cliente se agregaran aquí dinamicamente -->
                    </ul>
                </div>
            </div>
        `;

        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = html;
            StatsModule.updateStats(this.currentDate);
            
            // Configurar filtro de fecha
            const dateFilter = document.getElementById('stats-date-filter');
            if (dateFilter) {
                dateFilter.addEventListener('change', (e) => {
                    this.currentDate = e.target.value;
                });
            }
        }
    },

     // Pagina de Contabilidad
     loadAccountingPage() {
        const html = `
            <div class="page active" id="accounting-page">
                <h2><i class="fas fa-book"></i> Contabilidad</h2>
                <p style="margin: 10px 0 20px; color: var(--gray);">Resumen financiero del dia</p>
                
                <div class="date-filter">
                    <input type="date" class="date-input" id="accounting-date-filter" value="${this.currentDate}">
                    <button class="btn btn-outline" onclick="App.filterAccountingByDate()">
                        <i class="fas fa-filter"></i> Filtrar
                    </button>
                </div>

                <!-- Resumen principal -->
                <div id="accounting-summary">
                    <!-- Se llena dinamicamente -->
                </div>

                <!-- Registrar Gasto -->
                <div class="card">
                    <h3><i class="fas fa-plus-circle"></i> Registrar Gasto</h3>
                    <form id="expense-form">
                        <div class="form-group">
                            <label class="form-label" for="expense-date">Fecha</label>
                            <input type="date" class="form-input" id="expense-date" value="${this.currentDate}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="expense-description">Descripcion</label>
                            <input type="text" class="form-input" id="expense-description" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="expense-amount">Monto ($)</label>
                            <input type="number" step="0.01" min="0.01" class="form-input" id="expense-amount" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="expense-category">Categoria</label>
                            <select class="form-input" id="expense-category" required>
                                <option value="insumos">Insumos</option>
                                <option value="mano_obra">Mano de Obra</option>
                                <option value="transporte">Transporte</option>
                                <option value="materia_prima">Materia Prima</option>
                                <option value="otros">Otros</option>
                            </select>
                        </div>
                        <button type="submit" class="btn btn-primary" style="width: 100%;">
                            <i class="fas fa-save"></i> Registrar Gasto
                        </button>
                    </form>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-list"></i> Gastos del ${this.currentDate}</h3>
                    <button class="btn btn-outline" onclick="console.log('Todos los gastos:', AccountingModule.expenses); Utils.showAlert('Total gastos: ' + AccountingModule.expenses.length + '. Ver consola (F12) para detalles', 'Debug: Gastos', 'info')" style="margin-bottom: 10px; width: 100%;">
                        <i class="fas fa-bug"></i> Debug: Ver Todos los Gastos
                    </button>
                    <ul class="sales-list" id="expenses-list">
                        <!-- Los gastos se agregaran aquí dinamicamente -->
                    </ul>
                </div>
            </div>
        `;

        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = html;
            AccountingModule.updateAccounting(this.currentDate);
            AccountingModule.updateExpensesList(this.currentDate);
            
            // Configurar formulario de gasto
            const expenseForm = document.getElementById('expense-form');
            if (expenseForm) {
                expenseForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.addExpense();
                });
            }
            
            // Configurar filtro de fecha
            const dateFilter = document.getElementById('accounting-date-filter');
            if (dateFilter) {
                dateFilter.addEventListener('change', (e) => {
                    this.currentDate = e.target.value;
                });
            }
            
            // Inicializar select personalizado
            setTimeout(() => {
                if (typeof CustomSelect !== 'undefined') {
                    CustomSelect.init('expense-category', {
                        placeholder: 'Seleccionar categoría'
                    });
                }
            }, 100);
        }
    },

    // Pagina de Backup (NUEVA)
    async loadBackupPage() {
        // IMPORTANTE: Cargar credenciales de forma asíncrona ANTES de verificar
        await BackupModule.loadTelegramConfig();
        
        const stats = BackupModule.getBackupStats();
        const telegramConfigured = BackupModule.telegramBotToken && BackupModule.telegramChatId;
        
        const html = `
            <div class="page active" id="backup-page">
                <h2><i class="fas fa-database"></i> Backup y Restauración</h2>
                <p style="margin: 10px 0 20px; color: var(--gray);">Gestiona copias de seguridad de tus datos</p>
                
                <div class="card">
                    <h3><i class="fas fa-chart-pie"></i> Estadísticas de Datos</h3>
                    <div class="backup-stats">
                        <div class="backup-stat">
                            <div class="stat-label">Clientes</div>
                            <div class="stat-value">${stats.totalClients}</div>
                        </div>
                        <div class="backup-stat">
                            <div class="stat-label">Ventas</div>
                            <div class="stat-value">${stats.totalSales}</div>
                        </div>
                        <div class="backup-stat">
                            <div class="stat-label">Pedidos</div>
                            <div class="stat-value">${stats.totalOrders}</div>
                        </div>
                        <div class="backup-stat">
                            <div class="stat-label">Gastos</div>
                            <div class="stat-value">${stats.totalExpenses}</div>
                        </div>
                        <div class="backup-stat">
                            <div class="stat-label">Precios Merma</div>
                            <div class="stat-value">${stats.totalPrices}</div>
                        </div>
                        <div class="backup-stat">
                            <div class="stat-label">Tamaño Total</div>
                            <div class="stat-value">${stats.totalSize}</div>
                        </div>
                    </div>
                    <p style="text-align: center; margin-top: 10px; color: var(--gray); font-size: 0.9rem;">
                        <i class="fas fa-clock"></i> Último backup: ${stats.lastBackup}
                    </p>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-download"></i> Crear Backup</h3>
                    <p>Crea una copia de seguridad de todos tus datos.</p>
                    <div class="backup-actions">
                        <button class="btn btn-primary" onclick="App.createBackup()">
                            <i class="fas fa-save"></i> Crear Backup
                        </button>
                        <button class="btn btn-outline" onclick="App.exportAsJSON()">
                            <i class="fas fa-file-export"></i> Exportar JSON
                        </button>
                    </div>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-upload"></i> Restaurar Backup</h3>
                    <p>Restaura datos desde un archivo de backup.</p>
                    <div class="backup-actions">
                        <input type="file" id="backup-file" accept=".json" style="display: none;" 
                               onchange="App.restoreFromFile(this.files[0])">
                        <button class="btn btn-warning" onclick="document.getElementById('backup-file').click()">
                            <i class="fas fa-file-import"></i> Seleccionar Archivo
                        </button>
                        <button class="btn btn-danger" onclick="App.clearAllData()">
                            <i class="fas fa-trash"></i> Limpiar Datos
                        </button>
                    </div>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-file-pdf"></i> Generar Reportes</h3>
                    <p>Genera reportes PDF de ventas por período.</p>
                    <div class="backup-actions">
                        <button class="btn btn-success" onclick="App.generateReport()">
                            <i class="fas fa-chart-line"></i> Generar Reporte PDF
                        </button>
                    </div>
                </div>
                
                <div class="card">
                    <h3><i class="fab fa-telegram"></i> Backup a Telegram</h3>
                    ${telegramConfigured ? `
                        <p style="margin-bottom: 15px; color: var(--success);">
                            <i class="fas fa-check-circle"></i> Telegram configurado correctamente
                        </p>
                        <div class="backup-actions">
                            <button class="btn btn-primary" onclick="App.sendBackupToTelegram()">
                                <i class="fab fa-telegram"></i> Enviar Backup
                            </button>
                            <button class="btn btn-outline" onclick="App.testTelegramConnection()">
                                <i class="fas fa-plug"></i> Probar Conexión
                            </button>
                        </div>
                        <div style="margin-top: 10px;">
                            <button class="btn btn-danger" onclick="App.clearTelegramConfig()" style="width: 100%; font-size: 0.9rem;">
                                <i class="fas fa-trash"></i> Eliminar Configuración
                            </button>
                        </div>
                    ` : `
                        <p style="margin-bottom: 15px; color: var(--gray);">
                            <i class="fas fa-info-circle"></i> Configura tu bot de Telegram para enviar backups automaticos
                        </p>
                        
                        <div style="background: var(--card-bg); padding: 15px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid var(--primary);">
                            <h4 style="margin: 0 0 10px 0; font-size: 0.95rem;">Instrucciones:</h4>
                            <ol style="margin: 0; padding-left: 20px; font-size: 0.9rem; line-height: 1.6;">
                                <li>Abre <a href="https://t.me/BotFather" target="_blank" style="color: var(--primary);">@BotFather</a> en Telegram</li>
                                <li>Envía el comando <code>/newbot</code></li>
                                <li>Sigue las instrucciones y copia el <strong>token</strong></li>
                                <li>Abre <a href="https://t.me/userinfobot" target="_blank" style="color: var(--primary);">@userinfobot</a></li>
                                <li>Copia tu <strong>Chat ID</strong></li>
                                <li>Ingresa ambos datos abajo</li>
                            </ol>
                        </div>
                        
                        <div style="margin-bottom: 10px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 500;">
                                <i class="fas fa-key"></i> Bot Token:
                            </label>
                            <input type="text" id="telegram-token" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" 
                                   style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text);">
                        </div>
                        
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 500;">
                                <i class="fas fa-user"></i> Chat ID:
                            </label>
                            <input type="text" id="telegram-chatid" placeholder="123456789" 
                                   style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text);">
                        </div>
                        
                        <button class="btn btn-primary" onclick="App.saveTelegramConfig()" style="width: 100%;">
                            <i class="fas fa-save"></i> Guardar Configuración
                        </button>
                    `}
                </div>
                
                ${telegramConfigured ? `
                <div class="card">
                    <h3><i class="fas fa-robot"></i> Backup Automatico</h3>
                    <p style="margin-bottom: 15px; color: var(--gray);">
                        <i class="fas fa-clock"></i> El backup automatico se ejecuta todos los días a las <strong>10:00 PM</strong>
                    </p>
                    <div style="background: var(--card-bg); padding: 15px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid var(--success);">
                        <p style="margin: 0; font-size: 0.9rem; line-height: 1.6;">
                            El sistema verifica automaticamente si hay cambios en los datos<br>
                            Solo crea backup si detecta cambios (evita duplicados)<br>
                            Usa el mismo método que el backup manual<br>
                            Envía el backup a tu Telegram configurado
                        </p>
                    </div>
                    <button class="btn btn-success" onclick="App.testAutoBackup()" style="width: 100%;">
                        <i class="fas fa-robot"></i> Probar Backup Automatico
                    </button>
                    <p style="margin-top: 10px; text-align: center; color: var(--gray); font-size: 0.85rem;">
                        Este botón ejecuta el mismo backup que se enviara a las 10 PM
                    </p>
                </div>
                ` : ''}
            </div>
        `;
        
        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = html;
        }
    },

    // Pagina de Sincronización en la Nube
    async loadCloudSyncPage() {
        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = await CloudSyncModule.load();
            await CloudSyncModule.init();
        }
    },

    // Pagina de Rutas (MEJORADA)
    loadRutasPage() {
        const html = `
            <div class="page active" id="rutas-page">
                <h2><i class="fas fa-route"></i> Optimización de Rutas</h2>
                <p style="margin: 10px 0 20px; color: var(--gray);">Optimiza las rutas de entrega para clientes</p>
                
                <!-- NUEVO: Mapa permanente siempre visible -->
                <div class="card" style="margin-bottom: 20px;">
                    <h3><i class="fas fa-map-marked-alt"></i> Mapa de Ruta</h3>
                    <div id="mapa-ruta-permanente" style="height: 400px; width: 100%; border-radius: 8px; overflow: hidden; margin-top: 15px;"></div>
                    <div class="controles-mapa">
                        <button class="btn btn-primary" onclick="RutasModule.actualizarMapa()">
                            <i class="fas fa-sync-alt"></i> Actualizar Ruta
                        </button>
                        <button class="btn btn-outline" onclick="RutasModule.generarRutaOptima()">
                            <i class="fas fa-route"></i> Re-optimizar Ruta
                        </button>
                        <button class="btn btn-outline" onclick="RutasModule.limpiarMapa()">
                            <i class="fas fa-trash"></i> Limpiar Mapa
                        </button>
                        <button class="btn btn-outline" onclick="App.loadPage('orders')">
                            <i class="fas fa-plus"></i> Agregar Pedidos
                        </button>
                    </div>
                    <div class="leyenda-colores">
                        <div class="leyenda-item">
                            <div class="leyenda-color pendiente"></div>
                            <span>Pendiente</span>
                        </div>
                        <div class="leyenda-item">
                            <div class="leyenda-color entregado"></div>
                            <span>Entregado</span>
                        </div>
                        <div class="leyenda-item">
                            <div class="leyenda-color cancelado"></div>
                            <span>Cancelado</span>
                        </div>
                    </div>
                </div>
                
                <div class="card" style="margin-bottom: 20px;">
                    <h3><i class="fas fa-directions"></i> Información de la Ruta</h3>
                    <div id="ruta-detalles">
                        <!-- Los detalles de la ruta se mostraran aquí dinamicamente -->
                    </div>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-users"></i> Clientes para Entrega</h3>
                    <div id="clientes-ruta">
                        <!-- Lista de clientes para entrega -->
                    </div>
                </div>
            </div>
        `;

        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = html;
            
            // Inicializar mapa automaticamente al cargar la pagina
            setTimeout(() => {
                RutasModule.inicializarMapa();
                RutasModule.actualizarMapa();
            }, 100);
        }
    },

    // Métodos de negocio
    async getCurrentLocation() {
        try {
            Utils.showLoading(true);
            const location = await LocationModule.getLocation();
            LocationModule.setCurrentLocation(location.address, location.latitude, location.longitude);
            Utils.showNotification('Ubicación obtenida correctamente', 'success', 5000);
        } catch (error) {
            LocationModule.setCurrentLocation(error);
            Utils.showNotification(error, 'error', 5000);
        } finally {
            Utils.showLoading(false);
        }
    },

    async addClient() {
        const name = document.getElementById('client-name');
        const phone = document.getElementById('client-phone');
        const address = document.getElementById('client-address');
        
        if (!name || !phone || !address) {
            Utils.showNotification('Complete todos los campos', 'error', 5000);
            return;
        }

        const nameValue = name.value.trim();
        const phoneValue = phone.value.trim();
        const addressValue = address.value.trim();
        
        if (!nameValue || !phoneValue || !addressValue) {
            Utils.showNotification('Complete todos los campos', 'error', 5000);
            return;
        }
        
        // Verificar duplicados
        const duplicate = ClientsModule.findDuplicate(nameValue, phoneValue, addressValue);
        if (duplicate) {
            const confirmed = await Utils.showDangerConfirm(
                `Ya existe un cliente con datos similares:<br><br>
                <strong>Nombre:</strong> ${Utils.escapeHtml(duplicate.name)}<br>
                <strong>Teléfono:</strong> ${Utils.escapeHtml(duplicate.phone)}<br>
                <strong>Dirección:</strong> ${Utils.escapeHtml(duplicate.address)}<br><br>
                ¿Deseas guardar este cliente de todas formas?`,
                'Cliente Duplicado Detectado',
                'Guardar de Todas Formas'
            );
            
            if (!confirmed) {
                return;
            }
        }
        
        // Usar ubicación seleccionada si existe, si no usar la actual
        let locationData = this.selectedAddress || LocationModule.getCurrentLocation().address;
        let coordinates = this.selectedCoordinates || LocationModule.getCurrentLocation();

        const client = ClientsModule.addClient(nameValue, phoneValue, addressValue, locationData, coordinates);
        ClientsModule.updateClientList();
        ClientsModule.updateClientSelect();
        
        // Limpiar formulario después de guardar exitosamente
        document.getElementById('client-form').reset();
        Utils.showNotification(`Cliente ${nameValue} agregado correctamente`, 'success', 5000);
        
        // Limpiar ubicación seleccionada
        this.selectedCoordinates = null;
        this.selectedAddress = '';
        
        // Actualizar contador
        this.updateClientCount();
    },
    
    filterClients(searchText) {
        const search = searchText.toLowerCase().trim();
        const clientItems = document.querySelectorAll('.client-list .client-item');
        let visibleCount = 0;
        
        clientItems.forEach(item => {
            const name = item.querySelector('.client-name')?.textContent.toLowerCase() || '';
            const phone = item.querySelector('.client-phone')?.textContent.toLowerCase() || '';
            const address = item.querySelector('.client-address')?.textContent.toLowerCase() || '';
            
            const matches = name.includes(search) || phone.includes(search) || address.includes(search);
            
            if (matches) {
                item.style.display = '';
                visibleCount++;
            } else {
                item.style.display = 'none';
            }
        });
        
        // Actualizar contador
        const filteredSpan = document.getElementById('client-filtered');
        if (search) {
            filteredSpan.textContent = `${visibleCount} encontrados`;
            filteredSpan.style.display = 'inline';
        } else {
            filteredSpan.style.display = 'none';
        }
    },
    
    updateClientCount() {
        const countSpan = document.getElementById('client-count');
        if (countSpan) {
            const total = ClientsModule.clients.filter(c => c.isActive !== false).length;
            countSpan.textContent = `${total} cliente${total !== 1 ? 's' : ''}`;
        }
    },

    deleteClient(id) {
        ClientsModule.archiveClient(id);
        ClientsModule.updateClientList();
        ClientsModule.updateClientSelect();
    },

    addSale() {
        const saleDate = document.getElementById('sale-date').value;
        const clientId = parseInt(document.getElementById('sale-client').value);
        const weight = parseFloat(document.getElementById('sale-weight').value);
        const quantity = parseInt(document.getElementById('sale-quantity').value);
        const price = document.getElementById('sale-price').value ? 
                     parseFloat(document.getElementById('sale-price').value) : null;
        const customCost = document.getElementById('sale-cost')?.value ? 
                          parseFloat(document.getElementById('sale-cost').value) : null;
        const paymentMethod = document.getElementById('sale-payment-method').value;
        const initialPayment = document.getElementById('sale-initial-payment').value ? 
                              parseFloat(document.getElementById('sale-initial-payment').value) : 0;

        if (!saleDate) {
            Utils.showNotification('Selecciona una fecha', 'error', 5000);
            return;
        }

        if (!clientId) {
            Utils.showNotification('Selecciona un cliente', 'error', 5000);
            return;
        }

        if (!weight || weight <= 0) {
            Utils.showNotification('Ingrese un peso valido en libras', 'error', 5000);
            return;
        }

        if (!quantity || quantity <= 0) {
            Utils.showNotification('Ingrese una cantidad válida de pollos', 'error', 5000);
            return;
        }

        // Validar abono inicial si es crédito
        if (paymentMethod === 'credit' && initialPayment > 0) {
            const mermaPrice = MermaModule.getTodayMermaPrice();
            const salePrice = price || mermaPrice || 0;
            const total = weight * salePrice;
            
            if (initialPayment > total) {
                Utils.showNotification('El abono inicial no puede ser mayor al total', 'error', 5000);
                return;
            }
        }

        const isPaid = paymentMethod === 'cash';
        const sale = SalesModule.addSale(clientId, weight, quantity, price, saleDate, isPaid, initialPayment, customCost);
        
        // NUEVO: Notificacion automatica ok
        const client = ClientsModule.getClientById(clientId);
        if (client) {
            this.notifyNewSale(sale, client);
        }
        
        document.getElementById('sale-form').reset();
        // Restaurar la fecha al valor actual
        document.getElementById('sale-date').value = this.currentDate;
        // Ocultar vista previa
        const preview = document.getElementById('sale-preview');
        if (preview) preview.style.display = 'none';
        
        SalesModule.updateSalesList(this.currentDate);
        
        // Mostrar recibo
        this.showReceipt(sale.id);
        
        // Actualizar estadísticas y contabilidad
        StatsModule.updateStats(this.currentDate);
        AccountingModule.updateAccounting(this.currentDate);
        
        // NUEVO: Actualizar diezmos automaticamente si estamos en esa pagina
        if (this.currentPage === 'diezmos') {
            this.updateDiezmosPreview();
        }
        
        let paymentStatus = isPaid ? 'Pagado' : 'A Crédito';
        if (!isPaid && initialPayment > 0) {
            paymentStatus = `Crédito con abono de ${Utils.formatCurrency(initialPayment)}`;
        }
        Utils.showNotification(`Venta registrada: ${Utils.formatCurrency(sale.total)} (${paymentStatus})`, 'success', 5000);
        
        // Actualizar badges de créditos
        CreditosModule.updateCreditBadges();
    },

    // NUEVO: Mostrar/ocultar campo de abono inicial
    toggleInitialPayment() {
        const paymentMethod = document.getElementById('sale-payment-method').value;
        const initialPaymentGroup = document.getElementById('initial-payment-group');
        
        if (initialPaymentGroup) {
            if (paymentMethod === 'credit') {
                initialPaymentGroup.style.display = 'block';
            } else {
                initialPaymentGroup.style.display = 'none';
                document.getElementById('sale-initial-payment').value = '';
            }
        }
    },

    // NUEVO: Actualizar vista previa de venta en tiempo real
    // NUEVO: Actualizar vista previa de venta en tiempo real
        updateSalePreview() {
            const weight = parseFloat(document.getElementById('sale-weight').value) || 0;
            const quantity = parseInt(document.getElementById('sale-quantity').value) || 0;
            const priceInput = document.getElementById('sale-price').value;
            const costInput = document.getElementById('sale-cost')?.value;

            const preview = document.getElementById('sale-preview');
            if (!preview) return;

            // Mostrar vista previa solo si hay datos
            if (weight > 0 || quantity > 0) {
                preview.style.display = 'block';
            } else {
                preview.style.display = 'none';
                return;
            }

            // Calcular peso promedio
            const avgWeight = quantity > 0 ? (weight / quantity) : 0;
            document.getElementById('preview-avg-weight').textContent = avgWeight.toFixed(2) + ' lb/pollo';

            // Determinar precio (usar precio ingresado o precio de merma)
            const mermaPrice = MermaModule.getTodayMermaPrice();
            const price = priceInput ? parseFloat(priceInput) : (mermaPrice || 0);

            // Mostrar precio con indicador de origen
            const priceText = priceInput ? 
                `$${price.toFixed(2)}` : 
                (mermaPrice ? `$${price.toFixed(2)} (merma)` : '$0.00 (sin precio)');
            document.getElementById('preview-price').textContent = priceText;

            // Determinar costo (usar costo ingresado o costo de merma)
            const saleDate = document.getElementById('sale-date')?.value || Utils.getTodayDate();
            const mermaRecord = MermaModule.getMermaRecordByDate(saleDate);
            const cost = costInput ? parseFloat(costInput) : (mermaRecord ? mermaRecord.realCostPerLb : 0);

            // Mostrar costo con indicador de origen
            const costText = costInput ? 
                `$${cost.toFixed(2)} (directo)` : 
                (mermaRecord ? `$${cost.toFixed(2)} (merma)` : '$0.00 (sin costo)');
            document.getElementById('preview-cost').textContent = costText;

            // Calcular ganancia por lb
            const profitPerLb = price - cost;
            const profitText = `$${profitPerLb.toFixed(2)}`;
            const profitElement = document.getElementById('preview-profit');
            profitElement.textContent = profitText;
            profitElement.style.color = profitPerLb >= 0 ? 'var(--success)' : 'var(--danger)';

            // Calcular total
            const total = weight * price;
            document.getElementById('preview-total').textContent = Utils.formatCurrency(total);

            // Calcular ganancia total
            const totalProfit = weight * profitPerLb;
            const totalProfitElement = document.getElementById('preview-total-profit');
            totalProfitElement.textContent = Utils.formatCurrency(totalProfit);
            totalProfitElement.style.color = totalProfit >= 0 ? 'var(--primary)' : 'var(--danger)';

            // Cambiar color del total segun si es valido
            const totalElement = document.getElementById('preview-total');
            if (total > 0 && weight > 0 && quantity > 0 && price > 0) {
                totalElement.style.color = 'var(--success)';
            } else {
                totalElement.style.color = 'var(--gray)';
            }
        },

    // NUEVO: Mostrar/ocultar formulario rapido de cliente
    toggleQuickClientForm() {
        const form = document.getElementById('quick-client-form');
        if (!form) return;
        
        if (form.style.display === 'none') {
            form.style.display = 'block';
            form.style.animation = 'fadeIn 0.3s';
            document.getElementById('quick-client-name').focus();
        } else {
            form.style.display = 'none';
            // Limpiar campos
            document.getElementById('quick-client-name').value = '';
            document.getElementById('quick-client-phone').value = '';
            document.getElementById('quick-client-address').value = '';
        }
    },

    // NUEVO: Guardar cliente rapido con ubicación automatica
    async saveQuickClient() {
        const name = document.getElementById('quick-client-name').value.trim();
        const phone = document.getElementById('quick-client-phone').value.trim();
        const address = document.getElementById('quick-client-address').value.trim() || 'Sin dirección';
        
        if (!name || !phone) {
            Utils.showNotification('Ingresa nombre y teléfono', 'error', 3000);
            return;
        }
        
        Utils.showLoading(true);
        
        try {
            // Intentar crear cliente con ubicación automatica
            const client = await ClientsModule.createQuickClient(name, phone);
            
            // Actualizar select de clientes
            ClientsModule.updateClientSelect();
            
            // Seleccionar el nuevo cliente automaticamente
            const clientSelect = document.getElementById('sale-client');
            if (clientSelect) {
                clientSelect.value = client.id;
            }
            
            // Ocultar formularios
            this.toggleQuickClientForm();
            
        } catch (error) {
            Utils.showNotification('Error al crear cliente: ' + error.message, 'error', 3000);
        } finally {
            Utils.showLoading(false);
        }
    },

    // NUEVO: Métodos para formulario rapido en pedidos
    toggleQuickClientFormOrder() {
        const form = document.getElementById('quick-client-form-order');
        if (!form) return;
        
        if (form.style.display === 'none') {
            form.style.display = 'block';
            form.style.animation = 'fadeIn 0.3s';
            document.getElementById('quick-client-name-order').focus();
        } else {
            form.style.display = 'none';
            document.getElementById('quick-client-name-order').value = '';
            document.getElementById('quick-client-phone-order').value = '';
            document.getElementById('quick-client-address-order').value = '';
        }
    },

    async saveQuickClientOrder() {
        const name = document.getElementById('quick-client-name-order').value.trim();
        const phone = document.getElementById('quick-client-phone-order').value.trim();
        const address = document.getElementById('quick-client-address-order').value.trim() || 'Sin dirección';
        
        if (!name || !phone) {
            Utils.showNotification('Ingresa nombre y teléfono', 'error', 3000);
            return;
        }
        
        Utils.showLoading(true);
        
        try {
            // Intentar crear cliente con ubicación automatica
            const client = await ClientsModule.createQuickClient(name, phone);
            
            ClientsModule.updateClientSelect();
            
            const clientSelect = document.getElementById('order-client');
            if (clientSelect) {
                clientSelect.value = client.id;
            }
            
            this.toggleQuickClientFormOrder();
            
        } catch (error) {
            Utils.showNotification('Error al crear cliente: ' + error.message, 'error', 3000);
        } finally {
            Utils.showLoading(false);
        }
    },

    addOrder() {
        const clientId = parseInt(document.getElementById('order-client').value);
        const weight = parseFloat(document.getElementById('order-weight').value);
        const quantity = parseInt(document.getElementById('order-quantity').value);
        const price = document.getElementById('order-price').value ? 
                     parseFloat(document.getElementById('order-price').value) : null;
        const deliveryDate = document.getElementById('order-delivery-date').value;
        const notes = document.getElementById('order-notes').value;

        if (!clientId) {
            Utils.showNotification('Selecciona un cliente', 'error', 5000);
            return;
        }

        if (!weight || weight <= 0) {
            Utils.showNotification('Ingrese un peso valido en libras', 'error', 5000);
            return;
        }

        if (!quantity || quantity <= 0) {
            Utils.showNotification('Ingrese una cantidad válida de pollos', 'error', 5000);
            return;
        }

        const order = OrdersModule.addOrder(clientId, weight, quantity, price, deliveryDate, notes);
        
        // NUEVO: Notificacion automatica
        const client = ClientsModule.getClientById(clientId);
        if (client) {
            this.notifyNewOrder(order, client);
        }
        
        // NUEVO: Limpiar formulario después de guardar exitosamente
        document.getElementById('order-form').reset();
        OrdersModule.updateOrdersList();
        
        // ACTUALIZACION: Actualizar mapas automaticamente
        this.actualizarMapasAutomaticamente();
        
        Utils.showNotification(`Pedido registrado: ${Utils.formatCurrency(order.total)}`, 'success', 5000);
    },

    filterOrders(status) {
        const buttons = document.querySelectorAll('.status-btn');
        buttons.forEach(btn => btn.classList.remove('active'));
        document.querySelector(`.status-btn[onclick*="${status}"]`).classList.add('active');
        OrdersModule.updateOrdersList(status === 'all' ? null : status);
    },

    showReceipt(saleId) {
        const sale = SalesModule.getSaleById(saleId);
        if (!sale) return;

        const client = ClientsModule.getClientById(sale.clientId);
        if (!client) return;

        // Guardar ID para descargar PDF
        this.currentReceiptSaleId = saleId;

        // Actualizar datos del recibo
        document.getElementById('receipt-date').textContent = `${sale.date} ${sale.time}`;
        document.getElementById('receipt-client').textContent = client.name;
        document.getElementById('receipt-phone').textContent = client.phone;
        document.getElementById('receipt-weight').textContent = sale.weight.toFixed(2);
        document.getElementById('receipt-quantity').textContent = sale.quantity;
        document.getElementById('receipt-average-weight').textContent = sale.averageWeight;
        document.getElementById('receipt-price').textContent = sale.price.toFixed(2);
        document.getElementById('receipt-total').textContent = sale.total.toFixed(2);

        // Mostrar recibo
        const receipt = document.getElementById('receipt-preview');
        if (receipt) {
            receipt.style.display = 'block';
            this.isReceiptOpen = true;
            window.scrollTo(0, 0);
        }
    },

    // NOTIFICACIONES PUSH - MEJORADO
    async initPushNotifications() {
        console.log('🔔 ========================================');
        console.log('🔔 INICIALIZANDO NOTIFICACIONES EN APP');
        console.log('🔔 ========================================');
        
        if (typeof PushNotifications === 'undefined') {
            console.error('❌ PushNotifications no esta definido');
            console.log('💡 Verifica que js/notify-system.js esté cargado');
            return false;
        }

        try {
            // Esperar un poco para asegurar que el Service Worker esté listo
            console.log('⏳ Esperando 2 segundos para que el Service Worker esté listo...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log('🚀 Iniciando sistema de notificaciones...');
            const initialized = await PushNotifications.init();
            
            if (initialized) {
                console.log('✅ Sistema de notificaciones inicializado correctamente');
                console.log('🔔 ========================================');
                return true;
            } else {
                console.warn('⚠️ No se pudieron inicializar las notificaciones');
                console.warn('   Posibles causas:');
                console.warn('   - Permisos denegados');
                console.warn('   - Service Worker no disponible');
                console.warn('   - Navegador no soporta notificaciones');
                console.log('🔔 ========================================');
                return false;
            }
        } catch (error) {
            console.error('❌ Error inicializando notificaciones:', error);
            console.error('   Mensaje:', error.message);
            console.error('   Stack:', error.stack);
            console.log('🔔 ========================================');
            return false;
        }
    },

    async requestNotificationPermission() {
        console.log('🔔 Solicitando permisos de notificación...');
        
        if (Notification.permission === 'granted') {
            console.log('✅ Permisos ya concedidos');
            return true;
        }

        if (Notification.permission === 'denied') {
            console.log('❌ Permisos denegados');
            return false;
        }

        try {
            const permission = await Notification.requestPermission();
            console.log('🔔 Resultado de permisos:', permission);
            
            if (permission === 'granted') {
                Utils.showNotification('Notificaciones activadas', 'success', 3000);
                // Mostrar notificación de prueba
                setTimeout(() => {
                    this.showLocalNotification(
                        'GallOli - Notificaciones Activas',
                        'Las notificaciones estan funcionando correctamente'
                    );
                }, 1000);
                return true;
            } else {
                console.log('❌ Permisos no concedidos:', permission);
                return false;
            }
        } catch (error) {
            console.error('❌ Error solicitando permisos:', error);
            return false;
        }
    },

    // Enviar notificación local - CORREGIDO
    showLocalNotification(title, body, icon = '') {
        console.log('🔔 Intentando mostrar notificación:', title, body);
        
        // Verificar si Notification esta disponible
        if (typeof Notification === 'undefined') {
            console.log('❌ API de Notification no disponible en este navegador');
            return false;
        }
        
        if (Notification.permission !== 'granted') {
            console.log('❌ Sin permisos para notificaciones');
            return false;
        }

        try {
            const notification = new Notification(title, {
                body: body,
                icon: './icons/icon-192x192.png',
                badge: './icons/icon-72x72.png',
                tag: 'galloapp-' + Date.now(),
                renotify: true,
                requireInteraction: false,
                silent: false,
                vibrate: [200, 100, 200]
            });

            // Auto-cerrar después de 5 segundos
            setTimeout(() => {
                notification.close();
            }, 5000);

            console.log('✅ Notificación mostrada correctamente');
            return true;
        } catch (error) {
            console.error('❌ Error mostrando notificación:', error);
            return false;
        }
    },

    // Notificaciones automaticas para eventos importantes - CORREGIDO
    notifyNewSale(sale, client) {
        console.log('💰 Notificando nueva venta:', sale.id);
        this.showLocalNotification(
            'Nueva Venta Registrada',
            `${Utils.escapeHtml(client.name)}: ${Utils.formatCurrency(sale.total)} - ${sale.weight}lb`
        );
    },

    notifyNewOrder(order, client) {
        console.log('📋 Notificando nuevo pedido:', order.id);
        this.showLocalNotification(
            'Nuevo Pedido',
            `${Utils.escapeHtml(client.name)}: ${order.weight}lb - ${order.quantity} pollos`
        );
    },

    notifyDailyReminder() {
        const todaySales = SalesModule.getTodaySales();
        const totalIncome = todaySales.reduce((sum, sale) => sum + sale.total, 0);
        
        this.showLocalNotification(
            'Resumen del Dia',
            `${todaySales.length} ventas - ${Utils.formatCurrency(totalIncome)}`
        );
    },

    // Configurar recordatorio diario
    setupDailyReminder() {
        // Recordatorio a las 8 PM todos los días
        const now = new Date();
        const reminder = new Date();
        reminder.setHours(20, 0, 0, 0);
        
        if (reminder <= now) {
            reminder.setDate(reminder.getDate() + 1);
        }
        
        const timeUntilReminder = reminder.getTime() - now.getTime();
        
        setTimeout(() => {
            this.notifyDailyReminder();
            setInterval(() => {
                this.notifyDailyReminder();
            }, 24 * 60 * 60 * 1000);
        }, timeUntilReminder);
    },

    // Métodos para activar/desactivar notificaciones desde la UI - CORREGIDO
    async enableNotifications() {
        const enabled = await this.requestNotificationPermission();
        if (enabled) {
            Utils.showNotification('Notificaciones activadas correctamente', 'success', 3000);
        } else {
            Utils.showNotification('No se pudieron activar las notificaciones', 'error', 3000);
        }
        
        // Actualizar estado en la UI
        setTimeout(() => {
            this.updateNotificationStatus();
        }, 500);
        
        return enabled;
    },

    disableNotifications() {
        Utils.showNotification('Notificaciones desactivadas', 'warning', 3000);
    },

    testNotification() {
        console.log('🧪 Probando notificación...');
        const success = this.showLocalNotification(
            'Notificacion de Prueba',
            'Las notificaciones estan funcionando correctamente en GallOli'
        );
        
        if (!success) {
            Utils.showNotification('Error: Activa los permisos de notificación primero', 'error', 5000);
        }
    },

    // NUEVO: Actualizar estado de notificaciones en la UI
    updateNotificationStatus() {
        const statusDiv = document.getElementById('notification-status');
        const enableBtn = document.getElementById('enable-notifications-btn');
        const testBtn = document.getElementById('test-notification-btn');
        
        if (!statusDiv) return;
        
        if (!('Notification' in window)) {
            statusDiv.style.background = '#FFEBEE';
            statusDiv.style.color = '#C62828';
            statusDiv.innerHTML = '<i class="fas fa-times-circle"></i> Notificaciones no soportadas';
            if (enableBtn) enableBtn.disabled = true;
            if (testBtn) testBtn.disabled = true;
            return;
        }
        
        const permission = Notification.permission;
        
        switch (permission) {
            case 'granted':
                statusDiv.style.background = '#E8F5E9';
                statusDiv.style.color = '#2E7D32';
                statusDiv.innerHTML = '<i class="fas fa-check-circle"></i> Notificaciones activas';
                if (enableBtn) {
                    enableBtn.disabled = true;
                    enableBtn.innerHTML = '<i class="fas fa-check"></i> Activadas';
                }
                if (testBtn) testBtn.disabled = false;
                break;
                
            case 'denied':
                statusDiv.style.background = '#FFEBEE';
                statusDiv.style.color = '#C62828';
                statusDiv.innerHTML = '<i class="fas fa-times-circle"></i> Permisos denegados';
                if (enableBtn) enableBtn.disabled = true;
                if (testBtn) testBtn.disabled = true;
                break;
                
            default:
                statusDiv.style.background = '#FFF3E0';
                statusDiv.style.color = '#E65100';
                statusDiv.innerHTML = '<i class="fas fa-question-circle"></i> Permisos pendientes';
                if (enableBtn) enableBtn.disabled = false;
                if (testBtn) testBtn.disabled = true;
                break;
        }
    },

    closeReceipt() {
        const receipt = document.getElementById('receipt-preview');
        if (receipt) {
            receipt.style.display = 'none';
            // Limpiar datos del recibo
            document.getElementById('receipt-date').textContent = '';
            document.getElementById('receipt-client').textContent = '';
            document.getElementById('receipt-phone').textContent = '';
            document.getElementById('receipt-weight').textContent = '';
            document.getElementById('receipt-quantity').textContent = '';
            document.getElementById('receipt-average-weight').textContent = '';
            document.getElementById('receipt-price').textContent = '';
            document.getElementById('receipt-total').textContent = '';
        }
        this.isReceiptOpen = false;
    },

    async downloadReceipt() {
        if (!this.currentReceiptSaleId) {
            Utils.showNotification('Error: No hay recibo para descargar', 'error', 3000);
            return;
        }

        const sale = SalesModule.getSaleById(this.currentReceiptSaleId);
        if (!sale) {
            Utils.showNotification('Error: Venta no encontrada', 'error', 3000);
            return;
        }

        const client = ClientsModule.getClientById(sale.clientId);
        if (!client) {
            Utils.showNotification('Error: Cliente no encontrado', 'error', 3000);
            return;
        }

        Utils.showLoading(true);

        try {
            await PDFGenerator.generateReceipt(sale, client);
            Utils.showNotification('Recibo descargado correctamente', 'success', 3000);
        } catch (error) {
            console.error('Error generando PDF:', error);
            Utils.showNotification('Error al generar el PDF', 'error', 3000);
        } finally {
            Utils.showLoading(false);
        }
    },


    // Métodos del mapa
    openMapModal() {
        const modal = document.getElementById('map-modal');
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex';

            // Fallback dinamico: ultima posicion conocida del usuario (no un pais hardcodeado)
            const getLastKnownFallback = () => {
                try {
                    const saved = localStorage.getItem('galloli_last_known_pos');
                    if (saved) return JSON.parse(saved);
                } catch(e) {}
                return null; // sin fallback — el mapa esperara
            };

            // Wrapper de alta precision con watchPosition para seguimiento en vivo
            let mapWatchId = null;
            let mapMarker = null;
            let mapAccCircle = null;
            let markerUserMoved = false;

            const initMapWithPos = (lat, lng, accuracy) => {
                // Guardar como ultima posicion conocida
                localStorage.setItem('galloli_last_known_pos', JSON.stringify([lat, lng]));

                if (!MapModule.map) {
                    MapModule.initMap(lat, lng);
                    // Agregar circulo de precision
                    setTimeout(() => {
                        if (typeof L !== 'undefined' && MapModule.map) {
                            mapAccCircle = L.circle([lat, lng], {
                                radius: accuracy || 5,
                                color: '#4CAF50', fillOpacity: 0.1, weight: 1
                            }).addTo(MapModule.map);
                            // Marcador arrastrable en mi posicion
                            mapMarker = L.marker([lat, lng], { draggable: true }).addTo(MapModule.map);
                            mapMarker.on('dragstart', () => { markerUserMoved = true; });
                        }
                    }, 200);
                } else if (!markerUserMoved && mapMarker) {
                    // Actualizar posicion del marcador si el usuario no lo movio
                    mapMarker.setLatLng([lat, lng]);
                    if (mapAccCircle) {
                        mapAccCircle.setLatLng([lat, lng]).setRadius(accuracy || 5);
                    }
                    MapModule.map.panTo([lat, lng]);
                }
            };

            // Intentar GPS de alta precision
            if (navigator.geolocation) {
                // Leer inmediatamente con alta precision
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        initMapWithPos(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
                    },
                    (err) => {
                        console.warn('GPS inicial fallido:', err.message);
                        // Usar ultima posicion conocida como fallback
                        const fallback = getLastKnownFallback();
                        if (fallback) {
                            MapModule.initMap(fallback[0], fallback[1]);
                        }
                        // Si no hay fallback, el mapa se inicializa cuando llegue el watch
                    },
                    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
                );

                // Watch en vivo para actualizar mientras el usuario se mueve
                mapWatchId = navigator.geolocation.watchPosition(
                    (pos) => {
                        if (pos.coords.accuracy > 30) return; // ignorar lecturas muy imprecisas
                        initMapWithPos(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
                    },
                    (err) => { console.warn('GPS watch error:', err.message); },
                    { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
                );

                // Guardar watchId para limpiarlo al cerrar el modal
                App._mapModalWatchId = mapWatchId;
            } else {
                // Sin GPS: usar ultima posicion conocida o mostrar mensaje
                const fallback = getLastKnownFallback();
                if (fallback) {
                    setTimeout(() => MapModule.initMap(fallback[0], fallback[1]), 100);
                }
            }
        }
    },

    // NUEVO: Abrir modal de mapa - SIMPLIFICADO
    showMapModal(lat = 14.6349, lng = -90.5069, mode = 'add') {
        // Este método ya no se usa para edición, solo para agregar nuevos clientes
        const modal = document.getElementById('map-modal');
        if (modal) {
            modal.classList.add('active');
            modal.style.display = 'flex';
            modal.style.zIndex = '9999';
            
            setTimeout(() => {
                MapModule.initMap(lat, lng);
                this.mapMode = mode;
            }, 100);
        }
    },

    closeMapModal() {
        const modal = document.getElementById('map-modal');
        if (modal) {
            modal.classList.remove('active');
            modal.style.display = 'none';

            // Limpiar watch GPS del mapa
            if (App._mapModalWatchId != null) {
                navigator.geolocation.clearWatch(App._mapModalWatchId);
                App._mapModalWatchId = null;
            }

            // Limpiar datos del mapa
            const latInput = document.getElementById('map-latitude');
            const lngInput = document.getElementById('map-longitude');
            const addressInput = document.getElementById('map-address');
            
            if (latInput) latInput.value = '';
            if (lngInput) lngInput.value = '';
            if (addressInput) addressInput.value = '';
            
            // Destruir mapa
            MapModule.destroyMap();
        }
    },

    // Método general para cerrar todos los modales
    closeAllModals() {
        // Cerrar modal de mapa
        this.closeMapModal();
        
        // Cerrar recibo
        this.closeReceipt();
        
        // Cerrar sidebar overlay si está activo (móvil)
        const sidebarOverlay = document.getElementById('sidebar-overlay');
        if (sidebarOverlay) sidebarOverlay.classList.remove('active');
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('active');

        // Cerrar y ELIMINAR modales dinámicos (creados con createElement y appendados al body)
        document.querySelectorAll('.modal').forEach(modal => {
            if (!modal.id || modal.id === '') {
                modal.remove();
            } else {
                modal.classList.remove('active');
                modal.style.display = 'none';
            }
        });
        
        // Ocultar notificaciones
        Utils.hideNotification();
    },

    useCurrentLocation() {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                // Guardar como ultima posicion conocida
                localStorage.setItem('galloli_last_known_pos', JSON.stringify([lat, lng]));
                MapModule.setCurrentLocation(lat, lng);
                Utils.showNotification('Ubicación actual establecida', 'success', 3000);
            },
            (error) => {
                Utils.showNotification('No se pudo obtener la ubicación actual', 'error', 5000);
            },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
    },

    saveSelectedLocation() {
        const location = MapModule.getSelectedLocation();
        const address = document.getElementById('map-address').value;
        
        if (location) {
            // Solo para modo agregar nuevos clientes
            this.selectedCoordinates = location;
            this.selectedAddress = address;
            
            const locationElement = document.getElementById('current-location');
            if (locationElement) {
                locationElement.innerHTML = `<i class="fas fa-map-marker-alt location-icon"></i> ${address}`;
                locationElement.style.color = 'var(--success)';
            }
            
            Utils.showNotification('Ubicación guardada correctamente', 'success', 3000);
            this.closeMapModal();
        } else {
            Utils.showNotification('Selecciona una ubicación en el mapa', 'error', 5000);
        }
    },

    // Otros métodos
    filterSalesByDate() {
        const dateInput = document.getElementById('sales-date-filter');
        if (dateInput) {
            this.currentDate = dateInput.value;
        }
        SalesModule.updateSalesList(this.currentDate);
        Utils.showNotification(`Mostrando ventas del ${this.currentDate}`, 'info', 2000);
    },

    filterStatsByDate() {
        const dateInput = document.getElementById('stats-date-filter');
        if (dateInput) {
            this.currentDate = dateInput.value;
        }
        StatsModule.updateStats(this.currentDate);
        Utils.showNotification(`Mostrando estadísticas del ${this.currentDate}`, 'info', 2000);
    },

    filterAccountingByDate() {
        const dateInput = document.getElementById('accounting-date-filter');
        if (dateInput) {
            this.currentDate = dateInput.value;
        }
        AccountingModule.updateAccounting(this.currentDate);
        AccountingModule.updateExpensesList(this.currentDate);
        Utils.showNotification(`Mostrando contabilidad del ${this.currentDate}`, 'info', 2000);
    },

    // NUEVO: Método para calcular y guardar merma con recalculación
    async calculateAndSaveMerma() {
        const mermaDate = document.getElementById('merma-date').value;
        const liveWeightInput = document.getElementById('live-weight').value.trim();
        const liveCostInput = document.getElementById('live-cost').value.trim();
        const processedWeightInput = document.getElementById('processed-weight').value.trim();
        const chickenCountInput = document.getElementById('chicken-count').value.trim();
        const processingCostInput = document.getElementById('processing-cost-per-chicken').value.trim();
        const realCostInput = document.getElementById('real-cost-per-lb')?.value.trim();
        const salePriceInput = document.getElementById('sale-price-per-lb')?.value.trim();
        
        const liveWeight = liveWeightInput ? parseFloat(liveWeightInput) : null;
        const liveCost = liveCostInput ? parseFloat(liveCostInput) : null;
        const processedWeight = processedWeightInput ? parseFloat(processedWeightInput) : null;
        const chickenCount = chickenCountInput ? parseInt(chickenCountInput) : 0;
        const processingCostPerChicken = processingCostInput ? parseFloat(processingCostInput) : null;
        const realCostPerLb = realCostInput ? parseFloat(realCostInput) : null;
        const salePrice = salePriceInput ? parseFloat(salePriceInput) : null;

        if (!mermaDate || !chickenCount || chickenCount <= 0) {
            Utils.showNotification('Fecha y cantidad de pollos son obligatorios', 'error', 5000);
            return;
        }

        Utils.showLoading(true);

        try {
            // null si el campo estaba vacío, para que calculateMerma pueda deducirlo
            const totalProcessingCost = processingCostPerChicken != null
                ? chickenCount * processingCostPerChicken
                : null;
            const result = MermaModule.calculateMerma(liveWeight, liveCost, processedWeight, totalProcessingCost, realCostPerLb);
            
            result.chickenCount = chickenCount;
            // Si el costo por pollo era null (vacío), calcular desde el costo total deducido
            result.processingCostPerChicken = processingCostPerChicken != null
                ? processingCostPerChicken
                : (chickenCount > 0 ? result.processingCost / chickenCount : 0);
            
            const record = await MermaModule.saveMermaRecord(result, mermaDate);
            // Guardar precio de venta del día si se ingresó
            if (salePrice !== null && salePrice > 0) {
                await MermaModule.saveDailyPrice(result.realCostPerLb, mermaDate, salePrice);
            }
            const ventasRecalculadas = await MermaModule.recalcularVentasPorFecha(mermaDate);
            
            Utils.showLoading(false);
            
            let mensaje = `Merma guardada: ${result.merma}% - ${Utils.formatCurrency(result.realCostPerLb)}/lb`;
            if (result.deducedValue) {
                const labels = {
                    liveWeight: 'Peso vivo',
                    liveCost: 'Costo/lb vivo',
                    processedWeight: 'Peso pelado',
                    processingCost: 'Costo procesamiento',
                    realCostPerLb: 'Costo real/lb'
                };
                mensaje += ` | ${labels[result.deducedValue]} calculado`;
            }
            if (ventasRecalculadas > 0) {
                mensaje += ` | ${ventasRecalculadas} ventas recalculadas`;
            }
            
            Utils.showNotification(mensaje, 'success', 5000);
            
            // Notificación push
            if (NotificationsModule) {
                NotificationsModule.show('Merma Calculada', `Merma del día: ${result.merma}%`).catch(err => {
                    console.warn('No se pudo enviar notificación:', err);
                });
            }
            
            document.getElementById('merma-form').reset();
            this.loadMermaPage();
            
            StatsModule.updateStats(mermaDate);
            AccountingModule.updateAccounting(mermaDate);
            
            if (this.currentPage === 'diezmos') {
                this.updateDiezmosPreview();
            }
            
        } catch (error) {
            Utils.showLoading(false);
            Utils.showNotification('Error: ' + error.message, 'error', 5000);
        }
    },

    // NUEVO: Obtener HTML del historial de merma
    getMermaHistoryHTML() {
        const records = MermaModule.mermaRecords
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 10); // ultimos 10 registros

        if (records.length === 0) {
            return `
                <div class="empty-state">
                    <i class="fas fa-calculator empty-state-icon"></i>
                    <p>No hay registros de merma</p>
                </div>
            `;
        }

        let html = '<ul class="sales-list">';
        records.forEach(record => {
            const chickenInfo = record.chickenCount ? 
                `<p class="sale-details">
                    <i class="fas fa-drumstick-bite"></i> ${record.chickenCount} pollos procesados | 
                    <i class="fas fa-dollar-sign"></i> $${record.processingCostPerChicken ? record.processingCostPerChicken.toFixed(2) : '0.00'}/pollo
                </p>` : '';
            
            html += `
                <li class="sale-item">
                    <div class="sale-info">
                        <h3><i class="fas fa-calendar-day"></i> ${record.date}</h3>
                        <p class="sale-details">
                            <i class="fas fa-percentage"></i> Merma: ${record.merma}% | 
                            <i class="fas fa-dollar-sign"></i> Costo: ${Utils.formatCurrency(record.realCostPerLb)}/lb
                        </p>
                        <p class="sale-details">
                            <i class="fas fa-weight"></i> ${record.liveWeight} lb vivo -> ${record.processedWeight} lb pelado
                        </p>
                        ${chickenInfo}
                        <p class="sale-details">
                            <i class="fas fa-chart-line"></i> Pérdida: ${Utils.formatCurrency(record.lossAmount)}
                        </p>
                    </div>
                    <div style="text-align: right;">
                        <div class="sale-amount" style="color: var(--primary);">
                            ${Utils.formatCurrency(record.realCostPerLb)}/lb
                        </div>
                        <button class="btn btn-outline" onclick="App.editMermaRecord('${record.date}')" 
                                style="margin-top: 5px; padding: 5px 10px; font-size: 0.8rem;">
                            <i class="fas fa-edit"></i> Editar
                        </button>
                    </div>
                </li>
            `;
        });
        html += '</ul>';
        return html;
    },

    // NUEVO: Editar registro de merma
    editMermaRecord(date) {
        this.currentDate = date;
        this.loadMermaPage();
        Utils.showNotification(`Editando merma del ${date}`, 'info', 3000);
    },

    addExpense() {
        const description = document.getElementById('expense-description').value;
        const amount = parseFloat(document.getElementById('expense-amount').value);
        const category = document.getElementById('expense-category').value;
        const expenseDate = document.getElementById('expense-date')?.value || this.currentDate;

        if (!description || !amount || amount <= 0) {
            Utils.showNotification('Ingrese datos validos', 'error', 5000);
            return;
        }

        const expense = AccountingModule.addExpense(description, amount, category, expenseDate);
        AccountingModule.updateExpensesList(this.currentDate);
        AccountingModule.updateAccounting(this.currentDate);
        
        // NUEVO: Limpiar formulario después de guardar exitosamente
        document.getElementById('expense-form').reset();
        // Restaurar la fecha
        if (document.getElementById('expense-date')) {
            document.getElementById('expense-date').value = this.currentDate;
        }
        
        Utils.showNotification('Gasto registrado correctamente', 'success', 5000);
        
        // NUEVO: Actualizar diezmos automaticamente si estamos en esa pagina
        if (this.currentPage === 'diezmos') {
            this.updateDiezmosPreview();
        }
    },

    editExpense(expenseId) {
        const expense = AccountingModule.getExpenseById(expenseId);
        if (!expense) return;

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-edit"></i> Editar Gasto</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="edit-expense-form">
                        <div class="form-group">
                            <label class="form-label">Descripción</label>
                            <input type="text" class="form-input" id="edit-expense-description" 
                                   value="${Utils.escapeHtml(expense.description)}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Monto</label>
                            <input type="number" step="0.01" min="0.01" class="form-input" 
                                   id="edit-expense-amount" value="${expense.amount}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Categoría</label>
                            <select class="form-input" id="edit-expense-category" required>
                                <option value="insumos" ${expense.category === 'insumos' ? 'selected' : ''}>Insumos</option>
                                <option value="mano_obra" ${expense.category === 'mano_obra' ? 'selected' : ''}>Mano de Obra</option>
                                <option value="transporte" ${expense.category === 'transporte' ? 'selected' : ''}>Transporte</option>
                                <option value="materia_prima" ${expense.category === 'materia_prima' ? 'selected' : ''}>Materia Prima</option>
                                <option value="otros" ${expense.category === 'otros' ? 'selected' : ''}>Otros</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Fecha</label>
                            <input type="date" class="form-input" id="edit-expense-date" 
                                   value="${expense.date}" required>
                        </div>
                        <button type="submit" class="btn btn-success" style="width: 100%;">
                            <i class="fas fa-save"></i> Guardar Cambios
                        </button>
                    </form>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const form = modal.querySelector('#edit-expense-form');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const success = AccountingModule.editExpense(expenseId, {
                description: document.getElementById('edit-expense-description').value,
                amount: document.getElementById('edit-expense-amount').value,
                category: document.getElementById('edit-expense-category').value,
                date: document.getElementById('edit-expense-date').value
            });
            
            if (success) {
                AccountingModule.updateExpensesList(this.currentDate);
                AccountingModule.updateAccounting(this.currentDate);
                Utils.showNotification('Gasto actualizado correctamente', 'success', 3000);
                
                if (this.currentPage === 'diezmos') {
                    this.updateDiezmosPreview();
                }
            }
            
            modal.remove();
        });
    },

    async deleteExpense(expenseId) {
        const expense = AccountingModule.getExpenseById(expenseId);
        if (!expense) return;

        const confirmed = await Utils.showDangerConfirm(
            `¿Eliminar el gasto "${expense.description}" por ${Utils.formatCurrency(expense.amount)}?`,
            'Eliminar Gasto',
            'Eliminar'
        );
        
        if (confirmed) {
            AccountingModule.deleteExpense(expenseId);
            AccountingModule.updateExpensesList(this.currentDate);
            AccountingModule.updateAccounting(this.currentDate);
            Utils.showNotification('Gasto eliminado correctamente', 'success', 3000);
            
            if (this.currentPage === 'diezmos') {
                this.updateDiezmosPreview();
            }
        }
    },

    // Sidebar
    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const isDesktop = window.innerWidth > 1024;

        if (isDesktop) {
            // En desktop: colapsar/expandir sin overlay
            if (sidebar) sidebar.classList.toggle('collapsed');
        } else {
            // En móvil: comportamiento original con overlay
            if (sidebar) sidebar.classList.toggle('active');
            if (overlay) overlay.classList.toggle('active');
        }
    },

    // Sincronización y exportación
    async syncData() {
        if (window.SyncEngine && window.AuthManager?.isAuthenticated()) {
            Utils.showNotification('Sincronizando con la nube...', 'info', 2000);
            try {
                await window.SyncEngine.forceFullSync();
                Utils.showNotification('Sincronización completada', 'success', 3000);
            } catch (e) {
                Utils.showNotification('Error al sincronizar', 'error', 3000);
            }
        } else {
            Utils.showNotification('Inicia sesión para sincronizar', 'warning', 3000);
        }
    },

    exportData() {
        const data = {
            clients: ClientsModule.clients,
            sales: SalesModule.sales,
            orders: OrdersModule.orders,
            expenses: AccountingModule.expenses,
            mermaPrices: MermaModule.dailyPrices,
            diezmosRecords: DiezmosModule.records,
            diezmosConfig: DiezmosModule.config,
            exportDate: Utils.formatDateTime()
        };
        
        const dataStr = JSON.stringify(data, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `pollos_frescos_backup_${Utils.formatDate()}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        Utils.showNotification('Datos exportados correctamente', 'success', 5000);
    },

    // PWA
    setupPWA() {
        // Service Worker registrado al inicio de init()
        // (ver App.init() arriba)

        // Install Prompt - Corregido
        let deferredPrompt;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            
            setTimeout(async () => {
                if (deferredPrompt) {
                    const install = await Utils.showConfirm(
                        '¿Deseas instalar GallOli en tu dispositivo para uso sin conexión?',
                        'Instalar Aplicacion',
                        'Instalar',
                        'Ahora No'
                    );
                    
                    if (install) {
                        try {
                            deferredPrompt.prompt();
                            deferredPrompt.userChoice.then(() => {
                                deferredPrompt = null;
                            }).catch(() => {
                                deferredPrompt = null;
                            });
                        } catch (err) {
                            deferredPrompt = null;
                        }
                    } else {
                        deferredPrompt = null;
                    }
                }
            }, 10000);
        });
        
        // Suprimir errores de extensiones
        window.addEventListener('error', (e) => {
            if (e.message && (e.message.includes('extension') || e.message.includes('Could not establish connection'))) {
                e.preventDefault();
                return true;
            }
        });
    },

    // NUEVO: Actualizar vista previa de diezmos en tiempo real
    updateDiezmosPreview() {
        const diezmoPercent = parseFloat(document.getElementById('diezmo-percent')?.value) || DiezmosModule.config.diezmoPercent;
        const ofrendaPercent = parseFloat(document.getElementById('ofrenda-percent')?.value) || DiezmosModule.config.ofrendaPercent;
        
        // Obtener ganancia neta actual
        const netProfit = AccountingModule.getNetProfitByDate(this.currentDate);
        
        // Calcular diezmos con los valores actuales
        const diezmo = netProfit > 0 ? (netProfit * diezmoPercent) / 100 : 0;
        const ofrenda = netProfit > 0 ? (netProfit * ofrendaPercent) / 100 : 0;
        const total = diezmo + ofrenda;
        
        // Actualizar elementos de vista previa
        const previewIncome = document.getElementById('preview-income');
        const previewDiezmo = document.getElementById('preview-diezmo');
        const previewOfrenda = document.getElementById('preview-ofrenda');
        const previewTotal = document.getElementById('preview-total');
        const previewDiezmoLabel = document.getElementById('preview-diezmo-label');
        const previewOfrendaLabel = document.getElementById('preview-ofrenda-label');
        
        if (previewIncome) previewIncome.textContent = Utils.formatCurrency(netProfit);
        if (previewDiezmo) previewDiezmo.textContent = Utils.formatCurrency(diezmo);
        if (previewOfrenda) previewOfrenda.textContent = Utils.formatCurrency(ofrenda);
        if (previewTotal) previewTotal.textContent = Utils.formatCurrency(total);
        if (previewDiezmoLabel) previewDiezmoLabel.textContent = `Diezmo (${diezmoPercent}%)`;
        if (previewOfrendaLabel) previewOfrendaLabel.textContent = `Ofrenda (${ofrendaPercent}%)`;
    },
    
    saveDiezmosConfig() {
        const diezmoPercent = parseFloat(document.getElementById('diezmo-percent')?.value) || 10;
        const ofrendaPercent = parseFloat(document.getElementById('ofrenda-percent')?.value) || 5;
        
        DiezmosModule.updateConfig(diezmoPercent, ofrendaPercent);
        Utils.showNotification('Configuración guardada correctamente', 'success', 3000);
        // Actualizar vista previa inmediatamente
        this.updateDiezmosPreview();
    },

    // NUEVO: Auto-guardar configuración sin notificación
    autoSaveDiezmosConfig() {
        const diezmoPercent = parseFloat(document.getElementById('diezmo-percent')?.value) || 10;
        const ofrendaPercent = parseFloat(document.getElementById('ofrenda-percent')?.value) || 5;
        
        // Guardar silenciosamente
        DiezmosModule.config.diezmoPercent = diezmoPercent;
        DiezmosModule.config.ofrendaPercent = ofrendaPercent;
        DiezmosModule.saveConfig();
    },

    getDiezmosHistoryHTML() {
        const records = DiezmosModule.records
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 30);

        if (records.length === 0) {
            return `
                <div class="empty-state">
                    <i class="fas fa-hand-holding-heart empty-state-icon"></i>
                    <p>No hay registros automaticos aún</p>
                    <p style="font-size: 0.9rem; color: var(--gray);">Los diezmos se guardan automaticamente cada día</p>
                </div>
            `;
        }

        let html = '';
        records.forEach(record => {
            const netProfit = record.netProfit || record.totalIncome || 0;
            html += `
                <li class="sale-item">
                    <div class="sale-info">
                        <h3><i class="fas fa-calendar-day"></i> ${record.date}</h3>
                        <p class="sale-details">
                            <i class="fas fa-chart-line"></i> Ganancia Neta: ${Utils.formatCurrency(netProfit)}
                        </p>
                        <p class="sale-details">
                            <i class="fas fa-hand-holding-usd"></i> Diezmo (${record.diezmoPercent}%): ${Utils.formatCurrency(record.diezmo)} | 
                            <i class="fas fa-gift"></i> Ofrenda (${record.ofrendaPercent}%): ${Utils.formatCurrency(record.ofrenda)}
                        </p>
                    </div>
                    <div class="sale-amount" style="color: var(--primary);">${Utils.formatCurrency(record.total)}</div>
                </li>
            `;
        });
        return html;
    },

    // === NUEVOS METODOS DE BACKUP Y REPORTES ===
    async createBackup() {
        try {
            Utils.showLoading(true);
            const backup = await BackupModule.createBackup();
            
            // Descargar
            const blob = new Blob([backup.data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = backup.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            // Guardar fecha del último backup
            localStorage.setItem('lastBackup', new Date().toISOString());
            
            Utils.showNotification(`Backup creado: ${backup.filename}`, 'success', 5000);
            
            // Notificación push
            if (NotificationsModule) {
                NotificationsModule.show('Backup Creado', 'Backup creado exitosamente').catch(err => {
                    console.warn('No se pudo enviar notificación:', err);
                });
            }
            
        } catch (error) {
            Utils.showNotification('Error al crear backup: ' + error.message, 'error', 5000);
        } finally {
            Utils.showLoading(false);
        }
    },

    async restoreFromFile(file) {
        if (!file) return;
        
        try {
            const success = await BackupModule.importFromFile(file);
            if (success) {
                // IMPORTANTE: Recargar TODOS los módulos después de importar
                await this.loadAllData();
                
                // Actualizar todas las vistas
                ClientsModule.updateClientList();
                ClientsModule.updateClientSelect();
                OrdersModule.updateOrdersList();
                OrdersModule.updateOrderBadges();
                CreditosModule.updateCreditBadges();
                
                // Recargar pagina actual
                this.loadPage(this.currentPage || 'dashboard');
            }
        } catch (error) {
            Utils.showNotification('Error al restaurar: ' + error.message, 'error', 5000);
        }
    },

    async clearAllData() {
        const confirmed = await Utils.showDangerConfirm(
            ' Esto eliminará TODOS los datos de la aplicación. Esta acción NO se puede deshacer.',
            ' Eliminar Todos los Datos',
            'Continuar'
        );
        
        if (!confirmed) return;
        
        const confirmation = await Utils.showPrompt(
            'Para confirmar, escribe exactamente: ELIMINAR',
            ' Confirmación Final',
            '',
            'ELIMINAR'
        );
        
        if (confirmation === 'ELIMINAR') {
            localStorage.clear();
            window.location.reload();
        } else if (confirmation) {
            Utils.showAlert('Texto incorrecto. No se eliminaron los datos.', 'Cancelado', 'info');
        }
    },

    exportAsJSON() {
        const data = {
            clients: ClientsModule.clients,
            sales: SalesModule.sales,
            orders: OrdersModule.orders,
            expenses: AccountingModule.expenses,
            mermaPrices: MermaModule.dailyPrices,
            exportDate: Utils.formatDateTime()
        };
        
        const dataStr = JSON.stringify(data, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `pollos_frescos_${Utils.formatDate()}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        Utils.showNotification('Datos exportados como JSON', 'success', 5000);
    },

    // Método para generar reportes
    async generateReport() {
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 7); // Últimos 7 días por defecto
        
        const startDate = await Utils.showPrompt(
            'Ingresa la fecha de inicio:',
            'Fecha Inicio',
            Utils.formatDate(yesterday),
            'YYYY-MM-DD'
        );
        
        if (!startDate) return;
        
        const endDate = await Utils.showPrompt(
            'Ingresa la fecha de fin:',
            'Fecha Fin',
            Utils.formatDate(today),
            'YYYY-MM-DD'
        );
        
        if (!endDate) return;
        
        try {
            Utils.showLoading(true);
            const report = ReportsModule.generateSalesReport(startDate, endDate);
            
            if (report) {
                const filename = ReportsModule.generatePDFReport(report, 'Reporte de Ventas');
                Utils.showNotification(`Reporte generado: ${filename}`, 'success', 5000);
            } else {
                Utils.showNotification('No hay datos para el período seleccionado', 'warning', 5000);
            }
        } catch (error) {
            Utils.showNotification('Error al generar reporte: ' + error.message, 'error', 5000);
        } finally {
            Utils.showLoading(false);
        }
    },

    // Método para enviar backup a Telegram
    async sendBackupToTelegram() {
        try {
            Utils.showLoading(true);
            const backup = await BackupModule.createBackup();
            const result = await BackupModule.sendToTelegram(backup);
            
            if (result.ok) {
                Utils.showNotification('Backup enviado a Telegram correctamente', 'success', 5000);
            }
        } catch (error) {
            Utils.showNotification('Error al enviar a Telegram: ' + error.message, 'error', 5000);
        } finally {
            Utils.showLoading(false);
        }
    },

    // NUEVO: Probar backup automatico (ejecuta el mismo método que se ejecutara a las 10 PM)
    async testAutoBackup() {
        try {
            Utils.showLoading(true);
            Utils.showNotification('Ejecutando backup automatico de prueba...', 'info', 3000);
            
            // Ejecutar el mismo método que se ejecuta a las 10 PM
            const result = await AutoBackup.forceBackup();
            
            if (result !== false) {
                Utils.showNotification('Backup automatico enviado correctamente. Revisa tu Telegram.', 'success', 5000);
            } else {
                Utils.showNotification('No se pudo enviar el backup. Verifica las credenciales.', 'warning', 5000);
            }
        } catch (error) {
            Utils.showNotification('Error en backup automatico: ' + error.message, 'error', 5000);
        } finally {
            Utils.showLoading(false);
        }
    },

    // NUEVO: Guardar configuración de Telegram
    saveTelegramConfig() {
        const token = document.getElementById('telegram-token').value.trim();
        const chatId = document.getElementById('telegram-chatid').value.trim();
        
        if (!token || !chatId) {
            Utils.showNotification('Ingresa token y chat ID', 'error', 3000);
            return;
        }
        
        BackupModule.saveTelegramConfig(token, chatId);
        
        // Recargar la pagina de backups para mostrar la nueva configuración
        setTimeout(() => {
            this.loadBackupPage();
        }, 1000);
    },

    // NUEVO: Probar conexión con Telegram
    async testTelegramConnection() {
        try {
            Utils.showLoading(true);
            const result = await BackupModule.testTelegramConnection();
            
            if (result.ok) {
                Utils.showNotification('Conexión exitosa! Revisa tu Telegram', 'success', 5000);
            }
        } catch (error) {
            Utils.showNotification(error.message, 'error', 5000);
        } finally {
            Utils.showLoading(false);
        }
    },
    
    // NUEVO: Limpiar configuración de Telegram
    async clearTelegramConfig() {
        const confirmed = await Utils.showDangerConfirm(
            'Se eliminará la configuración de Telegram. Podrás volver a configurarla cuando quieras.',
            'Eliminar Configuración de Telegram',
            'Eliminar'
        );
        
        if (confirmed) {
            BackupModule.clearTelegramConfig();
            
            // Recargar la pagina de backups
            setTimeout(() => {
                this.loadBackupPage();
            }, 500);
        }
    },

    // ===== METODOS DE DIEZMOS Y OFRENDAS =====
    loadDiezmosPage() {
        const preview = DiezmosModule.getPreview();
        
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        
        const weekRecords = DiezmosModule.getRecordsByDateRange(Utils.formatDate(weekAgo), Utils.formatDate(now));
        const monthRecords = DiezmosModule.getRecordsByDateRange(Utils.formatDate(monthAgo), Utils.formatDate(now));
        const yearRecords = DiezmosModule.getRecordsByDateRange(Utils.formatDate(yearAgo), Utils.formatDate(now));
        
        const resumenSemanal = { total: weekRecords.reduce((sum, r) => sum + r.total, 0) };
        const resumenMensual = { total: monthRecords.reduce((sum, r) => sum + r.total, 0) };
        const resumenAnual = { total: yearRecords.reduce((sum, r) => sum + r.total, 0) };

        const html = `
            <div class="page active" id="diezmos-page">
                <h2><i class="fas fa-hand-holding-heart"></i> Diezmos y Ofrendas</h2>
                <p style="margin: 10px 0 20px; color: var(--gray);">Sistema automatico de diezmos basado en ventas diarias</p>
                
                <div class="card" style="background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); color: white;">
                    <h3 style="color: white;"><i class="fas fa-calendar-day"></i> Vista Previa de Hoy</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 15px 0;">
                        <div style="background: rgba(255,255,255,0.2); padding: 15px; border-radius: 8px; text-align: center;">
                            <div style="font-size: 0.9rem; margin-bottom: 5px;">Ganancia Neta</div>
                            <div style="font-size: 1.8rem; font-weight: bold;" id="preview-income">${Utils.formatCurrency(preview.netProfit || 0)}</div>
                        </div>
                        <div style="background: rgba(255,255,255,0.2); padding: 15px; border-radius: 8px; text-align: center;">
                            <div style="font-size: 0.9rem; margin-bottom: 5px;" id="preview-diezmo-label">Diezmo (${DiezmosModule.config.diezmoPercent}%)</div>
                            <div style="font-size: 1.8rem; font-weight: bold;" id="preview-diezmo">${Utils.formatCurrency(preview.diezmo)}</div>
                        </div>
                        <div style="background: rgba(255,255,255,0.2); padding: 15px; border-radius: 8px; text-align: center;">
                            <div style="font-size: 0.9rem; margin-bottom: 5px;" id="preview-ofrenda-label">Ofrenda (${DiezmosModule.config.ofrendaPercent}%)</div>
                            <div style="font-size: 1.8rem; font-weight: bold;" id="preview-ofrenda">${Utils.formatCurrency(preview.ofrenda)}</div>
                        </div>
                        <div style="background: rgba(255,255,255,0.2); padding: 15px; border-radius: 8px; text-align: center;">
                            <div style="font-size: 0.9rem; margin-bottom: 5px;">Total</div>
                            <div style="font-size: 1.8rem; font-weight: bold;" id="preview-total">${Utils.formatCurrency(preview.total)}</div>
                        </div>
                    </div>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-cog"></i> Configuración de Porcentajes</h3>
                    <p style="margin-bottom: 15px; color: var(--gray); font-size: 0.9rem;">
                        <i class="fas fa-info-circle"></i> Los cambios se reflejan en tiempo real
                    </p>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div class="form-group">
                            <label class="form-label">Diezmo (%)</label>
                            <input type="number" step="0.1" min="0" max="100" class="form-input" 
                                   id="diezmo-percent" value="${DiezmosModule.config.diezmoPercent}" 
                                   oninput="App.updateDiezmosPreview(); App.autoSaveDiezmosConfig()">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Ofrenda (%)</label>
                            <input type="number" step="0.1" min="0" max="100" class="form-input" 
                                   id="ofrenda-percent" value="${DiezmosModule.config.ofrendaPercent}" 
                                   oninput="App.updateDiezmosPreview(); App.autoSaveDiezmosConfig()">
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="App.saveDiezmosConfig()" style="width: 100%; margin-top: 10px;">
                        <i class="fas fa-save"></i> Guardar Configuración
                    </button>
                </div>

                <div class="card">
                    <h3><i class="fas fa-save"></i> Guardar Diezmos del Día</h3>
                    <p style="color: var(--gray); margin-bottom: 15px;">Guarda o actualiza el registro de diezmos para hoy</p>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <button class="btn btn-success" onclick="App.saveDailyDiezmos()">
                            <i class="fas fa-check"></i> Guardar Hoy
                        </button>
                        <button class="btn btn-primary" onclick="App.recalcularTodosDiezmos()">
                            <i class="fas fa-sync-alt"></i> Recalcular Todo
                        </button>
                    </div>
                    <p style="color: var(--gray); font-size: 0.85rem; margin-top: 10px; text-align: center;">
                        <i class="fas fa-info-circle"></i> "Recalcular Todo" procesa automaticamente todos los días con ganancias
                    </p>
                </div>

                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-label">Semanal</div>
                        <div class="stat-value">${Utils.formatCurrency(resumenSemanal.total)}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Mensual</div>
                        <div class="stat-value">${Utils.formatCurrency(resumenMensual.total)}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Anual</div>
                        <div class="stat-value">${Utils.formatCurrency(resumenAnual.total)}</div>
                    </div>
                </div>
                
                <div class="card">
                    <h3><i class="fas fa-history"></i> Historial Automatico (Últimos 30 días)</h3>
                    <ul class="sales-list">
                        ${this.getDiezmosHistoryHTML()}
                    </ul>
                </div>
            </div>
        `;

        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.innerHTML = html;
        }
    },


    
    // NUEVO: Método para actualizar todos los mapas automaticamente
    actualizarMapasAutomaticamente() {
        // Actualizar mapa del dashboard si estamos en esa pagina
        if (this.currentPage === 'dashboard' && this.mapaDashboardInicializado) {
            this.actualizarMapaDashboard();
        }
        
        // Actualizar mapa de rutas si estamos en esa pagina
        if (this.currentPage === 'rutas' && RutasModule.mapaRuta) {
            RutasModule.actualizarMapa();
        }
        
        // También actualizar el contador de pedidos pendientes
        const pedidosPendientes = OrdersModule.getPendingOrders().length;
        if (pedidosPendientes > 0) {
            // Notificar al módulo de rutas que hay nuevos pedidos
            RutasModule.actualizarRutaAutomatica();
        }
    },

    // NUEVO: Sincronizar modo desarrollo con Service Worker
    syncDevModeWithServiceWorker() {
        const savedMode = localStorage.getItem('devMode') === 'true';
        
        // Notificar al Service Worker del estado actual
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SET_DEV_MODE',
                devMode: savedMode
            });
        }
        
        // Escuchar cuando el Service Worker esté listo
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(registration => {
                if (registration.active) {
                    registration.active.postMessage({
                        type: 'SET_DEV_MODE',
                        devMode: savedMode
                    });
                }
            });
        }
    },

    // NUEVO: Toggle Modo Desarrollo
    toggleDevMode(enabled) {
        const devMode = enabled;
        
        // Guardar preferencia INMEDIATAMENTE
        localStorage.setItem('devMode', devMode ? 'true' : 'false');
        
        // Actualizar UI
        this.updateDevModeUI(devMode);
        
        // Notificar al Service Worker
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SET_DEV_MODE',
                devMode: devMode
            });
        }
        
        // Mostrar notificación
        const mensaje = devMode ? 
            'Modo Desarrollo activado. Recarga para ver cambios instantáneos.' : 
            'Modo Producción activado. App funcionará 100% offline.';
        
        Utils.showNotification(mensaje, devMode ? 'warning' : 'success', 5000);
        
        // Sugerir recarga
        setTimeout(async () => {
            const shouldReload = await Utils.showConfirm(
                'Se recomienda recargar la aplicación para aplicar los cambios.',
                'Recargar Aplicación',
                'Recargar',
                'Mas Tarde'
            );
            
            if (shouldReload) {
                window.location.reload();
            }
        }, 1000);
    },

    // NUEVO: Actualizar UI del modo desarrollo
    updateDevModeUI(devMode) {
        const statusText = document.getElementById('dev-mode-status');
        const statusTextMobile = document.getElementById('dev-mode-status-mobile');
        const devModeSwitch = document.getElementById('dev-mode-switch');
        
        // Sincronizar el switch
        if (devModeSwitch) {
            devModeSwitch.checked = devMode;
        }
        
        // Actualizar ambos elementos de estado
        [statusText, statusTextMobile].forEach(element => {
            if (element) {
                if (devMode) {
                    element.textContent = 'Modo Desarrollo: Cache desactivado';
                    element.style.color = 'rgba(255, 193, 7, 0.8)';
                } else {
                    element.textContent = 'Modo Produccion: Offline completo';
                    element.style.color = 'rgba(76, 175, 80, 0.8)';
                }
            }
        });
    },

    // NUEVO: Inicializar estado del toggle
    initDevModeToggle() {
        // Cargar estado guardado INMEDIATAMENTE
        const savedMode = localStorage.getItem('devMode') === 'true';
        
        // Actualizar UI con el estado guardado
        this.updateDevModeUI(savedMode);
        
        // Configurar listener para cambios futuros
        const devModeSwitch = document.getElementById('dev-mode-switch');
        if (devModeSwitch) {
            // Remover listeners anteriores para evitar duplicados
            if (this.handleDevModeChange) {
                devModeSwitch.removeEventListener('change', this.handleDevModeChange);
            }
            
            // Agregar nuevo listener
            this.handleDevModeChange = (e) => {
                this.toggleDevMode(e.target.checked);
            };
            devModeSwitch.addEventListener('change', this.handleDevModeChange);
            
            // Asegurar que el checkbox refleje el estado guardado
            devModeSwitch.checked = savedMode;
        }
        
        // Verificar periódicamente que el estado se mantenga sincronizado
        if (this.devModeCheckInterval) {
            clearInterval(this.devModeCheckInterval);
        }
        
        this.devModeCheckInterval = setInterval(() => {
            const currentSavedMode = localStorage.getItem('devMode') === 'true';
            const switchElement = document.getElementById('dev-mode-switch');
            
            if (switchElement && switchElement.checked !== currentSavedMode) {
                switchElement.checked = currentSavedMode;
                this.updateDevModeUI(currentSavedMode);
            }
        }, 1000); // Verificar cada segundo
    },

    // NUEVO: Forzar actualización del cache
    forceUpdateCache() {
        // Recarga forzada sin cache
        window.location.reload(true);
    },

    // NUEVO: Limpiar recursos del modo desarrollo
    cleanupDevMode() {
        if (this.devModeCheckInterval) {
            clearInterval(this.devModeCheckInterval);
            this.devModeCheckInterval = null;
        }
        
        const devModeSwitch = document.getElementById('dev-mode-switch');
        if (devModeSwitch && this.handleDevModeChange) {
            devModeSwitch.removeEventListener('change', this.handleDevModeChange);
            this.handleDevModeChange = null;
        }
    },

    
    // Probar backup automatico (mantener solo esta función)
    async testAutoBackup() {
        if (typeof AutoBackup === 'undefined') {
            Utils.showNotification('Sistema de backup automatico no disponible', 'error', 3000);
            return;
        }
        
        const hasCredentials = await AutoBackup.hasCredentials();
        
        if (!hasCredentials) {
            Utils.showNotification('Configura tus credenciales de Telegram primero en la pagina de Backups', 'warning', 5000);
            return;
        }
        
        const confirmed = await Utils.showConfirm(
            '¿Forzar backup automatico ahora? Esto creara y enviara un backup a Telegram.',
            'Probar Backup Automatico',
            'Sí, crear backup',
            'Cancelar'
        );
        
        if (!confirmed) return;
        
        Utils.showLoading(true);
        
        try {
            await AutoBackup.forceBackup();
            Utils.showLoading(false);
            Utils.showNotification('Backup automatico enviado correctamente', 'success', 5000);
        } catch (error) {
            Utils.showLoading(false);
            Utils.showNotification(`Error: ${error.message}`, 'error', 5000);
        }
    },

    // Manejar acciones de notificaciones
    async handleNotificationAction(action, data) {
        console.log('========================================');
        console.log('🔔 PROCESANDO ACCIÓN DE NOTIFICACIÓN');
        console.log('Acción:', action);
        console.log('Datos:', data);
        console.log('========================================');
        
        // Si no hay acción o es 'open', solo abrir la app
        if (!action || action === 'open' || action === 'dismiss') {
            console.log('ℹ️ Acción básica, no requiere procesamiento');
            return;
        }
        
        switch(action) {
            case 'calculate':
                // Ir a pagina de merma
                console.log('📊 Navegando a pagina de merma');
                this.loadPage('merma');
                Utils.showNotification('Calcula la merma del día', 'info', 3000);
                break;
                
            case 'pay-full':
                // Pagar deuda completa del cliente
                console.log('💵 Pago completo para cliente:', data.clientId);
                if (data.clientId) {
                    this.loadPage('creditos');
                    setTimeout(async () => {
                        const confirmed = await Utils.showConfirm(
                            `¿Pagar toda la deuda de ${data.clientName}?\nTotal: ${Utils.formatCurrency(data.totalDebt)}`,
                            'Confirmar Pago Completo',
                            'Pagar',
                            'Cancelar'
                        );
                        if (confirmed) {
                            Utils.showNotification(`Procesando pago de ${data.clientName}`, 'info', 3000);
                            // Aquí iría la lógica de pago completo
                        }
                    }, 1000);
                }
                break;
                
            case 'pay-partial':
                // Hacer abono parcial
                console.log('💰 Abono parcial para cliente:', data.clientId);
                if (data.clientId) {
                    this.loadPage('creditos');
                    setTimeout(() => {
                        Utils.showNotification(`Selecciona la venta de ${data.clientName} para hacer el abono`, 'info', 5000);
                    }, 1000);
                }
                break;
                
            case 'view':
                // Ver detalles de créditos
                console.log('Ver detalles de créditos');
                this.loadPage('creditos');
                break;
                
            case 'backup-now':
                // Crear backup
                console.log('💾 Crear backup');
                this.loadPage('backup');
                setTimeout(() => {
                    Utils.showNotification('Crea tu backup desde esta pagina', 'info', 3000);
                }, 1000);
                break;
                
            default:
                console.log('⚠️ Acción no manejada:', action);
        }
    }
};

// ─── Toggle de venta automática (§3.4) ───────────────────────────────────────

/**
 * Maneja el toggle "Auto" en la página de ventas (APK nativo).
 * Activa/desactiva el motor de venta automática y actualiza el chip del header.
 */
App._onAutoSaleToggle = function(enabled) {
    if (enabled) {
        localStorage.setItem('autoSale.enabled', '1');
        // Activar motor si está disponible
        if (typeof initNativeAutoSale === 'function' && !window._autoSaleInitialized) {
            initNativeAutoSale({
                mode: 'auto',
                minWeightLb: 3.50,
                stableReadings: 3,
                stableWindowMs: 2000,
                minIntervalSamePlaceMs: 60000,
                geofenceRadiusM: 150,
                sriEnabled: false
            });
            window._autoSaleInitialized = true;
        }
        Utils.showNotification('Venta automática activada', 'success', 2500);
    } else {
        localStorage.removeItem('autoSale.enabled');
        Utils.showNotification('Venta automática desactivada', 'info', 2500);
    }
    App._updateAutoSaleChip(enabled);
};

/**
 * Actualiza el chip indicador del header según el estado del toggle Auto.
 * @param {boolean} on - true = activo (verde pulsante), false = inactivo (gris)
 */
App._updateAutoSaleChip = function(on) {
    const chip = document.getElementById('autoSaleChip');
    if (!chip) return;
    chip.hidden = false;
    if (on) {
        chip.className = 'chip chip--on';
    } else {
        chip.className = 'chip chip--off';
    }
};

// Inicializar chip al cargar la app (APK nativo)
(function() {
    var isNative = window.Capacitor &&
                   window.Capacitor.isNativePlatform &&
                   window.Capacitor.isNativePlatform();
    if (!isNative) return;
    var enabled = localStorage.getItem('autoSale.enabled') === '1';
    // Esperar a que el DOM esté listo
    document.addEventListener('DOMContentLoaded', function() {
        App._updateAutoSaleChip(enabled);
    });
})();

// Suprimir errores de extensiones globalmente
window.addEventListener('unhandledrejection', (e) => {
    if (e.reason && e.reason.message && e.reason.message.includes('Could not establish connection')) {
        e.preventDefault();
    }
});

// Inicializar la aplicación
document.addEventListener('DOMContentLoaded', () => {
    // Prevenir zoom en inputs
    document.addEventListener('touchstart', (event) => {
        if (event.touches.length > 1) {
            event.preventDefault();
        }
    }, { passive: false });

    let lastTouchEnd = 0;
    document.addEventListener('touchend', (event) => {
        const now = (new Date()).getTime();
        if (now - lastTouchEnd <= 300) {
            event.preventDefault();
        }
        lastTouchEnd = now;
    }, false);

    // NOTA: App.init() se llama desde index.html cuando el DOM esta listo
    // No llamar aquí para evitar doble inicialización
});

// Limpiar recursos al cerrar/recargar la pagina
window.addEventListener('beforeunload', () => {
    App.cleanupDevMode();
});

// También limpiar cuando la pagina se oculta (móviles)
window.addEventListener('pagehide', () => {
    App.cleanupDevMode();
});






// Modo Pesaje en Cadena
App.startChainWeighing = function() {
    const todaySalePrice = MermaModule.getTodaySalePrice();
    const todayCostPrice = MermaModule.getTodayMermaPrice();
    const hasScale = BluetoothScale.isConnected;

    if (!todaySalePrice) {
        Utils.showNotification('Configura el precio de venta del día en Merma primero', 'warning', 4000);
        App.loadPage('merma');
        return;
    }

    const activeClients = ClientsModule.clients.filter(c => c.isActive !== false);

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'chain-weighing-modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:420px;">
            <div class="modal-header" style="background:var(--primary);color:white;border-radius:12px 12px 0 0;">
                <h3 style="color:white;"><i class="fas fa-weight"></i> Pesaje en Cadena</h3>
                <button class="close-modal" onclick="App.stopChainWeighing()" style="color:white;"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body" style="padding:20px;">

                <!-- Cliente activo (se selecciona al inicio) -->
                <div style="margin-bottom:16px;">
                    <label class="form-label" style="font-weight:600;"><i class="fas fa-user"></i> Cliente activo</label>
                    <input type="text" class="form-input" id="chain-client-search"
                           placeholder="Buscar cliente..." autocomplete="off"
                           oninput="App.filterChainClients(this.value)"
                           style="margin-bottom:6px;">
                    <select class="form-input" id="chain-client-select" size="4" style="height:auto;" onchange="App._onChainClientChange()">
                        <option value="">-- Seleccionar cliente --</option>
                        ${activeClients.map(c => `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`).join('')}
                    </select>
                    <div id="chain-gps-indicator" style="display:block;margin-top:6px;font-size:0.8rem;color:var(--gray);padding:6px 8px;background:var(--light);border-radius:6px;">
                        <i class="fas fa-satellite-dish" style="color:var(--warning);"></i> Iniciando GPS...
                    </div>
                    <div id="chain-gps-debug" style="display:none;margin-top:4px;font-size:0.75rem;color:var(--gray);padding:4px 8px;background:#f0f0f0;border-radius:6px;font-family:monospace;word-break:break-all;"></div>
                </div>

                <!-- Cantidad y pago -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
                    <div class="form-group" style="margin:0;">
                        <label class="form-label"><i class="fas fa-egg"></i> Pollos</label>
                        <input type="number" class="form-input" id="chain-quantity" min="1" value="1">
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label class="form-label"><i class="fas fa-credit-card"></i> Pago</label>
                        <select class="form-input" id="chain-payment">
                            <option value="cash">Efectivo</option>
                            <option value="credit">Credito</option>
                        </select>
                    </div>
                </div>

                <!-- Peso: balanza o manual -->
                <div style="text-align:center;padding:20px;background:var(--light);border-radius:12px;margin-bottom:16px;">
                    <div style="color:var(--gray);font-size:0.85rem;margin-bottom:5px;">
                        ${hasScale ? 'PESO EN BALANZA (AUTO)' : 'INGRESA EL PESO'}
                    </div>
                    ${hasScale ? `
                    <div id="chain-weight-display" style="font-size:3.5rem;font-weight:bold;color:var(--primary);line-height:1;">0.000</div>
                    <div id="chain-unit-display" style="font-size:1rem;color:var(--gray);">lb</div>
                    <div id="chain-stable-indicator" style="margin-top:8px;font-size:0.85rem;color:var(--gray);">
                        <i class="fas fa-circle" style="color:#ccc;"></i> Selecciona cliente y pon un pollo
                    </div>` : `
                    <div style="display:flex;align-items:center;gap:10px;justify-content:center;margin-top:10px;">
                        <input type="number" step="0.001" min="0" class="form-input" id="chain-manual-weight"
                               placeholder="0.000" style="font-size:2rem;font-weight:bold;text-align:center;max-width:180px;"
                               oninput="App.updateChainPreview()">
                        <select class="form-input" id="chain-manual-unit" style="max-width:80px;" onchange="App.updateChainPreview()">
                            <option value="lb">lb</option>
                            <option value="kg">kg</option>
                        </select>
                    </div>
                    <button class="btn btn-primary" style="margin-top:12px;width:100%;" onclick="App.captureManualChainWeight()">
                        <i class="fas fa-check"></i> Confirmar peso
                    </button>`}
                </div>

                <!-- Precio del dia -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
                    <div style="background:#e8f5e9;padding:12px;border-radius:8px;text-align:center;">
                        <div style="font-size:0.75rem;color:var(--gray);">PRECIO VENTA/lb</div>
                        <div style="font-size:1.4rem;font-weight:bold;color:var(--primary);">$${todaySalePrice.toFixed(2)}</div>
                    </div>
                    <div style="background:#fff3e0;padding:12px;border-radius:8px;text-align:center;">
                        <div style="font-size:0.75rem;color:var(--gray);">COSTO/lb</div>
                        <div style="font-size:1.4rem;font-weight:bold;color:var(--warning);">$${todayCostPrice ? todayCostPrice.toFixed(2) : '---'}</div>
                    </div>
                </div>

                <!-- Total estimado -->
                <!-- Ultima venta registrada -->
                <div id="chain-last-sale" style="display:none;background:linear-gradient(135deg,var(--primary),var(--secondary));color:white;padding:15px;border-radius:10px;text-align:center;margin-bottom:16px;">
                    <div style="font-size:0.8rem;opacity:0.9;">VENTA REGISTRADA</div>
                    <div id="chain-last-sale-info" style="font-size:1.1rem;font-weight:bold;margin-top:4px;"></div>
                    <div id="chain-last-sale-total" style="font-size:2rem;font-weight:bold;"></div>
                </div>

                <!-- Resumen del dia -->
                <div style="padding:12px;background:var(--light);border-radius:8px;">
                    <div style="display:flex;justify-content:space-between;font-size:0.85rem;">
                        <span style="color:var(--gray);">Ventas hoy:</span>
                        <strong id="chain-sales-count">${SalesModule.getTodaySales().length}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-top:4px;">
                        <span style="color:var(--gray);">Total lb vendidas:</span>
                        <strong id="chain-total-lbs">${SalesModule.getTotalWeightByDate(Utils.getTodayDate()).toFixed(2)} lb</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-top:4px;">
                        <span style="color:var(--gray);">Total cobrado:</span>
                        <strong id="chain-total-revenue">${Utils.formatCurrency(SalesModule.getTotalSalesByDate(Utils.getTodayDate()))}</strong>
                    </div>
                </div>
            </div>
        </div>`;

    document.body.appendChild(modal);

    // Notificar al servicio nativo que el modal esta activo (evita doble factura)
    const _bleFg = window.Capacitor && window.Capacitor.isNativePlatform &&
                   window.Capacitor.isNativePlatform() &&
                   window.Capacitor.Plugins && window.Capacitor.Plugins.BleForeground;
    if (_bleFg && _bleFg.setChainModalActive) {
        _bleFg.setChainModalActive({ active: true }).catch(() => {});
    }

    // Estado interno del modo cadena
    App._chainState = {
        stableTimer: null,
        lastWeight: 0,
        waitingForZero: false,
        salePrice: todaySalePrice,
        costPrice: todayCostPrice,
        gpsTimer: null,
        gpsWatchId: null
    };

    // Si hay balanza, escuchar cambios de peso en tiempo real
    if (hasScale) {
        const unsubscribe = BluetoothScale.onWeight((weight) => {
            App._handleChainWeight(weight);
        });
        App._chainWeighingUnsubscribe = unsubscribe;
    }

    // Iniciar GPS automaticamente para pre-seleccionar cliente cercano
    App._startChainGps();

    // Mostrar indicador GPS inmediatamente
    const gpsIndicator = document.getElementById('chain-gps-indicator');
    if (gpsIndicator) {
        gpsIndicator.style.display = 'block';
        gpsIndicator.innerHTML = '<i class="fas fa-satellite-dish" style="color:var(--warning);"></i> Buscando cliente cercano...';
    }

    App._chainWeighingWeight = 0;
};

App.stopChainWeighing = function() {
    if (App._chainWeighingUnsubscribe) {
        App._chainWeighingUnsubscribe();
        App._chainWeighingUnsubscribe = null;
    }
    if (App._chainState && App._chainState.stableTimer) {
        clearTimeout(App._chainState.stableTimer);
    }
    App._stopChainGps();
    App._chainState = null;

    // Notificar al servicio nativo que el modal se cerro
    const _bleFg = window.Capacitor && window.Capacitor.isNativePlatform &&
                   window.Capacitor.isNativePlatform() &&
                   window.Capacitor.Plugins && window.Capacitor.Plugins.BleForeground;
    if (_bleFg && _bleFg.setChainModalActive) {
        _bleFg.setChainModalActive({ active: false }).catch(() => {});
    }

    const modal = document.getElementById('chain-weighing-modal');
    if (modal) modal.remove();
};

App._showChainClientSection = function(weight, salePrice, costPrice) {
    // Mantenido por compatibilidad con modo manual
    const totalPreview = document.getElementById('chain-total-preview');
    const totalAmount = document.getElementById('chain-total-amount');
    const profitAmount = document.getElementById('chain-profit-amount');
    const clientSection = document.getElementById('chain-client-section');

    const total = weight * salePrice;
    const profit = costPrice ? weight * (salePrice - costPrice) : 0;
    if (totalPreview) totalPreview.style.display = 'block';
    if (totalAmount) totalAmount.textContent = Utils.formatCurrency(total);
    if (profitAmount) profitAmount.textContent = `Ganancia: ${Utils.formatCurrency(profit)}`;
    if (clientSection) clientSection.style.display = 'block';
};

// Manejar cada lectura de peso en modo cadena automatico
App._handleChainWeight = function(weight) {
    const state = App._chainState;
    if (!state) return;

    const raw = BluetoothScale.currentRawWeight;
    const display = document.getElementById('chain-weight-display');
    const unitDisplay = document.getElementById('chain-unit-display');
    const stableIndicator = document.getElementById('chain-stable-indicator');

    if (display) display.textContent = raw.toFixed(3);
    if (unitDisplay) unitDisplay.textContent = BluetoothScale.currentUnit;

    // Si estamos esperando que retiren el pollo (peso vuelva a 0)
    if (state.waitingForZero) {
        if (raw < 0.5) {
            state.waitingForZero = false;
            state.lastWeight = 0;
            App._chainWeighingWeight = 0;
            if (stableIndicator) stableIndicator.innerHTML = '<i class="fas fa-circle" style="color:#ccc;"></i> Pon el siguiente pollo';
        }
        return;
    }

    // Detectar cambio de peso
    if (Math.abs(raw - state.lastWeight) > 0.01) {
        state.lastWeight = raw;
        clearTimeout(state.stableTimer);

        if (raw > 3.50) {
            // Peso valido — esperar estabilizacion
            if (stableIndicator) stableIndicator.innerHTML = '<i class="fas fa-circle" style="color:orange;"></i> Estabilizando...';
            state.stableTimer = setTimeout(() => {
                // Verificar que el peso sigue estable
                if (Math.abs(BluetoothScale.currentRawWeight - raw) < 0.05) {
                    App._autoRegisterChainSale(raw);
                }
            }, 1500);
        } else if (raw < 0.5) {
            // Balanza vacia
            if (stableIndicator) stableIndicator.innerHTML = '<i class="fas fa-circle" style="color:#ccc;"></i> Pon un pollo en la balanza';
        } else {
            // Peso menor a 3.50 — no registrar
            if (stableIndicator) stableIndicator.innerHTML = '<i class="fas fa-circle" style="color:orange;"></i> ' + raw.toFixed(3) + ' lb — minimo 3.50 lb';
        }
    }
};

// Registrar venta automaticamente cuando el peso es estable > 3.50
App._autoRegisterChainSale = function(weight) {
    const state = App._chainState;
    if (!state) return;

    const clientSelect = document.getElementById('chain-client-select');
    const clientIdRaw = clientSelect ? clientSelect.value : '';
    const clientId = parseInt(clientIdRaw) || clientIdRaw;

    if (!clientId) {
        const stableIndicator = document.getElementById('chain-stable-indicator');
        if (stableIndicator) stableIndicator.innerHTML = '<i class="fas fa-circle" style="color:red;"></i> Selecciona un cliente primero';
        return;
    }

    const quantity = parseInt(document.getElementById('chain-quantity')?.value) || 1;
    const payment = document.getElementById('chain-payment')?.value || 'cash';
    const isPaid = payment === 'cash';

    const sale = SalesModule.addSale(clientId, weight, quantity, state.salePrice, null, isPaid);
    // NO llamar ClientsModule.updateClientStats — SalesModule.addSale ya lo hace

    const client = ClientsModule.getClientById(clientId);

    // Mostrar confirmacion visual
    const lastSaleDiv = document.getElementById('chain-last-sale');
    const lastSaleInfo = document.getElementById('chain-last-sale-info');
    const lastSaleTotal = document.getElementById('chain-last-sale-total');
    if (lastSaleDiv) lastSaleDiv.style.display = 'block';
    if (lastSaleInfo) lastSaleInfo.textContent = (client ? client.name : 'Cliente') + ' — ' + weight.toFixed(3) + ' lb';
    if (lastSaleTotal) lastSaleTotal.textContent = Utils.formatCurrency(sale.total);

    // Actualizar resumen
    const salesCount = document.getElementById('chain-sales-count');
    const totalLbs = document.getElementById('chain-total-lbs');
    const totalRevenue = document.getElementById('chain-total-revenue');
    if (salesCount) salesCount.textContent = SalesModule.getTodaySales().length;
    if (totalLbs) totalLbs.textContent = SalesModule.getTotalWeightByDate(Utils.getTodayDate()).toFixed(2) + ' lb';
    if (totalRevenue) totalRevenue.textContent = Utils.formatCurrency(SalesModule.getTotalSalesByDate(Utils.getTodayDate()));

    const stableIndicator = document.getElementById('chain-stable-indicator');
    if (stableIndicator) stableIndicator.innerHTML = '<i class="fas fa-circle" style="color:var(--success);"></i> Registrado — retira el pollo';

    // Vibracion de confirmacion
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    // Marcar que esperamos que retiren el pollo
    state.waitingForZero = true;
    App._chainWeighingWeight = 0;

    Utils.showNotification((client ? client.name : 'Cliente') + ' — ' + weight.toFixed(3) + ' lb — ' + Utils.formatCurrency(sale.total), 'success', 3000);
};

// Cuando cambia el cliente seleccionado en modo cadena
App._onChainClientChange = function() {
    const stableIndicator = document.getElementById('chain-stable-indicator');
    const clientSelect = document.getElementById('chain-client-select');
    if (!clientSelect || !clientSelect.value) return;
    if (stableIndicator && App._chainState && !App._chainState.waitingForZero) {
        stableIndicator.innerHTML = '<i class="fas fa-circle" style="color:#ccc;"></i> Pon un pollo en la balanza';
    }
};

// GPS automatico para pre-seleccionar cliente cercano en modo cadena
App._startChainGps = function() {
    const state = App._chainState;
    if (!state) return;

    const plugin = (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
        ? (window.Capacitor.Plugins && window.Capacitor.Plugins.BleForeground)
        : null;

    const onLocation = function(lat, lng) {
        App._chainAutoSelectClient(lat, lng);
    };

    if (plugin) {
        // APK nativo: leer GPS del servicio cada 4s (funciona con app minimizada)
        const poll = async function() {
            try {
                const loc = await plugin.getLocation();
                const gpsIndicator = document.getElementById('chain-gps-indicator');
                if (loc && loc.hasLocation) {
                    // Guardar como ultima posicion conocida
                    localStorage.setItem('galloli_last_known_pos', JSON.stringify([loc.lat, loc.lng]));
                    onLocation(loc.lat, loc.lng);
                } else {
                    if (gpsIndicator) {
                        gpsIndicator.innerHTML = '<i class="fas fa-satellite-dish" style="color:var(--warning);"></i> GPS nativo: sin fix aun...';
                        gpsIndicator.style.display = 'block';
                    }
                }
            } catch(e) {
                const gpsIndicator = document.getElementById('chain-gps-indicator');
                if (gpsIndicator) {
                    gpsIndicator.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:red;"></i> Error GPS nativo: ' + e.message;
                    gpsIndicator.style.display = 'block';
                }
            }
        };
        poll();
        state.gpsTimer = setInterval(poll, 4000);
    } else if (navigator.geolocation) {
        // PWA/TWA: watchPosition normal
        state.gpsWatchId = navigator.geolocation.watchPosition(
            function(pos) { onLocation(pos.coords.latitude, pos.coords.longitude); },
            function(err) {
                const gpsIndicator = document.getElementById('chain-gps-indicator');
                if (gpsIndicator) {
                    const msgs = ['', 'Permiso GPS denegado', 'GPS no disponible', 'Timeout GPS'];
                    gpsIndicator.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:red;"></i> ' + (msgs[err.code] || 'Error GPS');
                    gpsIndicator.style.display = 'block';
                }
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
        // Leer inmediatamente
        navigator.geolocation.getCurrentPosition(
            function(pos) { onLocation(pos.coords.latitude, pos.coords.longitude); },
            function(err) {
                const gpsIndicator = document.getElementById('chain-gps-indicator');
                if (gpsIndicator) {
                    const msgs = ['', 'Permiso GPS denegado — activa ubicacion', 'GPS no disponible', 'Timeout GPS'];
                    gpsIndicator.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:red;"></i> ' + (msgs[err.code] || 'Error GPS');
                    gpsIndicator.style.display = 'block';
                }
            },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
    } else {
        const gpsIndicator = document.getElementById('chain-gps-indicator');
        if (gpsIndicator) {
            gpsIndicator.innerHTML = '<i class="fas fa-times-circle" style="color:red;"></i> GPS no soportado en este dispositivo';
            gpsIndicator.style.display = 'block';
        }
    }
};

App._stopChainGps = function() {
    const state = App._chainState;
    if (!state) return;
    if (state.gpsTimer) { clearInterval(state.gpsTimer); state.gpsTimer = null; }
    if (state.gpsWatchId != null) {
        navigator.geolocation.clearWatch(state.gpsWatchId);
        state.gpsWatchId = null;
    }
};

// Seleccionar automaticamente el cliente mas cercano segun GPS
App._chainAutoSelectClient = function(lat, lng) {
    // Guardar como ultima posicion conocida (fallback para el mapa)
    localStorage.setItem('galloli_last_known_pos', JSON.stringify([lat, lng]));

    const gpsIndicator = document.getElementById('chain-gps-indicator');
    const debugEl = document.getElementById('chain-gps-debug');

    // Mostrar coordenadas actuales en debug
    if (debugEl) {
        debugEl.style.display = 'block';
        debugEl.textContent = 'GPS: ' + lat.toFixed(6) + ', ' + lng.toFixed(6);
    }

    // Todos los clientes activos con coordenadas
    const allClients = ClientsModule.clients || [];
    const withCoords = allClients.filter(function(c) {
        return c.isActive !== false &&
               c.coordinates &&
               (c.coordinates.lat !== null && c.coordinates.lat !== undefined) &&
               (c.coordinates.lng !== null && c.coordinates.lng !== undefined);
    });

    if (debugEl) {
        debugEl.textContent += ' | Total: ' + allClients.length +
            ' activos con coords: ' + withCoords.length;
    }

    if (withCoords.length === 0) {
        if (gpsIndicator) {
            gpsIndicator.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:var(--warning);"></i> Clientes sin coordenadas GPS guardadas';
            gpsIndicator.style.display = 'block';
        }
        return;
    }

    // Calcular distancia a todos y encontrar el mas cercano
    let nearest = null;
    let minDist = Infinity;
    let closestDist = Infinity; // para mostrar aunque no esté en radio

    withCoords.forEach(function(c) {
        try {
            const cLat = parseFloat(c.coordinates.lat);
            const cLng = parseFloat(c.coordinates.lng);
            if (isNaN(cLat) || isNaN(cLng)) return;
            const dist = App._haversineM(lat, lng, cLat, cLng);
            if (dist < closestDist) closestDist = dist;
            if (dist < 500 && dist < minDist) { // radio 500m
                minDist = dist;
                nearest = c;
            }
        } catch(e) {}
    });

    if (debugEl && closestDist < Infinity) {
        debugEl.textContent += ' | Mas cercano: ' + Math.round(closestDist) + 'm';
    }

    const select = document.getElementById('chain-client-select');
    if (!select) return;

    if (nearest) {
        const nearestId = String(nearest.id);
        let found = false;
        for (let i = 0; i < select.options.length; i++) {
            if (String(select.options[i].value) === nearestId) {
                select.selectedIndex = i;
                found = true;
                break;
            }
        }
        if (gpsIndicator) {
            gpsIndicator.innerHTML = '<i class="fas fa-map-marker-alt" style="color:var(--success);"></i> ' +
                nearest.name + ' (' + Math.round(minDist) + 'm)';
            gpsIndicator.style.display = 'block';
        }
    } else {
        if (gpsIndicator) {
            const msg = closestDist < Infinity
                ? 'Mas cercano: ' + Math.round(closestDist) + 'm (radio 500m)'
                : 'Sin clientes con GPS';
            gpsIndicator.innerHTML = '<i class="fas fa-map-marker-alt" style="color:var(--warning);"></i> ' + msg;
            gpsIndicator.style.display = 'block';
        }
    }
};

// Calculo de distancia Haversine en metros
App._haversineM = function(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ─── Ventas en segundo plano (APK nativo) ────────────────────────────────────

/**
 * Procesa ventas registradas por el servicio nativo mientras la app estaba minimizada.
 * Se llama automaticamente al volver a primer plano.
 */
App._processPendingNativeSales = async function() {
    try {
        const plugin = window.Capacitor &&
                       window.Capacitor.isNativePlatform &&
                       window.Capacitor.isNativePlatform() &&
                       window.Capacitor.Plugins &&
                       window.Capacitor.Plugins.BleForeground;
        if (!plugin) return;

        const result = await plugin.getPendingSales();
        if (!result || !result.sales) return;

        let sales;
        try { sales = JSON.parse(result.sales); } catch(e) { return; }
        if (!Array.isArray(sales) || sales.length === 0) return;

        console.log('📦 Procesando', sales.length, 'ventas de segundo plano...');

        let processed = 0;
        for (const s of sales) {
            try {
                const clientId = parseInt(s.clientId) || s.clientId;
                const client = ClientsModule.getClientById(clientId);
                if (!client) { console.warn('Cliente no encontrado:', s.clientId); continue; }

                // Ventas background siempre a credito — SalesModule.addSale ya llama updateClientStats
                const sale = SalesModule.addSale(
                    clientId,
                    s.weight,
                    s.quantity || 1,
                    s.salePrice,
                    null,
                    false,  // isPaid = false (credito)
                    0       // initialPayment = 0
                );
                // NO llamar ClientsModule.updateClientStats aqui — SalesModule.addSale ya lo hace
                sale.autoGenerated = true;
                sale.source = s.source || 'background_auto';
                sale.nativeTimestamp = s.timestamp || Date.now();
                sale.lastModified = Date.now();
                await SalesModule.saveSales();
                processed++;

                console.log('✅ Venta background (credito):', client.name, s.weight + 'lb', Utils.formatCurrency(sale.total));
            } catch(e) {
                console.error('Error procesando venta background:', e);
            }
        }

        if (processed > 0) {
            await plugin.clearPendingSales();

            // Actualizar badge de creditos
            if (typeof CreditosModule !== 'undefined' && CreditosModule.updateCreditBadges) {
                CreditosModule.updateCreditBadges();
            }

            Utils.showNotification(
                processed + ' venta' + (processed > 1 ? 's' : '') + ' a credito registrada' + (processed > 1 ? 's' : '') + ' en segundo plano',
                'success', 4000
            );

            await App.loadAllData();
            App.loadPage(App.currentPage);
        }
    } catch(e) {
        console.warn('Error procesando ventas background:', e);
    }
};

/**
 * Sincroniza clientes y precio al servicio nativo.
 * Se llama al iniciar la app y cuando se conecta la balanza.
 */
App._syncDataToNativeService = function() {
    try {
        const plugin = window.Capacitor &&
                       window.Capacitor.isNativePlatform &&
                       window.Capacitor.isNativePlatform() &&
                       window.Capacitor.Plugins &&
                       window.Capacitor.Plugins.BleForeground;
        if (!plugin) return;

        // Sincronizar clientes
        if (ClientsModule && ClientsModule.clients) {
            const clientsData = ClientsModule.clients.map(c => {
                let coords = null;
                if (c.coordinates) {
                    const lat = parseFloat(c.coordinates.lat);
                    const lng = parseFloat(c.coordinates.lng);
                    if (!isNaN(lat) && !isNaN(lng)) {
                        coords = { lat, lng };
                    }
                }
                return {
                    id: c.id,
                    name: c.name,
                    isActive: c.isActive !== false,
                    coordinates: coords
                };
            });
            console.log('🔄 Sincronizando', clientsData.length, 'clientes,',
                clientsData.filter(c => c.coordinates).length, 'con coordenadas');
            plugin.syncClients({ clientsJson: JSON.stringify(clientsData) }).catch(() => {});
        }

        // Sincronizar precio del dia
        const price = MermaModule.getTodaySalePrice();
        if (price > 0) {
            plugin.syncSalePrice({ price }).catch(() => {});
        }

        // Resetear contadores del dia en el servicio nativo
        plugin.resetDayCounters && plugin.resetDayCounters().catch(() => {});

        console.log('🔄 Datos sincronizados al servicio nativo');
    } catch(e) {
        console.warn('Error sincronizando al servicio nativo:', e);
    }
};

/**
 * Lee el token FCM del servicio nativo y lo registra en el Worker.
 * Resuelve el problema de que GalloliFirebaseService guarda el token
 * en SharedPreferences pero el JS nunca lo leía.
 */
App._registerNativeFcmToken = async function() {
    try {
        const plugin = window.Capacitor &&
                       window.Capacitor.isNativePlatform &&
                       window.Capacitor.isNativePlatform() &&
                       window.Capacitor.Plugins &&
                       window.Capacitor.Plugins.BleForeground;
        if (!plugin || !plugin.getFcmToken) return;

        const result = await plugin.getFcmToken();
        if (!result || !result.hasToken || !result.token) {
            console.log('[FCM] Sin token FCM en SharedPreferences aun');
            return;
        }

        const token = result.token;
        console.log('[FCM] Token FCM leido del servicio nativo:', token.substring(0, 20) + '...');

        // Guardar en window y localStorage para que notify-system.js lo use
        window._fcmToken = token;
        localStorage.setItem('galloli_fcm_token', token);

        // Registrar en el Worker
        if (typeof PushNotifications !== 'undefined' && PushNotifications.registerFcmToken) {
            await PushNotifications.registerFcmToken(token);
        }
    } catch(e) {
        console.warn('[FCM] Error leyendo token nativo:', e.message);
    }
};

// ─── Fin ventas en segundo plano ─────────────────────────────────────────────

/**
 * Cede el control BLE al servicio nativo cuando la app va a background.
 * El servicio nativo reconecta la balanza y registra ventas automaticamente.
 */
App._handoffBleToNativeService = async function() {
    try {
        const isNative = window.Capacitor &&
            window.Capacitor.isNativePlatform &&
            window.Capacitor.isNativePlatform();
        if (!isNative) return;

        const plugin = window.Capacitor.Plugins && window.Capacitor.Plugins.BleForeground;
        if (!plugin) return;

        // Sincronizar clientes y precio antes de ceder control
        App._syncDataToNativeService();

        // Cerrar modal si esta activo para no dejar chain_modal_active=true
        if (document.getElementById('chain-weighing-modal')) {
            App.stopChainWeighing();
        }

        // Si JS tiene conexion BLE abierta, guardar device ID y desconectar
        if (window.BluetoothScale && BluetoothScale.isConnected) {
            try {
                const deviceId = BluetoothScale._nativeDeviceId || BluetoothScale.activeScaleId;
                if (deviceId && plugin.saveBleDeviceId) {
                    await plugin.saveBleDeviceId({ deviceId: String(deviceId) });
                }
                await BluetoothScale.disconnect();
            } catch(e) {
                console.warn('[Handoff] No se pudo desconectar BLE JS:', e.message);
            }
        }

        // Notificar al servicio que tome el control
        if (plugin.releaseBleToService) {
            await plugin.releaseBleToService();
        } else if (plugin.notifyJsDisconnected) {
            await plugin.notifyJsDisconnected({});
        }

        console.log('[Handoff] BLE cedido al servicio nativo');
    } catch(e) {
        console.warn('[Handoff] Error cediendo BLE al servicio nativo:', e.message);
    }
};

App.updateChainPreview = function() {
    const weightEl = document.getElementById('chain-manual-weight');
    const unitEl = document.getElementById('chain-manual-unit');
    if (!weightEl) return;
    const raw = parseFloat(weightEl.value) || 0;
    const unit = unitEl ? unitEl.value : 'lb';
    const lbs = unit === 'kg' ? raw * 2.20462 : raw;
    const salePrice = MermaModule.getTodaySalePrice();
    const costPrice = MermaModule.getTodayMermaPrice();
    if (raw > 0 && salePrice) {
        App._showChainClientSection(lbs, salePrice, costPrice);
        App._chainWeighingWeight = lbs;
    }
};

App.captureManualChainWeight = function() {
    const weightEl = document.getElementById('chain-manual-weight');
    const unitEl = document.getElementById('chain-manual-unit');
    if (!weightEl || !parseFloat(weightEl.value)) {
        Utils.showNotification('Ingresa el peso', 'warning', 2000);
        return;
    }
    const raw = parseFloat(weightEl.value);
    const unit = unitEl ? unitEl.value : 'lb';
    const lbs = unit === 'kg' ? raw * 2.20462 : raw;
    App._chainWeighingWeight = lbs;
    const salePrice = MermaModule.getTodaySalePrice();
    const costPrice = MermaModule.getTodayMermaPrice();
    App._showChainClientSection(lbs, salePrice, costPrice);
};

App.cancelChainCapture = function() {
    const clientSection = document.getElementById('chain-client-section');
    const totalPreview = document.getElementById('chain-total-preview');
    const stableIndicator = document.getElementById('chain-stable-indicator');
    const manualWeight = document.getElementById('chain-manual-weight');
    if (clientSection) clientSection.style.display = 'none';
    if (totalPreview) totalPreview.style.display = 'none';
    if (stableIndicator) stableIndicator.innerHTML = '<i class="fas fa-circle" style="color:#ccc;"></i> Pon un pollo en la balanza';
    if (manualWeight) manualWeight.value = '';
    App._chainWeighingWeight = 0;
};

App.filterChainClients = function(query) {
    const select = document.getElementById('chain-client-select');
    if (!select) return;
    const q = query.toLowerCase().trim();
    const clients = ClientsModule.clients.filter(c => c.isActive !== false);
    select.innerHTML = '<option value="">-- Seleccionar --</option>' +
        clients.filter(c => !q || c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q)))
               .map(c => `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`)
               .join('');
    // Si solo hay un resultado, seleccionarlo automaticamente
    if (select.options.length === 2) select.selectedIndex = 1;
};

App.confirmChainSale = function() {
    const clientIdRaw = document.getElementById('chain-client-select')?.value;
    const clientId = parseInt(clientIdRaw) || clientIdRaw; // convertir a número
    const quantity = parseInt(document.getElementById('chain-quantity')?.value) || 1;
    const payment = document.getElementById('chain-payment')?.value;
    const weight = App._chainWeighingWeight || 0;

    if (!clientId) { Utils.showNotification('Selecciona un cliente', 'warning', 2000); return; }
    if (weight <= 0) { Utils.showNotification('Peso invalido', 'warning', 2000); return; }

    const salePrice = MermaModule.getTodaySalePrice();
    const isPaid = payment === 'cash';

    const sale = SalesModule.addSale(clientId, weight, quantity, salePrice, null, isPaid);
    // NO llamar ClientsModule.updateClientStats — SalesModule.addSale ya lo hace

    // Actualizar resumen
    const salesCount = document.getElementById('chain-sales-count');
    const totalLbs = document.getElementById('chain-total-lbs');
    const totalRevenue = document.getElementById('chain-total-revenue');
    if (salesCount) salesCount.textContent = SalesModule.getTodaySales().length;
    if (totalLbs) totalLbs.textContent = SalesModule.getTotalWeightByDate(Utils.getTodayDate()).toFixed(2) + ' lb';
    if (totalRevenue) totalRevenue.textContent = Utils.formatCurrency(SalesModule.getTotalSalesByDate(Utils.getTodayDate()));

    App.cancelChainCapture();

    const client = ClientsModule.getClientById(clientId);
    Utils.showNotification(`${client?.name} — ${weight.toFixed(3)} lb — ${Utils.formatCurrency(sale.total)}`, 'success', 3000);
};

// ─── Modo GPS Automatico ────────────────────────────────────────────────────

App.startGeoChain = function() {
    const todaySalePrice = MermaModule.getTodaySalePrice();
    const todayCostPrice = MermaModule.getTodayMermaPrice();

    if (!todaySalePrice) {
        Utils.showNotification('Configura el precio de venta del dia en Merma primero', 'warning', 4000);
        App.loadPage('merma');
        return;
    }

    if (!BluetoothScale.isConnected) {
        Utils.showNotification('Conecta la balanza primero', 'warning', 3000);
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.id = 'geo-chain-modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:420px;">
            <div class="modal-header" style="background:linear-gradient(135deg,#2e7d32,#388e3c);color:white;border-radius:12px 12px 0 0;">
                <h3 style="color:white;"><i class="fas fa-map-marker-alt"></i> Modo GPS Automatico</h3>
                <button class="close-modal" onclick="App.stopGeoChain()" style="color:white;"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body" style="padding:20px;">

                <!-- Estado GPS + cliente -->
                <div id="geo-status-box" style="padding:16px;background:var(--light);border-radius:12px;margin-bottom:16px;text-align:center;">
                    <div id="geo-status-icon" style="font-size:2rem;margin-bottom:8px;">
                        <i class="fas fa-satellite-dish" style="color:var(--gray);"></i>
                    </div>
                    <div id="geo-status-text" style="font-size:0.95rem;color:var(--gray);">Iniciando GPS...</div>
                    <div id="geo-client-name" style="font-size:1.2rem;font-weight:bold;color:var(--primary);margin-top:6px;display:none;"></div>
                    <div id="geo-client-dist" style="font-size:0.8rem;color:var(--gray);"></div>
                </div>

                <!-- Peso en tiempo real -->
                <div style="text-align:center;padding:16px;background:var(--light);border-radius:12px;margin-bottom:16px;">
                    <div style="color:var(--gray);font-size:0.8rem;margin-bottom:4px;">PESO EN BALANZA</div>
                    <div id="geo-weight-display" style="font-size:3.5rem;font-weight:bold;color:var(--primary);line-height:1;">0.000</div>
                    <div style="font-size:0.9rem;color:var(--gray);">lb</div>
                    <div id="geo-weight-status" style="margin-top:8px;font-size:0.85rem;color:var(--gray);">
                        <i class="fas fa-circle" style="color:#ccc;"></i> Pon un pollo en la balanza
                    </div>
                </div>

                <!-- Precio del dia -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
                    <div style="background:#e8f5e9;padding:12px;border-radius:8px;text-align:center;">
                        <div style="font-size:0.75rem;color:var(--gray);">PRECIO VENTA/lb</div>
                        <div style="font-size:1.4rem;font-weight:bold;color:var(--primary);">${todaySalePrice.toFixed(2)}</div>
                    </div>
                    <div style="background:#fff3e0;padding:12px;border-radius:8px;text-align:center;">
                        <div style="font-size:0.75rem;color:var(--gray);">COSTO/lb</div>
                        <div style="font-size:1.4rem;font-weight:bold;color:var(--warning);">${todayCostPrice ? todayCostPrice.toFixed(2) : '---'}</div>
                    </div>
                </div>

                <!-- Override manual de cliente -->
                <div style="margin-bottom:16px;">
                    <label class="form-label" style="font-size:0.85rem;"><i class="fas fa-user-edit"></i> Override manual de cliente</label>
                    <select class="form-input" id="geo-client-override" onchange="App._geoChainOverrideClient(this.value)" style="font-size:0.9rem;">
                        <option value="">-- Auto por GPS --</option>
                        ${ClientsModule.clients.filter(c => c.isActive !== false).map(c =>
                            `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`
                        ).join('')}
                    </select>
                </div>

                <!-- Ultima venta -->
                <div id="geo-last-sale" style="display:none;background:linear-gradient(135deg,#2e7d32,#388e3c);color:white;padding:15px;border-radius:10px;text-align:center;margin-bottom:16px;">
                    <div style="font-size:0.8rem;opacity:0.9;">VENTA REGISTRADA</div>
                    <div id="geo-last-sale-info" style="font-size:1.1rem;font-weight:bold;margin-top:4px;"></div>
                    <div id="geo-last-sale-total" style="font-size:2rem;font-weight:bold;"></div>
                </div>

                <!-- Resumen del dia -->
                <div style="padding:12px;background:var(--light);border-radius:8px;">
                    <div style="display:flex;justify-content:space-between;font-size:0.85rem;">
                        <span style="color:var(--gray);">Ventas hoy:</span>
                        <strong id="geo-sales-count">${SalesModule.getTodaySales().length}</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-top:4px;">
                        <span style="color:var(--gray);">Total lb:</span>
                        <strong id="geo-total-lbs">${SalesModule.getTotalWeightByDate(Utils.getTodayDate()).toFixed(2)} lb</strong>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-top:4px;">
                        <span style="color:var(--gray);">Total cobrado:</span>
                        <strong id="geo-total-revenue">${Utils.formatCurrency(SalesModule.getTotalSalesByDate(Utils.getTodayDate()))}</strong>
                    </div>
                </div>
            </div>
        </div>`;

    document.body.appendChild(modal);

    // Escuchar peso para actualizar display en tiempo real
    const weightUnsub = BluetoothScale.onWeight(() => {
        const w = BluetoothScale.currentRawWeight;
        const display = document.getElementById('geo-weight-display');
        if (display) display.textContent = w.toFixed(3);
    });
    App._geoChainWeightUnsub = weightUnsub;

    // Iniciar GeoChain
    GeoChain.start({
        salePrice: todaySalePrice,
        costPrice: todayCostPrice,

        onStatus(msg, type) {
            const statusText = document.getElementById('geo-status-text');
            const statusIcon = document.getElementById('geo-weight-status');
            const iconEl = document.getElementById('geo-status-icon');
            if (statusText) statusText.textContent = msg;

            const colors = { ok: 'var(--success)', warn: 'var(--warning)', error: 'var(--danger)', info: 'var(--gray)' };
            const icons = { ok: 'fa-check-circle', warn: 'fa-exclamation-triangle', error: 'fa-times-circle', info: 'fa-satellite-dish' };
            const color = colors[type] || colors.info;
            const icon = icons[type] || icons.info;

            if (iconEl) iconEl.innerHTML = `<i class="fas ${icon}" style="color:${color};"></i>`;
            if (statusIcon) {
                const dotColor = type === 'ok' ? 'var(--success)' : type === 'warn' ? 'orange' : type === 'error' ? 'red' : '#ccc';
                statusIcon.innerHTML = `<i class="fas fa-circle" style="color:${dotColor};"></i> ${msg}`;
            }
        },

        onClientDetected(client, distanceM) {
            const nameEl = document.getElementById('geo-client-name');
            const distEl = document.getElementById('geo-client-dist');
            if (client) {
                if (nameEl) { nameEl.textContent = client.name; nameEl.style.display = 'block'; }
                if (distEl) distEl.textContent = distanceM + 'm de distancia';
            } else {
                if (nameEl) nameEl.style.display = 'none';
                if (distEl) distEl.textContent = '';
            }
        },

        onSale(sale, client) {
            // Mostrar ultima venta
            const lastSaleDiv = document.getElementById('geo-last-sale');
            const lastSaleInfo = document.getElementById('geo-last-sale-info');
            const lastSaleTotal = document.getElementById('geo-last-sale-total');
            if (lastSaleDiv) lastSaleDiv.style.display = 'block';
            if (lastSaleInfo) lastSaleInfo.textContent = client.name + ' — ' + sale.weight.toFixed(3) + ' lb';
            if (lastSaleTotal) lastSaleTotal.textContent = Utils.formatCurrency(sale.total);

            // Actualizar resumen
            const salesCount = document.getElementById('geo-sales-count');
            const totalLbs = document.getElementById('geo-total-lbs');
            const totalRevenue = document.getElementById('geo-total-revenue');
            if (salesCount) salesCount.textContent = SalesModule.getTodaySales().length;
            if (totalLbs) totalLbs.textContent = SalesModule.getTotalWeightByDate(Utils.getTodayDate()).toFixed(2) + ' lb';
            if (totalRevenue) totalRevenue.textContent = Utils.formatCurrency(SalesModule.getTotalSalesByDate(Utils.getTodayDate()));
        }
    });
};

App.stopGeoChain = function() {
    GeoChain.stop();
    if (App._geoChainWeightUnsub) {
        App._geoChainWeightUnsub();
        App._geoChainWeightUnsub = null;
    }
    const modal = document.getElementById('geo-chain-modal');
    if (modal) modal.remove();
};

App._geoChainOverrideClient = function(clientId) {
    if (!clientId) {
        // Volver a modo automatico
        GeoChain._currentClientId = null;
        GeoChain._status('Modo automatico por GPS', 'info');
        return;
    }
    GeoChain.setClient(parseInt(clientId) || clientId);
};

// ─── Fin Modo GPS Automatico ─────────────────────────────────────────────────

// Métodos para la balanza BLE
App.toggleScaleFromSidebar = function() {    const sw = document.getElementById('scale-switch');
    if (sw && !sw.disabled) {
        sw.checked = !sw.checked;
        App.onScaleSwitchChange(sw.checked);
    }
};

App.onScaleSwitchChange = async function(checked) {
    if (checked) {
        await BluetoothScale.connect();
    } else {
        await BluetoothScale.disconnect();
    }
};

App.showScaleCapture = function() {
    if (!BluetoothScale.isConnected) return;
    const w = BluetoothScale.currentWeight;
    if (w <= 0) {
        Utils.showNotification('Esperando lectura de la balanza...', 'info', 2000);
        return;
    }
    // Detectar qué formulario esta activo y capturar el peso
    const fields = ['sale-weight', 'live-weight', 'processed-weight', 'order-weight', 'delivery-weight'];
    for (const id of fields) {
        const el = document.getElementById(id);
        if (el) {
            BluetoothScale.captureWeight(id);
            Utils.showNotification(`Peso capturado: ${w.toFixed(2)} lb`, 'success', 2000);
            return;
        }
    }
    Utils.showNotification(`Peso actual: ${w.toFixed(2)} lb`, 'info', 3000);
};

// Métodos para el toggle de notificaciones en el sidebar
App.initNotifToggle = async function() {
    const sw = document.getElementById('notif-switch');
    const status = document.getElementById('notif-status-sidebar');
    if (!sw || !status) return;

    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

    if (isNative) {
        sw.disabled = false;
        // Intentar obtener token FCM hasta 15s (puede tardar en llegar de Java)
        const waitForFcmToken = async () => {
            for (let i = 0; i < 15; i++) {
                const token = window._fcmToken || localStorage.getItem('galloli_fcm_token');
                if (token) return token;
                await new Promise(r => setTimeout(r, 1000));
            }
            return null;
        };

        const token = await waitForFcmToken();
        if (token) {
            sw.checked = true;
            status.textContent = 'Activas';
            status.style.color = 'rgba(76, 175, 80, 0.9)';
            // Registrar en servidor si aún no está
            PushNotifications.registerFcmToken(token);
        } else {
            sw.checked = false;
            status.textContent = 'Toca para activar';
            status.style.color = '';
        }
        return;
    }

    // PWA/TWA: usar Web Push VAPID
    if (!('Notification' in window) || !('PushManager' in window)) {
        status.textContent = 'No soportado';
        sw.disabled = true;
        return;
    }
    if (Notification.permission === 'denied') {
        status.textContent = 'Bloqueado en ajustes';
        sw.checked = false; sw.disabled = true;
        return;
    }
    if (Notification.permission === 'granted') {
        try {
            const reg = App._swRegistration || await navigator.serviceWorker.ready;
            if (!reg) { sw.checked = false; sw.disabled = false; status.textContent = 'Toca para activar'; return; }
            let sub = await reg.pushManager.getSubscription();
            if (!sub) {
                await PushNotifications._setupSubscription();
                sub = await reg.pushManager.getSubscription();
            } else {
                await PushNotifications._saveSubscriptionToServer(sub, 1);
            }
            sw.checked = !!sub; sw.disabled = false;
            status.textContent = sub ? 'Activas' : 'Toca para activar';
            status.style.color = sub ? 'rgba(76, 175, 80, 0.9)' : '';
        } catch(e) {
            sw.checked = false; sw.disabled = false; status.textContent = 'Toca para activar';
        }
    } else {
        sw.checked = false; sw.disabled = false; status.textContent = 'Toca para activar';
    }
};

App.onNotifSwitchChange = async function(checked) {
    const sw = document.getElementById('notif-switch');
    const status = document.getElementById('notif-status-sidebar');
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

    if (isNative) {
        // En APK nativa: activar = registrar token FCM, desactivar = eliminar del servidor
        if (checked) {
            const fcmToken = window._fcmToken || localStorage.getItem('galloli_fcm_token');
            if (fcmToken) {
                sw.disabled = true;
                status.textContent = 'Activando...';
                const ok = await PushNotifications.registerFcmToken(fcmToken);
                sw.disabled = false;
                if (ok) {
                    status.textContent = 'Activas (FCM)';
                    status.style.color = 'rgba(76, 175, 80, 0.9)';
                    sw.checked = true;
                    Utils.showNotification('Notificaciones activadas', 'success', 3000);
                } else {
                    sw.checked = false;
                    status.textContent = 'Error al activar';
                }
            } else {
                // No hay token aún — esperar
                status.textContent = 'Iniciando FCM...';
                sw.checked = false;
                Utils.showNotification('Espera un momento e intenta de nuevo', 'info', 3000);
            }
        } else {
            const token = window.AuthManager ? window.AuthManager.token : null;
            const fcmToken = window._fcmToken || localStorage.getItem('galloli_fcm_token');
            if (token && fcmToken) {
                fetch('https://galloli-sync.ivanbj-96.workers.dev/api/push/subscribe', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ endpoint: 'fcm://' + fcmToken })
                }).catch(() => {});
            }
            status.textContent = 'Toca para activar';
            status.style.color = '';
            Utils.showNotification('Notificaciones desactivadas', 'info', 2000);
        }
        return;
    }

    // PWA/TWA: Web Push VAPID
    if (checked) {
        sw.disabled = true;
        status.textContent = 'Activando...';
        const ok = await PushNotifications.requestPermission();
        if (ok) {
            status.textContent = 'Activas';
            status.style.color = 'rgba(76, 175, 80, 0.9)';
            sw.checked = true;
            Utils.showNotification('Notificaciones activadas', 'success', 3000);
        } else {
            sw.checked = false;
            if (Notification.permission === 'denied') {
                status.textContent = 'Bloqueado en ajustes del sistema';
                sw.disabled = true;
            } else {
                status.textContent = 'Toca para activar';
                status.style.color = '';
            }
        }
        sw.disabled = Notification.permission === 'denied';
    } else {
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                const token = window.AuthManager ? window.AuthManager.token : null;
                if (token) {
                    fetch('https://galloli-sync.ivanbj-96.workers.dev/api/push/subscribe', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ endpoint: sub.endpoint })
                    }).catch(() => {});
                }
                await sub.unsubscribe();
            }
        } catch (e) { /* silencioso */ }
        status.textContent = 'Toca para activar';
        status.style.color = '';
        Utils.showNotification('Notificaciones desactivadas', 'info', 2000);
    }
};

App.toggleNotificationsFromSidebar = function() {
    const sw = document.getElementById('notif-switch');
    if (sw && !sw.disabled) {
        sw.checked = !sw.checked;
        App.onNotifSwitchChange(sw.checked);
    }
};
