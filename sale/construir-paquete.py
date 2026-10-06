#!/usr/bin/env python3
"""Construye el ZIP que se vende en ivapps.store a partir de este repo.

Qué hace:

1. Copia al paquete solo lo que necesita el comprador (sin `android/`, sin `node_modules/`,
   sin `.git/`, sin las especificaciones internas de `.kiro/` ni `branch-apk/`).
2. **Borra toda la infraestructura del vendedor** (worker, D1, cuenta de Cloudflare, paquete
   de Android, dominio, organización de GitHub, huella del keystore, canal de Telegram) y la
   deja como placeholders visibles.
3. **Verifica** que no quedó ningún dato del vendedor. Si queda algo, no genera el ZIP.
4. Comprueba la sintaxis del paquete resultante (`node --check` y `JSON.parse`).
5. Añade la guía del comprador, la herramienta `tools/personalizar.py` y una licencia MIT.
6. Comprime en `dist/GallOli-<version>-plantilla.zip`.

Uso:  python sale/construir-paquete.py
"""

import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

RAIZ = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
VENTA = os.path.join(RAIZ, "sale")
DESTINO = os.path.join(RAIZ, "dist")
NOMBRE_PAQUETE = "galloli-plantilla"

ARCHIVOS_RAIZ = [
    "index.html", "manifest.json", "sw.js", "version.json", "_headers", "package.json",
    "README.md", "CHANGELOG.md", "capacitor.config.json",
    "feedback.html", "delete-account.html", "privacy.html", "terms.html",
    ".editorconfig", ".gitignore", ".gitattributes",
]
DIRECTORIOS = ["css", "js", "icons", "src", "workers", ".github", "docs", ".well-known"]
IGNORAR_DIRS = {"node_modules", ".wrangler", ".git", "__pycache__", "dist", "www", "android",
                ".gradle", ".idea"}
IGNORAR_ARCHIVOS = {"app.js.bak", "app.js.bak2", "*.pyc"}

ARCHIVOS_TEXTO = (".js", ".html", ".json", ".css", ".md", ".sql", ".toml", ".yml", ".yaml",
                  ".py", ".txt", ".sh", ".java", ".kt", ".gradle", ".xml", ".example")
NOMBRES_TEXTO = {"_headers", ".gitignore", ".gitattributes", ".editorconfig"}

# (patrón, reemplazo, etiqueta) — el ORDEN importa: lo más específico primero.
SANEO = [
    ("https://galloli-sync.ivanbj-96.workers.dev", "https://TU-WORKER.TU-SUBDOMINIO.workers.dev",
     "URL del worker"),
    ("galloli-sync.ivanbj-96.workers.dev", "TU-WORKER.TU-SUBDOMINIO.workers.dev",
     "host del worker"),
    ("dev.pages.galloli.twa", "com.tunegocio.galloli.twa", "paquete de la TWA"),
    ("store.ivapps.galloli", "com.tunegocio.galloli", "applicationId"),
    ("galloli.ivapps.store", "tudominio.com", "dominio de la PWA"),
    ("ivapps.store", "tudominio.com", "web del vendedor"),
    ("c5dd06b9-2998-49d5-834e-fd0d5f7f8da1", "TU_D1_DATABASE_ID", "id de la base D1"),
    ("ad83f16cea132210cff0f92fe179e628", "TU_CLOUDFLARE_ACCOUNT_ID", "id de la cuenta"),
    ("B5:09:51:3F:F2:D5:DF:34:A2:0D:9F:EE:CE:5C:1C:07:7A:40:09:60:9B:DF:F0:48:FE:C7:C2:4A:8E:56:C6:CF",
     "TU:HUELLA:SHA256:DEL:KEYSTORE", "huella del keystore"),
    ("galloli-sync", "TU-WORKER-NOMBRE", "nombre del worker"),
    (r"https://t\.me/\+[A-Za-z0-9_-]{6,}", "https://t.me/+TU_INVITACION", "canal de Telegram"),
    ("Iv-apps", "TU-ORG-GITHUB", "organización de GitHub"),
    ("ivanbj96", "TU-USUARIO-GITHUB", "usuario de GitHub"),
    ("ivanbj-96", "TU-USUARIO-GITHUB", "subdominio de workers.dev"),
]

