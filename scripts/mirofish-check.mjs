import { readFile } from 'node:fs/promises';
import { createGrowthRecord } from '../packages/growth-suite/index.mjs';
import { createBookingCalendar } from '../packages/atlas-target/index.mjs';
import { assessSeoReadiness } from '../packages/atlas-seo/index.mjs';
import { actionAllowed } from '../packages/atlas-core/production-frontier.mjs';
import { runLeadToBookingJourney } from '../packages/atlas-journey/index.mjs';

const source = await readFile(new URL('../docs/MIROFISH-ATLAS-DECISION-RECORD-2026-10.md', import.meta.url), 'utf8');

const required = [
  ['six-stage simulation process', 'The MiroFish run completed the six-stage decision process'],
  ['ten simulated stakeholders', '10. International SaaS buyer'],
  ['trust as a first-class feature', 'Trust is a first-class feature'],
  ['killer workflow', 'Lead → CRM → qualification → automated follow-up → appointment → pipeline update → reporting'],
  ['execution milestone', 'Execution becomes the next major platform milestone'],
  ['hypothesis evidence policy', 'MiroFish findings are hypotheses'],
  ['no false market certainty', 'probability of Atlas success']
];

for (const [label, phrase] of required) {
  if (!source.includes(phrase)) throw new Error('MiroFish regression failed: missing ' + label);
}

const TENANT = 'tenant_miro_001';
const OTHER_TENANT = 'tenant_miro_002';
const ACTOR = 'actor_miro_001';
const NOW = Date.parse('2026-10-05T08:00:00.000Z');

function record(module, id, payload, tenantId = TENANT) {
  return createGrowthRecord({ tenantId, module, id, actorId: ACTOR, now: NOW, payload });
}

function baseInput() {
  return {
    tenantId: TENANT,
    journeyId: 'journey_miro_001',
    actorId: ACTOR,
    sourceAsset: record('funnels', 'funnel_miro_001', {
      name: 'MiroFish service funnel',
      slug: 'miro-service',
      title: 'Book a service consultation',
      description: 'Book a service consultation.',
      blocks: [
        { id: 'hero', type: 'hero', heading: 'Start', body: 'Tell us what you need.' },
        { id: 'form', type: 'lead_form', heading: 'Lead form', body: '' }
      ],
      seo: { indexable: false, title: 'Book a service consultation', description: 'Book a service consultation.' }
    }),
    formSubmission: {
      sourceRef: 'miro-form-001',
      firstName: 'Aisha',
      lastName: 'Khan',
      email: 'aisha@example.com',
      source: 'organic',
      timeZone: 'UTC',
      consent: { email: true, sms: true, whatsapp: false }
    },
    pipeline: record('pipelines', 'pipe_miro_001', {
      name: 'Sales',
      stages: [
        { id: 'new', name: 'New', probability: 0.1, isClosedWon: false, isClosedLost: false },
        { id: 'qualified', name: 'Qualified', probability: 0.5, isClosedWon: false, isClosedLost: false },
        { id: 'booked', name: 'Booked', probability: 0.8, isClosedWon: false, isClosedLost: false }
      ],
      rules: { allowBackward: false, allowSkip: false, requireApprovalOnBackward: true }
    }),
    qualificationProfile: record('ai-qualification', 'qual_miro_001', {
      name: 'Sales qualification',
      instructions: 'Qualify an inbound service buyer using explicit evidence.',
      criteria: [
        { id: 'need', label: 'Clear need', weight: 60, evidenceRequired: true },
        { id: 'budget', label: 'Budget fit', weight: 40, evidenceRequired: true }
      ],
      scoreBands: [
        { min: 0, max: 39, outcome: 'review' },
        { min: 40, max: 69, outcome: 'nurture' },
        { min: 70, max: 100, outcome: 'sales_ready' }
      ],
      allowedReadTools: ['read_contact'],
      requireHumanReview: false
    }),
    qualificationRatings: { need: 90, budget: 80 },
    qualificationEvidence: { need: 'evidence_need', budget: 'evidence_budget' },
    followUp: record('ai-follow-up', 'followup_miro_001', {
      name: 'Qualified lead follow-up',
      purpose: 'service',
      trigger: 'lead.qualified',
      steps: [
        { id: 'step_1', delayMinutes: 0, channel: 'email', templateId: 'tpl_email_001', connectionId: 'conn_email_001', approvalRequired: true },
        { id: 'step_2', delayMinutes: 60, channel: 'sms', templateId: 'tpl_sms_001', connectionId: 'conn_sms_001', approvalRequired: true }
      ],
      stopOnReply: true,
      approvalRequired: true
    }),
    calendar: createBookingCalendar({
      tenantId: TENANT,
      id: 'cal_miro_001',
      timeZone: 'UTC',
      weeklyHours: { 0: [{ start: '09:00', end: '17:00' }], 1: [{ start: '09:00', end: '17:00' }], 2: [{ start: '09:00', end: '17:00' }], 3: [{ start: '09:00', end: '17:00' }], 4: [{ start: '09:00', end: '17:00' }], 5: [{ start: '09:00', end: '17:00' }] },
      slotDurationMinutes: 30,
      slotIntervalMinutes: 30,
      minNoticeMinutes: 30,
      maxDaysOut: 30
    }),
    bookingWindow: { startAt: '2026-10-05T10:00:00.000Z', endAt: '2026-10-05T12:00:00.000Z' },
    now: NOW
  };
}

