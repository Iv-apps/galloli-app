#!/usr/bin/env python3
"""Envia el APK nativo de GallOli al canal dedicado de artifacts en Telegram.

Uso (lo llama .github/workflows/build-android-apk.yml):

    python .github/scripts/send_native_apk.py

Reglas de diseno (aprendidas a golpes el 2026-10-06):

1. **Sin prompts interactivos.** Antes se usaba ``async with TelegramClient(...)``.
   Si el ``TELEGRAM_SESSION`` no servia, Telethon pedia el telefono por stdin y el
   paso moria con ``EOFError: EOF when reading a line``. Ahora se usa
   ``connect()`` + ``is_user_authorized()`` y, si la sesion no vale, se explica
   exactamente que hacer.
2. **Nunca "el primer canal que aparezca".** El fallback viejo enviaba el APK al
   primer canal que hubiera en la cuenta: el paso terminaba en verde y el APK
   llegaba a cualquier lado. Ahora, si no se puede resolver el canal destino,
   el script falla.
3. **Canal dedicado.** Se resuelve por @usuario, por enlace de invitacion o por
   titulo exacto. Si no existe, se CREA (canal privado) y se publica su enlace de
   invitacion en el diagnostico.
4. **Siempre hay diagnostico.** Se imprime la cuenta que envia y los canales que
   ve, y se escribe un resumen en ``$GITHUB_STEP_SUMMARY`` para verlo en la UI del run.

Variables de entorno:

    TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION   (obligatorias)
    TELEGRAM_CHANNEL_TITLE     (por defecto "GallOli Artifacts")
    TELEGRAM_CHANNEL_INVITE    (opcional, https://t.me/+xxxxxxxx)
    TELEGRAM_CHANNEL_USERNAME  (opcional, @canal_publico)
    TELEGRAM_CREATE_CHANNEL    ("0" desactiva la creacion automatica del canal)
    TELEGRAM_RESULT_FILE       (por defecto /tmp/telegram_result.json)
    APK_PATH, GITHUB_SHA, GITHUB_RUN_NUMBER, APP_VERSION, COMMIT_MESSAGE

Sale con 0 si el APK se envio y con 1 si no (motivo en el log y en el resumen).
"""

import asyncio
import hashlib
import json
import os
import sys

# En Windows la consola es cp1252 y cualquier emoji revienta el print (y el diagnostico
# se perderia justo cuando mas falta hace). En los runners de Actions ya es UTF-8.
for _flujo in (sys.stdout, sys.stderr):
    try:
        _flujo.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # pragma: no cover - consolas muy viejas
        pass

CHANNEL_TITLE = os.environ.get("TELEGRAM_CHANNEL_TITLE", "GallOli Artifacts")
CHANNEL_INVITE = os.environ.get("TELEGRAM_CHANNEL_INVITE", "").strip()
CHANNEL_USERNAME = os.environ.get("TELEGRAM_CHANNEL_USERNAME", "").strip().lstrip("@")
CHANNEL_ABOUT = "APKs firmados de GallOli (builds automaticos de GitHub Actions)."
CREAR_CANAL = os.environ.get("TELEGRAM_CREATE_CHANNEL", "1") != "0"
APK_PATH = os.environ.get("APK_PATH", "android/app/build/outputs/apk/release/GallOli-Native.apk")
RESULT_FILE = os.environ.get("TELEGRAM_RESULT_FILE", "/tmp/telegram_result.json")

resultado = {"status": "error", "motivo": "no ejecutado"}


def log(msg=""):
    try:
        print(msg, flush=True)
    except Exception:  # pragma: no cover - nunca morir mientras se informa el problema
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)