# Cualquier aparición de esto en el paquete = fallo (no se genera el ZIP).
PROHIBIDOS = [
    "ivanbj", "Iv-apps", "IV-APPS",
    "c5dd06b9-2998-49d5-834e-fd0d5f7f8da1", "ad83f16cea132210cff0f92fe179e628",
    "galloli-sync.ivanbj-96.workers.dev", "ivapps.store", "store.ivapps.galloli",
    "dev.pages.galloli.twa", "QPr885dQgl0wNDgx", "B5:09:51:3F:F2:D5:DF:34",
]

LICENCIA = """Licencia MIT

Copyright (c) 2026 TU NOMBRE O TU EMPRESA

Por la presente se concede permiso, libre de cargos, a cualquier persona que obtenga una
copia de este software y de los archivos de documentación asociados (el "Software"), para
utilizar el Software sin restricción, incluyendo sin limitación los derechos de usar, copiar,
modificar, fusionar, publicar, distribuir, sublicenciar y/o vender copias del Software, y
para permitir a las personas a las que se les proporcione el Software que lo hagan, con
sujeto a las siguientes condiciones:

El aviso de copyright anterior y este aviso de permiso se incluirán en todas las copias o
partes sustanciales del Software.

EL SOFTWARE SE PROPORCIONA "TAL CUAL", SIN GARANTÍA DE NINGÚN TIPO, EXPRESA O IMPLÍCITA,
INCLUYENDO PERO NO LIMITADO A LAS GARANTÍAS DE COMERCIABILIDAD, IDONEIDAD PARA UN PROPÓSITO
PARTICULAR Y NO INFRACCIÓN. EN NINGÚN CASO LOS AUTORES O TITULARES DEL COPYRIGHT SERÁN
RESPONSABLES DE NINGUNA RECLAMACIÓN, DAÑO U OTRA RESPONSABILIDAD.
"""


def log(msg=""):
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:  # consolas Windows sin UTF-8
        print(str(msg).encode("ascii", "replace").decode("ascii"), flush=True)


def version():
    with open(os.path.join(RAIZ, "version.json"), encoding="utf-8") as fh:
        return json.load(fh)["version"]


def es_texto(ruta):
    return ruta.endswith(ARCHIVOS_TEXTO) or os.path.basename(ruta) in NOMBRES_TEXTO


def recorrer(raiz):
    for carpeta, subcarpetas, archivos in os.walk(raiz):
        subcarpetas[:] = [d for d in subcarpetas if d not in IGNORAR_DIRS]
        for archivo in archivos:
            yield os.path.join(carpeta, archivo)


def copiar_arbol(origen, destino, profundidad=0):
    if profundidad > 12:
        return
    os.makedirs(destino, exist_ok=True)
    for nombre in sorted(os.listdir(origen)):
        ruta = os.path.join(origen, nombre)
        if os.path.isdir(ruta):
            if nombre in IGNORAR_DIRS:
                continue
            copiar_arbol(ruta, os.path.join(destino, nombre), profundidad + 1)
        elif nombre not in IGNORAR_ARCHIVOS:
            shutil.copy2(ruta, os.path.join(destino, nombre))


def sanear(paquete):
    conteo = {}
    tocados = 0
    for ruta in recorrer(paquete):
        if not es_texto(ruta) or os.path.getsize(ruta) > 3 * 1024 * 1024:
            continue
        try:
            with open(ruta, encoding="utf-8") as fh:
                original = fh.read()
        except (UnicodeDecodeError, OSError):
            continue
        contenido = original
        for patron, nuevo, etiqueta in SANEO:
            contenido, cuantos = re.subn(patron, nuevo, contenido)
            if cuantos:
                conteo[etiqueta] = conteo.get(etiqueta, 0) + cuantos
        if contenido != original:
            tocados += 1
            with open(ruta, "w", encoding="utf-8", newline="") as fh:
                fh.write(contenido)
    return conteo, tocados


def verificar(paquete):
    encontrados = []
    for ruta in recorrer(paquete):
        try:
            if os.path.getsize(ruta) > 3 * 1024 * 1024 or not es_texto(ruta):
                continue
            with open(ruta, encoding="utf-8") as fh:
                contenido = fh.read()
        except (UnicodeDecodeError, OSError):
            continue
        for prohibido in PROHIBIDOS:
            if prohibido in contenido:
                encontrados.append((os.path.relpath(ruta, paquete), prohibido))
    return encontrados


