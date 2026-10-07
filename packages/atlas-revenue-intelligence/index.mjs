const LEAD_SIGNAL_WEIGHTS = Object.freeze({
  firmographicFit: 15,
  buyingIntent: 20,
  engagement: 15,
  urgency: 10,
  budgetFit: 10,
  decisionMakerAccess: 15,
  sourceQuality: 5,
  problemFit: 10
});

const BID_WEIGHTS = Object.freeze({
  requirementsFit: 25,
  pastPerformance: 15,
  pricingCompetitiveness: 15,
  deliveryConfidence: 15,
  strategicFit: 30
});

const PRIORITY_RANK = Object.freeze({ urgent: 0, high: 1, normal: 2, low: 3 });

function fail(message, code = 'invalid_revenue_intelligence_input') {
  throw Object.assign(new Error(message), { code, status: 400 });
}

function assertPlainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field + ' must be an object');
}

function signal(value, field, fallback = 0) {
  const result = value == null ? fallback : value;
  if (typeof result !== 'number' || !Number.isFinite(result) || result < 0 || result > 100) {
    fail(field + ' must be a number from 0 to 100');
  }
  return result;
}

function probability(value, field) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 1) fail(field + ' must be a probability from 0 to 1');
  return result;
}

function nonNegativeNumber(value, field) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) fail(field + ' must be a non-negative number');
  return result;
}

function normalizedText(value, field, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(field + ' must be 1 to ' + max + ' characters');
  return value.normalize('NFKC').trim();
}

export function scoreLeadIntelligence(input = {}) {
  assertPlainObject(input, 'Lead intelligence');
  const breakdown = Object.entries(LEAD_SIGNAL_WEIGHTS).map(([key, weight]) => {
    const value = signal(input[key], key);
    return Object.freeze({ signal: key, value, weight, contribution: value * weight / 100 });
  });
  const score = Math.round(breakdown.reduce((sum, item) => sum + item.contribution, 0));
  const band = score >= 80 ? 'hot' : score >= 60 ? 'warm' : 'cold';
  const reasonCodes = [];
  if (input.problemFit != null && signal(input.problemFit, 'problemFit') >= 80) reasonCodes.push('strong_problem_fit');
  if (input.buyingIntent != null && signal(input.buyingIntent, 'buyingIntent') >= 80) reasonCodes.push('strong_buying_intent');
  if (input.decisionMakerAccess != null && signal(input.decisionMakerAccess, 'decisionMakerAccess') >= 80) reasonCodes.push('decision_maker_access');
  if (input.engagement != null && signal(input.engagement, 'engagement') < 40) reasonCodes.push('low_engagement');
  if (input.budgetFit != null && signal(input.budgetFit, 'budgetFit') < 40) reasonCodes.push('budget_mismatch');
  if (!reasonCodes.length) reasonCodes.push(band === 'hot' ? 'sales_ready' : band === 'warm' ? 'nurture_candidate' : 'needs_qualification');
  return Object.freeze({
    score,
    band,
    reasonCodes: [...new Set(reasonCodes)].slice(0, 12),
    recommendedAction: band === 'hot' ? 'book_or_close' : band === 'warm' ? 'follow_up' : 'nurture',
    breakdown
  });
}

function roleForContact(contact = {}) {
  const title = String(contact.title || '').toLowerCase();
  const department = String(contact.department || '').toLowerCase();
  const seniority = String(contact.seniority || '').toLowerCase();
  const combined = title + ' ' + department;
  if (/(cfo|chief financial|owner|founder|ceo|chief executive|coo|chief operating)/.test(title)) return 'economicBuyer';
  if (/(vp sales|vice president sales|head of sales|sales director|revenue leader|growth leader|executive sponsor|champion)/.test(combined)) return 'champion';
  if (/(engineering|technical|it |information technology|security|architect|developer|technology)/.test(combined)) return 'technicalEvaluator';
  if (/(procurement|purchasing|legal|compliance|vendor management)/.test(combined)) return 'blocker';
  if (/(end user|operations|operator|administrator|user)/.test(combined) || seniority === 'individual') return 'endUser';
  return 'other';
}