def guardar_resultado(status, motivo, extra=None):
    resultado.update({"status": status, "motivo": motivo})
    if extra:
        resultado.update(extra)
    try:
        with open(RESULT_FILE, "w", encoding="utf-8") as fh:
            json.dump(resultado, fh, ensure_ascii=False, indent=2)
    except OSError as exc:  # pragma: no cover - solo informativo
        log(f"[aviso] no se pudo escribir {RESULT_FILE}: {exc}")
    resumen = os.environ.get("GITHUB_STEP_SUMMARY")
    if resumen:
        icono = "✅" if status == "ok" else "❌"
        try:
            with open(resumen, "a", encoding="utf-8") as fh:
                fh.write(f"\n### {icono} Envio del APK a Telegram\n\n")
                fh.write(f"- Estado: **{status}**\n")
                fh.write(f"- Detalle: {motivo}\n")
                for clave, valor in (extra or {}).items():
                    fh.write(f"- {clave}: `{valor}`\n")
                fh.write("\n")
        except OSError:
            pass


def fallo(motivo, ayuda="", extra=None):
    # El archivo de resultado y el resumen del run se escriben PRIMERO: aunque el log
    # falle (encoding raro, pipe cerrado), el motivo queda registrado igual.
    guardar_resultado("error", motivo, extra)
    log("")
    log("=" * 72)
    log("NO SE ENVIO EL APK A TELEGRAM")
    log(f"   Motivo: {motivo}")
    if ayuda:
        log("")
        for linea in ayuda.strip().splitlines():
            log(f"   {linea}")
    log("=" * 72)
    sys.exit(1)


def revisar_entorno():
    """Valida los secrets ANTES de intentar hablar con Telegram."""
    faltan = [k for k in ("TELEGRAM_API_ID", "TELEGRAM_API_HASH", "TELEGRAM_SESSION")
              if not os.environ.get(k, "").strip()]
    if faltan:
        fallo(
            f"faltan secrets obligatorios: {', '.join(faltan)}",
            "Configura los secrets de la organizacion Iv-apps (o los del repo):\n"
            "TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION.\n"
            "Se generan con: python .github/scripts/telegram_setup.py",
        )

    try:
        api_id = int(os.environ["TELEGRAM_API_ID"])
    except ValueError:
        fallo("TELEGRAM_API_ID no es un numero", "Debe ser el api_id de https://my.telegram.org")

    session = os.environ["TELEGRAM_SESSION"].strip()
    if len(session) < 60:
        fallo(
            f"TELEGRAM_SESSION tiene {len(session)} caracteres: no es una StringSession valida",
            "Una sesion real de Telethon ocupa varios cientos de caracteres.\n"
            "Regenerala con: python .github/scripts/telegram_setup.py",
        )

    # Huella para comparar repo vs organizacion sin exponer el valor
    huella = hashlib.sha256(session.encode()).hexdigest()[:12]
    log(f"[info] session: {len(session)} chars, sha256[:12]={huella}")
    return api_id, os.environ["TELEGRAM_API_HASH"].strip(), session


async def diagnosticar(client):
    """Imprime quien envia y que canales ve. Es el contexto que faltaba cuando fallaba."""
    lineas = []
    try:
        me = await client.get_me()
        identidad = f"id={me.id} @{me.username or '-'} nombre={me.first_name or '-'}"
        lineas.append(f"Cuenta que envia: {identidad}")
        log(f"[diag] {identidad}")
    except Exception as exc:  # pragma: no cover - depende de la red
        lineas.append(f"No se pudo leer la cuenta: {exc}")

    canales = []
    try:
        async for dialog in client.iter_dialogs():
            if dialog.is_channel:
                canales.append(f"{dialog.name} (id={dialog.id}, @{dialog.username or 'privado'})")
    except Exception as exc:  # pragma: no cover
        lineas.append(f"No se pudieron listar los dialogos: {exc}")

    lineas.append(f"Canales visibles para esa cuenta ({len(canales)}):")
    lineas.extend(f"  - {c}" for c in canales[:40])
    for linea in lineas[1:]:
        log(f"[diag] {linea}")
    return lineas


