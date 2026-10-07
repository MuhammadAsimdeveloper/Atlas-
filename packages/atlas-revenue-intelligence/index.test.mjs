import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreLeadIntelligence,
  mapBuyingCommittee,
  recommendNextBestAction,
  forecastPipeline,
  scoreBidOffer,
  buildRevenueBoardroomSnapshot
} from './index.mjs';

test('scores a strong lead as hot with transparent reasons', () => {
  const result = scoreLeadIntelligence({
    firmographicFit: 95,
    buyingIntent: 90,
    engagement: 85,
    urgency: 80,
    budgetFit: 90,
    decisionMakerAccess: 85,
    sourceQuality: 80,
    problemFit: 95
  });
  assert.equal(result.band, 'hot');
  assert.ok(result.score >= 85);
  assert.ok(result.reasonCodes.includes('strong_problem_fit'));
});

test('clamps invalid signal values to a safe range error', () => {
  assert.throws(
    () => scoreLeadIntelligence({ buyingIntent: 101 }),
    /buyingIntent/
  );
});

test('maps a buying committee into useful sales roles', () => {
  const result = mapBuyingCommittee({
    contacts: [
      { name: 'CFO', title: 'Chief Financial Officer', department: 'finance', seniority: 'c-suite' },
      { name: 'Maya', title: 'VP Sales', department: 'sales', seniority: 'vp', influence: 90 },
      { name: 'Sam', title: 'Engineering Manager', department: 'engineering', seniority: 'manager' },
      { name: 'Lee', title: 'Procurement Specialist', department: 'procurement', seniority: 'individual' }
    ]
  });
  assert.equal(result.roles.economicBuyer[0].name, 'CFO');
  assert.equal(result.roles.champion[0].name, 'Maya');
  assert.equal(result.roles.technicalEvaluator[0].name, 'Sam');
  assert.equal(result.roles.blocker[0].name, 'Lee');
});

test('recommends no-show recovery before generic follow-up', () => {
  const result = recommendNextBestAction({
    stage: 'booked',
    noShow: true,
    score: 92
  });
  assert.equal(result.action, 'no_show_recovery');
  assert.equal(result.priority, 'urgent');
});

test('recommends reactivation for stale qualified leads', () => {
  const result = recommendNextBestAction({
    stage: 'qualified',
    score: 78,
    lastContactAt: '2026-09-20T10:00:00.000Z',
    now: '2026-10-08T10:00:00.000Z'
  });
  assert.equal(result.action, 'reactivate');
});

test('forecasts weighted pipeline from stage probability and value', () => {
  const result = forecastPipeline({
    opportunities: [
      { id: 'a', value: 1000, probability: 0.9, stage: 'proposal' },
      { id: 'b', value: 2000, probability: 0.5, stage: 'qualified' },
      { id: 'c', value: 500, probability: 0.1, stage: 'new' }
    ]
  });
  assert.equal(result.totalValue, 3500);
  assert.equal(result.weightedValue, 2050);
  assert.equal(result.count, 3);
  assert.equal(result.topOpportunity.id, 'b');
});

test('scores an offer across fit, win probability and risk', () => {
  const result = scoreBidOffer({
    requirementsFit: 90,
    pastPerformance: 80,
    pricingCompetitiveness: 75,
    deliveryConfidence: 85,
    strategicFit: 95,
    deadlineRisk: 20
  });
  assert.equal(result.band, 'strong');
  assert.ok(result.score > 80);
});

test('builds a boardroom snapshot with actions and pipeline forecast', () => {
  const result = buildRevenueBoardroomSnapshot({
    leads: [
      { id: 'l1', score: 91, status: 'working', value: 4000 },
      { id: 'l2', score: 55, status: 'nurture', value: 1000 }
    ],
    opportunities: [
      { id: 'o1', value: 4000, probability: 0.8, stage: 'proposal' },
      { id: 'o2', value: 1000, probability: 0.4, stage: 'qualified' }
    ],
    actions: [
      { id: 'a1', priority: 'urgent', action: 'no_show_recovery' },
      { id: 'a2', priority: 'normal', action: 'follow_up' }
    ]
  });
  assert.equal(result.leads.total, 2);
  assert.equal(result.pipeline.weightedValue, 3600);
  assert.equal(result.riskFlags[0], 'urgent_actions_pending');
  assert.equal(result.recommendedActions[0].id, 'a1');
});
