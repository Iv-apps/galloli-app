# Changelog — GallOli

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
El versionado se hace por `APP_VERSION` en `sw.js`, replicado en `version.json` y `package.json`.
El historial completo y detallado está en `git log`.

## [7.21.0] — 2026-10-06

### Agregado — sistema de licencias / activación por copia
- **Cada copia vendida se activa con su propio código.** Los códigos van firmados con
  ECDSA P-256 (`GALLOLI1.<payload>.<firma>`) y el Worker los verifica **sin conexión** contra la
  clave pública del vendedor. Quien copie el código fuente no puede fabricar códigos válidos:
  la clave privada nunca sale de la computadora del vendedor.
- **Sin licencia la app no sincroniza**, pero sigue funcionando 100 % local (vender, cobrar,
  reportes, respaldos): `/api/sync/*` responde **402** `license_required` y la app muestra un
  aviso con el botón *Activar licencia*.
- Ata el código a uno o varios dominios (el host del Worker del comprador), admite vencimiento
  o `--perpetua`, y sólo `super_admin`/`admin` pueden activar.
- Backend: `workers/license.js` (verificación, estado y puerta de licencia), rutas
  `GET /api/license/status`, `POST /api/license/activate` y `POST /api/license/deactivate`, y
  tabla `licenses` en `workers/schema.sql` (guarda el `sha256` del código, nunca el código entero;
  un mismo código no se puede activar en dos negocios).
- Frontend: `js/license.js` (aviso fijo, modal de activación, tarjeta de estado en
  *Sincronización en la Nube* y detección del 402 con un envoltorio de `fetch`), más
  `AuthManager.getLicenseStatus()` y `AuthManager.activateLicense()` en `js/auth.js`.
- Herramienta del vendedor `sale/tools/licencias.js`, sin dependencias (sólo Node):
  `--init` (crear claves), `--publica`, `--emitir`, `--info` y `--selftest`.
- `docs/LICENCIAS.md`: funcionamiento, API, revocación por SQL, rotación de claves y límites.
- El paquete de venta incrusta la clave pública del vendedor y pone `LICENSE_ENFORCED = "1"`
  automáticamente si existe `sale/licencia-publica.pem`.

### Cambiado
- `LICENSE.txt` del paquete de venta: de MIT a **licencia de uso de una copia = un negocio, con
  prohibición de reventa y redistribución**, alineada con el sistema de licencias.
- `sale/tools/personalizar.py`: acepta `--placeholders` (como dice la guía) además de `--listar`,
  y puede rellenar `LICENSE_PUBLIC_KEY` con `--license-public-key`.
- La guía del comprador ya no manda ejecutar un `--marca` que no existía: explica los tres
  archivos donde se cambia el nombre visible y avisa de no tocar `GallOliDB` ni las claves
  `galloli_*` de `localStorage` (se perderían los datos ya guardados).

### Corregido — defectos de la guía que habrían afectado al comprador
- El primer comando documentado (`tools/personalizar.py --placeholders --dry-run`) fallaba con
  *unrecognized arguments*: ahora `--placeholders` existe como alias de `--listar`.
- El mensaje de error cuando un código es de otro dominio ahora dice explícitamente
  "El dominio de este código no coincide…".

### Seguridad — leer antes de vender
- `sale/licencia-privada.pem` **nunca** se versiona (`.gitignore`) ni entra en el ZIP: es la
  única llave para emitir códigos. **Respáldala**: si se pierde, las licencias ya emitidas siguen
  valiendo pero no se pueden emitir nuevas con la misma clave (ver `docs/LICENCIAS.md` §7).
- Un sistema auto-alojado no puede impedir que quien controla el servidor levante la puerta.
  La protección real es firma asimétrica + atado por dominio + licencia de uso que prohíbe la
  reventa. Está explicado sin adornos en `docs/LICENCIAS.md` §8.

### Notas de despliegue
- Es un cambio **web**: sube `APP_VERSION` a 7.21.0 (hecho en `sw.js`, `version.json` y
  `package.json`) y el APK lo incluye en el siguiente build.