export function mapBuyingCommittee({ contacts = [] } = {}) {
  if (!Array.isArray(contacts) || contacts.length > 50) fail('contacts must contain at most 50 entries');
  const roles = {
    economicBuyer: [],
    champion: [],
    technicalEvaluator: [],
    blocker: [],
    endUser: [],
    other: []
  };
  contacts.forEach((contact, index) => {
    assertPlainObject(contact, 'contact ' + (index + 1));
    const entry = {
      ...contact,
      influence: contact.influence == null ? 50 : signal(contact.influence, 'contact influence')
    };
    const role = roleForContact(entry);
    roles[role].push(entry);
  });
  for (const list of Object.values(roles)) list.sort((a, b) => b.influence - a.influence);
  return Object.freeze({ roles, coveredRoles: Object.entries(roles).filter(([, list]) => list.length).map(([role]) => role) });
}

function ageInDays(value, now) {
  if (!value) return 0;
  const stamp = Date.parse(value);
  const current = Date.parse(now);
  if (!Number.isFinite(stamp) || !Number.isFinite(current)) fail('lastContactAt and now must be valid dates');
  return Math.max(0, Math.floor((current - stamp) / 86_400_000));
}

export function recommendNextBestAction({
  stage = 'new',
  score = 0,
  noShow = false,
  replied = false,
  lastContactAt = null,
  proposalSentAt = null,
  now = new Date().toISOString()
} = {}) {
  const normalizedScore = signal(score, 'score');
  const staleDays = ageInDays(lastContactAt, now);
  if (noShow) return Object.freeze({ action: 'no_show_recovery', priority: 'urgent', reason: 'Appointment was missed; recover while intent is fresh.' });
  if (replied) return Object.freeze({ action: 'human_follow_up', priority: 'high', reason: 'The lead replied and needs a timely response.' });
  if (proposalSentAt && ageInDays(proposalSentAt, now) >= 2) return Object.freeze({ action: 'proposal_follow_up', priority: normalizedScore >= 80 ? 'high' : 'normal', reason: 'Proposal is awaiting a response.' });
  if (staleDays >= 14 && ['qualified', 'working', 'proposal'].includes(String(stage).toLowerCase())) return Object.freeze({ action: 'reactivate', priority: normalizedScore >= 75 ? 'high' : 'normal', reason: 'Qualified opportunity has gone quiet.' });
  if (['qualified', 'working'].includes(String(stage).toLowerCase()) && normalizedScore >= 80) return Object.freeze({ action: 'book_meeting', priority: 'high', reason: 'High-fit lead is ready for a conversion step.' });
  if (String(stage).toLowerCase() === 'booked') return Object.freeze({ action: 'confirm_appointment', priority: 'high', reason: 'Protect a booked appointment with confirmation and preparation.' });
  if (normalizedScore >= 60) return Object.freeze({ action: 'follow_up', priority: 'normal', reason: 'Lead has enough fit or intent for continued engagement.' });
  return Object.freeze({ action: 'nurture', priority: 'low', reason: 'Lead needs additional qualification or education.' });
}

export function forecastPipeline({ opportunities = [] } = {}) {
  if (!Array.isArray(opportunities) || opportunities.length > 500) fail('opportunities must contain at most 500 entries');
  const normalized = opportunities.map((item, index) => {
    assertPlainObject(item, 'opportunity ' + (index + 1));
    const value = nonNegativeNumber(item.value, 'opportunity value');
    const p = probability(item.probability, 'opportunity probability');
    return { ...item, value, probability: p, weightedValue: value * p };
  });
  const totalValue = normalized.reduce((sum, item) => sum + item.value, 0);
  const weightedValue = normalized.reduce((sum, item) => sum + item.weightedValue, 0);
  const topOpportunity = normalized.slice().sort((a, b) => b.weightedValue - a.weightedValue)[0] || null;
  const byStage = {};
  for (const item of normalized) {
    const stage = normalizedText(String(item.stage || 'unassigned'), 'stage', 80);
    byStage[stage] = (byStage[stage] || 0) + item.weightedValue;
  }
  return Object.freeze({
    count: normalized.length,
    totalValue,
    weightedValue,
    coverageRatio: totalValue ? weightedValue / totalValue : 0,
    topOpportunity,
    byStage
  });
}

