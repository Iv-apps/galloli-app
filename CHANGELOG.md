# Changelog — GallOli

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
El versionado se hace por `APP_VERSION` en `sw.js`, replicado en `version.json` y `package.json`.
El historial completo y detallado está en `git log`.

## [7.20.46] — 2026-10-05

Auditoría completa del APK nativo (`apk-native`) y de la PWA/TWA (`main`). Correcciones:

### Corregido — errores que rompían pantalla o funciones
- **`Perm.applyDom is not a function` en cada carga**: `js/utils.js` declaraba un segundo
  `const Perm` global que tapaba a `window.Perm` de `js/permissions.js`. Quedó **una sola**
  implementación (la de `permissions.js`, con `can/require/applyDom/role`) y el listener usa
  `window.Perm` explícitamente.
- **Botones muertos en Rutas**: `RutasModule.generarRutaOptima()` y `RutasModule.limpiarMapa()`
  eran llamados por la UI pero no existían (`TypeError` al pulsarlos). Se implementaron
  (ruta ordenada por proximidad, línea de recorrido, `fitBounds`, limpieza de capas).
- **Mapa de rutas siempre vacío**: `RutasModule.cargarRutasEnMapa()` llamaba a
  `ClientsModule.getClient()`, que no existe; ahora usa `getClientById()`.
- **Permiso inexistente `expenses.delete`**: la UI lo consultaba pero no estaba en la matriz,
  así que un `admin` no podía borrar gastos. Añadido en `js/permissions.js` y en el Worker.
- **Modal "Actualización Disponible" en la primera visita**: el Service Worker avisaba de
  "nueva versión" también en la instalación inicial. Ahora solo avisa si existía un cache
  anterior (`isUpdate`), y `js/sw-update.js` ignora el mensaje si no es una actualización real.
- **BOM UTF-8** en `js/app.js` y `js/error-handler.js`.

### Corregido — seguridad
- **Token XSS en `?reset=`**: el token del enlace de recuperación se inyectaba dentro de un
  `onclick`. Ahora se valida el formato hex (`/^[a-f0-9]{32,128}$/i`) antes de usarlo.
- **Defensa en profundidad de roles en el Worker**: `requireRole()` estaba definido pero nunca
  se llamaba. `/api/sync/push` ahora exige permiso por tipo de dato en los borrados
  (`sales.delete`, `expenses.delete`, `orders.manage`, `clients.crud`, `products.crud`,
  `prices.edit`); un rol sin permiso recibe el cambio rechazado con `forbidden:...`.
- **Token de Cloudflare en texto plano** en `.github/README.md`: eliminado del archivo
  (el archivo fue reescrito sin secretos). **Acción pendiente del dueño: rotar ese token en
  el dashboard de Cloudflare**, porque sigue en el historial de git.
- **Escapado HTML (`Utils.escapeHtml`)**: 45 interpolaciones de datos de usuario
  (nombres, teléfonos, direcciones, notas, emails, descripciones de gastos) en `js/app.js` y
  `js/modules.js` que se insertaban crudas en `innerHTML`. Los botones de la lista de usuarios
  pasan el nombre por `data-name` en lugar de interpolarse dentro del `onclick`.
- **Service Worker**: deja de interceptar/cachear `/api/*` y las navegaciones con `?reset=` o
  `?action=`.
- **Cola offline**: los HTTP 401/403 ya no se reintentan 5 veces; el cambio pasa a
  `dead-letter` y se avisa al usuario.

### Corregido — caracteres
- Mojibake con `x` en lugar de vocal acentuada: `automxtico/a`, `automxticamente`, `mxximo`,
  `mxs` -> `más`, `pxgina`, `instantxneos`, `funcionarx`, `dinxmicamente`, `cuxntos`, `bxsica`,
  `agregarx` (en `app.js`, `modules.js`, `sync-engine.js`, `auto-backup.js`).
- Emojis corruptos (`??`) en etiquetas de rol (ahora `🛡️ Administrador`, `🛒 Vendedor`,
  `🚚 Repartidor`, `📊 Contador`, `👁️ Visor`), en el texto del mensaje de Telegram y en
  `console.log`. El caption del backup automático queda sin emojis ni tildes para no volver a
  romper el encoding.
- Tildes faltantes en textos de UI: `Sin expiración`, `Usos Máximos`, `Conexión exitosa`.

### Documentación
- `README.md` reescrito con el estado real del proyecto (versión, las tres apps, estructura,
  deploy, reglas de desarrollo, tablas D1 reales).
- `.github/README.md` reescrito: documenta los dos workflows reales y la lista de secrets, sin
  ningún token en claro.
- `CHANGELOG.md` creado.

### Notas de despliegue de esta versión
- **Worker**: hay cambios en `workers/index.js`; requiere `cd workers && wrangler deploy`.
- **PWA/TWA**: `wrangler pages deploy . --project-name=galloli --branch=main` desde `main` con
  todo commiteado (el deploy local quedó pendiente por un token de Cloudflare inválido).
- **APK**: `git push origin apk-native` dispara `build-android-apk.yml`.
- **TWA (AAB)**: no cambian permisos ni configuración nativa -> no hace falta recompilar el AAB;
  el cambio entra solo con el deploy de Pages, porque el TWA carga el sitio.

## [7.20.45] — 2026-07-30
- `deleteOrder` y `deleteExpense` notifican al servidor con `action=delete`;
  `handleRemoteDeletion` aplica bajas de `orders` y `expenses`.
- CI: APK release firmado con keystore; firma por propiedades de línea de comandos de Gradle;
  `capacitor.config` en JSON para evitar errores de parseo en CI.

## [7.20.44] — 2026-06-03
- Fix ventas eliminadas que "resucitaban": `deleteSale` notifica `action=delete` y
  `syncPendingDeletions` se ejecuta al iniciar.
- CSS responsive base, `Utils.escapeHtml`, `forgotPassword`/`resetPassword` en `AuthManager`.

## [7.20.43] — 2026-05-15
- Registro con `invitation_code`; `handleEmailLogin` guarda el email y `handleEmailRegister`
  pide nombre + código de invitación.

## [7.20.42] — 2026-05-11
- GPS fresco en ventas en segundo plano, chip AUTO en el header, `WeightStability`,
  plugin `getFreshLocation`.

## [7.20.41] — 2026-05-09
- Fix modal con overlay oscuro, inputs sin `id`, botones de rutas 2x2, `label for`.

## [7.20.40] — 2026-05-09
- Fix backup duplicado: el cliente no envía backup si el usuario está autenticado en la nube.

## [7.20.39] — 2026-05-05
- Iconos del APK: tamaños correctos del foreground y `ic_notification` blanco con alpha.

## [7.20.38] — 2026-05-05
- GPS de alta precisión (FusedLocation), buscador de créditos, mapa en tiempo real, radio
  dinámico y permiso de optimización de batería.

Versiones anteriores: ver `git log --oneline`.