def revisar_sintaxis(paquete):
    fallos = []
    for ruta in recorrer(paquete):
        rel = os.path.relpath(ruta, paquete).replace("\\", "/")
        if ruta.endswith(".js"):
            resultado = subprocess.run(["node", "--check", ruta], capture_output=True, text=True)
            if resultado.returncode != 0:
                fallos.append(f"{rel}: {(resultado.stderr or '').strip().splitlines()[:1]}")
        elif ruta.endswith(".json"):
            try:
                with open(ruta, encoding="utf-8") as fh:
                    json.load(fh)
            except (ValueError, OSError) as exc:
                fallos.append(f"{rel}: {exc}")
    return fallos


def main():
    version_actual = version()
    paquete = os.path.join(DESTINO, NOMBRE_PAQUETE)
    log(f"== Construyendo el paquete de venta de GallOli v{version_actual} ==")

    if os.path.exists(paquete):
        shutil.rmtree(paquete)
    os.makedirs(paquete, exist_ok=True)

    # 1) app + worker + CI
    for archivo in ARCHIVOS_RAIZ:
        origen = os.path.join(RAIZ, archivo)
        if os.path.exists(origen):
            shutil.copy2(origen, os.path.join(paquete, archivo))
        else:
            log(f"   (aviso) falta {archivo}, se omite")
    for directorio in DIRECTORIOS:
        origen = os.path.join(RAIZ, directorio)
        if os.path.isdir(origen):
            copiar_arbol(origen, os.path.join(paquete, directorio))

    # 2) material del comprador
    os.makedirs(os.path.join(paquete, "tools"), exist_ok=True)
    shutil.copy2(os.path.join(VENTA, "tools", "personalizar.py"),
                 os.path.join(paquete, "tools", "personalizar.py"))
    shutil.copy2(os.path.join(VENTA, "GUIA-COMPRADOR.md"),
                 os.path.join(paquete, "GUIA-COMPRADOR.md"))
    shutil.copy2(os.path.join(VENTA, "GUIA-COMPRADOR.md"),
                 os.path.join(paquete, "LEEME-PRIMERO.md"))
    with open(os.path.join(paquete, "LICENSE.txt"), "w", encoding="utf-8") as fh:
        fh.write(LICENCIA)

    # 3) fuera los datos del vendedor
    log("\n-- Quitando la infraestructura del vendedor --")
    conteo, tocados = sanear(paquete)
    log(f"   {tocados} archivos modificados:")
    for etiqueta, cuantos in sorted(conteo.items()):
        log(f"     · {cuantos:4d}  {etiqueta}")

    # 4) verificación
    log("\n-- Verificando que no quede nada del vendedor --")
    encontrados = verificar(paquete)
    if encontrados:
        log("ERROR: se encontraron datos del vendedor; no genero el ZIP.")
        for ruta, patron in encontrados[:40]:
            log(f"   {ruta}: {patron}")
        return 1
    log(f"   OK: 0 coincidencias de {len(PROHIBIDOS)} patrones prohibidos.")

    log("\n-- Revisando sintaxis del paquete --")
    fallos = revisar_sintaxis(paquete)
    if fallos:
        log("ERROR: el paquete tiene archivos rotos; no genero el ZIP.")
        for fallo in fallos[:20]:
            log(f"   {fallo}")
        return 1
    log("   OK: todos los .js pasan `node --check` y todos los .json son válidos.")

    # 5) zip
    destino_zip = os.path.join(DESTINO, f"GallOli-{version_actual}-plantilla.zip")
    log(f"\n-- Comprimiendo en {os.path.relpath(destino_zip, RAIZ)} --")
    with zipfile.ZipFile(destino_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for ruta in recorrer(paquete):
            zf.write(ruta, os.path.relpath(ruta, DESTINO))

    tamanio = os.path.getsize(destino_zip) / 1024 / 1024
    with zipfile.ZipFile(destino_zip) as zf:
        nombres = zf.namelist()
    log(f"\nZIP listo: {os.path.relpath(destino_zip, RAIZ)} ({tamanio:.2f} MB, {len(nombres)} archivos)")
    log("   Incluye: app (PWA), workers/ (Cloudflare), .github/ (CI del APK), docs/, "
        "GUIA-COMPRADOR.md, tools/personalizar.py, LICENSE.txt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
