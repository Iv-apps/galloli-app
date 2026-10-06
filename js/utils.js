// utils.js - VERIFICA QUE TENGA ESTO
const Utils = {
    formatCurrency(amount) {
        return new Intl.NumberFormat('es-MX', {
            style: 'currency',
            currency: 'MXN'
        }).format(amount);
    },

    formatDate(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    formatDateTime(date = new Date()) {
        return date.toLocaleString('es-ES', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    calculateAverageWeight(totalWeight, quantity) {
        if (!quantity || quantity === 0) return 0;
        return totalWeight / quantity;
    },

    showLoading(show) {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = show ? 'flex' : 'none';
        }
    },

    showNotification(message, type = 'success', duration = 10000) {
        const notification = document.getElementById('notification');
        if (!notification) return;
        
        if (this.notificationTimeout) {
            clearTimeout(this.notificationTimeout);
        }
        
        const notificationText = document.getElementById('notification-text');
        if (notificationText) {
            notificationText.textContent = message;
        } else {
            notification.textContent = message;
        }
        
        const icon = notification.querySelector('i');
        if (icon) {
            switch(type) {
                case 'success':
                    notification.style.background = 'var(--success)';
                    icon.className = 'fas fa-check-circle';
                    break;
                case 'error':
                    notification.style.background = 'var(--danger)';
                    icon.className = 'fas fa-exclamation-circle';
                    break;
                case 'warning':
                    notification.style.background = 'var(--warning)';
                    icon.className = 'fas fa-exclamation-triangle';
                    break;
                case 'info':
                    notification.style.background = 'var(--primary)';
                    icon.className = 'fas fa-info-circle';
                    break;
            }
        }
        
        notification.style.display = 'flex';
        
        this.notificationTimeout = setTimeout(() => {
            this.hideNotification();
        }, duration);
    },

    hideNotification() {
        const notification = document.getElementById('notification');
        if (notification) {
            notification.style.display = 'none';
        }
        
        if (this.notificationTimeout) {
            clearTimeout(this.notificationTimeout);
            this.notificationTimeout = null;
        }
    },

    // ===== MODALES PERSONALIZADOS =====
    
    /**
     * Muestra un modal de alerta
     * @param {string} message - Mensaje a mostrar
     * @param {string} title - Título del modal (opcional)
     * @param {string} type - Tipo: 'info', 'success', 'warning', 'error' (default: 'info')
     */
    async showAlert(message, title = 'Información', type = 'info') {
        return new Promise((resolve) => {
            const overlay = document.getElementById('custom-modal-overlay');
            const modalBox = overlay.querySelector('.modal-box');
            const iconEl = overlay.querySelector('.modal-icon');
            const titleEl = overlay.querySelector('.modal-title');
            const bodyEl = overlay.querySelector('.modal-body');
            const footerEl = overlay.querySelector('.modal-footer');

            // Iconos según tipo
            const icons = {
                info: '💡',
                success: '✅',
                warning: '⚠️',
                error: '❌'
            };

            iconEl.textContent = icons[type] || icons.info;
            iconEl.className = `modal-icon ${type}`;
            titleEl.textContent = title;
            bodyEl.innerHTML = `<p>${message}</p>`;
            
            footerEl.innerHTML = `
                <button class="modal-btn modal-btn-primary" onclick="Utils.closeModal()">
                    Aceptar
                </button>
            `;

            overlay.classList.add('active');
            
            // Resolver cuando se cierre
            overlay.dataset.resolve = 'alert';
            this._modalResolve = resolve;
        });
    },

    /**
     * Muestra un modal de confirmación
     * @param {string} message - Mensaje a mostrar
     * @param {string} title - Título del modal (opcional)
     * @param {string} confirmText - Texto del botón confirmar (opcional)
     * @param {string} cancelText - Texto del botón cancelar (opcional)
     */
    async showConfirm(message, title = 'Confirmar', confirmText = 'Aceptar', cancelText = 'Cancelar') {
        return new Promise((resolve) => {
            const overlay = document.getElementById('custom-modal-overlay');
            const iconEl = overlay.querySelector('.modal-icon');
            const titleEl = overlay.querySelector('.modal-title');
            const bodyEl = overlay.querySelector('.modal-body');
            const footerEl = overlay.querySelector('.modal-footer');

            iconEl.textContent = '❓';
            iconEl.className = 'modal-icon question';
            titleEl.textContent = title;
            bodyEl.innerHTML = `<p>${message}</p>`;
            
            footerEl.innerHTML = `
                <button class="modal-btn modal-btn-secondary" onclick="Utils.closeModal(false)">
                    ${cancelText}
                </button>
                <button class="modal-btn modal-btn-primary" onclick="Utils.closeModal(true)">
                    ${confirmText}
                </button>
            `;

            overlay.classList.add('active');
            this._modalResolve = resolve;
        });
    },

    /**
     * Muestra un modal de confirmación peligrosa (botón rojo)
     * @param {string} message - Mensaje a mostrar
     * @param {string} title - Título del modal (opcional)
     * @param {string} confirmText - Texto del botón confirmar (opcional)
     */
    async showDangerConfirm(message, title = '⚠️ Advertencia', confirmText = 'Eliminar', cancelText = 'Cancelar') {
        return new Promise((resolve) => {
            const overlay = document.getElementById('custom-modal-overlay');
            const iconEl = overlay.querySelector('.modal-icon');
            const titleEl = overlay.querySelector('.modal-title');
            const bodyEl = overlay.querySelector('.modal-body');
            const footerEl = overlay.querySelector('.modal-footer');

            iconEl.textContent = '⚠️';
            iconEl.className = 'modal-icon warning';
            titleEl.textContent = title;
            bodyEl.innerHTML = `<p>${message}</p>`;
            
            footerEl.innerHTML = `
                <button class="modal-btn modal-btn-secondary" onclick="Utils.closeModal(false)">
                    ${cancelText}
                </button>
                <button class="modal-btn modal-btn-danger" onclick="Utils.closeModal(true)">
                    ${confirmText}
                </button>
            `;

            overlay.classList.add('active');
            this._modalResolve = resolve;
        });
    },

    /**
     * Muestra un modal con input de texto
     * @param {string} message - Mensaje a mostrar
     * @param {string} title - Título del modal (opcional)
     * @param {string} defaultValue - Valor por defecto del input (opcional)
     * @param {string} placeholder - Placeholder del input (opcional)
     */
    async showPrompt(message, title = 'Ingresa un valor', defaultValue = '', placeholder = '') {
        return new Promise((resolve) => {
            const overlay = document.getElementById('custom-modal-overlay');
            const iconEl = overlay.querySelector('.modal-icon');
            const titleEl = overlay.querySelector('.modal-title');
            const bodyEl = overlay.querySelector('.modal-body');
            const footerEl = overlay.querySelector('.modal-footer');

            iconEl.textContent = '✏️';
            iconEl.className = 'modal-icon info';
            titleEl.textContent = title;
            bodyEl.innerHTML = `
                <p>${message}</p>
                <input type="text" class="modal-input" id="modal-prompt-input" 
                       value="${defaultValue}" placeholder="${placeholder}">
            `;
            
            footerEl.innerHTML = `
                <button class="modal-btn modal-btn-secondary" onclick="Utils.closeModal(null)">
                    Cancelar
                </button>
                <button class="modal-btn modal-btn-primary" onclick="Utils.closeModal(document.getElementById('modal-prompt-input').value)">
                    Aceptar
                </button>
            `;

            overlay.classList.add('active');
            
            // Focus en el input
            setTimeout(() => {
                const input = document.getElementById('modal-prompt-input');
                if (input) {
                    input.focus();
                    input.select();
                    
                    // Enter para aceptar
                    input.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') {
                            this.closeModal(input.value);
                        }
                    });
                }
            }, 100);

            this._modalResolve = resolve;
        });
    },

    /**
     * Cierra el modal actual
     * @param {any} result - Resultado a devolver
     */
    closeModal(result) {
        const overlay = document.getElementById('custom-modal-overlay');
        overlay.classList.remove('active');
        
        if (this._modalResolve) {
            this._modalResolve(result);
            this._modalResolve = null;
        }
    },
    
    /**
     * Inicializa el sistema de modales
     */
    initModals() {
        const overlay = document.getElementById('custom-modal-overlay');
        if (overlay) {
            // Cerrar modal al hacer click en el overlay (fuera del modal)
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.closeModal(null);
                }
            });
        }
    },

    // Mantener compatibilidad con código antiguo
    confirmAction(message) {
        return this.showConfirm(message);
    },

    getTodayDate() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    getYesterdayDate() {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return this.formatDate(yesterday);
    },

    getDateRange(days = 7) {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - days);
        return {
            start: this.formatDate(start),
            end: this.formatDate(end)
        };
    },

    /**
     * Escapa caracteres HTML para prevenir XSS y evitar que nombres con &, <, ' rompan el DOM.
     * Usar en TODOS los strings provenientes de DB que se inserten en innerHTML.
     */
    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
};