- El repositorio queda en **modo abierto** (`LICENSE_PUBLIC_KEY = ""` y `LICENSE_ENFORCED = "0"`)
  para no bloquear la sincronización de nadie al desplegar. Para exigir licencias hay que poner
  la clave pública y `LICENSE_ENFORCED = "1"` en `workers/wrangler.toml`, y volver a desplegar.
- Antes de activar la exigencia hay que aplicar `workers/schema.sql` (crea la tabla `licenses`).
  Si falta, el Worker no bloquea nada y lo avisa en los logs.

---

## [7.20.48] — 2026-10-06

Splash animado de verdad, "Mantener sesión iniciada" que hace algo, precache del service
worker y —lo importante— **el envío del APK a Telegram deja de fallar en silencio**.

### Corregido
- **El APK no llegaba a Telegram desde hacía varios builds y el run salía verde.** El log del
  run #39 mostraba `EOFError: EOF when reading a line` en el paso *Send APK to Telegram*: la
  `TELEGRAM_SESSION` no servía, así que Telethon pedía el teléfono por stdin y moría. El
  `continue-on-error: true` convertía ese fallo en un ✅. Ahora:
  - el cliente usa `connect()` + `is_user_authorized()` en vez de `async with TelegramClient(...)`
    (nada de prompts interactivos en CI);
  - los secrets se validan antes de conectar (faltantes y longitud de la `StringSession`) y se
    publica un `sha256[:12]` de la sesión para comparar org vs repo sin exponerla;
  - el motivo del fallo se escribe en el **resumen del run** y un paso extra emite una anotación
    `::error::`, así que un fallo ya no puede pasar desapercibido.
- **El APK se enviaba "al primer canal que apareciera"**: si no encontraba el canal por nombre,
  el fallback viejo devolvía el primer canal de la cuenta. Ahora la resolución es determinista
  (`@usuario` → enlace de invitación → título exacto → **crear el canal**) y, si no hay destino,
  el script falla en vez de enviar a cualquier lado.
- **`"Mantener sesión iniciada" no hacía nada**: `CloudSyncModule.handleEmailLogin()` pasaba
  `keepSession` a `AuthManager.loginWithEmail()`, que ignoraba el tercer argumento. Ahora, sin
  marcar la casilla, la sesión vive solo en `sessionStorage` (muere al cerrar la app) y
  `clearSession()` la borra también.
- **El splash casi no se veía**: `init()` terminaba antes de que se apreciara la animación.
  `App.hideSplash()` respeta ahora un mínimo de 1400 ms (`SPLASH_MIN_MS`, 200 ms si el usuario
  pidió `prefers-reduced-motion`).
- **Precache del service worker**: faltaban `/js/permissions.js` y `/js/ble-bundle.js`, que sí
  carga `index.html`. Con el SW viejo, `Perm` podía no estar en el primer arranque offline.

### Agregado
- **Splash animado propio** `#galloli-splash` en `index.html`: logo con *pop* y halo pulsante,
  título/subtítulo que suben y barra de progreso, sobre `#185a83` (el mismo `windowBackground`
  del tema Android, así no hay destello blanco). El CSS va *inline* con el markup y hay una red
  de seguridad de 8 s que borra el div si nada más corrió.
- **Canal dedicado `GallOli Artifacts`** para los artifacts de GallOli (antes todo caía en un
  canal compartido buscado por nombre). Configurable con las *variables* `TELEGRAM_CHANNEL_TITLE`
  / `TELEGRAM_CHANNEL_USERNAME` y el secret `TELEGRAM_CHANNEL_INVITE`.
- `.github/scripts/telegram_setup.py`: desde tu PC inicia sesión, **crea el canal**, imprime los
  secrets listos para pegar y con `--push-secrets` los sube solo (con `--limpiar-secrets-de-repo`
  borra las copias del repo que tapan los de la organización).

