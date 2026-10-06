// Modulo de Clientes
const ClientsModule = {
    clients: [],

    async init() {
        await this.loadClients();
    },

    addClient(name, phone, address, locationData, coordinates = null) {
        // Validar coordenadas: rechazar Null Island (0,0) o fuera de rango
        let validCoords = null;
        if (coordinates) {
            const lat = parseFloat(coordinates.lat || coordinates.latitude);
            const lng = parseFloat(coordinates.lng || coordinates.longitude);
            if (!isNaN(lat) && !isNaN(lng) &&
                !(lat === 0 && lng === 0) &&
                lat >= -90 && lat <= 90 &&
                lng >= -180 && lng <= 180) {
                validCoords = { lat, lng };
            } else {
                console.warn('[ClientsModule] Coordenadas invalidas rechazadas:', coordinates);
            }
        } else if (locationData && locationData.latitude != null && locationData.longitude != null) {
            const lat = parseFloat(locationData.latitude);
            const lng = parseFloat(locationData.longitude);
            if (!isNaN(lat) && !isNaN(lng) && !(lat === 0 && lng === 0)) {
                validCoords = { lat, lng };
            }
        }

        const client = {
            id: Date.now(),
            name,
            phone,
            address,
            location: locationData.address || locationData,
            coordinates: validCoords,
            timestamp: new Date().toISOString(),
            lastModified: Date.now(),
            date: Utils.formatDate(),
            isActive: true, // NUEVO: Estado activo por defecto
            totalSales: 0,
            totalAmount: 0,
            totalWeight: 0,
            totalQuantity: 0,
            totalOrders: 0
        };

        this.clients.push(client);
        this.saveClients();
        
        // Notificar creacion de cliente (sin bloquear si falla)
        if (typeof NotificationsModule !== 'undefined') {
            try {
                NotificationsModule.notifyClientCreated(client.name).catch(err => {
                    console.warn('No se pudo enviar notificacion:', err);
                });
            } catch (err) {
                console.warn('Error al notificar:', err);
            }
        }
        
        return client;
    },

    getClientById(id) {
        return this.clients.find(client => client.id === id);
    },
    
    /**
     * Busca clientes duplicados basandose en nombre, telefono o direccion
     * @param {string} name - Nombre del cliente
     * @param {string} phone - Telefono del cliente
     * @param {string} address - Direccion del cliente
     * @returns {object|null} - Cliente duplicado o null si no existe
     */
    findDuplicate(name, phone, address) {
        const nameLower = name.toLowerCase().trim();
        const phoneCleaned = phone.replace(/\D/g, ''); // Eliminar caracteres no numericos
        const addressLower = address.toLowerCase().trim();
        
        return this.clients.find(client => {
            if (client.isActive === false) return false; // Ignorar clientes archivados
            
            const clientNameLower = client.name.toLowerCase().trim();
            const clientPhoneCleaned = client.phone.replace(/\D/g, '');
            const clientAddressLower = client.address.toLowerCase().trim();
            
            // Coincidencia exacta de nombre
            const nameMatch = clientNameLower === nameLower;
            
            // Coincidencia exacta de telefono (sin formato)
            const phoneMatch = phoneCleaned && clientPhoneCleaned === phoneCleaned;
            
            // Coincidencia de direccion (similar)
            const addressMatch = clientAddressLower === addressLower;
            
            // Es duplicado si coincide nombre Y telefono, o nombre Y direccion, o telefono Y direccion
            return (nameMatch && phoneMatch) || (nameMatch && addressMatch) || (phoneMatch && addressMatch);
        });
    },

    updateClientList() {
    const clientList = document.getElementById('client-list');
    if (!clientList) return;

    clientList.innerHTML = '';

    // Filtrar solo clientes activos por defecto
    const activeClients = this.clients.filter(c => c.isActive !== false);

    if (activeClients.length === 0) {
        clientList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users empty-state-icon"></i>
                <p>No hay clientes activos</p>
                <button class="btn btn-outline" onclick="ClientsModule.toggleShowInactive()" style="margin-top: 10px;">
                    <i class="fas fa-archive"></i> Ver Archivados
                </button>
            </div>
        `;
        return;
    }

    activeClients.forEach(client => {
        const li = document.createElement('li');
        li.className = 'client-item';
        
        // Crear enlace de telefono
        const phoneLink = client.phone ? 
            `<a href="tel:${Utils.escapeHtml(client.phone)}" class="client-phone">
                <i class="fas fa-phone"></i> ${Utils.escapeHtml(client.phone)}
            </a>` : 
            `<span class="client-phone"><i class="fas fa-phone"></i> ${Utils.escapeHtml(client.phone)}</span>`;
        
        // Crear enlace de ubicacion si tiene coordenadas
        let locationLink = '';
        if (client.coordinates && client.coordinates.lat && client.coordinates.lng) {
            const mapsUrl = `https://www.google.com/maps?q=${client.coordinates.lat},${client.coordinates.lng}`;
            locationLink = `
                <p class="client-address">
                    <a href="${mapsUrl}" target="_blank" class="client-location-link">
                        <i class="fas fa-map-marker-alt"></i> ${Utils.escapeHtml(client.address)}
                    </a>
                </p>
            `;
        } else {
            locationLink = `<p class="client-address"><i class="fas fa-map-marker-alt"></i> ${Utils.escapeHtml(client.address)}</p>`;
        }
        
        li.innerHTML = `
            <div class="client-info">
                <h3 class="client-name"><i class="fas fa-user"></i> ${Utils.escapeHtml(client.name)}</h3>
                <p>${phoneLink}</p>
                ${locationLink}
                ${client.coordinates ? 
                    `<p class="client-location"><i class="fas fa-map-pin"></i> ${client.location || 'Ubicacion seleccionada'}</p>` : ''}
                ${client.coordinates ? 
                    `<p class="client-location"><i class="fas fa-clock"></i> ${new Date(client.timestamp).toLocaleTimeString('es-ES')}</p>` : ''}
                <p class="client-location"><i class="fas fa-shopping-cart"></i> ${client.totalSales} ventas | ${client.totalOrders} pedidos</p>
            </div>
            <div class="client-actions">
                <button class="btn btn-outline" onclick="ClientsModule.editClient(${client.id})" title="Editar cliente">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-warning" onclick="ClientsModule.archiveClient(${client.id})" title="Archivar cliente">
                    <i class="fas fa-archive"></i>
                </button>
            </div>
        `;
        clientList.appendChild(li);
    });
    
    // Actualizar contador de clientes
    if (typeof App !== 'undefined' && App.updateClientCount) {
        App.updateClientCount();
    }
},

    updateClientSelect() {
        const select = document.getElementById('sale-client');
        const orderClientSelect = document.getElementById('order-client');
        
        // Solo mostrar clientes activos en los selects
        const activeClients = this.clients.filter(c => c.isActive !== false);
        
        if (select) {
            select.innerHTML = '<option value="">Seleccionar cliente</option>';
            activeClients.forEach(client => {
                const option = document.createElement('option');
                option.value = client.id;
                option.textContent = `${client.name} - ${client.phone}`;
                select.appendChild(option);
            });
        }
        
        if (orderClientSelect) {
            orderClientSelect.innerHTML = '<option value="">Seleccionar cliente</option>';
            activeClients.forEach(client => {
                const option = document.createElement('option');
                option.value = client.id;
                option.textContent = `${client.name} - ${client.phone}`;
                orderClientSelect.appendChild(option);
            });
        }
    },

    // Archivar cliente (en lugar de eliminar)
    archiveClient(id) {
        const client = this.getClientById(id);
        if (!client) {
            Utils.showNotification('Cliente no encontrado', 'error', 3000);
            return false;
        }

        const associatedData = this.hasAssociatedData(id);
        const hasData = associatedData.hasSales || associatedData.hasOrders || associatedData.hasCredits;
        
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header" style="background: var(--warning); color: white;">
                    <h3><i class="fas fa-archive"></i> Archivar Cliente</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()" style="color: white;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <i class="fas fa-archive" style="font-size: 3rem; color: var(--warning); margin-bottom: 15px;"></i>
                        <h3 style="margin-bottom: 10px;">Archivar "${Utils.escapeHtml(client.name)}"?</h3>
                        <p style="color: var(--gray); margin-bottom: 20px;">El cliente se ocultara pero mantendra su historial</p>
                    </div>
                    
                    <div style="background: var(--light); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                        <p style="margin: 5px 0;"><strong><i class="fas fa-user"></i> Cliente:</strong> ${Utils.escapeHtml(client.name)}</p>
                        <p style="margin: 5px 0;"><strong><i class="fas fa-phone"></i> Telefono:</strong> ${Utils.escapeHtml(client.phone)}</p>
                        ${hasData ? `
                            <p style="margin: 5px 0;"><strong><i class="fas fa-receipt"></i> Ventas:</strong> ${associatedData.totalSales} registros</p>
                            <p style="margin: 5px 0;"><strong><i class="fas fa-clipboard-list"></i> Pedidos:</strong> ${associatedData.totalOrders} registros</p>
                            <p style="margin: 5px 0;"><strong><i class="fas fa-credit-card"></i> Creditos:</strong> ${associatedData.totalCredits} pendientes</p>
                        ` : '<p style="color: var(--gray);">Sin historial de datos</p>'}
                    </div>
                    
                    <div style="background: #FFF3CD; padding: 12px; border-radius: 8px; border-left: 4px solid var(--warning); margin-bottom: 20px;">
                        <p style="margin: 0; color: #856404; font-size: 0.9rem;">
                            <i class="fas fa-info-circle"></i> <strong>Al archivar:</strong>
                        </p>
                        <ul style="margin: 10px 0 0 20px; color: #856404; font-size: 0.85rem;">
                            <li>No aparecera en la lista de clientes activos</li>
                            <li>No estara disponible para nuevas ventas/pedidos</li>
                            <li>Su historial se mantendra intacto</li>
                            <li>Podras reactivarlo cuando quieras</li>
                        </ul>
                    </div>
                    
                    <div style="display: flex; gap: 10px;">
                        <button class="btn btn-outline" onclick="this.closest('.modal').remove()" style="flex: 1;">
                            <i class="fas fa-times"></i> Cancelar
                        </button>
                        <button class="btn btn-warning" id="archive-btn" style="flex: 1;">
                            <i class="fas fa-archive"></i> Archivar Cliente
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const archiveBtn = modal.querySelector('#archive-btn');
        archiveBtn.addEventListener('click', () => {
            client.isActive = false;
            client.archivedDate = Utils.formatDateTime();
            this.saveClients();
            this.updateClientList();
            this.updateClientSelect();
            modal.remove();
            Utils.showNotification('Cliente archivado correctamente', 'success', 3000);
        });
        
        return true;
    },

    // Reactivar cliente archivado
    reactivateClient(id) {
        const client = this.getClientById(id);
        if (client) {
            client.isActive = true;
            delete client.archivedDate;
            this.saveClients();
            this.updateClientList();
            this.updateClientSelect();
            Utils.showNotification('Cliente reactivado correctamente', 'success', 3000);
        }
    },

    // Alternar vista de clientes archivados
    toggleShowInactive() {
        const clientList = document.getElementById('client-list');
        if (!clientList) return;

        const inactiveClients = this.clients.filter(c => c.isActive === false);
        
        if (inactiveClients.length === 0) {
            Utils.showNotification('No hay clientes archivados', 'info', 3000);
            return;
        }

        clientList.innerHTML = `
            <div style="background: var(--warning); color: white; padding: 10px; border-radius: 8px; margin-bottom: 15px; text-align: center;">
                <h3><i class="fas fa-archive"></i> Clientes Archivados (${inactiveClients.length})</h3>
                <button class="btn btn-outline" onclick="ClientsModule.updateClientList()" style="margin-top: 10px; color: white; border-color: white;">
                    <i class="fas fa-arrow-left"></i> Volver a Activos
                </button>
            </div>
        `;

        inactiveClients.forEach(client => {
            const li = document.createElement('li');
            li.className = 'client-item';
            li.style.opacity = '0.7';
            li.style.border = '2px dashed var(--warning)';
            
            li.innerHTML = `
                <div class="client-info">
                    <h3><i class="fas fa-archive"></i> ${Utils.escapeHtml(client.name)} <span style="color: var(--warning); font-size: 0.8rem;">(Archivado)</span></h3>
                    <p><i class="fas fa-phone"></i> ${Utils.escapeHtml(client.phone)}</p>
                    <p class="client-location"><i class="fas fa-map-marker-alt"></i> ${Utils.escapeHtml(client.address)}</p>
                    <p class="client-location"><i class="fas fa-calendar"></i> Archivado: ${client.archivedDate || 'Fecha no disponible'}</p>
                    <p class="client-location"><i class="fas fa-shopping-cart"></i> ${client.totalSales} ventas | ${client.totalOrders} pedidos</p>
                </div>
                <div class="client-actions">
                    <button class="btn btn-success" onclick="ClientsModule.reactivateClient(${client.id})" title="Reactivar cliente">
                        <i class="fas fa-undo"></i> Reactivar
                    </button>
                </div>
            `;
            clientList.appendChild(li);
        });
    },

    updateClientStats(clientId, weight, quantity, amount) {
        const client = this.clients.find(c => c.id === clientId);
        if (client) {
            client.totalSales += 1;
            client.totalAmount += amount;
            client.totalWeight += weight;
            client.totalQuantity += quantity;
            this.saveClients();
        }
    },

    updateClientOrderStats(clientId) {
        const client = this.clients.find(c => c.id === clientId);
        if (client) {
            client.totalOrders += 1;
            this.saveClients();
        }
    },

    // Verificar si un cliente tiene datos asociados
    hasAssociatedData(clientId) {
        const sales = SalesModule.sales.filter(s => s.clientId === clientId);
        const orders = OrdersModule.orders.filter(o => o.clientId === clientId);
        const credits = SalesModule.getCreditsByClient(clientId);
        
        return {
            hasSales: sales.length > 0,
            hasOrders: orders.length > 0,
            hasCredits: credits.length > 0,
            totalSales: sales.length,
            totalOrders: orders.length,
            totalCredits: credits.length,
            totalDebt: SalesModule.getClientTotalDebt(clientId)
        };
    },

    // Editar cliente existente - NUEVA IMPLEMENTACION LIMPIA
    editClient(clientId) {
        const client = this.getClientById(clientId);
        if (!client) {
            Utils.showNotification('Cliente no encontrado', 'error', 3000);
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.style.zIndex = '10000';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-edit"></i> Editar Cliente</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="edit-client-form">
                        <div class="form-group">
                            <label class="form-label" for="edit-client-name">Nombre del Cliente</label>
                            <input type="text" class="form-input" id="edit-client-name" 
                                   value="${client.name || ''}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="edit-client-phone">Telefono</label>
                            <input type="tel" class="form-input" id="edit-client-phone" 
                                   value="${client.phone || ''}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="edit-client-address">Direccion</label>
                            <input type="text" class="form-input" id="edit-client-address" 
                                   value="${client.address || ''}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="edit-client-location">Ubicacion (Descripcion)</label>
                            <input type="text" class="form-input" id="edit-client-location" 
                                   value="${client.location || ''}" placeholder="Descripcion de la ubicacion">
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="edit-client-lat">Coordenadas</label>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                                <input type="number" step="any" class="form-input" id="edit-client-lat" 
                                       placeholder="Latitud" value="${client.coordinates?.lat || ''}">
                                <input type="number" step="any" class="form-input" id="edit-client-lng" 
                                       placeholder="Longitud" value="${client.coordinates?.lng || ''}">
                            </div>
                            <button type="button" class="btn btn-outline" onclick="ClientsModule.openMapForEdit(${clientId})" 
                                    style="width: 100%; margin-top: 10px;">
                                <i class="fas fa-map-marker-alt"></i> Seleccionar en Mapa
                            </button>
                        </div>
                        <button type="submit" class="btn btn-success" style="width: 100%;">
                            <i class="fas fa-save"></i> Guardar Cambios
                        </button>
                    </form>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const form = modal.querySelector('#edit-client-form');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveClientChanges(clientId, modal);
        });
    },

    // Guardar cambios del cliente - NUEVA IMPLEMENTACION
    saveClientChanges(clientId, modal) {
        const client = this.getClientById(clientId);
        if (!client) return;

        const name = document.getElementById('edit-client-name').value.trim();
        const phone = document.getElementById('edit-client-phone').value.trim();
        const address = document.getElementById('edit-client-address').value.trim();
        const location = document.getElementById('edit-client-location').value.trim();
        const lat = document.getElementById('edit-client-lat').value;
        const lng = document.getElementById('edit-client-lng').value;

        if (!name || !phone || !address) {
            Utils.showNotification('Complete los campos obligatorios', 'error', 3000);
            return;
        }

        // Actualizar datos basicos
        client.name = name;
        client.phone = phone;
        client.address = address;
        client.location = location;
        client.lastModified = Date.now();

        // Actualizar coordenadas si estan presentes
        if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
            client.coordinates = {
                lat: parseFloat(lat),
                lng: parseFloat(lng)
            };
        }

        this.saveClients();
        this.updateClientList();
        this.updateClientSelect();
        
        modal.remove();
        Utils.showNotification('Cliente actualizado correctamente', 'success', 3000);
    },

    // Abrir mapa para editar ubicacion - NUEVA IMPLEMENTACION
    openMapForEdit(clientId) {
        const client = this.getClientById(clientId);
        if (!client) return;

        // Coordenadas por defecto o del cliente
        let lat = 14.6349;
        let lng = -90.5069;
        
        if (client.coordinates && client.coordinates.lat && client.coordinates.lng) {
            lat = client.coordinates.lat;
            lng = client.coordinates.lng;
        }

        // Crear modal del mapa
        const mapModal = document.createElement('div');
        mapModal.className = 'modal active';
        mapModal.style.zIndex = '10001';
        mapModal.innerHTML = `
            <div class="modal-content" style="max-width: 800px;">
                <div class="modal-header">
                    <h3><i class="fas fa-map-marker-alt"></i> Seleccionar Ubicacion</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div id="edit-location-map" style="height: 400px; width: 100%; margin-bottom: 15px;"></div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
                        <div>
                            <label>Latitud:</label>
                            <input type="number" step="any" id="map-edit-lat" class="form-input" readonly>
                        </div>
                        <div>
                            <label>Longitud:</label>
                            <input type="number" step="any" id="map-edit-lng" class="form-input" readonly>
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn btn-outline" onclick="this.closest('.modal').remove()" style="flex: 1;">
                            <i class="fas fa-times"></i> Cancelar
                        </button>
                        <button class="btn btn-success" onclick="ClientsModule.saveMapLocation(${clientId})" style="flex: 1;">
                            <i class="fas fa-check"></i> Usar Esta Ubicacion
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(mapModal);
        
        // Inicializar mapa despues de un breve delay
        setTimeout(() => {
            if (typeof L !== 'undefined') {
                const map = L.map('edit-location-map').setView([lat, lng], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                
                const marker = L.marker([lat, lng], { draggable: true }).addTo(map);
                
                // Actualizar inputs cuando se mueve el marcador
                const updateInputs = (latlng) => {
                    document.getElementById('map-edit-lat').value = latlng.lat.toFixed(6);
                    document.getElementById('map-edit-lng').value = latlng.lng.toFixed(6);
                };
                
                updateInputs({ lat, lng });
                
                marker.on('dragend', (e) => {
                    const pos = e.target.getLatLng();
                    updateInputs(pos);
                });
                
                map.on('click', (e) => {
                    marker.setLatLng(e.latlng);
                    updateInputs(e.latlng);
                });
                
                // Guardar referencia del mapa
                this.editMap = map;
            }
        }, 200);
    },

    // Guardar ubicacion del mapa - NUEVA IMPLEMENTACION
    saveMapLocation(clientId) {
        const lat = document.getElementById('map-edit-lat').value;
        const lng = document.getElementById('map-edit-lng').value;
        
        if (!lat || !lng) {
            Utils.showNotification('Selecciona una ubicacion en el mapa', 'error', 3000);
            return;
        }
        
        // Actualizar los campos en el formulario de edicion
        const editLatInput = document.getElementById('edit-client-lat');
        const editLngInput = document.getElementById('edit-client-lng');
        
        if (editLatInput) editLatInput.value = lat;
        if (editLngInput) editLngInput.value = lng;
        
        // Cerrar modal del mapa
        const mapModal = document.querySelector('.modal[style*="10001"]');
        if (mapModal) mapModal.remove();
        
        Utils.showNotification('Ubicacion seleccionada correctamente', 'success', 3000);
    },

    // Crear cliente rapido con ubicacion automatica - CON GEOCODIFICACION
    async createQuickClient(name, phone, address = 'Sin direccion') {
        try {
            const position = await this.getCurrentPosition();
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            // Intentar obtener direccion real de las coordenadas
            let realAddress = address;
            let locationDescription = 'Ubicacion automatica';
            
            try {
                const addressData = await this.getAddressFromCoordinates(lat, lng);
                if (addressData) {
                    realAddress = addressData.display_name || addressData.address || address;
                    locationDescription = addressData.display_name || 'Ubicacion automatica';
                }
            } catch (geoError) {
                console.log('No se pudo obtener direccion:', geoError);
                // Continuar con coordenadas sin direccion
            }
            
            const client = {
                id: Date.now(),
                name: name,
                phone: phone,
                address: realAddress,
                location: locationDescription,
                isActive: true, // NUEVO: Activo por defecto
                coordinates: {
                    lat: lat,
                    lng: lng
                },
                timestamp: new Date().toISOString(),
                date: Utils.formatDate(),
                totalSales: 0,
                totalAmount: 0,
                totalWeight: 0,
                totalQuantity: 0,
                totalOrders: 0
            };

            this.clients.push(client);
            this.saveClients();
            
            // Notificar creacion de cliente (sin bloquear si falla)
            if (typeof NotificationsModule !== 'undefined') {
                try {
                    NotificationsModule.notifyClientCreated(client.name).catch(err => {
                        console.warn('No se pudo enviar notificacion:', err);
                    });
                } catch (err) {
                    console.warn('Error al notificar:', err);
                }
            }
            
            Utils.showNotification('Cliente creado con ubicacion automatica', 'success', 3000);
            return client;
        } catch (error) {
            const client = {
                id: Date.now(),
                name: name,
                phone: phone,
                address: address,
                location: 'Sin ubicacion',
                isActive: true, // NUEVO: Activo por defecto
                coordinates: null,
                timestamp: new Date().toISOString(),
                date: Utils.formatDate(),
                totalSales: 0,
                totalAmount: 0,
                totalWeight: 0,
                totalQuantity: 0,
                totalOrders: 0
            };

            this.clients.push(client);
            this.saveClients();
            
            // Notificar creacion de cliente (sin bloquear si falla)
            if (typeof NotificationsModule !== 'undefined') {
                try {
                    NotificationsModule.notifyClientCreated(client.name).catch(err => {
                        console.warn('No se pudo enviar notificacion:', err);
                    });
                } catch (err) {
                    console.warn('Error al notificar:', err);
                }
            }
            
            Utils.showNotification('Cliente creado sin ubicacion (GPS no disponible)', 'warning', 3000);
            return client;
        }
    },

    // Obtener direccion desde coordenadas usando Nominatim (OpenStreetMap)
    async getAddressFromCoordinates(lat, lng) {
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
                {
                    headers: {
                        'User-Agent': 'GallOli-App/1.0'
                    }
                }
            );
            
            if (!response.ok) throw new Error('Error en geocodificacion');
            
            const data = await response.json();
            return data;
        } catch (error) {
            console.warn('Error obteniendo direccion:', error);
            return null;
        }
    },

    // Obtener posicion actual con alta precision
    getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocalizacion no soportada'));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                resolve,
                reject,
                {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 0 // Siempre pedir posicion fresca
                }
            );
        });
    },

    async saveClients() {
        if (DB.db) {
            for (const client of this.clients) {
                await DB.set('clients', client);
            }
        } else {
            localStorage.setItem('polloClients', JSON.stringify(this.clients));
        }
    },

    async loadClients() {
        if (DB.db) {
            this.clients = await DB.getAll('clients');
        } else {
            const saved = localStorage.getItem('polloClients');
            if (saved) this.clients = JSON.parse(saved);
        }
    }
};

// Modulo de Pedidos
const OrdersModule = {
    orders: [],

    async init() {
        await this.loadOrders();
    },

    addOrder(clientId, weight, quantity, price, deliveryDate = null, notes = '') {
        const todayMermaPrice = MermaModule.getTodayMermaPrice();
        const orderPrice = price || todayMermaPrice || price;
        
        const total = weight * orderPrice;
        const averageWeight = Utils.calculateAverageWeight(weight, quantity);
        
        const order = {
            id: Date.now(),
            clientId,
            weight: parseFloat(weight),
            quantity: parseInt(quantity),
            averageWeight: parseFloat(averageWeight.toFixed(2)),
            price: orderPrice,
            originalPrice: price,
            mermaPrice: todayMermaPrice,
            total,
            notes,
            status: 'pending', // pending, delivered, cancelled
            createdDate: Utils.formatDate(),
            createdTime: new Date().toLocaleTimeString('es-ES'),
            deliveryDate: deliveryDate ? Utils.formatDate(new Date(deliveryDate)) : null,
            deliveryTime: deliveryDate ? '12:00' : null,
            timestamp: new Date().getTime(),
            dayKey: Utils.getTodayDate()
        };

        this.orders.push(order);
        this.saveOrders();
        ClientsModule.updateClientOrderStats(clientId);
        
        // NUEVO: Notificar al modulo de rutas sobre nuevo pedido
        if (RutasModule.actualizarRutaAutomatica) {
            RutasModule.actualizarRutaAutomatica();
        }
        
        return order;
    },

    getOrdersByStatus(status = null) {
        if (!status) return this.orders;
        return this.orders.filter(order => order.status === status);
    },

    getPendingOrders() {
        return this.getOrdersByStatus('pending');
    },

    getTodayOrders() {
        return this.orders.filter(order => order.createdDate === Utils.getTodayDate());
    },

    updateOrderStatus(orderId, status) {
        const order = this.orders.find(o => o.id === orderId);
        if (order) {
            const estadoAnterior = order.status;
            order.status = status;
            order.lastModified = Date.now();
            if (status === 'delivered') {
                order.deliveredDate = Utils.formatDate();
                order.deliveredTime = new Date().toLocaleTimeString('es-ES');
            }
            if (status === 'cancelled') {
                order.cancelledDate = Utils.formatDate();
                order.cancelledTime = new Date().toLocaleTimeString('es-ES');
            }
            this.saveOrders();

            // Sincronizar cambio de estado al servidor
            if (typeof SyncEngine !== 'undefined' && SyncEngine.addToQueue) {
                SyncEngine.addToQueue('orders', String(order.id), 'update', order);
            }

            // Notificar al modulo de rutas sobre el cambio de estado
            if (estadoAnterior !== status && RutasModule.actualizarRutaPorCambioPedido) {
                RutasModule.actualizarRutaPorCambioPedido(orderId, status);
            }

            return true;
        }
        return false;
    },

    async deleteOrder(orderId) {
        const order = this.orders.find(o => o.id === orderId);
        if (order) {
            order.deleted = true;
            order.deletedAt = Date.now();
            order.lastModified = Date.now();
        }
        this.orders = this.orders.filter(order => order.id !== orderId);
        await this.saveOrders();

        if (typeof window.SyncEngine !== 'undefined' &&
            window.SyncEngine &&
            typeof window.SyncEngine.notifyChange === 'function') {
            try {
                await window.SyncEngine.notifyChange('orders', String(orderId), 'delete');
                console.log('✅ Eliminación de pedido confirmada en servidor:', orderId);
            } catch (syncErr) {
                console.warn('⚠️ Eliminación de pedido en cola offline:', orderId, syncErr.message);
            }
        }
        this.updateOrdersList();
        return true;
    },

    updateOrdersList(statusFilter = null) {
        const ordersList = document.getElementById('orders-list');
        if (!ordersList) return;

        ordersList.innerHTML = '';

        const filteredOrders = statusFilter ? 
            this.getOrdersByStatus(statusFilter) : 
            this.orders;

        const sortedOrders = filteredOrders.sort((a, b) => b.timestamp - a.timestamp);

        if (sortedOrders.length === 0) {
            ordersList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-clipboard-list empty-state-icon"></i>
                    <p>No hay pedidos ${statusFilter ? statusFilter : 'registrados'}</p>
                </div>
            `;
            return;
        }

        sortedOrders.forEach(order => {
            const client = ClientsModule.getClientById(order.clientId);
            const clientName = client ? client.name : 'Cliente no encontrado';
            
            const li = document.createElement('li');
            li.className = `order-item ${order.status}`;
            li.innerHTML = `
                <div class="order-info">
                    <h3>
                        ${clientName}
                        <span class="order-status ${order.status}">${this.getStatusText(order.status)}</span>
                    </h3>
                    <p class="order-details">
                        <i class="fas fa-weight"></i> ${order.weight.toFixed(2)} lb x 
                        <i class="fas fa-egg"></i> ${order.quantity} pollos
                    </p>
                    <p class="order-details">
                        <i class="fas fa-balance-scale"></i> ${order.averageWeight} lb/pollo x 
                        $${(order.price || 0).toFixed(2)}/lb
                    </p>
                    ${order.notes ? `<p class="order-details"><i class="fas fa-sticky-note"></i> ${Utils.escapeHtml(order.notes)}</p>` : ''}
                    ${order.deliveryDate ? 
                        `<p class="order-delivery"><i class="fas fa-calendar-alt"></i> Entrega: ${order.deliveryDate} ${order.deliveryTime || ''}</p>` : 
                        `<p class="order-details"><i class="fas fa-clock"></i> Creado: ${order.createdDate} ${order.createdTime}</p>`
                    }
                </div>
                <div class="order-actions">
                    ${order.status === 'pending' ? `
                        <button class="btn btn-success" onclick="OrdersModule.showDeliveryModal(${order.id})" style="padding: 5px 10px;">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn btn-danger" onclick="OrdersModule.cancelOrder(${order.id})" style="padding: 5px 10px;">
                            <i class="fas fa-times"></i>
                        </button>
                    ` : ''}
                    <button class="btn btn-outline" onclick="OrdersModule.showOrderDetails(${order.id})" style="padding: 5px 10px;">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
            `;
            ordersList.appendChild(li);
        });
    },

    getStatusText(status) {
        const statusMap = {
            'pending': 'Pendiente',
            'delivered': 'Entregado',
            'cancelled': 'Cancelado'
        };
        return statusMap[status] || status;
    },

    showDeliveryModal(orderId) {
        const order = this.orders.find(o => o.id === orderId);
        if (!order) return;

        const client = ClientsModule.getClientById(order.clientId);
        if (!client) return;

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-truck"></i> Confirmar Entrega</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="delivery-form">
                        <div class="form-group">
                            <label class="form-label" for="delivery-client-name">Cliente</label>
                            <input type="text" id="delivery-client-name" name="delivery-client-name" class="form-input" value="${Utils.escapeHtml(client.name)}" readonly>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="delivery-weight">Peso del Pedido (lb)</label>
                            <div style="display:flex; gap:8px; align-items:center;">
                                <input type="number" step="0.01" min="0.01" class="form-input" 
                                       id="delivery-weight" value="${order.weight}" required style="flex:1;">
                                <button type="button" class="btn btn-outline scale-capture-btn"
                                        onclick="BluetoothScale.captureWeight('delivery-weight')"
                                        style="display:none; padding:10px 12px;" title="Capturar peso de balanza">
                                    <i class="fas fa-weight"></i>
                                </button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="delivery-quantity">Cantidad de Pollos</label>
                            <input type="number" min="1" class="form-input" 
                                   id="delivery-quantity" value="${order.quantity}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="delivery-price">Precio por lb ($)</label>
                            <input type="number" step="0.01" min="0" class="form-input" 
                                   id="delivery-price" value="${order.price || ''}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="delivery-notes">Notas de entrega (opcional)</label>
                            <textarea class="form-input" id="delivery-notes" rows="2" 
                                      placeholder="Observaciones de la entrega..."></textarea>
                        </div>
                        <button type="submit" class="btn btn-success" style="width: 100%;">
                            <i class="fas fa-check"></i> Confirmar Entrega y Registrar Venta
                        </button>
                    </form>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Configurar el formulario
        const deliveryForm = modal.querySelector('#delivery-form');
        if (deliveryForm) {
            deliveryForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.processDelivery(orderId, modal);
            });
        }
    },

    processDelivery(orderId, modalElement) {
        const weight = parseFloat(modalElement.querySelector('#delivery-weight').value);
        const quantity = parseInt(modalElement.querySelector('#delivery-quantity').value);
        const price = parseFloat(modalElement.querySelector('#delivery-price').value);
        const notes = modalElement.querySelector('#delivery-notes').value;
        
        const order = this.orders.find(o => o.id === orderId);
        if (!order) return;
        
        // Registrar como venta
        const sale = SalesModule.addSale(order.clientId, weight, quantity, price);
        
        // Actualizar estadisticas del cliente
        ClientsModule.updateClientStats(order.clientId, weight, quantity, sale.total);
        
        // Marcar pedido como entregado
        order.status = 'delivered';
        order.deliveredDate = Utils.formatDate();
        order.deliveredTime = new Date().toLocaleTimeString('es-ES');
        order.actualWeight = weight;
        order.actualQuantity = quantity;
        order.actualPrice = price;
        order.actualTotal = sale.total;
        order.deliveryNotes = notes;
        
        // Notificar pedido entregado (sin bloquear si falla)
        if (typeof NotificationsModule !== 'undefined') {
            try {
                const client = ClientsModule.getClientById(order.clientId);
                const clientName = client ? client.name : 'Cliente';
                NotificationsModule.notifyOrderDelivered(clientName).catch(err => {
                    console.warn('No se pudo enviar notificacion:', err);
                });
            } catch (err) {
                console.warn('Error al notificar:', err);
            }
        }
        
        this.saveOrders();
        this.updateOrdersList();
        this.updateOrderBadges();
        
        // NUEVO: Actualizar mapa de rutas
        if (RutasModule.actualizarRutaPorCambioPedido) {
            RutasModule.actualizarRutaPorCambioPedido(orderId, 'delivered');
        }
        
        // Actualizar estadisticas y contabilidad
        StatsModule.updateStats(Utils.getTodayDate());
        AccountingModule.updateAccounting(Utils.getTodayDate());
        
        // Cerrar modal
        modalElement.remove();
        
        // Mostrar recibo
        App.showReceipt(sale.id);
        
        Utils.showNotification('Pedido entregado y venta registrada', 'success', 5000);
    },

    cancelOrder(orderId) {
        if (this.updateOrderStatus(orderId, 'cancelled')) {
            this.updateOrdersList();
            this.updateOrderBadges();
            
            // NUEVO: Actualizar mapa de rutas
            if (RutasModule.actualizarRutaPorCambioPedido) {
                RutasModule.actualizarRutaPorCambioPedido(orderId, 'cancelled');
            }
            
            Utils.showNotification('Pedido cancelado', 'warning', 5000);
        }
    },

    showOrderDetails(orderId) {
        const order = this.orders.find(o => o.id === orderId);
        if (!order) return;

        const client = ClientsModule.getClientById(order.clientId);
        if (!client) return;

        const details = `
            <div class="order-details-modal">
                <h3><i class="fas fa-clipboard-list"></i> Detalles del Pedido #${orderId}</h3>
                <p><strong>Cliente:</strong> ${Utils.escapeHtml(client.name)}</p>
                <p><strong>Telefono:</strong> ${Utils.escapeHtml(client.phone)}</p>
                <p><strong>Direccion:</strong> ${Utils.escapeHtml(client.address)}</p>
                <p><strong>Ubicacion:</strong> ${client.location || 'No especificada'}</p>
                <hr>
                <p><strong>Peso Total:</strong> ${order.weight.toFixed(2)} lb</p>
                <p><strong>Cantidad de Pollos:</strong> ${order.quantity}</p>
                <p><strong>Peso Promedio:</strong> ${order.averageWeight} lb/pollo</p>
                <p><strong>Precio por lb:</strong> $${(order.price || 0).toFixed(2)}</p>
                <p><strong>Total:</strong> $${order.total.toFixed(2)}</p>
                <p><strong>Estado:</strong> <span class="order-status ${order.status}">${this.getStatusText(order.status)}</span></p>
                <p><strong>Fecha de creacion:</strong> ${order.createdDate} ${order.createdTime}</p>
                ${order.deliveryDate ? `<p><strong>Fecha de entrega:</strong> ${order.deliveryDate} ${order.deliveryTime || ''}</p>` : ''}
                ${order.notes ? `<p><strong>Notas:</strong> ${Utils.escapeHtml(order.notes)}</p>` : ''}
                ${order.actualWeight ? `<p><strong>Peso real entregado:</strong> ${order.actualWeight.toFixed(2)} lb</p>` : ''}
                ${order.actualQuantity ? `<p><strong>Cantidad real entregada:</strong> ${order.actualQuantity} pollos</p>` : ''}
                ${order.deliveryNotes ? `<p><strong>Notas de entrega:</strong> ${order.deliveryNotes}</p>` : ''}
            </div>
        `;

        // Crear modal temporal
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-clipboard-list"></i> Detalles del Pedido</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    ${details}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    },

    updateOrderBadges() {
        const pendingOrders = this.getPendingOrders().length;
        
        // Actualizar badge en sidebar
        const sidebarBadge = document.getElementById('pending-orders-badge');
        if (sidebarBadge) {
            sidebarBadge.textContent = pendingOrders;
            sidebarBadge.style.display = pendingOrders > 0 ? 'inline-block' : 'none';
        }
        
        // Actualizar badge en mobile
        const mobileBadge = document.getElementById('mobile-pending-orders');
        if (mobileBadge) {
            mobileBadge.textContent = pendingOrders;
            mobileBadge.style.display = pendingOrders > 0 ? 'flex' : 'none';
        }
    },

    async saveOrders() {
        if (DB.db) {
            for (const order of this.orders) {
                await DB.set('orders', order);
            }
        } else {
            localStorage.setItem('polloOrders', JSON.stringify(this.orders));
        }
        this.updateOrderBadges();
    },

    async loadOrders() {
        if (DB.db) {
            this.orders = await DB.getAll('orders');
        } else {
            const saved = localStorage.getItem('polloOrders');
            if (saved) this.orders = JSON.parse(saved);
        }
        this.updateOrderBadges();
    }
};

