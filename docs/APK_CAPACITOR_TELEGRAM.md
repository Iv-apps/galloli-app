# GallOli: Capacitor + permisos nativos + APK a Telegram + splash propio

Guía de referencia para replicar en otros repos (VidKids, BovedaNativa, etc.) **exactamente**
lo que GallOli ya tiene funcionando en la rama `apk-native`.

- **Rama de referencia**: `apk-native` (APK nativo de producción). `main` es la PWA/TWA y
  **nunca** se mergea hacia/desde `apk-native`.
- **Workflow real**: [`.github/workflows/build-android-apk.yml`](../.github/workflows/build-android-apk.yml)
- **Scripts**: [`.github/scripts/send_native_apk.py`](../.github/scripts/send_native_apk.py),
  [`.github/scripts/gen_session.py`](../.github/scripts/gen_session.py),
  [`.github/scripts/disable_splash.py`](../.github/scripts/disable_splash.py),
  [`.github/scripts/patch_firebase.py`](../.github/scripts/patch_firebase.py)
- **Fuente nativa versionada**: [`.github/android-src/`](../.github/android-src) (Java/Kotlin)

> Regla de oro del repo: `android/` **no** está en git. Todo archivo nativo que se quiera
> conservar se edita en `.github/android-src/` y el CI lo copia al proyecto generado.

---

## 1. Capacitor: configuración mínima que funciona

### 1.1 `capacitor.config.json`

```json
{
  "appId": "store.ivapps.galloli",
  "appName": "GallOli",
  "webDir": "www",
  "server": { "androidScheme": "https" },
  "plugins": {
    "SplashScreen": {
      "launchShowDuration": 0,
      "launchAutoHide": true,
      "backgroundColor": "#185a83",
      "showSpinner": false
    },
    "StatusBar": { "style": "LIGHT", "backgroundColor": "#185a83" }
  }
}
```

Puntos clave:

- `webDir: "www"`: el CI fabrica `www/` copiando el contenido web **plano** (no se usa Vite ni
  ningún bundler para la web). Ver `Prepare www folder` en el workflow.
- `androidScheme: "https"`: necesario para que `fetch`, `Service Worker` y `localStorage` se
  comporten igual que en la PWA. Con `http://localhost` el SW no se registra igual.
- **`@capacitor/splash-screen` NO es dependencia**. El bloque `SplashScreen` queda inerte y el
  splash que se ve es el del tema Android. Esto es intencional (ver §5).

### 1.2 Dependencias

`package.json` (base):

```json
"dependencies": {
  "@capacitor/android": "^8.1.0",
  "@capacitor/cli": "^8.1.0",
  "@capacitor/core": "^8.1.0",
  "@capacitor-community/bluetooth-le": "^6.1.0"
}
```

El CI instala **además**, solo para el APK nativo (así `main`/TWA no carga plugins que no usa):

```bash
npm install @capacitor/geolocation @capacitor/local-notifications \
            @capacitor/push-notifications @capacitor/app \
            @capacitor/preferences @capacitor-firebase/messaging \
            --legacy-peer-deps
```

### 1.3 Plugins en JS vanilla (sin bundler) — el truco de `ble-entry.js`

`@capacitor-community/bluetooth-le` es un paquete ESM: no se puede hacer `<script src>` directo.
Solución de GallOli:

1. `js/ble-entry.js` importa el plugin y lo expone en `window.__BleBundle`:

   ```js
   import { BleClient, numberToUUID } from '@capacitor-community/bluetooth-le';
   window.__BleBundle = { BleClient, numberToUUID };
   ```

2. El CI lo empaqueta a IIFE antes de compilar:

   ```bash
   npx esbuild js/ble-entry.js --bundle --format=iife \
     --global-name=__BleBundle --outfile=js/ble-bundle.js \
     --platform=browser --target=es2017
   ```

