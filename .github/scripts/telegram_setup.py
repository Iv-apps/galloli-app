#!/usr/bin/env python3
"""Prepara la entrega de artifacts de GallOli por Telegram (se ejecuta a mano, una vez).

El CI no puede iniciar sesion en Telegram por ti (hace falta tu telefono y el codigo
que llega a la app). Este script hace todo eso y ademas:

1. Inicia sesion con tu cuenta (telefono + codigo + contrasena de 2FA si la tienes).
2. Busca -o crea- el canal privado **GallOli Artifacts** y obtiene su enlace de invitacion.
3. Imprime el ``TELEGRAM_SESSION`` listo para guardar como secret.
4. Opcionalmente (``--push-secrets``) sube los secrets al repo ``Iv-apps/galloli-app``
   usando ``GITHUB_TOKEN``; con ``--limpiar-secrets-de-repo`` borra las copias viejas
   del repo para que vuelvan a aplicar las de la organizacion.

Como usarlo en tu PC:

    pip install telethon            # una sola vez
    python .github/scripts/telegram_setup.py

Con nexus (asi GITHUB_TOKEN va inyectado y puede subir los secrets solo):

    nexus run -e production -- python .github/scripts/telegram_setup.py --push-secrets

Necesitas tu api_id y api_hash de https://my.telegram.org (API development tools).
"""

import argparse
import asyncio
import base64
import json
import os
import sys
import urllib.error
import urllib.request

REPO = os.environ.get("GALLLOLI_REPO") or "Iv-apps/galloli-app"
CHANNEL_TITLE = os.environ.get("TELEGRAM_CHANNEL_TITLE", "GallOli Artifacts")
CHANNEL_ABOUT = "APKs firmados de GallOli (builds automaticos de GitHub Actions)."


def pedir(nombre, default=""):
    valor = os.environ.get(nombre, "").strip()
    if valor:
        return valor
    etiqueta = f"{nombre} [{default}]: " if default else f"{nombre}: "
    valor = input(etiqueta).strip() or default
    return valor


# ----------------------------------------------------------------------------
# Subida de secrets a GitHub (opcional)
# ----------------------------------------------------------------------------

def github_request(metodo, ruta, token, payload=None):
    url = f"https://api.github.com{ruta}"
    datos = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=datos, method=metodo)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if datos:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            cuerpo = resp.read().decode() or "{}"
            return resp.status, json.loads(cuerpo)
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode() or "{}")


def subir_secret(token, nombre, valor, clave_publica, clave_id):
    try:
        from nacl import encoding, public
    except ImportError:
        return False, "falta PyNaCl (pip install pynacl)"

    caja = public.SealedBox(public.PublicKey(clave_publica.encode(), encoding.Base64Encoder()))
    cifrado = base64.b64encode(caja.encrypt(valor.encode())).decode()
    estado, _ = github_request(
        "PUT", f"/repos/{REPO}/actions/secrets/{nombre}", token,
        {"encrypted_value": cifrado, "key_id": clave_id},
    )
    return estado in (201, 204), f"HTTP {estado}"


def gestionar_secrets(token, valores):
    estado, datos = github_request("GET", f"/repos/{REPO}/actions/secrets/public-key", token)
    if estado != 200:
        print(f"⚠️  No se pudo leer la clave publica del repo ({estado}). Sube los secrets a mano.")
        return
    clave_id, clave_publica = datos["key_id"], datos["key"]
    for nombre, valor in valores.items():
        if not valor:
            continue
        ok, detalle = subir_secret(token, nombre, valor, clave_publica, clave_id)
        print(f"{'✅' if ok else '⚠️ '} secret {nombre}: {detalle}")


def limpiar_secrets_repo(token):
    for nombre in ("TELEGRAM_API_ID", "TELEGRAM_API_HASH", "TELEGRAM_SESSION"):
        estado, _ = github_request("DELETE", f"/repos/{REPO}/actions/secrets/{nombre}", token)
        print(f"{'🗑️ ' if estado in (204, 404) else '⚠️ '} borrar secret de repo {nombre}: HTTP {estado}")
    print("ℹ️  Con las copias del repo borradas vuelven a aplicar los secrets de la organizacion Iv-apps.")


