# GallOli — Guía de puesta en marcha

¡Gracias por tu compra! Esto es lo que tienes y cómo dejarlo funcionando **con tus propios
datos**. Nada de lo que viene apunta a la infraestructura del vendedor: todos esos valores
quedaron como placeholders (`TU-WORKER...`, `TU_D1_DATABASE_ID`, ...) para que los reemplaces
tú.

- **Qué es**: una aplicación de gestión (ventas, pedidos, clientes, créditos, merma,
  contabilidad, rutas, backup) que funciona como **PWA** (se instala desde el navegador), como
  **APK** de Android (Capacitor, con balanza Bluetooth, GPS y venta automática) y como **TWA**
  para publicar en Google Play.
- **Arquitectura**: front estático + un **Worker de Cloudflare** (`workers/`) con una base de
  datos **D1** para la sincronización en la nube, códigos de invitación, usuarios y roles.
- **Tiempo de puesta en marcha**: 40–60 minutos la primera vez.
- **Coste de infraestructura**: el plan gratuito de Cloudflare alcanza para empezar. Un dominio
  propio es opcional (para la PWA conviene tenerlo).

---

## 0. Requisitos

| Necesitas | Para qué |
|---|---|
| Node.js 20 o superior | `npm`, Wrangler y Capacitor |
| Una cuenta de Cloudflare (gratis) | Worker + D1 + Pages |
| Una cuenta de GitHub (gratis) | compilar el APK con Actions |
| Java 21 + Android Studio (opcional) | compilar el APK en tu PC en lugar de GitHub |
| Un dominio (opcional) | PWA/TWA "de verdad" y enlaces estables |

**Lee primero**: `README.md` (el proyecto completo) y `docs/APK_CAPACITOR_TELEGRAM.md`
(la guía técnica de Capacitor, permisos nativos, compilación del APK y splash animado).

---

## 1. Personaliza con tus datos (1 comando)

```bash
# mira qué cambiaría, sin escribir nada
python tools/personalizar.py --placeholders --dry-run

# aplica tus datos
python tools/personalizar.py \
  --worker-url https://TU-WORKER.TU-SUBDOMINIO.workers.dev \
  --d1-id TU_D1_DATABASE_ID \
  --app-id com.tunegocio.galloli \
  --dominio tudominio.com \
  --org-github TU-ORG-GITHUB \
  --usuario-github TU-USUARIO-GITHUB \
  --invite-telegram https://t.me/+TU_INVITACION
```

Cambia la URL del worker, el id de D1, el `applicationId` de Android, el dominio, tu
organización/usuario de GitHub, la huella del keystore (`.well-known/assetlinks.json`) y el
canal de Telegram. Los valores que no pases quedan como placeholder para que los encuentres
con `grep -rn "TU_" .`.

**Poner tu marca es opcional** (el producto se llama GallOli, pero es tu decisión):

```bash
python tools/personalizar.py --marca "Mi Pollo" --marca-slug mipollo
```

---

## 2. Base de datos y Worker (Cloudflare)

```bash
npm install -g wrangler          # o usa npx
wrangler login                   # abre el navegador y autoriza

# 1) Base de datos D1
wrangler d1 create galloli       # copia el database_id al wrangler.toml
cd workers
# 2) Tablas
wrangler d1 execute galloli --remote --file=schema.sql

# 3) Secrets del Worker (te los pide uno por uno)
wrangler secret put JWT_SECRET                 # inventa una cadena larga y aleatoria
wrangler secret put VAPID_PUBLIC_KEY           # notificaciones web push
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put FCM_PROJECT_ID             # push nativo (Firebase Cloud Messaging)
wrangler secret put FCM_SERVICE_ACCOUNT_JSON   # el JSON de la cuenta de servicio, en una línea
wrangler secret put TELEGRAM_BOT_TOKEN         # códigos de verificación por Telegram
wrangler secret put FEEDBACK_BOT_TOKEN         # opcional: formulario de feedback

# 4) Despliega
wrangler deploy
```

