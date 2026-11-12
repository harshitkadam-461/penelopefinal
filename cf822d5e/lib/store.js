import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR, STORE_FILE } from './config.js';
import { createSeed } from './seed.js';
import {
  POLICY,
  dailyAutoRefundCents,
  daysBetween,
  money
} from './policy.js';
import { record } from './audit.js';

export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let state = null;

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, `.store-${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STORE_FILE);
}

function ensureState() {
  if (state) return state;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(STORE_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    } catch {
      state = createSeed();
      persist();
    }
  } else {
    state = createSeed();
    persist();
  }
  return state;
}

export function getState() {
  return ensureState();
}

export function resetStore() {
  state = createSeed();
  persist();
  return state;
}

function newId(prefix) {
  return `${prefix}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export function getOrder(orderId) {
  const order = ensureState().orders.find((entry) => entry.id === String(orderId));
  if (!order) {
    throw new ApiError(404, 'ORDER_NOT_FOUND', `Order ${orderId} was not found.`, { orderId });
  }
  return order;
}

export function findOrders({ email = '', q = '' } = {}) {
  const store = ensureState();
  const normalizedEmail = String(email).trim().toLowerCase();
  const query = String(q).trim().toLowerCase();

  return store.orders.filter((order) => {
    if (normalizedEmail && order.customer.email.toLowerCase() !== normalizedEmail) return false;
    if (!query) return true;
    return (
      order.id.includes(query) ||
      order.customer.name.toLowerCase().includes(query) ||
      order.customer.email.toLowerCase().includes(query) ||
      (order.shipment?.tracking || '').toLowerCase().includes(query)
    );
  });
}

export function getShipment(tracking) {
  const order = ensureState().orders.find(
    (entry) => entry.shipment?.tracking === String(tracking)
  );
  if (!order) {
    throw new ApiError(404, 'SHIPMENT_NOT_FOUND', `Shipment ${tracking} was not found.`, { tracking });
  }
  return { orderId: order.id, status: order.status, shipment: order.shipment };
}

