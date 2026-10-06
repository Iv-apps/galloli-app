// Service Worker con versionado automatico
const APP_VERSION = '7.20.46'; // fix: auditoria TWA - rutas, escapeHtml, cola offline, mojibake
const CACHE_NAME = `galloli-v${APP_VERSION}`;
const DATA_CACHE_NAME = `galloli-data-v${APP_VERSION}`;

// Archivos para cache estático - SE ACTUALIZARÁN AUTOMÁTICAMENTE
let STATIC_CACHE_URLS = [];

// Función para obtener recursos dinámicamente
async function getStaticResources() {
    try {
        // Recursos locales
        const resources = [
            '/',
            '/index.html',
            '/css/styles.css',
            '/js/logo.js',
            '/js/pdf-generator.js',
            '/js/utils.js',
            '/js/error-handler.js',
            '/js/sw-update.js',
            '/js/db.js',
            '/js/modules.js',
            '/js/app.js',
            '/js/auth.js',
            '/js/offline-maps.js',
            '/js/offline-queue.js',
            '/js/sync-engine.js',
            '/js/creditos.js',
            '/js/notify-system.js',
            '/js/payment-processor.js',
            '/js/auto-backup.js',
            '/js/custom-select.js',
            '/js/bluetooth-scale.js',
            '/js/geo-chain.js',
            '/js/facturacion-electronica.js',
            '/js/facturacion-ui.js',
            '/manifest.json',
            '/icons/favicon.pub/android-chrome-192x192.png',
            '/icons/favicon.pub/android-chrome-512x512.png',
            '/icons/favicon.pub/apple-touch-icon-180x180.png',
            '/icons/favicon.pub/favicon.ico'
        ];

        // Agregar recursos de CDN
        const cdnResources = [
            'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
            'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
            'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
            'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
        ];

        return [...resources, ...cdnResources];
    } catch (error) {
        console.error('[Service Worker] Error obteniendo recursos:', error.message);
        return [];
    }
}

// Función para verificar actualizaciones
async function checkForUpdates() {
    try {
        // Intentar cargar version.json solo si existe
        const response = await fetch('/version.json?v=' + Date.now(), { 
            method: 'HEAD' 
        });
        
        if (!response.ok) {
            // Si no existe version.json, no hacer nada
            return false;
        }
        
        const dataResponse = await fetch('/version.json?v=' + Date.now());
        const data = await dataResponse.json();
        
        if (data.version !== APP_VERSION) {
            console.log('[Service Worker] Nueva versión disponible:', data.version);
            
            // Notificar a la app principal
            self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'NEW_VERSION_AVAILABLE',
                        version: data.version
                    });
                });
            });
            
            return true;
        }
        return false;
    } catch (error) {
        // Silenciar error si version.json no existe
        return false;
    }
}

// Instalación del Service Worker
self.addEventListener('install', async (event) => {
    console.log(`[Service Worker] Instalando versión ${APP_VERSION}...`);
    
    // FORZAR ACTIVACIÓN INMEDIATA
    self.skipWaiting();
    
    event.waitUntil(
        (async () => {
            // Obtener recursos dinámicamente
            STATIC_CACHE_URLS = await getStaticResources();
            
            const cache = await caches.open(CACHE_NAME);
            console.log('[Service Worker] Cacheando recursos estáticos:', STATIC_CACHE_URLS.length, 'archivos');
            
            // Cachear recursos críticos inmediatamente
            const criticalResources = [
                '/',
                '/index.html',
                '/css/styles.css',
                '/js/utils.js',
                '/js/db.js'
            ];
            
            // Cachear uno por uno para evitar fallos
            for (const url of criticalResources) {
                try {
                    await cache.add(url);
                } catch (e) {
                    console.warn(`[Service Worker] No se pudo cachear ${url}:`, e);
                }
            }
            
            console.log('[Service Worker] Instalación completada');
        })()
    );
});

