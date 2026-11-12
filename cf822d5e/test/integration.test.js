import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server;
let baseUrl;
let dataDir;

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'penelope-test-'));
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  server.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`Server did not start. stderr: ${stderr}`));
    }, 10_000);

    server.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timer);
        baseUrl = `http://127.0.0.1:${match[1]}`;
        resolve();
      }
    });

    server.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with ${code}. stderr: ${stderr}`));
    });
  });
});

after(async () => {
  if (server && !server.killed) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))]);
  }
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function request(method, route, body = undefined) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  return { response, data };
}

async function reset() {
  const { response } = await request('POST', '/api/reset');
  assert.equal(response.status, 200);
}

async function chat(message, sessionId = undefined) {
  const { response, data } = await request('POST', '/api/chat', { message, sessionId });
  assert.equal(response.status, 200, data.error?.message);
  return data;
}

async function logsFor(sessionId) {
  const { response, data } = await request('GET', `/api/logs?sessionId=${sessionId}&limit=300`);
  assert.equal(response.status, 200);
  return data.entries;
}

test('WISMO: resolves order and tracking through real HTTP tool calls', async () => {
  await reset();
  const turn = await chat('Where is my order 1002?');

  assert.match(turn.reply, /in transit/i);
  assert.equal(turn.cards[0].type, 'order');
  assert.equal(turn.cards[0].orderId, '1002');

  const toolPaths = turn.trace.filter((step) => step.type === 'tool').map((step) => step.path);
  assert.ok(toolPaths.includes('/orders/1002'));
  assert.ok(toolPaths.some((route) => route.startsWith('/shipments/')));

  const entries = await logsFor(turn.sessionId);
  assert.ok(entries.some((entry) => entry.type === 'tool_call' && entry.summary === 'GET /api/store/orders/1002'));
  assert.ok(entries.some((entry) => entry.type === 'tool_result' && entry.status === 'ok'));
  assert.ok(entries.some((entry) => entry.type === 'agent_reply'));
});

test('Return: starts an RMA for an eligible delivered order', async () => {
  await reset();
  const turn = await chat('I want to return order 1001');
  const returnCard = turn.cards.find((card) => card.type === 'return');

  assert.ok(returnCard);
  assert.match(returnCard.rma, /^RMA-/);
  assert.equal(returnCard.refundEstimateCents, 14_700);

  const { data } = await request('GET', '/api/store/orders/1001');
  assert.equal(data.order.returns.length, 1);
  assert.equal(data.order.returns[0].id, returnCard.rma);

  const entries = await logsFor(turn.sessionId);
  assert.ok(entries.some((entry) => entry.type === 'store.return_created'));
});

test('Refund: auto-approves under the limit, then blocks a duplicate', async () => {
  await reset();
  const first = await chat('Please refund order 1005');
  const refund = first.cards.find((card) => card.type === 'refund');

  assert.ok(refund);
  assert.equal(refund.amountCents, 3_499);
  assert.equal(refund.status, 'succeeded');

  const updatedOrderCard = first.cards.find((card) => card.type === 'order');
  assert.equal(updatedOrderCard.refundedTotalCents, 3_499);
  assert.equal(updatedOrderCard.remainingRefundableCents, 0);

  const { data: afterRefund } = await request('GET', '/api/store/orders/1005');
  assert.equal(afterRefund.order.refundedTotalCents, 3_499);
  assert.equal(afterRefund.order.remainingRefundableCents, 0);

  const second = await chat('Refund order 1005', first.sessionId);
  assert.match(second.reply, /already been fully refunded/i);

  const { data: finalOrder } = await request('GET', '/api/store/orders/1005');
  assert.equal(finalOrder.order.refunds.length, 1);

  const entries = await logsFor(first.sessionId);
  assert.ok(entries.some((entry) => entry.type === 'store.refund_issued'));
  assert.ok(entries.some((entry) => entry.type === 'policy_decision' && entry.status === 'denied'));
});

test('Refund limit: escalates without issuing, and the API independently rejects it', async () => {
  await reset();
  const turn = await chat('Refund order 1006');
  const escalation = turn.cards.find((card) => card.type === 'escalation');

  assert.ok(escalation);
  assert.match(escalation.ticketId, /^ESC-/);
  assert.match(escalation.summary, /refund limit guardrail/i);
  assert.match(turn.reply, /\$50\.00 auto-refund limit/i);

  const { data: order } = await request('GET', '/api/store/orders/1006');
  assert.equal(order.order.refundedTotalCents, 0);

  const { response, data } = await request('POST', '/api/store/refunds', {
    orderId: '1006',
    amountCents: 21_000,
    reason: 'direct API attempt'
  });
  assert.equal(response.status, 409);
  assert.equal(data.error.code, 'REFUND_LIMIT_EXCEEDED');

  const { data: escalations } = await request('GET', '/api/store/escalations');
  assert.equal(escalations.escalations.length, 1);
  assert.match(escalations.escalations[0].recommendedAction, /review/i);
});

test('Stale shipment: WISMO auto-escalates a likely lost parcel', async () => {
  await reset();
  const turn = await chat('Where is order 1007?');
  const escalation = turn.cards.find((card) => card.type === 'escalation');

  assert.ok(escalation);
  assert.match(escalation.reason, /lost|stalled/i);
  assert.match(turn.reply, /hasn't moved/i);

  const entries = await logsFor(turn.sessionId);
  assert.ok(entries.some((entry) => entry.type === 'policy_decision' && entry.status === 'escalated'));
});

test('Return window: escalates an out-of-window exception without creating a return', async () => {
  await reset();
  const turn = await chat('Return order 1003');
  const escalation = turn.cards.find((card) => card.type === 'escalation');

  assert.ok(escalation);
  assert.match(escalation.reason, /outside 30-day window/i);

  const { data } = await request('GET', '/api/store/orders/1003');
  assert.equal(data.order.returns.length, 0);
});

test('Human handoff: includes structured order and conversation summary', async () => {
  await reset();
  const first = await chat('Please refund order 1006');
  const second = await chat('I need a human', first.sessionId);
  const escalation = second.cards.find((card) => card.type === 'escalation');

  assert.ok(escalation);
  assert.equal(escalation.orderId, '1006');

  const { data } = await request('GET', '/api/store/escalations');
  const handoff = data.escalations.find((entry) => entry.id === escalation.ticketId);
  assert.ok(handoff);
  assert.equal(handoff.reason, 'Customer requested a human');
  assert.match(handoff.summary, /Conversation:/);
  assert.match(handoff.summary, /Order 1006/);
  assert.match(handoff.summary, /Customer asked to speak with a person/);
});

test('Pending intent: asks for an order number, then continues the refund', async () => {
  await reset();
  const first = await chat('I need a refund');
  assert.match(first.reply, /order number/i);
  assert.equal(first.pendingIntent, 'refund');

  const second = await chat('1005', first.sessionId);
  const refund = second.cards.find((card) => card.type === 'refund');
  assert.ok(refund);
  assert.equal(refund.amountCents, 3_499);
});
