#!/usr/bin/env node
/*
 * licencias.js — Emisor de códigos de activación de GallOli
 * ========================================================
 * Esta es la herramienta del VENDEDOR. Sólo necesita Node (nada que instalar).
 *
 * Cómo funciona
 * -------------
 * 1. `--init` crea un par de claves P-256 (ECDSA). La clave PRIVADA se queda en tu
 *    computadora y es la única que puede firmar códigos válidos. La PÚBLICA se
 *    copia al Worker (`workers/wrangler.toml` → LICENSE_PUBLIC_KEY).
 * 2. `--emitir` firma un código para cada copia que vendas. Ese código se lo
 *    entregas al comprador junto con el ZIP.
 * 3. El Worker del comprador verifica el código SIN conexión con la clave pública.
 *    Como es criptografía asimétrica, quien copie el ZIP no puede fabricar códigos.
 *
 * Uso
 * ---
 *   node tools/licencias.js --init
 *   node tools/licencias.js --publica
 *   node tools/licencias.js --emitir --negocio "Pollos El Buen Sabor" \
 *        --dominio pollos.workers.dev --dias 365 --guardar
 *   node tools/licencias.js --emitir --negocio "Cliente 2" --perpetua --dominio "*"
 *   node tools/licencias.js --info GALLOLI1.xxxx.yyyy
 *   node tools/licencias.js --selftest
 *
 * NUNCA compartas `licencia-privada.pem`: sin ella nadie puede emitir códigos,
 * y con ella cualquiera puede.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
const { pathToFileURL } = require('url');

const subtle = webcrypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const PREFIJO = 'GALLOLI1';
const CARPETA = path.resolve(__dirname, '..'); // sale/ (vendedor) o la raíz del paquete (comprador)
// En este repositorio la herramienta vive en sale/tools/, así que el Worker está un
// nivel más arriba. En el paquete que recibe el comprador, tools/ cuelga de la raíz.
const RAIZ_PROYECTO = path.basename(CARPETA) === 'sale' ? path.resolve(CARPETA, '..') : CARPETA;
const ARCHIVO_PRIVADO = path.join(CARPETA, 'licencia-privada.pem');
const ARCHIVO_PUBLICO = path.join(CARPETA, 'licencia-publica.pem');
const ARCHIVO_REGISTRO = path.join(CARPETA, 'licencias-emitidas.csv');

const CABECERA_PRIVADA = '-----BEGIN GALLOLI LICENSE PRIVATE KEY-----';
const PIE_PRIVADA = '-----END GALLOLI LICENSE PRIVATE KEY-----';
const CABECERA_PUBLICA = '-----BEGIN GALLOLI LICENSE PUBLIC KEY-----';
const PIE_PUBLICA = '-----END GALLOLI LICENSE PUBLIC KEY-----';

// ── utilidades base64url ─────────────────────────────────────────────────────

function bytesAB64url(bytes) {
  let binario = '';
  const vista = new Uint8Array(bytes);
  for (let i = 0; i < vista.length; i++) binario += String.fromCharCode(vista[i]);
  return Buffer.from(binario, 'binary').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlABytes(texto) {
  const limpio = String(texto || '').replace(/-/g, '+').replace(/_/g, '/');
  const relleno = limpio.length % 4 ? '='.repeat(4 - (limpio.length % 4)) : '';
  return new Uint8Array(Buffer.from(limpio + relleno, 'base64'));
}

function escribirPem(ruta, cabecera, pie, b64) {
  const lineas = b64.match(/.{1,64}/g) || [];
  fs.writeFileSync(ruta, [cabecera, ...lineas, pie, ''].join('\n'), 'utf8');
}

function leerPem(ruta, cabecera, pie) {
  const contenido = fs.readFileSync(ruta, 'utf8');
  return contenido
    .split(/\r?\n/)
    .filter((linea) => linea && linea !== cabecera && linea !== pie)
    .join('')
    .trim();
}

// ── claves ───────────────────────────────────────────────────────────────────

async function generarClaves() {
  const par = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const privada = await subtle.exportKey('pkcs8', par.privateKey);
  const publica = await subtle.exportKey('spki', par.publicKey);
  return {
    privadaB64: bytesAB64url(privada),
    publicaB64: bytesAB64url(publica),
  };
}

async function importarPrivada() {
  if (!fs.existsSync(ARCHIVO_PRIVADO)) {
    throw new Error(
      `No existe ${path.basename(ARCHIVO_PRIVADO)}. Corre primero: node tools/licencias.js --init`
    );
  }
  const b64 = leerPem(ARCHIVO_PRIVADO, CABECERA_PRIVADA, PIE_PRIVADA);
  return subtle.importKey(
    'pkcs8',
    b64urlABytes(b64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

async function importarPublica(b64) {
  return subtle.importKey(
    'spki',
    b64urlABytes(b64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
}

function leerPublica() {
  if (!fs.existsSync(ARCHIVO_PUBLICO)) {
    throw new Error(
      `No existe ${path.basename(ARCHIVO_PUBLICO)}. Corre primero: node tools/licencias.js --init`
    );
  }
  return leerPem(ARCHIVO_PUBLICO, CABECERA_PUBLICA, PIE_PUBLICA);
}

// ── emisión y verificación (idéntico al Worker) ──────────────────────────────

async function firmar(payload, clavePrivada) {
  const cuerpo = `${PREFIJO}.${bytesAB64url(encoder.encode(JSON.stringify(payload)))}`;
  const firma = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, clavePrivada, encoder.encode(cuerpo));
  return `${cuerpo}.${bytesAB64url(firma)}`;
}

async function verificar(codigo, clavePublicaB64) {
  const limpio = String(codigo || '').replace(/\s+/g, '');
  const partes = limpio.split('.');
  if (partes.length !== 3 || partes[0] !== PREFIJO) return { ok: false, motivo: 'formato' };
  const cuerpo = `${partes[0]}.${partes[1]}`;
  const clave = await importarPublica(clavePublicaB64);
  const valido = await subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    clave,
    b64urlABytes(partes[2]),
    encoder.encode(cuerpo)
  );
  if (!valido) return { ok: false, motivo: 'firma' };
  return { ok: true, payload: JSON.parse(decoder.decode(b64urlABytes(partes[1]))), codigo: limpio };
}

// ── presentación ─────────────────────────────────────────────────────────────

function serial() {
  const bytes = webcrypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function fecha(ms) {
  if (!ms) return 'nunca';
  return new Date(Number(ms)).toLocaleDateString('es-EC', { day: '2-digit', month: 'long', year: 'numeric' });
}

function log(texto) {
  try {
    console.log(texto);
  } catch {
    console.log(String(texto).replace(/[^\x20-\x7E]/g, ''));
  }
}

function ayuda() {
  log(`
GallOli — emisor de códigos de activación

  node tools/licencias.js --init
        Crea el par de claves. La privada (licencia-privada.pem) NO se comparte.

  node tools/licencias.js --publica
        Muestra la clave pública para pegarla en workers/wrangler.toml.

  node tools/licencias.js --emitir --negocio "Nombre del cliente" [opciones]
        --negocio        A quién le vendiste (queda visible en su app).
        --dominio        Dominio(s) autorizados, separados por coma. "*" = cualquiera.
                         Normalmente el subdominio del Worker del comprador.
        --dias N         Días de validez (por defecto 365).
        --perpetua       Sin fecha de vencimiento.
        --plan           Etiqueta del plan (por defecto "pro").
        --max-usuarios   Límite informativo de usuarios (0 = sin límite).
        --notas          Comentario libre para tu registro.
        --guardar        Guarda una fila en licencias-emitidas.csv.

  node tools/licencias.js --info CODIGO
        Muestra los datos de un código (verifica la firma).

  node tools/licencias.js --selftest
        Comprueba que firmar y verificar funcionan (usa el verificador real del Worker).
`);
}

// ── comandos ─────────────────────────────────────────────────────────────────

function comandoInit() {
  if (fs.existsSync(ARCHIVO_PRIVADO)) {
    log(`Ya existe ${path.basename(ARCHIVO_PRIVADO)}: NO la regenero (perderías las licencias emitidas).`);
    log(`Si de verdad quieres empezar de cero, borra ${ARCHIVO_PRIVADO} y ${path.basename(ARCHIVO_PUBLICO)}.`);
    return 1;
  }
  return generarClaves().then(({ privadaB64, publicaB64 }) => {
    escribirPem(ARCHIVO_PRIVADO, CABECERA_PRIVADA, PIE_PRIVADA, privadaB64);
    escribirPem(ARCHIVO_PUBLICO, CABECERA_PUBLICA, PIE_PUBLICA, publicaB64);
    log('Claves creadas:');
    log(`  · ${path.basename(ARCHIVO_PRIVADO)}  ← NO la compartas ni la subas a git`);
    log(`  · ${path.basename(ARCHIVO_PUBLICO)}`);
    log('');
    log('Clave pública para workers/wrangler.toml:');
    log('');
    log(`LICENSE_PUBLIC_KEY = "${publicaB64}"`);
    log('');
    log('Siguiente paso:  node tools/licencias.js --emitir --negocio "Tu primer cliente"');
    return 0;
  });
}

async function comandoEmitir(args) {
  const negocio = args.negocio;
  if (!negocio) {
    log('ERROR: falta --negocio "Nombre del cliente".');
    return 1;
  }

  const perpetua = !!args.perpetua;
  const dias = perpetua ? null : Number(args.dias || 365);
  if (!perpetua && (!Number.isFinite(dias) || dias <= 0)) {
    log('ERROR: --dias debe ser un número mayor que 0.');
    return 1;
  }

  const ahora = Date.now();
  const payload = {
    v: 1,
    s: serial(),
    l: String(negocio),
    d: String(args.dominio || '*'),
    p: String(args.plan || 'pro'),
    u: Number(args['max-usuarios'] || 0),
    i: ahora,
    e: perpetua ? null : ahora + dias * 86400000,
  };

  const clavePrivada = await importarPrivada();
  const codigo = await firmar(payload, clavePrivada);

  log('');
  log('════════════════════════════════════════════════════════════════');
  log('  CÓDIGO DE ACTIVACIÓN (entrégaselo al comprador)');
  log('════════════════════════════════════════════════════════════════');
  log('');
  log(codigo);
  log('');
  log('────────────────────────────────────────────────────────────────');
  log(`  Licenciatario : ${payload.l}`);
  log(`  N° de licencia: ${payload.s}`);
  log(`  Dominio(s)    : ${payload.d}`);
  log(`  Plan          : ${payload.p}`);
  log(`  Emitida       : ${fecha(payload.i)}`);
  log(`  Vence         : ${perpetua ? 'nunca (perpetua)' : `${fecha(payload.e)} (${dias} días)`}`);
  log('════════════════════════════════════════════════════════════════');

  if (payload.d === '*') {
    log('');
    log('AVISO: emitiste el codigo SIN --dominio. Este codigo se puede activar en');
    log('       cualquier despliegue (cualquier Worker). Para evitar reventa, emite');
    log('       los codigos con:  --dominio mi-sync.mi-cuenta.workers.dev');
  }

  if (args.guardar) {
    const nueva = !fs.existsSync(ARCHIVO_REGISTRO);
    const fila = [
      new Date(ahora).toISOString(),
      payload.s,
      `"${payload.l.replace(/"/g, "'")}"`,
      `"${payload.d}"`,
      payload.p,
      perpetua ? 'perpetua' : new Date(payload.e).toISOString(),
      args.notas ? `"${String(args.notas).replace(/"/g, "'")}"` : '',
    ].join(',');
    if (nueva) fs.writeFileSync(ARCHIVO_REGISTRO, 'emitida,serial,licenciatario,dominio,plan,vence,notas\n', 'utf8');
    fs.appendFileSync(ARCHIVO_REGISTRO, fila + '\n', 'utf8');
    log(`  Guardado en ${path.basename(ARCHIVO_REGISTRO)}`);
  }
  log('');
  log('En el Worker del comprador deben estar:');
  log('  · LICENSE_PUBLIC_KEY = la clave pública de este proyecto');
  log('  · LICENSE_ENFORCED   = "1"');
  return 0;
}

async function comandoInfo(codigo) {
  if (!codigo) {
    log('ERROR: usa --info CODIGO');
    return 1;
  }
  const publica = leerPublica();
  const resultado = await verificar(codigo, publica);
  if (!resultado.ok) {
    log(`Código INVÁLIDO (${resultado.motivo}). Revisa que esté completo y sin espacios.`);
    return 1;
  }
  const p = resultado.payload;
  const vencido = p.e && Number(p.e) < Date.now();
  log('');
  log('Código VÁLIDO (la firma coincide con tu clave pública).');
  if (vencido) log('  ⚠️  OJO: ya está vencido.');
  log('');
  log(`  Licenciatario : ${p.l || '(sin nombre)'}`);
  log(`  N° de licencia: ${p.s || '(sin serial)'}`);
  log(`  Dominio(s)    : ${p.d || '(sin restricción)'}`);
  log(`  Plan          : ${p.p || '(sin plan)'}`);
  log(`  Max usuarios  : ${p.u || 'sin límite'}`);
  log(`  Emitida       : ${fecha(p.i)}`);
  log(`  Vence         : ${fecha(p.e)}`);
  return 0;
}

async function comandoSelftest() {
  const { privadaB64, publicaB64 } = await generarClaves();
  const clavePrivada = await subtle.importKey(
    'pkcs8',
    b64urlABytes(privadaB64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const payload = { v: 1, s: serial(), l: 'Prueba interna', d: '*', p: 'pro', u: 0, i: Date.now(), e: null };
  const codigo = await firmar(payload, clavePrivada);

  // Verificación con el mismo código que corre en producción (workers/license.js)
  const rutaWorker = path.join(RAIZ_PROYECTO, 'workers', 'license.js');
  if (!fs.existsSync(rutaWorker)) {
    log(`ERROR: no encontré ${rutaWorker}`);
    return 1;
  }
  const worker = await import(pathToFileURL(rutaWorker).href);

  const bueno = await worker.verificarCodigo(codigo, [publicaB64]);
  if (!bueno.ok) {
    log(`FALLA: el verificador del Worker rechazó un código válido (${bueno.motivo}).`);
    return 1;
  }

  const roto = codigo.slice(0, -4) + 'AAAA';
  const malo = await worker.verificarCodigo(roto, [publicaB64]);
  if (malo.ok) {
    log('FALLA: el verificador aceptó un código alterado.');
    return 1;
  }

  const otraClave = await generarClaves();
  const ajeno = await worker.verificarCodigo(codigo, [otraClave.publicaB64]);
  if (ajeno.ok) {
    log('FALLA: el verificador aceptó un código firmado con otra clave.');
    return 1;
  }

  log('OK: firma, verificación, rechazo de códigos alterados y de claves ajenas.');
  return 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function analizarArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const actual = argv[i];
    if (!actual.startsWith('--')) {
      args._.push(actual);
      continue;
    }
    const clave = actual.slice(2);
    const siguiente = argv[i + 1];
    if (siguiente === undefined || siguiente.startsWith('--')) {
      args[clave] = true;
    } else {
      args[clave] = siguiente;
      i++;
    }
  }
  return args;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = analizarArgs(argv);

  if (!argv.length || args.ayuda || args.help || args.h) {
    ayuda();
    return 0;
  }

  try {
    if (args.init) return await comandoInit();
    if (args.publica) {
      log(leerPublica());
      return 0;
    }
    if (args.emitir) return await comandoEmitir(args);
    if (args.info) return await comandoInfo(args.info === true ? args._[0] : args.info);
    if (args.selftest) return await comandoSelftest();
    log('No entendí la opción. Usa --ayuda para ver los comandos.');
    return 1;
  } catch (error) {
    log(`ERROR: ${error.message}`);
    return 1;
  }
}

main().then((codigo) => {
  process.exitCode = codigo;
});
