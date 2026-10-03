import test from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS_TARGET_PLANS, PRICING_RESEARCH, getAtlasTargetPlan, validatePriceTargets } from './index.mjs';

test('Atlas target subscription prices are exactly half the HighLevel monthly subscriptions checked on 2026-10-03', () => {
  const audit = validatePriceTargets();
  assert.equal(audit.pass, true);
  assert.deepEqual(ATLAS_TARGET_PLANS.map(plan => plan.monthlyTargetCents), [4850, 14850, 24850]);
  assert.equal(PRICING_RESEARCH.source, 'https://www.gohighlevel.com/pricing');
  assert.equal(PRICING_RESEARCH.checkedAt, '2026-10-03');
  assert.equal(getAtlasTargetPlan('growth').monthlyTargetCents, 14850);
  assert.equal(getAtlasTargetPlan('missing'), null);
});

test('pricing audit rejects duplicate IDs and a target that no longer matches the stated half-price strategy', () => {
  assert.throws(() => validatePriceTargets(ATLAS_TARGET_PLANS.map(plan => ({ ...plan, id: 'duplicate' }))), /unique/);
  assert.equal(validatePriceTargets(ATLAS_TARGET_PLANS.map((plan, index) => index === 0 ? { ...plan, monthlyTargetCents: 4800 } : plan)).pass, false);
});
