const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const state = {
  sessionId: sessionStorage.getItem('penelope.session') || null,
  policy: null,
  busy: false,
  activeTab: 'trace',
  activeCustomer: null,
  lastUsage: null,
  demoRunning: false
};

const els = {
  messageList: $('#messageList'),
  chatScroll: $('#chatScroll'),
  chatProgress: $('#chatProgress'),
  composer: $('#composer'),
  input: $('#messageInput'),
  sendBtn: $('#sendBtn'),
  quickStrip: $('#quickStrip'),
  scenarioList: $('#scenarioList'),
  traceList: $('#traceList'),
  stepCount: $('#stepCount'),
  traceView: $('#traceView'),
  auditView: $('#auditView'),
  auditList: $('#auditList'),
  auditMeta: $('#auditMeta'),
  auditBadge: $('#auditBadge'),
  traceTab: $('#traceTab'),
  auditTab: $('#auditTab'),
  autoLimit: $('#autoLimit'),
  dailyLimit: $('#dailyLimit'),
  returnWindow: $('#returnWindow'),
  usageValue: $('#usageValue'),
  usageBar: $('#usageBar'),
  usageCustomer: $('#usageCustomer'),
  channelTitle: $('#channelTitle'),
  channelSubtitle: $('#channelSubtitle'),
  channelAvatar: $('#channelAvatar'),
  statOrders: $('#statOrders'),
  statRefunds: $('#statRefunds'),
  statEscalations: $('#statEscalations'),
  resetBtn: $('#resetBtn'),
  newChatBtn: $('#newChatBtn'),
  agentOrb: $('#agentOrb'),
  agentStatus: $('#agentStatus'),
  agentStatusText: $('#agentStatusText'),
  guidedDemo: $('#guidedDemo'),
  guidedTitle: $('#guidedTitle'),
  guidedSub: $('#guidedSub'),
  toast: $('#toast')
};

function el(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

function money(cents) {
  return usd.format((Number(cents) || 0) / 100);
}

function shortDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(iso));
}

function clockTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let toastTimer = null;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

function sparkle(node) {
  if (reducedMotion) return;
  const count = 10;
  for (let i = 0; i < count; i += 1) {
    const spark = el('span', 'spark');
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const distance = 26 + Math.random() * 40;
    spark.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    spark.style.setProperty('--dy', `${Math.sin(angle) * distance - 14}px`);
    spark.style.left = `${44 + Math.random() * 12}%`;
    spark.style.top = `${16 + Math.random() * 12}%`;
    spark.style.animationDelay = `${i * 16}ms`;
    if (i % 2) spark.classList.add('violet');
    node.append(spark);
    setTimeout(() => spark.remove(), 900 + i * 20);
  }
}

function initBackground() {
  if (reducedMotion || !finePointer) return;
  const glow = $('#pointerGlow');
  const ring = $('#cursorRing');
  const scene = $('.scene');
  if (!glow || !ring) return;

  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight / 2;
  let glowX = targetX;
  let glowY = targetY;
  let started = false;

  const frame = () => {
    glowX += (targetX - glowX) * 0.08;
    glowY += (targetY - glowY) * 0.08;
    glow.style.transform = `translate3d(${glowX}px, ${glowY}px, 0)`;
    ring.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.addEventListener('pointermove', (event) => {
    targetX = event.clientX;
    targetY = event.clientY;
    if (scene) {
      const px = targetX / window.innerWidth - 0.5;
      const py = targetY / window.innerHeight - 0.5;
      scene.style.setProperty('--sx', `${(px * -30).toFixed(1)}px`);
      scene.style.setProperty('--sy', `${(py * -22).toFixed(1)}px`);
    }
    if (!started) {
      started = true;
      ring.classList.add('visible');
    }
    const interactive = event.target.closest('button, a, textarea, .card, [data-tilt]');
    ring.classList.toggle('hot', Boolean(interactive));
  }, { passive: true });

  document.addEventListener('pointerleave', () => ring.classList.remove('visible'));
}

function initTilt() {
  if (reducedMotion || !finePointer) return;
  for (const node of $$('[data-tilt]')) {
    let frame = 0;
    let rect = null;

    const reset = () => {
      cancelAnimationFrame(frame);
      node.classList.remove('tilting');
      node.style.transform = '';
    };

    node.addEventListener('pointerenter', () => {
      rect = node.getBoundingClientRect();
      node.classList.add('tilting');
    });

    node.addEventListener('pointermove', (event) => {
      if (!rect) rect = node.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const py = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      const max = node.classList.contains('panel') ? 2.4 : 9;
      const rotateX = (0.5 - py) * max * 2;
      const rotateY = (px - 0.5) * max * 2.4;
      node.style.setProperty('--mx', `${px * 100}%`);
      node.style.setProperty('--my', `${py * 100}%`);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        node.style.transform = `perspective(900px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(0)`;
      });
    });

    node.addEventListener('pointerleave', reset);
    node.addEventListener('blur', reset);
  }
}

