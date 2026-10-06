import crypto from 'node:crypto';

const REF=/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}$/;
const HASH=/^[a-f0-9]{64}$/;
const CHANNELS=new Set(['webchat','email','sms','whatsapp','voice']);
const MAX_TOKEN_BYTES=4096;
const MAX_TTL_MS=24*60*60_000;

function ref(v,l){if(typeof v!=='string'||!REF.test(v))throw new TypeError(l+' must be a bounded reference');return v;}
function bounded(v,l,max=200){if(typeof v!=='string'||!v.trim()||v.length>max||/[\r\n\u0000]/.test(v))throw new TypeError(l+' is invalid');return v.trim();}
function hash(v,l){if(typeof v!=='string'||!HASH.test(v))throw new TypeError(l+' must be SHA-256');return v;}
function canonical(v){return v&&typeof v==='object'?Array.isArray(v)?v.map(canonical):Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
function sha(v){return crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');}
function hmac(secret,value){return crypto.createHmac('sha256',secret).update(value).digest('base64url');}
function secret(v){if(typeof v!=='string'||Buffer.byteLength(v)<32)throw new TypeError('support session secret must be at least 32 bytes');return v;}

export function createSupportSessionClaims({tenantId,agentReleaseRef,channel='webchat',customerRef=null,sessionId,issuedAt=Date.now(),ttlMs=60*60_000,scope='customer_support'}={}){
 ref(tenantId,'tenantId');ref(agentReleaseRef,'agentReleaseRef');ref(sessionId,'sessionId');
 if(!CHANNELS.has(channel))throw new TypeError('unsupported support channel');
 if(customerRef!==null)ref(customerRef,'customerRef');
 if(!Number.isSafeInteger(issuedAt)||issuedAt<0)throw new TypeError('issuedAt invalid');
 if(!Number.isSafeInteger(ttlMs)||ttlMs<60_000||ttlMs>MAX_TTL_MS)throw new TypeError('ttlMs out of bounds');
 if(scope!=='customer_support')throw new TypeError('unsupported support session scope');
 const claims={v:1,scope,tenantId,agentReleaseRef,channel,customerRef,sessionId,iat:issuedAt,exp:issuedAt+ttlMs,jti:crypto.randomUUID()};
 return Object.freeze({...claims,claimsHash:sha(claims)});
}

export function issueSupportSessionToken({claims,secret:sessionSecret}={}){
 const key=secret(sessionSecret);
 if(!claims||claims.scope!=='customer_support'||sha(Object.fromEntries(Object.entries(claims).filter(([k])=>k!=='claimsHash')))!==claims.claimsHash)throw new Error('support claims checksum invalid');
 const payload=Buffer.from(JSON.stringify(claims),'utf8').toString('base64url');
 return payload+'.'+hmac(key,payload);
}

export function verifySupportSessionToken({token,secret:sessionSecret,now=Date.now(),replayGuard=null}={}){
 const key=secret(sessionSecret);
 if(typeof token!=='string'||Buffer.byteLength(token)>MAX_TOKEN_BYTES)throw new Error('support session token invalid');
 const dot=token.lastIndexOf('.');if(dot<20)throw new Error('support session token malformed');
 const payload=token.slice(0,dot),signature=token.slice(dot+1);
 const expected=hmac(key,payload);
 const a=Buffer.from(signature),b=Buffer.from(expected);
 if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw new Error('support session token signature invalid');
 let claims;try{claims=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));}catch{throw new Error('support session token payload invalid');}
 if(claims?.v!==1||claims?.scope!=='customer_support'||claims?.claimsHash!==sha(Object.fromEntries(Object.entries(claims).filter(([k])=>k!=='claimsHash')))||!REF.test(claims.tenantId)||!REF.test(claims.agentReleaseRef)||!REF.test(claims.sessionId)||!CHANNELS.has(claims.channel))throw new Error('support session claims invalid');
 if(!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||claims.exp<=Number(now)||claims.iat>Number(now)+60_000||claims.exp-claims.iat>MAX_TTL_MS)throw new Error('support session expired or invalid');
 if(replayGuard?.has(claims.jti))throw new Error('support session replayed');
 return Object.freeze(claims);
}

export function validateSupportTurnInput({claims,sessionId,message,messageHash,now=Date.now(),maxMessageChars=8000}={}){
 if(!claims||claims.scope!=='customer_support')throw new Error('support session claims required');
 ref(sessionId,'sessionId');if(sessionId!==claims.sessionId)throw new Error('support session mismatch');
 const text=bounded(message,'message',maxMessageChars);hash(messageHash,'messageHash');
 if(sha(text)!==messageHash)throw new Error('messageHash mismatch');
 if(Number(now)>=claims.exp)throw new Error('support session expired');
 return Object.freeze({tenantId:claims.tenantId,agentReleaseRef:claims.agentReleaseRef,channel:claims.channel,sessionId:claims.sessionId,customerRef:claims.customerRef,messageHash,rawMessageStored:false,acceptedAt:new Date(Number(now)).toISOString()});
}

export function createSupportTurnEnqueueRequest({turn,executionId,planId}={}){
 if(!turn||!turn.tenantId||!turn.sessionId||!turn.messageHash)throw new TypeError('validated support turn required');
 ref(executionId,'executionId');ref(planId,'planId');
 return Object.freeze({tenantId:turn.tenantId,sessionId:turn.sessionId,executionId,planId,inputRef:'support:'+turn.sessionId+':'+turn.messageHash.slice(0,24),messageHash:turn.messageHash,channel:turn.channel,rawMessageStored:false});
}
