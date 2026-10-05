import {createPostmarkAdapter,createTwilioMessagingAdapter,createTwilioVoiceAdapter,createWhatsAppCloudAdapter} from './provider-adapters.mjs';
import {createZapierWebhookAdapter,createJobberAdapter} from './integration-runtime.mjs';
import {executeProviderAction} from '../../packages/atlas-core/provider-adapters.mjs';
import {ProviderReconciler} from '../../packages/atlas-runtime/provider-reconciliation.mjs';

const KEY=/^[a-z][a-z0-9_.-]{1,79}$/;
const REF=/^[A-Za-z0-9_.:/-]{8,240}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY=100_000;

function text(v,label,max=240){if(typeof v!=='string'||!v.trim()||v.length>max||/[\r\n\u0000]/.test(v))throw Object.assign(new Error(label+' is invalid'),{code:'provider_request_invalid'});return v.trim();}
function ref(v,label){const x=text(v,label,240);if(!REF.test(x))throw Object.assign(new Error(label+' is invalid'),{code:'provider_reference_invalid'});return x;}
function object(v,label){if(!v||typeof v!=='object'||Array.isArray(v))throw Object.assign(new Error(label+' must be an object'),{code:'provider_request_invalid'});return v;}
function boundedPayload(v){if(JSON.stringify(v).length>MAX_BODY)throw Object.assign(new Error('Provider payload exceeds the bounded execution size.'),{code:'provider_payload_too_large'});return v;}

export const PROVIDER_ACTIONS=Object.freeze(new Set(['communication.email','communication.sms','communication.voice','communication.whatsapp','automation.webhook','service.jobber']));

function adapterFor({connection,secret,fetchImpl}){
 const key=connection.provider_key,meta=object(connection.metadata||{},'connection.metadata');
 if(key==='postmark.email') return createPostmarkAdapter({serverToken:secret,fetchImpl});
 if(key==='twilio.sms') return createTwilioMessagingAdapter({accountSid:meta.accountSid,authToken:secret,from:meta.from,fetchImpl});
 if(key==='twilio.voice') return createTwilioVoiceAdapter({accountSid:meta.accountSid,authToken:secret,from:meta.from,fetchImpl});
 if(key==='meta.whatsapp') return createWhatsAppCloudAdapter({accessToken:secret,phoneNumberId:meta.phoneNumberId,fetchImpl});
 if(key==='zapier.webhook') return createZapierWebhookAdapter({hookUrl:secret,fetchImpl});
 if(key==='jobber.graphql') return createJobberAdapter({accessToken:secret,apiVersion:meta.apiVersion||'2025-04-16',fetchImpl});
 throw Object.assign(new Error('Provider adapter is not registered.'),{code:'provider_adapter_unavailable'});
}

function requestForNode({node,connection,job,context}){
 const cfg=object(node.config||{},'node.config'),capabilityId=text(cfg.capabilityId,'capabilityId',120);
 const channel=capabilityId.startsWith('communication.')?capabilityId.slice(14):null;
 if(channel&&connection.channel&&connection.channel!==channel)throw Object.assign(new Error('Provider connection channel does not match workflow capability.'),{code:'provider_channel_mismatch'});
 if(channel==='email')return boundedPayload({from:text(cfg.from||connection.metadata?.from,'from'),to:text(cfg.to,'to'),subject:text(cfg.subject,'subject',998),textBody:text(cfg.textBody,'textBody',50_000),htmlBody:cfg.htmlBody==null?undefined:text(cfg.htmlBody,'htmlBody',50_000),messageStream:cfg.messageStream||'outbound',idempotencyKey:context.idempotencyKey});
 if(channel==='sms')return boundedPayload({to:text(cfg.to,'to',120),body:text(cfg.body,'body',1_600),idempotencyKey:context.idempotencyKey});
 if(channel==='whatsapp')return boundedPayload({to:text(cfg.to,'to',120),body:text(cfg.body,'body',4_096),idempotencyKey:context.idempotencyKey});
 if(channel==='voice')return boundedPayload({to:text(cfg.to,'to',120),twimlUrl:text(cfg.twimlUrl,'twimlUrl',2_000),idempotencyKey:context.idempotencyKey});
 if(capabilityId==='automation.webhook')return boundedPayload({payload:object(cfg.payload||{},'payload'),idempotencyKey:context.idempotencyKey});
 if(capabilityId==='service.jobber'){
   const query=text(cfg.query,'query',50_000);
   if(!/^(query|mutation)\b/.test(query.trim()))throw Object.assign(new Error('Jobber operation must be an explicit GraphQL query or mutation.'),{code:'provider_request_invalid'});
   return boundedPayload({query,variables:object(cfg.variables||{},'variables'),idempotencyKey:context.idempotencyKey});
 }
 throw Object.assign(new Error('Workflow node capability is not a supported provider action.'),{code:'provider_capability_unsupported'});
}