function initRipples() {
  document.addEventListener('pointerdown', (event) => {
    if (reducedMotion) return;
    const target = event.target.closest('.scenario, .quick-strip button, .send-btn');
    if (!target || target.disabled) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.5;
    const ripple = el('span', 'ripple');
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    target.append(ripple);
    setTimeout(() => ripple.remove(), 640);
  });
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    els.chatScroll.scrollTo({
      top: els.chatScroll.scrollHeight,
      behavior: reducedMotion ? 'auto' : 'smooth'
    });
  });
}

function renderParagraphs(container, text) {
  for (const block of String(text).split(/\n{2,}/)) {
    const paragraph = el('p', '', block);
    container.append(paragraph);
  }
}

function timeNode() {
  return el('div', 'msg-time', clockTime());
}

function appendUserMessage(text) {
  const row = el('div', 'message message-user');
  const body = el('div', 'msg-body');
  const bubble = el('div', 'bubble');
  renderParagraphs(bubble, text);
  body.append(bubble, timeNode());
  row.append(body);
  els.messageList.append(row);
  scrollToBottom();
}

function appendAgentMessage(text, cards = []) {
  const row = el('div', 'message message-agent');
  const avatar = el('div', 'msg-avatar', 'P');
  const body = el('div', 'msg-body');
  const bubble = el('div', 'bubble');
  renderParagraphs(bubble, text);
  body.append(bubble);

  if (cards.length) {
    const wrap = el('div', 'msg-cards');
    for (const card of cards) {
      const rendered = renderCard(card);
      if (rendered) wrap.append(rendered);
    }
    if (wrap.childElementCount) body.append(wrap);
  }

  body.append(timeNode());
  row.append(avatar, body);
  els.messageList.append(row);
  scrollToBottom();
}

function appendNotice(text) {
  const row = el('div', 'message message-agent message-notice');
  const avatar = el('div', 'msg-avatar', '!');
  const body = el('div', 'msg-body');
  const bubble = el('div', 'bubble');
  renderParagraphs(bubble, text);
  body.append(bubble, timeNode());
  row.append(avatar, body);
  els.messageList.append(row);
  scrollToBottom();
}

function showTyping() {
  hideTyping();
  const row = el('div', 'typing');
  row.id = 'typingIndicator';
  const avatar = el('div', 'msg-avatar', 'P');
  const bubble = el('div', 'typing-bubble');
  const dots = el('div', 'typing-dots');
  dots.append(el('span'), el('span'), el('span'));
  bubble.append(dots, el('span', '', 'Checking the store…'));
  row.append(avatar, bubble);
  els.messageList.append(row);
  scrollToBottom();
}

function hideTyping() {
  $('#typingIndicator')?.remove();
}

function statusPill(status, label) {
  return el('span', `status-pill status-${status}`, label);
}

function metaCell(label, value) {
  const cell = el('div');
  cell.append(el('span', '', label), el('strong', '', value));
  return cell;
}

function orderCard(card) {
  const root = el('div', 'card card-order');
  const top = el('div', 'card-top');
  const idWrap = el('div');
  idWrap.append(el('span', 'card-eyebrow', 'Order'), el('span', 'card-id', `#${card.orderId}`));
  top.append(idWrap, statusPill(card.status, card.statusLabel));
  root.append(top);

  const items = el('div', 'card-items');
  for (const item of card.items || []) {
    const row = el('div', 'item-row');
    const name = el('span');
    name.append(document.createTextNode(item.name), el('em', '', ` ×${item.qty}`));
    row.append(name, el('span', '', money(item.unitCents * item.qty)));
    items.append(row);
  }
  root.append(items);

  const grid = el('div', 'card-grid');
  grid.append(
    metaCell('Total', money(card.totalCents)),
    metaCell('Refunded', money(card.refundedTotalCents)),
    metaCell('Refundable', money(card.remainingRefundableCents))
  );
  root.append(grid);

  if (card.tracking) {
    const trackingRow = el('div', 'card-tracking');
    trackingRow.append(
      el('span', '', card.carrier || 'Carrier'),
      el('code', '', card.tracking)
    );
    root.append(trackingRow);

    const dateRow = el('div', 'card-tracking');
    dateRow.append(
      el('span', '', card.deliveredAt ? 'Delivered' : 'Estimated delivery'),
      el('code', '', shortDate(card.deliveredAt || card.eta))
    );
    root.append(dateRow);
  } else {
    const foot = el('div', 'card-tracking');
    foot.append(
      el('span', '', 'Fulfillment'),
      el('code', '', card.status === 'cancelled' ? 'Cancelled before shipping' : 'Not shipped yet')
    );
    root.append(foot);
  }

  return root;
}

