import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'penelope-policy-'));
process.env.DATA_DIR = DATA_DIR;

const store = await import('../lib/store.js');

const DAY = 86_400_000;

function addOrder(id, customerId, totalCents, { status = 'delivered', email = 'cap@example.com' } = {}) {
  store.getState().orders.push({
    id,
    customerId,
    customer: { id: customerId, name: 'Cap Tester', email, phone: '+1 555 0100' },
    status,
    placedAt: new Date(Date.now() - 4 * DAY).toISOString(),
    deliveredAt: status === 'delivered' ? new Date(Date.now() - 2 * DAY).toISOString() : null,
    items: [{ sku: `SKU-${id}`, name: `Test item ${id}`, qty: 1, unitCents: totalCents }],
    totalCents,
    refundedTotalCents: 0,
    address: { city: 'Testville', state: 'CA', postalCode: '00000' },
    shipment: null
  });
}

beforeEach(() => {
  store.resetStore();
});

after(async () => {
  await fs.rm(DATA_DIR, { recursive: true, force: true });
});

test('rejects a refund above the per-refund auto limit', () => {
  addOrder('9001', 'C-901', 10_000);
  assert.throws(
    () => store.createRefund({ orderId: '9001', amountCents: 6_000 }),
    (error) => error.code === 'REFUND_LIMIT_EXCEEDED' && error.status === 409
  );
});

test('enforces the daily auto-refund cap per customer', () => {
  for (const id of ['9101', '9102', '9103', '9104']) {
    addOrder(id, 'C-902', 5_000, { email: 'daily@example.com' });
  }

  for (const id of ['9101', '9102', '9103']) {
    store.createRefund({ orderId: id, amountCents: 4_900 });
  }

  assert.throws(
    () => store.createRefund({ orderId: '9104', amountCents: 4_900 }),
    (error) => error.code === 'DAILY_LIMIT_EXCEEDED' && error.status === 409
  );
});

test('idempotency key prevents a double refund', () => {
  addOrder('9201', 'C-903', 5_000);
  const first = store.createRefund({
    orderId: '9201',
    amountCents: 2_000,
    idempotencyKey: 'same-request'
  });
  const second = store.createRefund({
    orderId: '9201',
    amountCents: 2_000,
    idempotencyKey: 'same-request'
  });

  assert.equal(first.idempotentReplay, false);
  assert.equal(second.idempotentReplay, true);
  assert.equal(store.getOrder('9201').refundedTotalCents, 2_000);
  assert.equal(store.getState().refunds.filter((entry) => entry.orderId === '9201').length, 1);
});

test('blocks duplicate refunds on an already-refunded order', () => {
  assert.throws(
    () => store.createRefund({ orderId: '1008', amountCents: 100 }),
    (error) => error.code === 'ALREADY_REFUNDED'
  );
});

test('blocks refunds for orders that are not delivered or returned', () => {
  assert.throws(
    () => store.createRefund({ orderId: '1002', amountCents: 1_000 }),
    (error) => error.code === 'NOT_REFUNDABLE'
  );
});

test('rejects refunds larger than the refundable balance', () => {
  assert.throws(
    () => store.createRefund({ orderId: '1005', amountCents: 4_000 }),
    (error) => error.code === 'EXCEEDS_ORDER_TOTAL'
  );
});

test('enforces the 30-day return window', () => {
  assert.throws(
    () => store.createReturn({ orderId: '1003', reason: 'Late request' }),
    (error) => error.code === 'RETURN_WINDOW_EXPIRED'
  );
});

test('blocks returns before delivery and duplicate returns', () => {
  assert.throws(
    () => store.createReturn({ orderId: '1002', reason: 'Not delivered' }),
    (error) => error.code === 'NOT_DELIVERED'
  );
  assert.throws(
    () => store.createReturn({ orderId: '1011', reason: 'Duplicate' }),
    (error) => error.code === 'RETURN_EXISTS'
  );
});

test('requires a positive integer refund amount', () => {
  assert.throws(
    () => store.createRefund({ orderId: '1005', amountCents: -100 }),
    (error) => error.code === 'INVALID_AMOUNT'
  );
  assert.throws(
    () => store.createRefund({ orderId: '1005', amountCents: 12.5 }),
    (error) => error.code === 'INVALID_AMOUNT'
  );
});

test('returns 404 for unknown orders', () => {
  assert.throws(
    () => store.getOrder('9999'),
    (error) => error.code === 'ORDER_NOT_FOUND' && error.status === 404
  );
});
