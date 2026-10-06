// workers/license.js — Sistema de licencias / activación de GallOli
//
// CÓMO FUNCIONA
// -------------
// 1. El VENDEDOR genera un par de claves P-256 (ECDSA / ES256) en su computadora
//    con la herramienta `sale/tools/licencias.js`. La clave PRIVADA nunca sale de
//    ahí: con ella firma un código por cada copia vendida. La clave PÚBLICA se
//    configura en este Worker (variable `LICENSE_PUBLIC_KEY`).
// 2. El COMPRADOR pega su código en la app. Este Worker lo verifica SIN conexión
//    contra la clave pública: si la firma es válida, guarda la licencia en D1.
//    Al ser asimétrico, un tercero que copie el código fuente NO puede fabricar
//    códigos válidos, porque no tiene la clave privada.
// 3. Sin una licencia activa, los endpoints `/api/sync` responden 402 y la app
//    sigue funcionando 100% local (vender, cobrar, reportes) pero no sincroniza.
//
// FORMATO DEL CÓDIGO
// ------------------
//   GALLOLI1.<payload_base64url>.<firma_base64url>
//   payload = { v, s: serial, l: licenciatario, d: dominios, p: plan,
//               u: max_usuarios, i: emitido_en, e: vence_en|null }
//
// Se eligió ECDSA P-256 porque es el algoritmo estándar soportado tanto por el
// WebCrypto de Cloudflare Workers como por el WebCrypto del navegador y Node.

const PREFIJO = 'GALLOLI1';

// ── base64url <-> bytes ───────────────────────────────────────────────────────
function b64urlABytes(texto) {
  const limpio = String(texto || '').replace(/-/g, '+').replace(/_/g, '/');
  const relleno = limpio.length % 4 ? '='.repeat(4 - (limpio.length % 4)) : '';
  const binario = atob(limpio + relleno);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function bytesAB64url(bytes) {
  let binario = '';
  const vista = new Uint8Array(bytes);
  for (let i = 0; i < vista.length; i++) binario += String.fromCharCode(vista[i]);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Quita espacios y saltos de línea que se cuelan al copiar/pegar el código. */
export function normalizarCodigo(codigo) {
  return String(codigo || '').replace(/\s+/g, '').trim();
}

/** sha256 en hexadecimal (para no guardar el código en claro en la base). */
export async function sha256Hex(texto) {
  const datos = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest('SHA-256', datos);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Separa y decodifica un código. Devuelve null si el formato no es el esperado. */
export function parsearCodigo(codigo) {
  const limpio = normalizarCodigo(codigo);
  const partes = limpio.split('.');
  if (partes.length !== 3 || partes[0] !== PREFIJO) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlABytes(partes[1])));
    if (!payload || typeof payload !== 'object') return null;
    return {
      payload,
      firma: partes[2],
      firmado: `${partes[0]}.${partes[1]}`,
      codigo: limpio,
    };
  } catch {
    return null;
  }
}

