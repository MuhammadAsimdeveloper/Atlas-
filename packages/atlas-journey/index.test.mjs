import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrowthRecord, scoreLeadQualification } from '../growth-suite/index.mjs';
import { createBookingCalendar } from '../atlas-target/index.mjs';
import { runLeadToBookingJourney } from './index.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-10-05T08:00:00.000Z');

function pipelineRecord(tenantId = TENANT) {
  return createGrowthRecord({
    tenantId,
    module: 'pipelines',
    id: '44444444-4444-4444-8444-444444444444',
    actorId: ACTOR,
    now: NOW,
    payload: {
      name: 'Sales',
      stages: [
        { id: 'new', name: 'New', probability: 0.1, isClosedWon: false, isClosedLost: false },
        { id: 'qualified', name: 'Qualified', probability: 0.5, isClosedWon: false, isClosedLost: false },
        { id: 'booked', name: 'Booked', probability: 0.8, isClosedWon: false, isClosedLost: false },
        { id: 'won', name: 'Won', probability: 1, isClosedWon: true, isClosedLost: false }
      ],
      rules: { allowBackward: false, allowSkip: false, requireApprovalOnBackward: true }
    }
  });
}

function qualificationProfile() {
  return createGrowthRecord({
    tenantId: TENANT,
    module: 'ai-qualification',
    id: '55555555-5555-4555-8555-555555555555',
    actorId: ACTOR,
    now: NOW,
    payload: {
      name: 'Sales qualification',
      instructions: 'Qualify an inbound service buyer using explicit evidence.',
      criteria: [
        { id: 'need', label: 'Clear business need', weight: 60, evidenceRequired: true },
        { id: 'budget', label: 'Budget fit', weight: 40, evidenceRequired: true }
      ],
      scoreBands: [
        { min: 0, max: 39, outcome: 'review' },
        { min: 40, max: 69, outcome: 'nurture' },
        { min: 70, max: 100, outcome: 'sales_ready' }
      ],
      allowedReadTools: ['read_contact'],
      requireHumanReview: false
    }
  });
}