function refundCard(card) {
  const root = el('div', 'card card-refund');
  const head = el('div', 'receipt-head');
  head.append(
    el('span', '', 'Refund receipt'),
    el('span', 'chip', card.existing ? 'Already issued' : 'Succeeded')
  );

  const rows = el('div', 'receipt-rows');
  const addRow = (label, value) => {
    const row = el('div', 'receipt-row');
    row.append(el('span', '', label), el('strong', '', value));
    rows.append(row);
  };
  addRow('Refund ID', card.refundId);
  addRow('Order', `#${card.orderId}`);
  addRow('Initiated', shortDate(card.createdAt));

  const foot = el(
    'div',
    'receipt-foot',
    `${card.method} · arrives in ${card.timing}`
  );

  root.append(
    head,
    el('div', 'receipt-amount', money(card.amountCents)),
    rows,
    foot
  );
  sparkle(root);
  return root;
}

function returnCard(card) {
  const root = el('div', 'card card-return');
  const head = el('div', 'return-head');
  head.append(
    el('span', '', 'Return label issued'),
    el('span', 'chip', card.status.replaceAll('_', ' '))
  );

  const body = el('div', 'return-body');
  body.append(el('div', 'rma', card.rma));

  const rows = el('div', 'return-rows');
  const addRow = (label, value) => {
    const row = el('div', 'return-row');
    row.append(el('span', '', label), el('strong', '', value));
    rows.append(row);
  };
  addRow('Reason', card.reason);
  addRow('Est. refund', money(card.refundEstimateCents));
  addRow('Drop off by', shortDate(card.dropoffBy));
  body.append(rows);

  root.append(head, body);
  sparkle(root);
  return root;
}

function escalationCard(card) {
  const root = el('div', 'card card-escalation');
  const head = el('div', 'esc-head');
  head.append(
    el('span', '', 'Human handoff'),
    el('span', 'chip', card.status)
  );

  const body = el('div', 'esc-body');
  body.append(
    el('div', 'esc-ticket', card.ticketId),
    el('div', 'esc-reason', card.reason)
  );

  if (card.summary) {
    const details = el('details');
    details.append(el('summary', '', 'View handoff summary'));
    details.append(el('pre', 'esc-summary', card.summary));
    body.append(details);
  }

  const foot = el('div', 'esc-foot');
  foot.append(el('span', '', 'Response SLA'), el('span', '', card.sla));

  root.append(head, body, foot);
  return root;
}

function renderCard(card) {
  switch (card?.type) {
    case 'order':
      return orderCard(card);
    case 'refund':
      return refundCard(card);
    case 'return':
      return returnCard(card);
    case 'escalation':
      return escalationCard(card);
    default:
      return null;
  }
}

function emptyState(mark, title, copy) {
  const wrap = el('div', 'empty-state');
  wrap.append(
    el('div', 'empty-mark', mark),
    el('strong', '', title),
    el('p', '', copy)
  );
  return wrap;
}

const TRACE_KINDS = {
  intent: 'Intent',
  thought: 'Reasoning',
  tool: 'Tool call',
  policy: 'Policy',
  reply: 'Response'
};

function statusText(step) {
  if (step.type === 'tool' && step.responseStatus) return String(step.responseStatus);
  if (step.status === 'denied') return 'Blocked';
  if (step.status === 'escalated') return 'Escalated';
  if (step.status === 'error') return 'Error';
  return 'OK';
}

