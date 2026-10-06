import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createVoiceAgentPolicy,authorizeVoiceConnection,planVoiceTurn,runVoiceAgentTurn} from './voice-turn-runtime.mjs';
import {createModelAdapter} from './model-runtime.mjs';
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const T='11111111-1111-4111-8111-111111111111';const P=createVoiceAgentPolicy({tenantId:T,agentId:'voice-agent',releaseId:'voice-release',voiceSessionRef:'voice-session',escalationQueueRef:'queue'});
const S={id:'session-voice',tenantId:T,agentId:'voice-agent',releaseId:'voice-release'};
test('V151 voice disclosure and consent are fail-closed',()=>{
 assert.equal(authorizeVoiceConnection({tenantId:T,policy:P}).code,'AI_DISCLOSURE_REQUIRED');
 assert.equal(authorizeVoiceConnection({tenantId:T,policy:P,disclosureAccepted:true,outbound:true}).code,'VOICE_CONSENT_REQUIRED');
 assert.equal(authorizeVoiceConnection({tenantId:T,policy:P,disclosureAccepted:true,consentAccepted:true,outbound:true}).allowed,true);
});
test('V151 voice turn keeps transcript reference-only and bounds transfers/interruption',()=>{
 const plan=planVoiceTurn({tenantId:T,voiceSessionRef:'voice-session',turnId:'turn-1',transcriptHash:'a'.repeat(64),policy:P});
 assert.equal(plan.transcriptStored,false);assert.equal(plan.transfersRemaining,3);
 assert.throws(()=>planVoiceTurn({tenantId:T,voiceSessionRef:'voice-session',turnId:'turn-2',transcriptHash:'a'.repeat(64),policy:P,transfersUsed:4}),/transfers/i);
});
test('V151 voice model turn returns concise answer without retaining transcript',async()=>{
 const adapter=createModelAdapter({provider:'model_adapter',infer:async()=>({output:{message:'I can help with that.',intent:'booking',handoff:false}})});
 const transcript='I need an appointment.';
 const result=await runVoiceAgentTurn({tenantId:T,actorId:'actor',policy:P,session:S,turnId:'turn-3',transcript,transcriptHash:hash(transcript),adapter});
 assert.equal(result.status,'answered');assert.equal(result.transcriptStored,false);
});
