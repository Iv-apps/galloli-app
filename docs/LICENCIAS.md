# Licencias y activación — GallOli

GallOli incluye un sistema de licencias por copia: **una copia vendida = un negocio = un código**.
Sin un código activo la app sigue funcionando al 100 % en el dispositivo (vender, cobrar,
reportes, respaldos), pero **no sincroniza** con la nube.

---

## 1. Cómo se activa (dueño del negocio)

1. Inicia sesión como dueño (`super_admin`) o `admin`.
2. Ve a **Sincronización en la Nube** y pega el código en la tarjeta *Licencia* (o pulsa
   **Activar licencia** en el aviso rojo de la parte inferior).
3. Listo: la sincronización se reactiva sola, sin reinstalar ni reiniciar nada.

El estado de la licencia se ve siempre en esa misma tarjeta: titular, número de licencia, plan,
dominio autorizado y fecha de vencimiento (o "nunca" si es perpetua).

Sólo `super_admin` y `admin` pueden activar; el Worker lo verifica además del lado del servidor.

---

## 2. Los dos modos

Todo se controla desde `workers/wrangler.toml`:

| Modo | Configuración | Comportamiento |
|---|---|---|
| **Abierto** | `LICENSE_PUBLIC_KEY = ""` (vacío) | No se exige licencia. La sincronización funciona para cualquier negocio. Es el estado por defecto del repositorio. |
| **Licencia** | `LICENSE_PUBLIC_KEY = "<tu clave>"` y `LICENSE_ENFORCED = "1"` | Cada negocio debe activar su código para sincronizar. |

Notas:

- `LICENSE_ENFORCED = "0"` desactiva la exigencia **aunque haya clave pública** (útil para
  pruebas o para vender sin licencias).
- Si no hay clave pública configurada, el servidor ignora `LICENSE_ENFORCED = "1"`.
- Si hay clave pública y `LICENSE_ENFORCED = "1"` pero la tabla `licenses` no existe, el Worker
  **no bloquea** la sincronización: escribe el error en los logs. Así un olvido de migración no
  deja sin nube a un negocio que sí pagó.

---

## 3. Emitir códigos

La herramienta es `tools/licencias.js` (sólo necesita Node, nada que instalar).

```bash
# 1) Una sola vez: crea el par de claves
node tools/licencias.js --init
#    → licencia-privada.pem  (SECRETA: no se comparte ni se sube a Git)
#    → licencia-publica.pem  (va al Worker)

# 2) Copia la clave pública a workers/wrangler.toml
node tools/licencias.js --publica

# 3) Un código por cada copia vendida
node tools/licencias.js --emitir \
     --negocio "Pollos El Buen Sabor" \
     --dominio mi-sync.mi-cuenta.workers.dev \
     --dias 365 --guardar
```

Opciones de `--emitir`:

| Opción | Para qué |
|---|---|
| `--negocio "..."` | Obligatorio. A quién se le vendió (se ve en su app). |
| `--dominio host[,host]` | Ata el código a esos dominios. `"*"` = cualquiera. Recomendado: el subdominio del Worker del comprador. |
| `--dias N` | Validez en días (por defecto 365). |
| `--perpetua` | Sin vencimiento. |
| `--plan` | Etiqueta libre (por defecto `pro`). |
| `--max-usuarios N` | Informativo para tu registro (0 = sin límite). |
| `--notas "..."` | Comentario para tu registro. |
| `--guardar` | Añade una fila a `licencias-emitidas.csv`. |

Otros comandos: `--info CODIGO` (verifica y muestra los datos), `--selftest` (comprueba que
firmar y verificar funcionan contra el verificador real del Worker), `--ayuda`.

> **Sin `--dominio` el código queda atado a `"*"`**, es decir, sirve en cualquier despliegue.
> Para vender, ata siempre el código al Worker del comprador. La herramienta te avisa cuando no
> lo haces.

---

## 4. Cómo funciona por dentro

### Formato del código

```
GALLOLI1.<payload_base64url>.<firma_base64url>
```

`payload` (JSON compacto):

| Campo | Significado |
|---|---|
| `v` | Versión del formato (hoy `1`). |
| `s` | Número de licencia (serial corto, visible en la app). |
| `l` | Licenciatario (nombre del negocio comprador). |
| `d` | Dominio(s) autorizados, separados por coma. `"*"` = cualquiera. Cadena vacía = sin atar. |
| `p` | Plan (etiqueta libre). |
| `u` | Máximo de usuarios (informativo). |
| `i` | Fecha de emisión (ms). |
| `e` | Vencimiento (ms) o `null` si es perpetua. |

La firma es **ECDSA P-256 con SHA-256** sobre la cadena `GALLOLI1.<payload>`. Se eligió ese
algoritmo porque es el estándar soportado por WebCrypto tanto en Cloudflare Workers como en el
navegador y en Node, así que no hace falta ninguna dependencia.

### Verificación y activación

