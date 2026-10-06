// Sistema de manejo de errores global
(function() {
    'use strict';
    
    // Almacenar errores
    const errorLog = [];
    const MAX_ERRORS = 50;
    
    /**
     * Formatea un error para mostrar
     */
    function formatError(error, source = 'JavaScript') {
        const timestamp = new Date().toLocaleString('es-ES');
        
        let message = error.message || 'Error desconocido';
        let stack = error.stack || 'No hay stack trace disponible';
        let filename = error.filename || source;
        let lineno = error.lineno || '?';
        let colno = error.colno || '?';
        
        return {
            timestamp,
            message,
            stack,
            filename,
            lineno,
            colno,
            source,
            userAgent: navigator.userAgent
        };
    }
    
    /**
     * Muestra un modal con el error
     */
    async function showErrorModal(errorInfo) {
        // Esperar a que Utils esté disponible
        if (typeof Utils === 'undefined') {
            console.error('Utils no disponible:', errorInfo);
            return;
        }
        
        const errorDetails = `
            <div style="text-align: left; font-family: monospace; font-size: 0.85rem;">
                <p><strong>Hora:</strong> ${errorInfo.timestamp}</p>
                <p><strong>Dispositivo:</strong> ${errorInfo.userAgent.includes('Mobile') ? 'Movil' : 'Desktop'}</p>
                <p><strong>Ubicacion:</strong> ${errorInfo.filename}:${errorInfo.lineno}:${errorInfo.colno}</p>
                <hr style="margin: 10px 0; border: none; border-top: 1px solid #ddd;">
                <p><strong>Mensaje:</strong></p>
                <p style="background: #f5f5f5; padding: 8px; border-radius: 4px; word-break: break-word;">
                    ${errorInfo.message}
                </p>
                <details style="margin-top: 10px;">
                    <summary style="cursor: pointer; color: var(--primary); font-weight: bold;">
                        Ver Stack Trace
                    </summary>
                    <pre style="background: #f5f5f5; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 0.75rem; margin-top: 5px;">
${errorInfo.stack}</pre>
                </details>
            </div>
        `;
        
        await Utils.showAlert(
            errorDetails,
            'Error Detectado',
            'error'
        );
    }
    
    /**
     * Registra un error
     */
    function logError(errorInfo) {
        errorLog.unshift(errorInfo);
        
        // Mantener solo los últimos MAX_ERRORS
        if (errorLog.length > MAX_ERRORS) {
            errorLog.pop();
        }
        
        // Guardar en localStorage
        try {
            localStorage.setItem('app_error_log', JSON.stringify(errorLog.slice(0, 10)));
        } catch (e) {
            console.error('No se pudo guardar el log de errores:', e);
        }
        
        // Mostrar en consola
        console.error('🐛 Error capturado:', errorInfo);
    }
    
    /**
     * Manejador de errores globales
     */
    window.addEventListener('error', function(event) {
        const errorInfo = formatError({
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            stack: event.error ? event.error.stack : 'No disponible'
        }, 'Global Error');
        
        logError(errorInfo);
        
        // Mostrar modal solo en móviles o si está en modo desarrollo
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isDevMode = localStorage.getItem('devMode') === 'true';
        
        if (isMobile || isDevMode) {
            showErrorModal(errorInfo);
        }
        
        // No prevenir el comportamiento por defecto
        return false;
    });
    
    /**
     * Manejador de promesas rechazadas
     */
    window.addEventListener('unhandledrejection', function(event) {
        const errorInfo = formatError({
            message: event.reason ? event.reason.message || event.reason : 'Promise rechazada',
            stack: event.reason ? event.reason.stack : 'No disponible'
        }, 'Unhandled Promise');
        
        logError(errorInfo);
        
        // Mostrar modal solo en móviles o si está en modo desarrollo
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        const isDevMode = localStorage.getItem('devMode') === 'true';
        
        if (isMobile || isDevMode) {
            showErrorModal(errorInfo);
        }
        
        // Prevenir que se muestre en consola (ya lo mostramos nosotros)
        event.preventDefault();
    });
    
    /**
     * Función global para ver el log de errores
     */
    window.showErrorLog = function() {
        if (errorLog.length === 0) {
            if (typeof Utils !== 'undefined') {
                Utils.showAlert('No hay errores registrados', 'Log de Errores', 'success');
            } else {
                alert('No hay errores registrados');
            }
            return;
        }
        
        const logHtml = errorLog.map((err, index) => `
            <div style="margin-bottom: 15px; padding: 10px; background: #f5f5f5; border-radius: 8px; text-align: left;">
                <strong>#${index + 1} - ${err.timestamp}</strong><br>
                <small style="color: var(--gray);">${err.filename}:${err.lineno}</small><br>
                <p style="margin: 5px 0; color: var(--danger);">${err.message}</p>
            </div>
        `).join('');
        
        if (typeof Utils !== 'undefined') {
            Utils.showAlert(
                `<div style="max-height: 400px; overflow-y: auto;">${logHtml}</div>`,
                `Log de Errores (${errorLog.length})`,
                'info'
            );
        } else {
            console.log('Log de errores:', errorLog);
        }
    };
    
    /**
     * Función global para limpiar el log
     */
    window.clearErrorLog = function() {
        errorLog.length = 0;
        localStorage.removeItem('app_error_log');
        console.log('✅ Log de errores limpiado');
        
        if (typeof Utils !== 'undefined') {
            Utils.showAlert('Log de errores limpiado correctamente', 'Limpieza Exitosa', 'success');
        }
    };
    
    // Cargar errores previos del localStorage
    try {
        const savedErrors = localStorage.getItem('app_error_log');
        if (savedErrors) {
            const parsed = JSON.parse(savedErrors);
            errorLog.push(...parsed);
            console.log(`📋 ${errorLog.length} errores previos cargados`);
        }
    } catch (e) {
        console.error('No se pudieron cargar errores previos:', e);
    }
    
    console.log('🛡️ Sistema de manejo de errores inicializado');
})();