3. `js/ble-bundle.js` está versionado como **stub** (para que la PWA no rompa) y el CI lo
   **sobrescribe** con el bundle real. El resto del código usa `window.__BleBundle` sin saber
   si está en PWA o en APK.

### 1.4 Detección de plataforma

```js
const isNative = window.Capacitor &&
                 window.Capacitor.isNativePlatform &&
                 window.Capacitor.isNativePlatform();
```

Todo el código exclusivo del APK va detrás de ese guard + `typeof fn === 'function'`. Así el
**mismo** `js/app.js` corre en PWA/TWA (donde `window.Capacitor` es `undefined`) y en el APK.

---

## 2. Permisos y componentes nativos

### 2.1 Permisos inyectados en `AndroidManifest.xml`

El CI parchea el manifest generado (paso **Patch AndroidManifest**). Permisos reales de GallOli:

| Permiso | Para qué |
|---|---|
| `BLUETOOTH`, `BLUETOOTH_ADMIN` (`maxSdkVersion=30`) | BLE en Android ≤ 11 |
| `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE` | BLE en Android ≥ 12 |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | escaneo BLE + GPS |
| `ACCESS_BACKGROUND_LOCATION` | geofence con la app cerrada |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `FOREGROUND_SERVICE_LOCATION` | servicios en segundo plano (Android 14 exige el tipo) |
| `POST_NOTIFICATIONS` | notificaciones (Android 13+) |
| `WAKE_LOCK` | mantener la CPU viva mientras se pesa |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | que Doze no mate el GPS en background |
| `RECEIVE_BOOT_COMPLETED` | arrancar el servicio al reiniciar el equipo |

Más `<uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />`
para no excluir dispositivos sin BLE en Play Store.

### 2.2 Servicios y receivers declarados

```xml
<meta-data android:name="com.google.firebase.messaging.default_notification_channel_id"
           android:value="galloli_push_channel_v2" />

<service android:name=".BleForegroundService"
         android:foregroundServiceType="connectedDevice|location" />
<service android:name=".GeofenceBleService"
         android:foregroundServiceType="location|connectedDevice" />
<service android:name=".GalloliFirebaseService" android:exported="false">
    <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>
</service>
<receiver android:name=".BootReceiver" android:exported="true">
    <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
        <action android:name="android.intent.action.QUICKBOOT_POWERON" />
    </intent-filter>
</receiver>
```

Detalle importante: **Android 14+ exige `foregroundServiceType`**. Si falta, el servicio no
arranca al llamar `startForeground()` y verás un crash silencioso.

### 2.3 Pedir permisos en tiempo de ejecución (`MainActivity.java`)

`ACCESS_BACKGROUND_LOCATION` **no se puede pedir en el mismo diálogo** que los demás. El patrón
que funciona (`.github/android-src/MainActivityFcm.java`):

1. `onCreate`: `registerPlugin(BleForegroundPlugin.class)` **antes** de `super.onCreate()`.
2. Pedir BLE + notificaciones + ubicación en primer plano (`requestCode 1001`).
3. En `onRequestPermissionsResult(1001)`, si ya hay `ACCESS_FINE_LOCATION`, pedir
   `ACCESS_BACKGROUND_LOCATION` con `requestCode 1002`.
