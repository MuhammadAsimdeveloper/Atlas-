import { createModelAdapter } from '../../../packages/atlas-agent-fabric/model-runtime.mjs';

function assertHttpsUrl(value){
  const url=new URL(value);
  if(url.protocol!=='https:') throw Object.assign(new Error('Model base URL must use HTTPS'),{code:'model_base_url_invalid'});
  return url;
}
function parseAllowlist(raw){
  if(typeof raw!=='string'||!raw.trim()) throw Object.assign(new Error('ATLAS_MODEL_BASE_URL_ALLOWLIST is required'),{code:'model_base_url_not_allowlisted'});
  return raw.split(',').map(x=>x.trim()).filter(Boolean).map(assertHttpsUrl);
}
function allowedBaseUrl(){
  const target=assertHttpsUrl(process.env.ATLAS_MODEL_BASE_URL||'');
  const allow=parseAllowlist(process.env.ATLAS_MODEL_BASE_URL_ALLOWLIST);
  if(!allow.some(item=>item.origin===target.origin)) throw Object.assign(new Error('Model base URL is not allowlisted'),{code:'model_base_url_not_allowlisted'});
  return target.toString().replace(/\/$/,'');
}
async function loadSecretResolver(){
  const moduleName=process.env.ATLAS_WORKER_SECRET_RESOLVER_MODULE;
  if(!moduleName||!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.mjs$/.test(moduleName)) throw Object.assign(new Error('ATLAS_WORKER_SECRET_RESOLVER_MODULE is required'),{code:'model_secret_resolver_unavailable'});
  const {pathToFileURL,fileURLToPath}=await import('node:url'); const path=(await import('node:path')).default;
  const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../secrets');
  const target=path.resolve(base,moduleName);
  if(!target.startsWith(base+path.sep)) throw Object.assign(new Error('Secret resolver path is invalid'),{code:'model_secret_resolver_path_invalid'});
  const loaded=await import(pathToFileURL(target).href);
  if(typeof loaded.resolveSecret!=='function') throw Object.assign(new Error('Secret resolver contract is invalid'),{code:'model_secret_resolver_invalid'});
  return loaded.resolveSecret;
}
const baseUrl=process.env.ATLAS_MODEL_TURN_EXECUTOR_ENABLED==='true'?allowedBaseUrl():null;
const resolveSecret=process.env.ATLAS_MODEL_TURN_EXECUTOR_ENABLED==='true'?await loadSecretResolver():null;

function toMessages(input){
  const history=Array.isArray(input?.history)?input.history.slice(-20):[];
  const prompt=typeof input?.prompt==='string'?input.prompt:'';
  if(!prompt.trim()) throw Object.assign(new Error('Model prompt is unavailable'),{code:'model_input_invalid'});
  return [...history.map(item=>({role:item?.role==='assistant'?'assistant':'user',content:typeof item?.content==='string'?item.content.slice(0,12000):''})).filter(x=>x.content),{role:'user',content:prompt.slice(0,12000)}];
}

function normalizeResponse(json){
  const message=json?.choices?.[0]?.message;
  const toolCalls=Array.isArray(message?.tool_calls)?message.tool_calls.map(call=>({name:call?.function?.name,arguments:typeof call?.function?.arguments==='string'?JSON.parse(call.function.arguments||'{}'):(call?.function?.arguments||{})})).filter(call=>typeof call.name==='string').slice(0,20):[];
  const output=message?.content ?? null;
  return {output,toolCalls,finishReason:json?.choices?.[0]?.finish_reason||'stop',usage:{inputTokens:Number(json?.usage?.prompt_tokens)||0,outputTokens:Number(json?.usage?.completion_tokens)||0}};
}

export async function getModelAdapter({tenantId,release}={}){
  if(!baseUrl||!resolveSecret) throw Object.assign(new Error('Model provider is not activated'),{code:'model_provider_unavailable'});
  const credentialRef=release?.modelPolicy?.credentialRef||process.env.ATLAS_MODEL_SECRET_REF;
  if(typeof credentialRef!=='string'||credentialRef.length<3||credentialRef.length>180) throw Object.assign(new Error('Model credentialRef is required'),{code:'model_credential_missing'});
  const model=release?.modelPolicy?.model||process.env.ATLAS_MODEL_NAME;
  if(typeof model!=='string'||model.length<1||model.length>160) throw Object.assign(new Error('Model name is required'),{code:'model_name_missing'});
  const secret=await resolveSecret({tenantId,credentialRef,purpose:'model'});
  if(typeof secret!=='string'||!secret) throw Object.assign(new Error('Model credential is unavailable'),{code:'model_secret_unavailable'});
  return createModelAdapter({
    provider:release.modelPolicy.provider,
    version:1,
    infer:async({request,input,signal})=>{
      const response=await fetch(baseUrl+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+secret},body:JSON.stringify({model,messages:toMessages(input),temperature:0,stream:false}),signal});
      if(!response.ok) throw Object.assign(new Error('Model provider request failed with HTTP '+response.status),{code:'model_provider_http'});
      return normalizeResponse(await response.json());
    },
    stream:async function*({request,input,signal}){
      const response=await fetch(baseUrl+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+secret},body:JSON.stringify({model,messages:toMessages(input),temperature:0,stream:true}),signal});
      if(!response.ok) throw Object.assign(new Error('Model provider stream failed with HTTP '+response.status),{code:'model_provider_http'});
      if(!response.body) throw Object.assign(new Error('Model provider returned no stream body'),{code:'model_provider_stream_missing'});
      const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer='';
      try {
        while(true){
          const {value,done}=await reader.read(); if(done) break;
          buffer+=decoder.decode(value,{stream:true});
          const lines=buffer.split(/\r?\n/);
          buffer=lines.pop() || '';
          for(const line of lines){
            const trimmed=line.trim();
            if(!trimmed||!trimmed.startsWith('data:')) continue;
            const data=trimmed.slice(5).trim();
            if(data==='[DONE]') return;
            const json=JSON.parse(data); const delta=json?.choices?.[0]?.delta?.content;
            if(delta) yield {delta:String(delta)};
            if(json?.choices?.[0]?.finish_reason) yield {done:true,finishReason:json.choices[0].finish_reason};
          }
        }
      } finally { reader.releaseLock?.(); }
    }
  });
}
export const getModelAdapterReady=Boolean(baseUrl&&resolveSecret);
