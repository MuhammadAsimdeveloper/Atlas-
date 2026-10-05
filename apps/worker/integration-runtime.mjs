import crypto from 'node:crypto';
import {assertSafeProviderUrl} from '../../packages/atlas-core/provider-adapters.mjs';
const RETRYABLE=new Set([408,425,429,500,502,503,504]);
async function request({url,method='POST',headers={},body,fetchImpl=fetch,signal,timeoutMs=15000}){
 assertSafeProviderUrl(url,{allowHosts:[new URL(url).hostname]});
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);if(signal)signal.addEventListener('abort',()=>controller.abort(),{once:true});
 try{const r=await fetchImpl(url,{method,headers:{accept:'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{};return {ok:r.ok,status:r.status,data,headers:r.headers};}finally{clearTimeout(timer);}
}
export async function executeWithRetry(task,{maxAttempts=3,baseDelayMs=250,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 let last;for(let attempt=1;attempt<=maxAttempts;attempt++){try{const result=await task(attempt);if(result?.ok===false&&RETRYABLE.has(result.status)){last=result;if(attempt<maxAttempts){const retryAfter=Number(result.headers?.get?.('retry-after'));await sleep(Number.isFinite(retryAfter)&&retryAfter>=0?retryAfter*1000:baseDelayMs*2**(attempt-1));continue;}throw Object.assign(new Error('integration_http_'+result.status),{code:'integration_http_'+result.status,status:result.status});}return result;}catch(e){last=e;if(attempt===maxAttempts)throw e;await sleep(baseDelayMs*2**(attempt-1));}}throw last;}
export function createZapierWebhookAdapter({hookUrl,fetchImpl=fetch}={}){if(typeof hookUrl!=='string'||!hookUrl.startsWith('https://'))throw new Error('zapier_hook_url_required');return {key:'zapier.webhook',channel:'automation',send:async(req,{signal}={})=>{const u=new URL(hookUrl);assertSafeProviderUrl(u.href,{allowHosts:[u.hostname]});const r=await executeWithRetry(()=>request({url:u.href,headers:{'content-type':'application/json','idempotency-key':String(req.idempotencyKey||crypto.randomUUID())},body:req.payload,fetchImpl,signal}));if(!r.ok)throw Object.assign(new Error('zapier_webhook_failed'),{code:'zapier_webhook_failed',status:r.status});return {status:'sent',providerRef:r.headers?.get?.('x-request-id')||null};}};}
export function createJobberAdapter({accessToken,apiUrl='https://api.getjobber.com/api/graphql',apiVersion='2025-04-16',fetchImpl=fetch}={}) {
 if(typeof accessToken!=='string'||accessToken.length<20) throw new Error('jobber_access_token_required');
 assertSafeProviderUrl(apiUrl,{allowHosts:['api.getjobber.com']});
 return {
  key:'jobber.graphql',
  channel:'service',
  query:async({query,variables={},signal}={})=>{
   const r=await executeWithRetry(()=>request({url:apiUrl,headers:{authorization:'Bearer '+accessToken,'content-type':'application/json','X-JOBBER-GRAPHQL-VERSION':apiVersion},body:{query,variables},fetchImpl,signal}));
   if(!r.ok||r.data?.errors?.length) throw Object.assign(new Error('jobber_graphql_failed'),{code:'jobber_graphql_failed',status:r.status,details:r.data?.errors||[]});
   return r.data.data;
  }
 };
}
