export const POLICY = {
  autoRefundLimitCents: 5000,
  dailyAutoRefundLimitCents: 15000,
  returnWindowDays: 30,
  staleShipmentDays: 10,
  currency: 'USD',
  timezone: 'UTC'
};

export function money(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: POLICY.currency
  }).format((Number(cents) || 0) / 100);
}

export function daysBetween(a, b = new Date()) {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

export function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
}

export function dailyAutoRefundCents(store, customerId, now = new Date()) {
  const start = startOfUtcDay(now).getTime();
  return store.refunds
    .filter((refund) =>
      refund.customerId === customerId &&
      refund.mode === 'auto' &&
      new Date(refund.createdAt).getTime() >= start
    )
    .reduce((sum, refund) => sum + refund.amountCents, 0);
}

export function policySnapshot(store, customerId = null, now = new Date()) {
  const used = customerId ? dailyAutoRefundCents(store, customerId, now) : 0;
  return {
    autoRefundLimitCents: POLICY.autoRefundLimitCents,
    dailyAutoRefundLimitCents: POLICY.dailyAutoRefundLimitCents,
    returnWindowDays: POLICY.returnWindowDays,
    staleShipmentDays: POLICY.staleShipmentDays,
    dailyAutoRefundedCents: used,
    dailyAutoRefundRemainingCents: Math.max(0, POLICY.dailyAutoRefundLimitCents - used)
  };
}