// Activación y limpieza de caches viejos
self.addEventListener('activate', (event) => {
    console.log(`[Service Worker] Activando versión ${APP_VERSION}...`);
    
    event.waitUntil(
        (async () => {
            // Limpiar caches viejos PRIMERO (si habia caches viejos, es una actualizacion real)
            const cacheKeys = await caches.keys();
            const cachesViejos = cacheKeys.filter(
                (cacheName) => cacheName !== CACHE_NAME && cacheName !== DATA_CACHE_NAME
            );
            await Promise.all(
                cachesViejos.map(async (cacheName) => {
                    console.log('[Service Worker] Eliminando cache viejo:', cacheName);
                    await caches.delete(cacheName);
                })
            );
            
            // Reclamar clientes inmediatamente - FORZAR CONTROL
            await self.clients.claim();
            
            // Avisar solo si de verdad habia una version anterior instalada
            if (cachesViejos.length > 0) {
                const clients = await self.clients.matchAll({ type: 'window' });
                clients.forEach(client => {
                    client.postMessage({
                        type: 'SW_UPDATED',
                        version: APP_VERSION,
                        isUpdate: true
                    });
                });
            }
            
            console.log('[Service Worker] Activación completada - Versión', APP_VERSION);
            
            // Cachear el resto de recursos en segundo plano
            self.cacheRemainingResources();
        })()
    );
});

// Método para cachear recursos restantes en segundo plano
self.cacheRemainingResources = async function() {
    try {
        const cache = await caches.open(CACHE_NAME);
        const alreadyCached = await cache.keys();
        const alreadyCachedUrls = alreadyCached.map(request => request.url);
        
        const resourcesToCache = STATIC_CACHE_URLS.filter(url => 
            !alreadyCachedUrls.includes(self.location.origin + url) && 
            !alreadyCachedUrls.includes(url)
        );
        
        if (resourcesToCache.length > 0) {
            console.log('[Service Worker] Cacheando recursos adicionales:', resourcesToCache.length, 'archivos');
            
            for (const url of resourcesToCache) {
                try {
                    await cache.add(url);
                } catch (error) {
                    console.warn(`[Service Worker] Error cacheando ${url}:`, error.message);
                }
            }
        }
    } catch (error) {
        console.error('[Service Worker] Error cacheando recursos adicionales:', error);
    }
};

// Estrategia de cache: Stale-While-Revalidate
self.addEventListener('fetch', (event) => {
    // Ignorar solicitudes no GET
    if (event.request.method !== 'GET') return;
    
    const url = new URL(event.request.url);
    
    // Ignorar solicitudes a APIs externas (excepto CDNs conocidas)
    if (url.hostname !== self.location.hostname && 
        !url.hostname.includes('cdnjs.cloudflare.com') &&
        !url.hostname.includes('fonts.googleapis.com') &&
        !url.hostname.includes('unpkg.com') &&
        !url.hostname.includes('nominatim.openstreetmap.org')) {
        return;
    }
    
    event.respondWith(
        (async () => {
            // Primero intentar desde cache
            const cachedResponse = await caches.match(event.request);
            
            // Si está en cache y es un recurso estático, devolverlo inmediatamente
            if (cachedResponse) {
                console.log('[Service Worker] Sirviendo desde cache:', url.pathname);
                
                // Actualizar el cache en segundo plano (stale-while-revalidate)
                event.waitUntil(
                    (async () => {
                        try {
                            const networkResponse = await fetch(event.request);
                            const cache = await caches.open(CACHE_NAME);
                            await cache.put(event.request, networkResponse.clone());
                            console.log('[Service Worker] Cache actualizado:', url.pathname);
                        } catch (error) {
                            // Silencioso en fallo de red
                        }
                    })()
                );
                
                return cachedResponse;
            }
            
            // Si no está en cache, ir a la red
            try {
                const networkResponse = await fetch(event.request);
                
                // Solo cachear respuestas exitosas
                if (networkResponse.status === 200) {
                    const cache = await caches.open(CACHE_NAME);
                    await cache.put(event.request, networkResponse.clone());
                    console.log('[Service Worker] Nuevo recurso cacheado:', url.pathname);
                }
                
                return networkResponse;
            } catch (error) {
                console.error('[Service Worker] Error de red:', error);
                
                // Para páginas HTML, devolver la página offline
                if (event.request.headers.get('accept')?.includes('text/html')) {
                    return caches.match('/offline.html') || 
                           new Response('<h1>Estás sin conexión</h1><p>La aplicación GallOli requiere conexión a internet.</p>', {
                               headers: { 'Content-Type': 'text/html' }
                           });
                }
                
                throw error;
            }
        })()
    );
});