// Módulo de Ubicación
const LocationModule = {
    currentLocation: '',
    latitude: null,
    longitude: null,

    setCurrentLocation(location, lat = null, lng = null) {
        this.currentLocation = location;
        this.latitude = lat;
        this.longitude = lng;
        
        const locationElement = document.getElementById('current-location');
        if (locationElement) {
            locationElement.innerHTML = `<i class="fas fa-map-marker-alt location-icon"></i> ${location}`;
            locationElement.style.color = lat ? 'var(--success)' : 'var(--danger)';
        }
    },

    getCurrentLocation() {
        return {
            address: this.currentLocation,
            latitude: this.latitude,
            longitude: this.longitude,
            timestamp: new Date().toISOString()
        };
    },

    getLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject('Geolocalización no soportada');
                return;
            }

            const options = {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            };

            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    
                    try {
                        const response = await fetch(
                            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
                        );
                        
                        if (!response.ok) throw new Error('Error en la respuesta');
                        
                        const data = await response.json();
                        let location = '';
                        
                        if (data.address) {
                            const parts = [];
                            if (data.address.road) parts.push(data.address.road);
                            if (data.address.suburb) parts.push(data.address.suburb);
                            if (data.address.city) parts.push(data.address.city);
                            location = parts.join(', ');
                        }
                        
                        if (!location) {
                            location = `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`;
                        }
                        
                        resolve({
                            address: location,
                            latitude: lat,
                            longitude: lng,
                            accuracy: position.coords.accuracy
                        });
                    } catch (error) {
                        resolve({
                            address: `Lat: ${lat.toFixed(6)}, Lng: ${lng.toFixed(6)}`,
                            latitude: lat,
                            longitude: lng,
                            accuracy: position.coords.accuracy
                        });
                    }
                },
                (error) => {
                    let errorMessage = 'No se pudo obtener la ubicación';
                    
                    switch(error.code) {
                        case error.PERMISSION_DENIED:
                            errorMessage = 'Permiso de ubicación denegado';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            errorMessage = 'Información de ubicación no disponible';
                            break;
                        case error.TIMEOUT:
                            errorMessage = 'Tiempo de espera agotado';
                            break;
                    }
                    
                    reject(errorMessage);
                },
                options
            );
        });
    }
};