async def resolver_canal(client):
    """Devuelve (entidad, origen). Determinista: nunca cae a "el primer canal"."""
    # 1) @usuario publico
    if CHANNEL_USERNAME:
        try:
            entidad = await client.get_entity(f"@{CHANNEL_USERNAME}")
            return entidad, f"username @{CHANNEL_USERNAME}"
        except Exception as exc:
            log(f"[aviso] no se pudo resolver @{CHANNEL_USERNAME}: {exc}")

    # 2) enlace de invitacion
    if CHANNEL_INVITE:
        try:
            entidad = await client.get_entity(CHANNEL_INVITE)
            return entidad, "enlace de invitacion"
        except Exception as exc:
            log(f"[aviso] {CHANNEL_INVITE} no resuelto directo ({exc}); intentando unirse...")
            try:
                from telethon.tl.functions.messages import ImportChatInviteRequest

                hash_parte = CHANNEL_INVITE.rstrip("/").split("+")[-1]
                await client(ImportChatInviteRequest(hash_parte))
                entidad = await client.get_entity(CHANNEL_INVITE)
                return entidad, "enlace de invitacion (nos unimos)"
            except Exception as exc2:
                log(f"[aviso] no se pudo unir por invitacion: {exc2}")

    # 3) titulo exacto entre los canales de la cuenta
    candidatos = []
    async for dialog in client.iter_dialogs():
        if dialog.is_channel and (dialog.name or "").strip() == CHANNEL_TITLE:
            candidatos.append(dialog)
    if len(candidatos) == 1:
        return candidatos[0].entity, f"titulo exacto '{CHANNEL_TITLE}'"
    if len(candidatos) > 1:
        log(f"[aviso] hay {len(candidatos)} canales llamados '{CHANNEL_TITLE}'")

    # 4) crearlo
    if CREAR_CANAL:
        log(f"[info] el canal '{CHANNEL_TITLE}' no existe: creandolo (privado)...")
        from telethon.tl.functions.channels import CreateChannelRequest

        creado = await client(
            CreateChannelRequest(title=CHANNEL_TITLE, about=CHANNEL_ABOUT,
                                 megagroup=False, broadcast=True)
        )
        entidad = creado.chats[0]
        enlace = ""
        try:
            from telethon.tl.functions.messages import ExportChatInviteRequest

            invitacion = await client(ExportChatInviteRequest(entidad))
            enlace = getattr(invitacion, "link", "")
        except Exception as exc:
            log(f"[aviso] no se pudo exportar la invitacion: {exc}")
        if enlace:
            log(f"[info] enlace de invitacion del canal nuevo: {enlace}")
            log("[info] guardalo en el secret TELEGRAM_CHANNEL_INVITE para futuros runs")
        return entidad, f"canal recien creado ({enlace or 'sin enlace'})"

    return None, f"no encontrado (creacion desactivada, TELEGRAM_CREATE_CHANNEL={os.environ.get('TELEGRAM_CREATE_CHANNEL')})"


