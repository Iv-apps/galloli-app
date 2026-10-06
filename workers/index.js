// Cloudflare Worker Principal - API REST
import { SessionManager } from './session-manager.js';

export { SessionManager };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    try {
      // Router
      const path = url.pathname;
      
      // Health check
      if (path === '/health') {
        return jsonResponse({ status: 'ok', timestamp: Date.now() }, corsHeaders);
      }
      
      // Auth endpoints (públicos)
      if (path.startsWith('/api/auth')) {
        return handleAuth(request, env, path, corsHeaders);
      }

      // Reset push subscriptions (temporal, protegido con secret)
      if (path === '/api/push/reset' && request.method === 'GET') {
        const url = new URL(request.url);
        if (url.searchParams.get('secret') !== 'galloli-reset-2026') {
          return jsonResponse({ error: 'Forbidden' }, corsHeaders, 403);
        }
        await env.DB.prepare('DELETE FROM push_subscriptions').run();
        return jsonResponse({ success: true, message: 'Suscripciones eliminadas' }, corsHeaders);
      }
      
      // Verificar autenticación para endpoints protegidos
      const authHeader = request.headers.get('Authorization');
      let currentUser = null;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        currentUser = await verifyToken(token, env);
        
        if (!currentUser) {
          return jsonResponse({ error: 'Invalid or expired token' }, corsHeaders, 401);
        }
      }
      
      // Business endpoints (requieren auth)
      if (path.startsWith('/api/business')) {
        if (!currentUser) {
          return jsonResponse({ error: 'Authentication required' }, corsHeaders, 401);
        }
        return handleBusiness(request, env, path, corsHeaders, currentUser);
      }
      
      // Users endpoints (requieren auth)
      if (path.startsWith('/api/users')) {
        if (!currentUser) {
          return jsonResponse({ error: 'Authentication required' }, corsHeaders, 401);
        }
        return handleUsers(request, env, path, corsHeaders, currentUser);
      }
      
      // Sync endpoints (requieren auth)
      if (path.startsWith('/api/sync')) {
        if (!currentUser) {
          return jsonResponse({ error: 'Authentication required' }, corsHeaders, 401);
        }
        return handleSync(request, env, path, corsHeaders, currentUser);
      }
      
      // Backup endpoint (requiere auth)
      if (path.startsWith('/api/backup')) {
        if (!currentUser) {
          return jsonResponse({ error: 'Authentication required' }, corsHeaders, 401);
        }
        return handleBackup(request, env, path, corsHeaders, currentUser);
      }
      
      // Push notifications endpoints
      if (path.startsWith('/api/push')) {
        // GET /api/push/vapid-key es público
        if (path === '/api/push/vapid-key' && request.method === 'GET') {
          return jsonResponse({ publicKey: env.VAPID_PUBLIC_KEY }, corsHeaders);
        }
        // El resto requiere auth
        if (!currentUser) {
          return jsonResponse({ error: 'Authentication required' }, corsHeaders, 401);
        }
        return handlePush(request, env, path, corsHeaders, currentUser);
      }

      // Feedback endpoint (público, sin auth)
      if (path === '/api/feedback' && request.method === 'POST') {
        return handleFeedback(request, env, corsHeaders);
      }

      // Test cron endpoint (público para pruebas - REMOVER EN PRODUCCIÓN)
      if (path === '/api/test-cron' && request.method === 'GET') {
        console.log('🧪 Ejecutando prueba manual del cron...');
        try {
          await runScheduledBackup(env);
          return jsonResponse({ 
            success: true, 
            message: 'Backup cron ejecutado manualmente',
            timestamp: new Date().toISOString()
          }, corsHeaders);
        } catch (error) {
          return jsonResponse({ success: false, error: error.message }, corsHeaders, 500);
        }
      }

      // Test push endpoint (solo para desarrollo)
      if (path === '/api/test-push' && request.method === 'GET') {        try {
          const subs = await env.DB.prepare(
            `SELECT id, endpoint, p256dh, auth, business_id FROM push_subscriptions WHERE is_active = 1`
          ).all();
          
          const results = [];
          for (const sub of (subs.results || [])) {
            try {
              const payload = JSON.stringify({
                title: 'Test Push Servidor',
                body: 'Notificación de prueba desde el Worker',
                tag: 'test-server'
              });
              // Versión diagnóstica que devuelve el error FCM
              const diagResult = await sendWebPushDiag(sub.endpoint, sub.p256dh, sub.auth, payload, env);
              results.push({ id: sub.id, endpoint: sub.endpoint.substring(0, 50), ...diagResult });
              if (!diagResult.success) {
                await env.DB.prepare(`UPDATE push_subscriptions SET is_active = 0 WHERE id = ?`).bind(sub.id).run();
              }
            } catch(e) {
              results.push({ id: sub.id, endpoint: sub.endpoint.substring(0, 50), error: e.message });
            }
          }
          return jsonResponse({ total: subs.results?.length || 0, results }, corsHeaders);
        } catch(e) {
          return jsonResponse({ error: e.message }, corsHeaders, 500);
        }
      }
      
      // WebSocket endpoint (requiere auth via query param)
      if (path === '/ws') {
        return handleWebSocket(request, env, corsHeaders);
      }
      
      return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
      
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse(
        { error: error.message || 'Internal server error' },
        corsHeaders,
        500
      );
    }
  },
  
  // Cron triggers
  async scheduled(event, env, ctx) {
    const cron = event.cron;
    console.log(`⏰ Cron ejecutado: ${cron}`);

    if (cron === '0 3 * * *') {
      // 10 PM Ecuador — backup + resumen completo del dia
      await runScheduledBackup(env);
      // runScheduledBackup ya llama runScheduledPushNotifications internamente
    } else if (cron === '0 13 * * *') {
      // 8 AM Ecuador — buenos dias + creditos urgentes
      await runScheduledPushNotifications(env, { merma: false, creditos: true, resumen: false });
    } else if (cron === '0 17 * * *') {
      // 12 PM Ecuador — estado del dia + merma pendiente
      await runScheduledPushNotifications(env, { merma: true, creditos: false, resumen: false });
    } else if (cron === '0 23 * * *') {
      // 6 PM Ecuador — alertas finales del dia
      await runScheduledPushNotifications(env, { merma: true, creditos: true, resumen: false });
    }
  }
};

