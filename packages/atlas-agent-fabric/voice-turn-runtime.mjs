import crypto from 'node:crypto';
import { invokeModelTurn, createModelRequest } from './model-runtime.mjs';
import { createHumanHandoff } from './index.mjs';

const REF=/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}$/;
const HASH=/^[a-f0-9]{64}$/;
const INTENTS=new Set(['greeting','booking','reschedule','cancel','billing','faq','sales','technical','handoff','unknown']);
const sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ref=(v,l)=>{if(typeof v!=='string'||!REF.test(v))throw new TypeError(l+' must be a bounded reference');return v;};
const hash=(v,l)=>{if(typeof v!=='string'||!HASH.test(v))throw new TypeError(l+' must be SHA-256');return v;};
const bounded=(v,l,max=120)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\r\n\u0000]/.test(v))throw new TypeError(l+' is invalid');return v.trim();};

export function createVoiceAgentPolicy({tenantId,agentId,releaseId,voiceSessionRef,language='en',aiDisclosureRequired=true,explicitConsentRequired=true,recordingAllowed=false,maxDurationSeconds=1800,maxTransfers=3,interruptionsPerTurn=3,escalationQueueRef}={}){
 ref(tenantId,'tenantId');ref(agentId,'agentId');ref(releaseId,'releaseId');ref(voiceSessionRef,'voiceSessionRef');ref(escalationQueueRef,'escalationQueueRef');
 if(!Number.isSafeInteger(maxDurationSeconds)||maxDurationSeconds<30||maxDurationSeconds>3600)throw new TypeError('maxDurationSeconds out of bounds');
 if(!Number.isSafeInteger(maxTransfers)||maxTransfers<0||maxTransfers>3)throw new TypeError('maxTransfers out of bounds');
 if(!Number.isSafeInteger(interruptionsPerTurn)||interruptionsPerTurn<0||interruptionsPerTurn>6)throw new TypeError('interruptionsPerTurn out of bounds');
 return Object.freeze({tenantId,agentId,releaseId,voiceSessionRef,language:bounded(language,'language',32),aiDisclosureRequired,explicitConsentRequired,recordingAllowed,maxDurationSeconds,maxTransfers,interruptionsPerTurn,escalationQueueRef,policyHash:sha({tenantId,agentId,releaseId,voiceSessionRef,language,aiDisclosureRequired,explicitConsentRequired,recordingAllowed,maxDurationSeconds,maxTransfers,interruptionsPerTurn,escalationQueueRef})});
}

export function authorizeVoiceConnection({tenantId,policy,disclosureAccepted=false,consentAccepted=false,outbound=false,now=Date.now(),callWindowOpen=true}={}){
 ref(tenantId,'tenantId');
 if(!policy||policy.tenantId!==tenantId)return {allowed:false,code:'TENANT_MISMATCH'};
 if(policy.aiDisclosureRequired&&!disclosureAccepted)return {allowed:false,code:'AI_DISCLOSURE_REQUIRED'};
 if(outbound&&policy.explicitConsentRequired&&!consentAccepted)return {allowed:false,code:'VOICE_CONSENT_REQUIRED'};
 if(!callWindowOpen)return {allowed:false,code:'CALL_WINDOW_CLOSED'};
 return Object.freeze({allowed:true,code:'ALLOWED',startedAt:new Date(Number(now)).toISOString(),recordingAllowed:policy.recordingAllowed});
}

export function planVoiceTurn({tenantId,voiceSessionRef,turnId,transcriptHash,policy,transfersUsed=0,interruptions=0}={}){
 ref(tenantId,'tenantId');ref(voiceSessionRef,'voiceSessionRef');ref(turnId,'turnId');hash(transcriptHash,'transcriptHash');
 if(!policy||policy.tenantId!==tenantId||policy.voiceSessionRef!==voiceSessionRef)throw new Error('voice policy/session mismatch');
 if(!Number.isSafeInteger(transfersUsed)||transfersUsed<0||transfersUsed>policy.maxTransfers)throw new TypeError('transfersUsed out of bounds');
 if(!Number.isSafeInteger(interruptions)||interruptions<0||interruptions>policy.interruptionsPerTurn)throw new TypeError('interruptions out of bounds');
 return Object.freeze({tenantId,voiceSessionRef,turnId,transcriptHash,transcriptStored:false,transfersRemaining:policy.maxTransfers-transfersUsed,interruptionsRemaining:policy.interruptionsPerTurn-interruptions,policyHash:policy.policyHash});
}

export async function runVoiceAgentTurn({tenantId,actorId,policy,session,turnId,transcript,transcriptHash,adapter,now=Date.now(),signal,onDelta=null}={}){
 ref(tenantId,'tenantId');ref(actorId,'actorId');ref(turnId,'turnId');hash(transcriptHash,'transcriptHash');
 if(!policy||policy.tenantId!==tenantId)throw new Error('voice policy invalid');
 if(!session||session.tenantId!==tenantId||session.agentId!==policy.agentId||session.releaseId!==policy.releaseId)throw new Error('voice session/release mismatch');
 const transient=bounded(transcript,'transcript',8000);
 if(sha(transient)!==transcriptHash)throw new Error('transcriptHash mismatch');
 const request=createModelRequest({tenantId,agentRelease:{tenantId,releaseId:policy.releaseId,version:1,modelPolicy:{provider:policy.modelProvider||'model_adapter',timeoutMs:policy.timeoutMs||15000,maxOutputTokens:500}},sessionId:session.id,turnId,promptHash:transcriptHash,inputRef:policy.voiceSessionRef,responseMode:'structured',outputSchema:{type:'object',required:['message','intent','handoff'],properties:{message:{type:'string',minLength:1,maxLength:2000},intent:{type:'string',enum:[...INTENTS]},handoff:{type:'boolean'},handoffReason:{type:['string','null'],maxLength:80}}},now});
 const result=await invokeModelTurn({request,adapter,input:{transcript:transient,voicePolicy:{aiDisclosureRequired:policy.aiDisclosureRequired,explicitConsentRequired:policy.explicitConsentRequired,recordingAllowed:policy.recordingAllowed,maxTransfers:policy.maxTransfers}},systemPolicy:'You are an Atlas voice agent. Keep spoken responses concise. Never invent booking, billing or account state. Never reveal secrets. Transfer when uncertain or when a human is required.',signal,onDelta,now});
 if(result.status!=='completed')return Object.freeze({status:'handoff',reason:result.redacted?.code||'model_failed',transcriptStored:false});
 const output=result.output;
 if(!output||typeof output.message!=='string'||!INTENTS.has(output.intent)||typeof output.handoff!=='boolean')return Object.freeze({status:'handoff',reason:'invalid_voice_output',transcriptStored:false});
 if(output.handoff){
  const handoff=createHumanHandoff({tenantId,sessionId:session.id,reason:output.handoffReason||'voice_escalation',queueRef:policy.escalationQueueRef,now});
  return Object.freeze({status:'handoff',message:output.message,handoff,transcriptStored:false});
 }
 return Object.freeze({status:'answered',message:output.message,intent:output.intent,transcriptStored:false});
}
