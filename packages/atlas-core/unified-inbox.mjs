import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF=/^[A-Za-z0-9_.:/@+\-]{1,240}$/;
const CHANNELS=new Set(['email','sms','whatsapp','voice','webchat']);
const DIRECTIONS=new Set(['inbound','outbound','system']);
const STATUSES=new Set(['queued','sending','sent','delivered','read','failed','blocked']);
export function assertUuid(value,label='id'){if(!UUID.test(value||''))throw Object.assign(new Error(label+' is invalid'),{code:'inbox_invalid_'+label});return value;}
export function assertChannel(value){if(typeof value!=='string'||!CHANNELS.has(value))throw Object.assign(new Error('Unsupported inbox channel.'),{code:'inbox_channel_invalid'});return value;}
export function normalizeThreadRef({channel,externalThreadRef}){assertChannel(channel);if(typeof externalThreadRef!=='string'||!externalThreadRef.trim()||externalThreadRef.length>240)throw Object.assign(new Error('External thread reference is invalid.'),{code:'inbox_thread_invalid'});return externalThreadRef.trim();}
export function threadKey({channel,externalThreadRef}){return createHash('sha256').update(channel+'\\0'+normalizeThreadRef({channel,externalThreadRef})).digest('hex');}
export function normalizeMessageInput(input={}){
 const channel=assertChannel(input.channel), direction=input.direction;
 if(!DIRECTIONS.has(direction))throw Object.assign(new Error('Message direction is invalid.'),{code:'inbox_direction_invalid'});
 if(input.externalThreadRef!=null)normalizeThreadRef({channel,externalThreadRef:input.externalThreadRef});
 if(input.providerMessageRef!=null&&(!REF.test(String(input.providerMessageRef))||String(input.providerMessageRef).length>240))throw Object.assign(new Error('Provider message reference is invalid.'),{code:'inbox_provider_ref_invalid'});
 if(input.contentRef!=null&&(!REF.test(String(input.contentRef))||String(input.contentRef).length>240))throw Object.assign(new Error('Message content reference is invalid.'),{code:'inbox_content_ref_invalid'});
 return Object.freeze({channel,direction,externalThreadRef:input.externalThreadRef?.trim()||null,providerMessageRef:input.providerMessageRef||null,contentRef:input.contentRef||null,senderRef:input.senderRef||null,recipientRef:input.recipientRef||null,subject:typeof input.subject==='string'?input.subject.slice(0,240):null});
}
export function deliveryTransition(from,to){if(!STATUSES.has(to))throw new TypeError('Delivery status is invalid.');const allowed={queued:new Set(['sending','blocked']),sending:new Set(['sent','failed','blocked']),sent:new Set(['delivered','read','failed']),delivered:new Set(['read']),read:new Set([]),failed:new Set([]),blocked:new Set([])};if(from!==to&&!allowed[from]?.has(to))throw Object.assign(new Error('Invalid delivery status transition.'),{code:'inbox_status_transition_invalid'});return to;}
export function buildOutboundIdempotencyKey({tenantId,conversationId,channel,clientKey}){assertUuid(tenantId,'tenantId');assertUuid(conversationId,'conversationId');assertChannel(channel);if(typeof clientKey!=='string'||clientKey.length<8||clientKey.length>180||/[\r\n]/.test(clientKey))throw Object.assign(new Error('Client idempotency key is invalid.'),{code:'inbox_idempotency_invalid'});return createHash('sha256').update(JSON.stringify({tenantId,conversationId,channel,clientKey})).digest('hex');}
export function providerEventKey({providerKey,eventRef,payloadHash}){if(!REF.test(providerKey||'')||!REF.test(eventRef||'')||!/^[a-f0-9]{64}$/.test(payloadHash||''))throw new TypeError('Provider event identity is invalid.');return createHash('sha256').update(providerKey+'\\0'+eventRef+'\\0'+payloadHash).digest('hex');}