// Modulo de Ventas
const SalesModule = {
    sales: [],

    async init() {
        await this.loadSales();
    },

    addSale(clientId, weight, quantity, price, customDate = null, isPaid = true, initialPayment = 0, customCostPerLb = null) {
        const saleDate = customDate || Utils.formatDate();
        const mermaRecord = MermaModule.getMermaRecordByDate(saleDate);
        
        const salePrice = parseFloat(price) || 0;
        const total = weight * salePrice;
        const averageWeight = Utils.calculateAverageWeight(weight, quantity);
        const saleTime = new Date().toLocaleTimeString('es-ES');
        
        // Calcular pago inicial y deuda
        const initialPaid = parseFloat(initialPayment) || 0;
        const paidAmount = isPaid ? total : initialPaid;
        const remainingDebt = isPaid ? 0 : (total - initialPaid);
        
        // Determinar costo: usar customCostPerLb si se proporciona, sino usar merma
        const costPerLb = customCostPerLb !== null ? parseFloat(customCostPerLb) : (mermaRecord ? mermaRecord.realCostPerLb : 0);
        const hasCustomCost = customCostPerLb !== null; // Marcar si tiene costo personalizado
        
        const sale = {
            id: Date.now(),
            clientId,
            weight: parseFloat(weight),
            quantity: parseInt(quantity),
            averageWeight: parseFloat(averageWeight.toFixed(2)),
            price: salePrice,
            costPerLb: costPerLb,
            profitPerLb: salePrice - costPerLb,
            hasCustomCost: hasCustomCost, // NUEVO: Indicador de costo personalizado
            total,
            isPaid,
            paidAmount,
            remainingDebt,
            paymentHistory: initialPaid > 0 ? [{ amount: initialPaid, date: saleDate, time: saleTime }] : (isPaid ? [{ amount: total, date: saleDate, time: saleTime }] : []),
            date: saleDate,
            time: saleTime,
            timestamp: new Date().getTime(),
            lastModified: Date.now(),
            dayKey: saleDate
        };

        this.sales.push(sale);
        this.saveSales();
        ClientsModule.updateClientStats(clientId, weight, quantity, total);
        
        // Notificar venta completada (sin bloquear si falla)
        if (typeof NotificationsModule !== 'undefined') {
            try {
                const client = ClientsModule.getClientById(clientId);
                const clientName = client ? client.name : 'Cliente';
                NotificationsModule.notifySaleCompleted(total, clientName).catch(err => {
                    console.warn('No se pudo enviar notificacion:', err);
                });
            } catch (err) {
                console.warn('Error al notificar:', err);
            }
        }
        
        return sale;
    },

    getSalesByDate(date) {
        // Normalizar formato de fecha para comparacion
        const targetDate = date.includes('/') ? this.convertDateFormat(date) : date;
        return this.sales.filter(sale => {
            // FILTRAR VENTAS ELIMINADAS
            if (sale.deleted) return false;
            
            const saleDate = sale.date.includes('/') ? this.convertDateFormat(sale.date) : sale.date;
            return saleDate === targetDate;
        });
    },

    // Convertir fecha de DD/MM/YYYY a YYYY-MM-DD
    convertDateFormat(date) {
        if (date.includes('-') && date.split('-')[0].length === 4) {
            return date; // Ya esta en formato correcto
        }
        const parts = date.split('/');
        if (parts.length === 3) {
            return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        return date;
    },

    getTodaySales() {
        return this.getSalesByDate(Utils.getTodayDate());
    },

    getSalesByDateRange(startDate, endDate) {
        const start = new Date(startDate).getTime();
        const end = new Date(endDate).getTime();
        
        return this.sales.filter(sale => {
            // FILTRAR VENTAS ELIMINADAS
            if (sale.deleted) return false;
            
            const saleDate = new Date(sale.date).getTime();
            return saleDate >= start && saleDate <= end;
        });
    },

    getTotalSalesByDate(date) {
        const sales = this.getSalesByDate(date);
        return sales.reduce((sum, sale) => sum + sale.total, 0);
    },

    getTotalWeightByDate(date) {
        const sales = this.getSalesByDate(date);
        return sales.reduce((sum, sale) => sum + sale.weight, 0);
    },

    getTotalQuantityByDate(date) {
        const sales = this.getSalesByDate(date);
        return sales.reduce((sum, sale) => sum + sale.quantity, 0);
    },

    getAverageWeightByDate(date) {
        const sales = this.getSalesByDate(date);
        if (sales.length === 0) return 0;
        
        const totalWeight = sales.reduce((sum, sale) => sum + sale.weight, 0);
        const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);
        
        if (totalQuantity === 0) return 0;
        return parseFloat((totalWeight / totalQuantity).toFixed(2));
    },

    updateSalesList(date = null) {
            const salesList = document.getElementById('sales-list');
            if (!salesList) return;

            salesList.innerHTML = '';

            const targetDate = date || Utils.getTodayDate();
            const targetSales = this.getSalesByDate(targetDate).reverse();

            if (targetSales.length === 0) {
                salesList.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-receipt empty-state-icon"></i>
                        <p>No hay ventas registradas para ${targetDate}</p>
                    </div>
                `;
                return;
            }

            targetSales.forEach(sale => {
                const client = ClientsModule.getClientById(sale.clientId);
                const clientName = client ? client.name : 'Cliente no encontrado';

                // Determinar si tiene costo directo basandose en hasCustomCost
                const hasCustomCost = sale.hasCustomCost === true;
                const costBadge = hasCustomCost ? 
                    '<span style="background: #007bff; color: white; padding: 3px 10px; border-radius: 12px; font-size: 0.8rem; margin-left: 8px; font-weight: 600;"><i class="fas fa-drumstick-bite"></i> Pelado (Costo Directo)</span>' : 
                    '<span style="background: #28a745; color: white; padding: 3px 10px; border-radius: 12px; font-size: 0.8rem; margin-left: 8px; font-weight: 600;"><i class="fas fa-feather"></i> Pluma (Con Merma)</span>';

                const li = document.createElement('li');
                li.className = 'sale-item';
                li.innerHTML = `
                    <div class="sale-info">
                        <h3><i class="fas fa-user"></i> ${clientName} ${costBadge}</h3>
                        <p class="sale-details">
                            <i class="fas fa-weight"></i> ${sale.weight.toFixed(2)} lb | 
                            <i class="fas fa-egg"></i> ${sale.quantity} pollos
                        </p>
                        <p class="sale-details">
                            <i class="fas fa-balance-scale"></i> ${sale.averageWeight} lb/pollo | 
                            ${sale.price.toFixed(2)}/lb
                        </p>
                        <p class="sale-details">
                            <i class="fas fa-dollar-sign"></i> Costo: ${Utils.formatCurrency(sale.costPerLb)}/lb | 
                            <i class="fas fa-chart-line"></i> Ganancia: ${Utils.formatCurrency(sale.profitPerLb)}/lb
                        </p>
                        <p class="sale-details"><i class="fas fa-clock"></i> ${sale.time}</p>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 5px; align-items: flex-end;">
                        <div class="sale-amount">${Utils.formatCurrency(sale.total)}</div>
                        <button class="btn btn-outline" style="padding: 5px 10px; font-size: 0.8rem;" 
                                onclick="App.showReceipt(${sale.id})">
                            <i class="fas fa-receipt"></i> Recibo
                        </button>
                        <button class="btn btn-outline" style="padding: 5px 10px; font-size: 0.8rem;" 
                                onclick="SalesModule.showEditModal(${sale.id})">
                            <i class="fas fa-edit"></i> Editar
                        </button>
                        <button class="btn btn-danger" style="padding: 5px 10px; font-size: 0.8rem;" 
                                onclick="SalesModule.showDeleteModal(${sale.id})"
                                ${!Perm.can('sales.delete') ? 'style="display:none"' : ''}>
                            <i class="fas fa-trash"></i> Eliminar
                        </button>
                    </div>
                `;
                salesList.appendChild(li);
            });
        },

    showEditModal(saleId) {
        const sale = this.getSaleById(saleId);
        if (!sale) return;

        const client = ClientsModule.getClientById(sale.clientId);
        if (!client) return;

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-edit"></i> Editar Venta</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="edit-sale-form">
                        <div class="form-group">
                            <label class="form-label" for="edit-sale-client">Cliente</label>
                            <select class="form-input" id="edit-sale-client" required>
                                ${ClientsModule.clients.map(c => 
                                    `<option value="${c.id}" ${c.id === sale.clientId ? 'selected' : ''}>${Utils.escapeHtml(c.name)} - ${Utils.escapeHtml(c.phone)}</option>`
                                ).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="edit-sale-weight">Peso Total (lb)</label>
                            <input type="number" step="0.01" min="0.01" class="form-input" 
                                   id="edit-sale-weight" value="${sale.weight}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="edit-sale-quantity">Cantidad de Pollos</label>
                            <input type="number" min="1" class="form-input" 
                                   id="edit-sale-quantity" value="${sale.quantity}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="edit-sale-price">Precio por lb ($)</label>
                            <input type="number" step="0.01" min="0" class="form-input" 
                                   id="edit-sale-price" value="${sale.price}" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">
                                Costo por lb ($)
                                <i class="fas fa-info-circle" style="color: var(--gray); cursor: help;" 
                                   title="Opcional: Para pollos pelados con costo diferente a la merma"></i>
                            </label>
                            <input type="number" step="0.01" min="0" class="form-input" 
                                   id="edit-sale-cost" value="${sale.costPerLb || ''}" 
                                   placeholder="Dejar vacio para usar costo de merma">
                            <small style="color: var(--gray); display: block; margin-top: 5px;">
                                <i class="fas fa-drumstick-bite"></i> Usa este campo solo para pollos pelados con costo directo
                            </small>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="edit-sale-payment">Tipo de Pago</label>
                            <select class="form-input" id="edit-sale-payment" required>
                                <option value="paid" ${sale.isPaid ? 'selected' : ''}>Efectivo (Pagado)</option>
                                <option value="credit" ${!sale.isPaid ? 'selected' : ''}>Credito (A deber)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="edit-sale-date">Fecha</label>
                            <input type="date" class="form-input" 
                                   id="edit-sale-date" value="${sale.date}" required>
                        </div>
                        <button type="submit" class="btn btn-success" style="width: 100%;">
                            <i class="fas fa-save"></i> Guardar Cambios
                        </button>
                    </form>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const form = modal.querySelector('#edit-sale-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const customCost = document.getElementById('edit-sale-cost').value ? 
                              parseFloat(document.getElementById('edit-sale-cost').value) : null;
            await this.updateSale(saleId, {
                clientId: parseInt(document.getElementById('edit-sale-client').value),
                weight: parseFloat(document.getElementById('edit-sale-weight').value),
                quantity: parseInt(document.getElementById('edit-sale-quantity').value),
                price: parseFloat(document.getElementById('edit-sale-price').value),
                date: document.getElementById('edit-sale-date').value,
                isPaid: document.getElementById('edit-sale-payment').value === 'paid',
                customCostPerLb: customCost
            });
            modal.remove();
        });
    },

    async updateSale(saleId, updates) {
        const sale = this.getSaleById(saleId);
        if (!sale) return false;

        const oldClientId = sale.clientId;
        const oldWeight = sale.weight;
        const oldQuantity = sale.quantity;
        const oldTotal = sale.total;
        const oldDate = sale.date;
        const oldIsPaid = sale.isPaid;

        sale.clientId = updates.clientId;
        sale.weight = updates.weight;
        sale.quantity = updates.quantity;
        sale.price = updates.price;
        sale.date = updates.date;
        sale.averageWeight = parseFloat((updates.weight / updates.quantity).toFixed(2));
        sale.total = updates.weight * updates.price;
        sale.isPaid = updates.isPaid;
        sale.paidAmount = updates.isPaid ? sale.total : 0;
        sale.remainingDebt = updates.isPaid ? 0 : sale.total;
        sale.lastModified = Date.now();

        // Determinar costo: usar customCostPerLb si se proporciona, sino usar merma
        const mermaRecord = MermaModule.getMermaRecordByDate(sale.date);
        if (updates.customCostPerLb !== null && updates.customCostPerLb !== undefined) {
            sale.costPerLb = updates.customCostPerLb;
            sale.profitPerLb = sale.price - updates.customCostPerLb;
            sale.hasCustomCost = true; // Marcar como costo personalizado
        } else if (mermaRecord) {
            sale.costPerLb = mermaRecord.realCostPerLb;
            sale.profitPerLb = sale.price - mermaRecord.realCostPerLb;
            sale.hasCustomCost = false; // Marcar como costo de merma
        } else {
            sale.costPerLb = 0;
            sale.profitPerLb = sale.price;
            sale.hasCustomCost = false;
        }

        if (oldClientId !== sale.clientId) {
            const oldClient = ClientsModule.getClientById(oldClientId);
            if (oldClient) {
                oldClient.totalSales -= 1;
                oldClient.totalAmount -= oldTotal;
                oldClient.totalWeight -= oldWeight;
                oldClient.totalQuantity -= oldQuantity;
            }
            ClientsModule.updateClientStats(sale.clientId, sale.weight, sale.quantity, sale.total);
        } else {
            const client = ClientsModule.getClientById(sale.clientId);
            if (client) {
                client.totalAmount = client.totalAmount - oldTotal + sale.total;
                client.totalWeight = client.totalWeight - oldWeight + sale.weight;
                client.totalQuantity = client.totalQuantity - oldQuantity + sale.quantity;
            }
        }

        await this.saveSales();
        await ClientsModule.saveClients();
        
        // CR?TICO: Notificar al sistema de sincronizacion sobre la actualizacion
        if (typeof SyncEngine !== 'undefined' && SyncEngine.notifyChange) {
            await SyncEngine.notifyChange('sales', saleId, 'update');
            // Si cambio de cliente, notificar tambien los clientes
            if (oldClientId !== sale.clientId) {
                await SyncEngine.notifyChange('clients', oldClientId, 'update');
                await SyncEngine.notifyChange('clients', sale.clientId, 'update');
            }
        }
        
        // Actualizar contabilidad de ambas fechas si cambio la fecha
        if (typeof AccountingModule !== 'undefined') {
            AccountingModule.updateAccounting(oldDate);
            if (oldDate !== sale.date) {
                AccountingModule.updateAccounting(sale.date);
            }
        }
        
        // Actualizar badges de creditos si cambio el estado de pago
        if (oldIsPaid !== sale.isPaid && typeof CreditosModule !== 'undefined') {
            CreditosModule.updateCreditBadges();
        }
        
        this.updateSalesList(sale.date);
        Utils.showNotification('Venta actualizada correctamente', 'success', 3000);
        return true;
    },

    getSaleById(id) {
        return this.sales.find(sale => sale.id === id);
    },

    showDeleteModal(saleId) {
        const sale = this.getSaleById(saleId);
        if (!sale) return;

        const client = ClientsModule.getClientById(sale.clientId);
        const clientName = client ? client.name : 'Cliente no encontrado';

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-exclamation-triangle" style="color: #ff6b6b;"></i> Confirmar Eliminacion</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <p><strong>Estas seguro de que deseas eliminar esta venta?</strong></p>
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
                            <p><strong>Cliente:</strong> ${clientName}</p>
                            <p><strong>Peso:</strong> ${sale.weight.toFixed(2)} lb</p>
                            <p><strong>Cantidad:</strong> ${sale.quantity} pollos</p>
                            <p><strong>Total:</strong> ${Utils.formatCurrency(sale.total)}</p>
                            <p><strong>Fecha:</strong> ${sale.date}</p>
                            <p><strong>Estado:</strong> ${sale.isPaid ? 'Pagado' : 'Credito'}</p>
                        </div>
                        <p style="color: #ff6b6b; font-size: 0.9rem;">
                            <i class="fas fa-warning"></i> Esta accion no se puede deshacer y se sincronizara en todos los dispositivos.
                        </p>
                    </div>
                    <div style="display: flex; gap: 10px; justify-content: center;">
                        <button class="btn btn-outline" onclick="this.closest('.modal').remove()">
                            <i class="fas fa-times"></i> Cancelar
                        </button>
                        <button class="btn btn-danger" onclick="SalesModule.deleteSale(${saleId}); this.closest('.modal').remove();">
                            <i class="fas fa-trash"></i> Eliminar Venta
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    },

    async deleteSale(saleId) {
        const sale = this.getSaleById(saleId);
        if (!sale) {
            Utils.showNotification('Venta no encontrada', 'error', 3000);
            return false;
        }

        try {
            console.log('🗑️ Eliminando venta:', saleId);

            // 1. Marcar como eliminada en memoria
            sale.deleted = true;
            sale.deletedAt = Date.now();
            sale.lastModified = Date.now();

            // 2. Actualizar estadísticas del cliente
            const client = ClientsModule.getClientById(sale.clientId);
            if (client) {
                client.totalSales = Math.max(0, (client.totalSales || 0) - 1);
                client.totalAmount = Math.max(0, (client.totalAmount || 0) - sale.total);
                client.totalWeight = Math.max(0, (client.totalWeight || 0) - sale.weight);
                client.totalQuantity = Math.max(0, (client.totalQuantity || 0) - sale.quantity);
                await ClientsModule.saveClients();
            }

            // 3. Guardar en IndexedDB (con deleted:true, para que el merge local lo detecte)
            await this.saveSales();

            // 4. CRÍTICO: Notificar al servidor con action='delete'
            //    Esto hace que D1 ponga deleted=1, y /api/sync/full nunca lo devuelve de vuelta.
            //    Sin este paso, el servidor devuelve la venta en el próximo sync y "resurge".
            this.addPendingDeletion(saleId); // guardar en localStorage como fallback offline
            if (typeof window.SyncEngine !== 'undefined' &&
                window.SyncEngine &&
                typeof window.SyncEngine.notifyChange === 'function') {
                try {
                    await window.SyncEngine.notifyChange('sales', String(saleId), 'delete');
                    // Limpiar la cola offline si el envío fue exitoso
                    const pending = JSON.parse(localStorage.getItem('pendingSalesDeletions') || '[]');
                    const filtered = pending.filter(id => String(id) !== String(saleId));
                    localStorage.setItem('pendingSalesDeletions', JSON.stringify(filtered));
                    console.log('✅ Eliminación confirmada en servidor:', saleId);
                } catch (syncErr) {
                    console.warn('⚠️ Eliminación en cola para siguiente sync:', saleId, syncErr.message);
                    // La función addPendingDeletion ya lo guardó — se enviará en syncPendingDeletions()
                }
            }

            // 5. Actualizar contabilidad y badges
            if (typeof AccountingModule !== 'undefined') {
                AccountingModule.updateAccounting(sale.date);
            }
            if (!sale.isPaid && typeof CreditosModule !== 'undefined') {
                CreditosModule.updateCreditBadges();
            }
            this.updateSalesList(sale.date);

            console.log('✅ Venta eliminada correctamente');
            Utils.showNotification('Venta eliminada correctamente', 'success', 3000);
            return true;

        } catch (error) {
            console.error('❌ Error al eliminar venta:', error);
            Utils.showNotification('Error al eliminar la venta', 'error', 3000);
            return false;
        }
    },

    markAsCredit(saleId) {
        const sale = this.getSaleById(saleId);
        if (sale) {
            sale.isPaid = false;
            sale.paidAmount = 0;
            sale.remainingDebt = sale.total;
            sale.paymentHistory = [];
            this.saveSales();
            return true;
        }
        return false;
    },

    async registerPayment(saleId, amount, date = null, silent = false) {
        const sale = this.getSaleById(saleId);
        if (!sale) return false;

        const paymentDate = date || Utils.formatDate();
        const paymentTime = new Date().toLocaleTimeString('es-ES');
        const paymentAmount = parseFloat(amount);

        // Redondear a 2 decimales para evitar problemas de precision
        const roundedAmount = Math.round(paymentAmount * 100) / 100;
        const roundedDebt = Math.round(sale.remainingDebt * 100) / 100;

        if (roundedAmount <= 0 || roundedAmount > roundedDebt + 0.01) return false;

        sale.paidAmount += paymentAmount;
        sale.remainingDebt -= paymentAmount;
        
        // CR?TICO: Actualizar timestamp de ultima modificacion para sincronizacion
        sale.lastModified = Date.now();
        
        if (!sale.paymentHistory) sale.paymentHistory = [];
        sale.paymentHistory.push({
            amount: paymentAmount,
            date: paymentDate,
            time: paymentTime,
            timestamp: Date.now()
        });

        // YA NO registrar en PaymentHistoryModule - se construye dinamicamente desde sale.paymentHistory

        if (sale.remainingDebt <= 0.01) {
            sale.isPaid = true;
            sale.remainingDebt = 0;
            
            // Notificar pago recibido SOLO si no es silencioso (sin bloquear si falla)
            if (!silent && typeof NotificationsModule !== 'undefined') {
                try {
                    const client = ClientsModule.getClientById(sale.clientId);
                    const clientName = client ? client.name : 'Cliente';
                    NotificationsModule.notifyPaymentReceived(paymentAmount, clientName).catch(err => {
                        console.warn('No se pudo enviar notificacion de pago:', err);
                    });
                } catch (err) {
                    console.warn('Error al intentar notificar pago:', err);
                }
            }
        }

        await this.saveSales();
        
        // CR?TICO: Notificar al sistema de sincronizacion si no es silencioso
        if (!silent && typeof SyncEngine !== 'undefined' && SyncEngine.notifyChange) {
            await SyncEngine.notifyChange('sales', sale.id, 'update');
        }
        
        return true;
    },

    getCreditSales() {
        return this.sales.filter(sale => !sale.deleted && !sale.isPaid && (sale.remainingDebt || 0) > 0);
    },

    getCreditsByClient(clientId) {
        return this.sales.filter(sale => 
            !sale.deleted &&
            sale.clientId === clientId && 
            !sale.isPaid && 
            (sale.remainingDebt || 0) > 0
        );
    },

    getClientTotalDebt(clientId) {
        return this.getCreditsByClient(clientId)
            .reduce((sum, sale) => sum + (sale.remainingDebt || 0), 0);
    },

    async saveSales() {
        if (DB.db) {
            // Guardar/actualizar todas las ventas (incluyendo las marcadas como deleted)
            for (const sale of this.sales) {
                await DB.set('sales', sale);
            }
        } else {
            localStorage.setItem('polloSales', JSON.stringify(this.sales));
        }
    },

    async loadSales() {
        if (DB.db) {
            this.sales = await DB.getAll('sales');
        } else {
            const saved = localStorage.getItem('polloSales');
            if (saved) {
                this.sales = JSON.parse(saved);
            }
        }
        // FILTRAR VENTAS ELIMINADAS y normalizar datos
        this.sales = this.sales
            .filter(sale => !sale.deleted) // NO cargar ventas eliminadas
            .map(sale => ({
                ...sale,
                isPaid: sale.isPaid !== undefined ? sale.isPaid : true,
                paidAmount: sale.paidAmount !== undefined ? sale.paidAmount : sale.total,
                remainingDebt: sale.remainingDebt !== undefined ? sale.remainingDebt : 0,
                paymentHistory: sale.paymentHistory || []
            }));
    },

    // Funcion para agregar eliminaciones pendientes
    addPendingDeletion(saleId) {
        const pendingDeletions = JSON.parse(localStorage.getItem('pendingSalesDeletions') || '[]');
        if (!pendingDeletions.includes(saleId)) {
            pendingDeletions.push(saleId);
            localStorage.setItem('pendingSalesDeletions', JSON.stringify(pendingDeletions));
            console.log(`🗑️ Eliminacion pendiente guardada: ${saleId}`);
        }
    },

    // Funcion para sincronizar eliminaciones pendientes cuando SyncEngine este disponible
    async syncPendingDeletions() {
        if (typeof window.SyncEngine !== 'undefined' && 
            window.SyncEngine && 
            typeof window.SyncEngine.notifyChange === 'function') {
            
            // Verificar si hay eliminaciones pendientes en localStorage
            const pendingDeletions = JSON.parse(localStorage.getItem('pendingSalesDeletions') || '[]');
            
            if (pendingDeletions.length > 0) {
                console.log(`🔁 Sincronizando ${pendingDeletions.length} eliminaciones pendientes...`);
                
                for (const saleId of pendingDeletions) {
                    try {
                        await window.SyncEngine.notifyChange('sales', saleId, 'delete');
                        console.log(`✅ Eliminacion sincronizada: ${saleId}`);
                    } catch (error) {
                        console.error(`❌ Error sincronizando eliminacion ${saleId}:`, error);
                    }
                }
                
                // Limpiar eliminaciones pendientes
                localStorage.removeItem('pendingSalesDeletions');
                console.log('✅ Todas las eliminaciones pendientes sincronizadas');
            }
        }
    }
};

// Modulo de Merma
const MermaModule = {
    dailyPrices: [],
    mermaRecords: [], // NUEVO: Historial completo de calculos de merma

    async init() {
        await this.loadDailyPrices();
        await this.loadMermaRecords();
    },

    calculateMerma(liveWeight, liveCost, processedWeight, processingCost, realCostPerLb = null) {
        // null = campo vacio (a deducir), 0 = ingresado explicitamente como cero
        const hasLiveWeight = liveWeight != null && liveWeight > 0;
        const hasLiveCost = liveCost != null && liveCost > 0;
        const hasProcessedWeight = processedWeight != null && processedWeight > 0;
        const hasProcessingCost = processingCost != null; // null = vacio, 0 = valido
        const hasRealCost = realCostPerLb != null && realCostPerLb > 0;
        
        const missingCount = [hasLiveWeight, hasLiveCost, hasProcessedWeight, hasProcessingCost, hasRealCost].filter(v => !v).length;
        
        if (missingCount > 1) {
            throw new Error('Debes llenar al menos 4 de los 5 campos');
        }
        
        let finalLiveWeight = liveWeight;
        let finalLiveCost = liveCost;
        let finalProcessedWeight = processedWeight;
        let finalProcessingCost = processingCost;
        let finalRealCost = realCostPerLb;
        let deducedValue = null;
        
        // Calcular el valor faltante
        if (!hasLiveWeight) {
            finalLiveWeight = (finalRealCost * finalProcessedWeight - finalProcessingCost) / finalLiveCost;
            if (finalLiveWeight <= 0) throw new Error('Peso vivo calculado invalido');
            deducedValue = 'liveWeight';
        } else if (!hasLiveCost) {
            finalLiveCost = (finalRealCost * finalProcessedWeight - finalProcessingCost) / finalLiveWeight;
            if (finalLiveCost <= 0) throw new Error('Costo por lb vivo calculado invalido');
            deducedValue = 'liveCost';
        } else if (!hasProcessedWeight) {
            finalProcessedWeight = (finalLiveWeight * finalLiveCost + finalProcessingCost) / finalRealCost;
            if (finalProcessedWeight <= 0) throw new Error('Peso pelado calculado invalido');
            deducedValue = 'processedWeight';
        } else if (!hasProcessingCost) {
            finalProcessingCost = finalRealCost * finalProcessedWeight - finalLiveWeight * finalLiveCost;
            deducedValue = 'processingCost';
        } else if (!hasRealCost) {
            finalRealCost = (finalLiveWeight * finalLiveCost + finalProcessingCost) / finalProcessedWeight;
            if (finalRealCost <= 0) throw new Error('Costo real calculado invalido');
            deducedValue = 'realCostPerLb';
        }
        
        // Calcular resultados finales
        const totalCost = (finalLiveWeight * finalLiveCost) + finalProcessingCost;
        const merma = ((finalLiveWeight - finalProcessedWeight) / finalLiveWeight) * 100;
        const lossAmount = (finalLiveWeight - finalProcessedWeight) * finalLiveCost;
        
        return {
            merma: parseFloat(merma.toFixed(2)),
            realCostPerLb: parseFloat(finalRealCost.toFixed(2)),
            lossAmount: parseFloat(lossAmount.toFixed(2)),
            totalCost: parseFloat(totalCost.toFixed(2)),
            liveWeight: parseFloat(finalLiveWeight.toFixed(2)),
            liveCost: parseFloat(finalLiveCost.toFixed(2)),
            processedWeight: parseFloat(finalProcessedWeight.toFixed(2)),
            processingCost: parseFloat(finalProcessingCost.toFixed(2)),
            deducedValue: deducedValue
        };
    },

    // NUEVO: Guardar registro completo de merma
    async saveMermaRecord(mermaData, date = Utils.getTodayDate()) {
        const existingIndex = this.mermaRecords.findIndex(r => r.date === date);
        
        const record = {
            id: existingIndex > -1 ? this.mermaRecords[existingIndex].id : Date.now(),
            date,
            ...mermaData,
            timestamp: new Date().getTime()
        };

        if (existingIndex > -1) {
            this.mermaRecords[existingIndex] = record;
        } else {
            this.mermaRecords.push(record);
        }

        await this.saveMermaRecords();
        
        // Guardar tambien el precio
        await this.saveDailyPrice(mermaData.realCostPerLb, date);
        
        // CRITICO: Notificar al sistema de sincronizacion
        if (typeof SyncEngine !== 'undefined' && SyncEngine.notifyChange) {
            await SyncEngine.notifyChange('mermaRecords', record.id, 'update');
        }
        
        // Recalcular todas las ventas de ese dia
        await this.recalcularVentasPorFecha(date);
        
        return record;
    },

    // Recalcular costos y ganancias cuando cambia la merma
    async recalcularVentasPorFecha(date) {
        const ventasDelDia = SalesModule.getSalesByDate(date);
        const mermaRecord = this.getMermaRecordByDate(date);
        
        if (!mermaRecord || ventasDelDia.length === 0) return 0;

        let ventasActualizadas = 0;
        
        for (const venta of ventasDelDia) {
            // SOLO actualizar ventas que NO tienen costo directo personalizado
            // Las ventas con costo directo (pollos pelados) NO se deben recalcular
            if (!venta.hasCustomCost) {
                // Actualizar costo y ganancia por libra
                venta.costPerLb = mermaRecord.realCostPerLb;
                venta.profitPerLb = venta.price - mermaRecord.realCostPerLb;
                ventasActualizadas++;
            }
        }

        if (ventasActualizadas > 0) {
            await SalesModule.saveSales();
            
            // Recalcular contabilidad
            if (typeof AccountingModule !== 'undefined') {
                AccountingModule.updateAccounting(date);
            }
            
            // Recalcular estadisticas
            if (typeof StatsModule !== 'undefined') {
                StatsModule.updateStats(date);
            }
            
            // Actualizar UI
            if (typeof App !== 'undefined' && App.currentPage === 'accounting') {
                AccountingModule.updateAccounting(date);
            }
        }

        return ventasActualizadas;
    },

    // NUEVO: Obtener registro de merma por fecha
    getMermaRecordByDate(date) {
        return this.mermaRecords.find(r => r.date === date);
    },

    async saveDailyPrice(price, date = Utils.getTodayDate(), salePrice = null) {
        const existingIndex = this.dailyPrices.findIndex(p => p.date === date);
        
        const existing = existingIndex > -1 ? this.dailyPrices[existingIndex] : null;
        const priceRecord = {
            id: existing ? existing.id : Date.now(),
            date,
            price,
            salePrice: salePrice !== null ? salePrice : (existing ? existing.salePrice : null),
            timestamp: new Date().getTime()
        };
        
        if (existingIndex > -1) {
            this.dailyPrices[existingIndex] = priceRecord;
        } else {
            this.dailyPrices.push(priceRecord);
        }
        
        await this.saveDailyPrices();
        
        // CR?TICO: Notificar al sistema de sincronizacion
        if (typeof SyncEngine !== 'undefined' && SyncEngine.notifyChange) {
            await SyncEngine.notifyChange('prices', priceRecord.id, 'update');
        }
        
        return price;
    },

    getTodayMermaPrice() {
        const today = Utils.getTodayDate();
        const todayPrice = this.dailyPrices.find(p => p.date === today);
        return todayPrice ? todayPrice.price : null;
    },

    getTodaySalePrice() {
        const today = Utils.getTodayDate();
        const todayPrice = this.dailyPrices.find(p => p.date === today);
        return todayPrice ? todayPrice.salePrice : null;
    },

    getMermaPriceByDate(date) {
        return this.dailyPrices.find(p => p.date === date);
    },

    async saveDailyPrices() {
        if (DB.db) {
            for (const price of this.dailyPrices) {
                await DB.set('prices', price);
            }
        } else {
            localStorage.setItem('polloDailyPrices', JSON.stringify(this.dailyPrices));
        }
    },

    async loadDailyPrices() {
        if (DB.db) {
            this.dailyPrices = await DB.getAll('prices');
        } else {
            const saved = localStorage.getItem('polloDailyPrices');
            if (saved) {
                this.dailyPrices = JSON.parse(saved);
            }
        }
    },

    // NUEVO: Guardar/cargar registros de merma
    async saveMermaRecords() {
        if (DB.db) {
            // Guardar cada registro individualmente en el store mermaRecords (keyPath: 'date')
            for (const record of this.mermaRecords) {
                await DB.set('mermaRecords', record);
            }
        } else {
            localStorage.setItem('polloMermaRecords', JSON.stringify(this.mermaRecords));
        }
    },

    async loadMermaRecords() {
        if (DB.db) {
            const records = await DB.getAll('mermaRecords');
            if (records && records.length > 0) {
                this.mermaRecords = records;
            } else {
                // Migrar desde config si existe
                const saved = await DB.get('config', 'merma-records');
                if (saved && saved.value && saved.value.length > 0) {
                    this.mermaRecords = saved.value;
                    // Migrar al store correcto
                    for (const record of this.mermaRecords) {
                        await DB.set('mermaRecords', record);
                    }
                    console.log('Merma migrada de config a mermaRecords store');
                }
            }
        } else {
            const saved = localStorage.getItem('polloMermaRecords');
            if (saved) {
                this.mermaRecords = JSON.parse(saved);
            }
        }
    }
};

// Modulo de Estadisticas
const StatsModule = {
    updateStats(date = null) {
        const targetDate = date || Utils.getTodayDate();
        const sales = SalesModule.getSalesByDate(targetDate);
        const orders = OrdersModule.getTodayOrders();
        const mermaPrice = MermaModule.getMermaPriceByDate(targetDate);
        
        // Separar ventas por tipo
        const salesWithMerma = sales.filter(sale => !sale.hasCustomCost);
        const salesWithCustomCost = sales.filter(sale => sale.hasCustomCost);
        
        // Actualizar estadisticas del dia - SOLO si los elementos existen
        const salesTodayElement = document.getElementById('sales-today');
        const incomeTodayElement = document.getElementById('income-today');
        const weightTodayElement = document.getElementById('weight-today');
        const averageWeightElement = document.getElementById('average-weight-today');
        const activeClientsElement = document.getElementById('active-clients');
        const totalQuantityElement = document.getElementById('total-quantity-today');
        const mermaPriceElement = document.getElementById('merma-price-today');
        
        // Solo actualizar si el elemento existe
        if (salesTodayElement) {
            salesTodayElement.textContent = sales.length;
        }
        
        const todayIncome = sales.reduce((sum, sale) => sum + sale.total, 0);
        if (incomeTodayElement) {
            incomeTodayElement.textContent = Utils.formatCurrency(todayIncome);
        }
        
        const todayWeight = sales.reduce((sum, sale) => sum + sale.weight, 0);
        if (weightTodayElement) {
            weightTodayElement.textContent = todayWeight.toFixed(2) + ' lb';
        }
        
        // Peso promedio de pollos
        const averageWeight = SalesModule.getAverageWeightByDate(targetDate);
        if (averageWeightElement) {
            averageWeightElement.textContent = averageWeight.toFixed(2) + ' lb/pollo';
        }
        
        // Clientes activos hoy
        const todayClients = [...new Set(sales.map(sale => sale.clientId))];
        if (activeClientsElement) {
            activeClientsElement.textContent = todayClients.length;
        }
        
        // Cantidad total de pollos vendidos
        const totalQuantity = SalesModule.getTotalQuantityByDate(targetDate);
        if (totalQuantityElement) {
            totalQuantityElement.textContent = totalQuantity;
        }
        
        // Precio de merma del dia
        if (mermaPriceElement) {
            mermaPriceElement.textContent = mermaPrice ? 
                Utils.formatCurrency(mermaPrice.price) + '/lb' : 'No definido';
        }
        
        // Desglose por tipo de pollo
        const chickenTypeBreakdownElement = document.getElementById('chicken-type-breakdown');
        if (chickenTypeBreakdownElement) {
            const mermaWeight = salesWithMerma.reduce((sum, sale) => sum + sale.weight, 0);
            const mermaQuantity = salesWithMerma.reduce((sum, sale) => sum + sale.quantity, 0);
            const mermaIncome = salesWithMerma.reduce((sum, sale) => sum + sale.total, 0);
            
            const customWeight = salesWithCustomCost.reduce((sum, sale) => sum + sale.weight, 0);
            const customQuantity = salesWithCustomCost.reduce((sum, sale) => sum + sale.quantity, 0);
            const customIncome = salesWithCustomCost.reduce((sum, sale) => sum + sale.total, 0);
            
            let breakdownHTML = `
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px;">
                    <div style="padding: 20px; background: linear-gradient(135deg, #28a745 0%, #20c997 100%); border-radius: 12px; color: white; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <div style="display: flex; align-items: center; margin-bottom: 15px;">
                            <i class="fas fa-feather" style="font-size: 2rem; margin-right: 15px;"></i>
                            <div>
                                <h4 style="margin: 0; font-size: 1.2rem;">Pollos en Pluma</h4>
                                <p style="margin: 5px 0 0; opacity: 0.95; font-size: 0.9rem;">Con calculo de merma</p>
                            </div>
                        </div>
                        <div style="background: rgba(255,255,255,0.25); padding: 15px; border-radius: 8px;">
                            <p style="margin: 8px 0; font-size: 1.1rem;"><strong>Ventas:</strong> ${salesWithMerma.length}</p>
                            <p style="margin: 8px 0; font-size: 1.1rem;"><strong>Pollos:</strong> ${mermaQuantity}</p>
                            <p style="margin: 8px 0; font-size: 1.3rem;"><strong>Libras:</strong> ${mermaWeight.toFixed(2)} lb</p>
                            <p style="margin: 8px 0; font-size: 1.1rem;"><strong>Ingresos:</strong> ${Utils.formatCurrency(mermaIncome)}</p>
                        </div>
                    </div>
                    
                    <div style="padding: 20px; background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); border-radius: 12px; color: white; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <div style="display: flex; align-items: center; margin-bottom: 15px;">
                            <i class="fas fa-drumstick-bite" style="font-size: 2rem; margin-right: 15px;"></i>
                            <div>
                                <h4 style="margin: 0; font-size: 1.2rem;">Pollos Pelados</h4>
                                <p style="margin: 5px 0 0; opacity: 0.95; font-size: 0.9rem;">Con costo directo</p>
                            </div>
                        </div>
                        <div style="background: rgba(255,255,255,0.25); padding: 15px; border-radius: 8px;">
                            <p style="margin: 8px 0; font-size: 1.1rem;"><strong>Ventas:</strong> ${salesWithCustomCost.length}</p>
                            <p style="margin: 8px 0; font-size: 1.1rem;"><strong>Pollos:</strong> ${customQuantity}</p>
                            <p style="margin: 8px 0; font-size: 1.3rem;"><strong>Libras:</strong> ${customWeight.toFixed(2)} lb</p>
                            <p style="margin: 8px 0; font-size: 1.1rem;"><strong>Ingresos:</strong> ${Utils.formatCurrency(customIncome)}</p>
                        </div>
                    </div>
                </div>
            `;
            
            if (sales.length === 0) {
                breakdownHTML = '<p style="text-align: center; color: var(--gray); padding: 20px;"><i class="fas fa-info-circle"></i> No hay ventas registradas en esta fecha</p>';
            }
            
            chickenTypeBreakdownElement.innerHTML = breakdownHTML;
        }
        
        // Actualizar estadisticas por cliente
        this.updateClientStats(sales);
    },

    updateClientStats(sales) {
        const clientStats = document.getElementById('client-stats');
        if (!clientStats) return;

        clientStats.innerHTML = '';

        // Agrupar ventas por cliente
        const clientSales = {};
        sales.forEach(sale => {
            if (!clientSales[sale.clientId]) {
                clientSales[sale.clientId] = {
                    sales: 0,
                    total: 0,
                    weight: 0,
                    quantity: 0
                };
            }
            clientSales[sale.clientId].sales += 1;
            clientSales[sale.clientId].total += sale.total;
            clientSales[sale.clientId].weight += sale.weight;
            clientSales[sale.clientId].quantity += sale.quantity;
        });

        if (Object.keys(clientSales).length === 0) {
            clientStats.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-chart-bar empty-state-icon"></i>
                    <p>No hay datos de ventas por cliente</p>
                </div>
            `;
            return;
        }

        // Convertir a array y ordenar por total
        const sortedClients = Object.entries(clientSales)
            .map(([clientId, data]) => {
                const client = ClientsModule.getClientById(parseInt(clientId));
                return {
                    client,
                    ...data,
                    averageWeight: Utils.calculateAverageWeight(data.weight, data.quantity)
                };
            })
            .filter(item => item.client)
            .sort((a, b) => b.total - a.total);

        sortedClients.forEach(item => {
            const li = document.createElement('li');
            li.className = 'client-item';
            li.innerHTML = `
                <div class="client-info">
                    <h3><i class="fas fa-user"></i> ${Utils.escapeHtml(item.client.name)}</h3>
                    <p class="client-location">
                        <i class="fas fa-shopping-cart"></i> ${item.sales} ventas | 
                        <i class="fas fa-egg"></i> ${item.quantity} pollos
                    </p>
                    <p class="client-location">
                        <i class="fas fa-weight"></i> ${item.weight.toFixed(2)} lb | 
                        <i class="fas fa-balance-scale"></i> ${item.averageWeight.toFixed(2)} lb/pollo
                    </p>
                </div>
                <div class="sale-amount">${Utils.formatCurrency(item.total)}</div>
            `;
            clientStats.appendChild(li);
        });
    },

    getWeeklyStats() {
        const { start, end } = Utils.getDateRange(7);
        const sales = SalesModule.getSalesByDateRange(start, end);
        
        const statsByDay = {};
        const currentDate = new Date(start);
        const endDate = new Date(end);
        
        // Inicializar todos los dias
        while (currentDate <= endDate) {
            const dateKey = Utils.formatDate(currentDate);
            statsByDay[dateKey] = {
                sales: 0,
                income: 0,
                weight: 0,
                quantity: 0,
                clients: new Set()
            };
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        // Agregar datos
        sales.forEach(sale => {
            if (statsByDay[sale.date]) {
                statsByDay[sale.date].sales += 1;
                statsByDay[sale.date].income += sale.total;
                statsByDay[sale.date].weight += sale.weight;
                statsByDay[sale.date].quantity += sale.quantity;
                statsByDay[sale.date].clients.add(sale.clientId);
            }
        });
        
        // Convertir a array y calcular promedios
        return Object.entries(statsByDay).map(([date, data]) => ({
            date,
            sales: data.sales,
            income: data.income,
            weight: data.weight,
            quantity: data.quantity,
            averageWeight: data.quantity > 0 ? parseFloat((data.weight / data.quantity).toFixed(2)) : 0,
            clients: data.clients.size
        }));
    }
};


// Modulo de Contabilidad
const AccountingModule = {
    expenses: [],

    async init() {
        this.loadExpenses();
    },

    addExpense(description, amount, category, customDate = null) {
        const expense = {
            id: Date.now(),
            description,
            amount: parseFloat(amount),
            category,
            date: customDate || Utils.formatDate(),
            time: new Date().toLocaleTimeString('es-ES'),
            timestamp: new Date().getTime()
        };

        this.expenses.push(expense);
        this.saveExpenses();
        return expense;
    },

    editExpense(expenseId, updates) {
        const expense = this.expenses.find(e => e.id === expenseId);
        if (!expense) return false;

        expense.description = updates.description;
        expense.amount = parseFloat(updates.amount);
        expense.category = updates.category;
        expense.date = updates.date;
        
        this.saveExpenses();
        return true;
    },

    async deleteExpense(expenseId) {
        const expense = this.getExpenseById(expenseId);
        if (expense) {
            expense.deleted = true;
            expense.deletedAt = Date.now();
            expense.lastModified = Date.now();
        }
        this.expenses = this.expenses.filter(e => e.id !== expenseId);
        await this.saveExpenses();

        if (typeof window.SyncEngine !== 'undefined' &&
            window.SyncEngine &&
            typeof window.SyncEngine.notifyChange === 'function') {
            try {
                await window.SyncEngine.notifyChange('expenses', String(expenseId), 'delete');
                console.log('✅ Eliminación de gasto confirmada en servidor:', expenseId);
            } catch (syncErr) {
                console.warn('⚠️ Eliminación de gasto en cola offline:', expenseId, syncErr.message);
            }
        }
        if (typeof AccountingModule !== 'undefined') {
            AccountingModule.updateAccounting();
        }
        return true;
    },

    getExpenseById(id) {
        return this.expenses.find(expense => expense.id === id);
    },

    updateAccounting(date = null) {
        const targetDate = date || Utils.getTodayDate();
        const sales = SalesModule.getSalesByDate(targetDate);
        const expenses = this.getExpensesByDate(targetDate);
        
        const totalIncome = sales.reduce((sum, sale) => sum + sale.total, 0);
        const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
        
        // Separar ventas por tipo usando hasCustomCost
        const salesPluma = sales.filter(sale => !sale.hasCustomCost);
        const salesPelado = sales.filter(sale => sale.hasCustomCost === true);

        // Obtener merma del dia
        const mermaRecord = MermaModule.getMermaRecordByDate(targetDate);

        // Calcular grossProfit para netProfit
        let grossProfit = 0;
        sales.forEach(sale => {
            const costPerLb = sale.hasCustomCost
                ? (sale.costPerLb || 0)
                : (mermaRecord ? mermaRecord.realCostPerLb : (sale.costPerLb || 0));
            grossProfit += (sale.price - costPerLb) * sale.weight;
        });

        // Ganancia neta = Ganancia bruta - Gastos
        const netProfit = grossProfit - totalExpenses;
        const netMargin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

        // === NUEVO UI: llenar #accounting-summary ===
        const summaryEl = document.getElementById('accounting-summary');
        if (!summaryEl) return;

        if (sales.length === 0) {
            summaryEl.innerHTML = `
                <div class="card" style="text-align:center; color:var(--gray); padding:30px;">
                    <i class="fas fa-chart-line" style="font-size:2.5rem; margin-bottom:10px; display:block;"></i>
                    No hay ventas registradas para esta fecha
                </div>`;
            return;
        }

        const plumaWeight  = salesPluma.reduce((sum, s) => sum + s.weight, 0);
        const plumaQty     = salesPluma.reduce((sum, s) => sum + s.quantity, 0);
        const plumaIncome  = salesPluma.reduce((sum, s) => sum + s.total, 0);
        const plumaCostPerLb = mermaRecord ? mermaRecord.realCostPerLb : 0;
        const plumaProfit  = salesPluma.reduce((sum, s) => sum + ((s.price - plumaCostPerLb) * s.weight), 0);
        const plumaCost    = plumaWeight * plumaCostPerLb;

        const peladoWeight = salesPelado.reduce((sum, s) => sum + s.weight, 0);
        const peladoQty    = salesPelado.reduce((sum, s) => sum + s.quantity, 0);
        const peladoIncome = salesPelado.reduce((sum, s) => sum + s.total, 0);
        const peladoProfit = salesPelado.reduce((sum, s) => sum + ((s.price - (s.costPerLb || 0)) * s.weight), 0);
        const peladoCost   = salesPelado.reduce((sum, s) => sum + ((s.costPerLb || 0) * s.weight), 0);

        const totalWeight = plumaWeight + peladoWeight;
        const totalQty    = plumaQty + peladoQty;

        const profitColor  = netProfit >= 0 ? '#155724' : '#721c24';
        const profitBg     = netProfit >= 0 ? '#d4edda' : '#f8d7da';
        const profitBorder = netProfit >= 0 ? '#28a745' : '#dc3545';

        let html = `
        <div class="card" style="margin-bottom:15px; border-left:5px solid ${profitBorder}; background:${profitBg};">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div>
                    <div style="font-size:0.85rem; color:${profitColor}; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">Ganancia del dia</div>
                    <div style="font-size:2.2rem; font-weight:bold; color:${profitColor};">${Utils.formatCurrency(netProfit)}</div>
                    ${totalExpenses > 0 ? `<div style="font-size:0.85rem; color:${profitColor}; margin-top:4px;">Antes de gastos: ${Utils.formatCurrency(grossProfit)} &nbsp;|&nbsp; Gastos: -${Utils.formatCurrency(totalExpenses)}</div>` : ''}
                </div>
                <div style="text-align:right;">
                    <div style="font-size:0.85rem; color:${profitColor};">Ingresos totales</div>
                    <div style="font-size:1.4rem; font-weight:bold; color:${profitColor};">${Utils.formatCurrency(totalIncome)}</div>
                    <div style="font-size:0.8rem; color:${profitColor};">${totalQty} pollos &nbsp;|&nbsp; ${totalWeight.toFixed(2)} lb</div>
                </div>
            </div>
            <div style="margin-top:10px; font-size:0.85rem; color:${profitColor};">Margen: <strong>${netMargin.toFixed(1)}%</strong></div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px,1fr)); gap:15px; margin-bottom:15px;">`;

        if (salesPluma.length > 0) {
            const plumaMargin = plumaIncome > 0 ? (plumaProfit / plumaIncome * 100) : 0;
            html += `
            <div class="card" style="border-left:4px solid #28a745; margin:0;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                    <span style="background:#28a745; color:white; padding:3px 10px; border-radius:12px; font-size:0.8rem; font-weight:600;">PLUMA</span>
                    <span style="font-size:0.85rem; color:var(--gray);">Con merma</span>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:0.9rem;">
                    <div><span style="color:var(--gray);">Ventas</span><br><strong>${salesPluma.length}</strong></div>
                    <div><span style="color:var(--gray);">Pollos</span><br><strong>${plumaQty}</strong></div>
                    <div><span style="color:var(--gray);">Libras</span><br><strong>${plumaWeight.toFixed(2)} lb</strong></div>
                    <div><span style="color:var(--gray);">Costo/lb</span><br><strong>${mermaRecord ? Utils.formatCurrency(plumaCostPerLb) : '<span style="color:#dc3545">Sin merma</span>'}</strong></div>
                    <div><span style="color:var(--gray);">Ingresos</span><br><strong>${Utils.formatCurrency(plumaIncome)}</strong></div>
                    <div><span style="color:var(--gray);">Costo total</span><br><strong>${Utils.formatCurrency(plumaCost)}</strong></div>
                </div>
                <div style="margin-top:12px; padding:8px; background:#d4edda; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.85rem; color:#155724;">Ganancia</span>
                    <strong style="color:#155724; font-size:1.1rem;">${Utils.formatCurrency(plumaProfit)} <span style="font-size:0.8rem;">(${plumaMargin.toFixed(1)}%)</span></strong>
                </div>
            </div>`;
        }

        if (salesPelado.length > 0) {
            const peladoMargin = peladoIncome > 0 ? (peladoProfit / peladoIncome * 100) : 0;
            const avgCostPelado = peladoWeight > 0 ? peladoCost / peladoWeight : 0;
            html += `
            <div class="card" style="border-left:4px solid #007bff; margin:0;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
                    <span style="background:#007bff; color:white; padding:3px 10px; border-radius:12px; font-size:0.8rem; font-weight:600;">PELADO</span>
                    <span style="font-size:0.85rem; color:var(--gray);">Costo directo</span>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:0.9rem;">
                    <div><span style="color:var(--gray);">Ventas</span><br><strong>${salesPelado.length}</strong></div>
                    <div><span style="color:var(--gray);">Pollos</span><br><strong>${peladoQty}</strong></div>
                    <div><span style="color:var(--gray);">Libras</span><br><strong>${peladoWeight.toFixed(2)} lb</strong></div>
                    <div><span style="color:var(--gray);">Costo/lb prom.</span><br><strong>${Utils.formatCurrency(avgCostPelado)}</strong></div>
                    <div><span style="color:var(--gray);">Ingresos</span><br><strong>${Utils.formatCurrency(peladoIncome)}</strong></div>
                    <div><span style="color:var(--gray);">Costo total</span><br><strong>${Utils.formatCurrency(peladoCost)}</strong></div>
                </div>
                <div style="margin-top:12px; padding:8px; background:#cce5ff; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.85rem; color:#004085;">Ganancia</span>
                    <strong style="color:#004085; font-size:1.1rem;">${Utils.formatCurrency(peladoProfit)} <span style="font-size:0.8rem;">(${peladoMargin.toFixed(1)}%)</span></strong>
                </div>
            </div>`;
        }

        html += `</div>`;

        if (expenses.length > 0) {
            html += `
            <div class="card" style="border-left:4px solid #dc3545; margin-bottom:15px;">
                <h4 style="margin:0 0 12px; color:#dc3545;"><i class="fas fa-receipt"></i> Gastos Operativos &mdash; ${Utils.formatCurrency(totalExpenses)}</h4>
                <div style="display:flex; flex-direction:column; gap:6px;">
                    ${expenses.map(exp => `
                        <div style="display:flex; justify-content:space-between; padding:8px 10px; background:var(--light); border-radius:6px; font-size:0.9rem;">
                            <span>${Utils.escapeHtml(exp.description)} <span style="color:var(--gray); font-size:0.8rem;">(${exp.category || 'otros'})</span></span>
                            <strong style="color:#dc3545;">-${Utils.formatCurrency(exp.amount)}</strong>
                        </div>
                    `).join('')}
                </div>
            </div>`;
        }

        summaryEl.innerHTML = html;
    },

    getExpensesByDate(date) {
        const targetDate = date.includes('/') ? this.convertDateFormat(date) : date;
        return this.expenses.filter(expense => {
            const expenseDate = expense.date.includes('/') ? this.convertDateFormat(expense.date) : expense.date;
            return expenseDate === targetDate;
        });
    },

    convertDateFormat(date) {
        if (date.includes('-') && date.split('-')[0].length === 4) {
            return date;
        }
        const parts = date.split('/');
        if (parts.length === 3) {
            return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        return date;
    },

    updateExpensesList(date = null) {
        const expensesList = document.getElementById('expenses-list');
        if (!expensesList) return;

        expensesList.innerHTML = '';

        const targetDate = date || Utils.getTodayDate();
        const targetExpenses = this.getExpensesByDate(targetDate);

        if (targetExpenses.length === 0) {
            expensesList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-money-bill-wave empty-state-icon"></i>
                    <p>No hay gastos registrados para ${targetDate}</p>
                </div>
            `;
            return;
        }

        const sortedExpenses = [...targetExpenses].sort((a, b) => b.timestamp - a.timestamp);

        sortedExpenses.forEach(expense => {
            const li = document.createElement('li');
            li.className = 'sale-item';
            li.innerHTML = `
                <div class="sale-info">
                    <h3><i class="fas fa-receipt"></i> ${Utils.escapeHtml(expense.description)}</h3>
                    <p class="sale-details"><i class="fas fa-tag"></i> ${expense.category} - ${expense.time}</p>
                </div>
                <div style="display: flex; flex-direction: column; gap: 5px; align-items: flex-end;">
                    <div class="sale-amount" style="color: var(--danger);">-${Utils.formatCurrency(expense.amount)}</div>
                    <div style="display: flex; gap: 5px;">
                        <button class="btn btn-outline" onclick="App.editExpense(${expense.id})" 
                                style="padding: 5px 10px; font-size: 0.8rem;">
                            <i class="fas fa-edit"></i>
                        </button>
                        ${Perm.can('expenses.delete') ? `
                        <button class="btn btn-danger" onclick="App.deleteExpense(${expense.id})" 
                                style="padding: 5px 10px; font-size: 0.8rem;">
                            <i class="fas fa-trash"></i>
                        </button>` : ''}
                    </div>
                </div>
            `;
            expensesList.appendChild(li);
        });
    },

    async saveExpenses() {
        if (DB.db) {
            for (const expense of this.expenses) {
                await DB.set('expenses', expense);
            }
        } else {
            localStorage.setItem('polloExpenses', JSON.stringify(this.expenses));
        }
    },

    async loadExpenses() {
        if (DB.db) {
            this.expenses = await DB.getAll('expenses');
        } else {
            const saved = localStorage.getItem('polloExpenses');
            if (saved) {
                this.expenses = JSON.parse(saved);
            }
        }
    },

    getNetProfitByDate(date) {
        const sales = SalesModule.getSalesByDate(date);
        const expenses = this.getExpensesByDate(date);
        
        // Calcular ganancia bruta: (PVP - Costo Merma) x Libras
        let grossProfit = 0;
        sales.forEach(sale => {
            const costPerLb = sale.costPerLb || 0;
            const profitPerLb = sale.price - costPerLb;
            grossProfit += profitPerLb * sale.weight;
        });
        
        const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
        const netProfit = grossProfit - totalExpenses;
        return parseFloat(netProfit.toFixed(2));
    }
};

const DiezmosModule = {
    config: { diezmoPercent: 10, ofrendaPercent: 5 },
    records: [],

    async init() {
        await this.loadConfig();
        await this.loadRecords();
        await this.calcularDiezmosPendientes();
        // NUEVO: Recalcular todos los diezmos al inicializar
        await this.forzarRecalculoCompleto();
    },

    // NUEVO: Calcular automaticamente diezmos de dias anteriores
    async calcularDiezmosPendientes() {
        // Obtener todas las fechas con ventas
        const fechasConVentas = [...new Set(SalesModule.sales.map(s => s.date))];
        let registrosCreados = 0;
        
        for (const fecha of fechasConVentas) {
            // Verificar si ya existe registro para esta fecha
            const existeRegistro = this.records.some(r => r.date === fecha);
            
            if (!existeRegistro) {
                // Calcular ganancia neta para esta fecha
                const netProfit = AccountingModule.getNetProfitByDate(fecha);
                
                // Solo crear registro si hay ganancia positiva
                if (netProfit > 0) {
                    const diezmo = (netProfit * this.config.diezmoPercent) / 100;
                    const ofrenda = (netProfit * this.config.ofrendaPercent) / 100;
                    
                    const record = {
                        id: Date.now() + registrosCreados, // Evitar IDs duplicados
                        date: fecha,
                        netProfit: Number(netProfit.toFixed(2)),
                        diezmo: Number(diezmo.toFixed(2)),
                        ofrenda: Number(ofrenda.toFixed(2)),
                        total: Number((diezmo + ofrenda).toFixed(2)),
                        diezmoPercent: this.config.diezmoPercent,
                        ofrendaPercent: this.config.ofrendaPercent,
                        timestamp: Date.now(),
                        autoCalculated: true // Marcar como calculado automaticamente
                    };
                    
                    this.records.push(record);
                    registrosCreados++;
                }
            }
        }
        
        if (registrosCreados > 0) {
            await this.saveRecords();
            console.log(`✅ Se calcularon automaticamente ${registrosCreados} registros de diezmos pendientes`);
        }
    },

    getPreview(date = Utils.getTodayDate()) {
        // Prevenir recursion infinita
        if (this._calculatingPreview) {
            return {
                netProfit: 0,
                diezmo: 0,
                ofrenda: 0,
                total: 0,
                diezmoPercent: this.config.diezmoPercent,
                ofrendaPercent: this.config.ofrendaPercent
            };
        }
        
        this._calculatingPreview = true;
        
        try {
            // Obtener ganancia neta desde AccountingModule
            const netProfit = AccountingModule.getNetProfitByDate(date);
            
            // Calcular diezmos y ofrendas SOLO si hay ganancia positiva
            const diezmo = netProfit > 0 ? (netProfit * this.config.diezmoPercent) / 100 : 0;
            const ofrenda = netProfit > 0 ? (netProfit * this.config.ofrendaPercent) / 100 : 0;
            
            return {
                netProfit: Number(netProfit.toFixed(2)) || 0,
                diezmo: Number(diezmo.toFixed(2)) || 0,
                ofrenda: Number(ofrenda.toFixed(2)) || 0,
                total: Number((diezmo + ofrenda).toFixed(2)) || 0,
                diezmoPercent: this.config.diezmoPercent,
                ofrendaPercent: this.config.ofrendaPercent
            };
        } finally {
            this._calculatingPreview = false;
        }
    },

    async saveDailyRecord(date = Utils.getTodayDate()) {
        const preview = this.getPreview(date);
        
        // Solo guardar si hay ganancia neta positiva
        if (preview.netProfit <= 0) {
            Utils.showNotification('No hay ganancia neta para calcular diezmos', 'warning', 3000);
            return null;
        }
        
        const existing = this.records.findIndex(r => r.date === date);
        
        const record = {
            id: existing > -1 ? this.records[existing].id : Date.now(),
            date,
            ...preview,
            timestamp: Date.now()
        };

        if (existing > -1) {
            this.records[existing] = record;
        } else {
            this.records.push(record);
        }

        await this.saveRecords();
        
        // Notificar calculo de diezmos (sin bloquear si falla)
        if (typeof NotificationsModule !== 'undefined') {
            try {
                NotificationsModule.notifyDiezmosCalculated(record.total).catch(err => {
                    console.warn('No se pudo enviar notificacion:', err);
                });
            } catch (err) {
                console.warn('Error al notificar:', err);
            }
        }
        
        return record;
    },

    getRecordsByDateRange(startDate, endDate) {
        const start = new Date(startDate).getTime();
        const end = new Date(endDate).getTime();
        return this.records.filter(r => {
            const recordDate = new Date(r.date).getTime();
            return recordDate >= start && recordDate <= end;
        });
    },

    updateConfig(diezmoPercent, ofrendaPercent) {
        this.config.diezmoPercent = parseFloat(diezmoPercent);
        this.config.ofrendaPercent = parseFloat(ofrendaPercent);
        this.saveConfig();
        // Recalcular todos los registros existentes con los nuevos porcentajes
        this.recalcularTodosLosRegistros();
    },

    // NUEVO: Recalcular todos los registros con los nuevos porcentajes
    async recalcularTodosLosRegistros() {
        let registrosActualizados = 0;
        
        for (const record of this.records) {
            const netProfit = record.netProfit;
            if (netProfit > 0) {
                const nuevoDiezmo = (netProfit * this.config.diezmoPercent) / 100;
                const nuevaOfrenda = (netProfit * this.config.ofrendaPercent) / 100;
                
                record.diezmo = Number(nuevoDiezmo.toFixed(2));
                record.ofrenda = Number(nuevaOfrenda.toFixed(2));
                record.total = Number((nuevoDiezmo + nuevaOfrenda).toFixed(2));
                record.diezmoPercent = this.config.diezmoPercent;
                record.ofrendaPercent = this.config.ofrendaPercent;
                record.lastUpdated = Date.now();
                
                registrosActualizados++;
            }
        }
        
        if (registrosActualizados > 0) {
            await this.saveRecords();
            Utils.showNotification(`Se recalcularon ${registrosActualizados} registros con los nuevos porcentajes`, 'success', 3000);
        }
    },

    async saveConfig() {
        if (DB.db) {
            await DB.set('config', { key: 'diezmos-config', value: this.config });
        }
        localStorage.setItem('polloDiezmosConfig', JSON.stringify(this.config));
    },

    async loadConfig() {
        if (DB.db) {
            const saved = await DB.get('config', 'diezmos-config');
            if (saved?.value) this.config = saved.value;
        }
        const savedLocal = localStorage.getItem('polloDiezmosConfig');
        if (savedLocal) this.config = JSON.parse(savedLocal);
    },

    async saveRecords() {
        if (DB.db) {
            await DB.set('config', { key: 'diezmos-records', value: this.records });
        }
        localStorage.setItem('polloDiezmosRecords', JSON.stringify(this.records));
    },

    async loadRecords() {
        if (DB.db) {
            const saved = await DB.get('config', 'diezmos-records');
            if (saved?.value) this.records = saved.value;
        }
        const savedLocal = localStorage.getItem('polloDiezmosRecords');
        if (savedLocal) this.records = JSON.parse(savedLocal);
    },

    // NUEVO: Funcion para forzar recalculo de todos los diezmos pendientes
    async forzarRecalculoCompleto() {
        const fechasConVentas = [...new Set(SalesModule.sales.map(s => s.date))];
        let registrosCreados = 0;
        let registrosActualizados = 0;
        
        for (const fecha of fechasConVentas) {
            const netProfit = AccountingModule.getNetProfitByDate(fecha);
            
            if (netProfit > 0) {
                const diezmo = (netProfit * this.config.diezmoPercent) / 100;
                const ofrenda = (netProfit * this.config.ofrendaPercent) / 100;
                
                const existingIndex = this.records.findIndex(r => r.date === fecha);
                
                const record = {
                    id: existingIndex > -1 ? this.records[existingIndex].id : Date.now() + registrosCreados,
                    date: fecha,
                    netProfit: Number(netProfit.toFixed(2)),
                    diezmo: Number(diezmo.toFixed(2)),
                    ofrenda: Number(ofrenda.toFixed(2)),
                    total: Number((diezmo + ofrenda).toFixed(2)),
                    diezmoPercent: this.config.diezmoPercent,
                    ofrendaPercent: this.config.ofrendaPercent,
                    timestamp: existingIndex > -1 ? this.records[existingIndex].timestamp : Date.now(),
                    lastUpdated: Date.now(),
                    autoCalculated: existingIndex === -1 // Solo marcar como auto si es nuevo
                };
                
                if (existingIndex > -1) {
                    this.records[existingIndex] = record;
                    registrosActualizados++;
                } else {
                    this.records.push(record);
                    registrosCreados++;
                }
            }
        }
        
        if (registrosCreados > 0 || registrosActualizados > 0) {
            await this.saveRecords();
            const mensaje = `Recalculo completo: ${registrosCreados} nuevos registros, ${registrosActualizados} actualizados`;
            Utils.showNotification(mensaje, 'success', 4000);
            return { creados: registrosCreados, actualizados: registrosActualizados };
        }
        
        return { creados: 0, actualizados: 0 };
    }
};

const ConfigModule = {
    currentConfig: {
        appName: 'GallOli',
        appShortName: 'GallOli',
        theme: 'default',
        logoType: 'emoji',
        logoEmoji: '??',
        logoImage: null,
        colors: {
            primary: '#4CAF50',
            'primary-dark': '#388E3C',
            secondary: '#FF9800',
            light: '#f5f5f5',
            dark: '#333',
            gray: '#757575',
            white: '#ffffff',
            danger: '#f44336',
            success: '#4CAF50',
            warning: '#FF9800'
        }
    },
    themes: {
        default: { name: 'Verde Clasico', colors: { primary: '#4CAF50', secondary: '#FF9800', light: '#f5f5f5' } },
        blue: { name: 'Azul Profesional', colors: { primary: '#2196F3', secondary: '#FF5722', light: '#E3F2FD' } },
        purple: { name: 'Morado Moderno', colors: { primary: '#9C27B0', secondary: '#FFC107', light: '#F3E5F5' } },
        red: { name: 'Rojo Intenso', colors: { primary: '#F44336', secondary: '#4CAF50', light: '#FFEBEE' } }
    },
    emojis: ['\uD83D\uDC14', '\uD83D\uDC13', '\uD83D\uDC23', '\uD83D\uDC24', '\uD83E\uDD9A', '\uD83D\uDC26', '\uD83E\uDD43', '\uD83D\uDC3A'],

    async init() {
        await this.loadConfig();
        this.applyConfig();
    },

    setTheme(themeName) {
        if (this.themes[themeName]) {
            this.currentConfig.theme = themeName;
            Object.assign(this.currentConfig.colors, this.themes[themeName].colors);
            this.applyConfig();
            this.saveConfig();
        }
    },

    setAppName(name) {
        this.currentConfig.appName = name;
        this.applyConfig();
        this.saveConfig();
    },

    setLogoEmoji(emoji) {
        this.currentConfig.logoType = 'emoji';
        this.currentConfig.logoEmoji = emoji;
        this.currentConfig.logoImage = null;
        this.applyLogo();
        this.saveConfig();
    },

    applyConfig() {
        Object.entries(this.currentConfig.colors).forEach(([key, value]) => {
            document.documentElement.style.setProperty(`--${key}`, value);
        });
        this.applyLogo();
        this.updateDynamicManifest();
    },

    applyLogo() {
        const logoElements = document.querySelectorAll('.logo-icon, .sidebar-logo');
        logoElements.forEach(el => {
            if (this.currentConfig.logoType === 'emoji') {
                el.textContent = this.currentConfig.logoEmoji;
                el.className = el.className.replace('logo-image-custom', 'logo-emoji');
            } else if (this.currentConfig.logoImage) {
                el.innerHTML = `<img src="${this.currentConfig.logoImage}" class="logo-image-custom" alt="Logo">`;
            }
        });
        
        const titleElements = document.querySelectorAll('.logo h1, .sidebar-header h2');
        titleElements.forEach(el => el.textContent = this.currentConfig.appName);
    },

    updateDynamicManifest() {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'UPDATE_CONFIG',
                config: this.currentConfig
            });
        }
    },

    saveConfig() {
        // Guardar en localStorage (rapido)
        localStorage.setItem('polloConfig', JSON.stringify(this.currentConfig));
        
        // Guardar en IndexedDB (persistente)
        if (DB.db) {
            DB.set('config', { key: 'app-config', value: this.currentConfig });
        }
        
        this.applyConfig();
        this.updateDynamicManifest();
        if (typeof Utils !== 'undefined') {
            Utils.showNotification('Configuracion guardada correctamente', 'success', 3000);
        }
    },

    async loadConfig() {
        // Intentar cargar desde IndexedDB primero (mas confiable)
        if (DB.db) {
            try {
                const saved = await DB.get('config', 'app-config');
                if (saved?.value) {
                    this.currentConfig = { ...this.currentConfig, ...saved.value };
                    // Sincronizar con localStorage
                    localStorage.setItem('polloConfig', JSON.stringify(this.currentConfig));
                    return;
                }
            } catch (e) {
                console.warn('Error cargando config desde IndexedDB:', e);
            }
        }
        
        // Fallback a localStorage
        const saved = localStorage.getItem('polloConfig');
        if (saved) {
            try {
                this.currentConfig = { ...this.currentConfig, ...JSON.parse(saved) };
                // Guardar en IndexedDB para proxima vez
                if (DB.db) {
                    DB.set('config', { key: 'app-config', value: this.currentConfig });
                }
            } catch (e) {
                console.error('Error loading config:', e);
            }
        }
    },

    async resetToDefault() {
        const confirmed = await Utils.showDangerConfirm(
            'Se restaurara la configuracion por defecto y se recargara la aplicacion.',
            'Restaurar Configuracion?',
            'Restaurar'
        );
        
        if (confirmed) {
            localStorage.removeItem('polloConfig');
            location.reload();
        }
    },

    exportConfig() {
        const dataStr = JSON.stringify(this.currentConfig, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pollos-config-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    async importConfig(file) {
        const text = await file.text();
        const config = JSON.parse(text);
        this.currentConfig = { ...this.currentConfig, ...config };
        this.saveConfig();
        this.applyConfig();
    }
};

// Modulo de Historial de Pagos - Registro permanente de todos los pagos
const PaymentHistoryModule = {
    // YA NO se usa payments[] - se construye dinamicamente desde SalesModule.sales
    
    // Obtener todos los pagos (construido dinamicamente desde sale.paymentHistory)
    getAllPayments() {
        const allPayments = [];
        
        // Recorrer todas las ventas y extraer sus pagos
        if (typeof SalesModule !== 'undefined' && SalesModule.sales) {
            SalesModule.sales.forEach(sale => {
                if (sale.paymentHistory && sale.paymentHistory.length > 0) {
                    const client = ClientsModule.getClientById(sale.clientId);
                    const clientName = client ? client.name : 'Cliente Desconocido';
                    
                    sale.paymentHistory.forEach(payment => {
                        allPayments.push({
                            id: payment.timestamp || Date.now(),
                            saleId: sale.id,
                            clientId: sale.clientId,
                            clientName: clientName,
                            amount: payment.amount,
                            date: payment.date,
                            time: payment.time,
                            timestamp: payment.timestamp || new Date(payment.date).getTime(),
                            saleDetails: {
                                totalAmount: sale.totalAmount || sale.total,
                                weight: sale.weight,
                                quantity: sale.quantity,
                                saleDate: sale.date
                            }
                        });
                    });
                }
            });
        }
        
        return allPayments.sort((a, b) => b.timestamp - a.timestamp);
    },

    // Obtener pagos por cliente
    getPaymentsByClient(clientId) {
        return this.getAllPayments()
            .filter(p => p.clientId === clientId);
    },

    // Obtener pagos por rango de fechas
    getPaymentsByDateRange(startDate, endDate) {
        return this.getAllPayments()
            .filter(p => p.date >= startDate && p.date <= endDate);
    },

    // Obtener pagos por cliente y rango de fechas
    getPaymentsByClientAndDateRange(clientId, startDate, endDate) {
        return this.getAllPayments()
            .filter(p => p.clientId === clientId && p.date >= startDate && p.date <= endDate);
    },

    // Obtener total pagado por cliente
    getTotalPaidByClient(clientId) {
        return this.getPaymentsByClient(clientId)
            .reduce((sum, p) => sum + p.amount, 0);
    },

    // Obtener estadisticas de pagos
    getStats() {
        const allPayments = this.getAllPayments();
        const totalPayments = allPayments.length;
        const totalAmount = allPayments.reduce((sum, p) => sum + p.amount, 0);
        const uniqueClients = [...new Set(allPayments.map(p => p.clientId))].length;
        
        return {
            totalPayments,
            totalAmount,
            uniqueClients,
            averagePayment: totalPayments > 0 ? totalAmount / totalPayments : 0
        };
    },

    
    // YA NO se necesitan estas funciones - los datos vienen de sale.paymentHistory
    async init() {
        // No hacer nada - los datos se construyen dinamicamente
        console.log('✅ PaymentHistoryModule inicializado (modo dinamico desde ventas)');
    },

    exportPayments(clientId = null) {
        const payments = clientId ? this.getPaymentsByClient(clientId) : this.getAllPayments();
        const dataStr = JSON.stringify(payments, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `historial_pagos_${clientId || 'todos'}_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
};

const RutasModule = {
    mapaRuta: null,
    mapaRutaInicializado: false,
    marcadoresRuta: [],
    rutaActual: null,

    // Inicializar mapa de rutas
    inicializarMapa() {
        try {
            const mapContainer = document.getElementById('mapa-ruta-permanente');
            if (!mapContainer) {
                console.warn('⚠️ Contenedor mapa-ruta-permanente no encontrado');
                return;
            }

            if (this.mapaRutaInicializado && this.mapaRuta) {
                console.log('✅ Mapa de rutas ya inicializado');
                return;
            }

            // Crear mapa usando OfflineMaps
            this.mapaRuta = OfflineMaps.createMap('mapa-ruta-permanente', {
                center: [19.4326, -99.1332],
                zoom: 12
            });

            if (!this.mapaRuta) {
                console.error('❌ Error al crear mapa de rutas');
                return;
            }

            this.mapaRutaInicializado = true;
            console.log('✅ Mapa de rutas inicializado correctamente');

            // Cargar rutas existentes
            this.cargarRutasEnMapa();
        } catch (error) {
            console.error('❌ Error inicializando mapa de rutas:', error);
        }
    },

    // Actualizar mapa de rutas
    actualizarMapa() {
        try {
            if (!this.mapaRutaInicializado || !this.mapaRuta) {
                console.warn('⚠️ Mapa de rutas no inicializado, inicializando...');
                this.inicializarMapa();
                return;
            }

            // Limpiar marcadores anteriores
            this.marcadoresRuta.forEach(marcador => {
                if (marcador && this.mapaRuta) {
                    this.mapaRuta.removeLayer(marcador);
                }
            });
            this.marcadoresRuta = [];

            // Cargar nuevas rutas
            this.cargarRutasEnMapa();
            console.log('✅ Mapa de rutas actualizado');
        } catch (error) {
            console.error('❌ Error actualizando mapa de rutas:', error);
        }
    },

    // Cargar rutas en el mapa
    cargarRutasEnMapa() {
        try {
            if (!this.mapaRuta) return;

            const pedidosPendientes = OrdersModule.getPendingOrders();
            if (!pedidosPendientes || pedidosPendientes.length === 0) {
                console.log('ℹ️ No hay pedidos pendientes para mostrar en mapa');
                return;
            }

            // Agrupar pedidos por cliente
            const pedidosPorCliente = {};
            pedidosPendientes.forEach(pedido => {
                if (!pedidosPorCliente[pedido.clientId]) {
                    pedidosPorCliente[pedido.clientId] = [];
                }
                pedidosPorCliente[pedido.clientId].push(pedido);
            });

            // Mostrar marcadores para cada cliente
            let contador = 0;
            Object.keys(pedidosPorCliente).forEach(clientId => {
                const cliente = ClientsModule.getClientById(clientId);
                if (cliente && cliente.coordinates && cliente.coordinates.lat && cliente.coordinates.lng) {
                    const lat = parseFloat(cliente.coordinates.lat);
                    const lng = parseFloat(cliente.coordinates.lng);

                    if (!isNaN(lat) && !isNaN(lng)) {
                        contador++;
                        const marcador = OfflineMaps.createMarker(lat, lng, {
                            color: 'var(--primary)',
                            size: 35,
                            label: contador.toString()
                        });

                        marcador.bindPopup(`
                            <div style="font-size: 12px;">
                                <strong>${Utils.escapeHtml(cliente.name)}</strong><br>
                                Pedidos: ${pedidosPorCliente[clientId].length}<br>
                                Total: ${Utils.formatCurrency(
                                    pedidosPorCliente[clientId].reduce((sum, p) => sum + (p.total || 0), 0)
                                )}
                            </div>
                        `);

                        marcador.addTo(this.mapaRuta);
                        this.marcadoresRuta.push(marcador);
                    }
                }
            });

            console.log(`✅ ${contador} marcadores de ruta cargados en el mapa`);
        } catch (error) {
            console.error('❌ Error cargando rutas en mapa:', error);
        }
    },

    // Actualizar ruta automáticamente cuando se agrega un pedido
    actualizarRutaAutomatica() {
        if (this.mapaRutaInicializado && this.mapaRuta) {
            this.actualizarMapa();
        }
    },

    // Actualizar ruta cuando cambia el estado de un pedido
    actualizarRutaPorCambioPedido(orderId, status) {
        if (this.mapaRutaInicializado && this.mapaRuta) {
            this.actualizarMapa();
        }
    },

    // Generar y dibujar sobre el mapa la ruta optima de pedidos pendientes
    generarRutaOptima() {
        try {
            if (!this.mapaRutaInicializado || !this.mapaRuta) {
                this.inicializarMapa();
                if (!this.mapaRuta) {
                    Utils.showNotification('No se pudo inicializar el mapa de rutas', 'error', 4000);
                    return;
                }
            }

            const pedidosPendientes = OrdersModule.getPendingOrders() || [];
            const clientes = [];

            pedidosPendientes.forEach(pedido => {
                const cliente = ClientsModule.getClientById(pedido.clientId);
                if (!cliente || !cliente.coordinates) return;
                if (clientes.some(c => c.id === cliente.id)) return;

                const lat = parseFloat(cliente.coordinates.lat);
                const lng = parseFloat(cliente.coordinates.lng);
                if (isNaN(lat) || isNaN(lng)) return;

                clientes.push({ id: cliente.id, name: cliente.name, coordinates: { lat, lng } });
            });

            if (clientes.length === 0) {
                Utils.showNotification('No hay pedidos pendientes con ubicacion GPS', 'warning', 4000);
                return;
            }

            const ordenados = this.optimizarRuta(clientes);

            // Quitar marcadores/linea anteriores sin avisar
            this.limpiarMapa(true);

            const puntos = [];
            ordenados.forEach((cliente, indice) => {
                const lat = cliente.coordinates.lat;
                const lng = cliente.coordinates.lng;
                puntos.push([lat, lng]);

                const marcador = OfflineMaps.createMarker(lat, lng, {
                    color: 'var(--secondary)',
                    size: 32,
                    label: String(indice + 1)
                });

                marcador.bindPopup(`
                    <div style="font-size: 12px;">
                        <strong>${Utils.escapeHtml(cliente.name)}</strong><br>
                        Parada ${indice + 1} de ${ordenados.length}
                    </div>
                `);

                marcador.addTo(this.mapaRuta);
                this.marcadoresRuta.push(marcador);
            });

            if (puntos.length > 1) {
                this.rutaActual = L.polyline(puntos, {
                    color: '#2196F3',
                    weight: 4,
                    opacity: 0.8,
                    dashArray: '8,6'
                }).addTo(this.mapaRuta);
            }

            if (puntos.length === 1) {
                this.mapaRuta.setView(puntos[0], 15);
            } else {
                this.mapaRuta.fitBounds(puntos, { padding: [30, 30] });
            }

            Utils.showNotification(`Ruta optimizada: ${ordenados.length} paradas`, 'success', 4000);
            console.log(`✅ Ruta optima generada con ${ordenados.length} paradas`);
        } catch (error) {
            console.error('❌ Error generando ruta optima:', error);
            Utils.showNotification('No se pudo generar la ruta optima', 'error', 4000);
        }
    },

    // Limpiar marcadores y linea de ruta del mapa
    limpiarMapa(silencioso) {
        try {
            this.marcadoresRuta.forEach(marcador => {
                if (marcador && this.mapaRuta) {
                    this.mapaRuta.removeLayer(marcador);
                }
            });
            this.marcadoresRuta = [];

            if (this.rutaActual && this.mapaRuta) {
                this.mapaRuta.removeLayer(this.rutaActual);
            }
            this.rutaActual = null;

            if (!silencioso) {
                Utils.showNotification('Mapa de ruta limpiado', 'info', 2500);
            }
        } catch (error) {
            console.error('❌ Error limpiando el mapa de rutas:', error);
        }
    },

    // Optimizar ruta (ordenar clientes por proximidad)
    optimizarRuta(clientes) {
        if (!clientes || clientes.length === 0) return clientes;

        try {
            const clientesOrdenados = [clientes[0]];
            const clientesRestantes = clientes.slice(1);

            while (clientesRestantes.length > 0) {
                const ultimoCliente = clientesOrdenados[clientesOrdenados.length - 1];
                if (!ultimoCliente.coordinates) { clientesOrdenados.push(...clientesRestantes); break; }
                const lat1 = parseFloat(ultimoCliente.coordinates.lat);
                const lng1 = parseFloat(ultimoCliente.coordinates.lng);

                let proximoIdx = 0;
                let distanciaMinima = Infinity;

                clientesRestantes.forEach((cliente, idx) => {
                    if (!cliente.coordinates) return;
                    const lat2 = parseFloat(cliente.coordinates.lat);
                    const lng2 = parseFloat(cliente.coordinates.lng);
                    const distancia = OfflineMaps.calculateDistance(lat1, lng1, lat2, lng2);
                    if (distancia < distanciaMinima) {
                        distanciaMinima = distancia;
                        proximoIdx = idx;
                    }
                });

                clientesOrdenados.push(clientesRestantes[proximoIdx]);
                clientesRestantes.splice(proximoIdx, 1);
            }

            return clientesOrdenados;
        } catch (error) {
            console.error('❌ Error optimizando ruta:', error);
            return clientes;
        }
    }
};






const BackupModule = {
    telegramBotToken: null,
    telegramChatId: null,
    autoBackupEnabled: false,
    lastAutoBackup: null,

    async init() {
        await this.loadTelegramConfig();
        this.loadAutoBackupConfig();
    },

    async createBackup() {
        const data = {
            // Datos principales
            clients: ClientsModule.clients || [],
            sales: SalesModule.sales || [],
            orders: OrdersModule.orders || [],
            expenses: AccountingModule.expenses || [],
            
            // Merma completa
            mermaPrices: MermaModule.dailyPrices || [],
            mermaRecords: MermaModule.mermaRecords || [],
            
            // Diezmos completos
            diezmosRecords: DiezmosModule.records || [],
            diezmosConfig: DiezmosModule.config || { diezmoPercent: 10, ofrendaPercent: 5 },
            
            // Historial de pagos permanente
            paymentHistory: PaymentHistoryModule.payments || [],
            
            // Creditos (incluido en sales pero separado para claridad)
            creditosData: {
                creditSales: SalesModule.sales.filter(s => !s.isPaid) || [],
                paymentHistory: SalesModule.sales.filter(s => s.paymentHistory && s.paymentHistory.length > 0) || []
            },
            
            // Configuracion completa de la app
            config: ConfigModule.currentConfig || {},
            
            // Configuracion de Telegram
            telegramConfig: {
                botToken: BackupModule.telegramBotToken || null,
                chatId: BackupModule.telegramChatId || null
            },
            
            // Metadatos del backup
            metadata: {
                exportDate: Utils.formatDateTime(),
                version: '2.1',
                totalClients: ClientsModule.clients.length,
                totalSales: SalesModule.sales.length,
                totalOrders: OrdersModule.orders.length,
                totalExpenses: AccountingModule.expenses.length,
                totalPayments: PaymentHistoryModule.getAllPayments().length,
                appName: ConfigModule.currentConfig.appName || 'GallOli'
            }
        };
        
        const dataStr = JSON.stringify(data, null, 2);
        const filename = `pollos_backup_${Utils.formatDate()}_${Date.now()}.json`;
        
        localStorage.setItem('lastBackup', new Date().toISOString());
        
        // Notificar backup creado (sin bloquear si falla)
        if (typeof PushNotifications !== 'undefined') {
            try {
                PushNotifications.notifyBackupSuccess('backup').catch(err => {
                    console.warn('No se pudo enviar notificacion:', err);
                });
            } catch (err) {
                console.warn('Error al notificar:', err);
            }
        }
        
        return { data: dataStr, filename };
    },

    async importFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    await this.importFromData(data);
                    resolve(true);
                } catch (error) {
                    Utils.showLoading(false);
                    Utils.showNotification('Error al restaurar backup: ' + error.message, 'error', 5000);
                    reject(error);
                }
            };
            reader.onerror = () => {
                Utils.showLoading(false);
                reject(new Error('Error al leer el archivo'));
            };
            reader.readAsText(file);
        });
    },

    async importFromData(data) {
        Utils.showLoading(true);
        try {
            if (data.clients) {
                ClientsModule.clients = data.clients;
                await ClientsModule.saveClients();
            }
            if (data.sales) {
                SalesModule.sales = data.sales;
                await SalesModule.saveSales();
            }
            if (data.orders) {
                OrdersModule.orders = data.orders;
                await OrdersModule.saveOrders();
            }
            if (data.expenses) {
                AccountingModule.expenses = data.expenses;
                await AccountingModule.saveExpenses();
            }
            if (data.mermaPrices) {
                MermaModule.dailyPrices = data.mermaPrices;
                await MermaModule.saveDailyPrices();
            }
            if (data.mermaRecords) {
                MermaModule.mermaRecords = data.mermaRecords;
                await MermaModule.saveMermaRecords();
            }
            if (data.diezmosRecords) {
                DiezmosModule.records = data.diezmosRecords;
                await DiezmosModule.saveRecords();
            }
            if (data.diezmosConfig) {
                DiezmosModule.config = data.diezmosConfig;
                await DiezmosModule.saveConfig();
            }
            if (data.paymentHistory) {
                PaymentHistoryModule.payments = data.paymentHistory;
                await PaymentHistoryModule.savePayments();
            }
            if (data.config) {
                ConfigModule.currentConfig = data.config;
                ConfigModule.saveConfig();
            }
            if (data.telegramConfig) {
                if (data.telegramConfig.botToken) {
                    BackupModule.telegramBotToken = data.telegramConfig.botToken;
                    localStorage.setItem('telegramBotToken', data.telegramConfig.botToken);
                }
                if (data.telegramConfig.chatId) {
                    BackupModule.telegramChatId = data.telegramConfig.chatId;
                    localStorage.setItem('telegramChatId', data.telegramConfig.chatId);
                }
            }
            Utils.showLoading(false);
            Utils.showNotification('Backup restaurado correctamente', 'success', 5000);
        } catch (error) {
            Utils.showLoading(false);
            Utils.showNotification('Error al restaurar backup: ' + error.message, 'error', 5000);
            throw error;
        }
    },

    getBackupStats() {
        return {
            totalClients: ClientsModule.clients.length,
            totalSales: SalesModule.sales.length,
            totalOrders: OrdersModule.orders.length,
            totalExpenses: AccountingModule.expenses.length,
            totalPrices: MermaModule.dailyPrices.length,
            totalSize: this.calculateSize(),
            lastBackup: localStorage.getItem('lastBackup') || 'Nunca'
        };
    },

    calculateSize() {
        const data = JSON.stringify({
            clients: ClientsModule.clients,
            sales: SalesModule.sales,
            orders: OrdersModule.orders,
            expenses: AccountingModule.expenses
        });
        const bytes = new Blob([data]).size;
        return bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(2) + ' KB';
    },

    initTelegram(token, chatId) {
        this.telegramBotToken = token;
        this.telegramChatId = chatId;
        localStorage.setItem('telegramBotToken', token);
        localStorage.setItem('telegramChatId', chatId);
        
        // Guardar tambien en AutoBackup para backups automaticos (IndexedDB seguro)
        if (typeof AutoBackup !== 'undefined') {
            AutoBackup.saveCredentials(token, chatId);
        }
    },

    async loadTelegramConfig() {
        // Intentar cargar desde version encriptada primero
        const encryptedToken = localStorage.getItem('tg_bt');
        const encryptedChatId = localStorage.getItem('tg_ci');
        
        if (encryptedToken) {
            this.telegramBotToken = this.decrypt(encryptedToken);
        }
        if (encryptedChatId) {
            this.telegramChatId = this.decrypt(encryptedChatId);
        }
        
        // Si no hay encriptadas, intentar cargar las sin encriptar (para AutoBackup)
        if (!this.telegramBotToken) {
            this.telegramBotToken = localStorage.getItem('telegramBotToken');
        }
        if (!this.telegramChatId) {
            this.telegramChatId = localStorage.getItem('telegramChatId');
        }
        
        // Si aun no hay, intentar cargar desde IndexedDB (AutoBackup)
        if ((!this.telegramBotToken || !this.telegramChatId) && typeof AutoBackup !== 'undefined') {
            try {
                const credentials = await AutoBackup.getCredentials();
                if (credentials.botToken && credentials.chatId) {
                    this.telegramBotToken = credentials.botToken;
                    this.telegramChatId = credentials.chatId;
                    console.log('✅ Credenciales cargadas desde IndexedDB');
                }
            } catch (error) {
                console.error('Error cargando desde IndexedDB:', error);
            }
        }
        
        console.log('🔐 Credenciales de Telegram cargadas:', {
            hasToken: !!this.telegramBotToken,
            hasChatId: !!this.telegramChatId
        });
    },

    loadAutoBackupConfig() {
        this.autoBackupEnabled = localStorage.getItem('autoBackupEnabled') === 'true';
        this.lastAutoBackup = localStorage.getItem('lastAutoBackup');
    },

    // Encriptacion simple (ofuscacion)
    encrypt(text) {
        if (!text) return null;
        return btoa(encodeURIComponent(text).split('').reverse().join(''));
    },

    decrypt(encrypted) {
        if (!encrypted) return null;
        try {
            return decodeURIComponent(atob(encrypted).split('').reverse().join(''));
        } catch (e) {
            return null;
        }
    },

    saveTelegramConfig(token, chatId) {
        if (token) {
            this.telegramBotToken = token;
            localStorage.setItem('tg_bt', this.encrypt(token));
            localStorage.setItem('telegramBotToken', token); // Tambien sin encriptar para compatibilidad
        }
        if (chatId) {
            this.telegramChatId = chatId;
            localStorage.setItem('tg_ci', this.encrypt(chatId));
            localStorage.setItem('telegramChatId', chatId); // Tambien sin encriptar para compatibilidad
        }
        
        // Guardar tambien en AutoBackup para backups automaticos (IndexedDB seguro)
        if (typeof AutoBackup !== 'undefined' && token && chatId) {
            AutoBackup.saveCredentials(token, chatId);
        }
        
        Utils.showNotification('Configuracion de Telegram guardada de forma segura', 'success', 3000);
    },

    clearTelegramConfig() {
        this.telegramBotToken = null;
        this.telegramChatId = null;
        localStorage.removeItem('tg_bt');
        localStorage.removeItem('tg_ci');
        Utils.showNotification('Configuracion de Telegram eliminada', 'info', 3000);
    },

    async testTelegramConnection() {
        if (!this.telegramBotToken || !this.telegramChatId) {
            throw new Error('Configura token y chat ID primero');
        }

        try {
            const response = await fetch(`https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.telegramChatId,
                    text: 'Conexion exitosa con GallOli\n\nTu bot esta configurado correctamente y listo para recibir backups automaticos.'
                })
            });

            const result = await response.json();
            
            if (!result.ok) {
                throw new Error(result.description || 'Error desconocido');
            }

            return result;
        } catch (error) {
            throw new Error(`Error de conexion: ${error.message}`);
        }
    },

    async sendToTelegram(backup) {
        if (!this.telegramBotToken || !this.telegramChatId) {
            throw new Error('Configura Telegram primero');
        }

        try {
            const stats = this.getBackupStats();
            const blob = new Blob([backup.data], { type: 'application/json' });
            const formData = new FormData();
            
            formData.append('chat_id', this.telegramChatId);
            formData.append('document', blob, backup.filename);
            formData.append('caption', 
                `Backup Automatico GallOli\n` +
                `${Utils.formatDateTime()}\n\n` +
                `Estadisticas:\n` +
                `Clientes: ${stats.totalClients}\n` +
                `Ventas: ${stats.totalSales}\n` +
                `Pedidos: ${stats.totalOrders}\n` +
                `Gastos: ${stats.totalExpenses}\n` +
                `Tamano: ${stats.totalSize}`
            );

            const response = await fetch(
                `https://api.telegram.org/bot${this.telegramBotToken}/sendDocument`,
                {
                    method: 'POST',
                    body: formData
                }
            );

            const result = await response.json();
            
            if (!result.ok) {
                throw new Error(result.description || 'Error al enviar backup');
            }

            localStorage.setItem('lastTelegramBackup', new Date().toISOString());
            
            // Notificacion de exito
            if (typeof PushNotifications !== 'undefined') {
                try {
                    PushNotifications.notifyBackupSuccess(backup.filename).catch(err => {
                        console.warn('No se pudo enviar notificacion:', err);
                    });
                } catch (err) {
                    console.warn('Error al notificar:', err);
                }
            }
            
            return result;
        } catch (error) {
            // Notificacion de error
            if (typeof PushNotifications !== 'undefined') {
                try {
                    PushNotifications.notifyBackupError(error.message).catch(err => {
                        console.warn('No se pudo enviar notificacion de error:', err);
                    });
                } catch (err) {
                    console.warn('Error al notificar error:', err);
                }
            }
            
            throw new Error(`Error enviando a Telegram: ${error.message}`);
        }
    },

    async createAndSendBackup() {
        try {
            Utils.showLoading(true);
            const backup = await this.createBackup();
            const result = await this.sendToTelegram(backup);
            
            if (result.ok) {
                Utils.showNotification('Backup enviado a Telegram correctamente', 'success', 5000);
                return true;
            }
            return false;
        } catch (error) {
            Utils.showNotification(`${error.message}`, 'error', 5000);
            return false;
        } finally {
            Utils.showLoading(false);
        }
    },

    toggleAutoBackup(enabled) {
        this.autoBackupEnabled = enabled;
        localStorage.setItem('autoBackupEnabled', enabled ? 'true' : 'false');
        
        if (enabled) {
            this.scheduleAutoBackup();
            Utils.showNotification('Backup automatico activado', 'success', 3000);
        } else {
            Utils.showNotification('Backup automatico desactivado', 'info', 3000);
        }
    },

    scheduleAutoBackup() {
        if (!this.autoBackupEnabled) return;
        
        // Backup automatico cada 24 horas
        const lastBackup = localStorage.getItem('lastTelegramBackup');
        const now = new Date().getTime();
        const dayInMs = 24 * 60 * 60 * 1000;
        
        if (!lastBackup || (now - new Date(lastBackup).getTime()) > dayInMs) {
            this.createAndSendBackup();
        }
    }
};

