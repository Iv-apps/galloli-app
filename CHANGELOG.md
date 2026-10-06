# Changelog — GallOli

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
El versionado se hace por `APP_VERSION` en `sw.js`, replicado en `version.json` y `package.json`.
El historial completo está en `git log`.

> Nota: la rama `apk-native` (APK nativo de producción) lleva su propio historial de cambios;
> los arreglos comunes se aplican en las dos ramas por separado.

## [7.20.46] — 2026-10-05

Auditoría de la PWA/TWA (rama `main`). Correcciones:

### Corregido — errores que rompían pantalla o funciones
- **Botones muertos en Rutas**: `RutasModule.generarRutaOptima()` y `RutasModule.limpiarMapa()`
  eran llamados por la UI pero no existían (`TypeError` al pulsarlos). Se implementaron
  (ruta ordenada por proximidad, línea de recorrido, `fitBounds`, limpieza de capas).
- **Mapa de rutas siempre vacío**: `RutasModule.cargarRutasEnMapa()` llamaba a
  `ClientsModule.getClient()`, que no existe; ahora usa `getClientById()`.
- **Modal "Actualización Disponible" en la primera visita**: el Service Worker avisaba de
  "nueva versión" también en la instalación inicial. Ahora solo avisa si existía un cache
  anterior (`isUpdate`), y `js/sw-update.js` ignora el mensaje si no es una actualización real.

### Corregido — seguridad
- **Token de Cloudflare en texto plano** en `.github/README.md`: eliminado del archivo.
  **Acción pendiente del dueño: rotar ese token en el dashboard de Cloudflare**, porque sigue
  en el historial de git.
- **Escapado HTML (`Utils.escapeHtml`)**: se añadió el helper a `js/utils.js` y se aplicaron
  58 interpolaciones de datos de usuario (nombres, teléfonos, direcciones, notas, emails,
  descripciones de gastos) que se insertaban crudas en `innerHTML`. Los botones de la lista de
  usuarios pasan el nombre por `data-name` en lugar de interpolarse dentro del `onclick`.
- **Cola offline**: los HTTP 401/403 ya no se reintentan 5 veces; el cambio pasa a
  `dead-letter` y se avisa al usuario.

### Corregido — caracteres
- Mojibake con `x` en lugar de vocal acentuada: `automxtico/a`, `automxticamente`, `mxximo`,
  `mxs` -> `más`, `pxgina`, `estx` -> `está`, `estxn` -> `están`, `invxlido`, `vxlida`,
  `eliminarxn`, `serxn`, `maximo` (en `app.js`, `modules.js`, `auth.js`, `auto-backup.js`,
  `sync-engine.js`, `utils.js`).
- Emojis corruptos (`??`) en etiquetas de rol (ahora `👑 Super Administrador`,
  `🛡️ Administrador`, `🛒 Vendedor`, `🚚 Repartidor`, `📊 Contador`, `👁️ Visor`), en el texto
  del mensaje de Telegram y en los `console.log`. El caption del backup automático queda sin
  emojis ni tildes para no volver a romper el encoding.
- Tildes faltantes en textos de UI: `Sin expiración`, `Usos Máximos`, `Conexión exitosa`.

### Documentación
- `README.md` reescrito con el estado real del proyecto (versión, apps por rama, estructura,
  deploy, reglas de desarrollo, tablas D1 reales).
- `CHANGELOG.md` creado.

### Notas de despliegue de esta versión
- **PWA/TWA**: `wrangler pages deploy . --project-name=galloli --branch=main` desde `main` con
  todo commiteado.
- **TWA (AAB)**: no cambian permisos ni configuración nativa -> no hace falta recompilar el AAB;
  el cambio entra solo con el deploy de Pages, porque el TWA carga el sitio.
- **APK**: `git push origin main` dispara `build-android.yml`.

## [7.20.45] — 2026-07-30
- `deleteOrder` y `deleteExpense` notifican al servidor con `action=delete`;
  `handleRemoteDeletion` aplica bajas de `orders` y `expenses`.
- `version.json` para que la PWA detecte versiones nuevas.
- Repositorio movido a `Iv-apps/galloli-app`.

## [7.20.40] — 2026-06-03
- Fix ventas eliminadas que "resucitaban": `deleteSale` notifica `action=delete` y
  `syncPendingDeletions` se ejecuta al iniciar.

## [7.20.39] — 2026-05-09
- Fix `CustomSelect` no encontrado, inputs sin `name`, `destroy` robusto.

Versiones anteriores: ver `git log --oneline`.