export function createProviderRuntime({connectionStore,secretResolver,fetchImpl=fetch,logger=console}={}){
 if(!connectionStore||typeof connectionStore.getProviderConnectionForWorker!=='function')throw new TypeError('A lease-bound provider connection store is required.');
 if(typeof secretResolver!=='function')throw new TypeError('A production secret resolver is required.');
 return Object.freeze({execute:async({node,job,context})=>{
   const cfg=object(node.config||{},'node.config'),capabilityId=text(cfg.capabilityId,'capabilityId',120);
   if(cfg.consent!==true||cfg.approved!==true)throw Object.assign(new Error('Provider action requires explicit consent and approval.'),{code:'provider_consent_required'});
   if(context.attempt>1)throw Object.assign(new Error('Provider action retry requires reconciliation because the configured adapter cannot guarantee exactly-once delivery.'),{code:'provider_retry_unsafe'});
   if(!PROVIDER_ACTIONS.has(capabilityId))throw Object.assign(new Error('Unsupported provider capability.'),{code:'provider_capability_unsupported'});
   const connectionRef=ref(cfg.connectionRef,'connectionRef');
   if(!UUID.test(connectionRef))throw Object.assign(new Error('Provider connection reference must be a UUID.'),{code:'provider_connection_invalid'});
   const connection=await connectionStore.getProviderConnectionForWorker(job,context.workerId,connectionRef);
   if(!connection||connection.status!=='verified')throw Object.assign(new Error('Provider connection is not verified.'),{code:'provider_not_verified'});
   if(connection.tenant_id!==job.tenant_id)throw Object.assign(new Error('Provider connection tenant mismatch.'),{code:'provider_tenant_mismatch'});
   const reconciliation = reconciler ? await reconciler.start({
     tenantId:job.tenant_id,jobId:job.job_id,providerKey:connection.provider_key,connectionId:connection.connection_id,
     actionKey:capabilityId,idempotencyKey:context.idempotencyKey
   }) : null;
   if(reconciliation && (reconciliation.state==='sent'||reconciliation.state==='reconciled')){
     return Object.freeze({selectedPort:cfg.successPort||'next',resultRef:{kind:'provider_action',id:reconciliation.provider_ref||context.idempotencyKey,version:1},providerRef:reconciliation.provider_ref||context.idempotencyKey,status:'sent',reconciled:reconciliation.state==='reconciled'});
   }
   const credentialRef=ref(connection.credential_ref,'credential_ref');
   const secret=await secretResolver({tenantId:job.tenant_id,connectionId:connection.connection_id,credentialRef});
   if(typeof secret!=='string'||secret.length<8||secret.length>4096)throw Object.assign(new Error('Provider credential could not be resolved.'),{code:'provider_secret_unavailable'});
   const request=requestForNode({node,connection,job,context});
   const adapter=adapterFor({connection,secret,fetchImpl});
   if(reconciliation && (reconciliation.state==='ambiguous'||reconciliation.state==='reconciliation_required')){
     const recovered=await reconciler.handleExisting({record:reconciliation,adapter,request,signal:context.signal,job,context});
     if(recovered) return Object.freeze({selectedPort:cfg.successPort||'next',resultRef:{kind:'provider_action',id:recovered.providerRef||context.idempotencyKey,version:1},providerRef:recovered.providerRef||null,status:'sent',reconciled:true});
   }
   if(context.attempt>1)throw Object.assign(new Error('Provider action retry requires reconciliation because the configured adapter cannot guarantee exactly-once delivery.'),{code:'provider_retry_unsafe'});
   let result;
   try{
     result=connection.provider_key==='jobber.graphql'
       ? Object.freeze({status:'sent',providerRef:context.idempotencyKey,dataRef:await adapter.query(request,{signal:context.signal})})
       : await executeProviderAction({adapter,request,signal:context.signal});
     if(reconciler) await reconciler.recordSent({tenantId:job.tenant_id,jobId:job.job_id,idempotencyKey:context.idempotencyKey,providerRef:result.providerRef||context.idempotencyKey});
   }catch(error){
     if(reconciler){
       if(ProviderReconciler.isAmbiguousError(error)) await reconciler.recordAmbiguous({tenantId:job.tenant_id,jobId:job.job_id,idempotencyKey:context.idempotencyKey,errorCode:error?.code});
       else await reconciler.recordFailed({tenantId:job.tenant_id,jobId:job.job_id,idempotencyKey:context.idempotencyKey,errorCode:error?.code||'provider_failed'});
     }
     throw error;
   }
   logger.info?.('Atlas provider action completed.',{tenantId:job.tenant_id,jobId:job.job_id,connectionId:connection.connection_id,provider:connection.provider_key,status:result.status});
   return Object.freeze({selectedPort:cfg.successPort||'next',resultRef:{kind:'provider_action',id:result.providerRef||context.idempotencyKey,version:1},providerRef:result.providerRef||null,status:result.status});
 }});
}