// Mensajes del Service Worker
self.addEventListener('message', (event) => {
    console.log('[Service Worker] Mensaje recibido:', event.data);
    
    switch (event.data.type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
            
        case 'UPDATE_CACHE':
            self.cacheRemainingResources();
            break;
            
        case 'CLEAR_CACHE':
            caches.delete(CACHE_NAME).then(() => {
                console.log('[Service Worker] Cache limpiado');
            });
            break;
            
        case 'GET_VERSION':
            event.ports[0].postMessage({ version: APP_VERSION });
            break;
            
        case 'CHECK_UPDATE':
            checkForUpdates().then(hasUpdate => {
                event.ports[0].postMessage({ hasUpdate });
            });
            break;
            
        case 'SET_DEV_MODE':
            // Manejar modo desarrollo
            console.log('[Service Worker] Modo desarrollo:', event.data.devMode);
            break;
            
        case 'WASM_NOTIFICATION':
            // Manejar notificaciones WASM
            handleWASMNotification(event.data);
            break;
            
        case 'SCHEDULE_NOTIFICATION':
            // Programar notificación
            scheduleNotification(event.data);
            break;
    }
});

// Sincronización en segundo plano
self.addEventListener('sync', (event) => {
    console.log('[Service Worker] Sincronización:', event.tag);
    
    if (event.tag === 'sync-data') {
        event.waitUntil(syncData());
    }
});

async function syncData() {
    // Implementar lógica de sincronización aquí
    console.log('[Service Worker] Sincronizando datos...');
}

// Notificaciones push persistentes
self.addEventListener('push', (event) => {
    console.log('[Service Worker] Push recibido');
    
    const data = event.data?.json() || {
        title: 'GallOli',
        body: 'Nueva actualización disponible',
        icon: './icons/favicon.pub/android-chrome-192x192.png'
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon || './icons/favicon.pub/android-chrome-192x192.png',
            badge: data.badge || './icons/favicon.pub/favicon-48x48.png',
            vibrate: data.vibrate || [200, 100, 200],
            requireInteraction: data.requireInteraction || false,
            silent: data.silent || false,
            tag: data.tag || 'galloli-notification',
            data: {
                url: data.url || './',
                timestamp: Date.now(),
                action: data.action
            },
            actions: data.actions || [
                { action: 'open', title: 'Abrir' },
                { action: 'dismiss', title: 'Cerrar' }
            ]
        })
    );
});

// Alarmas periódicas para notificaciones programadas
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'check-reminders') {
        event.waitUntil(checkScheduledReminders());
    }
});

async function checkScheduledReminders() {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    
    // Backup reminder (8 PM)
    if (hour === 20 && minute === 0) {
        await self.registration.showNotification('Recordatorio de Backup', {
            body: 'No olvides crear un backup de tus datos hoy',
            icon: '/icons/favicon.pub/android-chrome-192x192.png',
            badge: '/icons/favicon.pub/favicon-48x48.png',
            tag: 'backup-reminder',
            requireInteraction: false,
            silent: false,
            vibrate: [200, 100, 200],
            actions: [
                { action: 'open', title: 'Abrir App' }
            ]
        });
    }
    
    // Merma reminder (6 PM)
    if (hour === 18 && minute === 0) {
        await self.registration.showNotification('Recordatorio de Merma', {
            body: 'Recuerda calcular la merma del día',
            icon: '/icons/favicon.pub/android-chrome-192x192.png',
            badge: '/icons/favicon.pub/favicon-48x48.png',
            tag: 'merma-reminder',
            requireInteraction: false,
            silent: false,
            vibrate: [200, 100, 200],
            actions: [
                { action: 'open', title: 'Abrir App' }
            ]
        });
    }
    
    // Diezmos reminder (9 PM)
    if (hour === 21 && minute === 0) {
        await self.registration.showNotification('Recordatorio de Diezmos', {
            body: 'Revisa y guarda los diezmos del día',
            icon: '/icons/favicon.pub/android-chrome-192x192.png',
            badge: '/icons/favicon.pub/favicon-48x48.png',
            tag: 'diezmos-reminder',
            requireInteraction: false,
            silent: false,
            vibrate: [200, 100, 200],
            actions: [
                { action: 'open', title: 'Abrir App' }
            ]
        });
    }
}

// Manejo de errores
self.addEventListener('error', (event) => {
    console.error('[Service Worker] Error:', event.error?.message || event.message);
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('[Service Worker] Promesa rechazada:', event.reason?.message || event.reason);
    event.preventDefault(); // Prevenir que se propague
});

