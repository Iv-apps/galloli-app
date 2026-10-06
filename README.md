# GallOli — Sistema de Gestión Integral para Negocios

> PWA + TWA (Google Play) + APK nativo (Capacitor) para gestión de ventas, inventario,
> contabilidad, créditos y pedidos, con pesaje Bluetooth y sincronización multi-dispositivo.

![Version](https://img.shields.io/badge/version-7.20.46-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Android-lightgrey)

## Aplicaciones del repositorio

| Versión | Rama | Distribución | Notas |
|---|---|---|---|
| **PWA / TWA** | `main` | Cloudflare Pages + Play Store | App ID Play: `dev.pages.galloli.twa`, dominio: `galloli.ivapps.store`. Corre en Chrome, sin APIs nativas. |
| **APK básico** | `main` | CI `build-android.yml` -> Telegram | Capacitor (`store.ivapps.galloli`) con BLE foreground service y FCM básico. |
| **APK nativo (producción)** | `apk-native` | CI `build-android-apk.yml` -> Telegram | Añade `GeofenceBleService.kt` (wakelock, sobrevive a Doze), `BootReceiver.kt` y `src/native/*` (venta automática, geofence, FCM). Nunca se mergea a `main`. |

## Características

### 📊 Ventas y pedidos
- Registro rápido de ventas con cálculo automático de totales (contado y crédito).
- Historial con filtros por fecha y cliente; pedidos con estados y conversión a venta.
- Recibos PDF con logo personalizado y reportes exportables a JSON.

### ⚖️ Balanza BLE y pesaje automático
- Lectura de balanza CAMRY por Bluetooth LE (`js/bluetooth-scale.js`).
- **TWA/PWA**: pesaje en cadena con GPS (`js/geo-chain.js`), solo con la app en primer plano.
- **APK nativo**: `BleForegroundService` recibe el peso en Java/Kotlin, detecta peso estable y
  registra la venta aunque la app esté cerrada; `auto-sale-engine.js` orquesta geofence (150 m),
  3 lecturas estables y 1 venta por cliente cada 60 s.

### 👥 Clientes, créditos y rutas
- Clientes con coordenadas GPS, archivo/reactivación e historial de compras.
- Créditos con pagos parciales, pago inteligente multi-crédito y reportes de cobranza.
- Mapa de rutas con optimización del recorrido de pedidos pendientes (Leaflet + OSM).

### 📈 Contabilidad
- Gastos por categoría, merma diaria, precios por libra y diezmos/ofrendas configurables.

### 🔐 Cuentas, roles y seguridad
- Login con **Telegram** (código de verificación), **email + contraseña** o **PIN**.
- **Recuperación de contraseña** por token (link a Telegram, válido 30 min) y recuperación del
  email enmascarado por Telegram ID.
- **Roles** `super_admin`, `admin`, `vendedor`, `repartidor`, `contador`, `viewer`, con matriz de
  permisos aplicada en la UI (`js/permissions.js`, atributos `data-perm`) **y** en el Worker
  (`requireRole`, defensa en profundidad; los borrados exigen permiso explícito por tipo de dato).

### 🔄 Sincronización y respaldo
- WebSocket en tiempo real (Durable Objects) + REST (`/api/sync/push`, `/api/sync/pull`).
- Cola offline en IndexedDB con reintentos y backoff; los 401/403 no se reintentan (dead-letter).
- Backup automático diario a Telegram desde el Worker y respaldo manual/importación desde la app.

### 📱 PWA
- Instalable, offline-first con service worker versionado, notificaciones push VAPID,
  file handlers y share target para importar respaldos.

## Stack

- **Frontend**: HTML/CSS/JS vanilla, IndexedDB, Service Worker, Leaflet, jsPDF.
- **Hosting**: Cloudflare Pages -> `galloli.pages.dev` y `galloli.ivapps.store`.
- **API**: Cloudflare Worker `galloli-sync` (`workers/index.js`), D1 `galloli`, Durable Object `SessionManager`.
- **Auth**: JWT HMAC-SHA256, hash de contraseñas con SHA-256 (pendiente migrar a PBKDF2/scrypt).
- **Android**: Capacitor 8 + Java/Kotlin nativo, TWA con Bubblewrap.

## Estructura del proyecto

```
galloli/
├── index.html                  # SPA (todas las páginas se renderizan aquí)
├── manifest.json               # PWA manifest
├── sw.js                       # Service Worker (APP_VERSION aquí)
├── _headers                    # Headers de Cloudflare Pages
├── css/styles.css              # Estilos + sistema responsive (280px a 1920px)
├── js/
│   ├── app.js                  # App: navegación, páginas, pesaje en cadena
│   ├── modules.js              # Módulos de datos (clientes, ventas, pedidos, rutas, sync)
│   ├── auth.js                 # AuthManager (Telegram, email, PIN, recuperación)
│   ├── permissions.js          # Sistema de permisos por rol (window.Perm)
│   ├── sync-engine.js          # WebSocket + REST + merge de datos
│   ├── offline-queue.js        # Cola offline con reintentos y dead-letter
│   ├── bluetooth-scale.js      # Balanza BLE CAMRY
│   ├── geo-chain.js            # Pesaje automático por GPS (TWA/PWA)
│   ├── ble-bundle.js           # Stub en PWA/TWA; generado por esbuild en el APK
│   └── ...                     # db, utils, pdf, backup, facturación, notificaciones
├── src/native/                 # Solo APK nativo (platform-guard lo verifica)
├── workers/
│   ├── index.js                # Worker API (auth, sync, backup, push, cron)
│   ├── session-manager.js      # Durable Object WebSocket
│   ├── schema.sql              # Esquema D1
│   └── wrangler.toml
├── .github/
│   ├── workflows/              # build-android.yml (main) y build-android-apk.yml (apk-native)
│   ├── android-src/            # Fuente de verdad de los archivos Java/Kotlin
│   ├── apk-icons/              # Iconos del APK (mismos que la TWA)
│   └── scripts/                # patch_firebase, disable_splash, envío a Telegram
├── .well-known/assetlinks.json # Fingerprint de Google Play Signing (TWA)
└── branch-apk/, ideas/         # Documentación y backlog (ignorados por git)
```

## Puesta en marcha

### Requisitos
- Node.js 18+ y `wrangler` (dev dependency del repo: `npx wrangler ...`).
- Cuenta de Cloudflare con D1 y Pages.

### Worker
```bash
cd workers
wrangler d1 execute galloli --file=../workers/schema.sql   # solo la primera vez
wrangler deploy
```
Secrets del Worker: `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `FEEDBACK_BOT_TOKEN`, `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `FCM_SERVICE_ACCOUNT_JSON` (y `FCM_PROJECT_ID` como variable).

### Frontend (PWA/TWA)
```bash
# 1) subir APP_VERSION en sw.js
git add . && git commit -m "vX.X.X - descripcion" && git push origin main
wrangler pages deploy . --project-name=galloli --branch=main
```

### APK
```bash
git checkout apk-native
# cambios...
git push origin apk-native     # dispara build-android-apk.yml y envía el APK a Telegram
```

### TWA (AAB para Play Store)
Build manual con Bubblewrap desde `GallOli - Google Play package2/` (incrementar `versionCode` en
`app/build.gradle` y `appVersionCode` en `twa-manifest.json` antes de compilar). Ver
`.kiro/steering/twa-deployment-guide.md` para el detalle.

## Reglas de desarrollo

1. Subir `APP_VERSION` en `sw.js` antes de cada deploy (y `version.json`, `package.json`).
2. Deploy de Pages **siempre** desde `main` y con todo commiteado (un deploy desde `apk-native`
   rompe la TWA con 404).
3. Worker modificado -> `wrangler deploy` desde `workers/` **antes** del deploy de Pages.
4. Nunca mergear `apk-native` -> `main`.
5. Los archivos Android nativos se editan en `.github/android-src/`, no en `android/` (no está en git).
6. Dato nuevo = actualizar los 5 puntos de backup (`createBackup`, `runScheduledBackup`,
   `handleBackup`, `getLocalData`, `importFromData`).
7. Un solo `window.Perm` (en `js/permissions.js`); no declarar otro `Perm` global.
8. Datos de usuario en `innerHTML` siempre con `Utils.escapeHtml`.
9. No usar PowerShell para reescribir JS/HTML con acentos (rompe el encoding); usar el editor.
10. Nunca subir el keystore, `galloli-release.keystore`, APK/AAB firmados ni tokens al repositorio.

## Estructura de datos

- IndexedDB `GallOliDB`: `clients`, `sales`, `orders`, `expenses`, `prices`, `mermaRecords`,
  `diezmos`, `paymentHistory`, `config`, `syncQueue`, `auth`.
- D1: `businesses`, `users`, `sessions`, `sync_data`, `changes`, `invitation_codes`,
  `verification_codes`, `push_subscriptions`, `password_resets`.

## Contribuir

1. Fork y rama por feature (`git checkout -b feature/MiFeature`).
2. Commits atómicos con el formato `vX.X.X - descripcion`.
3. Verificar sintaxis: `for f in js/*.js sw.js workers/*.js; do node --check "$f"; done`.
4. Abrir Pull Request.

## Licencia

MIT. Autor: **Ivan Quiñonez** — contacto@galloli.app
