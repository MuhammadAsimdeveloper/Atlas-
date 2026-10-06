import crypto from 'node:crypto';
import { verifyVoiceCallSession, VOICE_CALL_OUTCOMES } from '../customer-operations/voice-operations.mjs';

const REF=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const ref=(value,label)=>{if(typeof value!=='string'||!REF.test(value))throw new TypeError(label+' must be a bounded reference');return value;};

export function mapVoiceOutcomeToWorkflowEvent({ outcome, voiceSessionRef, contactRef, appointmentRef = null } = {}) {
  if(!VOICE_CALL_OUTCOMES.includes(outcome)) throw new TypeError('voice outcome is unsupported');
  ref(voiceSessionRef,'voiceSessionRef'); ref(contactRef,'contactRef');
  if(appointmentRef!==null) ref(appointmentRef,'appointmentRef');
  const mapped = {
    appointment_booked:'voice.appointment_booked',
    qualified:'voice.qualified',
    follow_up_required:'voice.follow_up_required',
    resolved:'voice.resolved',
    transferred:'voice.transferred',
    voicemail:'voice.voicemail',
    spam:'voice.spam',
    other:'voice.other'
  }[outcome];
  return Object.freeze({
    type:mapped, voiceSessionRef, contactRef,
    ...(appointmentRef===null?{}:{appointmentRef})
  });
}

export function buildVoiceInboxOutcome({
  tenantId, voiceSession, contactRef, conversationRef, outcome, handoffQueueRef = null, eventRef, now = Date.now()
} = {}) {
  ref(tenantId,'tenantId'); ref(contactRef,'contactRef'); ref(conversationRef,'conversationRef'); ref(eventRef,'eventRef');
  if(!verifyVoiceCallSession(voiceSession) || voiceSession.tenantId!==tenantId) throw new Error('Voice session tenant or integrity check failed');
  if(voiceSession.contactRef!==contactRef || voiceSession.conversationRef!==conversationRef) throw new Error('Voice conversation/contact reference mismatch');
  if(!VOICE_CALL_OUTCOMES.includes(outcome)) throw new TypeError('voice outcome is unsupported');
  if(handoffQueueRef!==null) ref(handoffQueueRef,'handoffQueueRef');
  if(outcome==='transferred' && !handoffQueueRef) throw new Error('Transferred voice outcomes require a handoff queue');
  const occurredAt = typeof now==='number' ? now : Date.parse(now);
  if(!Number.isFinite(occurredAt)) throw new TypeError('now must be a valid timestamp');
  const body = {
    type: outcome==='transferred'?'conversation.voice_handoff':'conversation.voice_outcome',
    tenantId, voiceSessionRef:voiceSession.id, contactRef, conversationRef, outcome,
    ...(handoffQueueRef===null?{}:{queueRef:handoffQueueRef}),
    eventRef, occurredAt:new Date(occurredAt).toISOString(), redacted:true
  };
  return Object.freeze({ ...body, idempotencyKey:sha({tenantId,voiceSessionRef:voiceSession.id,eventRef,outcome,contactRef,conversationRef}) });
}

export function planVoiceAgentJourney({
  tenantId, journeyId, voiceSession, contactRef, conversationRef, leadRef = null,
  appointmentRef = null, workflowId, workflowVersion, outcome, eventRef, handoffQueueRef = null, now = Date.now()
} = {}) {
  ref(tenantId,'tenantId'); ref(journeyId,'journeyId'); ref(workflowId,'workflowId'); ref(eventRef,'eventRef');
  ref(contactRef,'contactRef'); ref(conversationRef,'conversationRef');
  if(leadRef!==null) ref(leadRef,'leadRef');
  if(appointmentRef!==null) ref(appointmentRef,'appointmentRef');
  if(!verifyVoiceCallSession(voiceSession) || voiceSession.tenantId!==tenantId) throw new Error('Voice session tenant or integrity check failed');
  if(voiceSession.contactRef!==contactRef || voiceSession.conversationRef!==conversationRef) throw new Error('Voice session does not match journey contact/conversation');
  if(!VOICE_CALL_OUTCOMES.includes(outcome)) throw new TypeError('voice outcome is unsupported');
  if(voiceSession.callOutcome!==outcome || voiceSession.status!=='completed') throw new Error('Voice session must be completed with the same outcome before reconciliation');
  if(outcome==='appointment_booked') {
    if(!appointmentRef || voiceSession.appointmentRef!==appointmentRef) throw new Error('Appointment evidence does not match the completed voice session');
  } else if(appointmentRef!==null && voiceSession.appointmentRef!==appointmentRef) throw new Error('Appointment reference mismatch');
  const event = mapVoiceOutcomeToWorkflowEvent({outcome,voiceSessionRef:voiceSession.id,contactRef,appointmentRef});
  const inbox = buildVoiceInboxOutcome({tenantId,voiceSession,contactRef,conversationRef,outcome,handoffQueueRef,eventRef,now});
  const workflowEvent = Object.freeze({
    ...event,
    journeyId, workflowId, workflowVersion, eventRef,
    ...(leadRef===null?{}:{leadRef}),
    redacted:true
  });
  const snapshot = {
    tenantId, journeyId, voiceSessionRef:voiceSession.id, contactRef, conversationRef, leadRef, appointmentRef,
    workflowId, workflowVersion, outcome, inboxOutcome:inbox, workflowEvent
  };
  return Object.freeze({
    status:'reconciled',
    ...snapshot,
    idempotencyKey:sha({tenantId,journeyId,voiceSessionRef:voiceSession.id,eventRef,outcome}),
    redacted:true
  });
}