export function scoreBidOffer(input = {}) {
  assertPlainObject(input, 'Bid offer');
  const breakdown = Object.entries(BID_WEIGHTS).map(([key, weight]) => {
    const value = signal(input[key], key);
    return Object.freeze({ signal: key, value, weight, contribution: value * weight / 100 });
  });
  const deadlineRisk = signal(input.deadlineRisk, 'deadlineRisk');
  const positiveScore = breakdown.reduce((sum, item) => sum + item.contribution, 0);
  const score = Math.round(positiveScore - deadlineRisk * 0.10);
  const band = score >= 80 ? 'strong' : score >= 65 ? 'competitive' : 'weak';
  const strengths = breakdown.filter(item => item.value >= 80).map(item => item.signal);
  const risks = [];
  if (deadlineRisk >= 60) risks.push('deadline_risk');
  if (input.pricingCompetitiveness != null && signal(input.pricingCompetitiveness, 'pricingCompetitiveness') < 50) risks.push('pricing_risk');
  if (input.deliveryConfidence != null && signal(input.deliveryConfidence, 'deliveryConfidence') < 50) risks.push('delivery_risk');
  return Object.freeze({ score, band, deadlineRisk, strengths, risks, breakdown });
}

export function buildRevenueBoardroomSnapshot({ leads = [], opportunities = [], actions = [] } = {}) {
  if (!Array.isArray(leads) || leads.length > 500) fail('leads must contain at most 500 entries');
  if (!Array.isArray(actions) || actions.length > 500) fail('actions must contain at most 500 entries');
  const scored = leads.map((lead, index) => {
    assertPlainObject(lead, 'lead ' + (index + 1));
    const score = lead.score == null ? 0 : signal(lead.score, 'lead score');
    return { ...lead, score };
  });
  const pipeline = forecastPipeline({ opportunities });
  const urgentActions = actions.filter(action => String(action.priority || '').toLowerCase() === 'urgent');
  const recommendedActions = actions.slice().sort((a, b) => {
    const left = PRIORITY_RANK[String(a.priority || 'normal').toLowerCase()] ?? PRIORITY_RANK.normal;
    const right = PRIORITY_RANK[String(b.priority || 'normal').toLowerCase()] ?? PRIORITY_RANK.normal;
    return left - right;
  }).slice(0, 10);
  const riskFlags = [];
  if (urgentActions.length) riskFlags.push('urgent_actions_pending');
  if (scored.some(lead => lead.score < 40)) riskFlags.push('low_quality_leads_present');
  if (pipeline.count && pipeline.coverageRatio < 0.25) riskFlags.push('low_weighted_coverage');
  return Object.freeze({
    leads: {
      total: scored.length,
      hot: scored.filter(lead => lead.score >= 80).length,
      warm: scored.filter(lead => lead.score >= 60 && lead.score < 80).length,
      totalValue: scored.reduce((sum, lead) => sum + (Number(lead.value) || 0), 0)
    },
    pipeline,
    riskFlags,
    recommendedActions
  });
}

export const REVENUE_INTELLIGENCE_CONTRACT = Object.freeze({
  version: '1.0',
  purpose: 'Deterministic sales intelligence helpers for lead scoring, buying committees, next-best-action, forecasting, bid analysis and executive revenue views.',
  signals: Object.freeze({ ...LEAD_SIGNAL_WEIGHTS }),
  bidSignals: Object.freeze({ ...BID_WEIGHTS })
});
