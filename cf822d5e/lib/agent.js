import { POLICY, daysBetween, money } from './policy.js';
import { record } from './audit.js';
import { STORE_NAME } from './config.js';

const STATUS_LABELS = {
  processing: 'Processing',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  returned: 'Returned',
  cancelled: 'Cancelled'
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status.replaceAll('_', ' ');
}

function formatDate(iso, withWeekday = false) {
  if (!iso) return 'unknown';
  return new Intl.DateTimeFormat('en-US', {
    ...(withWeekday ? { weekday: 'short' } : {}),
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(iso));
}

function relativeDay(iso) {
  if (!iso) return '';
  const diff = daysBetween(iso);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff > 1) return `${diff} days ago`;
  if (diff === -1) return 'tomorrow';
  return `in ${Math.abs(diff)} days`;
}

function extractOrderRef(text) {
  const explicit = text.match(/\b(?:order|ord|#)\s*#?\s*(\d{3,6})\b/i);
  if (explicit) return explicit[1];
  const bare = text.match(/\b(1\d{3})\b/);
  return bare?.[1] || null;
}

function extractEmail(text) {
  return text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0]?.toLowerCase() || null;
}

function extractAmountCents(text) {
  const match =
    text.match(/\$\s*(\d+(?:\.\d{1,2})?)/) ||
    text.match(/\b(\d+(?:\.\d{1,2})?)\s*(?:dollars?|bucks|usd)\b/i);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

function detectIntent(text) {
  const lower = text.toLowerCase();
  if (
    /\b(human|representative|live person|real person|support team|supervisor|manager)\b/.test(lower) ||
    /\b(talk|speak|connect|transfer)\b.*\b(agent|someone|somebody)\b/.test(lower)
  ) {
    return 'human';
  }
  if (/\b(refund|refunded|money back|reimburse|reimbursement|chargeback|charge back)\b/.test(lower)) {
    return 'refund';
  }
  if (/\b(return|send (it|this|them) back|exchange|rma)\b/.test(lower)) {
    return 'return';
  }
  if (
    /\b(where|track|tracking|shipping|shipment|delivery|delivered|arrive|arriving|eta|late|delayed|status|package|parcel)\b/.test(lower)
  ) {
    return 'wismo';
  }
  if (extractOrderRef(text)) return 'lookup';
  if (/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(lower)) {
    return 'greeting';
  }
  if (/\b(thanks|thank you|appreciate|cheers)\b/.test(lower)) return 'thanks';
  return 'unknown';
}

function returnReason(text) {
  const lower = text.toLowerCase();
  if (/\b(damag|broken|cracked|defect|faulty|not working|torn)\b/.test(lower)) {
    return 'Item arrived damaged or defective';
  }
  if (/\b(wrong|incorrect|not what|missing)\b/.test(lower)) return 'Wrong or incomplete item';
  if (/\b(size|fit|too (big|small|tight|loose)|large|small)\b/.test(lower)) return 'Size or fit issue';
  if (/\b(changed my mind|don'?t want|do not want|no longer)\b/.test(lower)) return 'Changed mind';
  return 'Customer request via chat';
}

function refundReason(text) {
  const lower = text.toLowerCase();
  if (/\b(damag|broken|cracked|defect|faulty|not working)\b/.test(lower)) return 'Item arrived damaged';
  if (/\b(wrong|incorrect|not what|missing)\b/.test(lower)) return 'Wrong or incomplete item';
  if (/\b(late|delayed|never arrived|not arrived)\b/.test(lower)) return 'Shipment delayed';
  return 'Customer request via chat';
}

function isStaleShipment(order) {
  if (!order.shipment || !['in_transit', 'out_for_delivery'].includes(order.status)) return null;
  const lastEvent = order.shipment.events?.at(-1);
  if (!lastEvent) return null;
  const days = daysBetween(lastEvent.at);
  if (days <= POLICY.staleShipmentDays) return null;
  return { days, lastEvent };
}

function orderCard(order) {
  return {
    type: 'order',
    orderId: order.id,
    status: order.status,
    statusLabel: statusLabel(order.status),
    customerName: order.customer.name,
    totalCents: order.totalCents,
    refundedTotalCents: order.refundedTotalCents,
    remainingRefundableCents: order.remainingRefundableCents,
    items: order.items.map((entry) => ({
      name: entry.name,
      qty: entry.qty,
      unitCents: entry.unitCents,
      variant: entry.variant
    })),
    tracking: order.shipment?.tracking || null,
    carrier: order.shipment?.carrier || null,
    service: order.shipment?.service || null,
    eta: order.shipment?.eta || null,
    deliveredAt: order.deliveredAt || null,
    lastEvent: order.lastEvent || null,
    returnCount: order.returns?.length || 0,
    refundCount: order.refunds?.length || 0
  };
}

function returnCard(returnRecord) {
  return {
    type: 'return',
    rma: returnRecord.id,
    orderId: returnRecord.orderId,
    status: returnRecord.status,
    reason: returnRecord.reason,
    refundEstimateCents: returnRecord.refundEstimateCents,
    dropoffBy: returnRecord.dropoffBy,
    items: returnRecord.items
  };
}

function refundCard(refund, { existing = false } = {}) {
  return {
    type: 'refund',
    refundId: refund.id,
    orderId: refund.orderId,
    amountCents: refund.amountCents,
    status: refund.status,
    method: 'Original payment method',
    timing: '5–10 business days',
    createdAt: refund.createdAt,
    existing
  };
}

function escalationCard(escalation) {
  return {
    type: 'escalation',
    ticketId: escalation.id,
    orderId: escalation.orderId,
    reason: escalation.reason,
    summary: escalation.summary,
    sla: escalation.sla,
    status: escalation.status,
    createdAt: escalation.createdAt
  };
}

function conversationSnippet(session, maxMessages = 8) {
  return session.messages
    .slice(-maxMessages)
    .map((message) => {
      const who = message.role === 'customer' ? 'Customer' : 'Agent';
      return `${who}: ${String(message.content).replaceAll('\n', ' ').slice(0, 260)}`;
    })
    .join('\n');
}

function handoffSummary({ session, order, issue, checks = [], outcome, recommended }) {
  const lines = [];
  lines.push(`Issue: ${issue}`);
  if (order) {
    lines.push(
      `Customer: ${order.customer.name} <${order.customer.email}> (${order.customer.phone || 'no phone'})`
    );
    lines.push(
      `Order ${order.id}: ${statusLabel(order.status)}, total ${money(order.totalCents)}, already refunded ${money(order.refundedTotalCents)}, remaining ${money(order.remainingRefundableCents)}`
    );
    if (order.shipment) {
      const last = order.lastEvent;
      lines.push(
        `Shipment: ${order.shipment.carrier} ${order.shipment.tracking}, ETA ${formatDate(order.shipment.eta)}${last ? `, last scan "${last.label}" ${relativeDay(last.at)}` : ''}`
      );
    }
    if (order.returns?.length) {
      lines.push(
        `Existing return: ${order.returns[0].id} (${order.returns[0].status}), reason: ${order.returns[0].reason}`
      );
    }
  } else {
    lines.push('Customer: not matched to an order');
  }
  if (checks.length) lines.push(`Agent checks: ${checks.join('; ')}`);
  lines.push(`Policy outcome: ${outcome}`);
  lines.push(`Recommended next step: ${recommended}`);
  lines.push('Conversation:');
  lines.push(conversationSnippet(session));
  return lines.join('\n');
}

function makeContext({ session, baseUrl, text }) {
  const trace = [];
  const ctx = {
    session,
    baseUrl,
    text,
    trace,
    forcedAmountCents: null,
    step(step) {
      trace.push({ at: new Date().toISOString(), ...step });
    },
    think(title, detail) {
      this.step({ type: 'thought', status: 'ok', title, detail });
    },
    policy(title, detail, status = 'ok') {
      this.step({ type: 'policy', status, title, detail });
      record({
        sessionId: session.id,
        actor: 'agent',
        type: 'policy_decision',
        status,
        summary: `${title}: ${detail}`,
        data: { title, detail }
      });
    },
    async tool(name, method, path, { label = name, body = null } = {}) {
      const startedAt = Date.now();
      record({
        sessionId: session.id,
        actor: 'agent',
        type: 'tool_call',
        status: 'info',
        summary: `${method} /api/store${path}`,
        tool: name,
        data: { method, path, request: body }
      });

      let response;
      let data = {};
      let networkError = null;
      try {
        response = await fetch(`${baseUrl}/api/store${path}`, {
          method,
          headers: {
            'x-session-id': session.id,
            ...(body ? { 'content-type': 'application/json' } : {})
          },
          body: body ? JSON.stringify(body) : undefined
        });
        data = await response.json().catch(() => ({}));
      } catch (error) {
        networkError = error;
      }

      const durationMs = Date.now() - startedAt;
      const ok = Boolean(response?.ok) && !networkError;
      const status = networkError
        ? 'error'
        : ok
          ? 'ok'
          : [400, 409].includes(response.status)
            ? 'denied'
            : 'error';
      const detail = networkError
        ? `Network error: ${networkError.message}`
        : `${response.status} ${method} ${path} · ${durationMs}ms`;

      this.step({
        type: 'tool',
        status,
        title: label,
        detail,
        tool: name,
        method,
        path,
        durationMs,
        responseStatus: networkError ? 0 : response.status
      });

      record({
        sessionId: session.id,
        actor: 'agent',
        type: 'tool_result',
        status,
        summary: `${label}: ${detail}`,
        tool: name,
        data: {
          httpStatus: networkError ? 0 : response.status,
          durationMs,
          response: data
        }
      });

      return { ok, status: response?.status || 0, data, networkError };
    }
  };
  return ctx;
}

async function resolveOrder(ctx) {
  const ref = extractOrderRef(ctx.text);
  const email = extractEmail(ctx.text);

  if (ref) {
    const result = await ctx.tool('lookup_order', 'GET', `/orders/${encodeURIComponent(ref)}`, {
      label: `Look up order ${ref}`
    });
    if (result.ok) {
      ctx.session.activeOrderId = result.data.order.id;
      return { order: result.data.order };
    }
    return {
      error: result.status === 404 ? 'not_found' : 'lookup_failed',
      ref,
      detail: result.data?.error?.message || 'Order lookup failed.'
    };
  }

  if (email) {
    const result = await ctx.tool(
      'find_orders',
      'GET',
      `/orders?email=${encodeURIComponent(email)}`,
      { label: `Find orders for ${email}` }
    );
    if (result.ok && result.data.orders.length === 1) {
      const orderId = result.data.orders[0].id;
      ctx.session.activeOrderId = orderId;
      const fresh = await ctx.tool('lookup_order', 'GET', `/orders/${orderId}`, {
        label: `Load order ${orderId}`
      });
      if (fresh.ok) return { order: fresh.data.order };
      return { error: 'lookup_failed', ref: orderId, detail: 'Order details could not be loaded.' };
    }
    if (result.ok && result.data.orders.length > 1) {
      return { error: 'multiple', orders: result.data.orders };
    }
    return { error: 'not_found', ref: email };
  }

  if (ctx.session.activeOrderId) {
    const result = await ctx.tool(
      'lookup_order',
      'GET',
      `/orders/${encodeURIComponent(ctx.session.activeOrderId)}`,
      { label: `Reload order ${ctx.session.activeOrderId}` }
    );
    if (result.ok) return { order: result.data.order };
    ctx.session.activeOrderId = null;
    return { error: 'lookup_failed', ref: ctx.session.activeOrderId };
  }

  return { error: 'missing' };
}

function askForOrder(ctx, intent, intro = 'I can help with that.') {
  ctx.session.pending = { intent, amountCents: extractAmountCents(ctx.text) };
  return {
    reply: `${intro} What's the order number? It's the 4-digit number on the order confirmation, for example 1002.`,
    cards: []
  };
}

function multipleOrdersReply(ctx, orders, intent) {
  ctx.session.pending = { intent, amountCents: extractAmountCents(ctx.text) };
  const lines = orders.map(
    (order) => `• ${order.id} — ${statusLabel(order.status)}, ${money(order.totalCents)}`
  );
  return {
    reply: `That email is linked to a few orders:\n\n${lines.join('\n')}\n\nWhich order number should I look at?`,
    cards: []
  };
}

async function escalate(ctx, {
  order,
  reason,
  issue,
  checks,
  outcome,
  recommended,
  priorityReason = ''
}) {
  const summary = handoffSummary({
    session: ctx.session,
    order,
    issue,
    checks,
    outcome,
    recommended
  });

  const result = await ctx.tool('create_escalation', 'POST', '/escalations', {
    label: 'Create human handoff with summary',
    body: {
      orderId: order?.id || null,
      customerName: order?.customer.name || null,
      customerEmail: order?.customer.email || null,
      reason,
      summary,
      recommendedAction: recommended,
      sessionId: ctx.session.id
    }
  });

  if (!result.ok) {
    ctx.step({
      type: 'policy',
      status: 'error',
      title: 'Handoff failed',
      detail: result.data?.error?.message || 'The escalation API did not accept the request.'
    });
    return null;
  }

  ctx.policy(
    'Handoff created',
    `${result.data.escalation.id} · ${reason}${priorityReason ? ` · ${priorityReason}` : ''}`,
    'ok'
  );

  return result.data.escalation;
}

async function handleMissingOrder(ctx, resolved, intent) {
  if (resolved.error === 'multiple') {
    return multipleOrdersReply(ctx, resolved.orders, intent);
  }
  if (resolved.error === 'missing') {
    const intro =
      intent === 'refund'
        ? 'I can help with a refund.'
        : intent === 'return'
          ? 'I can start a return.'
          : 'I can check on that.';
    return askForOrder(ctx, intent, intro);
  }
  if (resolved.error === 'not_found') {
    ctx.session.pending = { intent, amountCents: extractAmountCents(ctx.text) };
    return {
      reply: `I couldn't find order ${resolved.ref} in the store. Could you double-check the number? It should be 4 digits, like 1002.`,
      cards: []
    };
  }
  return {
    reply: 'I hit a snag loading that order. Could you try again, or give me the order number?',
    cards: []
  };
}

async function handleWismo(ctx) {
  const resolved = await resolveOrder(ctx);
  if (resolved.error) return handleMissingOrder(ctx, resolved, 'wismo');

  const order = resolved.order;
  let shipment = order.shipment;

  if (shipment?.tracking) {
    const tracking = await ctx.tool(
      'track_shipment',
      'GET',
      `/shipments/${encodeURIComponent(shipment.tracking)}`,
      { label: `Track ${shipment.carrier} shipment` }
    );
    if (tracking.ok) shipment = tracking.data.shipment;
  }

  if (!shipment) {
    const reply =
      order.status === 'cancelled'
        ? `Order ${order.id} was cancelled${order.cancelledAt ? ` on ${formatDate(order.cancelledAt)}` : ''}. No shipment was created, so there's nothing in transit. If the refund hasn't landed, I can bring in a human.`
        : `Order ${order.id} is still being packed at our warehouse. There's no tracking number yet — orders usually ship within 1–2 business days.`;
    ctx.policy('Order status check', `${order.id} has no shipment (${order.status}).`, 'ok');
    return { reply, cards: [orderCard(order)] };
  }

  const last = shipment.events?.at(-1);
  const lastLine = last
    ? `${last.label}${last.location ? ` — ${last.location}` : ''} (${relativeDay(last.at)})`
    : 'No scans yet';
  const trackingLine = `${shipment.carrier} · ${shipment.tracking}`;
  const stale = isStaleShipment({ ...order, shipment });

  let reply;
  if (order.status === 'delivered') {
    reply = `Order ${order.id} was delivered on ${formatDate(order.deliveredAt || shipment.eta, true)}.\n\n• Items: ${order.items.map((entry) => `${entry.name} ×${entry.qty}`).join(', ')}\n• Delivered to: ${order.address.city}, ${order.address.state}\n• Tracking: ${trackingLine}\n\nIf it isn't where you expected, tell me and I can start a return (the window is ${POLICY.returnWindowDays} days from delivery).`;
  } else if (order.status === 'out_for_delivery') {
    reply = `Good news — order ${order.id} is out for delivery today.\n\n• Last scan: ${lastLine}\n• Tracking: ${trackingLine}\n• Expected: ${formatDate(shipment.eta, true)}\n\nCarriers usually deliver by evening. If it doesn't arrive today, message me and I'll follow up.`;
  } else if (order.status === 'in_transit') {
    reply = `Order ${order.id} is in transit.\n\n• Last scan: ${lastLine}\n• Estimated delivery: ${formatDate(shipment.eta, true)} (${relativeDay(shipment.eta)})\n• Tracking: ${trackingLine}\n\nI'll flag it if the carrier reports a delay.`;
  } else if (order.status === 'returned') {
    reply = `Order ${order.id} is marked as returned. The warehouse has the item, so a refund of ${money(order.remainingRefundableCents)} is the next step. Want me to process what's allowed automatically?`;
  } else {
    reply = `Order ${order.id} is ${statusLabel(order.status).toLowerCase()}. Last scan: ${lastLine}. Tracking: ${trackingLine}.`;
  }

  const cards = [orderCard({ ...order, shipment })];

  if (stale) {
    ctx.policy(
      'Stale shipment detected',
      `No tracking movement for ${stale.days} days (policy threshold: ${POLICY.staleShipmentDays}).`,
      'escalated'
    );
    const ticket = await escalate(ctx, {
      order,
      reason: 'Shipment appears lost or stalled',
      issue: `Customer asked where their order is. Tracking has not moved for ${stale.days} days and the ETA has passed.`,
      checks: [
        `order ${order.id} is ${order.status}`,
        `last scan "${stale.lastEvent.label}" ${relativeDay(stale.lastEvent.at)}`,
        `carrier ETA ${formatDate(shipment.eta)}`
      ],
      outcome: `Automatic handoff triggered by the ${POLICY.staleShipmentDays}-day stale-shipment rule.`,
      recommended: 'Open a carrier trace, confirm whether the parcel is lost, and offer a replacement or refund.'
    });

    if (ticket) {
      reply += `\n\nOne more thing: this shipment hasn't moved since ${formatDate(stale.lastEvent.at)}, which is past our ${POLICY.staleShipmentDays}-day threshold. I've opened ticket ${ticket.id} for the team to trace it with ${shipment.carrier}. No need to repeat any of this.`;
      cards.push(escalationCard(ticket));
    }
  }

  return { reply, cards };
}

async function handleReturn(ctx) {
  const resolved = await resolveOrder(ctx);
  if (resolved.error) return handleMissingOrder(ctx, resolved, 'return');

  const order = resolved.order;
  const existingReturn = order.returns?.[0];

  if (existingReturn) {
    ctx.policy(
      'Existing return found',
      `${existingReturn.id} is already ${existingReturn.status.replaceAll('_', ' ')}.`,
      'denied'
    );
    return {
      reply: `Order ${order.id} already has a return open: ${existingReturn.id}.\n\n• Status: ${existingReturn.status.replaceAll('_', ' ')}\n• Reason: ${existingReturn.reason}\n• Refund estimate: ${money(existingReturn.refundEstimateCents)}\n\nYou don't need to start another one. The refund is issued after the warehouse scans the item.`,
      cards: [orderCard(order), returnCard(existingReturn)]
    };
  }

  if (!['delivered', 'returned'].includes(order.status)) {
    const stale = isStaleShipment(order);
    if (stale) {
      ctx.policy(
        'Return blocked · stale shipment',
        `Order ${order.id} has not been delivered and tracking is stale for ${stale.days} days.`,
        'escalated'
      );
      const ticket = await escalate(ctx, {
        order,
        reason: 'Return requested for stalled shipment',
        issue: 'Customer wants to return an order that never arrived; the shipment appears stalled.',
        checks: [`order status ${order.status}`, `no tracking movement for ${stale.days} days`],
        outcome: 'A return cannot be created for an undelivered order; escalated as a potential lost parcel.',
        recommended: 'Trace the shipment. If lost, issue a full refund or replacement without waiting for a return.'
      });
      return {
        reply: `I can't start a return yet because order ${order.id} hasn't been delivered — and the tracking hasn't moved for ${stale.days} days.\n\nI've escalated it as a likely lost parcel${ticket ? ` (ticket ${ticket.id})` : ''}. The team can refund or replace it without a return.`,
        cards: ticket ? [orderCard(order), escalationCard(ticket)] : [orderCard(order)]
      };
    }
    return {
      reply: `Returns open after delivery, and order ${order.id} is still ${statusLabel(order.status).toLowerCase()}. Once it arrives, message me and I'll start it right away.`,
      cards: [orderCard(order)]
    };
  }

  const daysSinceDelivery = order.deliveredAt ? daysBetween(order.deliveredAt) : null;
  if (daysSinceDelivery !== null && daysSinceDelivery > POLICY.returnWindowDays) {
    ctx.policy(
      'Return window expired',
      `Delivered ${daysSinceDelivery} days ago; policy allows ${POLICY.returnWindowDays} days. Escalating as an exception.`,
      'escalated'
    );
    const ticket = await escalate(ctx, {
      order,
      reason: 'Return requested outside 30-day window',
      issue: `Customer wants to return order ${order.id}, delivered ${daysSinceDelivery} days ago.`,
      checks: [
        `delivered ${formatDate(order.deliveredAt)}`,
        `${daysSinceDelivery} days ago`,
        `policy window ${POLICY.returnWindowDays} days`
      ],
      outcome: 'Outside the standard return window. No return was created automatically.',
      recommended: 'Review for a goodwill return or explain the policy. Customer is asking to send the item back.'
    });
    return {
      reply: `Order ${order.id} was delivered ${daysSinceDelivery} days ago, which is outside our ${POLICY.returnWindowDays}-day return window, so I can't start a return automatically.\n\nI've passed it to a human for a goodwill review${ticket ? ` — ticket ${ticket.id}` : ''}. You'll hear back within ${ticket?.sla || '4 business hours'}.`,
      cards: ticket ? [orderCard(order), escalationCard(ticket)] : [orderCard(order)]
    };
  }

  const reason = returnReason(ctx.text);
  ctx.policy('Return eligibility', `Delivered ${daysSinceDelivery} days ago; inside the ${POLICY.returnWindowDays}-day window.`, 'ok');

  const result = await ctx.tool('start_return', 'POST', '/returns', {
    label: 'Start return and issue RMA',
    body: { orderId: order.id, reason }
  });

  if (!result.ok) {
    const message = result.data?.error?.message || 'The return could not be created.';
    ctx.policy('Return failed', message, 'denied');
    return { reply: `I couldn't start that return: ${message}`, cards: [orderCard(order)] };
  }

  const returnRecord = result.data.return;
  return {
    reply: `Return started for order ${order.id}.\n\n• RMA: ${returnRecord.id}\n• Reason: ${returnRecord.reason}\n• Drop off by: ${formatDate(returnRecord.dropoffBy)} (14 days)\n• Refund estimate: ${money(returnRecord.refundEstimateCents)} once the item is scanned\n\nPack the items in the original packaging and reference ${returnRecord.id} at any ${order.shipment?.carrier || 'carrier'} drop-off. The refund is issued after the warehouse receives it.`,
    cards: [orderCard(result.data.order || order), returnCard(returnRecord)]
  };
}

async function handleRefund(ctx) {
  const resolved = await resolveOrder(ctx);
  if (resolved.error) return handleMissingOrder(ctx, resolved, 'refund');

  const order = resolved.order;
  const remaining = order.remainingRefundableCents;
  const requested = ctx.forcedAmountCents ?? extractAmountCents(ctx.text) ?? remaining;
  const reason = refundReason(ctx.text);

  ctx.think(
    'Refund eligibility review',
    `Order ${order.id} is ${order.status}; ${money(remaining)} remaining; ${money(requested)} requested; auto limit ${money(POLICY.autoRefundLimitCents)}.`
  );

  if (remaining <= 0) {
    const existing = order.refunds?.[0];
    ctx.policy(
      'Duplicate refund blocked',
      `Order ${order.id} is fully refunded (${money(order.refundedTotalCents)} total).`,
      'denied'
    );
    return {
      reply: `Order ${order.id} has already been fully refunded${existing ? ` — refund ${existing.id} for ${money(existing.amountCents)} was issued on ${formatDate(existing.createdAt)}` : ''}. There's no remaining balance to refund.`,
      cards: [orderCard(order), existing ? refundCard(existing, { existing: true }) : null].filter(Boolean)
    };
  }

  if (!['delivered', 'returned'].includes(order.status)) {
    const stale = isStaleShipment(order);
    if (stale) {
      ctx.policy(
        'Refund blocked · stalled shipment',
        `Order ${order.id} is undelivered and tracking is stale for ${stale.days} days.`,
        'escalated'
      );
      const ticket = await escalate(ctx, {
        order,
        reason: 'Likely lost shipment · refund requested',
        issue: `Customer requested a refund on an undelivered order. Tracking has not moved for ${stale.days} days.`,
        checks: [
          `order status ${order.status}`,
          `last scan ${relativeDay(stale.lastEvent.at)}`,
          `${money(remaining)} refundable`
        ],
        outcome: `Automatic refunds are only allowed after delivery; stale shipment triggered a handoff.`,
        recommended: 'Trace the parcel. If it is lost, refund the full amount or send a replacement.'
      });
      return {
        reply: `I can't refund order ${order.id} automatically because it hasn't been delivered — and the tracking has been stuck for ${stale.days} days.\n\nThat's not normal, so I've escalated it as a likely lost parcel${ticket ? ` (ticket ${ticket.id})` : ''}. The team can issue the refund or a replacement once the carrier trace is done.`,
        cards: ticket ? [orderCard(order), escalationCard(ticket)] : [orderCard(order)]
      };
    }

    ctx.policy(
      'Refund blocked · not delivered',
      `Order ${order.id} is ${order.status}; refunds require delivered/returned status.`,
      'denied'
    );
    const statusCopy =
      order.status === 'processing'
        ? `Order ${order.id} is still being packed, so there's nothing to refund yet. If you need to cancel before it ships, I can escalate that to the team.`
        : `Order ${order.id} is ${statusLabel(order.status).toLowerCase()} with ${order.shipment?.carrier || 'the carrier'}, so it can't be refunded mid-shipment. Once it's delivered you can ask me for a return or refund.`;
    return { reply: statusCopy, cards: [orderCard(order)] };
  }

  if (requested > remaining) {
    ctx.policy(
      'Refund amount exceeds balance',
      `${money(requested)} requested but only ${money(remaining)} remains on order ${order.id}.`,
      'denied'
    );
    return {
      reply: `Order ${order.id} only has ${money(remaining)} left to refund, so I can't refund ${money(requested)}.${remaining <= POLICY.autoRefundLimitCents ? ` I can process ${money(remaining)} automatically if you'd like — just confirm.` : ''}`,
      cards: [orderCard(order)]
    };
  }

  if (requested > POLICY.autoRefundLimitCents) {
    ctx.policy(
      'Auto-refund limit exceeded',
      `${money(requested)} > ${money(POLICY.autoRefundLimitCents)} auto limit. Escalating instead of refunding.`,
      'escalated'
    );
    const ticket = await escalate(ctx, {
      order,
      reason: 'Refund above auto-approval limit',
      issue: `Customer requested a ${money(requested)} refund on order ${order.id}.`,
      checks: [
        `order ${order.id} is ${order.status}`,
        `${money(remaining)} refundable`,
        `${money(requested)} requested`,
        `auto limit ${money(POLICY.autoRefundLimitCents)}`
      ],
      outcome: `Blocked by the refund limit guardrail. No refund was issued automatically.`,
      recommended: `Review the request and approve or decline the ${money(requested)} refund. The order has ${money(remaining)} refundable.`
    });
    return {
      reply: `Order ${order.id} has ${money(remaining)} refundable, but ${money(requested)} is above my ${money(POLICY.autoRefundLimitCents)} auto-refund limit — I can't approve that one myself.\n\nI've escalated it with the order history, the amount and the policy check${ticket ? ` — ticket ${ticket.id}` : ''}. A human will reply within ${ticket?.sla || '4 business hours'}; you won't need to repeat yourself.`,
      cards: ticket ? [orderCard(order), escalationCard(ticket)] : [orderCard(order)]
    };
  }

  const usageResult = await ctx.tool(
    'get_refund_usage',
    'GET',
    `/customers/${encodeURIComponent(order.customerId)}/refund-usage`,
    { label: 'Check daily auto-refund headroom' }
  );
  const usage = usageResult.ok ? usageResult.data.usage : null;

  if (usage && usage.autoRefundedCents + requested > usage.dailyLimitCents) {
    ctx.policy(
      'Daily refund cap exceeded',
      `${money(usage.autoRefundedCents)} already auto-refunded today; ${money(requested)} more would exceed ${money(usage.dailyLimitCents)}.`,
      'escalated'
    );
    const ticket = await escalate(ctx, {
      order,
      reason: 'Daily automatic refund limit reached',
      issue: `Customer requested a ${money(requested)} refund on order ${order.id}.`,
      checks: [
        `${money(usage.autoRefundedCents)} auto-refunded today`,
        `daily cap ${money(usage.dailyLimitCents)}`,
        `${money(requested)} requested`
      ],
      outcome: 'Blocked by the daily refund cap. No refund was issued automatically.',
      recommended: 'Review the customer’s refund history and approve manually if appropriate.'
    });
    return {
      reply: `This one needs a human because of the daily refund cap: ${money(usage.autoRefundedCents)} has already been auto-refunded today, and the limit is ${money(usage.dailyLimitCents)}.\n\nI've escalated it${ticket ? ` as ticket ${ticket.id}` : ''}. The team can still approve it after a quick review.`,
      cards: ticket ? [orderCard(order), escalationCard(ticket)] : [orderCard(order)]
    };
  }

  const refundResult = await ctx.tool('issue_refund', 'POST', '/refunds', {
    label: `Issue ${money(requested)} refund`,
    body: {
      orderId: order.id,
      amountCents: requested,
      reason,
      idempotencyKey: `agent:${ctx.session.id}:${order.id}:${requested}`
    }
  });

  if (!refundResult.ok) {
    const error = refundResult.data?.error;
    if (['REFUND_LIMIT_EXCEEDED', 'DAILY_LIMIT_EXCEEDED'].includes(error?.code)) {
      ctx.policy('Guardrail blocked refund', error.message, 'escalated');
      const ticket = await escalate(ctx, {
        order,
        reason: 'Refund blocked by policy guardrail',
        issue: `The store API rejected a ${money(requested)} refund for order ${order.id}.`,
        checks: [error.message],
        outcome: 'The refund limit guardrail rejected the request at the API layer.',
        recommended: 'Review and approve manually if appropriate.'
      });
      return {
        reply: `The refund API blocked that request: ${error.message}\n\nI've escalated it${ticket ? ` as ticket ${ticket.id}` : ''}.`,
        cards: ticket ? [orderCard(order), escalationCard(ticket)] : [orderCard(order)]
      };
    }

    if (error?.code === 'ALREADY_REFUNDED') {
      ctx.policy('Duplicate refund blocked', error.message, 'denied');
      return {
        reply: `Order ${order.id} is already fully refunded. ${error.message}`,
        cards: [orderCard(order)]
      };
    }

    ctx.policy('Refund rejected', error?.message || 'Unknown error', 'denied');
    return {
      reply: `I couldn't issue that refund: ${error?.message || 'the store API rejected the request.'}`,
      cards: [orderCard(order)]
    };
  }

  const refund = refundResult.data.refund;
  return {
    reply: `Refund approved for order ${order.id}.\n\n• Amount: ${money(refund.amountCents)}\n• Refund ID: ${refund.id}\n• Destination: original payment method\n• Timing: 5–10 business days\n\nThe refund is now logged against the order. Anything else I can check?`,
    cards: [orderCard(refundResult.data.order || order), refundCard(refund)]
  };
}

async function handleLookup(ctx) {
  const resolved = await resolveOrder(ctx);
  if (resolved.error) return handleMissingOrder(ctx, resolved, 'lookup');

  const order = resolved.order;
  const lines = [
    `Order ${order.id} — ${statusLabel(order.status)}`,
    `Customer: ${order.customer.name}`,
    `Items: ${order.items.map((entry) => `${entry.name} ×${entry.qty}`).join(', ')}`,
    `Total: ${money(order.totalCents)}`,
    `Refunded: ${money(order.refundedTotalCents)} · Remaining: ${money(order.remainingRefundableCents)}`
  ];
  if (order.shipment) {
    lines.push(`Tracking: ${order.shipment.carrier} ${order.shipment.tracking}`);
    if (order.lastEvent) {
      lines.push(`Last scan: ${order.lastEvent.label} (${relativeDay(order.lastEvent.at)})`);
    }
  }

  return {
    reply: `${lines.join('\n')}\n\nWhat would you like to do with this order?`,
    cards: [orderCard(order)]
  };
}

async function handleHuman(ctx) {
  let order = null;
  if (ctx.session.activeOrderId) {
    const result = await ctx.tool(
      'lookup_order',
      'GET',
      `/orders/${encodeURIComponent(ctx.session.activeOrderId)}`,
      { label: `Load order ${ctx.session.activeOrderId} for handoff` }
    );
    if (result.ok) order = result.data.order;
  }

  ctx.policy('Customer requested a human', 'Creating a handoff with a structured summary.', 'ok');

  const ticket = await escalate(ctx, {
    order,
    reason: 'Customer requested a human',
    issue: 'Customer asked to speak with a person.',
    checks: order ? [`active order ${order.id}`] : ['no order identified'],
    outcome: 'Handed off at the customer’s request. No refund or return action taken.',
    recommended: 'Read the summary, review the conversation, and reply to the customer.'
  });

  if (!ticket) {
    return {
      reply: 'I tried to page the team but the handoff service failed. I’m sorry — please reply here again in a moment and I’ll retry.',
      cards: []
    };
  }

  return {
    reply: `I've brought in a human and included everything they need.\n\n• Ticket: ${ticket.id}\n• Reason: ${ticket.reason}\n• Expected reply: ${ticket.sla}\n\nThe summary includes the order details, what I checked and our conversation, so you won't need to repeat yourself.`,
    cards: [escalationCard(ticket)]
  };
}

function handleGreeting(ctx) {
  const suffix = ctx.session.activeOrderId
    ? ` We were just looking at order ${ctx.session.activeOrderId} — want the latest status?`
    : '';
  return {
    reply: `Hi, I'm Penelope, ${STORE_NAME}'s support agent. I can track an order, start a return, process a refund worth up to ${money(POLICY.autoRefundLimitCents)}, or hand you to a human with a summary.${suffix}\n\nWhat's your order number or question?`,
    cards: []
  };
}

function handleThanks() {
  return {
    reply: 'You’re welcome. If anything else comes up with the order, just message me here.',
    cards: []
  };
}

function handleUnknown(ctx) {
  if (/\border\b/i.test(ctx.text)) {
    return askForOrder(ctx, 'lookup', 'I can look into that.');
  }
  return {
    reply: `I can help with order tracking, returns, refunds and human handoffs. Give me an order number (for example 1002) and tell me what you need.\n\nRefunds up to ${money(POLICY.autoRefundLimitCents)} can be approved automatically; anything larger goes to a human with a summary.`,
    cards: []
  };
}

export async function runAgent({ session, text, baseUrl }) {
  session.messages.push({ role: 'customer', content: text, at: new Date().toISOString() });

  record({
    sessionId: session.id,
    actor: 'customer',
    type: 'customer_message',
    status: 'info',
    summary: text.slice(0, 300),
    data: { message: text.slice(0, 2000) }
  });

  const ctx = makeContext({ session, baseUrl, text });
  let intent = detectIntent(text);

  if (session.pending) {
    const hasOrderRef = Boolean(extractOrderRef(text) || extractEmail(text));
    if (intent === 'human') {
      session.pending = null;
    } else if (hasOrderRef) {
      intent = session.pending.intent;
      ctx.forcedAmountCents = session.pending.amountCents ?? null;
      session.pending = null;
    } else if (!['unknown', session.pending.intent].includes(intent)) {
      session.pending = null;
    }
  }

  const orderRef = extractOrderRef(text);
  record({
    sessionId: session.id,
    actor: 'agent',
    type: 'intent_detected',
    status: 'ok',
    summary: `Intent: ${intent}${orderRef ? ` · order ${orderRef}` : ''}`,
    data: { intent, orderRef, amountCents: extractAmountCents(text) }
  });

  if (!orderRef && !extractEmail(text) && session.activeOrderId && intent === 'unknown') {
    if (/\b(it|that|this|status|update|tracking)\b/i.test(text)) intent = 'wismo';
  }

  ctx.step({
    type: 'intent',
    status: 'ok',
    title: 'Intent detected',
    detail: `${intent}${orderRef ? ` · order ${orderRef}` : ''}`
  });

  let result;
  try {
    switch (intent) {
      case 'human':
        result = await handleHuman(ctx);
        break;
      case 'refund':
        result = await handleRefund(ctx);
        break;
      case 'return':
        result = await handleReturn(ctx);
        break;
      case 'wismo':
        result = await handleWismo(ctx);
        break;
      case 'lookup':
        result = await handleLookup(ctx);
        break;
      case 'greeting':
        result = handleGreeting(ctx);
        break;
      case 'thanks':
        result = handleThanks(ctx);
        break;
      default:
        result = handleUnknown(ctx);
    }
  } catch (error) {
    console.error('[agent]', error);
    record({
      sessionId: session.id,
      actor: 'agent',
      type: 'agent_error',
      status: 'error',
      summary: error.message,
      data: { stack: error.stack?.split('\n').slice(0, 5) }
    });
    result = {
      reply: 'Something went wrong on my side while handling that. Nothing was charged or changed. Could you try again?',
      cards: []
    };
  }

  const final = {
    reply: result.reply,
    cards: (result.cards || []).filter(Boolean)
  };

  session.messages.push({
    role: 'agent',
    content: final.reply,
    cards: final.cards,
    at: new Date().toISOString()
  });

  record({
    sessionId: session.id,
    actor: 'agent',
    type: 'agent_reply',
    status: 'ok',
    summary: final.reply.replaceAll('\n', ' ').slice(0, 300),
    data: { reply: final.reply, cards: final.cards.map((card) => card.type) }
  });

  ctx.step({
    type: 'reply',
    status: 'ok',
    title: 'Reply sent',
    detail: `${final.cards.length} structured card${final.cards.length === 1 ? '' : 's'} attached`
  });

  return {
    sessionId: session.id,
    reply: final.reply,
    cards: final.cards,
    trace: ctx.trace,
    activeOrderId: session.activeOrderId,
    pendingIntent: session.pending?.intent || null
  };
}
