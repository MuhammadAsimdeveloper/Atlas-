import {executeWorkflowJob} from '../workflow-executor.mjs';
import {createProviderRuntime} from '../provider-runtime.mjs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadInboxContentStore} from '../../api/inbox-content.mjs';

async function loadSecretResolver(){
 const moduleName=process.env.ATLAS_WORKER_SECRET_RESOLVER_MODULE;
 if(!moduleName||!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.mjs$/.test(moduleName))throw Object.assign(new Error('Production worker requires a reviewed secret resolver module.'),{code:'secret_resolver_unavailable'});
 const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../secrets');
 const target=path.resolve(base,moduleName);
 if(!target.startsWith(base+path.sep))throw Object.assign(new Error('Secret resolver path is outside the reviewed directory.'),{code:'secret_resolver_path_invalid'});
 const loaded=await import(pathToFileURL(target).href);
 if(typeof loaded.resolveSecret!=='function')throw Object.assign(new Error('Secret resolver must export resolveSecret.'),{code:'secret_resolver_invalid'});
 return loaded.resolveSecret;
}
const secretResolver=await loadSecretResolver();
const inboxContent=await loadInboxContentStore();
async function sendInboxMessage(payloadRef,context){
 const {messageId}=payloadRef||{};
 if(typeof messageId!=='string')throw Object.assign(new Error('Inbox message reference is required.'),{code:'inbox_message_invalid'});
 const store=context.workerStore; const job={tenant_id:context.tenantId,job_id:context.jobId};
 const message=await store.getInboxMessageForWorker(job,context.workerId,messageId); if(!message)throw Object.assign(new Error('Inbox message is unavailable.'),{code:'inbox_message_not_found'});
 if(message.delivery_status!=='queued') return {status:'already_processed',messageId};
 const content=await inboxContent.getMessageContent({tenantId:context.tenantId,messageId:message.message_id,contentRef:message.content_ref});
 const capabilityId='communication.'+message.channel;
 const cfg={capabilityId,connectionRef:message.provider_connection_id,to:message.recipient_ref,from:message.sender_ref,subject:message.subject,consent:true,approved:true,successPort:'next',textBody:content?.text||'',htmlBody:content?.html};
 if(message.channel==='voice') cfg.twimlUrl=content?.twimlUrl;
 if(message.channel==='email' && !cfg.textBody) throw Object.assign(new Error('Email content is unavailable.'),{code:'inbox_content_unavailable'});
 if((message.channel==='sms'||message.channel==='whatsapp') && !cfg.textBody) throw Object.assign(new Error('Message content is unavailable.'),{code:'inbox_content_unavailable'});
 const node={config:cfg};
 try{
   await store.markInboxMessageForWorker(job,context.workerId,message.message_id,'sending',null,null);
   const result=await providerRuntime.execute({node,job,context:{workerId:context.workerId,idempotencyKey:message.idempotency_key,attempt:context.attempt,signal:context.signal}});
   await store.markInboxMessageForWorker(job,context.workerId,message.message_id,'sent',result.providerRef||null,null);
   return result;
 }catch(error){
   await store.markInboxMessageForWorker(job,context.workerId,message.message_id,'failed',null,error?.code||'provider_failed').catch(()=>{});
   throw error;
 }
}

export const jobHandlers=Object.freeze({'workflow.execute':async(_payloadRef,context)=>{
 const store=context.workerStore;
 if(!store)throw Object.assign(new Error('Worker execution store is unavailable.'),{code:'worker_store_unavailable'});
 const providerRuntime=createProviderRuntime({connectionStore:store,secretResolver});
 return executeWorkflowJob({
  store,job:{tenant_id:context.tenantId,job_id:context.jobId},workerId:context.workerId,
  signal:context.signal,
  verifyExternalAction:async({node,job,workerId})=>{
   const connectionRef=node.config?.connectionRef;
   if(typeof connectionRef!=='string')return false;
   const connection=await store.getProviderConnectionForWorker(job,workerId,connectionRef);
   return connection?.status==='verified'&&connection?.tenant_id===job.tenant_id;
  },
  resolveAction:async({node,execution,tenantId,jobId,signal})=>{
   const cap=node.config?.capabilityId;
   if(node.requiresAdapter===true||typeof cap==='string'&&/^(communication\.|automation\.webhook|service\.jobber)/.test(cap))
    return providerRuntime.execute({node,job:{tenant_id:tenantId,job_id:jobId},context:{workerId:context.workerId,idempotencyKey:context.idempotencyKey,attempt:context.attempt,signal,execution}});
   if(node.type==='stop'||node.type==='noop'||node.type==='set_field'||node.type==='condition'||node.type==='branch')return {selectedPort:node.config?.selectedPort||'next'};
   throw Object.assign(new Error('No production action handler is registered for this workflow node.'),{code:'workflow_action_unavailable'});
  }
 });
},'communication.message.send':sendInboxMessage});
export const eventHandlers=Object.freeze({});