function followUpRecord() {
  return createGrowthRecord({
    tenantId: TENANT,
    module: 'ai-follow-up',
    id: '66666666-6666-4666-8666-666666666666',
    actorId: ACTOR,
    now: NOW,
    payload: {
      name: 'Qualified lead follow-up',
      purpose: 'service',
      trigger: 'lead.qualified',
      steps: [
        { id: 'step_1', delayMinutes: 0, channel: 'email', templateId: '77777777-7777-4777-8777-777777777777', connectionId: '99999999-9999-4999-8999-999999999999', approvalRequired: true },
        { id: 'step_2', delayMinutes: 60, channel: 'sms', templateId: '88888888-8888-4888-8888-888888888888', connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', approvalRequired: true }
      ],
      stopOnReply: true,
      approvalRequired: true
    }
  });
}

function funnelRecord(tenantId = TENANT) {
  return createGrowthRecord({
    tenantId,
    module: 'funnels',
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    actorId: ACTOR,
    now: NOW,
    payload: {
      name: 'Service lead page',
      slug: 'service-lead',
      title: 'Book a service consultation',
      description: 'Tell us what you need and book a time.',
      blocks: [
        { id: 'hero', type: 'hero', heading: 'Get help', body: 'Talk to our team.' },
        { id: 'form', type: 'lead_form', heading: 'Start here', body: '' }
      ],
      seo: { indexable: false, title: 'Book a service consultation', description: 'Book a service consultation.' }
    }
  });
}

function calendar() {
  return createBookingCalendar({
    tenantId: TENANT,
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    version: 1,
    timeZone: 'UTC',
    weeklyHours: {
      0: [{ start: '09:00', end: '17:00' }],
      1: [{ start: '09:00', end: '17:00' }],
      2: [{ start: '09:00', end: '17:00' }],
      3: [{ start: '09:00', end: '17:00' }],
      4: [{ start: '09:00', end: '17:00' }],
      5: [{ start: '09:00', end: '17:00' }],
      6: []
    },
    slotDurationMinutes: 30,
    slotIntervalMinutes: 30,
    minNoticeMinutes: 30,
    maxDaysOut: 30
  });
}

function input() {
  return {
    tenantId: TENANT,
    journeyId: 'journey_001',
    actorId: ACTOR,
    sourceAsset: funnelRecord(),
    formSubmission: { sourceRef: 'form-submit-001', firstName: 'Aisha', lastName: 'Khan', email: 'aisha@example.com', source: 'organic', timeZone: 'UTC', consent: { email: true, sms: true, whatsapp: false } },
    pipeline: pipelineRecord(),
    qualificationProfile: qualificationProfile(),
    qualificationRatings: { need: 90, budget: 80 },
    qualificationEvidence: { need: 'evidence_ref_need', budget: 'evidence_ref_budget' },
    followUp: followUpRecord(),
    calendar: calendar(),
    bookingWindow: { startAt: '2026-10-05T10:00:00.000Z', endAt: '2026-10-05T12:00:00.000Z' },
    now: NOW
  };
}

test('V145 flagship journey connects funnel -> CRM -> qualification -> follow-up -> calendar -> pipeline -> report', () => {
  const result = runLeadToBookingJourney(input());
  assert.equal(result.status, 'booked');
  assert.equal(result.tenantId, TENANT);
  assert.equal(result.contact.module, 'contacts');
  assert.match(result.contact.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(result.lead.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(result.lead.payload.pipelineId, '44444444-4444-4444-8444-444444444444');
  assert.equal(result.lead.module, 'leads');
  assert.equal(result.lead.payload.qualification.status, 'ready');
  assert.equal(result.followUp.actions.length, 2);
  assert.equal(result.appointment.status, 'booked');
  assert.equal(result.lead.payload.stageId, 'booked');
  assert.equal(result.report.conversion.booked, 1);
  assert.equal(result.report.conversion.rate, 1);
  assert.match(result.idempotencyKey, /^[a-f0-9]{64}$/);
  assert.ok(result.events.every(event => event.tenantId === TENANT));
  assert.equal(result.externalSideEffects.length, 0);
});

test('V145 replay preserves the same command identities', () => {
  const first = runLeadToBookingJourney(input());
  const second = runLeadToBookingJourney(input());
  assert.equal(second.idempotencyKey, first.idempotencyKey);
  assert.equal(second.contact.id, first.contact.id);
  assert.equal(second.lead.id, first.lead.id);
  assert.equal(second.appointment.idempotencyKey, first.appointment.idempotencyKey);
  assert.equal(second.voiceIntent.id, first.voiceIntent.id);
});

test('V145 blocks cross-tenant funnel references', () => {
  const data = input();
  data.sourceAsset = funnelRecord(OTHER_TENANT);
  assert.throws(() => runLeadToBookingJourney(data), /tenant|scope/i);
});

test('V145 never converts missing qualification evidence into an autonomous sale', () => {
  const data = input();
  data.qualificationRatings = { need: 90, budget: 80 };
  data.qualificationEvidence = { need: 'evidence_ref_need' };
  const result = runLeadToBookingJourney(data);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.appointment, null);
  assert.equal(result.lead.payload.qualification.status, 'needs_review');
  assert.equal(result.externalSideEffects.length, 0);
});

test('V145 fails closed when the funnel has no Atlas lead form', () => {
  const data = input();
  data.sourceAsset = createGrowthRecord({
    tenantId: TENANT,
    module: 'websites',
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    actorId: ACTOR,
    now: NOW,
    payload: {
      name: 'No form page',
      slug: 'no-form',
      title: 'No form',
      description: 'No form.',
      blocks: [{ id: 'hero', type: 'hero', heading: 'Hello', body: 'No form.', items: [], buttonLabel: null, buttonUrl: null }],
      seo: { indexable: false, title: 'No form', description: 'No form.' }
    }
  });
  assert.throws(() => runLeadToBookingJourney(data), /lead form/i);
});

test('V145 uses the booking layer for conflicts instead of bypassing availability', () => {
  const data = input();
  const occupied = runLeadToBookingJourney(data);
  const conflictInput = input();
  conflictInput.journeyId = 'journey_002';
  conflictInput.existingAppointments = [occupied.appointment];
  const result = runLeadToBookingJourney(conflictInput);
  assert.equal(result.status, 'booking_unavailable');
  assert.equal(result.appointment, null);
  assert.equal(result.lead.payload.stageId, 'qualified');
});