// Funciones auxiliares para WASM Notifications
async function handleWASMNotification(data) {
    try {
        const { title, body, options = {} } = data;
        
        await self.registration.showNotification(title, {
            body,
            icon: options.icon || '/icons/favicon.pub/android-chrome-192x192.png',
            badge: options.badge || '/icons/favicon.pub/favicon-48x48.png',
            tag: options.tag || 'wasm-notification',
            requireInteraction: options.requireInteraction !== false,
            vibrate: options.vibrate || [200, 100, 200],
            data: {
                ...options.data,
                wasmProcessed: true,
                timestamp: Date.now()
            },
            actions: options.actions || [
                { action: 'open', title: 'Abrir App' },
                { action: 'dismiss', title: 'Descartar' }
            ]
        });
        
        console.log('[Service Worker] WASM notification sent:', title);
    } catch (error) {
        console.error('[Service Worker] Error sending WASM notification:', error);
    }
}

async function scheduleNotification(data) {
    const { title, body, delay, options = {} } = data;
    
    setTimeout(async () => {
        await handleWASMNotification({ title, body, options });
    }, delay);
    
    console.log(`[Service Worker] Notification scheduled for ${delay}ms:`, title);
}

// Notificaciones inteligentes basadas en actividad del usuario
let userActivity = {
    lastActive: Date.now(),
    isActive: true,
    notificationsSent: 0
};

// Detectar actividad del usuario
self.addEventListener('message', (event) => {
    if (event.data.type === 'USER_ACTIVITY') {
        userActivity.lastActive = Date.now();
        userActivity.isActive = true;
    }
});

// Verificar inactividad cada 5 minutos
setInterval(() => {
    const now = Date.now();
    const inactiveTime = now - userActivity.lastActive;
    
    // Si el usuario ha estado inactivo por más de 30 minutos
    if (inactiveTime > 30 * 60 * 1000) {
        userActivity.isActive = false;
        
        // Enviar recordatorio si no se han enviado muchas notificaciones
        if (userActivity.notificationsSent < 3) {
            self.registration.showNotification('GallOli te recuerda', {
                body: 'No olvides registrar tus ventas del día',
                icon: '/icons/favicon.pub/android-chrome-192x192.png',
                badge: '/icons/favicon.pub/favicon-48x48.png',
                tag: 'inactivity-reminder',
                requireInteraction: false,
                vibrate: [100, 50, 100]
            });
            
            userActivity.notificationsSent++;
        }
    } else {
        userActivity.isActive = true;
        userActivity.notificationsSent = 0; // Reset counter when active
    }
}, 5 * 60 * 1000); // Cada 5 minutos


// Manejador de clics en acciones de notificaciones CON SOPORTE INLINE
self.addEventListener('notificationclick', (event) => {
    console.log('[Service Worker] ========================================');
    console.log('[Service Worker] 🔔 NOTIFICACIÓN CLICKEADA');
    console.log('[Service Worker] event.action:', event.action);
    console.log('[Service Worker] event.reply:', event.reply); // Para inputs inline
    console.log('[Service Worker] Tag:', event.notification.tag);
    console.log('[Service Worker] event.notification.data:', event.notification.data);
    console.log('[Service Worker] ========================================');
    
    event.notification.close();
    
    const notificationData = event.notification.data || {};
    const buttonAction = event.action || 'open';
    const userInput = event.reply || null; // Texto ingresado por el usuario
    
    // Si es dismiss, no hacer nada
    if (buttonAction === 'dismiss') {
        console.log('[Service Worker] ❌ Acción dismiss - cerrando notificación');
        return;
    }
    
    // PROCESAR ACCIONES DIRECTAMENTE EN EL SERVICE WORKER
    if (notificationData.type === 'credit') {
        event.waitUntil(handleCreditAction(buttonAction, notificationData, userInput));
        return;
    }
    
    if (notificationData.type === 'merma') {
        event.waitUntil(handleMermaAction(buttonAction, notificationData));
        return;
    }
    
    if (notificationData.type === 'backup') {
        event.waitUntil(handleBackupAction(buttonAction, notificationData));
        return;
    }
    
    // Para otras acciones, abrir la app
    event.waitUntil(openAppWithAction(buttonAction, notificationData));
});

