import crypto from 'node:crypto';
import {
  createGrowthRecord,
  verifyGrowthRecord,
  updateGrowthRecord,
  scoreLeadQualification,
  planLeadStageMove
} from '../growth-suite/index.mjs';
import {
  verifyBookingCalendar,
  listAvailableSlots,
  holdBooking,
  bookAppointment
} from '../atlas-target/index.mjs';

const REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,119}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HASH = /^[a-f0-9]{64}$/;

const STAGES = Object.freeze([
  'lead.captured',
  'lead.qualified',
  'followup.planned',
  'appointment.booked',
  'pipeline.updated',
  'journey.reported'
]);

function ref(value, label) {
  if (typeof value !== 'string' || !REF.test(value)) throw new TypeError(label + ' must be a bounded reference');
  return value;
}

function text(value, label, max = 500, { empty = false } = {}) {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\r\n\u0000]/.test(value)) throw new TypeError(label + ' must be bounded text');
  return value.trim();
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function digestPrefix(value, prefix) {
  const digest = hash(value).slice(0, 32);
  const versioned = digest.slice(0, 12) + '-4' + digest.slice(13, 16) + '-8' + digest.slice(17, 20) + '-' + digest.slice(20, 32);
  return prefix + versioned;
}

function deterministicUuid(value) {
  const digest = hash(value).slice(0, 32);
  return digest.slice(0, 8) + '-' + digest.slice(8, 12) + '-4' + digest.slice(13, 16) + '-8' + digest.slice(17, 20) + '-' + digest.slice(20, 32);
}

function assertGrowth(record, tenantId, module, label) {
  if (!verifyGrowthRecord(record) || record.tenantId !== tenantId || record.module !== module) {
    throw new Error(label + ' tenant, module or checksum is invalid');
  }
}

function assertSourceAsset(sourceAsset, tenantId) {
  if (!sourceAsset) throw new Error('A funnel or website source asset is required');
  if (!verifyGrowthRecord(sourceAsset) || sourceAsset.tenantId !== tenantId || !['funnels', 'websites'].includes(sourceAsset.module)) {
    throw new Error('Source asset tenant or checksum is invalid');
  }
  const hasForm = Array.isArray(sourceAsset.payload?.blocks) && sourceAsset.payload.blocks.some(block => block?.type === 'lead_form');
  if (!hasForm) throw new Error('Source asset must contain an Atlas lead form');
  return sourceAsset;
}

function normalizeSubmission(submission) {
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) throw new TypeError('Form submission is required');
  const firstName = text(submission.firstName, 'firstName', 80);
  const lastName = submission.lastName == null ? '' : text(submission.lastName, 'lastName', 80, { empty: true });
  const email = submission.email == null ? null : text(submission.email, 'email', 254).toLowerCase();
  const phone = submission.phone == null ? null : text(submission.phone, 'phone', 18);
  if (email && !EMAIL.test(email)) throw new TypeError('email is invalid');
  if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) throw new TypeError('phone must be E.164');
  if (!email && !phone) throw new TypeError('form submission needs an email or phone');
  const sourceRef = text(submission.sourceRef, 'sourceRef', 180);
  const source = submission.source == null ? 'website' : text(submission.source, 'source', 120);
  const timeZone = submission.timeZone == null ? 'UTC' : text(submission.timeZone, 'timeZone', 80);
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(); } catch { throw new TypeError('timeZone must be an IANA time zone'); }
  const consent = submission.consent ?? { email: false, sms: false, whatsapp: false };
  if (!consent || typeof consent !== 'object' || ['email','sms','whatsapp'].some(k => typeof consent[k] !== 'boolean')) throw new TypeError('consent must explicitly define email, sms and whatsapp');
  return { firstName, lastName, email, phone, company: submission.company ? text(submission.company, 'company', 120) : null, sourceRef, source, timeZone, consent };
}

function pickStage(pipeline, id, label) {
  const stage = pipeline.payload.stages.find(item => item.id === id);
  if (!stage) throw new Error('Pipeline ' + label + ' stage does not exist');
  return stage;
}

function redactedEvent({ tenantId, journeyId, stage, refs, reason = null }) {
  return Object.freeze({
    tenantId,
    journeyId,
    stage,
    refs: Object.fromEntries(Object.entries(refs || {}).filter(([, value]) => value != null)),
    reason
  });
}

function validateFollowUp(followUp, tenantId) {
  assertGrowth(followUp, tenantId, 'ai-follow-up', 'Follow-up');
  const steps = followUp.payload?.steps;
  if (!Array.isArray(steps) || steps.length < 1) throw new Error('Follow-up must contain at least one step');
  return steps.map(step => ({
    id: step.id,
    delayMinutes: step.delayMinutes,
    channel: step.channel,
    templateId: step.templateId,
    connectionId: step.connectionId,
    approvalRequired: step.approvalRequired !== false,
    idempotencyKey: hash({ tenantId, followUpId: followUp.id, stepId: step.id })
  }));
}