### Notas de despliegue
- `node --check` en `js/app.js`, `js/auth.js` y `sw.js`; `py_compile` de los dos scripts de
  Telegram (que además se probaron a mano en sus rutas de error: sin secrets, sesión corta y
  APK ausente → mensaje claro y salida 1, sin traceback ni esperas).
- Verificado en navegador: el splash pinta `#185a83`, se mantiene visible ~1,4 s, se desvanece y
  se elimina del DOM; `loadSession()` recupera la sesión volátil y `saveSession(..., false)` no
  escribe nada en IndexedDB.
- **El resumen del paso "Get app version" salía vacío** (`grep -o \"'[^']*'\"` con comillas
  anidadas dentro del YAML devolvía `grep: Unmatched [`), así que el caption del APK decía
  `Versión: ?`. Ahora se extrae con `sed` y se comprueba en el log (`Version detectada: ...`).
- Verificación del arreglo contra el CI real (run #40, commit `04d69c3`): el paso de Telegram ya
  no muere con `EOFError`; el diagnóstico nuevo fue
  `[info] session: 353 chars, sha256[:12]=987ce34021d6` +
  `Motivo: TELEGRAM_SESSION existe pero Telegram la rechaza (sesion caducada, revocada o de otra
  cuenta)`, el resumen del run lo registró y la anotación `::error::` marcó el fallo.
- **Pendiente del dueño (último paso del envío a Telegram)**: el secret que se resuelve (la
  copia del repo, de abril) es una sesión real pero muerta. Hay que regenerarla con tu teléfono:
  `python .github/scripts/telegram_setup.py --push-secrets` (crea además el canal dedicado
  `GallOli Artifacts`). Alternativa si la sesión buena estuviera en la organización:
  `python .github/scripts/telegram_setup.py --limpiar-secrets-de-repo` y relanzar el workflow.
  También sigue pendiente rotar el token de Cloudflare que estuvo en texto plano y quitar
  `CLOUDFLARE_API_TOKEN`/`RESEND_API_KEY`/`SUPABASE_KEY` del entorno del espacio de trabajo.

## [7.20.47] — 2026-10-06

Alineación de la rama nativa con la PWA/TWA (`main`) y dos arreglos propios.

### Corregido
- **`[hidden]` anulado por CSS**: la regla `.chip { display: flex }` pisaba el atributo `hidden`
  del chip "AUTO", que se veía siempre aunque no estuviera activo. Se agregó la regla
  `[hidden] { display: none !important; }`.
- **`CustomSelect.destroy()`**: ahora verifica que el wrapper y el select sigan en el DOM antes
  de tocarlos (evita `TypeError` cuando un `innerHTML` los borró antes de destruir la instancia).

### Documentación
- `docs/APK_CAPACITOR_TELEGRAM.md`: guía completa de Capacitor, permisos nativos, build del APK,
  envío del artifact a Telegram usando los secrets **de organización**
  (`TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_SESSION`) y splash animado propio sin
  mostrar nada de Capacitor.
- `package.json`: la URL del repositorio apuntaba a `ivanbj96/galloli-app`; el remoto real es
  `Iv-apps/galloli-app`.

### Notas de despliegue
- Los dos arreglos son de código web y **sí** entran en el APK: se sube `APP_VERSION` a 7.20.47
  y el push a `apk-native` dispara `build-android-apk.yml` (artifact + envío a Telegram).
- La `main` (PWA/TWA) recibió el resto de la paridad en su propio commit v7.20.47.

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

### Seguridad adicional
- `.gitignore` reforzado: bloquea `.env*`, `*.pem`, `*.p12`, `*.aab`, `*.apk`,
  `google-services.json`, `service-account*.json`, `*credentials*.json`, `signing-key-info*`
  y `.firebaserc` para que ningún secreto termine versionado.
- **Pendiente del dueño**: rotar el token de Cloudflare que estaba en texto plano en
  `.github/README.md` (sigue en el historial de git) y quitar del entorno del sistema las
  variables `CLOUDFLARE_API_TOKEN` (inválida), `RESEND_API_KEY` y `SUPABASE_KEY` si no se usan.

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