async def enviar():
    api_id, api_hash, session = revisar_entorno()

    if not os.path.exists(APK_PATH):
        fallo(f"APK no encontrado en {APK_PATH}",
              "Revisa el paso 'Rename APK' del workflow.")

    tamano_mb = os.path.getsize(APK_PATH) / 1024 / 1024
    commit_sha = os.environ.get("GITHUB_SHA", "unknown")[:7]
    commit_msg = os.environ.get("COMMIT_MESSAGE", "sin mensaje").strip().replace("\r", "")
    if len(commit_msg) > 400:
        commit_msg = commit_msg[:400].rstrip() + "..."
    run_number = os.environ.get("GITHUB_RUN_NUMBER", "?")
    app_version = os.environ.get("APP_VERSION", "?")

    try:
        from telethon import TelegramClient
        from telethon.sessions import StringSession
    except ImportError:
        fallo("la libreria telethon no esta instalada",
              "El workflow debe ejecutar 'pip install telethon' antes de este paso.")

    client = TelegramClient(StringSession(session), api_id, api_hash)

    try:
        # connect() NO pide telefono por stdin (eso es lo que rompia el CI).
        await client.connect()
    except Exception as exc:
        fallo(f"no se pudo conectar con Telegram: {exc}",
              "Suele ser TELEGRAM_API_ID/HASH invalidos o falta de red en el runner.")

    try:
        if not await client.is_user_authorized():
            fallo(
                "TELEGRAM_SESSION existe pero Telegram la rechaza (sesion caducada, revocada o de otra cuenta)",
                "Arreglo:\n"
                "1) En tu PC: python .github/scripts/telegram_setup.py\n"
                "2) Pega el TELEGRAM_SESSION que imprime en los secrets del repo\n"
                "   (Settings -> Secrets and variables -> Actions).\n"
                "OJO: un secret de REPO pisa al de ORGANIZACION. Si la sesion buena esta\n"
                "en la organizacion, borra la copia del repo en vez de duplicarla.",
                {"session_sha256_12": hashlib.sha256(session.encode()).hexdigest()[:12]},
            )

        lineas_diag = await diagnosticar(client)

        try:
            canal, origen = await resolver_canal(client)
        except Exception as exc:
            fallo(f"error resolviendo el canal '{CHANNEL_TITLE}': {exc}", "\n".join(lineas_diag))

        if canal is None:
            fallo(
                f"no se encontro el canal '{CHANNEL_TITLE}' y no se puede crear",
                f"Origen: {origen}\n" + "\n".join(lineas_diag) +
                "\n\nArreglo: crea el canal y guarda su enlace en el secret\n"
                "TELEGRAM_CHANNEL_INVITE, o deja que el script lo cree (TELEGRAM_CREATE_CHANNEL=1).",
            )

        log(f"[info] canal destino: {origen}")

        caption = (
            f"🤖 GallOli APK Nativo — Build #{run_number}\n\n"
            f"📦 Versión: {app_version}\n"
            f"📁 Archivo: {os.path.basename(APK_PATH)} ({tamano_mb:.1f} MB)\n"
            f"🔑 Tipo: Release (firmado con keystore)\n"
            f"🌿 Branch: apk-native\n"
            f"📝 Commit: {commit_sha}\n"
            f"💬 Mensaje: {commit_msg}\n\n"
            f"✅ Incluye: BLE background, GPS geofence, venta automática, BootReceiver\n"
            f"📲 Instalar: Habilitar fuentes desconocidas en Android y abrir el APK"
        )
        if len(caption) > 1024:
            caption = caption[:1020] + "..."

        enviado = await client.send_file(canal, APK_PATH, caption=caption, force_document=True)
        log(f"[info] mensaje enviado: id={enviado.id}")

        # Verificacion real: el mensaje tiene que estar en el canal
        try:
            async for ultimo in client.iter_messages(canal, limit=1):
                if ultimo.id == enviado.id:
                    log("[ok] verificado: el APK es el ultimo mensaje del canal")
                else:
                    log(f"[aviso] el ultimo mensaje del canal es id={ultimo.id}, no {enviado.id}")
        except Exception as exc:
            log(f"[aviso] no se pudo verificar leyendo el canal: {exc}")

    except SystemExit:
        raise
    except Exception as exc:
        fallo(f"error inesperado al enviar: {type(exc).__name__}: {exc}",
              "Si es FloodWait, espera y vuelve a lanzar el workflow.")
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass

    nombre = getattr(canal, "title", None) or getattr(canal, "username", None) or str(getattr(canal, "id", "?"))
    motivo = f"APK enviado a '{nombre}' ({origen})"
    log("")
    log(f"OK: {motivo}")
    guardar_resultado("ok", motivo, {
        "canal": nombre,
        "origen": origen,
        "mensaje_id": getattr(enviado, "id", "?"),
        "apk_mb": f"{tamano_mb:.1f}",
        "version": app_version,
    })


if __name__ == "__main__":
    asyncio.run(enviar())