> Los secrets que el código realmente lee son los que aparecen en
> `grep -o "env\.[A-Z_]*" workers/*.js | sed 's/.*env\.//' | sort -u`. Si agregas funciones
> (por ejemplo facturación electrónica), revisa `workers/facturacion-sri.js`.
> Los **valores de ejemplo NO vienen incluidos**: las claves de push, el JWT y los tokens son
> tuyos y se generan en tu cuenta.

Después de `wrangler deploy`, actualiza `--worker-url` en `js/auth.js` (o vuelve a correr
`tools/personalizar.py`) para que el front apunte a **tu** worker.

**Variables y bindings del `workers/wrangler.toml`** (ya están listos): binding `DB` (D1),
`SESSION_MANAGER` (Durable Object) y los `crons` de respaldo/recordatorios.

---

## 3. Publica la PWA (Cloudflare Pages)

Desde la raíz del proyecto:

```bash
npx wrangler pages project create mi-galloli        # la primera vez
npx wrangler pages deploy . --project-name=mi-galloli --branch=main
```

- En el panel de Pages puedes conectar tu dominio (`tudominio.com`) y forzar HTTPS.
- El archivo `_headers` ya define las cabeceras de caché y seguridad.
- **Antes de cada despliegue** sube `APP_VERSION` en `sw.js` (y en `version.json` y
  `package.json`): así los equipos que ya tienen la app instalada reciben la actualización.

---

## 4. Tu primer usuario (dueño)

No hay usuarios "sembrados" y **no hay contraseñas de ejemplo**: el primer registro crea tu
negocio y te da el rol de dueño.

1. Abre la PWA.
2. Ve a **Sincronización → Crear cuenta** y regístrate con tu email y contraseña
   (déjalo **sin** código de invitación: así se crea un negocio nuevo y tu usuario queda como
   `super_admin`, el dueño).
3. Desde ahí ya puedes crear **códigos de invitación** para que tus vendedores/contadores se
   registren dentro de tu negocio.

Los roles disponibles son `super_admin`, `admin`, `vendedor`, `contador` y `viewer`, con la
matriz de permisos en `js/permissions.js` (quién puede borrar ventas, editar precios, etc.).

---

## 5. APK de Android con GitHub Actions (sin instalar nada)

1. Sube el proyecto a un repositorio **privado** de tu cuenta (recomendado: código privado,
   secretos privados).
2. Crea tu keystore de firma (guárdalo y no lo pierdas: sin él no podrás actualizar el APK):

```bash
keytool -genkeypair -v -keystore mi-release.jks -alias minegocio \
        -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 mi-release.jks > mi-release.jks.b64      # Windows: usa Git Bash
```

3. En GitHub → *Settings → Secrets and variables → Actions*, crea estos secretos:

| Secreto | Contenido |
|---|---|
| `RELEASE_KEYSTORE` | el contenido de `mi-release.jks.b64` |
| `KEYSTORE_PASSWORD` | contraseña del keystore |
| `KEY_ALIAS` | alias (`minegocio`) |
| `KEY_PASSWORD` | contraseña de la clave |
| `GOOGLE_SERVICES_JSON` | tu `google-services.json` (solo si usas push con Firebase) |

4. **Tus datos de Firebase son tuyos**: crea un proyecto en Firebase, agrega una app Android
   con tu `applicationId` y pega el `google-services.json` como secreto. Sin esto, la app
   compila igual pero sin notificaciones push nativas.
5. Ejecuta el workflow **Build GallOli APK Nativo** (`workflow_dispatch`) o haz push: el APK
   queda como *artifact* `GallOli-Native-APK` en el run.

### Enviar el APK a tu Telegram (opcional, muy cómodo)

```bash
pip install telethon
python .github/scripts/telegram_setup.py         # inicia sesión y crea tu canal privado
```

El script imprime `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` y `TELEGRAM_SESSION` (y el enlace del
canal). Guárdalos como secretos del repo. Desde ese momento cada build te llega al móvil.
Si el envío falla, **el run te lo dice** en el resumen y con una anotación de error (el APK
igual queda como artifact).

---