1. La app manda el código a `POST /api/license/activate`.
2. El Worker verifica la firma **sin conexión** contra las claves públicas de confianza
   (`LICENSE_PUBLIC_KEY` y, si existe, `LICENSE_PUBLIC_KEYS` con un JSON de claves extra).
3. Comprueba que no esté vencido y que el host del Worker esté entre los dominios autorizados.
4. Guarda la licencia en D1, atada al negocio. **Nunca guarda el código en claro**: sólo su
   `sha256`. Si el mismo código intenta activarse en otro negocio, se rechaza.
5. Un negocio tiene una sola licencia activa: activar una nueva reemplaza la anterior.

### La puerta de sincronización

`/api/sync/*` (push, pull, full, cleanup-duplicates) llama a `bloqueoPorLicencia()` **antes** de
tocar los datos. Si no hay licencia válida responde:

```json
{ "error": "licencia_requerida", "code": "license_required", "message": "...", "license": { ... } }
```

con HTTP **402**. El frontend detecta ese 402 con un envoltorio de `fetch` (`js/license.js`,
`_installFetchWatcher`) y muestra el aviso con el botón de activación, así que no hace falta
recargar la app.

### Archivos del sistema

| Archivo | Rol |
|---|---|
| `workers/license.js` | Verificación de firmas, estado y puerta de licencia (todo el lado servidor). |
| `workers/index.js` | Rutas `/api/license/status`, `/api/license/activate`, `/api/license/deactivate` y la puerta en `handleSync`. |
| `workers/schema.sql` | Tabla `licenses` (se crea con el resto del esquema). |
| `js/license.js` | Aviso, modal de activación, tarjeta de estado y detección del 402. |
| `js/auth.js` | `AuthManager.getLicenseStatus()` y `activateLicense(code)`. |
| `tools/licencias.js` | Emisión de códigos (herramienta del vendedor/comprador, nunca se ejecuta en el servidor). |

---

## 5. API

| Método y ruta | Quién | Qué hace |
|---|---|---|
| `GET /api/license/status` | Cualquier usuario autenticado | Devuelve el estado (`exigida`, `activa`, `plan`, `licenciatario`, `serial`, `dominio`, `expira`, `dias_restantes`, `vencida`, `mensaje`). |
| `POST /api/license/activate` | `super_admin`, `admin` | Activa con `{ "code": "GALLOLI1...." }`. |
| `POST /api/license/deactivate` | `super_admin`, `admin` | Quita la licencia de este negocio (para probar el modo bloqueado). |

---

## 6. Revocar o corregir una licencia

Como la licencia vive en tu D1, puedes gestionarla con SQL:

```bash
# ver las licencias activas
wrangler d1 execute galloli --remote --command "SELECT serial, licensee, domain, expires_at FROM licenses WHERE revoked = 0"

# revocar una
wrangler d1 execute galloli --remote --command "UPDATE licenses SET revoked = 1 WHERE serial = 'ABC12345'"

# dar más tiempo a un cliente
wrangler d1 execute galloli --remote --command "UPDATE licenses SET expires_at = 1893456000000 WHERE serial = 'ABC12345'"
```

Tras revocar, el negocio vuelve al modo local en su siguiente sincronización (no pierde datos:
la app sigue funcionando y la nube se reactiva al activar otra licencia).

---

## 7. Rodar las claves (si alguna vez se filtra la privada)

1. `node tools/licencias.js --init` (con el archivo viejo borrado o movido).
2. Emite códigos nuevos y entrégalos a tus clientes.
3. Pon la clave nueva en `LICENSE_PUBLIC_KEY` **y** la vieja en `LICENSE_PUBLIC_KEYS`
   (`["clave_vieja"]`) si quieres que las licencias ya emitidas sigan valiendo durante un tiempo.
4. Cuando todos hayan migrado, quita `LICENSE_PUBLIC_KEYS` y vuelve a desplegar.

---

## 8. Qué protege y qué no (importante)

**Sí protege:**

- Nadie sin tu clave privada puede fabricar un código válido: la firma es asimétrica.
- Un código emitido para un dominio no funciona en otro.
- El código no se guarda en claro (sólo su hash) y no se puede reutilizar en otro negocio.
- Un tercero que copie el ZIP no puede activar su copia, porque las claves están fuera del ZIP.

**No protege:**

- A quien tiene **control total del servidor** (el comprador). Como es software auto-alojado,
  quien despliega el Worker puede editar el código y el `wrangler.toml` para levantar la puerta.
  Ningún esquema que corra en el servidor del cliente puede evitarlo.

Por eso la protección real es la combinación de: códigos firmados + `--dominio` + licencia de uso
que prohíbe la reventa (`LICENSE.txt` del paquete) + no compartir nunca `licencia-privada.pem`.

Si necesitas control real sobre copias ya desplegadas (poder apagar una copia a distancia), hace
falta un servidor de licencias central que consulte la app: eso ya no es auto-alojado y añade una
dependencia de infraestructura propia.
