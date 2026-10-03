export const PRICING_RESEARCH = Object.freeze({
  checkedAt: '2026-10-03',
  source: 'https://www.gohighlevel.com/pricing',
  basis: 'published monthly platform subscription only',
  excludes: Object.freeze(['usage charges', 'AI add-ons', 'carrier fees', 'taxes', 'payment processing', 'implementation services'])
});

export const ATLAS_TARGET_PLANS = Object.freeze([
  Object.freeze({ id: 'solo', name: 'Atlas Solo', benchmarkPlan: 'HighLevel Starter', benchmarkMonthlyCents: 9700, monthlyTargetCents: 4850, currency: 'USD' }),
  Object.freeze({ id: 'growth', name: 'Atlas Growth', benchmarkPlan: 'HighLevel Unlimited', benchmarkMonthlyCents: 29700, monthlyTargetCents: 14850, currency: 'USD' }),
  Object.freeze({ id: 'agency', name: 'Atlas Agency', benchmarkPlan: 'HighLevel Agency Pro', benchmarkMonthlyCents: 49700, monthlyTargetCents: 24850, currency: 'USD' })
]);

export function validatePriceTargets(plans = ATLAS_TARGET_PLANS) {
  if (!Array.isArray(plans) || plans.length !== 3) throw new Error('Atlas target catalog must contain three benchmarked plans');
  const ids = new Set();
  const checks = plans.map(plan => {
    if (!plan || typeof plan.id !== 'string' || !plan.id || ids.has(plan.id)) throw new Error('Plan IDs must be non-empty and unique');
    ids.add(plan.id);
    if (plan.currency !== 'USD' || !Number.isSafeInteger(plan.benchmarkMonthlyCents) || !Number.isSafeInteger(plan.monthlyTargetCents) || plan.benchmarkMonthlyCents <= 0 || plan.monthlyTargetCents < 0) throw new Error('Plan prices must use non-negative integer USD cents');
    return {
      id: plan.id,
      targetIsHalf: plan.monthlyTargetCents * 2 === plan.benchmarkMonthlyCents,
      benchmarkMonthlyCents: plan.benchmarkMonthlyCents,
      monthlyTargetCents: plan.monthlyTargetCents
    };
  });
  return { pass: checks.every(check => check.targetIsHalf), checkedAt: PRICING_RESEARCH.checkedAt, basis: PRICING_RESEARCH.basis, checks };
}

export function getAtlasTargetPlan(id) {
  return ATLAS_TARGET_PLANS.find(plan => plan.id === id) || null;
}
