import {assertSafeProviderUrl,validateProviderAdapter,redactProviderError} from '../../packages/atlas-core/provider-adapters.mjs';

async function jsonCall({url,headers,body,fetchImpl=fetch,signal}){
 const response=await fetchImpl(url,{method:'POST',headers:{accept:'application/json','content-type':'application/json',...headers},body:JSON.stringify(body),signal});
 const text=await response.text();
 let data={};try{data=text?JSON.parse(text):{};}catch{}
 if(!response.ok) throw Object.assign(new Error(redactProviderError(new Error(data?.message||('provider_http_'+response.status)))),{code:'provider_http_'+response.status});
 return data;
}
function requireSecret(value){if(typeof value!=='string'||value.length<8||value.length>400)throw Object.assign(new Error('Provider secret reference resolved to an invalid value.'),{code:'provider_secret_invalid'});return value;}

export function createPostmarkAdapter({serverToken,fetchImpl=fetch,baseUrl='https://api.postmarkapp.com'}={}){
 const token=requireSecret(serverToken);assertSafeProviderUrl(baseUrl,{allowHosts:['api.postmarkapp.com']});
 return validateProviderAdapter({key:'postmark.email',channel:'email',send:async(req,{signal})=>{const data=await jsonCall({url:baseUrl+'/email',headers:{'X-Postmark-Server-Token':token},body:{From:req.from,To:req.to,Subject:req.subject,TextBody:req.textBody,HtmlBody:req.htmlBody,MessageStream:req.messageStream||'outbound'},fetchImpl,signal});return {status:'sent',providerRef:data.MessageID||null};}});
}
export function createTwilioMessagingAdapter({accountSid,authToken,from,fetchImpl=fetch,baseUrl='https://api.twilio.com'}={}){
 const sid=requireSecret(accountSid),token=requireSecret(authToken),sender=requireSecret(from);assertSafeProviderUrl(baseUrl,{allowHosts:['api.twilio.com']});
 return validateProviderAdapter({key:'twilio.sms',channel:'sms',send:async(req,{signal})=>{const form=new URLSearchParams({To:req.to,From:sender,Body:req.body});const response=await fetchImpl(baseUrl+'/2010-04-01/Accounts/'+encodeURIComponent(sid)+'/Messages.json',{method:'POST',headers:{authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64'),'content-type':'application/x-www-form-urlencoded'},body:form,signal});const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error('Twilio SMS failed'),{code:'provider_http_'+response.status});return {status:'sent',providerRef:data.sid||null};}});
}
export function createTwilioVoiceAdapter({accountSid,authToken,from,fetchImpl=fetch,baseUrl='https://api.twilio.com'}={}){
 const sid=requireSecret(accountSid),token=requireSecret(authToken),sender=requireSecret(from);assertSafeProviderUrl(baseUrl,{allowHosts:['api.twilio.com']});
 return validateProviderAdapter({key:'twilio.voice',channel:'voice',send:async(req,{signal})=>{const form=new URLSearchParams({To:req.to,From:sender,Url:req.twimlUrl});const response=await fetchImpl(baseUrl+'/2010-04-01/Accounts/'+encodeURIComponent(sid)+'/Calls.json',{method:'POST',headers:{authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64'),'content-type':'application/x-www-form-urlencoded'},body:form,signal});const data=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error('Twilio voice call failed'),{code:'provider_http_'+response.status});return {status:'sent',providerRef:data.sid||null};}});
}
export function createWhatsAppCloudAdapter({accessToken,phoneNumberId,fetchImpl=fetch,baseUrl='https://graph.facebook.com'}={}){
 const token=requireSecret(accessToken),phone=requireSecret(phoneNumberId);assertSafeProviderUrl(baseUrl,{allowHosts:['graph.facebook.com']});
 return validateProviderAdapter({key:'meta.whatsapp',channel:'whatsapp',send:async(req,{signal})=>{const data=await jsonCall({url:baseUrl+'/v20.0/'+encodeURIComponent(phone)+'/messages',headers:{authorization:'Bearer '+token},body:{messaging_product:'whatsapp',to:req.to,type:'text',text:{body:req.body}},fetchImpl,signal});return {status:'sent',providerRef:data?.messages?.[0]?.id||null};}});
}
