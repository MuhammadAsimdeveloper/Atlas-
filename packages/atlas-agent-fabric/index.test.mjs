import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentReleaseManifest,
  buildAgentJourneyContext,
  planAgentTurn,
  authorizeAgentWorkflowInvocation,
  createHumanHandoff,
  summarizeAgentRun
} from './index.mjs';
import {
  createAgentRuntimePolicy,
  defineAgentTool,
  authorizeAgentToolCall,
  createAgentSession
} from '../atlas-target/index.mjs';

const TENANT='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const ACTOR='33333333-3333-4333-8333-333333333333';
const AGENT='44444444-4444-4444-8444-444444444444';
const RELEASE='55555555-5555-4555-8555-555555555555';
const WORKFLOW='66666666-6666-4666-8666-666666666666';
const SESSION='77777777-7777-4777-8777-777777777777';
const CONVERSATION='88888888-8888-4888-8888-888888888888';
const CONTACT='99999999-9999-4999-8999-999999999999';
const LEAD='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const APPOINTMENT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VOICE='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW=Date.parse('2026-10-06T08:00:00.000Z');

function release() {
  return createAgentReleaseManifest({
    tenantId:TENANT, agentId:AGENT, releaseId:RELEASE, version:3, status:'active',
    allowedTools:['crm.search','calendar.book'], modelPolicy:{provider:'model_adapter', maxInputTokens:4000, maxOutputTokens:1200, timeoutMs:30000},
    systemPromptHash:'d'.repeat(64)
  });
}

function runtime() {
  return createAgentRuntimePolicy({tenantId:TENANT,agentId:AGENT,releaseId:RELEASE,allowedTools:['crm.search','calendar.book'],maxTurns:4,maxToolCalls:3,maxExecutionMs:60000});
}

function session() {
  return createAgentSession({runtime:runtime(),tenantId:TENANT,conversationId:CONVERSATION,actorId:ACTOR,now:NOW,leaseMs:30000});
}

test('V147 release manifest is tenant/release pinned and stores only prompt hash plus bounded model policy', () => {
  const manifest=release();
  assert.equal(manifest.tenantId,TENANT);
  assert.equal(manifest.agentId,AGENT);
  assert.equal(manifest.releaseId,RELEASE);
  assert.equal(manifest.status,'active');
  assert.equal(manifest.systemPromptHash,'d'.repeat(64));
  assert.equal('systemPrompt' in manifest,false);
  assert.ok(manifest.checksum.length===64);
  assert.throws(()=>createAgentReleaseManifest({...manifest,tenantId:OTHER}),/tenant/i);
});

test('V147 journey context connects CRM, appointment, conversation and voice without accepting customer payload', () => {
  const context=buildAgentJourneyContext({
    tenantId:TENANT,journeyId:'journey_v147_001',contactRef:CONTACT,leadRef:LEAD,
    opportunityRef:WORKFLOW,appointmentRef:APPOINTMENT,conversationRef:CONVERSATION,voiceSessionRef:VOICE
  });
  assert.equal(context.contactRef,CONTACT);
  assert.equal(context.appointmentRef,APPOINTMENT);
  assert.equal(context.voiceSessionRef,VOICE);
  assert.equal(context.redacted,true);
  assert.equal('messageBody' in context,false);
  assert.throws(()=>buildAgentJourneyContext({tenantId:TENANT,journeyId:'journey_v147_002',contactRef:CONTACT,messageBody:'secret'}),/payload|message|content/i);
  assert.throws(()=>buildAgentJourneyContext({tenantId:OTHER,journeyId:'journey_v147_003',contactRef:CONTACT}),/tenant/i);
});

test('V147 agent turn planning is deterministic, bounded and release/session pinned', () => {
  const manifest=release();
  const s=session();
  const context=buildAgentJourneyContext({tenantId:TENANT,journeyId:'journey_v147_004',contactRef:CONTACT,leadRef:LEAD,appointmentRef:APPOINTMENT,conversationRef:CONVERSATION,voiceSessionRef:VOICE});
  const first=planAgentTurn({
    tenantId:TENANT,sessionId:s.id,agentRelease:manifest,turnId:'turn_001',promptHash:'e'.repeat(64),
    toolCalls:[{toolName:'crm.search',risk:'read',argumentsHash:'f'.repeat(64)}],
    approvalRefs:[],workflowInvocationRef:null,journeyContext:context,now:NOW
  });
  const second=planAgentTurn({
    tenantId:TENANT,sessionId:s.id,agentRelease:manifest,turnId:'turn_001',promptHash:'e'.repeat(64),
    toolCalls:[{toolName:'crm.search',risk:'read',argumentsHash:'f'.repeat(64)}],
    approvalRefs:[],workflowInvocationRef:null,journeyContext:context,now:NOW
  });
  assert.equal(first.idempotencyKey,second.idempotencyKey);
  assert.equal(first.sessionId,s.id);
  assert.equal(first.releaseId,RELEASE);
  assert.equal(first.journeyContext.voiceSessionRef,VOICE);
  assert.equal(first.rawPromptStored,false);
  assert.throws(()=>planAgentTurn({
    tenantId:OTHER,sessionId:s.id,agentRelease:manifest,turnId:'turn_002',promptHash:'e'.repeat(64),
    toolCalls:[],approvalRefs:[],journeyContext:context,now:NOW
  }),/tenant/i);
});

