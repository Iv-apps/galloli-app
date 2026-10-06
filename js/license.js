// js/license.js — Activación de licencia de GallOli
//
// Sin licencia activa la app funciona 100% local (vender, cobrar, reportes),
// pero la nube (sincronización) queda desactivada y se muestra un aviso.
// La licencia se activa pegando el código que se compró; el Worker lo verifica
// sin conexión contra la clave pública del vendedor.

const LicenseModule = {
    estado: null,
    initialized: false,
    _fetchWatcher: false,
    _avisoCerrado: false,
    _modalAbierto: false,

    // ── Ciclo de vida ────────────────────────────────────────────────────────

    async init() {
        if (this.initialized) return;
        this.initialized = true;
        this._installFetchWatcher();
        if (window.AuthManager && window.AuthManager.isAuthenticated()) {
            await this.refresh({ autoMostrar: true });
        }
    },

    get esAdmin() {
        if (typeof Perm !== 'undefined' && Perm.role) {
            return ['super_admin', 'admin'].includes(Perm.role());
        }
        const rol = window.AuthManager?.user?.role;
        return ['super_admin', 'admin'].includes(rol);
    },

    get bloqueada() {
        return !!(this.estado && this.estado.exigida && !this.estado.activa);
    },

    // ── Estado ───────────────────────────────────────────────────────────────

    async refresh({ autoMostrar = false } = {}) {
        if (!window.AuthManager?.isAuthenticated()) {
            this.estado = null;
            this.ocultarAviso();
            return null;
        }
        const estado = await window.AuthManager.getLicenseStatus();
        this.estado = estado;
        if (!estado) return null; // sin respuesta del servidor: no molestamos

        if (estado.activa) {
            this.ocultarAviso();
        } else {
            this.mostrarAviso();
            if (autoMostrar) this.autoMostrarModal();
        }
        this._pintarTarjeta();
        return estado;
    },

    /** Repinta la tarjeta dentro de la página "Sincronización en la Nube". */
    _pintarTarjeta() {
        const slot = document.getElementById('license-card-slot');
        if (slot) slot.innerHTML = this.renderCard();
    },

    /** Abre el modal una sola vez por sesión para no ser insistentes. */
    autoMostrarModal() {
        if (!this.esAdmin) return;
        try {
            if (sessionStorage.getItem('galloli_license_prompted')) return;
            sessionStorage.setItem('galloli_license_prompted', '1');
        } catch (e) { /* modo privado */ }
        setTimeout(() => this.abrirModal(), 900);
    },

    // ── Detección de la nube bloqueada ───────────────────────────────────────

    /**
     * Envuelve fetch para detectar el 402 que devuelve el Worker cuando la
     * licencia falta. No altera la respuesta: sólo avisa a la interfaz.
     */
    _installFetchWatcher() {
        if (this._fetchWatcher || typeof window.fetch !== 'function') return;
        this._fetchWatcher = true;
        const original = window.fetch.bind(window);
        window.fetch = async (...args) => {
            const respuesta = await original(...args);
            try {
                const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
                if (respuesta.status === 402 && url.includes('/api/') && !url.includes('/api/license')) {
                    this._onBloqueada();
                }
            } catch (e) { /* nunca romper fetch */ }
            return respuesta;
        };
    },

    _onBloqueada() {
        if (this.estado && !this.estado.activa && this.estado.exigida) return; // ya lo sabíamos
        this.estado = {
            exigida: true,
            activa: false,
            mensaje: 'Se requiere una licencia activa para sincronizar.'
        };
        this.mostrarAviso();
    },

    // ── Aviso permanente ─────────────────────────────────────────────────────

    mostrarAviso() {
        if (!this.bloqueada) return;
        if (this._avisoCerrado) return;

        let aviso = document.getElementById('license-banner');
        if (!aviso) {
            aviso = document.createElement('div');
            aviso.id = 'license-banner';
            aviso.style.cssText = [
                'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:9998',
                'background:#b3261e', 'color:#fff', 'padding:.7rem .9rem',
                'display:flex', 'align-items:center', 'gap:.75rem', 'flex-wrap:wrap',
                'font-size:.9rem', 'box-shadow:0 -2px 10px rgba(0,0,0,.25)',
                'padding-bottom:calc(.7rem + env(safe-area-inset-bottom, 0px))'
            ].join(';');
            document.body.appendChild(aviso);
        }

        const mensaje = this.esAdmin
            ? 'Modo local: la sincronización está desactivada. Activa tu licencia para volver a la nube.'
            : 'Modo local: la sincronización está desactivada. Pide al administrador que active la licencia.';

        aviso.innerHTML = `
            <i class="fas fa-lock"></i>
            <span style="flex:1;min-width:200px;">${mensaje}</span>
            ${this.esAdmin
                ? '<button id="license-banner-btn" style="background:#fff;color:#b3261e;border:none;border-radius:6px;padding:.45rem .9rem;font-weight:700;cursor:pointer;min-height:auto;">Activar licencia</button>'
                : ''}
            <button id="license-banner-close" title="Ocultar" style="background:transparent;color:#fff;border:none;cursor:pointer;min-height:auto;padding:.25rem .5rem;">
                <i class="fas fa-times"></i>
            </button>
        `;
        aviso.querySelector('#license-banner-btn')?.addEventListener('click', () => this.abrirModal());
        aviso.querySelector('#license-banner-close')?.addEventListener('click', () => {
            this._avisoCerrado = true;
            this.ocultarAviso();
        });
    },

    ocultarAviso() {
        document.getElementById('license-banner')?.remove();
    },

    // ── Modal de activación ──────────────────────────────────────────────────

    abrirModal() {
        if (this._modalAbierto) return;
        this._modalAbierto = true;

        const overlay = document.createElement('div');
        overlay.id = 'license-modal';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:9999', 'background:rgba(0,0,0,.55)',
            'display:flex', 'align-items:center', 'justify-content:center', 'padding:1rem'
        ].join(';');

        overlay.innerHTML = `
            <div style="background:#fff;border-radius:14px;max-width:520px;width:100%;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.35);">
                <div style="background:linear-gradient(135deg,#2196F3,#1976D2);color:#fff;padding:1.1rem 1.25rem;display:flex;align-items:center;gap:.6rem;">
                    <i class="fas fa-key" style="font-size:1.2rem;"></i>
                    <strong style="flex:1;font-size:1.05rem;">Activar licencia</strong>
                    <button id="license-modal-x" style="background:transparent;border:none;color:#fff;cursor:pointer;min-height:auto;padding:.25rem;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div style="padding:1.25rem;color:#333;font-size:.92rem;">
                    <p style="margin:0 0 .75rem;">
                        Pega aquí el código de activación que recibiste al comprar GallOli.
                        Cada copia tiene su propio código.
                    </p>
                    <textarea id="license-code" rows="3" spellcheck="false" autocomplete="off"
                        placeholder="GALLOLI1.……"
                        style="width:100%;box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.82rem;padding:.6rem;border:1px solid #ccc;border-radius:8px;resize:vertical;"></textarea>
                    <div id="license-error" style="display:none;margin-top:.6rem;padding:.6rem;border-radius:8px;background:#fdecea;color:#b3261e;font-size:.85rem;"></div>
                    <div id="license-ok" style="display:none;margin-top:.6rem;padding:.6rem;border-radius:8px;background:#e8f5e9;color:#2e7d32;font-size:.85rem;"></div>
                    <small style="display:block;margin-top:.7rem;color:#777;">
                        <i class="fas fa-info-circle"></i> La activación se hace una sola vez por negocio.
                        Mientras no la actives, la app sigue funcionando localmente pero no sincroniza.
                    </small>
                </div>
                <div style="padding:0 1.25rem 1.25rem;display:flex;gap:.6rem;flex-wrap:wrap;">
                    <button id="license-save" style="flex:1;min-width:140px;padding:.85rem;background:linear-gradient(135deg,#4CAF50,#388E3C);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;">
                        <i class="fas fa-check"></i> Activar
                    </button>
                    <button id="license-cancel" style="padding:.85rem 1.1rem;background:#eee;color:#444;border:none;border-radius:8px;font-weight:600;cursor:pointer;">
                        Después
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const cerrar = () => {
            this._modalAbierto = false;
            overlay.remove();
        };
        overlay.querySelector('#license-modal-x')?.addEventListener('click', cerrar);
        overlay.querySelector('#license-cancel')?.addEventListener('click', cerrar);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
        overlay.querySelector('#license-save')?.addEventListener('click', () => this._activarDesde(overlay));
        overlay.querySelector('#license-code')?.focus();
    },

    async _activarDesde(contenedor) {
        const input = contenedor.querySelector('#license-code');
        const errorEl = contenedor.querySelector('#license-error');
        const okEl = contenedor.querySelector('#license-ok');
        const boton = contenedor.querySelector('#license-save');
        const codigo = (input?.value || '').trim();

        errorEl.style.display = 'none';
        okEl.style.display = 'none';

        if (!codigo) {
            errorEl.textContent = 'Escribe el código de activación.';
            errorEl.style.display = 'block';
            return;
        }

        const textoOriginal = boton.innerHTML;
        boton.disabled = true;
        boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Activando...';

        try {
            const data = await window.AuthManager.activateLicense(codigo);
            this.estado = data.license || null;

            if (data.license && data.license.exigida && !data.license.activa) {
                throw new Error(data.license.mensaje || 'La licencia no quedó activa.');
            }

            okEl.textContent = data.message || '¡Licencia activada!';
            okEl.style.display = 'block';
            this.ocultarAviso();

            if (typeof Utils !== 'undefined' && Utils.showNotification) {
                Utils.showNotification('Licencia activada — sincronización habilitada', 'success', 4000);
            }

            // Volver a la nube sin recargar la página
            setTimeout(async () => {
                this._modalAbierto = false;
                document.getElementById('license-modal')?.remove();
                try {
                    if (window.SyncEngine) await window.SyncEngine.smartSync();
                } catch (e) { /* silencioso */ }
                if (window.App?.currentPage) window.App.loadPage(window.App.currentPage);
            }, 1200);
        } catch (error) {
            errorEl.textContent = error.message || 'No se pudo activar la licencia.';
            errorEl.style.display = 'block';
            boton.disabled = false;
            boton.innerHTML = textoOriginal;
        }
    },

    // ── Tarjeta dentro de "Sincronización en la Nube" ────────────────────────

    renderCard() {
        const e = this.estado;
        if (!e) return '';

        let color, icono, titulo, detalle;
        if (!e.exigida) {
            color = '#607d8b'; icono = 'fa-unlock';
            titulo = 'Licencias desactivadas';
            detalle = 'Este servidor no exige licencia. La sincronización está disponible para todos.';
        } else if (e.activa) {
            color = '#4CAF50'; icono = 'fa-check-circle';
            titulo = 'Licencia activa';
            detalle = e.mensaje || 'Todo en orden.';
        } else {
            color = '#b3261e'; icono = 'fa-lock';
            titulo = 'Licencia requerida';
            detalle = e.mensaje || 'Activa tu licencia para sincronizar con la nube.';
        }

        const datos = [];
        if (e.licenciatario) datos.push(`<div><b>Titular:</b> ${Utils.escapeHtml(e.licenciatario)}</div>`);
        if (e.serial) datos.push(`<div><b>N° de licencia:</b> <code>${Utils.escapeHtml(e.serial)}</code></div>`);
        if (e.plan) datos.push(`<div><b>Plan:</b> ${Utils.escapeHtml(e.plan)}</div>`);
        if (e.dominio) datos.push(`<div><b>Dominio autorizado:</b> ${Utils.escapeHtml(e.dominio)}</div>`);
        if (e.expira) {
            datos.push(`<div><b>Vence:</b> ${new Date(e.expira).toLocaleDateString('es-EC')}${e.dias_restantes != null ? ` (${e.dias_restantes} días)` : ''}</div>`);
        } else if (e.activa && e.exigida) {
            datos.push('<div><b>Vence:</b> nunca (licencia perpetua)</div>');
        }

        return `
            <div style="padding:1.5rem;background:#f5f5f5;border-radius:8px;">
                <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
                    <i class="fas ${icono}" style="font-size:2rem;color:${color};"></i>
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:bold;">${titulo}</div>
                        <div style="color:#666;font-size:0.9rem;">${Utils.escapeHtml(detalle)}</div>
                    </div>
                </div>
                ${datos.length ? `<div style="margin-top:1rem;color:#666;font-size:0.85rem;display:grid;gap:.25rem;">${datos.join('')}</div>` : ''}
                ${this.bloqueada && this.esAdmin ? `
                    <div style="margin-top:1rem;">
                        <input type="text" id="license-card-code" class="form-control" autocomplete="off"
                               placeholder="GALLOLI1.……" style="margin-bottom:.6rem;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.82rem;">
                        <button onclick="LicenseModule.activarDesdeTarjeta()"
                                style="width:100%;padding:.85rem;background:linear-gradient(135deg,#4CAF50,#388E3C);color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;">
                            <i class="fas fa-key"></i> Activar licencia
                        </button>
                        <div id="license-card-error" style="display:none;margin-top:.6rem;padding:.6rem;border-radius:8px;background:#fdecea;color:#b3261e;font-size:.85rem;"></div>
                    </div>
                ` : ''}
            </div>
        `;
    },

    async activarDesdeTarjeta() {
        const input = document.getElementById('license-card-code');
        const errorEl = document.getElementById('license-card-error');
        const codigo = (input?.value || '').trim();

        if (errorEl) errorEl.style.display = 'none';
        if (!codigo) {
            if (errorEl) { errorEl.textContent = 'Escribe el código de activación.'; errorEl.style.display = 'block'; }
            return;
        }

        try {
            const data = await window.AuthManager.activateLicense(codigo);
            this.estado = data.license || null;
            if (data.license && data.license.exigida && !data.license.activa) {
                throw new Error(data.license.mensaje || 'La licencia no quedó activa.');
            }
            this.ocultarAviso();
            if (typeof Utils !== 'undefined' && Utils.showNotification) {
                Utils.showNotification('Licencia activada — sincronización habilitada', 'success', 4000);
            }
            try { if (window.SyncEngine) await window.SyncEngine.smartSync(); } catch (e) { /* silencioso */ }
            if (window.App?.currentPage) window.App.loadPage(window.App.currentPage);
        } catch (error) {
            if (errorEl) {
                errorEl.textContent = error.message || 'No se pudo activar la licencia.';
                errorEl.style.display = 'block';
            }
        }
    }
};

window.LicenseModule = LicenseModule;