async function importarClavePublica(b64) {
  return crypto.subtle.importKey(
    'spki',
    b64urlABytes(b64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
}

/**
 * Verifica un código contra una o varias claves públicas (base64url SPKI).
 * @returns {{ok: boolean, payload?: object, codigo?: string, motivo?: string}}
 */
export async function verificarCodigo(codigo, clavesPublicas) {
  const parsed = parsearCodigo(codigo);
  if (!parsed) return { ok: false, motivo: 'formato' };

  const claves = (clavesPublicas || []).map((c) => String(c || '').replace(/\s+/g, '')).filter(Boolean);
  if (!claves.length) return { ok: false, motivo: 'sin-clave' };

  const datos = new TextEncoder().encode(parsed.firmado);
  const firma = b64urlABytes(parsed.firma);

  for (const b64 of claves) {
    try {
      const key = await importarClavePublica(b64);
      const valido = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        firma,
        datos
      );
      if (valido) return { ok: true, payload: parsed.payload, codigo: parsed.codigo };
    } catch {
      // Clave inválida o de otro tipo: probamos la siguiente
    }
  }
  return { ok: false, motivo: 'firma' };
}

/** Devuelve las claves públicas de confianza configuradas en el entorno. */
export function clavesConfianza(env) {
  const lista = [];
  if (env && env.LICENSE_PUBLIC_KEY) lista.push(env.LICENSE_PUBLIC_KEY);
  if (env && env.LICENSE_PUBLIC_KEYS) {
    try {
      const extra = JSON.parse(env.LICENSE_PUBLIC_KEYS);
      if (Array.isArray(extra)) lista.push(...extra);
      else lista.push(String(env.LICENSE_PUBLIC_KEYS));
    } catch {
      lista.push(...String(env.LICENSE_PUBLIC_KEYS).split(','));
    }
  }
  return [...new Set(lista.map((c) => String(c || '').replace(/\s+/g, '')).filter(Boolean))];
}

/**
 * ¿Este servidor exige licencia?
 * Sólo se exige cuando hay al menos una clave pública de confianza y no se
 * desactivó a mano con LICENSE_ENFORCED="0". Si no hay clave, el servidor queda
 * "abierto" para no dejar sin sincronización a una instalación sin configurar.
 */
export function licenciaActiva(env) {
  if (env && String(env.LICENSE_ENFORCED || '').trim() === '0') return false;
  return clavesConfianza(env).length > 0;
}

function hostDe(request) {
  try {
    return new URL(request.url).host;
  } catch {
    return '';
  }
}

function listaDominios(dominio) {
  return String(dominio || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function dominioPermitido(dominio, host) {
  const dominios = listaDominios(dominio);
  if (!dominios.length) return true; // licencia sin restricción de dominio
  if (dominios.includes('*')) return true;
  return dominios.includes(String(host || '').toLowerCase());
}

/**
 * Calcula el estado de licencia de un negocio. Nunca lanza: ante un error de
 * base de datos devuelve `activa:true` con `error:true` (fail-open) para no
 * dejar a un negocio legítimo sin sincronización por una tabla sin migrar.
 */
export async function estadoLicencia(env, businessId, request) {
  const exigida = licenciaActiva(env);
  const base = {
    exigida,
    activa: false,
    plan: null,
    licenciatario: null,
    serial: null,
    dominio: null,
    emitida: null,
    expira: null,
    dias_restantes: null,
    vencida: false,
    error: false,
    mensaje: '',
  };

  if (!exigida) {
    return {
      ...base,
      activa: true,
      plan: 'abierta',
      mensaje: 'Este servidor tiene las licencias desactivadas (modo abierto).',
    };
  }

  let fila = null;
  try {
    fila = await env.DB.prepare(
      `SELECT * FROM licenses WHERE business_id = ? AND revoked = 0
       ORDER BY activated_at DESC LIMIT 1`
    )
      .bind(businessId)
      .first();
  } catch (e) {
    console.error('⚠️ No se pudo consultar la tabla licenses:', e.message);
    return {
      ...base,
      activa: true,
      error: true,
      mensaje: 'No se pudo verificar la licencia (revisa la tabla `licenses`). Sincronización permitida temporalmente.',
    };
  }

  if (!fila) {
    return { ...base, mensaje: 'Este negocio todavía no tiene una licencia activada.' };
  }

  const host = hostDe(request);
  if (!dominioPermitido(fila.domain, host)) {
    return {
      ...base,
      plan: fila.plan,
      licenciatario: fila.licensee,
      serial: fila.serial,
      dominio: fila.domain,
      mensaje: `La licencia está emitida para ${fila.domain || '(otro dominio)'} y este servidor es ${host}.`,
    };
  }

  const ahora = Date.now();
  const vencida = !!(fila.expires_at && fila.expires_at < ahora);
  const dias = fila.expires_at ? Math.ceil((fila.expires_at - ahora) / 86400000) : null;

  return {
    ...base,
    activa: !vencida,
    vencida,
    plan: fila.plan,
    licenciatario: fila.licensee,
    serial: fila.serial,
    dominio: fila.domain,
    emitida: fila.issued_at,
    expira: fila.expires_at,
    dias_restantes: dias,
    mensaje: vencida
      ? `La licencia venció el ${new Date(fila.expires_at).toLocaleDateString('es-EC')}.`
      : `Licencia activa${dias != null ? ` (quedan ${dias} días)` : ''}.`,
  };
}

/**
 * Puerta para endpoints protegidos. Devuelve el estado SOLO si hay que bloquear
 * (licencia exigida e inactiva); devuelve null si se puede continuar.
 */
export async function bloqueoPorLicencia(env, businessId, request) {
  if (!licenciaActiva(env)) return null;
  const estado = await estadoLicencia(env, businessId, request);
  return estado.activa ? null : estado;
}