export function serializeOrder(order) {
  const store = ensureState();
  const returns = store.returns
    .filter((entry) => entry.orderId === order.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const refunds = store.refunds
    .filter((entry) => entry.orderId === order.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const lastEvent = order.shipment?.events?.at(-1) || null;

  return {
    ...order,
    returns,
    refunds,
    remainingRefundableCents: Math.max(0, order.totalCents - order.refundedTotalCents),
    lastEvent
  };
}

export function createReturn({ orderId, reason = 'Customer request via chat', sessionId = null }) {
  const store = ensureState();
  const order = getOrder(orderId);
  const cleanReason = String(reason).trim().slice(0, 240) || 'Customer request via chat';

  if (['processing', 'in_transit', 'out_for_delivery', 'cancelled'].includes(order.status)) {
    throw new ApiError(
      409,
      'NOT_DELIVERED',
      'A return can only be started after the order has been delivered.',
      { orderId: order.id, status: order.status }
    );
  }

  const existing = store.returns.find((entry) => entry.orderId === order.id);
  if (existing) {
    throw new ApiError(
      409,
      'RETURN_EXISTS',
      `A return already exists for order ${order.id}.`,
      { orderId: order.id, returnId: existing.id, status: existing.status }
    );
  }

  if (!order.deliveredAt) {
    throw new ApiError(409, 'NOT_DELIVERED', 'This order has no delivery date on file.', {
      orderId: order.id
    });
  }

  const age = daysBetween(order.deliveredAt);
  if (age > POLICY.returnWindowDays) {
    throw new ApiError(
      409,
      'RETURN_WINDOW_EXPIRED',
      `Order ${order.id} was delivered ${age} days ago, outside the ${POLICY.returnWindowDays}-day return window.`,
      { orderId: order.id, deliveredDaysAgo: age, returnWindowDays: POLICY.returnWindowDays }
    );
  }

  const now = new Date();
  const returnRecord = {
    id: newId('RMA'),
    orderId: order.id,
    customerId: order.customerId,
    reason: cleanReason,
    status: 'label_issued',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    refundEstimateCents: Math.max(0, order.totalCents - order.refundedTotalCents),
    dropoffBy: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
    items: order.items.map((entry) => ({ sku: entry.sku, name: entry.name, qty: entry.qty }))
  };

  store.returns.push(returnRecord);
  persist();

  record({
    sessionId,
    actor: 'store',
    type: 'store.return_created',
    status: 'ok',
    summary: `Return ${returnRecord.id} started for order ${order.id} (${money(returnRecord.refundEstimateCents)} estimate)`,
    data: {
      returnId: returnRecord.id,
      orderId: order.id,
      reason: cleanReason,
      refundEstimateCents: returnRecord.refundEstimateCents,
      dropoffBy: returnRecord.dropoffBy
    }
  });

  return { return: returnRecord, order: serializeOrder(order) };
}

export function refundUsage(customerId) {
  const used = dailyAutoRefundCents(ensureState(), customerId);
  return {
    customerId,
    date: new Date().toISOString().slice(0, 10),
    autoRefundedCents: used,
    autoRefundLimitCents: POLICY.autoRefundLimitCents,
    dailyLimitCents: POLICY.dailyAutoRefundLimitCents,
    dailyRemainingCents: Math.max(0, POLICY.dailyAutoRefundLimitCents - used)
  };
}

export function createRefund({
  orderId,
  amountCents,
  reason = 'Customer request via chat',
  idempotencyKey = null,
  sessionId = null
}) {
  const store = ensureState();
  const order = getOrder(orderId);
  const amount = Number(amountCents);

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'amountCents must be a positive integer.', { amountCents });
  }

  if (idempotencyKey) {
    const existing = store.refunds.find((entry) => entry.idempotencyKey === idempotencyKey);
    if (existing) {
      return { refund: existing, order: serializeOrder(order), idempotentReplay: true };
    }
  }

  const remaining = Math.max(0, order.totalCents - order.refundedTotalCents);

  if (remaining === 0) {
    throw new ApiError(409, 'ALREADY_REFUNDED', `Order ${order.id} has already been fully refunded.`, {
      orderId: order.id,
      refundedTotalCents: order.refundedTotalCents,
      existingRefundId: store.refunds.find((entry) => entry.orderId === order.id)?.id || null
    });
  }

  if (!['delivered', 'returned'].includes(order.status)) {
    throw new ApiError(
      409,
      'NOT_REFUNDABLE',
      `Order ${order.id} is ${order.status.replaceAll('_', ' ')} and is not eligible for an automatic refund.`,
      { orderId: order.id, status: order.status }
    );
  }

  if (amount > remaining) {
    throw new ApiError(
      400,
      'EXCEEDS_ORDER_TOTAL',
      `Refund of ${money(amount)} exceeds the ${money(remaining)} still refundable on order ${order.id}.`,
      { orderId: order.id, requestedCents: amount, remainingCents: remaining }
    );
  }

  if (amount > POLICY.autoRefundLimitCents) {
    throw new ApiError(
      409,
      'REFUND_LIMIT_EXCEEDED',
      `Refund of ${money(amount)} exceeds the ${money(POLICY.autoRefundLimitCents)} automatic refund limit and requires human approval.`,
      {
        orderId: order.id,
        requestedCents: amount,
        autoLimitCents: POLICY.autoRefundLimitCents,
        remainingCents: remaining
      }
    );
  }

  const usedToday = dailyAutoRefundCents(store, order.customerId);
  if (usedToday + amount > POLICY.dailyAutoRefundLimitCents) {
    throw new ApiError(
      409,
      'DAILY_LIMIT_EXCEEDED',
      `Refund of ${money(amount)} would exceed the ${money(POLICY.dailyAutoRefundLimitCents)} daily automatic refund limit for this customer.`,
      {
        orderId: order.id,
        requestedCents: amount,
        autoRefundedTodayCents: usedToday,
        dailyLimitCents: POLICY.dailyAutoRefundLimitCents
      }
    );
  }

  const refund = {
    id: newId('RF'),
    orderId: order.id,
    customerId: order.customerId,
    amountCents: amount,
    mode: 'auto',
    status: 'succeeded',
    reason: String(reason).trim().slice(0, 240) || 'Customer request via chat',
    idempotencyKey: idempotencyKey || null,
    createdAt: new Date().toISOString()
  };

  store.refunds.push(refund);
  order.refundedTotalCents += amount;
  persist();

  record({
    sessionId,
    actor: 'store',
    type: 'store.refund_issued',
    status: 'ok',
    summary: `Refund ${refund.id} issued for ${money(amount)} on order ${order.id}`,
    data: {
      refundId: refund.id,
      orderId: order.id,
      customerId: order.customerId,
      amountCents: amount,
      mode: 'auto',
      autoLimitCents: POLICY.autoRefundLimitCents,
      usedTodayBeforeCents: usedToday
    }
  });

  return { refund, order: serializeOrder(order), idempotentReplay: false };
}

export function createEscalation({
  orderId = null,
  customerName = null,
  customerEmail = null,
  reason,
  summary,
  recommendedAction = 'Review and reply to the customer.',
  sessionId = null
}) {
  if (!reason || !summary) {
    throw new ApiError(400, 'INVALID_ESCALATION', 'reason and summary are required.');
  }

  const store = ensureState();
  let order = null;
  if (orderId) {
    order = store.orders.find((entry) => entry.id === String(orderId)) || null;
  }

  const escalation = {
    id: newId('ESC'),
    orderId: order?.id || null,
    customerId: order?.customerId || null,
    customerName: customerName || order?.customer.name || 'Unknown customer',
    customerEmail: customerEmail || order?.customer.email || null,
    reason: String(reason).slice(0, 160),
    summary: String(summary).slice(0, 4000),
    recommendedAction: String(recommendedAction).slice(0, 500),
    status: 'open',
    priority: order ? 'normal' : 'low',
    sla: '4 business hours',
    sessionId,
    createdAt: new Date().toISOString()
  };

  store.escalations.push(escalation);
  persist();

  record({
    sessionId,
    actor: 'store',
    type: 'store.escalation_created',
    status: 'ok',
    summary: `Human handoff ${escalation.id} created (${escalation.reason})`,
    data: {
      ticketId: escalation.id,
      orderId: escalation.orderId,
      reason: escalation.reason,
      summary: escalation.summary
    }
  });

  return escalation;
}

export function getEscalations() {
  return ensureState().escalations
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function storeStats() {
  const store = ensureState();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return {
    orders: store.orders.length,
    returns: store.returns.length,
    refunds: store.refunds.length,
    refundsToday: store.refunds.filter(
      (entry) => new Date(entry.createdAt) >= start && entry.mode === 'auto'
    ).length,
    openEscalations: store.escalations.filter((entry) => entry.status === 'open').length
  };
}
