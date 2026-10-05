import {createHash} from 'node:crypto';import {verifyWebhookSignature} from '../../packages/atlas-core/provider-adapters.mjs';
const EVENT=/^[a-z][a-z0-9_.-]{1,79}$/;
export function normalizeEvent({tenantId,eventType,eventRef,source='internal',occurredAt=new Date().toISOString()}){
 if(typeof tenantId!=='string'||!tenantId)throw new TypeError('tenantId is required');if(!EVENT.test(eventType||''))throw Object.assign(new Error('event type invalid'),{code:'event_type_invalid'});
 if(typeof eventRef!=='string'||eventRef.length<1||eventRef.length>180||/[\r\n]/.test(eventRef))throw Object.assign(new Error('event reference invalid'),{code:'event_ref_invalid'});
 if(!Number.isFinite(Date.parse(occurredAt)))throw Object.assign(new Error('event timestamp invalid'),{code:'event_timestamp_invalid'});
 return Object.freeze({tenantId,eventType,eventRef,source,occurredAt,idempotencyKey:createHash('sha256').update(JSON.stringify({tenantId,eventType,eventRef})).digest('hex')});
}
export function verifyInboundWebhook({tenantId,eventType,eventRef,body,signature,secret,now=Date.now()}){
 if(!verifyWebhookSignature({body,signature,secret,now}))throw Object.assign(new Error('Webhook signature invalid.'),{code:'webhook_signature_invalid'});
 return normalizeEvent({tenantId,eventType,eventRef,source:'webhook'});
}
export function scheduledEvent({tenantId,eventType,scheduleId,runAt}){return normalizeEvent({tenantId,eventType,eventRef:'schedule_'+scheduleId,source:'schedule',occurredAt:new Date(runAt).toISOString()});}