4. Pedir la exclusión de optimización de batería con
   `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.

### 2.4 Gradle

`play-services-location` no viene por defecto y `FusedLocationProviderClient` lo necesita:

```gradle
dependencies {
    implementation 'com.google.android.gms:play-services-location:21.3.0'
}
```

El CI lo inserta con `sed` si no está (paso **Add play-services-location dependency**).

### 2.5 Firebase

`google-services.json` **nunca** se versiona: se guarda como secret `GOOGLE_SERVICES_JSON`
(texto del archivo) y el CI lo escribe + corre `patch_firebase.py` para aplicar el plugin de
Gradle de Google Services.

---

## 3. Build del APK en GitHub Actions

### 3.1 Orden de pasos (resumen del workflow real)

1. `actions/checkout@v4`, Node 22 (`setup-node@v4` con cache npm).
2. `npm install --legacy-peer-deps` + plugins.
3. `esbuild` → `js/ble-bundle.js`.
4. **Prepare `www/`**: copia `index.html`, `css/`, `js/`, `icons/`, `src/`, `manifest.json`,
   `sw.js`, `_headers`, `.well-known/`.
5. Java 21 (Temurin).
6. **Android SDK** (ver aviso abajo).
7. `sdkmanager --licenses` y `sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"`.
8. `npx cap add android` (si no existe) → `npx cap sync android`.
9. Iconos (copiados de la TWA en `.github/apk-icons/`), color de fondo del icono adaptativo `#ffffff`.
10. Splash (§5).
11. Copiar `.github/android-src/*.java|kt` a `android/app/src/main/java/<appId>/`.
12. Firebase + patch del manifest + Gradle.
13. Keystore (secret `RELEASE_KEYSTORE` en base64) → `android/app/galloli-release.keystore`.
14. `./gradlew assembleRelease` con `-Pandroid.injected.signing.*`.
15. Renombrar a `GallOli-Native.apk` + `actions/upload-artifact@v4`.
16. Enviar a Telegram (§4).

### 3.2 ⚠️ La trampa que costó una tarde: el SDK de Android

**No uses `android-actions/setup-android@v3`.** Fallaba de forma aparente-silenciosa y dejaba
el job sin `sdkmanager`. GallOli ahora usa el SDK preinstalado del runner
`ubuntu-latest` y solo descarga `commandlinetools` si de verdad no lo encuentra:

```yaml
- name: Setup Android SDK (preinstalado del runner)
  run: |
    set -e
    SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/usr/local/lib/android/sdk}}"
    echo "ANDROID_SDK_ROOT=$SDK" >> "$GITHUB_ENV"
    echo "ANDROID_HOME=$SDK" >> "$GITHUB_ENV"
    CMDLINE="$SDK/cmdline-tools/latest/bin"
    if [ ! -x "$CMDLINE/sdkmanager" ]; then
      ENCONTRADO="$(find "$SDK" -name sdkmanager -type f 2>/dev/null | sort | tail -1 || true)"
      [ -n "$ENCONTRADO" ] && CMDLINE="$(dirname "$ENCONTRADO")"
    fi
    if [ ! -x "$CMDLINE/sdkmanager" ]; then
      curl -sS -L -o /tmp/cmdline-tools.zip \
        https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
      unzip -q -o /tmp/cmdline-tools.zip -d /tmp/cmdline-tools
      mkdir -p "$SDK/cmdline-tools"
      rm -rf "$SDK/cmdline-tools/latest"
      mv /tmp/cmdline-tools/cmdline-tools "$SDK/cmdline-tools/latest"
      CMDLINE="$SDK/cmdline-tools/latest/bin"
    fi
    echo "$CMDLINE" >> "$GITHUB_PATH"
```

### 3.3 Secrets del build (a nivel de repositorio)

| Secret | Contenido |
|---|---|
| `RELEASE_KEYSTORE` | el `.jks` en **base64** (`base64 -w0 galloli-release.jks`) |
| `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` | datos del keystore |
| `GOOGLE_SERVICES_JSON` | el `google-services.json` completo, como texto |
| `FIREBASE_SERVICE_ACCOUNT`, `FCM_SERVER_KEY` | push nativo desde el Worker |

Para pasar el keystore a un archivo en el job: `echo "$RELEASE_KEYSTORE" | base64 --decode > …`.

---

## 4. Envío del APK a Telegram

### 4.1 Secrets verificados (comprobado vía API de GitHub)

**A nivel de ORGANIZACIÓN (`Iv-apps`)** — reutilizables por **todos** los repos:

```
TELEGRAM_API_ID
TELEGRAM_API_HASH
TELEGRAM_SESSION
```