const ReportsModule = {
    generateSalesReport(startDate, endDate) {
        const sales = SalesModule.getSalesByDateRange(startDate, endDate);
        if (sales.length === 0) return null;

        const totalIncome = sales.reduce((sum, sale) => sum + sale.total, 0);
        const totalWeight = sales.reduce((sum, sale) => sum + sale.weight, 0);
        const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantity, 0);

        return {
            startDate,
            endDate,
            totalSales: sales.length,
            totalIncome,
            totalWeight,
            totalQuantity,
            averageWeight: totalQuantity > 0 ? totalWeight / totalQuantity : 0,
            sales
        };
    },

    generatePDFReport(report, title) {
        Utils.showNotification('Generacion de PDF no implementada aun', 'info', 3000);
        return `reporte_${Utils.formatDate()}.pdf`;
    }
};

const MapModule = {
    map: null,
    marker: null,
    selectedLocation: null,

    initMap(lat, lng) {
        const mapElement = document.getElementById('location-map');
        if (!mapElement) return;

        if (this.map) {
            this.map.remove();
        }

        this.map = L.map('location-map').setView([lat, lng], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: 'OpenStreetMap'
        }).addTo(this.map);

        this.marker = L.marker([lat, lng], { draggable: true }).addTo(this.map);
        
        this.map.on('click', (e) => {
            this.setLocation(e.latlng.lat, e.latlng.lng);
        });

        this.marker.on('dragend', (e) => {
            const pos = e.target.getLatLng();
            this.setLocation(pos.lat, pos.lng);
        });

        this.setLocation(lat, lng);
    },

    setLocation(lat, lng) {
        this.selectedLocation = { lat, lng };
        if (this.marker) {
            this.marker.setLatLng([lat, lng]);
        }
        document.getElementById('map-latitude').value = lat.toFixed(6);
        document.getElementById('map-longitude').value = lng.toFixed(6);
        document.getElementById('map-address').value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    },

    setCurrentLocation(lat, lng) {
        if (this.map) {
            this.map.setView([lat, lng], 13);
            this.setLocation(lat, lng);
        }
    },

    getSelectedLocation() {
        return this.selectedLocation;
    },

    destroyMap() {
        if (this.map) {
            this.map.remove();
            this.map = null;
            this.marker = null;
            this.selectedLocation = null;
        }
    }
};


