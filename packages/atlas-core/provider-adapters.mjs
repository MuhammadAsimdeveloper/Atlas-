import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
const PROVIDER=/^[a-z][a-z0-9_.-]{1,79}$/;
const URL_OK=/^https:\/\//i;
const SECRET_REF=/^[A-Za-z0-9_.:/-]{8,240}$/;
export function validateProviderAdapter(adapter){
 if(!adapter||typeof adapter!=='object'||!PROVIDER.test(adapter.key||'')||typeof adapter.send!=='function') throw new TypeError('A provider adapter must expose a bounded key and send function.');
 return Object.freeze(adapter);
}
export function assertSafeProviderUrl(raw,{allowHosts=[]}={}){
 let u; try{u=new URL(raw)}catch{throw Object.assign(new Error('Provider URL is invalid.'),{code:'provider_url_invalid'});}
 if(!URL_OK.test(u.href)||u.username||u.password||u.port&&![443].includes(Number(u.port))) throw Object.assign(new Error('Provider URL is not allowed.'),{code:'provider_url_blocked'});
 if(u.hostname==='localhost'||u.hostname.endsWith('.localhost')||/^(127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)||u.hostname==='::1'||u.hostname==='0.0.0.0') throw Object.assign(new Error('Private provider address is blocked.'),{code:'provider_url_private'});
 if(allowHosts.length && !allowHosts.includes(u.hostname)) throw Object.assign(new Error('Provider host is not allowlisted.'),{code:'provider_host_not_allowed'});
 return u;
}
export function buildIdempotencyKey({tenantId,action,resourceId,attempt=1}){return createHash('sha256').update(JSON.stringify({tenantId,action,resourceId,attempt})).digest('hex');}
export async function executeProviderAction({adapter,request,fetchImpl=fetch,signal}){
 const a=validateProviderAdapter(adapter);
 const result=await a.send(Object.freeze({...request}),{fetchImpl,signal});
 if(!result||typeof result!=='object'||typeof result.status!=='string') throw Object.assign(new Error('Provider adapter returned an invalid result.'),{code:'provider_result_invalid'});
 return Object.freeze({...result});
}
export function verifyWebhookSignature({body,signature,secret,toleranceMs=300000,now=Date.now()}){
 if(typeof body!=='string'||typeof signature!=='string'||!SECRET_REF.test(secret||'')) return false;
 const [scheme,timestamp,digest]=signature.split('.',3);
 if(scheme!=='v1'||!/^\d+$/.test(timestamp)||typeof digest!=='string') return false;
 const age=Math.abs(now-Number(timestamp)); if(!Number.isFinite(age)||age>toleranceMs) return false;
 const expected=createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');
 const a=Buffer.from(expected,'utf8'),b=Buffer.from(digest,'utf8'); return a.length===b.length&&timingSafeEqual(a,b);
}
export function redactProviderError(error){
 const message=String(error?.message||'provider_failed').replace(/https?:\/\/[^\s]+/gi,'[url]').replace(/(bearer|token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,'$1=[redacted]');
 return message.slice(0,240);
}
