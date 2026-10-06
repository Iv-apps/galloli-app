// js/permissions.js — Sistema central de permisos GallOli
// Cargado después de auth.js y antes de modules.js/app.js
(function () {
    'use strict';

    const MATRIX = {
        super_admin: '*',
        admin: [
            'sales.create', 'sales.edit', 'sales.delete',
            'clients.crud', 'products.crud', 'prices.edit', 'expenses.crud', 'expenses.delete',
            'merma.create', 'routes.assign', 'routes.execute', 'orders.manage',
            'reports.view', 'users.manage', 'invitations.create',
            'auto-sale.engine', 'sri.facturar', 'config.business'
        ],
        vendedor: [
            'sales.create', 'sales.edit', 'clients.crud',
            'merma.create', 'routes.execute', 'orders.manage', 'auto-sale.engine'
        ],
        repartidor: [
            'sales.create', 'routes.execute', 'orders.manage'
        ],
        contador: [
            'expenses.crud', 'reports.view', 'sri.facturar'
        ],
        viewer: [
            'reports.view'
        ]
    };

    /** Devuelve el rol del usuario autenticado actual */
    function role() {
        return (window.AuthManager &&
                window.AuthManager.user &&
                window.AuthManager.user.role) || 'viewer';
    }

    /** Devuelve true si el usuario actual tiene el permiso indicado */
    function can(perm) {
        const r = role();
        const list = MATRIX[r];
        if (!list) return false;
        if (list === '*') return true;
        return Array.isArray(list) && list.includes(perm);
    }

    /**
     * Lanza un error y muestra toast si el usuario NO tiene el permiso.
     * Usar al inicio de cada handler crítico.
     */
    function require(perm) {
        if (!can(perm)) {
            if (window.Utils && Utils.showNotification) {
                Utils.showNotification('No tienes permiso para esta acción', 'error', 3000);
            }
            throw new Error('PERM_DENIED:' + perm);
        }
    }

    /**
     * Oculta elementos del DOM que tengan data-perm si el usuario no tiene ese permiso.
     * Llamar después de inyectar cualquier modal o cambiar de ruta.
     * @param {Element|Document} root - Raíz donde buscar (default: document)
     */
    function applyDom(root) {
        root = root || document;
        root.querySelectorAll('[data-perm]').forEach(function (el) {
            var need = el.getAttribute('data-perm');
            el.style.display = can(need) ? '' : 'none';
        });
    }

    // Exponer ANTES del listener para que applyDom esté disponible dentro del callback
    window.Perm = { can: can, require: require, applyDom: applyDom, role: role };

    // Aplicar al cargar el DOM
    document.addEventListener('DOMContentLoaded', function () {
        window.Perm.applyDom(document);
    });
})();