**A nivel de repo (`Iv-apps/galloli-app`)**: además de los tres anteriores, hay copias propias
de `TELEGRAM_API_ID/HASH/SESSION`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
`GOOGLE_SERVICES_JSON`, `RELEASE_KEYSTORE`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`,
`FIREBASE_SERVICE_ACCOUNT`, `FCM_SERVER_KEY`.

No hay *variables* de Actions definidas (ni de org ni de repo).

> Nota: en GitHub, **un secret de repositorio con el mismo nombre gana** sobre el de
> organización. En GallOli hoy están en los dos niveles, así que si rotas uno, actualiza ambos
> (o borra el del repo para que quede uno solo, el de organización).

Comprobar los nombres sin exponer valores:

```bash
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/orgs/Iv-apps/actions/secrets
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/Iv-apps/galloli-app/actions/secrets
```

### 4.2 Generar `TELEGRAM_SESSION` (una sola vez)

Con `api_id`/`api_hash` de <https://my.telegram.org>:

```bash
pip install telethon
python .github/scripts/gen_session.py   # pide API_ID y API_HASH, imprime el StringSession
```

Ese string va en el secret `TELEGRAM_SESSION` (org y/o repo). **Es una credencial de tu cuenta
de Telegram**: no lo pegues en ningún archivo, issue ni chat. Si se filtra, revócalo desde
Telegram → Dispositivos → Terminar sesión y regenera.

### 4.3 Publicar el APK (`send_native_apk.py`)

Puntos finos que ya están resueltos en el script:

- Usa Telethon con `StringSession` (no hay archivo `.session` en el runner).
- **Busca el canal por nombre** (`GallOli Builds`) en los diálogos, y si no es miembro, se une
  con `ImportChatInviteRequest` usando la invite (`https://t.me/+QPr885dQgl0wNDgx`).
- **Caption ≤ 1024 caracteres** es límite duro de Telegram: el mensaje del commit se recorta a
  400 chars y el caption final a 1024. Sin esto, el envío falla con `MESSAGE_TOO_LONG`.
- Si el APK no existe, sale con código ≠ 0.

```python
async with TelegramClient(StringSession(session_str), api_id, api_hash) as client:
    channel = await get_channel(client)
    await client.send_file(channel, APK_PATH, caption=caption)
```

### 4.4 Que un fallo de Telegram no tumbe el build

El APK ya está subido como *artifact* de Actions. Por eso el paso va con
`continue-on-error: true`:

```yaml
- name: Send APK to Telegram
  continue-on-error: true
  env:
    TELEGRAM_API_ID:   ${{ secrets.TELEGRAM_API_ID }}
    TELEGRAM_API_HASH: ${{ secrets.TELEGRAM_API_HASH }}
    TELEGRAM_SESSION:  ${{ secrets.TELEGRAM_SESSION }}
  run: python .github/scripts/send_native_apk.py
```

### 4.5 Reutilizarlo desde OTROS repos (patrón recomendado)

Como los tres secrets de Telegram ya son **de organización**, cualquier repo de `Iv-apps` los
puede usar sin configurar nada. Lo que conviene centralizar es el *script*, para no copiarlo.

**Opción A — repo `.github` de la organización (workflow reutilizable):**

En `Iv-apps/.github/.github/workflows/send-telegram-artifact.yml`:

```yaml
name: Send artifact to Telegram
on:
  workflow_call:
    inputs:
      artifact-path: { required: true,  type: string }
      caption:       { required: false, type: string, default: "" }
      channel:       { required: false, type: string, default: "GallOli Builds" }
    secrets:
      TELEGRAM_API_ID:   { required: true }
      TELEGRAM_API_HASH: { required: true }
      TELEGRAM_SESSION:  { required: true }
jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install telethon
      - env:
          TELEGRAM_API_ID:   ${{ secrets.TELEGRAM_API_ID }}
          TELEGRAM_API_HASH: ${{ secrets.TELEGRAM_API_HASH }}
          TELEGRAM_SESSION:  ${{ secrets.TELEGRAM_SESSION }}
          ARTIFACT_PATH:     ${{ inputs.artifact-path }}
          CAPTION:           ${{ inputs.caption }}
          CHANNEL_NAME:      ${{ inputs.channel }}
        run: python send_telegram_artifact.py   # variante genérica de send_native_apk.py
```

