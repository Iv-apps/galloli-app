// geo-chain.js — Pesaje en cadena con detección automática de cliente por GPS
// Funciona con app minimizada en APK Capacitor (BleForegroundService provee GPS + BLE)
// En PWA/TWA usa navigator.geolocation normal (solo con app en primer plano)

const GeoChain = {
    // Configuración
    MIN_WEIGHT_LB: 3.50,        // Peso mínimo para registrar venta
    STABLE_MS: 1500,            // ms que el peso debe estar estable
    CLIENT_RADIUS_M: 500,       // metros de radio para detectar cliente cercano
    GPS_POLL_MS: 4000,          // ms entre lecturas GPS en modo activo
    WEIGHT_ZERO_THRESHOLD: 0.5, // lb — por debajo de esto se considera "balanza vacía"

    // Estado
    _active: false,
    _stableTimer: null,
    _lastWeight: 0,
    _waitingForZero: false,
    _currentClientId: null,
    _gpsTimer: null,
    _lastLat: null,
    _lastLng: null,
    _weightUnsubscribe: null,
    _salePrice: 0,
    _costPrice: 0,
    _onSaleCallback: null,
    _onStatusCallback: null,
    _onClientDetectedCallback: null,

    // ¿Estamos en APK Capacitor nativo?
    isNative() {
        return typeof window !== 'undefined' &&
               window.Capacitor &&
               window.Capacitor.isNativePlatform &&
               window.Capacitor.isNativePlatform();
    },

    _getPlugin() {
        if (this.isNative() && window.Capacitor && window.Capacitor.Plugins) {
            return window.Capacitor.Plugins.BleForeground || null;
        }
        return null;
    },

    /**
     * Iniciar modo geo-cadena automático.
     * @param {object} opts
     *   opts.salePrice     — precio de venta del día (requerido)
     *   opts.costPrice     — costo del día (opcional)
     *   opts.onSale        — callback(sale, client) cuando se registra una venta
     *   opts.onStatus      — callback(msg, type) para actualizar UI ('info'|'ok'|'warn'|'error')
     *   opts.onClientDetected — callback(client, distanceM) cuando se detecta cliente cercano
     */
    async start(opts = {}) {
        if (this._active) return;

        this._salePrice = opts.salePrice || MermaModule.getTodaySalePrice();
        this._costPrice = opts.costPrice || MermaModule.getTodayMermaPrice();
        this._onSaleCallback = opts.onSale || null;
        this._onStatusCallback = opts.onStatus || null;
        this._onClientDetectedCallback = opts.onClientDetected || null;

        if (!this._salePrice) {
            this._status('Sin precio de venta configurado', 'error');
            return false;
        }

        this._active = true;
        this._waitingForZero = false;
        this._lastWeight = 0;
        this._currentClientId = null;

        this._status('Iniciando GPS...', 'info');

        // Iniciar GPS
        await this._startGps();

        // Escuchar peso de la balanza
        if (BluetoothScale.isConnected) {
            this._weightUnsubscribe = BluetoothScale.onWeight((w) => {
                this._handleWeight(BluetoothScale.currentRawWeight);
            });
            this._status('GPS + Balanza activos. Pon un pollo.', 'info');
        } else {
            this._status('GPS activo. Conecta la balanza.', 'warn');
        }

        return true;
    },

    stop() {
        this._active = false;
        this._stopGps();
        if (this._weightUnsubscribe) {
            this._weightUnsubscribe();
            this._weightUnsubscribe = null;
        }
        clearTimeout(this._stableTimer);
        this._stableTimer = null;
        this._currentClientId = null;
        this._waitingForZero = false;
    },

    // ─── GPS ────────────────────────────────────────────────────────────────

    async _startGps() {
        const plugin = this._getPlugin();

        if (plugin) {
            // APK nativo: el servicio ya tiene GPS corriendo, solo leer periódicamente
            this._gpsTimer = setInterval(async () => {
                try {
                    const loc = await plugin.getLocation();
                    if (loc && loc.hasLocation) {
                        this._lastLat = loc.lat;
                        this._lastLng = loc.lng;
                        this._onGpsUpdate(loc.lat, loc.lng);
                    }
                } catch (e) {
                    // silencioso
                }
            }, this.GPS_POLL_MS);

            // Leer inmediatamente
            try {
                const loc = await plugin.getLocation();
                if (loc && loc.hasLocation) {
                    this._lastLat = loc.lat;
                    this._lastLng = loc.lng;
                    this._onGpsUpdate(loc.lat, loc.lng);
                }
            } catch (e) {}

        } else if (navigator.geolocation) {
            // PWA/TWA: usar geolocation del navegador (solo funciona en primer plano)
            navigator.geolocation.watchPosition(
                (pos) => {
                    this._lastLat = pos.coords.latitude;
                    this._lastLng = pos.coords.longitude;
                    this._onGpsUpdate(pos.coords.latitude, pos.coords.longitude);
                },
                (err) => {
                    this._status('GPS no disponible: ' + err.message, 'warn');
                },
                { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
            );
        } else {
            this._status('GPS no soportado en este dispositivo', 'error');
        }
    },

    _stopGps() {
        if (this._gpsTimer) {
            clearInterval(this._gpsTimer);
            this._gpsTimer = null;
        }
        // watchPosition se limpia al detener el módulo
    },

    _onGpsUpdate(lat, lng) {
        if (!this._active) return;

        // Buscar cliente más cercano dentro del radio
        const nearest = this._findNearestClient(lat, lng);

        if (nearest) {
            if (nearest.client.id !== this._currentClientId) {
                this._currentClientId = nearest.client.id;
                this._status(
                    `Cliente detectado: ${nearest.client.name} (${Math.round(nearest.distanceM)}m)`,
                    'ok'
                );
                if (this._onClientDetectedCallback) {
                    this._onClientDetectedCallback(nearest.client, nearest.distanceM);
                }
            }
        } else {
            if (this._currentClientId !== null) {
                this._currentClientId = null;
                this._status('Sin cliente cercano — muévete hacia un cliente', 'info');
                if (this._onClientDetectedCallback) {
                    this._onClientDetectedCallback(null, null);
                }
            }
        }
    },

    // ─── Peso ───────────────────────────────────────────────────────────────

    _handleWeight(raw) {
        if (!this._active) return;

        // Si ya registramos y esperamos que retiren el pollo
        if (this._waitingForZero) {
            if (raw < this.WEIGHT_ZERO_THRESHOLD) {
                this._waitingForZero = false;
                this._lastWeight = 0;
                this._status(
                    this._currentClientId
                        ? 'Pon el siguiente pollo'
                        : 'Pon el siguiente pollo (sin cliente cercano)',
                    'info'
                );
            }
            return;
        }

        // Detectar cambio de peso
        if (Math.abs(raw - this._lastWeight) > 0.01) {
            this._lastWeight = raw;
            clearTimeout(this._stableTimer);

            if (raw > this.MIN_WEIGHT_LB) {
                this._status(`Estabilizando... ${raw.toFixed(3)} lb`, 'info');
                this._stableTimer = setTimeout(() => {
                    // Verificar que el peso sigue estable
                    const current = BluetoothScale.currentRawWeight;
                    if (Math.abs(current - raw) < 0.05) {
                        this._tryAutoSale(raw);
                    }
                }, this.STABLE_MS);
            } else if (raw < this.WEIGHT_ZERO_THRESHOLD) {
                this._status(
                    this._currentClientId
                        ? `Cliente: ${this._getClientName(this._currentClientId)} — pon un pollo`
                        : 'Sin cliente cercano — pon un pollo',
                    'info'
                );
            } else {
                this._status(`${raw.toFixed(3)} lb — mínimo ${this.MIN_WEIGHT_LB} lb`, 'warn');
            }
        }
    },

    _tryAutoSale(weight) {
        if (!this._active) return;

        if (!this._currentClientId) {
            this._status('⚠️ Sin cliente cercano — acércate a un cliente', 'warn');
            return;
        }

        const client = ClientsModule.getClientById(this._currentClientId);
        if (!client) {
            this._status('⚠️ Cliente no encontrado', 'error');
            return;
        }

        // Registrar venta en efectivo automáticamente
        const sale = SalesModule.addSale(
            this._currentClientId,
            weight,
            1,              // cantidad: 1 pollo por pesaje
            this._salePrice,
            null,
            true            // isPaid = efectivo
        );
        ClientsModule.updateClientStats(this._currentClientId, weight, 1, sale.total);

        this._waitingForZero = true;

        const msg = `✅ ${client.name} — ${weight.toFixed(3)} lb — ${Utils.formatCurrency(sale.total)}`;
        this._status(msg, 'ok');

        // Vibración de confirmación
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

        // Notificación visual
        Utils.showNotification(msg, 'success', 3000);

        if (this._onSaleCallback) {
            this._onSaleCallback(sale, client);
        }
    },

    // ─── Utilidades ─────────────────────────────────────────────────────────

    _findNearestClient(lat, lng) {
        const clients = ClientsModule.clients.filter(c =>
            c.isActive !== false &&
            c.coordinates &&
            c.coordinates.lat !== null && c.coordinates.lat !== undefined &&
            c.coordinates.lng !== null && c.coordinates.lng !== undefined
        );

        let nearest = null;
        let minDist = Infinity;

        clients.forEach(client => {
            try {
                const cLat = parseFloat(client.coordinates.lat);
                const cLng = parseFloat(client.coordinates.lng);
                if (isNaN(cLat) || isNaN(cLng)) return;
                const dist = this._haversineM(lat, lng, cLat, cLng);
                if (dist < this.CLIENT_RADIUS_M && dist < minDist) {
                    minDist = dist;
                    nearest = { client, distanceM: dist };
                }
            } catch (e) {}
        });

        return nearest;
    },

    _haversineM(lat1, lon1, lat2, lon2) {
        const R = 6371000; // metros
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    },

    _getClientName(clientId) {
        const c = ClientsModule.getClientById(clientId);
        return c ? c.name : 'Desconocido';
    },

    _status(msg, type = 'info') {
        if (this._onStatusCallback) {
            this._onStatusCallback(msg, type);
        }
    },

    // ─── API pública para UI ─────────────────────────────────────────────────

    get isActive() { return this._active; },
    get currentClientId() { return this._currentClientId; },
    get currentClientName() { return this._getClientName(this._currentClientId); },
    get hasGps() { return this._lastLat !== null; },

    /**
     * Cambiar cliente manualmente (override del detectado por GPS)
     */
    setClient(clientId) {
        this._currentClientId = clientId;
        const name = this._getClientName(clientId);
        this._status(`Cliente manual: ${name}`, 'ok');
    },

    /**
     * Obtener lista de clientes cercanos ordenados por distancia
     */
    getNearbyClients(radiusM = null) {
        if (this._lastLat === null) return [];
        const r = radiusM || this.CLIENT_RADIUS_M * 4;
        const clients = ClientsModule.clients.filter(c =>
            c.isActive !== false &&
            c.coordinates &&
            c.coordinates.lat !== null && c.coordinates.lat !== undefined &&
            c.coordinates.lng !== null && c.coordinates.lng !== undefined
        );
        const result = [];
        clients.forEach(client => {
            try {
                const cLat = parseFloat(client.coordinates.lat);
                const cLng = parseFloat(client.coordinates.lng);
                if (isNaN(cLat) || isNaN(cLng)) return;
                const dist = this._haversineM(this._lastLat, this._lastLng, cLat, cLng);
                if (dist <= r) result.push({ client, distanceM: Math.round(dist) });
            } catch (e) {}
        });
        return result.sort((a, b) => a.distanceM - b.distanceM);
    }
};

window.GeoChain = GeoChain;