# ----------------------------------------------------------------------------
# Telegram
# ----------------------------------------------------------------------------

async def preparar(api_id, api_hash):
    from telethon import TelegramClient
    from telethon.sessions import StringSession
    from telethon.tl.functions.channels import CreateChannelRequest
    from telethon.tl.functions.messages import ExportChatInviteRequest

    print("\n--- Iniciando sesion en Telegram (te pedira telefono y codigo) ---")
    async with TelegramClient(StringSession(), api_id, api_hash) as client:
        me = await client.get_me()
        print(f"✅ Sesion iniciada como {me.first_name} (id={me.id}, @{me.username or '-'})")

        canal = None
        async for dialog in client.iter_dialogs():
            if dialog.is_channel and (dialog.name or "").strip() == CHANNEL_TITLE:
                canal = dialog.entity
                print(f"ℹ️  Canal encontrado: {dialog.name} (id={dialog.id})")
                break

        if canal is None:
            print(f"ℹ️  Creando canal privado '{CHANNEL_TITLE}'...")
            creado = await client(
                CreateChannelRequest(title=CHANNEL_TITLE, about=CHANNEL_ABOUT,
                                     megagroup=False, broadcast=True)
            )
            canal = creado.chats[0]

        invitacion = ""
        try:
            exp = await client(ExportChatInviteRequest(canal))
            invitacion = getattr(exp, "link", "")
        except Exception as exc:
            print(f"⚠️  No se pudo exportar la invitacion: {exc}")

        return client.session.save(), invitacion


def main():
    parser = argparse.ArgumentParser(description="Configura Telegram para los builds de GallOli")
    parser.add_argument("--push-secrets", action="store_true",
                        help="sube TELEGRAM_API_ID/HASH/SESSION (+ invitacion) a los secrets del repo")
    parser.add_argument("--limpiar-secrets-de-repo", action="store_true",
                        help="borra las copias a nivel de repo para que apliquen las de la organizacion")
    args = parser.parse_args()

    token = os.environ.get("GITHUB_TOKEN", "").strip()

    if args.limpiar_secrets_de_repo:
        if not token:
            print("❌ Necesito GITHUB_TOKEN para tocar los secrets del repo.")
            return 1
        limpiar_secrets_repo(token)
        print("\nAhora relanza el workflow de APK: si la sesion de la organizacion sigue viva, el APK llegara.")
        return 0

    api_id = pedir("TELEGRAM_API_ID")
    api_hash = pedir("TELEGRAM_API_HASH")
    if not api_id.isdigit() or not api_hash:
        print("❌ Necesito api_id (numerico) y api_hash de https://my.telegram.org")
        return 1

    session, invitacion = asyncio.run(preparar(int(api_id), api_hash))

    print("\n" + "=" * 72)
    print("Guarda estos valores como secrets del repo (Settings -> Secrets and variables -> Actions):")
    print("=" * 72)
    print(f"\nTELEGRAM_API_ID\n  {api_id}")
    print(f"\nTELEGRAM_API_HASH\n  {api_hash}")
    print(f"\nTELEGRAM_SESSION\n  {session}")
    if invitacion:
        print(f"\nTELEGRAM_CHANNEL_INVITE (opcional, fija el canal destino)\n  {invitacion}")
    print("\n⚠️  Si ya existen estos secrets a nivel de REPO, actualizalos: un secret de repo PISA")
    print("    al de la organizacion Iv-apps. Si la sesion buena esta en la organizacion, usa")
    print("    --limpiar-secrets-de-repo en lugar de duplicarla.\n")

    if args.push_secrets:
        if not token:
            print("⚠️  Sin GITHUB_TOKEN no puedo subirlos; copialos a mano.")
            return 0
        print("--- Subiendo secrets al repo ---")
        gestionar_secrets(token, {
            "TELEGRAM_API_ID": api_id,
            "TELEGRAM_API_HASH": api_hash,
            "TELEGRAM_SESSION": session,
            "TELEGRAM_CHANNEL_INVITE": invitacion,
        })
        print("\n✅ Listo. Relanza el workflow 'Build GallOli APK Nativo' para probar el envio.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
