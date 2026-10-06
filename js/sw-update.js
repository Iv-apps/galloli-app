// Listener para actualizaciones del Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (event) => {
        // isUpdate solo llega cuando reemplazamos un cache anterior (no en la primera instalacion)
        if (event.data && event.data.type === 'SW_UPDATED' && event.data.isUpdate) {
            console.log('🔄 Nueva versión detectada:', event.data.version);
            
            // Mostrar notificación al usuario
            const shouldReload = await Utils.showConfirm(
                'Hay una nueva versión disponible con mejoras y correcciones.',
                '🔄 Actualización Disponible',
                'Recargar Ahora',
                'Más Tarde'
            );
            
            if (shouldReload) {
                window.location.reload();
            }
        }
    });
    
    // Detectar cuando hay un nuevo SW esperando
    navigator.serviceWorker.ready.then(registration => {
        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            
            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('🔄 Actualización disponible');
                    
                    // Recargar automáticamente después de 2 segundos
                    setTimeout(() => {
                        window.location.reload();
                    }, 2000);
                }
            });
        });
    });
}