function renderTrace(trace = []) {
  els.traceList.replaceChildren();
  els.stepCount.textContent = `${trace.length} step${trace.length === 1 ? '' : 's'}`;

  if (!trace.length) {
    els.traceList.append(
      emptyState('↳', 'No trace yet', 'Run a scenario. Every lookup, policy check and action will appear here.')
    );
    return;
  }

  for (const step of trace) {
    const row = el('div', `trace-step status-${step.status} kind-${step.type}`);
    const dot = el('div', 'trace-dot');
    const top = el('div', 'trace-top');
    top.append(
      el('span', `trace-kind kind-${step.type}`, TRACE_KINDS[step.type] || step.type),
      el('span', `trace-status ${step.status}`, statusText(step))
    );
    const content = el('div');
    content.append(top, el('div', 'trace-title', step.title || ''));
    if (step.detail) content.append(el('div', 'trace-detail', step.detail));
    row.append(dot, content);
    els.traceList.append(row);
  }
}

function auditTypeLabel(type) {
  return String(type).replace(/^store\./, '').replaceAll('_', ' ');
}

function renderAudit(entries = []) {
  els.auditList.replaceChildren();
  if (!entries.length) {
    els.auditList.append(
      emptyState('⌁', 'No events yet', 'Tool calls, guardrail decisions and actions are logged here.')
    );
    return;
  }

  for (const entry of [...entries].reverse()) {
    const row = el('div', `audit-row status-${entry.status}`);
    const time = el(
      'div',
      'audit-time',
      new Date(entry.ts).toLocaleTimeString([], { hour12: false })
    );
    const main = el('div', 'audit-main');
    main.append(
      el('span', `audit-type type-${String(entry.type).replaceAll('.', '_')}`, auditTypeLabel(entry.type)),
      el('div', 'audit-summary-text', entry.summary || '')
    );
    row.append(time, main);
    els.auditList.append(row);
  }
}

function setTab(name) {
  state.activeTab = name;
  const traceActive = name === 'trace';
  els.traceTab.classList.toggle('active', traceActive);
  els.auditTab.classList.toggle('active', !traceActive);
  els.traceTab.setAttribute('aria-selected', String(traceActive));
  els.auditTab.setAttribute('aria-selected', String(!traceActive));
  els.traceView.classList.toggle('hidden', !traceActive);
  els.auditView.classList.toggle('hidden', traceActive);
  if (!traceActive) refreshAudit();
}