test('V147 agent turn planner blocks raw prompts and unbounded tool plans', () => {
  const manifest=release(); const s=session();
  assert.throws(()=>planAgentTurn({tenantId:TENANT,sessionId:s.id,agentRelease:manifest,turnId:'turn_003',promptHash:'short',toolCalls:[],approvalRefs:[],journeyContext:buildAgentJourneyContext({tenantId:TENANT,journeyId:'journey_v147_005',contactRef:CONTACT}),now:NOW}),/promptHash/i);
  assert.throws(()=>planAgentTurn({tenantId:TENANT,sessionId:s.id,agentRelease:manifest,turnId:'turn_004',promptHash:'e'.repeat(64),prompt:'do this',toolCalls:[],approvalRefs:[],journeyContext:buildAgentJourneyContext({tenantId:TENANT,journeyId:'journey_v147_006',contactRef:CONTACT}),now:NOW}),/prompt|content/i);
  assert.throws(()=>planAgentTurn({tenantId:TENANT,sessionId:s.id,agentRelease:manifest,turnId:'turn_005',promptHash:'e'.repeat(64),toolCalls:Array.from({length:13},(_,i)=>({toolName:'crm.search',risk:'read',argumentsHash:'f'.repeat(64)})),approvalRefs:[],journeyContext:buildAgentJourneyContext({tenantId:TENANT,journeyId:'journey_v147_007',contactRef:CONTACT}),now:NOW}),/tool/i);
});

test('V147 tool authorization composes with existing exact approval evidence', () => {
  const r=runtime();
  const writeTool=defineAgentTool({name:'calendar.book',risk:'write'});
  const base={tenantId:TENANT,agentId:AGENT,releaseId:RELEASE,actorId:ACTOR,toolName:'calendar.book',argumentsHash:'a'.repeat(64),idempotencyKey:'b'.repeat(64)};
  assert.equal(authorizeAgentToolCall({runtime:r,tool:writeTool,tenantId:TENANT,actorId:ACTOR,argumentsValue:{appointmentRef:APPOINTMENT}}).allowed,false);
  const nowIso=new Date(NOW).toISOString();
  const evidence={...base,status:'approved',approvedAt:nowIso,expiresAt:new Date(NOW+5*60_000).toISOString()};
  const args={appointmentRef:APPOINTMENT};
  const real=authorizeAgentToolCall({runtime:r,tool:writeTool,tenantId:TENANT,actorId:ACTOR,argumentsValue:args,approvalEvidence:{...evidence,argumentsHash:authorizeAgentToolCall({runtime:r,tool:writeTool,tenantId:TENANT,actorId:ACTOR,argumentsValue:args}).argumentsHash,idempotencyKey:authorizeAgentToolCall({runtime:r,tool:writeTool,tenantId:TENANT,actorId:ACTOR,argumentsValue:args}).idempotencyKey},now:NOW});
  assert.equal(real.allowed,true);
});

test('V147 workflow invocation authorization requires exact release/version and approval for writes', () => {
  const manifest=release();
  const read=authorizeAgentWorkflowInvocation({tenantId:TENANT,agentRelease:manifest,workflowId:WORKFLOW,workflowVersion:2,actorId:ACTOR,approvalRef:null,risk:'read'});
  assert.equal(read.allowed,true);
  const blocked=authorizeAgentWorkflowInvocation({tenantId:TENANT,agentRelease:manifest,workflowId:WORKFLOW,workflowVersion:2,actorId:ACTOR,approvalRef:null,risk:'write'});
  assert.equal(blocked.allowed,false);
  const approved=authorizeAgentWorkflowInvocation({tenantId:TENANT,agentRelease:manifest,workflowId:WORKFLOW,workflowVersion:2,actorId:ACTOR,approvalRef:'approval_v147_001',risk:'write'});
  assert.equal(approved.allowed,true);
  const wrongTenant=authorizeAgentWorkflowInvocation({tenantId:OTHER,agentRelease:manifest,workflowId:WORKFLOW,workflowVersion:2,actorId:ACTOR,approvalRef:'approval_v147_001',risk:'write'});
  assert.equal(wrongTenant.allowed,false);
});

test('V147 human handoff is reference-only, bounded and idempotent', () => {
  const one=createHumanHandoff({tenantId:TENANT,sessionId:SESSION,reason:'low_confidence',queueRef:'queue_sales_001',appointmentRef:APPOINTMENT,now:NOW});
  const two=createHumanHandoff({tenantId:TENANT,sessionId:SESSION,reason:'low_confidence',queueRef:'queue_sales_001',appointmentRef:APPOINTMENT,now:NOW});
  assert.equal(one.handoffId,two.handoffId);
  assert.equal(one.status,'pending');
  assert.equal(one.reason,'low_confidence');
  assert.equal(one.appointmentRef,APPOINTMENT);
  assert.equal('messageBody' in one,false);
  assert.throws(()=>createHumanHandoff({tenantId:TENANT,sessionId:SESSION,reason:'dangerous reason',queueRef:'queue_sales_001',now:NOW}),/reason/i);
});

test('V147 agent run summary exposes outcome metadata but no customer content', () => {
  const summary=summarizeAgentRun({
    tenantId:TENANT,sessionId:SESSION,agentRelease:release(),turns:3,toolCalls:2,
    status:'handoff',outcome:'appointment_booked',failureReason:null,handoffReason:'caller_requested_human',
    journeyContext:buildAgentJourneyContext({tenantId:TENANT,journeyId:'journey_v147_008',contactRef:CONTACT,appointmentRef:APPOINTMENT,voiceSessionRef:VOICE})
  });
  assert.equal(summary.status,'handoff');
  assert.equal(summary.outcome,'appointment_booked');
  assert.equal(summary.appointmentRef,APPOINTMENT);
  assert.equal(summary.redacted,true);
  assert.equal('transcript' in summary,false);
});
