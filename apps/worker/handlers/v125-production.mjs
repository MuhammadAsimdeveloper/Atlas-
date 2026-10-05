import {executeWorkflowJob} from '../workflow-executor.mjs';
import {createProviderRuntime} from '../provider-runtime.mjs';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';

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
export const jobHandlers=Object.freeze({'workflow.execute':async(_payloadRef,context)=>{
 const store=context.workerStore;
 if(!store)throw Object.assign(new Error('Worker execution store is unavailable.'),{code:'worker_store_unavailable'});
 const providerRuntime=createProviderRuntime({connectionStore:store,secretResolver});
 return executeWorkflowJob({
  store,job:{tenant_id:context.tenantId,job_id:context.jobId},workerId:context.workerId,
  resolveAction:async({node,execution,tenantId,jobId,signal})=>{
   const cap=node.config?.capabilityId;
   if(node.requiresAdapter===true||typeof cap==='string'&&/^(communication\.|automation\.webhook|service\.jobber)/.test(cap))
    return providerRuntime.execute({node,job:{tenant_id:tenantId,job_id:jobId},context:{workerId:context.workerId,idempotencyKey:context.idempotencyKey,signal,execution}});
   if(node.type==='stop'||node.type==='noop'||node.type==='set_field'||node.type==='condition'||node.type==='branch')return {selectedPort:node.config?.selectedPort||'next'};
   throw Object.assign(new Error('No production action handler is registered for this workflow node.'),{code:'workflow_action_unavailable'});
  }
 });
}});
export const eventHandlers=Object.freeze({});