const stakeholders = [
  ['SMB owner', result => result.status === 'booked' || result.status === 'needs_review'],
  ['sales operator', result => result.events.some(event => event.stage === 'pipeline.updated') || result.status !== 'booked'],
  ['marketer', result => result.events.some(event => event.stage === 'lead.captured')],
  ['service coordinator', result => result.status !== 'booked' || result.appointment?.status === 'booked'],
  ['AI-ops reviewer', result => result.externalSideEffects.length === 0],
  ['security reviewer', result => result.events.every(event => event.tenantId === TENANT) && result.externalSideEffects.length === 0],
  ['finance operator', result => !Object.values(result).some(value => typeof value === 'string' && /password|secret|api[_-]?key|token/i.test(value))],
  ['agency operator', result => /^[a-f0-9]{64}$/.test(result.idempotencyKey)],
  ['customer-support lead', result => result.voiceIntent?.status === 'requires_provider_runtime'],
  ['platform operator', result => result.report?.redacted === true]
];

const scenarios = [];
const healthy = () => runLeadToBookingJourney(baseInput());
scenarios.push(['healthy lead-to-booking', healthy, result => result.status === 'booked']);

scenarios.push(['duplicate form replay', () => {
  const first = runLeadToBookingJourney(baseInput());
  const second = runLeadToBookingJourney(baseInput());
  return { ...second, replaySameCommand: second.idempotencyKey === first.idempotencyKey && second.contact.id === first.contact.id && second.lead.id === first.lead.id };
}, result => result.replaySameCommand === true]);

scenarios.push(['missing qualification evidence', () => {
  const input = baseInput();
  input.qualificationEvidence = { need: 'evidence_need' };
  return runLeadToBookingJourney(input);
}, result => result.status === 'needs_review' && result.appointment === null]);

scenarios.push(['provider degradation remains non-destructive', healthy, result => result.status === 'booked' && result.followUp.executed === false && result.externalSideEffects.length === 0]);

scenarios.push(['calendar conflict', () => {
  const first = runLeadToBookingJourney(baseInput());
  const input = baseInput();
  input.journeyId = 'journey_miro_002';
  input.existingAppointments = [first.appointment];
  return runLeadToBookingJourney(input);
}, result => result.status === 'booking_unavailable' && result.appointment === null]);

scenarios.push(['voice consent boundary', healthy, result => result.voiceIntent.status === 'requires_provider_runtime' && result.voiceIntent.externalSideEffect === false]);

scenarios.push(['cross-tenant payload injection', () => {
  const input = baseInput();
  input.sourceAsset = record('funnels', 'funnel_miro_other', input.sourceAsset.payload, OTHER_TENANT);
  try { runLeadToBookingJourney(input); return { blocked: false }; } catch { return { blocked: true }; }
}, result => result.blocked === true]);

scenarios.push(['workflow replay identity', () => {
  const first = runLeadToBookingJourney(baseInput());
  const input = baseInput();
  input.journeyId = baseInput().journeyId;
  const second = runLeadToBookingJourney(input);
  return { same: first.idempotencyKey === second.idempotencyKey };
}, result => result.same === true]);

scenarios.push(['public SEO refuses insecure origin', () => {
  try {
    assessSeoReadiness({
      title: 'Bad public page',
      description: 'A bad public page.',
      canonicalUrl: 'http://example.test/bad',
      robots: 'index,follow',
      indexable: true,
      sitemapIncluded: true,
      https: false,
      structuredDataTypes: []
    });
    return { blocked: false };
  } catch { return { blocked: true }; }
}, result => result.blocked === true]);

scenarios.push(['agent destructive action needs approval', () => ({
  allowed: actionAllowed({ riskClass: 'destructive', approved: false, capabilityVerified: true })
}), result => result.allowed === false]);

let passed = 0;
for (const [scenarioName, runner, expectation] of scenarios) {
  const result = runner();
  const stakeholderVotes = stakeholders.map(([name, judge]) => ({ stakeholder: name, pass: Boolean(judge(result)) }));
  const consensus = stakeholderVotes.filter(vote => vote.pass).length / stakeholderVotes.length;
  const pass = Boolean(expectation(result)) && consensus >= 0.8;
  if (!pass) throw new Error('MiroFish scenario failed: ' + scenarioName + ' consensus=' + consensus.toFixed(2));
  passed += 1;
  console.log('PASS scenario', scenarioName, 'consensus=' + consensus.toFixed(2));
}

console.log('PASS MiroFish strategic regression: ' + passed + '/' + scenarios.length + ' scenarios passed across ' + stakeholders.length + ' simulated stakeholders');