Y en cada repo:

```yaml
- uses: Iv-apps/.github/.github/workflows/send-telegram-artifact.yml@main
  with:
    artifact-path: android/app/build/outputs/apk/release/GallOli-Native.apk
    caption: "GallOli APK ${{ github.run_number }}"
  secrets: inherit        # ← hereda los secrets de organización (y del repo)
```

**Opción B — sin repo central:** copiar `send_native_apk.py` y dejar los `env:` apuntando a
`secrets.TELEGRAM_*`. Funciona, pero cada repo duplica el script.

**Requisitos para que `secrets: inherit` tome los de organización:**
1. El secret debe estar en **Organization → Settings → Secrets → Actions**.
2. Hay que dar acceso al repo. En GitHub los secrets de organización tienen una *repository
   access policy*: si está en "Selected repositories", el repo debe estar en la lista. Si está
   en "All repositories", listo.
3. El workflow que los usa debe ser un `workflow_call` (o un workflow del propio repo).

---

## 5. Splash animado propio, sin nada de Capacitor

### 5.1 Por qué se ve el splash de Capacitor (y qué hace GallOli)

Al generar el proyecto, Capacitor crea en Android:

- `res/values/styles.xml` con `AppTheme.NoActionBarLaunch` (parent `Theme.SplashScreen`),
  que pinta `@drawable/splash` como `android:background`.
- `res/drawable/splash.png` — la imagen por defecto **con branding de Capacitor**.
- `AndroidManifest.xml`: `MainActivity` con `android:theme="@style/AppTheme.NoActionBarLaunch"`.

Ese es el splash que aparece al abrir. GallOli lo neutraliza en el CI con **dos pasos**:

```bash
# 1) borrar el estilo de launch
python3 .github/scripts/disable_splash.py     # elimina AppTheme.NoActionBarLaunch de styles.xml
# 2) apuntar la Activity al tema sin splash
sed -i 's|AppTheme\.NoActionBarLaunch|AppTheme.NoActionBar|g' android/app/src/main/AndroidManifest.xml
```

Y además **reemplaza** `@drawable/splash` por un PNG propio (icono al 40 % del ancho sobre
`#185a83`) para el caso en que alguien reactive el tema:

```bash
for cfg in "port-mdpi:320x480" "port-hdpi:480x800" "port-xhdpi:720x1280" \
           "port-xxhdpi:960x1600" "port-xxxhdpi:1280x1920"; do
  d="${cfg%%:*}"; dims="${cfg##*:}"; w="${dims%%x*}"; h="${dims##*x*}"; s=$((w * 40 / 100))
  mkdir -p "res/drawable-$d"
  convert -size ${w}x${h} xc:"#185a83" \( "$SRC" -resize ${s}x${s} \) -gravity center -composite \
          "res/drawable-$d/splash.png"
done
```

**Dos reglas para que no haya destello blanco:**
1. El `windowBackground` del tema que queda (`AppTheme.NoActionBar`) debe ser el color de marca
   (`#185a83`). Si no, se ve un frame blanco antes del WebView.
2. `SplashScreen.launchShowDuration: 0` + `launchAutoHide: true` (y no instalar
   `@capacitor/splash-screen`) → Capacitor nunca pinta nada por su cuenta.

Resultado: al abrir se ve el azul de marca y, encima, tu splash animado web. Cero branding de
Capacitor.

### 5.2 Nivel 1 (recomendado): splash animado en HTML/CSS

Es animación real, cero código nativo, y se ve **el mismo** splash en PWA y en APK.
En `index.html`, justo después de `<body>`:

