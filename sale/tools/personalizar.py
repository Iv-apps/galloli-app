#!/usr/bin/env python3
"""Rellena los placeholders del paquete con los datos del comprador.

El ZIP que compraste viene **limpio**: ningún dato del vendedor. Todo lo que hay que
reemplazar quedó con nombres visibles (`TU-WORKER...`, `TU_D1_DATABASE_ID`, ...).

    # 1) ver qué falta, sin escribir nada
    python tools/personalizar.py --listar

    # 2) rellenar con tus datos
    python tools/personalizar.py \
        --worker-url https://mi-sync.mi-cuenta.workers.dev \
        --d1-id 11111111-2222-3333-4444-555555555555 \
        --app-id com.minegocio.galloli \
        --dominio minegocio.com \
        --org-github Mi-Org-GitHub \
        --usuario-github miusuario \
        --invite-telegram https://t.me/+AbCdEfGhIjKl

Lo que no pases se queda como placeholder (así lo puedes localizar después con
`grep -rn "TU_" .`). El nombre del worker se deduce solo de `--worker-url`.
"""

import argparse
import os
import re
import sys

ARCHIVOS_TEXTO = (".js", ".html", ".json", ".css", ".md", ".sql", ".toml", ".yml", ".yaml",
                  ".py", ".txt", ".sh", ".java", ".kt", ".gradle", ".xml", ".example")
NOMBRES_TEXTO = {"_headers", ".gitignore", ".gitattributes", ".editorconfig"}
DIRECTORIOS_IGNORADOS = {"node_modules", ".git", ".wrangler", "__pycache__", "dist", "www",
                         "android", ".gradle"}
TAMANO_MAXIMO = 3 * 1024 * 1024

# (placeholder en el paquete, argumento, descripción)
PLACEHOLDERS = [
    ("https://TU-WORKER.TU-SUBDOMINIO.workers.dev", "worker_url", "URL de tu Worker"),
    ("TU-WORKER.TU-SUBDOMINIO.workers.dev", "worker_url", "host de tu Worker"),
    ("TU-WORKER-NOMBRE", "worker_nombre", "nombre del Worker (wrangler.toml)"),
    ("TU_D1_DATABASE_ID", "d1_id", "id de tu base de datos D1"),
    ("TU_CLOUDFLARE_ACCOUNT_ID", "account_id", "id de tu cuenta de Cloudflare"),
    ("TU:HUELLA:SHA256:DEL:KEYSTORE", "fingerprint", "huella SHA-256 de tu keystore"),
    ("com.tunegocio.galloli.twa", "twa_package", "paquete de tu TWA (Play Store)"),
    ("com.tunegocio.galloli", "app_id", "applicationId de tu app Android"),
    ("tudominio.com", "dominio", "tu dominio"),
    ("TU-ORG-GITHUB", "org_github", "tu organización de GitHub"),
    ("TU-USUARIO-GITHUB", "usuario_github", "tu usuario de GitHub"),
    ("https://t.me/+TU_INVITACION", "invite_telegram", "invitación de tu canal de Telegram"),
]


def es_texto(ruta):
    return (ruta.endswith(ARCHIVOS_TEXTO)
            or os.path.basename(ruta) in NOMBRES_TEXTO)


def buscar(raiz):
    """Cuenta cuántas veces aparece cada placeholder."""
    pendientes = {texto: 0 for texto, _, _ in PLACEHOLDERS}
    archivos = set()
    for carpeta, subcarpetas, nombres in os.walk(raiz):
        subcarpetas[:] = [d for d in subcarpetas if d not in DIRECTORIOS_IGNORADOS]
        for nombre in nombres:
            ruta = os.path.join(carpeta, nombre)
            if not es_texto(ruta) or os.path.getsize(ruta) > TAMANO_MAXIMO:
                continue
            try:
                with open(ruta, encoding="utf-8") as fh:
                    contenido = fh.read()
            except (UnicodeDecodeError, OSError):
                continue
            for texto, _, _ in PLACEHOLDERS:
                cuantos = contenido.count(texto)
                if cuantos:
                    pendientes[texto] += cuantos
                    archivos.add(os.path.relpath(ruta, raiz))
    return pendientes, archivos


