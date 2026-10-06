import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { planVoiceAgentJourney, mapVoiceOutcomeToWorkflowEvent, buildVoiceInboxOutcome } from './index.mjs';

const TENANT='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const CONTACT='33333333-3333-4333-8333-333333333333';
const CONVERSATION='44444444-4444-4444-8444-444444444444';
const VOICE='55555555-5555-4555-8555-555555555555';
const APPOINTMENT='66666666-6666-4666-8666-666666666666';
const LEAD='77777777-7777-4777-8777-777777777777';
const WORKFLOW='88888888-8888-4888-8888-888888888888';
const NOW=Date.parse('2026-10-06T08:00:00.000Z');

function canonical(value){
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
function seal(session){
  const digest=crypto.createHash('sha256').update(JSON.stringify(canonical(session))).digest('hex');
  return {...session,checksum:digest};
}
function voiceSession(tenantId=TENANT){
  return seal({
    id:VOICE,tenantId,contactRef:CONTACT,conversationRef:CONVERSATION,
    direction:'outbound',providerConnectionRef:'provider_twilio_001',providerCallRef:'CAopaque123',
    status:'completed',currentAgentRelease:{agentId:'99999999-9999-4999-8999-999999999999',releaseId:'agent-release-147',version:4,checksum:'a'.repeat(64)},
    appointmentRef:APPOINTMENT,callOutcome:'appointment_booked',idempotencyKey:'b'.repeat(64),
    eventRefs:['voice-event-001'],events:[],agentReleaseChain:[],agentTransferCount:0,version:3,
    createdAt:new Date(NOW-60000).toISOString(),updatedAt:new Date(NOW).toISOString()
  });
}

test('V148 voice journey connects voice -> conversation -> CRM -> appointment -> workflow with redacted outcome', () => {
  const result=planVoiceAgentJourney({
    tenantId:TENANT,journeyId:'journey_v148_001',voiceSession:voiceSession(),contactRef:CONTACT,conversationRef:CONVERSATION,
    leadRef:LEAD,appointmentRef:APPOINTMENT,workflowId:WORKFLOW,workflowVersion:3,outcome:'appointment_booked',eventRef:'voice-outcome-001',now:NOW
  });
  assert.equal(result.status,'reconciled');
  assert.equal(result.voiceSessionRef,VOICE);
  assert.equal(result.conversationRef,CONVERSATION);
  assert.equal(result.contactRef,CONTACT);
  assert.equal(result.appointmentRef,APPOINTMENT);
  assert.equal(result.workflowEvent.type,'voice.appointment_booked');
  assert.equal(result.workflowEvent.workflowId,WORKFLOW);
  assert.equal(result.workflowEvent.workflowVersion,3);
  assert.equal(result.redacted,true);
  assert.equal('transcript' in result,false);
  assert.equal('recordingRef' in result,false);
});

test('V148 outcome mapping is explicit and does not copy call content', () => {
  assert.deepEqual(mapVoiceOutcomeToWorkflowEvent({outcome:'appointment_booked',voiceSessionRef:VOICE,contactRef:CONTACT,appointmentRef:APPOINTMENT}),{
    type:'voice.appointment_booked',voiceSessionRef:VOICE,contactRef:CONTACT,appointmentRef:APPOINTMENT
  });
  assert.equal(mapVoiceOutcomeToWorkflowEvent({outcome:'qualified',voiceSessionRef:VOICE,contactRef:CONTACT}).type,'voice.qualified');
  assert.throws(()=>mapVoiceOutcomeToWorkflowEvent({outcome:'unknown_outcome',voiceSessionRef:VOICE,contactRef:CONTACT}),/outcome/i);
});

test('V148 appointment-booked outcome fails closed when appointment does not match voice session', () => {
  assert.throws(()=>planVoiceAgentJourney({
    tenantId:TENANT,journeyId:'journey_v148_002',voiceSession:voiceSession(),contactRef:CONTACT,conversationRef:CONVERSATION,
    leadRef:LEAD,appointmentRef:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',workflowId:WORKFLOW,workflowVersion:3,outcome:'appointment_booked',eventRef:'voice-outcome-002',now:NOW
  }),/appointment|mismatch/i);
});

test('V148 tenant injection and duplicate event replay are rejected deterministically', () => {
  const result=planVoiceAgentJourney({
    tenantId:TENANT,journeyId:'journey_v148_003',voiceSession:voiceSession(),contactRef:CONTACT,conversationRef:CONVERSATION,
    leadRef:LEAD,appointmentRef:APPOINTMENT,workflowId:WORKFLOW,workflowVersion:3,outcome:'appointment_booked',eventRef:'voice-outcome-003',now:NOW
  });
  assert.equal(result.idempotencyKey,planVoiceAgentJourney({
    tenantId:TENANT,journeyId:'journey_v148_003',voiceSession:voiceSession(),contactRef:CONTACT,conversationRef:CONVERSATION,
    leadRef:LEAD,appointmentRef:APPOINTMENT,workflowId:WORKFLOW,workflowVersion:3,outcome:'appointment_booked',eventRef:'voice-outcome-003',now:NOW
  }).idempotencyKey);
  assert.throws(()=>planVoiceAgentJourney({
    tenantId:OTHER,journeyId:'journey_v148_004',voiceSession:voiceSession(),contactRef:CONTACT,conversationRef:CONVERSATION,
    leadRef:LEAD,appointmentRef:APPOINTMENT,workflowId:WORKFLOW,workflowVersion:3,outcome:'appointment_booked',eventRef:'voice-outcome-004',now:NOW
  }),/tenant/i);
});

test('V148 human handoff outcome connects into the same inbox context', () => {
  const result=buildVoiceInboxOutcome({
    tenantId:TENANT,voiceSession:voiceSession(),contactRef:CONTACT,conversationRef:CONVERSATION,
    outcome:'transferred',handoffQueueRef:'queue_sales_001',eventRef:'voice-handoff-001',now:NOW
  });
  assert.equal(result.type,'conversation.voice_handoff');
  assert.equal(result.queueRef,'queue_sales_001');
  assert.equal(result.conversationRef,CONVERSATION);
  assert.equal(result.redacted,true);
  assert.equal('messageBody' in result,false);
});