```html
<div id="galloli-splash" aria-hidden="true">
  <div class="gs-mark">
    <!-- tu logo: SVG inline, para que no haya petición de red -->
    <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
      <circle cx="60" cy="60" r="54" fill="#ffffff" opacity=".12"/>
      <path d="M35 78c22 0 42-14 46-38-26 2-46 16-46 38z" fill="#8BC34A"/>
      <path d="M35 78c10-14 24-24 40-30" stroke="#ffffff" stroke-width="4" fill="none"
            stroke-linecap="round" class="gs-stem"/>
    </svg>
  </div>
  <div class="gs-title">GallOli</div>
  <div class="gs-bar"><span></span></div>
</div>

<style>
#galloli-splash{
  position:fixed; inset:0; z-index:100000;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1rem;
  background:#185a83;                       /* mismo color que el windowBackground del tema */
  padding-top:env(safe-area-inset-top); padding-bottom:env(safe-area-inset-bottom);
  transition:opacity .45s ease;
}
#galloli-splash .gs-mark{ animation:gs-pop .9s cubic-bezier(.2,.9,.25,1.3) both; }
#galloli-splash .gs-stem{ stroke-dasharray:80; stroke-dashoffset:80;
  animation:gs-draw 1s .35s ease forwards; }
#galloli-splash .gs-title{ color:#fff; font:700 1.9rem/1 system-ui, sans-serif;
  letter-spacing:.02em; opacity:0; animation:gs-up .5s .45s ease forwards; }
#galloli-splash .gs-bar{ width:120px; height:4px; border-radius:99px;
  background:rgba(255,255,255,.25); overflow:hidden; }
#galloli-splash .gs-bar span{ display:block; height:100%; width:40%; border-radius:99px;
  background:#8BC34A; animation:gs-slide 1.1s infinite ease-in-out; }
#galloli-splash.is-hidden{ opacity:0; pointer-events:none; }

@keyframes gs-pop { from{ transform:scale(.6); opacity:0 } to{ transform:scale(1); opacity:1 } }
@keyframes gs-draw{ to{ stroke-dashoffset:0 } }
@keyframes gs-up  { from{ transform:translateY(8px); opacity:0 } to{ transform:translateY(0); opacity:1 } }
@keyframes gs-slide{ 0%{transform:translateX(-100%)} 100%{transform:translateX(250%)} }
@media (prefers-reduced-motion: reduce){
  #galloli-splash *{ animation:none !important; }
  #galloli-splash .gs-title{ opacity:1; }
}
</style>
```

Y en `js/app.js`, al final de `init()` (o en `window.load`), quitarlo cuando la app ya pintó:

```js
const hideSplash = () => {
  const el = document.getElementById('galloli-splash');
  if (!el) return;
  el.classList.add('is-hidden');
  setTimeout(() => el.remove(), 500);
};
window.addEventListener('load', () => setTimeout(hideSplash, 600));
setTimeout(hideSplash, 4000);   // red de seguridad: nunca dejar el splash colgado
```

Ventajas: sin dependencias, sin código Android, misma animación en PWA/TWA/APK, y respeta
`prefers-reduced-motion`. Es la vía que conviene usar primero.

### 5.3 Nivel 2: splash nativo animado (sin WebView)

Si quieres animación **antes** de que el WebView exista (cold start lento en equipos viejos):

1. **No** borres `AppTheme.NoActionBarLaunch`; en su lugar haz que su `android:background` sea
   un `AnimationDrawable`:

   ```xml
   <!-- res/drawable/splash_anim.xml -->
   <animation-list xmlns:android="http://schemas.android.com/apk/res/android"
                   android:oneshot="true">
     <item android:drawable="@drawable/splash_01" android:duration="120" />
     <item android:drawable="@drawable/splash_02" android:duration="120" />
     <item android:drawable="@drawable/splash_03" android:duration="120" />
   </animation-list>
   ```

   ```xml
   <style name="AppTheme.NoActionBarLaunch" parent="AppTheme.NoActionBar">
     <item name="android:background">@drawable/splash_anim</item>
     <item name="android:windowBackground">#185a83</item>
   </style>
   ```