async function refreshAudit() {
  if (!state.sessionId) {
    els.auditBadge.textContent = '0';
    els.auditMeta.textContent = '0 events in this session';
    renderAudit([]);
    return;
  }

  try {
    const response = await fetch(
      `/api/logs?sessionId=${encodeURIComponent(state.sessionId)}&limit=300`
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Audit log unavailable.');
    els.auditBadge.textContent = String(data.count);
    els.auditMeta.textContent = `${data.count} events in this session`;
    renderAudit(data.entries);
  } catch {
    els.auditMeta.textContent = 'Audit log unavailable';
    renderAudit([]);
  }
}

function applyChannel(cards) {
  const order = (cards || []).find((card) => card?.type === 'order');
  if (!order) return;
  state.activeCustomer = order.customerName;
  els.channelTitle.textContent = `Order #${order.orderId}`;
  els.channelSubtitle.textContent = `${order.customerName} · ${order.statusLabel}`;
  els.channelAvatar.textContent = initials(order.customerName) || 'WA';
}

function resetChannel() {
  state.activeCustomer = null;
  els.channelTitle.textContent = 'WhatsApp sandbox';
  els.channelSubtitle.textContent = 'Penelope is handling this conversation';
  els.channelAvatar.textContent = 'WA';
}

function updateStats(stats) {
  if (!stats) return;
  els.statOrders.textContent = String(stats.orders ?? '—');
  els.statRefunds.textContent = String(stats.refunds ?? '—');
  els.statEscalations.textContent = String(stats.openEscalations ?? '—');
}

function updateGuardrails(guardrails, orderId = null) {
  const policy = state.policy;
  const dailyLimitCents =
    guardrails?.dailyAutoRefundLimitCents ?? policy?.dailyAutoRefundLimitCents ?? 15000;

  if (!guardrails) {
    state.lastUsage = null;
    els.usageValue.textContent = `${money(0)} / ${money(dailyLimitCents)}`;
    els.usageBar.style.width = '0%';
    els.usageBar.className = 'usage-fill';
    els.usageCustomer.textContent = 'No active order yet';
    return;
  }

  const used = guardrails.dailyAutoRefundedCents || 0;
  const remaining = Math.max(0, guardrails.dailyAutoRefundRemainingCents ?? dailyLimitCents - used);
  const percent = dailyLimitCents > 0 ? Math.min(100, (used / dailyLimitCents) * 100) : 0;

  if (state.lastUsage !== null && used > state.lastUsage) {
    els.usageBar.classList.remove('pulse');
    void els.usageBar.offsetWidth;
    els.usageBar.classList.add('pulse');
    setTimeout(() => els.usageBar.classList.remove('pulse'), 800);
  }
  state.lastUsage = used;

  els.usageValue.textContent = `${money(used)} / ${money(dailyLimitCents)}`;
  els.usageBar.style.width = `${percent}%`;
  els.usageBar.className = `usage-fill${percent >= 100 ? ' full' : percent >= 70 ? ' warn' : ''}`;

  if (state.activeCustomer && orderId) {
    els.usageCustomer.textContent = `${state.activeCustomer} · ${money(used)} used today · ${money(remaining)} headroom`;
  } else {
    els.usageCustomer.textContent = 'Shared daily cap · no active customer';
  }
}

function setBusy(busy) {
  state.busy = busy;
  els.sendBtn.disabled = busy;
  els.guidedDemo.disabled = busy || state.demoRunning;
  els.agentOrb?.classList.toggle('thinking', busy);
  els.agentStatus?.classList.toggle('busy', busy);
  if (els.agentStatusText) {
    els.agentStatusText.textContent = busy
      ? 'Calling store tools…'
      : 'Online · policy engine ready';
  }
  $$('.scenario').forEach((button) => {
    button.disabled = busy || state.demoRunning;
  });
  $$('#quickStrip button').forEach((button) => {
    button.disabled = busy || state.demoRunning;
  });
}

function renderWelcome() {
  els.messageList.replaceChildren();
  appendAgentMessage(
    "Hi, I'm Penelope — Northwind's support agent. Every message goes through the same loop: understand it, call the store API, apply policy, then act and log it.\n\nPick a case on the left, or type an order number. I can track shipments, start returns, auto-approve refunds up to $50.00, and hand off to a human with a full summary.\n\nNew here? Run the 3-turn demo in the case library to see tracking, an auto-refund and a guardrail escalation back-to-back.",
    []
  );
}

async function sendMessage(raw) {
  const text = String(raw || '').trim();
  if (!text || state.busy) return;

  setBusy(true);
  appendUserMessage(text);
  showTyping();
  els.input.value = '';
  resizeInput();

  const startedAt = performance.now();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId: state.sessionId })
    });
    const data = await response.json();

    const elapsed = performance.now() - startedAt;
    if (elapsed < 420) await delay(420 - elapsed);
    hideTyping();

    if (!response.ok) {
      throw new Error(data.error?.message || 'The agent could not respond.');
    }

    state.sessionId = data.sessionId;
    sessionStorage.setItem('penelope.session', state.sessionId);

    appendAgentMessage(data.reply, data.cards || []);
    renderTrace(data.trace || []);
    applyChannel(data.cards || []);
    updateGuardrails(data.guardrails, data.activeOrderId);
    updateStats(data.stats);
    refreshAudit();
    return data;
  } catch (error) {
    hideTyping();
    appendNotice(
      `${error.message || 'I could not reach the agent.'}\n\nNothing was changed. Please try again.`
    );
    return null;
  } finally {
    setBusy(false);
    els.input.focus();
  }
}

