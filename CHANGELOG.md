# Changelog — GallOli

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
El versionado se hace por `APP_VERSION` en `sw.js`, replicado en `version.json` y `package.json`.
El historial completo está en `git log`.

> Nota: la rama `apk-native` (APK nativo de producción) lleva su propio historial de cambios;
> los arreglos comunes se aplican en las dos ramas por separado.

## [7.20.47] — 2026-10-06

Paridad con la rama `apk-native` (APK nativo): la PWA/TWA recibe las funciones y arreglos que
hasta ahora solo existían en la rama nativa.

### Añadido
- **Sistema de permisos por rol** (`js/permissions.js`): fuente única de `window.Perm`
  (`can` / `require` / `applyDom` / `role`) con la matriz de permisos. Los botones de borrar venta
  y de borrar gasto se ocultan si el rol no tiene `sales.delete` / `expenses.delete`.
- **Recuperación de contraseña**: el Worker genera un token de 32 bytes (guardado hasheado en la
  tabla `password_resets`, caduca a los 30 min) y lo envía al Telegram del usuario. El enlace
  `?reset=<token>` abre el modal de nueva contraseña, validando el token como hex antes de usarlo.
  Se agrega el botón "¿Olvidaste tu contraseña?" en el login.
- **Registro con código de invitación**: el empleado se une al negocio del dueño con el rol
  asignado, en lugar de crear siempre un negocio nuevo.
- **Login rediseñado**: pestañas Iniciar sesión / Crear cuenta, Telegram/Email segmentado,
  mostrar/ocultar contraseña y recordar el último email usado.
- **`js/weight-stability.js`**: detector de peso estable (ventana de tiempo + tolerancia),
  compartido entre primer plano y segundo plano.
- **Buscador de créditos**: filtra las tarjetas de deuda por nombre o teléfono.
- **CSS responsive global**: safe-areas, `dvh` en modales, botones de 44 px de alto mínimo,
  tablas que pasan a tarjetas en pantallas chicas y ajustes para ≤360 px y ≤280 px.

### Corregido
- **Worker — defensa en profundidad**: `/api/sync/push` con `action=delete` ahora exige el permiso
  del tipo de dato (`sales.delete`, `expenses.delete`, `orders.manage`, `clients.crud`,
  `products.crud`, `prices.edit`). Antes cualquiera podía forzar un borrado llamando la API.
- **Coordenadas**: `ClientsModule.addClient()` rechaza `(0,0)` y valores fuera de rango, y
  normaliza a `{ lat, lng }`.
- **Mapa de ubicación**: se eliminó el fallback fijo a Ciudad de México. Ahora usa la última
  posición conocida y sigue la posición en vivo (`watchPosition`) con `enableHighAccuracy`.
- **Estadísticas duplicadas al vender**: `SalesModule.addSale()` ya actualizaba al cliente; se
  quitó la segunda llamada a `updateClientStats()`.
- **`escapeHtml` fuera de contexto HTML**: se quitó de las notificaciones del sistema, de los PDF
  y del estado del GPS de rutas, donde el texto es plano y se veía `&amp;` literal.
- **`[hidden]` anulado por CSS**: `.chip { display: flex }` hacía visible el chip "AUTO" aunque
  tuviera el atributo `hidden`. Se agregó `[hidden] { display: none !important; }`.
- **`CustomSelect.destroy()`**: verifica que el wrapper y el select sigan en el DOM antes de
  tocarlos (evita `TypeError` si un `innerHTML` los borró).
- Mojibake restante: `eliminarxn` -> `eliminará`, `Podrxs` -> `Podrás`.

### Notas de despliegue de esta versión
- **Worker**: se despliega desde `workers/` (`wrangler deploy`) **antes** que Pages.
- **PWA/TWA**: `wrangler pages deploy . --project-name=galloli --branch=main` desde `main`.
- **TWA (AAB)**: no cambian permisos nativos ni configuración del TWA; no hace falta recompilar,
  el cambio entra con el deploy de Pages.
- **APK**: `apk-native` es la rama del APK nativo; sus cambios se despliegan por separado.

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

### Seguridad adicional
- `.gitignore` reforzado: bloquea `.env*`, `*.pem`, `*.p12`, `*.aab`, `*.apk`,
  `google-services.json`, `service-account*.json`, `*credentials*.json`, `signing-key-info*`
  y `.firebaserc` para que ningún secreto termine versionado.
- Eliminados del árbol los logs de CI versionados por error (`logs3/`, `run_logs/`, `run_logs2/`
  y sus `.zip`).
- **Pendiente del dueño**: rotar el token de Cloudflare que estaba en texto plano en
  `.github/README.md` (sigue en el historial de git) y quitar del entorno del sistema las
  variables `CLOUDFLARE_API_TOKEN` (inválida), `RESEND_API_KEY` y `SUPABASE_KEY` si no se usan.

### Notas de despliegue de esta versión
- **PWA/TWA**: `wrangler pages deploy . --project-name=galloli --branch=main` desde `main` con
  todo commiteado.
- **TWA (AAB)**: no cambian permisos ni configuración nativa -> no hace falta recompilar el AAB;
  el cambio entra solo con el deploy de Pages, porque el TWA carga el sitio.
- **APK**: la rama `main` no tiene workflows propios; el APK lo construye la rama `apk-native` con su workflow.

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
