# GitHub Actions — GallOli

Workflows reales de este repositorio (2):

| Workflow | Archivo | Trigger | Qué hace |
|---|---|---|---|
| APK Nativo | `workflows/build-android-apk.yml` | push a `apk-native` + manual | APK Capacitor completo (BLE foreground service Kotlin, geofence, FCM), firmado con el keystore de release y enviado al canal de Telegram como `GallOli-Native.apk` |
| APK Básico | `workflows/build-android.yml` | push a `main` + manual | APK Capacitor básico (BLE + FCM), enviado a Telegram como `GallOli.apk` |

No existe un workflow de deploy a Cloudflare Pages: el frontend se publica a mano con
`wrangler pages deploy . --project-name=galloli --branch=main` (ver README raíz).

## Secrets requeridos

Configurar en `Settings > Secrets and variables > Actions`.

| Secret | Uso |
|---|---|
| `GOOGLE_SERVICES_JSON` | Contenido del `google-services.json` de Firebase (FCM) |
| `RELEASE_KEYSTORE` | Keystore de release en base64 (`base64 -w0 galloli-release.keystore`) |
| `KEYSTORE_PASSWORD` | Password del keystore |
| `KEY_ALIAS` | Alias de la clave de firma |
| `KEY_PASSWORD` | Password de la clave |
| `TELEGRAM_API_ID` | API ID de my.telegram.org (script de envío del APK) |
| `TELEGRAM_API_HASH` | API hash de my.telegram.org |
| `TELEGRAM_SESSION` | Sesión de Telethon generada con `.github/scripts/gen_session.py` |

NUNCA escribir tokens ni passwords en este archivo: van como secrets de GitHub o como
variables del entorno del deployment, jamás en el repositorio.

## Pasos clave del build APK

1. `npm install --legacy-peer-deps` + plugins Capacitor.
2. Bundle BLE con esbuild: `js/ble-entry.js` -> `js/ble-bundle.js` (en PWA/TWA queda un stub).
3. `www/` = `index.html`, `css/`, `js/`, `icons/`, `src/` (nativo), `manifest.json`, `sw.js`, `_headers`, `.well-known/`.
4. `npx cap add android` + `npx cap sync android`.
5. Iconos desde `.github/apk-icons/` (mismos que la TWA de Play Store) + splash screens con ImageMagick.
6. Copia de los archivos Java/Kotlin desde `.github/android-src/` (fuente de verdad; `android/` no está en git).
7. `google-services.json` desde el secret + `patch_firebase.py`.
8. Patch de `AndroidManifest.xml` con Python (permisos, servicios foreground, BootReceiver).
9. `play-services-location` en `app/build.gradle` (FusedLocation).
10. Keystore en base64 -> `android/app/galloli-release.keystore` y `./gradlew assembleRelease` con las propiedades `-Pandroid.injected.signing.*`.
11. APK -> artefacto `GallOli-Native-APK` y envío a Telegram.

## Troubleshooting

| Síntoma | Causa típica |
|---|---|
| Build APK falla en "Copy native Java/Kotlin files" | Falta un archivo en `.github/android-src/` |
| Firma falla con `Keystore was tampered with` | `RELEASE_KEYSTORE` no está en base64 o el password no coincide |
| `INSTALL_PARSE_FAILED_MANIFEST_MALFORMED` | `mimeType` inválido en el AndroidManifest (nunca `.json`) |
| Verificación del APK falla con "non-ASCII path" | Falta `android.overridePathCheck=true` en `gradle.properties` |
| No llega el APK a Telegram | Falta `TELEGRAM_SESSION` válida (`gen_session.py`) |

## Recursos

- [GitHub Actions](https://docs.github.com/actions)
- [Capacitor Android](https://capacitorjs.com/docs/android)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