function resizeInput() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 120)}px`;
}

async function loadPolicy() {
  try {
    const response = await fetch('/api/policy');
    const data = await response.json();
    if (!response.ok) throw new Error('Policy unavailable');
    state.policy = data.policy;
    els.autoLimit.textContent = money(data.policy.autoRefundLimitCents);
    els.dailyLimit.textContent = money(data.policy.dailyAutoRefundLimitCents);
    els.returnWindow.textContent = `${data.policy.returnWindowDays} days`;
    updateStats(data.stats);
    updateGuardrails(null);
  } catch {
    updateGuardrails(null);
  }
}

async function resetDemo() {
  if (state.busy) return;
  const confirmed = window.confirm(
    'Reset the sandbox store, refunds, returns, sessions and audit log?'
  );
  if (!confirmed) return;

  try {
    const response = await fetch('/api/reset', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Reset failed.');

    state.sessionId = null;
    state.activeCustomer = null;
    sessionStorage.removeItem('penelope.session');
    resetChannel();
    renderWelcome();
    renderTrace([]);
    renderAudit([]);
    els.auditBadge.textContent = '0';
    els.auditMeta.textContent = '0 events in this session';
    updateStats(data.stats);
    updateGuardrails(null);
    toast('Demo reset — 12 fresh orders');
  } catch (error) {
    toast(error.message || 'Could not reset the demo.');
  }
}

const GUIDED_STEPS = [
  { message: 'Where is my order 1002?', label: 'Reading UPS scans · order 1002' },
  { message: 'Please refund order 1005', label: 'Auto-approving $34.99 · order 1005' },
  { message: 'Refund order 1006', label: 'Guardrail trips → human handoff' }
];

let guidedResetTimer = null;

async function runGuidedDemo() {
  if (state.busy || state.demoRunning) return;

  state.demoRunning = true;
  els.guidedDemo.disabled = true;
  els.guidedDemo.classList.add('running');
  els.guidedDemo.setAttribute('aria-busy', 'true');
  newConversation(true);

  let failed = false;
  try {
    for (let i = 0; i < GUIDED_STEPS.length; i += 1) {
      const step = GUIDED_STEPS[i];
      els.guidedTitle.textContent = `Step ${i + 1} of ${GUIDED_STEPS.length}`;
      els.guidedSub.textContent = step.label;
      await delay(280);
      const result = await sendMessage(step.message);
      if (!result) failed = true;
      await delay(i === GUIDED_STEPS.length - 1 ? 0 : 700);
    }
  } finally {
    state.demoRunning = false;
    setBusy(false);
    els.guidedDemo.disabled = false;
    els.guidedDemo.classList.remove('running');
    els.guidedDemo.removeAttribute('aria-busy');
    els.guidedTitle.textContent = failed ? 'Demo interrupted' : 'Demo complete';
    els.guidedSub.textContent = failed ? 'Try again from any case' : 'Inspect every step in the trace';
    if (!failed) toast('Demo complete — the agent trace on the right shows every call');

    clearTimeout(guidedResetTimer);
    guidedResetTimer = setTimeout(() => {
      if (state.demoRunning) return;
      els.guidedTitle.textContent = 'Run the 3-turn demo';
      els.guidedSub.textContent = 'Track → auto-refund → escalation';
    }, 6000);
  }
}

function newConversation(silent = false) {
  if (state.busy) return;
  state.sessionId = null;
  state.activeCustomer = null;
  sessionStorage.removeItem('penelope.session');
  resetChannel();
  renderWelcome();
  renderTrace([]);
  renderAudit([]);
  els.auditBadge.textContent = '0';
  els.auditMeta.textContent = '0 events in this session';
  updateGuardrails(null);
  setTab('trace');
  els.input.focus();
  if (!silent) toast('New conversation started');
}

function bindEvents() {
  const updateCaseFade = () => {
    const list = els.scenarioList;
    const panel = list.closest('.scenarios-panel');
    if (!panel) return;
    const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
    panel.dataset.scrollEnd = String(atEnd);
  };
  els.scenarioList.addEventListener('scroll', updateCaseFade, { passive: true });
  window.addEventListener('resize', updateCaseFade);
  requestAnimationFrame(updateCaseFade);

  const updateChatProgress = () => {
    const max = els.chatScroll.scrollHeight - els.chatScroll.clientHeight;
    const ratio = max > 0 ? els.chatScroll.scrollTop / max : 0;
    els.chatProgress.style.transform = `scaleX(${ratio})`;
  };
  els.chatScroll.addEventListener('scroll', updateChatProgress, { passive: true });

  els.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    sendMessage(els.input.value);
  });

  els.input.addEventListener('input', resizeInput);

  els.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!state.busy) sendMessage(els.input.value);
    }
  });

  for (const button of $$('[data-message]')) {
    button.addEventListener('click', () => {
      if (!state.busy) sendMessage(button.dataset.message);
    });
  }

  els.traceTab.addEventListener('click', () => setTab('trace'));
  els.auditTab.addEventListener('click', () => setTab('audit'));
  els.guidedDemo.addEventListener('click', runGuidedDemo);
  els.resetBtn.addEventListener('click', resetDemo);
  els.newChatBtn.addEventListener('click', newConversation);
}

async function init() {
  initBackground();
  initTilt();
  initRipples();
  bindEvents();
  renderWelcome();
  renderTrace([]);
  await loadPolicy();
  if (state.sessionId) {
    refreshAudit();
  } else {
    renderAudit([]);
  }
  els.input.focus();
}

init();