function voiceIntent({ tenantId, journeyId, contactId, appointmentRef }) {
  const id = digestPrefix({ tenantId, journeyId, contactId }, 'voice_');
  return Object.freeze({
    id,
    tenantId,
    journeyId,
    contactRef: contactId,
    conversationRef: digestPrefix({ tenantId, contactId }, 'conv_'),
    purpose: 'appointment',
    status: 'requires_provider_runtime',
    appointmentRef,
    externalSideEffect: false,
    reason: 'Voice provider credentials, callback verification and outbound consent evidence are required before a call can execute.'
  });
}

export function runLeadToBookingJourney({
  tenantId,
  journeyId,
  actorId,
  sourceAsset,
  formSubmission,
  pipeline,
  qualificationProfile,
  qualificationRatings,
  qualificationEvidence,
  followUp,
  calendar,
  existingAppointments = [],
  bookingWindow,
  appointmentIdempotencyKey = null,
  now = Date.now()
} = {}) {
  ref(tenantId, 'tenantId');
  ref(journeyId, 'journeyId');
  ref(actorId, 'actorId');
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new TypeError('now must be a valid timestamp');

  assertSourceAsset(sourceAsset, tenantId);
  assertGrowth(pipeline, tenantId, 'pipelines', 'Pipeline');
  assertGrowth(qualificationProfile, tenantId, 'ai-qualification', 'Qualification profile');
  const submission = normalizeSubmission(formSubmission);
  const followUpActions = validateFollowUp(followUp, tenantId);
  if (!verifyBookingCalendar(calendar) || calendar.tenantId !== tenantId) throw new Error('Calendar tenant or checksum is invalid');

  const idBase = { tenantId, journeyId, sourceRef: submission.sourceRef };
  const contactId = deterministicUuid({ ...idBase, kind: 'contact' });
  const leadId = deterministicUuid({ ...idBase, kind: 'lead' });
  const idempotencyKey = appointmentIdempotencyKey && HASH.test(appointmentIdempotencyKey)
    ? appointmentIdempotencyKey
    : hash({ tenantId, journeyId, sourceRef: submission.sourceRef });

  const firstStage = pipeline.payload.stages[0];
  pickStage(pipeline, firstStage.id, 'initial');

  const contact = createGrowthRecord({
    tenantId,
    module: 'contacts',
    id: contactId,
    actorId,
    now,
    payload: {
      firstName: submission.firstName,
      lastName: submission.lastName,
      email: submission.email,
      phone: submission.phone,
      company: submission.company,
      source: submission.source,
      tags: ['atlas_journey'],
      timeZone: submission.timeZone,
      consent: submission.consent
    }
  });

  let lead = createGrowthRecord({
    tenantId,
    module: 'leads',
    id: leadId,
    actorId,
    now,
    payload: {
      contactId: contact.id,
      pipelineId: pipeline.id,
      stageId: firstStage.id,
      status: 'new',
      source: submission.source,
      score: 0,
      valueMinor: 0,
      currency: 'USD',
      assignedTo: null,
      qualification: {
        status: 'not_run',
        score: null,
        reasonCodes: [],
        evidenceRefs: [],
        evaluatedAt: null,
        releaseRef: null
      }
    }
  });

  const events = [redactedEvent({
    tenantId, journeyId, stage: STAGES[0],
    refs: { contactRef: contact.id, leadRef: lead.id, sourceRef: submission.sourceRef }
  })];

  const qualification = scoreLeadQualification({
    profile: qualificationProfile.payload,
    ratings: qualificationRatings,
    evidenceRefs: qualificationEvidence,
    now
  });

  lead = updateGrowthRecord({
    record: lead,
    tenantId,
    actorId,
    expectedVersion: lead.version,
    now,
    payload: {
      ...lead.payload,
      status: qualification.outcome === 'sales_ready' ? 'qualified' : qualification.status === 'needs_review' ? 'working' : 'working',
      score: qualification.score,
      qualification: {
        status: qualification.status,
        score: qualification.score,
        reasonCodes: qualification.reasonCodes,
        evidenceRefs: qualification.evidenceRefs,
        evaluatedAt: qualification.evaluatedAt,
        releaseRef: qualificationProfile.id
      }
    }
  });

  events.push(redactedEvent({
    tenantId, journeyId, stage: STAGES[1],
    refs: { leadRef: lead.id, qualificationRef: qualificationProfile.id },
    reason: qualification.outcome
  }));

  if (qualification.status !== 'ready' || qualification.outcome !== 'sales_ready') {
    return {
      status: 'needs_review',
      tenantId,
      journeyId,
      idempotencyKey,
      contact,
      lead,
      qualification,
      followUp: { actions: [], executed: false, blockedReason: 'Qualification did not reach sales_ready.' },
      appointment: null,
      voiceIntent: voiceIntent({ tenantId, journeyId, contactId: contact.id, appointmentRef: null }),
      events,
      externalSideEffects: [],
      report: {
        outcome: 'needs_review',
        conversion: { captured: 1, qualified: 0, booked: 0, rate: 0 },
        stages: events.map(event => event.stage),
        redacted: true
      }
    };
  }

  events.push(redactedEvent({
    tenantId, journeyId, stage: STAGES[2],
    refs: { leadRef: lead.id, followUpRef: followUp.id }
  }));

  const qualifyingStage = pipeline.payload.stages.find(stage => stage.id === 'qualified') || pipeline.payload.stages.find((stage, index) => index === 1);
  if (qualifyingStage) {
    pickStage(pipeline, qualifyingStage.id, 'qualification');
    const move = planLeadStageMove({ lead, pipeline, stageId: qualifyingStage.id });
    if (move.changed) lead = updateGrowthRecord({
      record: lead,
      tenantId,
      actorId,
      expectedVersion: lead.version,
      now,
      payload: { ...lead.payload, stageId: move.stageId, status: move.status }
    });
  }

  const rangeStart = text(bookingWindow?.startAt, 'bookingWindow.startAt', 80);
  const rangeEnd = text(bookingWindow?.endAt, 'bookingWindow.endAt', 80);
  const slots = listAvailableSlots({
    calendar,
    existingBookings: existingAppointments,
    startAt: rangeStart,
    endAt: rangeEnd,
    limit: 1,
    now
  });

  if (!slots.length) {
    return {
      status: 'booking_unavailable',
      tenantId,
      journeyId,
      idempotencyKey,
      contact,
      lead,
      qualification,
      followUp: { actions: followUpActions, executed: false, blockedReason: 'No calendar slot is currently available.' },
      appointment: null,
      voiceIntent: voiceIntent({ tenantId, journeyId, contactId: contact.id, appointmentRef: null }),
      events,
      externalSideEffects: [],
      report: {
        outcome: 'booking_unavailable',
        conversion: { captured: 1, qualified: 1, booked: 0, rate: 0 },
        stages: events.map(event => event.stage),
        redacted: true
      }
    };
  }

  const hold = holdBooking({
    calendar,
    existingBookings: existingAppointments,
    startAt: rangeStart,
    endAt: rangeEnd,
    contactRef: contact.id,
    idempotencyKey: hash({ tenantId, journeyId, action: 'hold' }),
    now
  });
  if (hold.status !== 'held') throw new Error('Calendar slot disappeared while creating the hold');

  const booked = bookAppointment({
    calendar,
    appointments: existingAppointments,
    hold: hold.hold,
    contactRef: contact.id,
    idempotencyKey,
    now
  });
  if (booked.status !== 'booked' && booked.status !== 'idempotent') throw new Error('Appointment booking failed');

  const appointment = booked.appointment;
  const bookedStage = pipeline.payload.stages.find(stage => stage.id === 'booked') || qualifyingStage;
  if (bookedStage && bookedStage.id !== lead.payload.stageId) {
    const move = planLeadStageMove({ lead, pipeline, stageId: bookedStage.id });
    if (move.changed) lead = updateGrowthRecord({
      record: lead,
      tenantId,
      actorId,
      expectedVersion: lead.version,
      now,
      payload: { ...lead.payload, stageId: move.stageId, status: move.status }
    });
  }

  events.push(
    redactedEvent({ tenantId, journeyId, stage: STAGES[3], refs: { appointmentRef: appointment.id, contactRef: contact.id } }),
    redactedEvent({ tenantId, journeyId, stage: STAGES[4], refs: { leadRef: lead.id, pipelineRef: pipeline.id, stageRef: lead.payload.stageId } }),
    redactedEvent({ tenantId, journeyId, stage: STAGES[5], refs: { contactRef: contact.id, leadRef: lead.id, appointmentRef: appointment.id } })
  );

  return {
    status: 'booked',
    tenantId,
    journeyId,
    idempotencyKey,
    contact,
    lead,
    qualification,
    followUp: { actions: followUpActions, executed: false, blockedReason: 'External message providers must be configured and verified before delivery.' },
    appointment,
    voiceIntent: voiceIntent({ tenantId, journeyId, contactId: contact.id, appointmentRef: appointment.id }),
    events,
    externalSideEffects: [],
    report: {
      outcome: 'booked',
      conversion: { captured: 1, qualified: 1, booked: 1, rate: 1 },
      stages: events.map(event => event.stage),
      sourceAssetRef: sourceAsset.id,
      redacted: true
    }
  };
}