def nombre_worker_desde_url(url):
    try:
        host = url.split("//", 1)[-1].split("/", 1)[0]
        return host.split(".")[0]
    except IndexError:
        return ""


def main():
    raiz_por_defecto = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    parser = argparse.ArgumentParser(description="Rellena los placeholders con tus datos")
    parser.add_argument("--raiz", default=raiz_por_defecto, help="carpeta del proyecto")
    parser.add_argument("--listar", action="store_true", help="solo muestra lo que falta")
    parser.add_argument("--dry-run", action="store_true", help="no escribe, solo informa")
    parser.add_argument("--worker-url")
    parser.add_argument("--worker-nombre")
    parser.add_argument("--d1-id")
    parser.add_argument("--account-id")
    parser.add_argument("--app-id")
    parser.add_argument("--twa-package")
    parser.add_argument("--dominio")
    parser.add_argument("--org-github")
    parser.add_argument("--usuario-github")
    parser.add_argument("--fingerprint")
    parser.add_argument("--invite-telegram")
    args = parser.parse_args()

    raiz = os.path.abspath(args.raiz)
    if not os.path.isdir(raiz):
        print(f"No existe la carpeta {raiz}")
        return 1

    # El nombre del worker se deduce de la URL si no lo diste explícitamente.
    if args.worker_url and not args.worker_nombre:
        args.worker_nombre = nombre_worker_desde_url(args.worker_url)
    if args.app_id and not args.twa_package:
        args.twa_package = args.app_id + ".twa"

    pendientes_antes, archivos = buscar(raiz)
    total = sum(pendientes_antes.values())

    if args.listar or total == 0:
        if total == 0:
            print("✅ No queda ningún placeholder: el proyecto ya está personalizado.")
        else:
            print(f"Faltan {total} placeholders en {len(archivos)} archivos:\n")
            for texto, _, descripcion in PLACEHOLDERS:
                if pendientes_antes[texto]:
                    print(f"  · {pendientes_antes[texto]:4d}  {texto:45s} {descripcion}")
            print("\nEjemplo completo:\n")
            print("  python tools/personalizar.py \\\n"
                  "      --worker-url https://mi-sync.mi-cuenta.workers.dev \\\n"
                  "      --d1-id TU_D1_DATABASE_ID --app-id com.minegocio.galloli \\\n"
                  "      --dominio minegocio.com --org-github Mi-Org --usuario-github miusuario")
        return 0

    reemplazos = []
    for texto, argumento, descripcion in PLACEHOLDERS:
        nuevo = getattr(args, argumento.replace("-", "_")) if argumento else None
        if nuevo:
            reemplazos.append((texto, nuevo, descripcion))

    if not reemplazos:
        print(f"Hay {total} placeholders pendientes y no pasaste ningún valor. Usa --listar para verlos.")
        return 1

    conteo = {}
    tocados = 0
    for carpeta, subcarpetas, nombres in os.walk(raiz):
        subcarpetas[:] = [d for d in subcarpetas if d not in DIRECTORIOS_IGNORADOS]
        for nombre in nombres:
            ruta = os.path.join(carpeta, nombre)
            if not es_texto(ruta) or os.path.getsize(ruta) > TAMANO_MAXIMO:
                continue
            try:
                with open(ruta, encoding="utf-8") as fh:
                    original = fh.read()
            except (UnicodeDecodeError, OSError):
                continue
            contenido = original
            for texto, nuevo, descripcion in reemplazos:
                if texto in contenido:
                    contenido = contenido.replace(texto, nuevo)
                    conteo[descripcion] = conteo.get(descripcion, 0) + 1
            if contenido != original:
                tocados += 1
                if not args.dry_run:
                    with open(ruta, "w", encoding="utf-8", newline="") as fh:
                        fh.write(contenido)

    print(f"{'[simulación] ' if args.dry_run else ''}Actualizados {tocados} archivos:")
    for descripcion, cuantos in sorted(conteo.items()):
        print(f"  · {descripcion}")

    pendientes_despues, _ = buscar(raiz)
    quedan = sum(pendientes_despues.values())
    if quedan:
        print(f"\n⚠️  Quedan {quedan} placeholders. Ejecuta --listar para verlos y vuelve a correrlo.")
    else:
        print("\n✅ Listo: no queda ningún placeholder (y ninguna copia del vendedor).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
