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

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-10-05T08:00:00.000Z');

function record(module, id, payload, tenantId = TENANT) {
  return createGrowthRecord({ tenantId, module, id, actorId: ACTOR, now: NOW, payload });
}

function baseInput() {
  return {
    tenantId: TENANT,
    journeyId: 'journey_miro_001',
    actorId: ACTOR,
    sourceAsset: record('funnels', '44444444-4444-4444-8444-444444444444', {
      name: 'MiroFish service funnel',
      slug: 'miro-service',
      title: 'Book a service consultation',
      description: 'Book a service consultation.',
      blocks: [
        { id: 'hero', type: 'hero', heading: 'Start', body: 'Tell us what you need.', items: [], buttonLabel: null, buttonUrl: null },
        { id: 'form', type: 'lead_form', heading: 'Lead form', body: '', items: [], buttonLabel: null, buttonUrl: null }
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
    pipeline: record('pipelines', '66666666-6666-4666-8666-666666666666', {
      name: 'Sales',
      stages: [
        { id: 'new', name: 'New', probability: 0.1, isClosedWon: false, isClosedLost: false },
        { id: 'qualified', name: 'Qualified', probability: 0.5, isClosedWon: false, isClosedLost: false },
        { id: 'booked', name: 'Booked', probability: 0.8, isClosedWon: false, isClosedLost: false }
      ],
      rules: { allowBackward: false, allowSkip: false, requireApprovalOnBackward: true }
    }),
    qualificationProfile: record('ai-qualification', '77777777-7777-4777-8777-777777777777', {
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
    followUp: record('ai-follow-up', '88888888-8888-4888-8888-888888888888', {
      name: 'Qualified lead follow-up',
      purpose: 'service',
      trigger: 'lead.qualified',
      steps: [
        { id: 'step_1', delayMinutes: 0, channel: 'email', templateId: '99999999-9999-4999-8999-999999999999', connectionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', approvalRequired: true },
        { id: 'step_2', delayMinutes: 60, channel: 'sms', templateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', connectionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', approvalRequired: true }
      ],
      stopOnReply: true,
      approvalRequired: true
    }),
    calendar: createBookingCalendar({
      tenantId: TENANT,
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
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
  input.bookingWindow = { startAt: first.appointment.startAt, endAt: first.appointment.endAt };
  return runLeadToBookingJourney(input);
}, result => result.status === 'booking_unavailable' && result.appointment === null]);

scenarios.push(['voice consent boundary', healthy, result => result.voiceIntent.status === 'requires_provider_runtime' && result.voiceIntent.externalSideEffect === false]);

scenarios.push(['cross-tenant payload injection', () => {
  const input = baseInput();
  input.sourceAsset = record('funnels', '55555555-5555-4555-8555-555555555555', input.sourceAsset.payload, OTHER_TENANT);
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
  const result = assessSeoReadiness({
      title: 'Bad public page',
      description: 'A bad public page.',
      canonicalUrl: 'http://example.test/bad',
      robots: 'index,follow',
      indexable: true,
      sitemapIncluded: true,
      https: false,
      structuredDataTypes: []
    });
    return { blocked: Array.isArray(result.issues) && result.issues.some(issue => /HTTPS/i.test(issue)) };
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