// ============================================
// MODULO: SINCRONIZACION EN LA NUBE
// ============================================
const CloudSyncModule = {
    name: 'cloud-sync',
    
    async load() {
        const isAuthenticated = window.AuthManager.isAuthenticated();
        
        if (!isAuthenticated) {
            return this.renderLoginPage();
        } else {
            return this.renderSyncPage();
        }
    },
    
    renderLoginPage() {
        const lastEmail = localStorage.getItem('galloli_last_email') || '';
        return `
            <div style="min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1rem;background:linear-gradient(135deg,#e8f5e9,#f1f8e9);">
                <!-- Logo -->
                <div style="text-align:center;margin-bottom:1.5rem;">
                    <div style="width:80px;height:80px;background:linear-gradient(135deg,#4CAF50,#388E3C);border-radius:20px;display:flex;align-items:center;justify-content:center;margin:0 auto 0.75rem;box-shadow:0 4px 16px rgba(76,175,80,.35);">
                        <i class="fas fa-leaf" style="font-size:2.2rem;color:white;"></i>
                    </div>
                    <h1 style="margin:0;font-size:1.8rem;color:#2e7d32;font-weight:700;">GallOli</h1>
                    <p style="margin:.25rem 0 0;color:#666;font-size:.9rem;">Gestiona tu negocio sin conexión y en la nube</p>
                </div>

                <!-- Card -->
                <div style="width:min(96vw,440px);background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.1);overflow:hidden;">

                    <!-- Tabs Login / Crear cuenta -->
                    <div style="display:flex;border-bottom:2px solid #eee;">
                        <button id="tab-login" onclick="CloudSyncModule._switchLoginMode('login')"
                                style="flex:1;padding:1rem;border:none;background:none;cursor:pointer;font-weight:700;color:#4CAF50;border-bottom:3px solid #4CAF50;font-size:.95rem;">
                            Iniciar sesión
                        </button>
                        <button id="tab-register" onclick="CloudSyncModule._switchLoginMode('register')"
                                style="flex:1;padding:1rem;border:none;background:none;cursor:pointer;font-weight:600;color:#999;border-bottom:3px solid transparent;font-size:.95rem;">
                            Crear cuenta
                        </button>
                    </div>

                    <div style="padding:1.5rem;">
                        <!-- Segmented: Telegram / Email -->
                        <div style="display:flex;background:#f5f5f5;border-radius:8px;padding:3px;margin-bottom:1.25rem;">
                            <button id="seg-telegram" onclick="CloudSyncModule.switchTab('telegram')"
                                    style="flex:1;padding:.6rem;border:none;border-radius:6px;background:white;cursor:pointer;font-weight:600;font-size:.85rem;box-shadow:0 1px 4px rgba(0,0,0,.1);">
                                <i class="fab fa-telegram" style="color:#2196F3;"></i> Telegram
                            </button>
                            <button id="seg-email" onclick="CloudSyncModule.switchTab('email')"
                                    style="flex:1;padding:.6rem;border:none;border-radius:6px;background:none;cursor:pointer;font-weight:600;font-size:.85rem;color:#666;">
                                <i class="fas fa-envelope"></i> Email
                            </button>
                        </div>

                        <!-- Telegram Form -->
                        <div class="login-form" id="telegram-form">
                            <div style="margin-bottom:1rem;">
                                <label for="telegram-id" style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">Tu ID de Telegram</label>
                                <input type="text" id="telegram-id" name="telegram-id" placeholder="Ej: 123456789"
                                       class="form-control" inputmode="numeric">
                                <small style="color:#666;display:block;margin-top:.35rem;font-size:.8rem;">
                                    <i class="fas fa-info-circle"></i> Envía /start a @userinfobot para obtener tu ID
                                </small>
                            </div>
                            <div id="telegram-code-section" style="display:none;margin-bottom:1rem;">
                                <label for="telegram-code" style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">Código de Verificación</label>
                                <input type="text" id="telegram-code" name="telegram-code" placeholder="123456" maxlength="6"
                                       class="form-control" inputmode="numeric"
                                       style="font-size:1.5rem;text-align:center;letter-spacing:.5rem;">
                                <small style="color:#666;display:block;margin-top:.35rem;font-size:.8rem;">
                                    <i class="fas fa-info-circle"></i> Revisa tu Telegram, te enviamos un código
                                </small>
                            </div>
                            <button id="telegram-login-btn" onclick="CloudSyncModule.handleTelegramLogin()"
                                    style="width:100%;padding:1rem;background:linear-gradient(135deg,#2196F3,#1976D2);color:white;border:none;border-radius:8px;font-size:1rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.5rem;">
                                <i class="fab fa-telegram"></i> Continuar con Telegram
                            </button>
                        </div>

                        <!-- Email Form -->
                        <div class="login-form" id="email-form" style="display:none;">
                            <div style="margin-bottom:1rem;">
                                <label for="email-input" style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">Email</label>
                                <input type="email" id="email-input" name="email" placeholder="tu@email.com"
                                       class="form-control" inputmode="email" autocomplete="email"
                                       value="${Utils.escapeHtml(lastEmail)}">
                                <div id="email-error" style="color:#f44336;font-size:.8rem;margin-top:.25rem;display:none;"></div>
                            </div>
                            <div style="margin-bottom:.75rem;">
                                <label for="password-input" style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">Contraseña</label>
                                <div style="position:relative;">
                                    <input type="password" id="password-input" name="password" placeholder="••••••••"
                                           class="form-control" autocomplete="current-password"
                                           style="padding-right:3rem;">
                                    <button type="button" onclick="CloudSyncModule._togglePasswordVisibility()"
                                            style="position:absolute;right:.75rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#666;min-height:auto;padding:.25rem;">
                                        <i id="pwd-eye-icon" class="fas fa-eye"></i>
                                    </button>
                                </div>
                                <div id="password-error" style="color:#f44336;font-size:.8rem;margin-top:.25rem;display:none;"></div>
                            </div>

                            <!-- Mantener sesión -->
                            <label style="display:flex;align-items:center;gap:.5rem;margin-bottom:1rem;cursor:pointer;font-size:.9rem;">
                                <input type="checkbox" id="keep-session" style="width:16px;height:16px;min-height:auto;">
                                Mantener sesión iniciada
                            </label>

                            <!-- Botones login/register -->
                            <div id="login-buttons">
                                <button id="email-login-btn" onclick="CloudSyncModule.handleEmailLogin()"
                                        style="width:100%;padding:1rem;background:linear-gradient(135deg,#4CAF50,#388E3C);color:white;border:none;border-radius:8px;font-size:1rem;font-weight:700;cursor:pointer;margin-bottom:.75rem;display:flex;align-items:center;justify-content:center;gap:.5rem;">
                                    <i class="fas fa-sign-in-alt"></i> <span id="login-btn-text">Iniciar Sesión</span>
                                </button>
                                <button id="email-register-btn" onclick="CloudSyncModule.handleEmailRegister()"
                                        style="width:100%;padding:1rem;background:white;color:#4CAF50;border:2px solid #4CAF50;border-radius:8px;font-size:1rem;font-weight:700;cursor:pointer;display:none;align-items:center;justify-content:center;gap:.5rem;">
                                    <i class="fas fa-user-plus"></i> Crear Cuenta
                                </button>
                            </div>

                            <!-- Olvidé contraseña -->
                            <div id="forgot-section" style="text-align:center;margin-top:.75rem;">
                                <button onclick="CloudSyncModule._showForgotPassword()"
                                        style="background:none;border:none;color:#2196F3;cursor:pointer;font-size:.85rem;text-decoration:underline;min-height:auto;padding:.25rem;">
                                    ¿Olvidaste tu contraseña?
                                </button>
                            </div>
                        </div>

                        <!-- Mensaje de estado -->
                        <div id="login-message" style="margin-top:1rem;padding:1rem;border-radius:8px;display:none;font-size:.9rem;"></div>
                    </div>

                    <!-- Footer -->
                    <div style="padding:.75rem 1.5rem;background:#f9f9f9;border-top:1px solid #eee;text-align:center;">
                        <small style="color:#999;font-size:.75rem;">
                            <i class="fas fa-lock"></i> Tus datos se guardan cifrados localmente
                        </small>
                    </div>
                </div>
            </div>
        `;
    },
    
    renderSyncPage() {
        const user = window.AuthManager.user;
        const business = window.AuthManager.business;
        const isAdmin = (typeof Perm !== 'undefined') ? Perm.can('users.manage') : ['super_admin', 'admin'].includes(user.role);
        
        return `
            <div class="page-header">
                <h1><i class="fas fa-cloud"></i> Sincronización en la Nube</h1>
                <p>Conectado como ${Utils.escapeHtml(user.name)}</p>
            </div>
            
            <div style="max-width: 1000px; margin: 2rem auto;">
                <!-- Tabs de navegacion -->
                <div class="tabs-bar" style="margin-bottom: 2rem; border-bottom: 2px solid #eee; background: white; padding: 1rem; border-radius: 12px 12px 0 0;">
                    <button class="sync-tab active" onclick="CloudSyncModule.switchSyncTab('account')" style="padding: 0.75rem 1.25rem; border: none; background: none; cursor: pointer; border-bottom: 3px solid #2196F3; color: #2196F3; font-weight: bold;">
                        <i class="fas fa-user"></i> Mi Cuenta
                    </button>
                    ${isAdmin ? `
                    <button class="sync-tab" onclick="CloudSyncModule.switchSyncTab('users')" style="padding: 0.75rem 1.25rem; border: none; background: none; cursor: pointer; border-bottom: 3px solid transparent; color: #666;">
                        <i class="fas fa-users"></i> Usuarios
                    </button>
                    <button class="sync-tab" onclick="CloudSyncModule.switchSyncTab('invitations')" style="padding: 0.75rem 1.25rem; border: none; background: none; cursor: pointer; border-bottom: 3px solid transparent; color: #666;">
                        <i class="fas fa-ticket-alt"></i> Invitaciones
                    </button>
                    ` : ''}
                </div>
                
                <!-- Tab: Mi Cuenta -->
                <div class="sync-tab-content" id="account-tab" style="background: white; padding: 2rem; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <div style="text-align: center; margin-bottom: 2rem;">
                        <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #4CAF50, #388E3C); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem;">
                            <i class="fas fa-check" style="font-size: 2.5rem; color: white;"></i>
                        </div>
                        <h2 style="margin: 0 0 0.5rem 0; color: #4CAF50;">¡Conectado!</h2>
                        <p style="color: #666; margin: 0;">${Utils.escapeHtml(business.name)}</p>
                    </div>
                    
                    <div style="display: grid; gap: 1rem; margin-bottom: 2rem;">
                        <div style="padding: 1.5rem; background: #f5f5f5; border-radius: 8px;">
                            <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
                                <i class="fas fa-user-circle" style="font-size: 2rem; color: #2196F3;"></i>
                                <div style="flex: 1; min-width: 0;">
                                    <div style="font-weight: bold; overflow: hidden; text-overflow: ellipsis;">${Utils.escapeHtml(user.name)}</div>
                                    <div style="color: #666; font-size: 0.9rem;">${Utils.escapeHtml(this.getRoleLabel(user.role))}</div>
                                </div>
                            </div>
                        </div>
                        
                        <div style="padding: 1.5rem; background: #f5f5f5; border-radius: 8px;">
                            <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
                                <i class="fas fa-sync" style="font-size: 2rem; color: #4CAF50;"></i>
                                <div style="flex: 1; min-width: 0;">
                                    <div style="font-weight: bold;">Sincronización Automática</div>
                                    <div style="color: #666; font-size: 0.9rem;">Activa - Tiempo real</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div style="display: grid; gap: 1rem;">
                        <button onclick="CloudSyncModule.syncNow()" style="padding: 1rem; background: linear-gradient(135deg, #2196F3, #1976D2); color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">
                            <i class="fas fa-sync"></i> Sincronizar Ahora
                        </button>
                        
                        <button onclick="CloudSyncModule.logout()" style="padding: 1rem; background: white; color: #f44336; border: 2px solid #f44336; border-radius: 8px; font-weight: bold; cursor: pointer;">
                            <i class="fas fa-sign-out-alt"></i> Cerrar Sesión
                        </button>
                    </div>
                </div>
                
                ${isAdmin ? `
                <!-- Tab: Usuarios -->
                <div class="sync-tab-content" id="users-tab" style="display: none; background: white; padding: 2rem; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: .5rem;">
                        <h2 style="margin: 0;"><i class="fas fa-users"></i> Usuarios del Negocio</h2>
                        <button onclick="CloudSyncModule.loadUsers()" style="padding: 0.5rem 1rem; background: #2196F3; color: white; border: none; border-radius: 6px; cursor: pointer;">
                            <i class="fas fa-sync"></i> Recargar
                        </button>
                    </div>
                    <div id="users-list">
                        <div style="text-align: center; padding: 2rem; color: #666;">
                            <i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i>
                            <p>Cargando usuarios...</p>
                        </div>
                    </div>
                </div>
                
                <!-- Tab: Invitaciones -->
                <div class="sync-tab-content" id="invitations-tab" style="display: none; background: white; padding: 2rem; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-wrap: wrap; gap: .5rem;">
                        <h2 style="margin: 0;"><i class="fas fa-ticket-alt"></i> Códigos de Invitación</h2>
                        <button onclick="CloudSyncModule.showCreateInvitation()" style="padding: 0.5rem 1rem; background: #4CAF50; color: white; border: none; border-radius: 6px; cursor: pointer;">
                            <i class="fas fa-plus"></i> Crear Código
                        </button>
                    </div>
                    <div id="invitations-list">
                        <div style="text-align: center; padding: 2rem; color: #666;">
                            <p>Crea códigos de invitación para agregar nuevos usuarios</p>
                        </div>
                    </div>
                </div>
                ` : ''}
            </div>
        `;
    },
    
    async init() {
        // AuthManager y SyncEngine ya estan inicializados globalmente en App.init()
        // Solo verificar estado
        if (window.AuthManager.isAuthenticated()) {
            console.log('✅ Sesion activa en CloudSync');
        } else {
            console.log('ℹ️ No hay sesion en CloudSync');
        }
    },
    
    switchTab(tabName) {
        // Actualizar estilos de tabs (segmented control del nuevo login)
        const segTelegram = document.getElementById('seg-telegram');
        const segEmail = document.getElementById('seg-email');
        if (segTelegram && segEmail) {
            if (tabName === 'telegram') {
                segTelegram.style.background = 'white';
                segTelegram.style.boxShadow = '0 1px 4px rgba(0,0,0,.1)';
                segEmail.style.background = 'none';
                segEmail.style.boxShadow = 'none';
            } else {
                segEmail.style.background = 'white';
                segEmail.style.boxShadow = '0 1px 4px rgba(0,0,0,.1)';
                segTelegram.style.background = 'none';
                segTelegram.style.boxShadow = 'none';
            }
        }
        // Mostrar formulario correspondiente
        document.querySelectorAll('.login-form').forEach(form => {
            form.style.display = 'none';
        });
        const targetForm = document.getElementById(`${tabName}-form`);
        if (targetForm) {
            targetForm.style.display = 'block';
        }
    },

    /** Alterna entre modo login y modo registro */
    _switchLoginMode(mode) {
        const tabLogin = document.getElementById('tab-login');
        const tabRegister = document.getElementById('tab-register');
        const loginBtn = document.getElementById('email-login-btn');
        const registerBtn = document.getElementById('email-register-btn');
        const forgotSection = document.getElementById('forgot-section');
        const loginBtnText = document.getElementById('login-btn-text');

        if (mode === 'register') {
            if (tabLogin) { tabLogin.style.color = '#999'; tabLogin.style.borderBottom = '3px solid transparent'; }
            if (tabRegister) { tabRegister.style.color = '#4CAF50'; tabRegister.style.borderBottom = '3px solid #4CAF50'; }
            if (loginBtn) loginBtn.style.display = 'none';
            if (registerBtn) registerBtn.style.display = 'flex';
            if (forgotSection) forgotSection.style.display = 'none';
        } else {
            if (tabLogin) { tabLogin.style.color = '#4CAF50'; tabLogin.style.borderBottom = '3px solid #4CAF50'; }
            if (tabRegister) { tabRegister.style.color = '#999'; tabRegister.style.borderBottom = '3px solid transparent'; }
            if (loginBtn) loginBtn.style.display = 'flex';
            if (registerBtn) registerBtn.style.display = 'none';
            if (forgotSection) forgotSection.style.display = 'block';
        }
        // Asegurar que el tab email esté visible
        this.switchTab('email');
    },

    /** Muestra/oculta la contraseña */
    _togglePasswordVisibility() {
        const input = document.getElementById('password-input');
        const icon = document.getElementById('pwd-eye-icon');
        if (!input) return;
        if (input.type === 'password') {
            input.type = 'text';
            if (icon) { icon.classList.remove('fa-eye'); icon.classList.add('fa-eye-slash'); }
        } else {
            input.type = 'password';
            if (icon) { icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye'); }
        }
    },

    /** Muestra el modal de recuperación de contraseña */
    _showForgotPassword() {
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:400px;">
                <div class="modal-header">
                    <h3><i class="fas fa-key"></i> Recuperar contraseña</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" style="padding:1.5rem;">
                    <p style="margin-bottom:1rem;color:#666;font-size:.9rem;">
                        Ingresa tu email y te enviaremos un enlace de recuperación a tu Telegram o email.
                    </p>
                    <div class="form-group">
                        <label for="forgot-email" style="font-weight:600;font-size:.9rem;">Email</label>
                        <input type="email" id="forgot-email" class="form-control" placeholder="tu@email.com" inputmode="email" autocomplete="email" style="margin-top:.4rem;">
                    </div>
                    <div id="forgot-msg" style="margin-top:.75rem;font-size:.85rem;display:none;"></div>
                    <button onclick="CloudSyncModule._submitForgotPassword()"
                            style="width:100%;margin-top:1rem;padding:1rem;background:linear-gradient(135deg,#2196F3,#1976D2);color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer;">
                        <i class="fas fa-paper-plane"></i> Enviar enlace
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        setTimeout(() => { const el = document.getElementById('forgot-email'); if (el) el.focus(); }, 100);
    },

    async _submitForgotPassword() {
        const email = (document.getElementById('forgot-email') || {}).value || '';
        const msgEl = document.getElementById('forgot-msg');
        if (!email || !email.includes('@')) {
            if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = '#f44336'; msgEl.textContent = 'Ingresa un email válido.'; }
            return;
        }
        try {
            await window.AuthManager.forgotPassword(email);
            if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = '#4CAF50'; msgEl.textContent = 'Si el email existe, recibirás un enlace en breve.'; }
        } catch(e) {
            if (msgEl) { msgEl.style.display = 'block'; msgEl.style.color = '#f44336'; msgEl.textContent = e.message || 'Error al enviar.'; }
        }
    },
    
    async handleTelegramLogin() {
        const telegramId = document.getElementById('telegram-id').value.trim();
        const codeSection = document.getElementById('telegram-code-section');
        const codeInput = document.getElementById('telegram-code');
        const btn = document.getElementById('telegram-login-btn');
        
        if (!telegramId) {
            this.showMessage('Por favor ingresa tu ID de Telegram', 'error');
            return;
        }
        
        // Si ya se mostro el codigo, verificar
        if (codeSection.style.display !== 'none') {
            const code = codeInput.value.trim();
            if (!code || code.length !== 6) {
                this.showMessage('Ingresa el codigo de 6 digitos', 'error');
                return;
            }
            
            try {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
                
                const result = await window.AuthManager.verifyTelegramCode(telegramId, code);
                
                if (result.success) {
                    this.showMessage('Login exitoso! Recargando...', 'success');
                    setTimeout(() => App.loadPage('cloud-sync'), 1000);
                }
            } catch (error) {
                this.showMessage(error.message, 'error');
                btn.disabled = false;
                btn.innerHTML = '<i class="fab fa-telegram"></i> Verificar Codigo';
            }
            return;
        }
        
        // Solicitar codigo
        try {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando codigo...';
            
            await window.AuthManager.loginWithTelegram(telegramId);
            
            codeSection.style.display = 'block';
            btn.innerHTML = '<i class="fab fa-telegram"></i> Verificar Codigo';
            btn.disabled = false;
            codeInput.focus();
            
            this.showMessage('Codigo enviado a tu Telegram', 'success');
        } catch (error) {
            this.showMessage(error.message, 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="fab fa-telegram"></i> Continuar con Telegram';
        }
    },
    
    async handleEmailLogin() {
        const email = document.getElementById('email-input').value.trim();
        const password = document.getElementById('password-input').value;
        const keepSession = document.getElementById('keep-session')?.checked !== false;

        if (!email || !password) {
            this.showMessage('Completa todos los campos', 'error');
            return;
        }

        const btn = document.getElementById('email-login-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Iniciando...'; }

        try {
            const result = await window.AuthManager.loginWithEmail(email, password, keepSession);
            if (result.success) {
                // Persistir email para autocompletar en próximos accesos
                localStorage.setItem('galloli_last_email', email);
                this.showMessage('¡Sesión iniciada! Cargando...', 'success');
                setTimeout(() => App.loadPage('cloud-sync'), 800);
            }
        } catch (error) {
            this.showMessage(error.message, 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> <span id="login-btn-text">Iniciar Sesión</span>'; }
        }
    },
    
    async handleEmailRegister() {
        const email = document.getElementById('email-input').value.trim();
        const password = document.getElementById('password-input').value;
        const nameInput = document.getElementById('register-name');
        const inviteInput = document.getElementById('register-invite');
        const name = nameInput ? nameInput.value.trim() : '';
        const invitationCode = inviteInput ? inviteInput.value.trim() : '';

        if (!email || !password) {
            this.showMessage('Completa email y contraseña', 'error');
            return;
        }
        if (password.length < 6) {
            this.showMessage('La contraseña debe tener al menos 6 caracteres', 'error');
            return;
        }

        // Si no hay campos de nombre/invitación en el DOM, mostrar el formulario extendido
        if (!nameInput) {
            this._showRegisterExtendedFields();
            return;
        }
        if (!name) {
            this.showMessage('Ingresa tu nombre', 'error');
            return;
        }

        const btn = document.getElementById('email-register-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando cuenta...'; }

        try {
            let result;
            if (invitationCode) {
                // Registro con código de invitación → se une al negocio del dueño
                result = await window.AuthManager.registerWithInvitation(email, password, name, invitationCode);
            } else {
                // Registro normal → crea nuevo negocio
                result = await window.AuthManager.registerWithEmail(email, password, name);
            }
            if (result.success) {
                localStorage.setItem('galloli_last_email', email);
                this.showMessage('¡Cuenta creada! Cargando...', 'success');
                setTimeout(() => App.loadPage('cloud-sync'), 800);
            }
        } catch (error) {
            this.showMessage(error.message, 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus"></i> Crear Cuenta'; }
        }
    },

    /** Muestra los campos adicionales de registro (nombre + código de invitación) */
    _showRegisterExtendedFields() {
        const loginButtons = document.getElementById('login-buttons');
        if (!loginButtons) return;

        // Insertar campos antes de los botones
        const fieldsHtml = `
            <div id="register-extra-fields" style="margin-bottom:1rem;">
                <div class="form-group" style="margin-bottom:.75rem;">
                    <label for="register-name" style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">Tu nombre</label>
                    <input type="text" id="register-name" name="register-name" class="form-control"
                           placeholder="Ej: Juan Pérez" autocomplete="name">
                    <div id="name-error" style="color:#f44336;font-size:.8rem;margin-top:.25rem;display:none;"></div>
                </div>
                <div class="form-group" style="margin-bottom:.75rem;">
                    <label for="register-invite" style="display:block;margin-bottom:.4rem;font-weight:600;font-size:.9rem;">
                        Código de invitación <span style="color:#999;font-weight:400;">(opcional)</span>
                    </label>
                    <input type="text" id="register-invite" name="register-invite" class="form-control"
                           placeholder="Ej: ABC12345" autocomplete="off" maxlength="20"
                           style="text-transform:uppercase;letter-spacing:.1rem;">
                    <small style="color:#666;font-size:.78rem;display:block;margin-top:.3rem;">
                        <i class="fas fa-info-circle"></i> Si tienes un código, te unirás al negocio de tu empleador.
                        Sin código, se crea un negocio nuevo.
                    </small>
                </div>
            </div>
        `;
        loginButtons.insertAdjacentHTML('beforebegin', fieldsHtml);
        document.getElementById('register-name')?.focus();
    },
    
    async syncNow() {
        try {
            Utils.showLoading(true);
            await window.SyncEngine.smartSync();
            Utils.showLoading(false);
            Utils.showNotification('Sincronizacion completada', 'success', 3000);
        } catch (error) {
            Utils.showLoading(false);
            Utils.showNotification('Error: ' + error.message, 'error', 3000);
        }
    },
    
    switchSyncTab(tabName) {
        // Actualizar tabs
        document.querySelectorAll('.sync-tab').forEach(tab => {
            tab.classList.remove('active');
            tab.style.borderBottom = '3px solid transparent';
            tab.style.color = '#666';
        });
        
        const activeTab = event.target.closest('.sync-tab');
        if (activeTab) {
            activeTab.classList.add('active');
            activeTab.style.borderBottom = '3px solid #2196F3';
            activeTab.style.color = '#2196F3';
        }
        
        // Mostrar contenido
        document.querySelectorAll('.sync-tab-content').forEach(content => {
            content.style.display = 'none';
        });
        
        const targetContent = document.getElementById(`${tabName}-tab`);
        if (targetContent) {
            targetContent.style.display = 'block';
        }
        
        // Cargar datos si es necesario
        if (tabName === 'users') {
            this.loadUsers();
        }
    },
    
    async loadUsers() {
        const listDiv = document.getElementById('users-list');
        if (!listDiv) return;
        
        listDiv.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fas fa-spinner fa-spin" style="font-size: 2rem;"></i></div>';
        
        try {
            const response = await fetch('https://galloli-sync.ivanbj-96.workers.dev/api/users', {
                headers: window.AuthManager.getAuthHeaders()
            });
            
            if (!response.ok) throw new Error('Error cargando usuarios');
            
            const data = await response.json();
            const users = data.users || [];
            
            if (users.length === 0) {
                listDiv.innerHTML = '<div style="text-align: center; padding: 2rem; color: #666;">No hay usuarios</div>';
                return;
            }
            
            listDiv.innerHTML = users.map(u => `
                <div style="padding: 1.5rem; background: ${u.is_active ? '#f5f5f5' : '#ffebee'}; border-radius: 8px; margin-bottom: 1rem;">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <div style="flex: 1;">
                            <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.5rem;">
                                <i class="fas fa-user-circle" style="font-size: 2rem; color: ${u.is_active ? '#2196F3' : '#999'};"></i>
                                <div>
                                    <div style="font-weight: bold; ${u.is_active ? '' : 'text-decoration: line-through;'}">${Utils.escapeHtml(u.name)}</div>
                                    <div style="color: #666; font-size: 0.9rem;">${this.getRoleLabel(u.role)}</div>
                                </div>
                            </div>
                            <div style="font-size: 0.85rem; color: #666;">
                                ${u.email ? `<i class="fas fa-envelope"></i> ${Utils.escapeHtml(u.email)}` : ''}
                                ${u.telegram_username ? `<i class="fab fa-telegram"></i> @${Utils.escapeHtml(u.telegram_username)}` : ''}
                            </div>
                            <div style="font-size: 0.85rem; color: #999; margin-top: 0.25rem;">
                                <i class="fas fa-clock"></i> ultima actividad: ${u.last_seen ? new Date(u.last_seen).toLocaleString('es-ES') : 'Nunca'}
                            </div>
                        </div>
                        ${u.id !== window.AuthManager.user.id && u.role !== 'super_admin' ? `
                        <div style="display: flex; gap: 0.5rem;">
                            <button onclick="CloudSyncModule.changeUserRole('${u.id}', this.dataset.name)" data-name="${Utils.escapeHtml(u.name)}" style="padding: 0.5rem 1rem; background: #2196F3; color: white; border: none; border-radius: 6px; cursor: pointer;">
                                <i class="fas fa-user-tag"></i> Cambiar Rol
                            </button>
                            ${u.is_active ? `
                            <button onclick="CloudSyncModule.deactivateUser('${u.id}', this.dataset.name)" data-name="${Utils.escapeHtml(u.name)}" style="padding: 0.5rem 1rem; background: #f44336; color: white; border: none; border-radius: 6px; cursor: pointer;">
                                <i class="fas fa-ban"></i> Desactivar
                            </button>
                            ` : `
                            <button onclick="CloudSyncModule.activateUser('${u.id}', this.dataset.name)" data-name="${Utils.escapeHtml(u.name)}" style="padding: 0.5rem 1rem; background: #4CAF50; color: white; border: none; border-radius: 6px; cursor: pointer;">
                                <i class="fas fa-check"></i> Activar
                            </button>
                            `}
                        </div>
                        ` : ''}
                    </div>
                </div>
            `).join('');
            
        } catch (error) {
            listDiv.innerHTML = `<div style="text-align: center; padding: 2rem; color: #f44336;">Error: ${error.message}</div>`;
        }
    },
    
    async changeUserRole(userId, userName) {
        const roles = [
            { value: 'admin', label: 'Administrador' },
            { value: 'vendedor', label: 'Vendedor' },
            { value: 'repartidor', label: 'Repartidor' },
            { value: 'contador', label: 'Contador' },
            { value: 'viewer', label: 'Visor (Solo lectura)' }
        ];
        
        const roleOptions = roles.map(r => `<option value="${r.value}">${r.label}</option>`).join('');
        
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 400px;">
                <div class="modal-header">
                    <h3><i class="fas fa-user-tag"></i> Cambiar Rol</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 1rem;">Usuario: <strong>${userName}</strong></p>
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Nuevo Rol:</label>
                    <select id="new-role" style="width: 100%; padding: 0.75rem; border: 2px solid #ddd; border-radius: 8px; font-size: 1rem; margin-bottom: 1rem;">
                        ${roleOptions}
                    </select>
                    <button onclick="CloudSyncModule.saveUserRole('${userId}')" style="width: 100%; padding: 1rem; background: #2196F3; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">
                        <i class="fas fa-save"></i> Guardar Cambios
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },
    
    async saveUserRole(userId) {
        const newRole = document.getElementById('new-role').value;
        
        try {
            const response = await fetch(`https://galloli-sync.ivanbj-96.workers.dev/api/users/${userId}`, {
                method: 'PUT',
                headers: window.AuthManager.getAuthHeaders(),
                body: JSON.stringify({ role: newRole })
            });
            
            if (!response.ok) throw new Error('Error actualizando rol');
            
            document.querySelector('.modal').remove();
            Utils.showNotification('Rol actualizado correctamente', 'success', 3000);
            this.loadUsers();
        } catch (error) {
            Utils.showNotification('Error: ' + error.message, 'error', 3000);
        }
    },
    
    async deactivateUser(userId, userName) {
        if (!confirm(`Desactivar a ${userName}?\n\nNo podra acceder al sistema hasta que lo reactives.`)) return;
        
        try {
            const response = await fetch(`https://galloli-sync.ivanbj-96.workers.dev/api/users/${userId}`, {
                method: 'DELETE',
                headers: window.AuthManager.getAuthHeaders()
            });
            
            if (!response.ok) throw new Error('Error desactivando usuario');
            
            Utils.showNotification('Usuario desactivado', 'success', 3000);
            this.loadUsers();
        } catch (error) {
            Utils.showNotification('Error: ' + error.message, 'error', 3000);
        }
    },
    
    async activateUser(userId, userName) {
        try {
            const response = await fetch(`https://galloli-sync.ivanbj-96.workers.dev/api/users/${userId}`, {
                method: 'PUT',
                headers: window.AuthManager.getAuthHeaders(),
                body: JSON.stringify({ is_active: 1 })
            });
            
            if (!response.ok) throw new Error('Error activando usuario');
            
            Utils.showNotification('Usuario activado', 'success', 3000);
            this.loadUsers();
        } catch (error) {
            Utils.showNotification('Error: ' + error.message, 'error', 3000);
        }
    },
    
    showCreateInvitation() {
        const roles = [
            { value: 'admin', label: 'Administrador' },
            { value: 'vendedor', label: 'Vendedor' },
            { value: 'repartidor', label: 'Repartidor' },
            { value: 'contador', label: 'Contador' },
            { value: 'viewer', label: 'Visor (Solo lectura)' }
        ];
        
        const roleOptions = roles.map(r => `<option value="${r.value}">${r.label}</option>`).join('');
        
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3><i class="fas fa-ticket-alt"></i> Crear Codigo de Invitacion</h3>
                    <button class="close-modal" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Rol del Usuario:</label>
                        <select id="invitation-role" style="width: 100%; padding: 0.75rem; border: 2px solid #ddd; border-radius: 8px; font-size: 1rem;">
                            ${roleOptions}
                        </select>
                    </div>
                    
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Usos Máximos:</label>
                        <input type="number" id="invitation-max-uses" value="1" min="1" max="100" style="width: 100%; padding: 0.75rem; border: 2px solid #ddd; border-radius: 8px; font-size: 1rem;">
                    </div>
                    
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Expira en (horas):</label>
                        <input type="number" id="invitation-expires" value="24" min="1" max="720" style="width: 100%; padding: 0.75rem; border: 2px solid #ddd; border-radius: 8px; font-size: 1rem;">
                        <small style="color: #666; display: block; margin-top: 0.5rem;">Dejar vacio para que no expire</small>
                    </div>
                    
                    <button onclick="CloudSyncModule.createInvitation()" style="width: 100%; padding: 1rem; background: #4CAF50; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">
                        <i class="fas fa-plus"></i> Generar Codigo
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },
    
    async createInvitation() {
        const role = document.getElementById('invitation-role').value;
        const maxUses = parseInt(document.getElementById('invitation-max-uses').value);
        const expiresIn = parseInt(document.getElementById('invitation-expires').value) || null;
        
        try {
            const response = await fetch('https://galloli-sync.ivanbj-96.workers.dev/api/business/invitation', {
                method: 'POST',
                headers: window.AuthManager.getAuthHeaders(),
                body: JSON.stringify({
                    role,
                    max_uses: maxUses,
                    expires_in_hours: expiresIn
                })
            });
            
            if (!response.ok) throw new Error('Error creando codigo');
            
            const data = await response.json();
            
            document.querySelector('.modal').remove();
            
            // Mostrar codigo generado
            const codeModal = document.createElement('div');
            codeModal.className = 'modal active';
            codeModal.innerHTML = `
                <div class="modal-content" style="max-width: 500px;">
                    <div class="modal-header" style="background: #4CAF50; color: white;">
                        <h3><i class="fas fa-check-circle"></i> Codigo Generado</h3>
                        <button class="close-modal" onclick="this.closest('.modal').remove()" style="color: white;">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body" style="text-align: center;">
                        <p style="margin-bottom: 1rem;">Comparte este codigo con el nuevo usuario:</p>
                        <div style="padding: 1.5rem; background: #f5f5f5; border-radius: 8px; margin-bottom: 1rem;">
                            <div style="font-size: 2rem; font-weight: bold; letter-spacing: 0.5rem; color: #4CAF50;">${data.code}</div>
                        </div>
                        <p style="color: #666; font-size: 0.9rem; margin-bottom: 1rem;">
                            Rol: <strong>${this.getRoleLabel(data.role)}</strong><br>
                            Usos: <strong>${data.max_uses}</strong><br>
                            ${data.expires_at ? `Expira: <strong>${new Date(data.expires_at).toLocaleString('es-ES')}</strong>` : 'Sin expiración'}
                        </p>
                        <button onclick="navigator.clipboard.writeText('${data.code}'); alert('Codigo copiado')" style="padding: 1rem; background: #2196F3; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; width: 100%;">
                            <i class="fas fa-copy"></i> Copiar Codigo
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(codeModal);
            
        } catch (error) {
            Utils.showNotification('Error: ' + error.message, 'error', 3000);
        }
    },
    
    getRoleLabel(role) {
        const labels = {
            'super_admin': '👑 Super Administrador',
            'admin': '🛡️ Administrador',
            'vendedor': '🛒 Vendedor',
            'repartidor': '🚚 Repartidor',
            'contador': '📊 Contador',
            'viewer': '👁️ Visor'
        };
        return labels[role] || role;
    },
    
    async showInvitationCode() {
        this.showCreateInvitation();
    },
    
    async logout() {
        if (confirm('Cerrar sesion?')) {
            await window.AuthManager.logout();
            App.loadPage('cloud-sync');
        }
    },
    
    showMessage(message, type) {
        const msgDiv = document.getElementById('login-message');
        if (!msgDiv) return; // El elemento no existe si no estamos en la pagina de login
        msgDiv.textContent = message;
        msgDiv.style.display = 'block';
        msgDiv.style.background = type === 'error' ? '#ffebee' : '#e8f5e9';
        msgDiv.style.color = type === 'error' ? '#c62828' : '#2e7d32';
        msgDiv.style.border = `2px solid ${type === 'error' ? '#ef5350' : '#66bb6a'}`;
    }
};


// Exportar modulos a window para que SyncEngine pueda interceptarlos
window.ClientsModule = ClientsModule;
window.SalesModule = SalesModule;
window.OrdersModule = OrdersModule;
window.AccountingModule = AccountingModule;
window.MermaModule = MermaModule;
window.DiezmosModule = DiezmosModule;
window.PaymentHistoryModule = PaymentHistoryModule;
window.ConfigModule = ConfigModule;
window.StatsModule = StatsModule;
window.RutasModule = RutasModule;
window.ReportsModule = ReportsModule;
window.MapModule = MapModule;
window.CloudSyncModule = CloudSyncModule;

