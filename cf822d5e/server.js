import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AGENT_NAME,
  PORT,
  PUBLIC_DIR,
  STORE_NAME
} from './lib/config.js';
import {
  ApiError,
  createEscalation,
  createRefund,
  createReturn,
  findOrders,
  getEscalations,
  getOrder,
  getShipment,
  getState,
  refundUsage,
  resetStore,
  serializeOrder,
  storeStats
} from './lib/store.js';
import { POLICY, policySnapshot } from './lib/policy.js';
import {
  auditCount,
  clearAudit,
  readAudit,
  record
} from './lib/audit.js';
import { runAgent } from './lib/agent.js';

const sessions = new Map();
let baseUrl = `http://127.0.0.1:${PORT}`;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function apiError(res, error) {
  if (error instanceof ApiError) {
    return sendJson(res, error.status, {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
  }
  console.error('[server]', error);
  record({
    actor: 'system',
    type: 'server_error',
    status: 'error',
    summary: error.message,
    data: { stack: error.stack?.split('\n').slice(0, 1) }
  });
  return sendJson(res, 500, {
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' }
  });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must be a JSON object.');
  }
}

function sessionFromRequest(req, body = {}) {
  const raw = req.headers['x-session-id'] || body.sessionId;
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(raw) ? raw : null;
}

function getSession(sessionId) {
  const safeId =
    typeof sessionId === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(sessionId)
      ? sessionId
      : `sess_${randomUUID().slice(0, 8)}`;

  if (sessions.has(safeId)) return sessions.get(safeId);

  const session = {
    id: safeId,
    createdAt: new Date().toISOString(),
    activeOrderId: null,
    pending: null,
    messages: []
  };
  sessions.set(safeId, session);

  record({
    sessionId: session.id,
    actor: 'system',
    type: 'session_started',
    status: 'info',
    summary: 'New support conversation started'
  });

  return session;
}

function guardrailsFor(activeOrderId) {
  let customerId = null;
  if (activeOrderId) {
    try {
      customerId = getOrder(activeOrderId).customerId;
    } catch {
      customerId = null;
    }
  }
  return policySnapshot(getState(), customerId);
}

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;
  const method = req.method;

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      storeName: STORE_NAME,
      agentName: AGENT_NAME,
      stats: storeStats(),
      auditCount: auditCount()
    });
  }

  if (pathname === '/api/policy' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      storeName: STORE_NAME,
      agentName: AGENT_NAME,
      policy: POLICY,
      stats: storeStats(),
      auditCount: auditCount()
    });
  }

  if (pathname === '/api/chat' && method === 'POST') {
    const body = await readJson(req);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      throw new ApiError(400, 'EMPTY_MESSAGE', 'message is required.');
    }
    if (message.length > 1200) {
      throw new ApiError(400, 'MESSAGE_TOO_LONG', 'Keep messages under 1,200 characters.');
    }

    const session = getSession(body.sessionId);
    const result = await runAgent({ session, text: message, baseUrl });
    if (session.messages.length > 60) session.messages = session.messages.slice(-60);

    return sendJson(res, 200, {
      ok: true,
      ...result,
      guardrails: guardrailsFor(result.activeOrderId),
      stats: storeStats(),
      auditCount: auditCount()
    });
  }

  if (pathname === '/api/logs' && method === 'GET') {
    const entries = readAudit({
      sessionId: searchParams.get('sessionId'),
      limit: searchParams.get('limit') || 400
    });
    return sendJson(res, 200, {
      ok: true,
      entries,
      count: entries.length,
      total: auditCount()
    });
  }

  if (pathname === '/api/logs/download' && method === 'GET') {
    const entries = readAudit({ limit: 2000 });
    const body = entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : '');
    const date = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'content-disposition': `attachment; filename="penelope-audit-${date}.jsonl"`,
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store'
    });
    return res.end(body);
  }

  if (pathname === '/api/reset' && method === 'POST') {
    resetStore();
    clearAudit();
    sessions.clear();
    record({
      actor: 'system',
      type: 'demo.reset',
      status: 'ok',
      summary: 'Mock store, sessions and audit log reset for a fresh demo'
    });
    return sendJson(res, 200, {
      ok: true,
      stats: storeStats(),
      auditCount: auditCount()
    });
  }

  if (pathname === '/api/store/orders' && method === 'GET') {
    const orders = findOrders({
      email: searchParams.get('email') || '',
      q: searchParams.get('q') || ''
    });
    return sendJson(res, 200, {
      ok: true,
      orders: orders.map((order) => ({
        id: order.id,
        status: order.status,
        totalCents: order.totalCents,
        customer: order.customer,
        shipment: order.shipment,
        deliveredAt: order.deliveredAt
      }))
    });
  }

  const orderMatch = pathname.match(/^\/api\/store\/orders\/([^/]+)$/);
  if (orderMatch && method === 'GET') {
    const order = getOrder(decodeURIComponent(orderMatch[1]));
    return sendJson(res, 200, { ok: true, order: serializeOrder(order) });
  }

  const shipmentMatch = pathname.match(/^\/api\/store\/shipments\/([^/]+)$/);
  if (shipmentMatch && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      ...getShipment(decodeURIComponent(shipmentMatch[1]))
    });
  }

  const usageMatch = pathname.match(/^\/api\/store\/customers\/([^/]+)\/refund-usage$/);
  if (usageMatch && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      usage: refundUsage(decodeURIComponent(usageMatch[1]))
    });
  }

  if (pathname === '/api/store/returns' && method === 'POST') {
    const body = await readJson(req);
    if (!body.orderId) throw new ApiError(400, 'ORDER_ID_REQUIRED', 'orderId is required.');
    const result = createReturn({
      orderId: body.orderId,
      reason: body.reason,
      sessionId: sessionFromRequest(req, body)
    });
    return sendJson(res, 201, { ok: true, ...result });
  }

  if (pathname === '/api/store/refunds' && method === 'POST') {
    const body = await readJson(req);
    if (!body.orderId) throw new ApiError(400, 'ORDER_ID_REQUIRED', 'orderId is required.');
    const result = createRefund({
      orderId: body.orderId,
      amountCents: body.amountCents,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      sessionId: sessionFromRequest(req, body)
    });
    return sendJson(res, result.idempotentReplay ? 200 : 201, { ok: true, ...result });
  }

  if (pathname === '/api/store/escalations' && method === 'GET') {
    return sendJson(res, 200, { ok: true, escalations: getEscalations() });
  }

  if (pathname === '/api/store/escalations' && method === 'POST') {
    const body = await readJson(req);
    const escalation = createEscalation(body);
    return sendJson(res, 201, { ok: true, escalation });
  }

  throw new ApiError(404, 'NOT_FOUND', `No API route for ${method} ${pathname}.`);
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end();
  }

  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${decodeURIComponent(requested)}`);

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  if (!stat.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  const type = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': 'no-store'
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    if (!res.headersSent) apiError(res, error);
    else res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : PORT;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`\n  Penelope is running at http://localhost:${port}\n`);
  console.log(`  Store: ${STORE_NAME} · 12 mock orders · refund guardrails on`);
  console.log(`  Audit log: data/audit.jsonl\n`);
});

server.on('error', (error) => {
  console.error('[server] failed to start:', error.message);
  process.exit(1);
});