## 6. Publicar en Google Play (TWA, opcional)

El proyecto incluye `build-android.yml`, que genera un **AAB** de tipo TWA.

1. Instala Bubblewrap y genera el proyecto TWA desde tu PWA publicada.
2. Rellena `.well-known/assetlinks.json` con **dos cosas**:
   - tu `applicationId` (`com.tunegocio.galloli`),
   - la **huella SHA-256 de firma de Google Play** (Play Console → *App integrity* →
     *App signing key certificate*). Ojo: si publicas con *Play App Signing*, la huella buena
     es la de Play, **no** la de tu keystore local. Es el error clásico que hace que la app
     instalada desde Play abra con barra de direcciones.
3. Sube el AAB a Play Console y espera la revisión.

---

## 7. Tu marca (iconos y colores)

- Iconos: `icons/favicon.pub/` (favicons y PWA) y `.github/apk-icons/` (iconos del APK, por
  densidad). Reemplázalos manteniendo los nombres.
- `manifest.json`: `name`, `short_name`, `theme_color`, `background_color`.
- `index.html`: `<title>` y el `<meta name="theme-color">`.
- El splash animado está en `index.html` (`#galloli-splash`) y su lógica en `js/app.js`
  (`App.hideSplash()`); el color de fondo `#185a83` coincide con el tema Android, cámbialo en
  los dos sitios si cambias de color de marca.

---

## 8. Datos, respaldos y seguridad

- **Tus datos viven en dos sitios**: el dispositivo (IndexedDB + localStorage) y tu D1 en
  Cloudflare. El módulo *Backup* exporta e importa todo en un JSON.
- `JWT_SECRET` es lo único que protege las sesiones: si lo cambias, todos los usuarios tendrán
  que volver a iniciar sesión.
- No subas a Git tu keystore, tu `google-services.json` ni tus tokens: el `.gitignore` ya los
  excluye.
- Respalda D1 de vez en cuando: `wrangler d1 export galloli --remote --output=respaldo.sql`.
- Para borrar la cuenta de un usuario desde Google Play se incluye `delete-account.html`.

---

## 9. Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| La app no sincroniza / "error de red" | `js/auth.js` sigue apuntando al worker del vendedor: vuelve a correr `tools/personalizar.py --worker-url ...` |
| `no such table: ...` en el worker | no ejecutaste `schema.sql` en tu D1 |
| El worker responde 401 a todo | falta `JWT_SECRET` o cambió (los tokens viejos dejan de valer) |
| La PWA no se actualiza | no subiste `APP_VERSION` en `sw.js`/`version.json`/`package.json` |
| La app de Play abre con barra de direcciones | la huella de `assetlinks.json` no es la de Play App Signing |
| El APK no instala encima del anterior | firmaste con otro keystore; **usa siempre el mismo** |
| La balanza Bluetooth no conecta | concede los permisos de Bluetooth y ubicación (background) — ver `docs/APK_CAPACITOR_TELEGRAM.md` §2 |
| El GPS no actualiza con la pantalla apagada | hay que excluir la app de la optimización de batería (la app lo pide sola) |

---

## 10. Checklist final

- [ ] `python tools/personalizar.py` ejecutado con **mis** datos (y `grep -rn "TU_" .` para confirmar que no queda ninguno).
- [ ] D1 creado + `schema.sql` aplicado + secrets del Worker puestos.
- [ ] Worker desplegado y `js/auth.js` apuntando a mi worker.
- [ ] PWA publicada en Pages + dominio + HTTPS.
- [ ] Mi usuario registrado como `super_admin` y códigos de invitación creados.
- [ ] Keystore propio generado y respaldado; secretos del APK en GitHub.
- [ ] `google-services.json` propio (si uso push nativo).
- [ ] `assetlinks.json` con mi paquete y la huella de Play (si publico en Play).
- [ ] Iconos y colores cambiados (si quiero mi marca).

¿Dudas de la parte nativa (Capacitor, permisos, servicios en segundo plano, splash)? Está todo
detallado en `docs/APK_CAPACITOR_TELEGRAM.md`.