// Manejar acciones de crédito DIRECTAMENTE desde el Service Worker
async function handleCreditAction(action, data, userInput) {
    console.log('[Service Worker] 💳 Procesando acción de crédito:', action);
    
    try {
        // Obtener clientes para enviar mensaje
        const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        
        if (action === 'pay-full') {
            // Pagar deuda completa
            console.log('[Service Worker] 💵 Pagando deuda completa:', data.totalDebt);
            
            // Enviar mensaje SOLO AL PRIMER cliente (evitar duplicados)
            if (clientList.length > 0) {
                console.log('[Service Worker] 📤 Enviando a primer cliente solamente');
                clientList[0].postMessage({
                    type: 'process-payment',
                    action: 'pay-full',
                    clientId: data.clientId,
                    clientName: data.clientName,
                    amount: data.totalDebt,
                    salesIds: data.sales
                });
                
                // NO mostrar notificación aquí - la app lo hará
                console.log('[Service Worker] ✅ Mensaje enviado - app procesará el pago');
            } else {
                // Si no hay ventana abierta, abrir una con los datos
                await openAppWithPayment('pay-full', data);
            }
            
        } else if (action === 'pay-partial' && userInput) {
            // Abono parcial con monto ingresado
            const amount = parseFloat(userInput);
            
            if (isNaN(amount) || amount <= 0) {
                await self.registration.showNotification(
                    'Monto Invalido',
                    {
                        body: 'Ingresa un monto válido para el abono',
                        icon: './icons/favicon.pub/android-chrome-192x192.png',
                        tag: 'payment-error',
                        requireInteraction: true
                    }
                );
                return;
            }
            
            if (amount > data.totalDebt) {
                await self.registration.showNotification(
                    'Monto Excedido',
                    {
                        body: `El monto (${formatCurrency(amount)}) es mayor a la deuda (${formatCurrency(data.totalDebt)})`,
                        icon: './icons/favicon.pub/android-chrome-192x192.png',
                        tag: 'payment-error',
                        requireInteraction: true
                    }
                );
                return;
            }
            
            console.log('[Service Worker] 💰 Registrando abono:', amount);
            
            // Enviar mensaje SOLO AL PRIMER cliente (evitar duplicados)
            if (clientList.length > 0) {
                console.log('[Service Worker] 📤 Enviando a primer cliente solamente');
                clientList[0].postMessage({
                    type: 'process-payment',
                    action: 'pay-partial',
                    clientId: data.clientId,
                    clientName: data.clientName,
                    amount: amount,
                    salesIds: data.sales
                });
                
                // NO mostrar notificación aquí - la app lo hará
                console.log('[Service Worker] ✅ Mensaje enviado - app procesará el abono');
            } else {
                // Si no hay ventana abierta, abrir una con los datos
                await openAppWithPayment('pay-partial', { ...data, amount });
            }
            
        } else if (action === 'view') {
            // Ver detalles - abrir la app
            await openAppWithAction('view-credits', data);
        }
        
    } catch (error) {
        console.error('[Service Worker] ❌ Error procesando pago:', error);
        await self.registration.showNotification(
            'Error de pago',
            {
                body: 'No se pudo procesar el pago. Intenta desde la app.',
                icon: './icons/favicon.pub/android-chrome-192x192.png',
                tag: 'payment-error',
                requireInteraction: true
            }
        );
    }
}

// Manejar acciones de merma
async function handleMermaAction(action, data) {
    if (action === 'calculate') {
        await openAppWithAction('calculate-merma', data);
    }
}

// Manejar acciones de backup
async function handleBackupAction(action, data) {
    if (action === 'backup-now') {
        await openAppWithAction('create-backup', data);
    }
}

// Abrir la app con una acción específica
async function openAppWithAction(action, data) {
    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    
    // Si ya hay una ventana abierta, enfocarla y enviar mensaje
    for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
            console.log('[Service Worker] ✅ Enfocando cliente existente');
            
            await client.focus();
            client.postMessage({
                type: 'notification-action',
                action: action,
                data: data
            });
            return;
        }
    }
    
    // Si no hay ventana abierta, abrir una nueva
    console.log('[Service Worker] 🆕 Abriendo nueva ventana');
    if (clients.openWindow) {
        const url = new URL(self.location.origin);
        url.searchParams.set('action', action);
        url.searchParams.set('data', JSON.stringify(data));
        await clients.openWindow(url.toString());
    }
}

// Abrir la app con datos de pago
async function openAppWithPayment(action, data) {
    const url = new URL(self.location.origin);
    url.searchParams.set('action', action);
    url.searchParams.set('clientId', data.clientId);
    url.searchParams.set('amount', data.amount || data.totalDebt);
    url.searchParams.set('salesIds', JSON.stringify(data.sales));
    
    if (clients.openWindow) {
        await clients.openWindow(url.toString());
    }
}

// Función auxiliar para formatear moneda
function formatCurrency(amount) {
    return new Intl.NumberFormat('es-GT', {
        style: 'currency',
        currency: 'GTQ'
    }).format(amount);
}
