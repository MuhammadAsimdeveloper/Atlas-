import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
function equal(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);}
function basicOk(header,secret){if(typeof header!=='string'||!header.startsWith('Basic ')||typeof secret!=='string')return false;return equal(Buffer.from(header.slice(6),'base64').toString('utf8'),secret);}
function twilioOk({url,params,signature,secret}){if(typeof signature!=='string'||typeof secret!=='string')return false;const base=url+Object.keys(params||{}).sort().map(k=>k+k===''?'':k+String(params[k]??'')).join('');const digest=createHmac('sha1',secret).update(base).digest('base64');return equal(digest,signature);}
function metaOk(body,signature,secret){if(typeof signature!=='string'||!signature.startsWith('sha256=')||typeof secret!=='string')return false;const digest=createHmac('sha256',secret).update(body).digest('hex');return equal('sha256='+digest,signature);}
function headerValue(headers,name){return headers[String(name).toLowerCase()]||headers[name]||'';}
function safeRef(value,max=240){if(typeof value!=='string'||!value||value.length>max||/[\r\n]/.test(value))throw Object.assign(new Error('Webhook reference is invalid.'),{code:'webhook_payload_invalid'});return value;}
function payloadHash(raw){return createHash('sha256').update(raw).digest('hex');}
function postmarkHeaders(event){return Array.isArray(event.Headers)?event.Headers.reduce((a,h)=>{if(h?.Name)a[String(h.Name).toLowerCase()]=String(h.Value||'');return a;},{}):{};}
function firstAddress(value){if(Array.isArray(value)&&value[0]?.Email)return value[0].Email;return typeof value==='string'?value.split(',')[0].trim():null;}
export async function parseAndVerifyInboxWebhook({providerKey,endpoint,secret,rawBody,headers,url,query={}}){
 if(!endpoint?.enabled)throw Object.assign(new Error('Webhook endpoint is disabled.'),{code:'webhook_disabled'});
 if(providerKey==='postmark.email'&&!basicOk(headerValue(headers,'authorization'),secret))throw Object.assign(new Error('Postmark webhook authentication failed.'),{code:'webhook_auth_failed'});
 if(providerKey.startsWith('twilio.')&&!twilioOk({url,params:query,signature:headerValue(headers,'x-twilio-signature'),secret})){
   const contentType=String(headerValue(headers,'content-type')).toLowerCase();
   if(contentType.includes('application/x-www-form-urlencoded')){
     const params=Object.fromEntries(new URLSearchParams(rawBody));if(!twilioOk({url,params,signature:headerValue(headers,'x-twilio-signature'),secret}))throw Object.assign(new Error('Twilio webhook signature invalid.'),{code:'webhook_signature_invalid'});
   } else throw Object.assign(new Error('Twilio webhook signature invalid.'),{code:'webhook_signature_invalid'});
 }
 if(providerKey==='meta.whatsapp'&&!metaOk(rawBody,headerValue(headers,'x-hub-signature-256'),secret))throw Object.assign(new Error('WhatsApp webhook signature invalid.'),{code:'webhook_signature_invalid'});
 let event;try{event=JSON.parse(rawBody)}catch{event=Object.fromEntries(new URLSearchParams(rawBody));}
 const hash=payloadHash(rawBody);
 if(providerKey==='postmark.email'){
   const eventRef=safeRef(event.MessageID||event.RecordType==='Inbound'?'postmark-'+hash.slice(0,32):'');
   if(event.RecordType&&event.RecordType!=='Inbound'&&event.RecordType!=='Delivery'&&event.RecordType!=='Bounce'&&event.RecordType!=='SpamComplaint'&&event.RecordType!=='SubscriptionChange')return {kind:'ignored',payloadHash:hash,eventRef,eventType:String(event.RecordType)};
   if(event.RecordType&&event.RecordType!=='Inbound')return {kind:'receipt',payloadHash:hash,eventRef,eventType:String(event.RecordType),providerMessageRef:event.MessageID,status:event.RecordType==='Delivery'?'delivered':'failed',metadata:{description:String(event.Description||'').slice(0,240)}};
   const headersMap=postmarkHeaders(event),thread=headersMap['in-reply-to']||event.MessageID;
   return {kind:'message',payloadHash:hash,eventRef, eventType:'message.inbound',channel:'email',externalThreadRef:safeRef(thread),providerMessageRef:safeRef(event.MessageID),senderRef:firstAddress(event.FromFull)||event.From,recipientRef:firstAddress(event.ToFull)||event.To,subject:typeof event.Subject==='string'?event.Subject.slice(0,240):null,content:{text:String(event.StrippedTextReply||event.TextBody||'').slice(0,50000),html:typeof event.HtmlBody==='string'?event.HtmlBody.slice(0,50000):null,attachments:Array.isArray(event.Attachments)?event.Attachments.slice(0,20).map(a=>({name:String(a.Name||'').slice(0,120),contentType:String(a.ContentType||'').slice(0,120),size:Number(a.ContentLength)||0})):[]}};
 }
 if(providerKey.startsWith('twilio.')){
   const eventRef=safeRef(event.MessageSid||event.CallSid||'twilio-'+hash.slice(0,32));
   if(event.MessageStatus||event.SmsStatus)return {kind:'receipt',payloadHash:hash,eventRef,eventType:'message.status',providerMessageRef:event.MessageSid,status:{delivered:'delivered',read:'read',failed:'failed',undelivered:'failed',sent:'sent',queued:'queued'}[String(event.MessageStatus||event.SmsStatus).toLowerCase()]||'failed',metadata:{status:String(event.MessageStatus||event.SmsStatus)}};
   const channel=providerKey==='twilio.voice'?'voice':'sms';
   const senderRef=String(event.From||'').slice(0,120),recipientRef=String(event.To||'').slice(0,120);
   const thread=safeRef(senderRef+'>'+recipientRef);
   return {kind:'message',payloadHash:hash,eventRef,eventType:channel+'.inbound',channel,externalThreadRef:thread,providerMessageRef:eventRef,senderRef,recipientRef,subject:null,content:{text:channel==='voice'?'Inbound voice call':' '+String(event.Body||'').trim().slice(0,1600),html:null,twimlUrl:null}};
 }
 if(providerKey==='meta.whatsapp'){
   const value=event?.entry?.[0]?.changes?.[0]?.value||{},status=value?.statuses?.[0];
   if(status)return {kind:'receipt',payloadHash:hash,eventRef:safeRef(status.id||'meta-'+hash.slice(0,32)),eventType:'message.status',providerMessageRef:safeRef(status.id),status:{delivered:'delivered',read:'read',failed:'failed','sent':'sent'}[String(status.status).toLowerCase()]||'failed',metadata:{status:String(status.status)}};
   const msg=value?.messages?.[0];if(!msg) return {kind:'ignored',payloadHash:hash,eventRef:'meta-'+hash.slice(0,32),eventType:'whatsapp.event'};
   const to=value?.metadata?.display_phone_number||value?.metadata?.phone_number_id||'whatsapp';
   return {kind:'message',payloadHash:hash,eventRef:safeRef(msg.id),eventType:'whatsapp.inbound',channel:'whatsapp',externalThreadRef:safeRef(String(msg.from)+'>'+String(to)),providerMessageRef:safeRef(msg.id),senderRef:String(msg.from).slice(0,120),recipientRef:String(to).slice(0,120),subject:null,content:{text:String(msg?.text?.body||msg?.button?.text||msg?.interactive?.button_reply?.title||'').slice(0,4096),html:null}};
 }
 throw Object.assign(new Error('Inbox provider webhook is unsupported.'),{code:'webhook_provider_unsupported'});
}