// Función para ejecutar el backup programado (reutilizable)
async function runScheduledBackup(env) {
  try {
    // Obtener todos los negocios activos
    const businesses = await env.DB.prepare(`
      SELECT DISTINCT b.id, b.name, b.owner_user_id
      FROM businesses b
      INNER JOIN users u ON b.id = u.business_id
      WHERE u.is_active = 1
    `).all();
    
    console.log(`📊 Encontrados ${businesses.results?.length || 0} negocios activos`);
    
    for (const business of (businesses.results || [])) {
      try {
        console.log(`🔄 Procesando backup para: ${business.name}`);
        
        // Buscar credenciales de Telegram para este negocio
        const telegramCreds = await env.DB.prepare(`
          SELECT data FROM sync_data
          WHERE business_id = ? AND data_type = 'telegramCredentials' AND deleted = 0
          LIMIT 1
        `).bind(business.id).first();
        
        if (!telegramCreds) {
          console.log(`⚠️ No hay credenciales de Telegram para ${business.name}`);
          continue;
        }
        
        const creds = JSON.parse(telegramCreds.data);
        
        if (!creds.botToken || !creds.chatId) {
          console.log(`⚠️ Credenciales incompletas para ${business.name}`);
          continue;
        }
        
        console.log(`✅ Credenciales encontradas para ${business.name}`);
        
        // Obtener datos del negocio
        const syncData = await env.DB.prepare(`
          SELECT * FROM sync_data 
          WHERE business_id = ? AND deleted = 0
          ORDER BY data_type, created_at ASC
        `).bind(business.id).all();
        
        console.log(`📦 Datos obtenidos: ${syncData.results?.length || 0} registros`);
        
        // Agrupar datos
        const groupedData = {
          clients: [],
          sales: [],
          orders: [],
          expenses: [],
          prices: [],
          mermaRecords: [],
          diezmos: [],
          paymentHistory: [],
          config: []
        };
        
        for (const row of (syncData.results || [])) {
          const dataType = row.data_type;
          const data = JSON.parse(row.data);
          
          if (groupedData[dataType]) {
            groupedData[dataType].push(data);
          }
        }
        
        // Construir backup completo
        const backupData = {
          clients: groupedData.clients,
          sales: groupedData.sales,
          orders: groupedData.orders,
          expenses: groupedData.expenses,
          mermaPrices: groupedData.prices,
          mermaRecords: groupedData.mermaRecords,
          diezmosRecords: groupedData.diezmos,
          diezmosConfig: groupedData.config.find(c => c.key === 'diezmos-config')?.value ||
                         groupedData.config.find(c => c.key === 'diezmos') ||
                         { diezmoPercent: 10, ofrendaPercent: 5 },
          paymentHistory: groupedData.paymentHistory,
          creditosData: {
            creditSales: groupedData.sales.filter(s => !s.isPaid),
            paymentHistory: groupedData.sales.filter(s => s.paymentHistory && s.paymentHistory.length > 0)
          },
          config: groupedData.config.find(c => c.key === 'app') ||
                  groupedData.config.find(c => c.type === 'config') || {},
          telegramConfig: {
            botToken: creds.botToken,
            chatId: creds.chatId
          },
          metadata: {
            exportDate: new Date().toISOString(),
            version: '2.1',
            totalClients: groupedData.clients.length,
            totalSales: groupedData.sales.length,
            totalOrders: groupedData.orders.length,
            totalExpenses: groupedData.expenses.length,
            totalPayments: groupedData.paymentHistory.length,
            totalMermaRecords: groupedData.mermaRecords.length,
            totalDiezmos: groupedData.diezmos.length,
            appName: 'GallOli',
            businessId: business.id,
            businessName: business.name,
            createdBy: 'server-cron'
          }
        };
        
        const dataStr = JSON.stringify(backupData, null, 2);
        const filename = `pollos_backup_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
        
        console.log(`📤 Enviando backup a Telegram: ${filename}`);
        console.log(`📊 Tamaño: ${(new Blob([dataStr]).size / 1024).toFixed(2)} KB`);
        
        // Caption sin emojis ni tildes para evitar encoding roto en Cloudflare Workers
        const caption =
          `Backup Automatico GallOli\n` +
          `Negocio: ${business.name}\n` +
          `Fecha: ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC\n\n` +
          `Estadisticas:\n` +
          `Clientes: ${groupedData.clients.length}\n` +
          `Ventas: ${groupedData.sales.length}\n` +
          `Pedidos: ${groupedData.orders.length}\n` +
          `Gastos: ${groupedData.expenses.length}\n` +
          `Merma: ${groupedData.mermaRecords.length}\n` +
          `Diezmos: ${groupedData.diezmos.length}\n` +
          `Historial pagos: ${groupedData.paymentHistory.length}\n` +
          `Tamano: ${(dataStr.length / 1024).toFixed(2)} KB`;

        // Construir FormData con encoding correcto
        const formData = new FormData();
        formData.append('chat_id', creds.chatId);
        formData.append('document', new Blob([dataStr], { type: 'application/json' }), filename);
        formData.append('caption', caption);

        const telegramResponse = await fetch(
          `https://api.telegram.org/bot${creds.botToken}/sendDocument`,
          {
            method: 'POST',
            body: formData
          }
        );
        
        const telegramResult = await telegramResponse.json();
        
        if (telegramResult.ok) {
          console.log(`✅ Backup enviado exitosamente para ${business.name}`);
          
          // Registrar backup exitoso
          await env.DB.prepare(`
            INSERT INTO sync_data (id, business_id, data_type, data, version, created_by, created_at, updated_by, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            generateId(),
            business.id,
            'backupLog',
            JSON.stringify({
              filename,
              timestamp: Date.now(),
              success: true,
              method: 'cron'
            }),
            1,
            'server-cron',
            Date.now(),
            'server-cron',
            Date.now()
          ).run();
        } else {
          console.error(`❌ Error enviando backup para ${business.name}:`, telegramResult.description);
        }
        
      } catch (error) {
        console.error(`❌ Error procesando backup para ${business.name}:`, error);
        console.error('Stack:', error.stack);
      }
    }
    
    console.log('✅ Backup automático completado');
    
    // Enviar notificacion de resumen completo del dia (junto con el backup)
    await runScheduledPushNotifications(env, { merma: true, creditos: true, resumen: true });
    
  } catch (error) {
    console.error('❌ Error en backup automático:', error);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// Notificaciones push programadas con contenido util para el negocio
async function runScheduledPushNotifications(env, { merma = true, creditos = true, resumen = false } = {}) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const businesses = await env.DB.prepare(`
      SELECT DISTINCT b.id, b.name FROM businesses b
      INNER JOIN push_subscriptions ps ON ps.business_id = b.id
      WHERE ps.is_active = 1
    `).all();

    for (const business of (businesses.results || [])) {
      try {

        // ── Ventas del dia ────────────────────────────────────────────────
        const ventasHoy = await env.DB.prepare(`
          SELECT
            COUNT(*) as total,
            SUM(CAST(json_extract(data, '$.total') AS REAL)) as monto,
            SUM(CAST(json_extract(data, '$.weight') AS REAL)) as libras,
            SUM(CASE WHEN json_extract(data, '$.isPaid') = 0 THEN 1 ELSE 0 END) as creditos_hoy
          FROM sync_data
          WHERE business_id = ? AND data_type = 'sales' AND deleted = 0
          AND json_extract(data, '$.date') = ?
        `).bind(business.id, today).first();

        const totalVentas = ventasHoy?.total || 0;
        const montoHoy = (ventasHoy?.monto || 0).toFixed(2);
        const librasHoy = (ventasHoy?.libras || 0).toFixed(1);
        const creditosHoy = ventasHoy?.creditos_hoy || 0;

        // ── Creditos pendientes totales ───────────────────────────────────
        const creditosPendientes = await env.DB.prepare(`
          SELECT
            COUNT(*) as cnt,
            SUM(CAST(json_extract(data, '$.remainingDebt') AS REAL)) as deuda_total
          FROM sync_data
          WHERE business_id = ? AND data_type = 'sales' AND deleted = 0
          AND json_extract(data, '$.isPaid') = 0
        `).bind(business.id).first();

        const totalCreditos = creditosPendientes?.cnt || 0;
        const deudaTotal = (creditosPendientes?.deuda_total || 0).toFixed(2);

        // ── Credito mas antiguo sin cobrar ────────────────────────────────
        const creditoAntiguo = await env.DB.prepare(`
          SELECT
            json_extract(data, '$.clientName') as cliente,
            json_extract(data, '$.remainingDebt') as deuda,
            json_extract(data, '$.date') as fecha
          FROM sync_data
          WHERE business_id = ? AND data_type = 'sales' AND deleted = 0
          AND json_extract(data, '$.isPaid') = 0
          ORDER BY json_extract(data, '$.date') ASC
          LIMIT 1
        `).bind(business.id).first();

        // ── Merma del dia ─────────────────────────────────────────────────
        const mermaHoy = await env.DB.prepare(`
          SELECT
            json_extract(data, '$.pesoVivo') as vivo,
            json_extract(data, '$.pesoPelado') as pelado,
            json_extract(data, '$.porcentajeMerma') as porcentaje
          FROM sync_data
          WHERE business_id = ? AND data_type = 'mermaRecords' AND deleted = 0
          AND json_extract(data, '$.date') = ?
          LIMIT 1
        `).bind(business.id, today).first();

        // ── Precio del dia ────────────────────────────────────────────────
        const precioHoy = await env.DB.prepare(`
          SELECT json_extract(data, '$.salePrice') as precio
          FROM sync_data
          WHERE business_id = ? AND data_type = 'prices' AND deleted = 0
          AND json_extract(data, '$.date') = ?
          LIMIT 1
        `).bind(business.id, today).first();

        // ── Construir notificaciones segun el momento del dia ─────────────

        // 8 AM — Buenos dias + creditos urgentes
        if (creditos && !merma && !resumen) {
          if (totalCreditos > 0) {
            let body = `${totalCreditos} credito${totalCreditos > 1 ? 's' : ''} pendiente${totalCreditos > 1 ? 's' : ''} — $${deudaTotal} por cobrar`;
            if (creditoAntiguo?.cliente) {
              body += `\nMas antiguo: ${creditoAntiguo.cliente} ($${parseFloat(creditoAntiguo.deuda || 0).toFixed(2)}) desde ${creditoAntiguo.fecha}`;
            }
            await sendPushToAllSubs(business.id, 'Buenos dias — Creditos pendientes', body,
              { tag: 'creditos-manana', action: 'view-credits' }, env);
          } else {
            // Sin creditos — motivacional
            await sendPushToAllSubs(business.id, 'Buenos dias GallOli',
              'Sin creditos pendientes. Buen dia de ventas!',
              { tag: 'buenos-dias' }, env);
          }
        }

        // 12 PM — Estado del dia
        if (merma && !creditos && !resumen) {
          if (totalVentas > 0 && !mermaHoy) {
            const body = `${totalVentas} venta${totalVentas > 1 ? 's' : ''} registrada${totalVentas > 1 ? 's' : ''} — $${montoHoy} — ${librasHoy} lb\nNo has calculado la merma de hoy`;
            await sendPushToAllSubs(business.id, 'Merma pendiente', body,
              { tag: 'merma-mediodia', action: 'calculate-merma' }, env);
          } else if (totalVentas > 0 && mermaHoy) {
            const pct = mermaHoy.porcentaje ? parseFloat(mermaHoy.porcentaje).toFixed(1) : '?';
            const body = `${totalVentas} ventas — $${montoHoy} — ${librasHoy} lb\nMerma calculada: ${pct}%`;
            await sendPushToAllSubs(business.id, 'Resumen del mediodia', body,
              { tag: 'resumen-mediodia' }, env);
          } else {
            await sendPushToAllSubs(business.id, 'Sin ventas aun',
              'No hay ventas registradas hoy. Recuerda configurar el precio del dia.',
              { tag: 'sin-ventas' }, env);
          }
        }

        // 6 PM — Alerta final del dia
        if (merma && creditos && !resumen) {
          const alertas = [];

          if (totalVentas > 0 && !mermaHoy) {
            alertas.push(`Merma sin calcular (${totalVentas} ventas)`);
          }
          if (creditosHoy > 0) {
            alertas.push(`${creditosHoy} venta${creditosHoy > 1 ? 's' : ''} de hoy a credito`);
          }
          if (totalCreditos > 0) {
            alertas.push(`$${deudaTotal} pendiente de cobro en total`);
          }

          if (alertas.length > 0) {
            await sendPushToAllSubs(business.id, 'Pendientes del dia',
              alertas.join('\n'),
              { tag: 'pendientes-tarde', action: 'dashboard' }, env);
          } else if (totalVentas > 0) {
            const pct = mermaHoy?.porcentaje ? parseFloat(mermaHoy.porcentaje).toFixed(1) + '% merma' : '';
            await sendPushToAllSubs(business.id, 'Buen dia de trabajo',
              `${totalVentas} ventas — $${montoHoy} cobrado — ${librasHoy} lb ${pct}`.trim(),
              { tag: 'cierre-tarde' }, env);
          }
        }

        // 10 PM — Resumen completo del dia (junto con el backup)
        if (resumen) {
          if (totalVentas > 0) {
            const pct = mermaHoy?.porcentaje ? ` — Merma ${parseFloat(mermaHoy.porcentaje).toFixed(1)}%` : ' — Merma sin calcular';
            const creditoStr = totalCreditos > 0 ? `\n${totalCreditos} creditos pendientes: $${deudaTotal}` : '\nSin creditos pendientes';
            const precioStr = precioHoy?.precio ? ` a $${parseFloat(precioHoy.precio).toFixed(2)}/lb` : '';
            const body = `${totalVentas} ventas${precioStr} — $${montoHoy}${pct}\n${librasHoy} lb vendidas${creditoStr}`;
            await sendPushToAllSubs(business.id, 'Resumen del dia — Backup enviado', body,
              { tag: 'resumen-noche', action: 'dashboard' }, env);
          } else {
            await sendPushToAllSubs(business.id, 'Backup enviado',
              'Sin ventas hoy. Backup guardado en Telegram.',
              { tag: 'backup-noche' }, env);
          }
        }

      } catch (e) {
        console.error(`Push error for ${business.name}:`, e.message);
      }
    }
  } catch (e) {
    console.error('runScheduledPushNotifications error:', e.message);
  }
}

// Verificación de roles en endpoints protegidos
function requireRole(user, perms) {
  const matrix = {
    super_admin: '*',
    admin: ['sales.create','sales.edit','sales.delete','clients.crud','products.crud','prices.edit','expenses.crud','expenses.delete','merma.create','routes.assign','routes.execute','orders.manage','reports.view','users.manage','invitations.create','auto-sale.engine','sri.facturar'],
    vendedor:   ['sales.create','sales.edit','clients.crud','merma.create','routes.execute','orders.manage','auto-sale.engine'],
    repartidor: ['sales.create','routes.execute','orders.manage'],
    contador:   ['expenses.crud','reports.view','sri.facturar'],
    viewer:     ['reports.view'],
  };
  const list = matrix[user.role];
  if (list === '*') return;
  for (const p of perms) {
    if (!list || !list.includes(p)) {
      const err = new Error('forbidden:' + p);
      err.status = 403;
      throw err;
    }
  }
}

// Helper functions
function jsonResponse(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

async function getRequestBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function generateId() {
  return crypto.randomUUID();
}

function generateToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Hash password usando Web Crypto API
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Crear JWT simple
async function createJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  );
  
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${data}.${encodedSignature}`;
}

// Verificar JWT
async function verifyJWT(token, secret) {
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    const data = `${encodedHeader}.${encodedPayload}`;
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    
    const signature = Uint8Array.from(atob(encodedSignature), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(data)
    );
    
    if (!valid) return null;
    
    const payload = JSON.parse(atob(encodedPayload));
    
    // Verificar expiración
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return null;
    }
    
    return payload;
  } catch {
    return null;
  }
}

// Verificar token y obtener usuario
async function verifyToken(token, env) {
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return null;
  
  // Buscar usuario en DB
  const result = await env.DB.prepare(`
    SELECT u.*, b.name as business_name
    FROM users u
    LEFT JOIN businesses b ON u.business_id = b.id
    WHERE u.id = ? AND u.is_active = 1
  `).bind(payload.user_id).first();
  
  if (!result) return null;
  
  // Actualizar last_seen
  await env.DB.prepare(`
    UPDATE users SET last_seen = ? WHERE id = ?
  `).bind(Date.now(), result.id).run();
  
  return result;
}

// Auth handlers
async function handleAuth(request, env, path, corsHeaders) {
  try {
    const method = request.method;
    
    // POST /api/auth/telegram/init - Iniciar login con Telegram
    if (path === '/api/auth/telegram/init' && method === 'POST') {
      const { telegram_id, telegram_username, telegram_first_name } = await getRequestBody(request);
      
      if (!telegram_id) {
        return jsonResponse({ error: 'telegram_id required' }, corsHeaders, 400);
      }
      
      // Generar código de verificación de 6 dígitos
      const verification_code = Math.floor(100000 + Math.random() * 900000).toString();
      const expires_at = Date.now() + (5 * 60 * 1000); // 5 minutos
      
      // Guardar código en tabla temporal
      await env.DB.prepare(`
        INSERT OR REPLACE INTO verification_codes (telegram_id, code, expires_at, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(telegram_id, verification_code, expires_at, Date.now()).run();
      
      // Enviar código via Telegram Bot (opcional)
      try {
        const botToken = env.TELEGRAM_BOT_TOKEN;
        const message = `Tu codigo de verificacion para GallOli es: *${verification_code}*\n\nExpira en 5 minutos.`;
        
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegram_id,
            text: message,
            parse_mode: 'Markdown'
        })
      });
    } catch (error) {
      console.error('Error enviando mensaje Telegram:', error);
    }
    
    return jsonResponse({
      success: true,
      message: 'Código enviado a Telegram',
      expires_in: 300
    }, corsHeaders);
  }
  
  // POST /api/auth/telegram/verify - Verificar código y crear sesión
  if (path === '/api/auth/telegram/verify' && method === 'POST') {
    const { telegram_id, verification_code, telegram_username, telegram_first_name } = await getRequestBody(request);
    
    if (!telegram_id || !verification_code) {
      return jsonResponse({ error: 'Missing parameters' }, corsHeaders, 400);
    }
    
    // Verificar código
    const codeRecord = await env.DB.prepare(`
      SELECT * FROM verification_codes
      WHERE telegram_id = ? AND code = ? AND expires_at > ?
    `).bind(telegram_id, verification_code, Date.now()).first();
    
    if (!codeRecord) {
      return jsonResponse({ error: 'Código inválido o expirado' }, corsHeaders, 401);
    }
    
    // Eliminar código usado
    await env.DB.prepare(`
      DELETE FROM verification_codes WHERE telegram_id = ?
    `).bind(telegram_id).run();
    
    // Buscar usuario existente
    let user = await env.DB.prepare(`
      SELECT * FROM users WHERE telegram_id = ?
    `).bind(telegram_id).first();
    
    let business = null;
    
    if (user) {
      // Usuario existente
      business = await env.DB.prepare(`
        SELECT * FROM businesses WHERE id = ?
      `).bind(user.business_id).first();
      
      // Actualizar last_seen
      await env.DB.prepare(`
        UPDATE users SET last_seen = ? WHERE id = ?
      `).bind(Date.now(), user.id).run();
      
    } else {
      // Nuevo usuario - crear negocio y usuario
      const businessId = generateId();
      const userId = generateId();
      const userName = telegram_first_name || telegram_username || `Usuario ${telegram_id}`;
      
      // Crear negocio
      await env.DB.prepare(`
        INSERT INTO businesses (id, name, owner_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(businessId, `Negocio de ${userName}`, userId, Date.now(), Date.now()).run();
      
      // Crear usuario
      await env.DB.prepare(`
        INSERT INTO users (id, business_id, telegram_id, telegram_username, name, role, is_active, created_at, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        userId,
        businessId,
        telegram_id,
        telegram_username || null,
        userName,
        'super_admin',
        1,
        Date.now(),
        Date.now()
      ).run();
      
      user = {
        id: userId,
        business_id: businessId,
        telegram_id,
        telegram_username,
        name: userName,
        role: 'super_admin',
        is_active: 1
      };
      
      business = {
        id: businessId,
        name: `Negocio de ${userName}`,
        owner_user_id: userId
      };
    }
    
    // Crear JWT token
    const tokenPayload = {
      user_id: user.id,
      business_id: user.business_id,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 días
    };
    
    const token = await createJWT(tokenPayload, env.JWT_SECRET);
    
    // Guardar sesión
    const sessionId = generateId();
    await env.DB.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_activity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      sessionId,
      user.id,
      await hashPassword(token),
      Date.now(),
      Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 días
      Date.now()
    ).run();
    
    return jsonResponse({
      token,
      user: {
        id: user.id,
        business_id: user.business_id,
        telegram_id: user.telegram_id,
        telegram_username: user.telegram_username,
        name: user.name,
        role: user.role
      },
      business: {
        id: business.id,
        name: business.name
      }
    }, corsHeaders);
  }
  
  // POST /api/auth/email/register - Registro con email (con soporte de invitation_code)
  if (path === '/api/auth/email/register' && method === 'POST') {
    const { email, password, name, invitation_code } = await getRequestBody(request);

    if (!email || !password || !name) {
      return jsonResponse({ error: 'Email, password y name requeridos' }, corsHeaders, 400);
    }
    if (password.length < 6) {
      return jsonResponse({ error: 'La contraseña debe tener al menos 6 caracteres' }, corsHeaders, 400);
    }

    // Verificar si email ya existe
    const existing = await env.DB.prepare(
      `SELECT id FROM users WHERE email = ?`
    ).bind(email.toLowerCase().trim()).first();
    if (existing) {
      return jsonResponse({ error: 'Email ya registrado' }, corsHeaders, 409);
    }

    const userId = generateId();
    const passwordHash = await hashPassword(password);
    let businessId, userRole;

    if (invitation_code) {
      // ── Registro con código de invitación: unirse al negocio del dueño ──
      const invite = await env.DB.prepare(`
        SELECT * FROM invitation_codes
        WHERE code = ? AND is_active = 1
          AND (expires_at IS NULL OR expires_at > ?)
          AND (max_uses = 0 OR uses < max_uses)
      `).bind(invitation_code.toUpperCase().trim(), Date.now()).first();

      if (!invite) {
        return jsonResponse({ error: 'Código de invitación inválido, expirado o ya usado' }, corsHeaders, 400);
      }

      businessId = invite.business_id;
      userRole   = invite.role || 'vendedor';

      // Incrementar uso del código
      await env.DB.prepare(
        `UPDATE invitation_codes SET uses = uses + 1 WHERE code = ?`
      ).bind(invite.code).run();

      // Desactivar si alcanzó el límite
      if (invite.max_uses > 0 && invite.uses + 1 >= invite.max_uses) {
        await env.DB.prepare(
          `UPDATE invitation_codes SET is_active = 0 WHERE code = ?`
        ).bind(invite.code).run();
      }
    } else {
      // ── Registro normal: crear nuevo negocio ──
      businessId = generateId();
      userRole   = 'super_admin';

      await env.DB.prepare(`
        INSERT INTO businesses (id, name, owner_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(businessId, `Negocio de ${name}`, userId, Date.now(), Date.now()).run();
    }

    await env.DB.prepare(`
      INSERT INTO users (id, business_id, email, password_hash, name, role, is_active, created_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(userId, businessId, email.toLowerCase().trim(), passwordHash, name, userRole, Date.now(), Date.now()).run();

    const tokenPayload = {
      user_id: userId,
      business_id: businessId,
      role: userRole,
      exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
    };
    const token = await createJWT(tokenPayload, env.JWT_SECRET);

    await env.DB.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_activity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(generateId(), userId, await hashPassword(token), Date.now(),
            Date.now() + (30 * 24 * 60 * 60 * 1000), Date.now()).run();

    const business = await env.DB.prepare(
      `SELECT id, name FROM businesses WHERE id = ?`
    ).bind(businessId).first();

    return jsonResponse({
      token,
      user: { id: userId, business_id: businessId, name, role: userRole },
      business: { id: businessId, name: business?.name || `Negocio de ${name}` }
    }, corsHeaders);
  }
  
  // POST /api/auth/email/login - Login con email
  if (path === '/api/auth/email/login' && method === 'POST') {
    const { email, password } = await getRequestBody(request);
    
    if (!email || !password) {
      return jsonResponse({ error: 'Email y password requeridos' }, corsHeaders, 400);
    }
    
    // Buscar usuario
    const user = await env.DB.prepare(`
      SELECT * FROM users WHERE email = ? AND is_active = 1
    `).bind(email).first();
    
    if (!user) {
      return jsonResponse({ error: 'Credenciales inválidas' }, corsHeaders, 401);
    }
    
    // Verificar password
    const passwordHash = await hashPassword(password);
    if (passwordHash !== user.password_hash) {
      return jsonResponse({ error: 'Credenciales inválidas' }, corsHeaders, 401);
    }
    
    // Buscar negocio
    const business = await env.DB.prepare(`
      SELECT * FROM businesses WHERE id = ?
    `).bind(user.business_id).first();
    
    // Crear token
    const tokenPayload = {
      user_id: user.id,
      business_id: user.business_id,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
    };
    
    const token = await createJWT(tokenPayload, env.JWT_SECRET);
    
    // Guardar sesión
    await env.DB.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_activity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      generateId(),
      user.id,
      await hashPassword(token),
      Date.now(),
      Date.now() + (30 * 24 * 60 * 60 * 1000),
      Date.now()
    ).run();
    
    // Actualizar last_seen
    await env.DB.prepare(`
      UPDATE users SET last_seen = ? WHERE id = ?
    `).bind(Date.now(), user.id).run();
    
    return jsonResponse({
      token,
      user: {
        id: user.id,
        business_id: user.business_id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      business: {
        id: business.id,
        name: business.name
      }
    }, corsHeaders);
  }
  
  // POST /api/auth/pin/set - Establecer PIN
  if (path === '/api/auth/pin/set' && method === 'POST') {
    const { user_id, pin } = await getRequestBody(request);
    
    if (!user_id || !pin || pin.length !== 4) {
      return jsonResponse({ error: 'user_id y PIN de 4 dígitos requeridos' }, corsHeaders, 400);
    }
    
    const pinHash = await hashPassword(pin);
    
    await env.DB.prepare(`
      UPDATE users SET pin_hash = ? WHERE id = ?
    `).bind(pinHash, user_id).run();
    
    return jsonResponse({ success: true }, corsHeaders);
  }
  
  // POST /api/auth/pin/login - Login con PIN
  if (path === '/api/auth/pin/login' && method === 'POST') {
    const { user_id, pin } = await getRequestBody(request);
    
    if (!user_id || !pin) {
      return jsonResponse({ error: 'user_id y PIN requeridos' }, corsHeaders, 400);
    }
    
    const user = await env.DB.prepare(`
      SELECT * FROM users WHERE id = ? AND is_active = 1
    `).bind(user_id).first();
    
    if (!user || !user.pin_hash) {
      return jsonResponse({ error: 'PIN no configurado' }, corsHeaders, 401);
    }
    
    const pinHash = await hashPassword(pin);
    if (pinHash !== user.pin_hash) {
      return jsonResponse({ error: 'PIN incorrecto' }, corsHeaders, 401);
    }
    
    // Crear token
    const tokenPayload = {
      user_id: user.id,
      business_id: user.business_id,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
    };
    
    const token = await createJWT(tokenPayload, env.JWT_SECRET);
    
    // Guardar sesión
    await env.DB.prepare(`
      INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_activity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      generateId(),
      user.id,
      await hashPassword(token),
      Date.now(),
      Date.now() + (30 * 24 * 60 * 60 * 1000),
      Date.now()
    ).run();
    
    return jsonResponse({
      token,
      user: {
        id: user.id,
        business_id: user.business_id,
        name: user.name,
        role: user.role
      }
    }, corsHeaders);
  }
  
  // POST /api/auth/refresh - Refrescar token
  if (path === '/api/auth/refresh' && method === 'POST') {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Token requerido' }, corsHeaders, 401);
    }
    
    const token = authHeader.substring(7);
    const user = await verifyToken(token, env);
    
    if (!user) {
      return jsonResponse({ error: 'Token inválido' }, corsHeaders, 401);
    }
    
    // Crear nuevo token
    const tokenPayload = {
      user_id: user.id,
      business_id: user.business_id,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
    };
    
    const newToken = await createJWT(tokenPayload, env.JWT_SECRET);
    
    return jsonResponse({ token: newToken }, corsHeaders);
  }
  
  // POST /api/auth/logout - Cerrar sesión
  if (path === '/api/auth/logout' && method === 'POST') {
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const tokenHash = await hashPassword(token);
      
      // Eliminar sesión
      await env.DB.prepare(`
        DELETE FROM sessions WHERE token_hash = ?
      `).bind(tokenHash).run();
    }
    
    return jsonResponse({ success: true }, corsHeaders);
  }

  // DELETE /api/auth/account - Eliminar cuenta y datos
  if (path === '/api/auth/account' && method === 'DELETE') {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Token requerido' }, corsHeaders, 401);
    }

    const token = authHeader.substring(7);
    const currentUser = await verifyToken(token, env);

    if (!currentUser) {
      return jsonResponse({ error: 'Token inválido o expirado' }, corsHeaders, 401);
    }

    try {
      // Contar cuántos usuarios activos tiene el negocio
      const usersCount = await env.DB.prepare(`
        SELECT COUNT(*) as count FROM users WHERE business_id = ? AND is_active = 1
      `).bind(currentUser.business_id).first();

      const isOnlyUser = (usersCount?.count || 0) <= 1;
      const isOwner = currentUser.role === 'super_admin';

      if (isOwner && isOnlyUser) {
        // Eliminar todo el negocio y sus datos
        await env.DB.prepare(`DELETE FROM sync_data WHERE business_id = ?`).bind(currentUser.business_id).run();
        await env.DB.prepare(`DELETE FROM changes WHERE business_id = ?`).bind(currentUser.business_id).run();
        await env.DB.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE business_id = ?)`).bind(currentUser.business_id).run();
        await env.DB.prepare(`DELETE FROM invitation_codes WHERE business_id = ?`).bind(currentUser.business_id).run();
        await env.DB.prepare(`DELETE FROM users WHERE business_id = ?`).bind(currentUser.business_id).run();
        await env.DB.prepare(`DELETE FROM businesses WHERE id = ?`).bind(currentUser.business_id).run();

        return jsonResponse({ success: true, deleted: 'full' }, corsHeaders);
      } else {
        // Solo eliminar al usuario actual y sus sesiones
        await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(currentUser.id).run();
        await env.DB.prepare(`UPDATE users SET is_active = 0 WHERE id = ?`).bind(currentUser.id).run();

        return jsonResponse({ success: true, deleted: 'user_only' }, corsHeaders);
      }
    } catch (error) {
      console.error('Error eliminando cuenta:', error);
      return jsonResponse({ error: 'Error al eliminar la cuenta' }, corsHeaders, 500);
    }
  }
  
  // POST /api/auth/email/forgot — Solicitar recuperación de contraseña
  if (path === '/api/auth/email/forgot' && method === 'POST') {
    const { email } = await getRequestBody(request);
    if (!email) return jsonResponse({ success: true }, corsHeaders); // no revelar si existe

    try {
      const user = await env.DB.prepare(
        `SELECT id, telegram_id, name FROM users WHERE email = ? AND is_active = 1 LIMIT 1`
      ).bind(email.toLowerCase().trim()).first();

      if (user) {
        // Generar token de 32 bytes hex
        const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map(b => b.toString(16).padStart(2, '0')).join('');
        const tokenHash = await hashPassword(rawToken);
        const expiresAt = Date.now() + 30 * 60 * 1000; // 30 min

        await env.DB.prepare(
          `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(generateId(), user.id, tokenHash, expiresAt, Date.now()).run();

        const resetLink = `https://galloli.ivapps.store/?reset=${rawToken}`;
        const msg = `🔑 *GallOli — Recuperar contraseña*\n\nHola ${user.name},\n\nTu enlace de recuperación (válido 30 min):\n${resetLink}\n\nSi no solicitaste esto, ignora este mensaje.`;

        // Enviar por Telegram si tiene cuenta vinculada
        if (user.telegram_id && env.TELEGRAM_BOT_TOKEN) {
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: user.telegram_id, text: msg, parse_mode: 'Markdown' })
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('forgot password error:', e);
    }

    // Siempre 200 para no revelar si el email existe
    return jsonResponse({ success: true, message: 'Si el email existe, recibirás un enlace en breve.' }, corsHeaders);
  }

  // POST /api/auth/email/reset — Establecer nueva contraseña con token
  if (path === '/api/auth/email/reset' && method === 'POST') {
    const { token, password } = await getRequestBody(request);
    if (!token || !password || password.length < 6) {
      return jsonResponse({ error: 'Token y contraseña (mín. 6 caracteres) requeridos' }, corsHeaders, 400);
    }

    const tokenHash = await hashPassword(token);
    const record = await env.DB.prepare(
      `SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ? AND used_at IS NULL LIMIT 1`
    ).bind(tokenHash, Date.now()).first();

    if (!record) {
      return jsonResponse({ error: 'Token inválido o expirado' }, corsHeaders, 400);
    }

    const passwordHash = await hashPassword(password);
    await env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`)
      .bind(passwordHash, record.user_id).run();
    await env.DB.prepare(`UPDATE password_resets SET used_at = ? WHERE id = ?`)
      .bind(Date.now(), record.id).run();

    return jsonResponse({ success: true, message: 'Contraseña actualizada correctamente' }, corsHeaders);
  }

  // POST /api/auth/email/recover-by-telegram — Recuperar email enmascarado por Telegram ID
  if (path === '/api/auth/email/recover-by-telegram' && method === 'POST') {
    const { telegram_id } = await getRequestBody(request);
    if (!telegram_id) return jsonResponse({ error: 'telegram_id requerido' }, corsHeaders, 400);

    const user = await env.DB.prepare(
      `SELECT email FROM users WHERE telegram_id = ? AND is_active = 1 LIMIT 1`
    ).bind(String(telegram_id)).first();

    if (!user || !user.email) {
      return jsonResponse({ error: 'No se encontró ninguna cuenta con ese Telegram ID' }, corsHeaders, 404);
    }

    // Enmascarar: j***@gmail.com
    const [local, domain] = user.email.split('@');
    const masked = local[0] + '***@' + domain;
    return jsonResponse({ email: masked }, corsHeaders);
  }

  return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
  
  } catch (error) {
    console.error('Error in handleAuth:', error);
    return jsonResponse({ error: error.message || 'Internal server error' }, corsHeaders, 500);
  }
}

// Business handlers
async function handleBusiness(request, env, path, corsHeaders, currentUser) {
  const method = request.method;
  
  // GET /api/business - Obtener negocio actual
  if (path === '/api/business' && method === 'GET') {
    const business = await env.DB.prepare(`
      SELECT * FROM businesses WHERE id = ?
    `).bind(currentUser.business_id).first();
    
    if (!business) {
      return jsonResponse({ error: 'Negocio no encontrado' }, corsHeaders, 404);
    }
    
    return jsonResponse({ business }, corsHeaders);
  }
  
  // PUT /api/business - Actualizar negocio
  if (path === '/api/business' && method === 'PUT') {
    // Verificar permisos
    if (!['super_admin', 'admin'].includes(currentUser.role)) {
      return jsonResponse({ error: 'Sin permisos' }, corsHeaders, 403);
    }
    
    const { name, settings } = await getRequestBody(request);
    
    await env.DB.prepare(`
      UPDATE businesses 
      SET name = COALESCE(?, name),
          settings = COALESCE(?, settings),
          updated_at = ?
      WHERE id = ?
    `).bind(
      name || null,
      settings ? JSON.stringify(settings) : null,
      Date.now(),
      currentUser.business_id
    ).run();
    
    const business = await env.DB.prepare(`
      SELECT * FROM businesses WHERE id = ?
    `).bind(currentUser.business_id).first();
    
    return jsonResponse({ business }, corsHeaders);
  }
  
  // POST /api/business/invitation - Crear código de invitación
  if (path === '/api/business/invitation' && method === 'POST') {
    // Verificar permisos
    if (!['super_admin', 'admin'].includes(currentUser.role)) {
      return jsonResponse({ error: 'Sin permisos' }, corsHeaders, 403);
    }
    
    const { role, max_uses, expires_in_hours } = await getRequestBody(request);
    
    if (!role) {
      return jsonResponse({ error: 'role requerido' }, corsHeaders, 400);
    }
    
    // Generar código único de 8 caracteres
    const code = generateToken().substring(0, 8).toUpperCase();
    const expiresAt = expires_in_hours 
      ? Date.now() + (expires_in_hours * 60 * 60 * 1000)
      : null;
    
    await env.DB.prepare(`
      INSERT INTO invitation_codes (code, business_id, created_by, role, max_uses, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      code,
      currentUser.business_id,
      currentUser.id,
      role,
      max_uses || 1,
      expiresAt,
      Date.now()
    ).run();
    
    return jsonResponse({
      code,
      role,
      max_uses: max_uses || 1,
      expires_at: expiresAt
    }, corsHeaders);
  }
  
  // POST /api/business/join - Unirse con código de invitación
  if (path === '/api/business/join' && method === 'POST') {
    const { code } = await getRequestBody(request);
    
    if (!code) {
      return jsonResponse({ error: 'code requerido' }, corsHeaders, 400);
    }
    
    // Buscar código
    const invitation = await env.DB.prepare(`
      SELECT * FROM invitation_codes 
      WHERE code = ? AND is_active = 1
    `).bind(code.toUpperCase()).first();
    
    if (!invitation) {
      return jsonResponse({ error: 'Código inválido' }, corsHeaders, 404);
    }
    
    // Verificar expiración
    if (invitation.expires_at && invitation.expires_at < Date.now()) {
      return jsonResponse({ error: 'Código expirado' }, corsHeaders, 410);
    }
    
    // Verificar usos
    if (invitation.uses >= invitation.max_uses) {
      return jsonResponse({ error: 'Código agotado' }, corsHeaders, 410);
    }
    
    // Actualizar usuario
    await env.DB.prepare(`
      UPDATE users 
      SET business_id = ?, role = ?
      WHERE id = ?
    `).bind(invitation.business_id, invitation.role, currentUser.id).run();
    
    // Incrementar usos
    await env.DB.prepare(`
      UPDATE invitation_codes 
      SET uses = uses + 1
      WHERE code = ?
    `).bind(code.toUpperCase()).run();
    
    // Obtener negocio
    const business = await env.DB.prepare(`
      SELECT * FROM businesses WHERE id = ?
    `).bind(invitation.business_id).first();
    
    return jsonResponse({
      success: true,
      business,
      role: invitation.role
    }, corsHeaders);
  }
  
  return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
}

// Users handlers
async function handleUsers(request, env, path, corsHeaders, currentUser) {
  const method = request.method;
  
  // GET /api/users - Listar usuarios del negocio
  if (path === '/api/users' && method === 'GET') {
    const users = await env.DB.prepare(`
      SELECT id, business_id, telegram_id, telegram_username, email, name, role, created_at, last_seen, is_active
      FROM users 
      WHERE business_id = ?
      ORDER BY created_at DESC
    `).bind(currentUser.business_id).all();
    
    return jsonResponse({ users: users.results || [] }, corsHeaders);
  }
  
  // GET /api/users/online - Usuarios online
  if (path === '/api/users/online' && method === 'GET') {
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    
    const users = await env.DB.prepare(`
      SELECT id, name, role, last_seen
      FROM users 
      WHERE business_id = ? AND last_seen > ? AND is_active = 1
      ORDER BY last_seen DESC
    `).bind(currentUser.business_id, fiveMinutesAgo).all();
    
    return jsonResponse({ users: users.results || [] }, corsHeaders);
  }
  
  // GET /api/users/:id - Obtener usuario específico
  if (path.match(/^\/api\/users\/[^\/]+$/) && method === 'GET') {
    const userId = path.split('/').pop();
    
    const user = await env.DB.prepare(`
      SELECT id, business_id, telegram_id, telegram_username, email, name, role, created_at, last_seen, is_active
      FROM users 
      WHERE id = ? AND business_id = ?
    `).bind(userId, currentUser.business_id).first();
    
    if (!user) {
      return jsonResponse({ error: 'Usuario no encontrado' }, corsHeaders, 404);
    }
    
    return jsonResponse({ user }, corsHeaders);
  }
  
  // PUT /api/users/:id - Actualizar usuario
  if (path.match(/^\/api\/users\/[^\/]+$/) && method === 'PUT') {
    const userId = path.split('/').pop();
    
    // Verificar permisos
    if (!['super_admin', 'admin'].includes(currentUser.role)) {
      return jsonResponse({ error: 'Sin permisos' }, corsHeaders, 403);
    }
    
    const { name, role, is_active } = await getRequestBody(request);
    
    // Verificar que el usuario pertenece al mismo negocio
    const targetUser = await env.DB.prepare(`
      SELECT * FROM users WHERE id = ? AND business_id = ?
    `).bind(userId, currentUser.business_id).first();
    
    if (!targetUser) {
      return jsonResponse({ error: 'Usuario no encontrado' }, corsHeaders, 404);
    }
    
    // No permitir que admin modifique super_admin
    if (targetUser.role === 'super_admin' && currentUser.role !== 'super_admin') {
      return jsonResponse({ error: 'Sin permisos' }, corsHeaders, 403);
    }
    
    await env.DB.prepare(`
      UPDATE users 
      SET name = COALESCE(?, name),
          role = COALESCE(?, role),
          is_active = COALESCE(?, is_active)
      WHERE id = ?
    `).bind(
      name || null,
      role || null,
      is_active !== undefined ? is_active : null,
      userId
    ).run();
    
    const user = await env.DB.prepare(`
      SELECT id, business_id, telegram_id, telegram_username, email, name, role, created_at, last_seen, is_active
      FROM users WHERE id = ?
    `).bind(userId).first();
    
    return jsonResponse({ user }, corsHeaders);
  }
  
  // DELETE /api/users/:id - Desactivar usuario
  if (path.match(/^\/api\/users\/[^\/]+$/) && method === 'DELETE') {
    const userId = path.split('/').pop();
    
    // Verificar permisos
    if (!['super_admin', 'admin'].includes(currentUser.role)) {
      return jsonResponse({ error: 'Sin permisos' }, corsHeaders, 403);
    }
    
    // Verificar que el usuario pertenece al mismo negocio
    const targetUser = await env.DB.prepare(`
      SELECT * FROM users WHERE id = ? AND business_id = ?
    `).bind(userId, currentUser.business_id).first();
    
    if (!targetUser) {
      return jsonResponse({ error: 'Usuario no encontrado' }, corsHeaders, 404);
    }
    
    // No permitir eliminar super_admin
    if (targetUser.role === 'super_admin') {
      return jsonResponse({ error: 'No se puede eliminar super_admin' }, corsHeaders, 403);
    }
    
    // No permitir auto-eliminación
    if (userId === currentUser.id) {
      return jsonResponse({ error: 'No puedes eliminarte a ti mismo' }, corsHeaders, 403);
    }
    
    // Desactivar usuario
    await env.DB.prepare(`
      UPDATE users SET is_active = 0 WHERE id = ?
    `).bind(userId).run();
    
    // Eliminar sesiones
    await env.DB.prepare(`
      DELETE FROM sessions WHERE user_id = ?
    `).bind(userId).run();
    
    return jsonResponse({ success: true }, corsHeaders);
  }
  
  return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
}

// Sync handlers
async function handleSync(request, env, path, corsHeaders, currentUser) {
  const method = request.method;
  
  // POST /api/sync/push - Subir cambios locales
  if (path === '/api/sync/push' && method === 'POST') {
    const { changes } = await getRequestBody(request);
    
    if (!changes || !Array.isArray(changes)) {
      return jsonResponse({ error: 'changes array requerido' }, corsHeaders, 400);
    }
    
    const results = [];
    
    for (const change of changes) {
      const { data_type, data_id, action, data } = change;
      
      if (!data_type || !data_id || !action) {
        results.push({ error: 'Campos requeridos faltantes', change });
        continue;
      }

      // Defensa en profundidad: los borrados exigen el permiso del tipo de dato.
      // El frontend ya oculta los botones, pero cualquiera puede forzar el fetch.
      if (action === 'delete') {
        const permisosPorTipo = {
          sales: 'sales.delete',
          expenses: 'expenses.delete',
          orders: 'orders.manage',
          clients: 'clients.crud',
          products: 'products.crud',
          prices: 'prices.edit'
        };
        const permisoRequerido = permisosPorTipo[data_type];
        if (permisoRequerido) {
          try {
            requireRole(currentUser, [permisoRequerido]);
          } catch (permError) {
            results.push({ error: permError.message, change });
            continue;
          }
        }
      }
      
      try {
        // Registrar cambio
        const changeId = generateId();
        await env.DB.prepare(`
          INSERT INTO changes (id, business_id, user_id, data_type, data_id, action, changes, timestamp, synced)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          changeId,
          currentUser.business_id,
          currentUser.id,
          data_type,
          data_id,
          action,
          JSON.stringify(change),
          Date.now(),
          1
        ).run();
        
        // Actualizar o crear en sync_data
        if (action === 'delete') {
          // Buscar por data_type y el ID dentro del JSON data
          const existing = await env.DB.prepare(`
            SELECT id FROM sync_data 
            WHERE business_id = ? AND data_type = ? AND json_extract(data, '$.id') = ? AND deleted = 0
          `).bind(currentUser.business_id, data_type, data_id).first();
          
          if (existing) {
            await env.DB.prepare(`
              UPDATE sync_data 
              SET deleted = 1, deleted_at = ?, updated_by = ?, updated_at = ?
              WHERE id = ? AND business_id = ?
            `).bind(Date.now(), currentUser.id, Date.now(), existing.id, currentUser.business_id).run();
            console.log(`🗑️ Marcado como eliminado: ${data_type}/${data_id}`);
          } else {
            console.warn(`⚠️ No se encontró ${data_type}/${data_id} para eliminar`);
          }
        } else {
          const existing = await env.DB.prepare(`
            SELECT version FROM sync_data WHERE id = ? AND business_id = ?
          `).bind(data_id, currentUser.business_id).first();
          
          const newVersion = existing ? existing.version + 1 : 1;
          
          if (existing) {
            await env.DB.prepare(`
              UPDATE sync_data 
              SET data = ?, version = ?, updated_by = ?, updated_at = ?
              WHERE id = ? AND business_id = ?
            `).bind(
              JSON.stringify(data),
              newVersion,
              currentUser.id,
              Date.now(),
              data_id,
              currentUser.business_id
            ).run();
          } else {
            await env.DB.prepare(`
              INSERT INTO sync_data (id, business_id, data_type, data, version, created_by, created_at, updated_by, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              data_id,
              currentUser.business_id,
              data_type,
              JSON.stringify(data),
              newVersion,
              currentUser.id,
              Date.now(),
              currentUser.id,
              Date.now()
            ).run();
          }
        }
        
        results.push({ success: true, change_id: changeId, data_id });
        
        // Notificar via WebSocket a otros usuarios
        try {
          const id = env.SESSION_MANAGER.idFromName(currentUser.business_id);
          const stub = env.SESSION_MANAGER.get(id);
          await stub.fetch(new Request('https://dummy/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: {
                type: 'change',
                from: currentUser.id,
                data: {
                  data_type: data_type,
                  action: action,
                  timestamp: Date.now()
                }
              }
            })
          }));
        } catch (wsError) {
          console.error('Error notificando via WebSocket:', wsError);
        }
        
      } catch (error) {
        results.push({ error: error.message, change });
      }
    }
    
    return jsonResponse({ results }, corsHeaders);
  }
  
  // GET /api/sync/pull - Descargar cambios remotos
  if (path === '/api/sync/pull' && method === 'GET') {
    const url = new URL(request.url);
    const since = parseInt(url.searchParams.get('since') || '0');
    const data_type = url.searchParams.get('data_type');
    
    let query = `
      SELECT * FROM sync_data 
      WHERE business_id = ? AND updated_at > ?
    `;
    const params = [currentUser.business_id, since];
    
    if (data_type) {
      query += ` AND data_type = ?`;
      params.push(data_type);
    }
    
    query += ` ORDER BY updated_at ASC LIMIT 1000`;
    
    const result = await env.DB.prepare(query).bind(...params).all();
    
    const data = (result.results || []).map(row => ({
      id: row.id,
      data_type: row.data_type,
      data: JSON.parse(row.data),
      version: row.version,
      updated_at: row.updated_at,
      updated_by: row.updated_by,
      deleted: row.deleted === 1
    }));
    
    return jsonResponse({
      data,
      timestamp: Date.now(),
      has_more: data.length === 1000
    }, corsHeaders);
  }
  
  // GET /api/sync/full - Sincronización completa
  if (path === '/api/sync/full' && method === 'GET') {
    const url = new URL(request.url);
    const data_type = url.searchParams.get('data_type');
    
    let query = `
      SELECT * FROM sync_data 
      WHERE business_id = ? AND deleted = 0
    `;
    const params = [currentUser.business_id];
    
    if (data_type) {
      query += ` AND data_type = ?`;
      params.push(data_type);
    }
    
    query += ` ORDER BY created_at ASC`;
    
    const result = await env.DB.prepare(query).bind(...params).all();
    
    const data = (result.results || []).map(row => ({
      id: row.id,
      data_type: row.data_type,
      data: JSON.parse(row.data),
      version: row.version,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
    
    return jsonResponse({
      data,
      timestamp: Date.now(),
      total: data.length
    }, corsHeaders);
  }
  
  // POST /api/sync/cleanup-duplicates - Limpiar duplicados del servidor
  if (path === '/api/sync/cleanup-duplicates' && method === 'POST') {
    try {
      console.log('🧹 Iniciando limpieza de duplicados...');
      
      // Obtener todos los datos del negocio
      const allData = await env.DB.prepare(`
        SELECT id, data_type, data, updated_at FROM sync_data 
        WHERE business_id = ? AND deleted = 0
        ORDER BY data_type, updated_at DESC
      `).bind(currentUser.business_id).all();
      
      const seenIds = new Map(); // Map<dataType_dataId, sync_data.id>
      const duplicatesToDelete = [];
      
      // Detectar duplicados por data.id (no sync_data.id)
      for (const row of allData.results || []) {
        const dataType = row.data_type;
        const parsedData = JSON.parse(row.data);
        
        // Obtener el ID del dato (no el ID de sync_data)
        let dataId = parsedData.id || parsedData.key || parsedData.date;
        if (!dataId) continue;
        
        const key = `${dataType}_${dataId}`;
        
        // Si ya vimos este data.id, es un duplicado
        if (seenIds.has(key)) {
          // Este es un duplicado - marcarlo para eliminar
          duplicatesToDelete.push(row.id); // Eliminar por sync_data.id
        } else {
          // Primera vez que vemos este data.id - guardarlo
          seenIds.set(key, row.id);
        }
      }
      
      // Eliminar duplicados de sync_data
      let deletedCount = 0;
      for (const syncDataId of duplicatesToDelete) {
        await env.DB.prepare(`
          DELETE FROM sync_data 
          WHERE id = ? AND business_id = ?
        `).bind(syncDataId, currentUser.business_id).run();
        deletedCount++;
      }
      
      console.log(`✅ Limpieza completada: ${deletedCount} duplicados eliminados`);
      
      return jsonResponse({
        success: true,
        duplicates_deleted: deletedCount,
        message: `${deletedCount} duplicados eliminados del servidor`
      }, corsHeaders);
      
    } catch (error) {
      console.error('Error limpiando duplicados:', error);
      return jsonResponse({ error: error.message }, corsHeaders, 500);
    }
  }
  
  return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
}

// Backup handlers
async function handleBackup(request, env, path, corsHeaders, currentUser) {
  const method = request.method;
  
  // POST /api/backup/create - Crear y enviar backup automático
  if (path === '/api/backup/create' && method === 'POST') {
    try {
      const { telegram_bot_token, telegram_chat_id } = await getRequestBody(request);
      
      if (!telegram_bot_token || !telegram_chat_id) {
        return jsonResponse({ error: 'telegram_bot_token y telegram_chat_id requeridos' }, corsHeaders, 400);
      }
      
      // Obtener TODOS los datos del negocio desde la base de datos
      const syncData = await env.DB.prepare(`
        SELECT * FROM sync_data 
        WHERE business_id = ? AND deleted = 0
        ORDER BY data_type, created_at ASC
      `).bind(currentUser.business_id).all();
      
      // Agrupar datos por tipo
      const groupedData = {
        clients: [],
        sales: [],
        orders: [],
        expenses: [],
        prices: [],
        mermaRecords: [],
        diezmos: [],
        paymentHistory: [],
        config: [],
        telegramCredentials: []
      };
      
      for (const row of (syncData.results || [])) {
        const dataType = row.data_type;
        const data = JSON.parse(row.data);
        
        if (groupedData[dataType]) {
          groupedData[dataType].push(data);
        }
      }
      
      // Construir backup completo
      const backupData = {
        clients: groupedData.clients,
        sales: groupedData.sales,
        orders: groupedData.orders,
        expenses: groupedData.expenses,
        
        // Merma completa
        mermaPrices: groupedData.prices,
        mermaRecords: groupedData.mermaRecords,
        
        // Diezmos completos
        diezmosRecords: groupedData.diezmos,
        diezmosConfig: groupedData.config.find(c => c.key === 'diezmos') || { diezmoPercent: 10, ofrendaPercent: 5 },
        
        // Historial de pagos (construido desde sales)
        paymentHistory: groupedData.paymentHistory,
        
        // Créditos
        creditosData: {
          creditSales: groupedData.sales.filter(s => !s.isPaid),
          paymentHistory: groupedData.sales.filter(s => s.paymentHistory && s.paymentHistory.length > 0)
        },
        
        // Configuración completa
        config: groupedData.config.find(c => c.key === 'app') || {},
        
        // Configuración de Telegram
        telegramConfig: {
          botToken: telegram_bot_token,
          chatId: telegram_chat_id
        },
        
        // Metadatos
        metadata: {
          exportDate: new Date().toISOString(),
          version: '2.1',
          totalClients: groupedData.clients.length,
          totalSales: groupedData.sales.length,
          totalOrders: groupedData.orders.length,
          totalExpenses: groupedData.expenses.length,
          totalPayments: groupedData.paymentHistory.length,
          appName: 'GallOli',
          businessId: currentUser.business_id,
          createdBy: 'server'
        }
      };
      
      // Generar archivo JSON
      const dataStr = JSON.stringify(backupData, null, 2);
      const filename = `pollos_backup_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
      
      // Preparar estadísticas para el mensaje
      const stats = {
        totalClients: groupedData.clients.length,
        totalSales: groupedData.sales.length,
        totalOrders: groupedData.orders.length,
        totalExpenses: groupedData.expenses.length,
        totalSize: (new Blob([dataStr]).size / 1024).toFixed(2) + ' KB'
      };
      
      // Enviar a Telegram
      const formData = new FormData();
      formData.append('chat_id', telegram_chat_id);
      formData.append('document', new Blob([dataStr], { type: 'application/json' }), filename);
      formData.append('caption', 
        `Backup Automatico GallOli (Servidor)\n` +
        `Fecha: ${new Date().toLocaleString('es-ES')}\n\n` +
        `Estadisticas:\n` +
        `Clientes: ${stats.totalClients}\n` +
        `Ventas: ${stats.totalSales}\n` +
        `Pedidos: ${stats.totalOrders}\n` +
        `Gastos: ${stats.totalExpenses}\n` +
        `Tamano: ${stats.totalSize}`
      );
      
      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${telegram_bot_token}/sendDocument`,
        {
          method: 'POST',
          body: formData
        }
      );
      
      const telegramResult = await telegramResponse.json();
      
      if (!telegramResult.ok) {
        throw new Error(telegramResult.description || 'Error enviando a Telegram');
      }
      
      // Registrar backup en la base de datos
      await env.DB.prepare(`
        INSERT INTO sync_data (id, business_id, data_type, data, version, created_by, created_at, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        generateId(),
        currentUser.business_id,
        'backupLog',
        JSON.stringify({
          filename,
          timestamp: Date.now(),
          stats,
          success: true
        }),
        1,
        'server',
        Date.now(),
        'server',
        Date.now()
      ).run();
      
      return jsonResponse({
        success: true,
        filename,
        stats,
        telegram_message_id: telegramResult.result.message_id
      }, corsHeaders);
      
    } catch (error) {
      console.error('Error creando backup:', error);
      return jsonResponse({ error: error.message || 'Error creando backup' }, corsHeaders, 500);
    }
  }
  
  return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
}

// Push notification handlers (Web Push VAPID)
async function handlePush(request, env, path, corsHeaders, currentUser) {
  const method = request.method;

  // POST /api/push/subscribe - Guardar suscripción del dispositivo
  if (path === '/api/push/subscribe' && method === 'POST') {
    const { subscription } = await getRequestBody(request);

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return jsonResponse({ error: 'subscription con endpoint y keys requeridos' }, corsHeaders, 400);
    }

    const { endpoint, keys: { p256dh, auth } } = subscription;

    // Upsert: si ya existe el endpoint, actualizar; si no, insertar
    const existing = await env.DB.prepare(
      `SELECT id FROM push_subscriptions WHERE endpoint = ?`
    ).bind(endpoint).first();

    if (existing) {
      await env.DB.prepare(`
        UPDATE push_subscriptions
        SET user_id = ?, business_id = ?, p256dh = ?, auth = ?, updated_at = ?, is_active = 1
        WHERE endpoint = ?
      `).bind(currentUser.id, currentUser.business_id, p256dh, auth, Date.now(), endpoint).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO push_subscriptions (id, user_id, business_id, endpoint, p256dh, auth, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(generateId(), currentUser.id, currentUser.business_id, endpoint, p256dh, auth, Date.now(), Date.now()).run();
    }

    return jsonResponse({ success: true }, corsHeaders);
  }

  // POST /api/push/subscribe-fcm - Guardar token FCM de Android nativo
  if (path === '/api/push/subscribe-fcm' && method === 'POST') {
    const { fcmToken, platform } = await getRequestBody(request);
    if (!fcmToken) return jsonResponse({ error: 'fcmToken requerido' }, corsHeaders, 400);

    // Guardar como endpoint especial con prefijo fcm://
    const endpoint = 'fcm://' + fcmToken;
    const existing = await env.DB.prepare(
      `SELECT id FROM push_subscriptions WHERE endpoint = ?`
    ).bind(endpoint).first();

    if (existing) {
      await env.DB.prepare(`
        UPDATE push_subscriptions SET user_id=?, business_id=?, updated_at=?, is_active=1 WHERE endpoint=?
      `).bind(currentUser.id, currentUser.business_id, Date.now(), endpoint).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO push_subscriptions (id, user_id, business_id, endpoint, p256dh, auth, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(generateId(), currentUser.id, currentUser.business_id, endpoint, 'fcm', 'fcm', Date.now(), Date.now()).run();
    }
    return jsonResponse({ success: true, platform: platform || 'android' }, corsHeaders);
  }

  // DELETE /api/push/subscribe - Eliminar suscripción
  if (path === '/api/push/subscribe' && method === 'DELETE') {
    const { endpoint } = await getRequestBody(request);
    if (endpoint) {
      await env.DB.prepare(
        `UPDATE push_subscriptions SET is_active = 0 WHERE endpoint = ? AND user_id = ?`
      ).bind(endpoint, currentUser.id).run();
    }
    return jsonResponse({ success: true }, corsHeaders);
  }

  // POST /api/push/send - Enviar notificación push a todos los dispositivos del negocio
  if (path === '/api/push/send' && method === 'POST') {
    const { title, body, data = {}, tag } = await getRequestBody(request);

    if (!title || !body) {
      return jsonResponse({ error: 'title y body requeridos' }, corsHeaders, 400);
    }

    const subs = await env.DB.prepare(`
      SELECT endpoint, p256dh, auth FROM push_subscriptions
      WHERE business_id = ? AND is_active = 1
    `).bind(currentUser.business_id).all();

    const payload = JSON.stringify({ title, body, tag: tag || 'galloli', data });
    const results = [];

    for (const sub of (subs.results || [])) {
      try {
        const result = await sendWebPush(sub.endpoint, sub.p256dh, sub.auth, payload, env);
        results.push({ endpoint: sub.endpoint.substring(0, 40) + '...', success: result });
        // Si el endpoint ya no es válido (410 Gone), desactivarlo
        if (!result) {
          await env.DB.prepare(
            `UPDATE push_subscriptions SET is_active = 0 WHERE endpoint = ?`
          ).bind(sub.endpoint).run();
        }
      } catch (e) {
        results.push({ endpoint: sub.endpoint.substring(0, 40) + '...', error: e.message });
      }
    }

    return jsonResponse({ success: true, sent: results.length, results }, corsHeaders);
  }

  return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
}

// Enviar push a todas las suscripciones activas de un negocio
async function sendPushToAllSubs(businessId, title, body, data = {}, env) {
  try {
    const subs = await env.DB.prepare(`
      SELECT endpoint, p256dh, auth FROM push_subscriptions
      WHERE business_id = ? AND is_active = 1
    `).bind(businessId).all();

    const payload = JSON.stringify({ title, body, data, tag: data.tag || 'galloli' });

    for (const sub of (subs.results || [])) {
      try {
        // Token FCM nativo (Android APK)
        if (sub.endpoint && sub.endpoint.startsWith('fcm://')) {
          const fcmToken = sub.endpoint.replace('fcm://', '');
          const ok = await sendFcmPush(fcmToken, title, body, env);
          if (!ok) {
            await env.DB.prepare(`UPDATE push_subscriptions SET is_active = 0 WHERE endpoint = ?`)
              .bind(sub.endpoint).run();
          }
          continue;
        }
        // Web Push VAPID (PWA / TWA)
        const ok = await sendWebPush(sub.endpoint, sub.p256dh, sub.auth, payload, env);
        if (!ok) {
          await env.DB.prepare(`UPDATE push_subscriptions SET is_active = 0 WHERE endpoint = ?`)
            .bind(sub.endpoint).run();
        }
      } catch (e) {
        console.error('Push error:', e.message);
      }
    }
  } catch (e) {
    console.error('sendPushToAllSubs error:', e.message);
  }
}

// Enviar notificación push via FCM HTTP v1 API (Android nativo)
// Enviar notificación push via FCM HTTP v1 API (Android nativo)
async function sendFcmPush(fcmToken, title, body, env) {
  try {
    const saJson = env.FIREBASE_SERVICE_ACCOUNT;
    if (!saJson) { console.warn('FIREBASE_SERVICE_ACCOUNT no configurada'); return false; }

    const sa = JSON.parse(saJson);
    const projectId = sa.project_id;

    // Generar JWT para OAuth2 usando Web Crypto (compatible con Cloudflare Workers)
    const accessToken = await getFcmAccessToken(sa);
    if (!accessToken) { console.warn('No se pudo obtener access token FCM'); return false; }

    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + accessToken
        },
        body: JSON.stringify({
          message: {
            token: fcmToken,
            notification: { title, body },
            android: {
              priority: 'high',
              notification: {
                channel_id: 'galloli_push_channel',
                sound: 'default'
              }
            },
            data: { title, body, click_action: 'FLUTTER_NOTIFICATION_CLICK' }
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.warn('FCM v1 error:', response.status, err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('sendFcmPush error:', e.message);
    return false;
  }
}

// Generar access token OAuth2 para FCM v1 usando service account (Web Crypto)
async function getFcmAccessToken(sa) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    };

    const b64 = (obj) => btoa(JSON.stringify(obj))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    const signingInput = b64(header) + '.' + b64(payload);

    // Importar clave privada RSA
    const pemBody = sa.private_key
      .replace('-----BEGIN PRIVATE KEY-----', '')
      .replace('-----END PRIVATE KEY-----', '')
      .replace(/\n/g, '');
    const keyDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8', keyDer.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['sign']
    );

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      new TextEncoder().encode(signingInput)
    );

    const jwt = signingInput + '.' +
      btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    // Intercambiar JWT por access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
    });

    if (!tokenRes.ok) {
      console.warn('OAuth2 token error:', await tokenRes.text());
      return null;
    }
    const { access_token } = await tokenRes.json();
    return access_token;
  } catch (e) {
    console.error('getFcmAccessToken error:', e.message);
    return null;
  }
}

// Helper: crear JWT VAPID y clave privada
async function buildVapidAuth(endpoint, env) {
  const vapidPublicKey = env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = env.VAPID_PRIVATE_KEY;
  const vapidX = env.VAPID_PUBLIC_X;
  const vapidY = env.VAPID_PUBLIC_Y;
  const vapidSubject = 'mailto:ivqb96@gmail.com';

  const endpointUrl = new URL(endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const header = btoa(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const payload = btoa(JSON.stringify({ aud: audience, exp: expiration, sub: vapidSubject })).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const signingInput = `${header}.${payload}`;

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: vapidPrivateKey, x: vapidX, y: vapidY, key_ops: ['sign'] },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(signingInput)
  );

  const encodedSig = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const token = `${signingInput}.${encodedSig}`;
  return `vapid t=${token},k=${vapidPublicKey}`;
}

// Versión diagnóstica de sendWebPush que devuelve el error FCM
async function sendWebPushDiag(endpoint, p256dh, auth, payload, env) {
  try {
    const vapidAuthHeader = await buildVapidAuth(endpoint, env);
    const encryptedPayload = await encryptWebPush(p256dh, auth, payload);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': vapidAuthHeader,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': '86400',
      },
      body: encryptedPayload
    });

    const responseBody = await response.text().catch(() => '');
    return {
      success: response.status === 201 || response.status === 200,
      status: response.status,
      fcmResponse: responseBody.substring(0, 300)
    };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// Enviar Web Push usando VAPID
async function sendWebPush(endpoint, p256dh, auth, payload, env) {
  try {
    const vapidAuthHeader = await buildVapidAuth(endpoint, env);
    const encryptedPayload = await encryptWebPush(p256dh, auth, payload);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': vapidAuthHeader,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': '86400',
      },
      body: encryptedPayload
    });

    const ok = response.status === 201 || response.status === 200;
    if (!ok) {
      const body = await response.text().catch(() => '');
      console.error(`sendWebPush FCM status ${response.status}:`, body.substring(0, 200));
    }
    return ok;
  } catch (error) {
    console.error('sendWebPush error:', error);
    return false;
  }
}


// Cifrado Web Push (RFC 8291 - aes128gcm)
async function encryptWebPush(p256dhBase64, authBase64, plaintext) {
  const encoder = new TextEncoder();

  // Decodificar claves del cliente
  const clientPublicKey = base64urlToBytes(p256dhBase64);
  const authSecret = base64urlToBytes(authBase64);

  // Generar par de claves efímeras del servidor
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );

  // Exportar clave pública del servidor (65 bytes uncompressed)
  const serverPublicKeyRaw = await crypto.subtle.exportKey('raw', serverKeyPair.publicKey);

  // Importar clave pública del cliente
  const clientKey = await crypto.subtle.importKey(
    'raw',
    clientPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Derivar secreto compartido ECDH
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientKey },
    serverKeyPair.privateKey,
    256
  );

  // Generar salt aleatorio (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF para derivar IKM
  const prk = await hkdf(
    new Uint8Array(sharedSecret),
    authSecret,
    concat(encoder.encode('WebPush: info\x00'), clientPublicKey, new Uint8Array(serverPublicKeyRaw)),
    32
  );

  // Derivar clave de contenido y nonce
  const contentKey = await hkdf(prk, salt, encoder.encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdf(prk, salt, encoder.encode('Content-Encoding: nonce\x00'), 12);

  // Importar clave AES-GCM
  const aesKey = await crypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, ['encrypt']);

  // Cifrar payload con padding
  const plaintextBytes = encoder.encode(plaintext);
  const paddedPlaintext = new Uint8Array(plaintextBytes.length + 1);
  paddedPlaintext.set(plaintextBytes);
  paddedPlaintext[plaintextBytes.length] = 0x02; // padding delimiter

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aesKey,
    paddedPlaintext
  );

  // Construir header RFC 8291: salt(16) + rs(4) + keyid_len(1) + keyid(65) + ciphertext
  const serverPubKeyBytes = new Uint8Array(serverPublicKeyRaw);
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  // rs como big-endian uint32
  header[16] = (rs >> 24) & 0xff;
  header[17] = (rs >> 16) & 0xff;
  header[18] = (rs >> 8) & 0xff;
  header[19] = rs & 0xff;
  header[20] = 65; // keyid length
  header.set(serverPubKeyBytes, 21);

  return concat(header, new Uint8Array(ciphertext));
}

// HKDF usando Web Crypto
async function hkdf(ikm, salt, info, length) {
  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm));

  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoBytes = info instanceof Uint8Array ? info : new TextEncoder().encode(info);
  const t = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, concat(infoBytes, new Uint8Array([1]))));
  return t.slice(0, length);
}

// Helpers
function base64urlToBytes(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function concat(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// Feedback handler - envía comentarios al Telegram del desarrollador
async function handleFeedback(request, env, corsHeaders) {
  try {
    const { rating, message, appVersion, platform } = await getRequestBody(request);

    if (!message || message.trim().length === 0) {
      return jsonResponse({ error: 'El mensaje no puede estar vacío' }, corsHeaders, 400);
    }

    const stars = '*'.repeat(Math.min(Math.max(parseInt(rating) || 0, 1), 5));
    const text =
      `*Nuevo Feedback - GallOli*\n\n` +
      `Calificacion: ${stars}\n` +
      `${message.trim()}\n\n` +
      `Version: ${appVersion || 'desconocida'}\n` +
      `Plataforma: ${platform || 'desconocida'}\n` +
      `${new Date().toLocaleString('es-ES', { timeZone: 'America/Guayaquil' })}`;

    const telegramRes = await fetch(
      `https://api.telegram.org/bot${env.FEEDBACK_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: '5115479408',
          text,
          parse_mode: 'Markdown'
        })
      }
    );

    const result = await telegramRes.json();

    if (!result.ok) {
      console.error('Telegram feedback error:', result.description);
      return jsonResponse({ error: 'No se pudo enviar el mensaje' }, corsHeaders, 500);
    }

    return jsonResponse({ success: true }, corsHeaders);
  } catch (error) {
    console.error('handleFeedback error:', error);
    return jsonResponse({ error: 'Error interno' }, corsHeaders, 500);
  }
}

// WebSocket handler
async function handleWebSocket(request, env, corsHeaders) {
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }
  
  // Get business ID from query params
  const url = new URL(request.url);
  const businessId = url.searchParams.get('business_id');
  
  if (!businessId) {
    return new Response('business_id required', { status: 400 });
  }
  
  // Get Durable Object
  const id = env.SESSION_MANAGER.idFromName(businessId);
  const stub = env.SESSION_MANAGER.get(id);
  
  return stub.fetch(request);
}