2. O usa una `SplashActivity` mínima que muestra el `AnimationDrawable` y arranca
   `MainActivity` al terminar (útil si quieres botones de reintento/errores de red).
3. O Lottie: `implementation 'com.airbnb.android:lottie:6.4.0'` + `LottieAnimationView` con tu
   JSON en `assets/`. Es lo más flexible, pero agrega ~2 MB.

En Android 12+ el sistema impone su propio splash (icono + `windowSplashScreenBackground`);
solo permite animar el icono con `windowSplashScreenAnimatedIcon` +
`windowSplashScreenAnimationDuration` (≤ 1000 ms). Por eso lo normal es:
**frame nativo estático de marca + animación real en el splash web (§5.2)**.

### 5.4 Checklist del splash

- [ ] `@capacitor/splash-screen` **no** instalado.
- [ ] `launchShowDuration: 0` y `launchAutoHide: true`.
- [ ] `AppTheme.NoActionBarLaunch` eliminado de `styles.xml` **o** apuntando a tu drawable.
- [ ] `AndroidManifest.xml` apunta a `AppTheme.NoActionBar`.
- [ ] `windowBackground` = color de marca (nada de blanco).
- [ ] `drawable-port-*/splash.png` regenerados con tu icono (no el de Capacitor).
- [ ] Splash web (`#galloli-splash`) que se quita con `load` **y** con un timeout de seguridad.
- [ ] `@media (prefers-reduced-motion)` respetado.

---

## 6. Checklist para replicar en un repo nuevo

1. `npm i -D @capacitor/cli @capacitor/core @capacitor/android`.
2. `capacitor.config.json` con `appId`, `webDir: "www"`, `androidScheme: "https"` y splash
   en `launchShowDuration: 0`.
3. `js/ble-entry.js` (+ `js/ble-bundle.js` como stub) si vas a usar plugins ESM en JS vanilla.
4. `.github/android-src/` con tus `MainActivity` / servicios / receivers — versionados.
5. `.github/scripts/disable_splash.py` y el `sed` del manifest.
6. Workflow con el SDK preinstalado (§3.2) **y sin** `android-actions/setup-android`.
7. Secrets de repo: keystore (`base64`), `GOOGLE_SERVICES_JSON`.
8. Telegram: usar los secrets **de organización** `TELEGRAM_API_ID/HASH/SESSION` y
   `secrets: inherit` si llamas a un workflow reutilizable.
9. `continue-on-error: true` en el paso de Telegram (el artifact ya está subido).
10. Splash animado web (§5.2) + `windowBackground` de marca.

---

## 7. Problemas ya resueltos (para no repetirlos)

| Síntoma | Causa | Solución aplicada |
|---|---|---|
| El job de Android no tiene `sdkmanager` | `android-actions/setup-android@v3` falla en silencio | Usar el SDK del runner + fallback a `commandlinetools` |
| `MESSAGE_TOO_LONG` al enviar a Telegram | caption > 1024 chars | Recortar commit a 400 y caption a 1024 |
| El build se marca rojo aunque el APK se subió | el envío a Telegram es “extra” | `continue-on-error: true` |
| `startForeground()` no arranca en Android 14 | falta `foregroundServiceType` | `connectedDevice\|location` en cada `<service>` |
| `FusedLocationProviderClient` no compila | falta la dependencia | `play-services-location:21.3.0` en `build.gradle` |
| El GPS deja de actualizar con la pantalla apagada | Doze / battery optimization | `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` + exclusión pedida a mano |
| Se ve un frame blanco antes del WebView | `windowBackground` claro | Tema con `#185a83` |
| Se ve el logo de Capacitor al abrir | `AppTheme.NoActionBarLaunch` + `@drawable/splash` | Quitar el estilo y repuntar el tema del manifest |
