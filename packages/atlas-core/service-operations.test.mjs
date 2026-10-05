import test from 'node:test';import assert from 'node:assert/strict';import {validateServiceRequest,validateVisit,validateQuote,validateInvoice,transitionJob,buildJobberWebhookEvent,buildZapierHookEvent} from './service-operations.mjs';
test('validates a service request with safe defaults',()=>{const x=validateServiceRequest({title:'HVAC inspection'});assert.equal(x.status,'requested');assert.equal(x.priority,'normal')});
test('rejects invalid visit windows',()=>assert.throws(()=>validateVisit({jobId:'11111111-1111-4111-8111-111111111111',startsAt:'2026-10-05T10:00:00Z',endsAt:'2026-10-05T09:00:00Z'}),/visit_window_invalid/));
test('calculates quote subtotal deterministically',()=>assert.equal(validateQuote({title:'Repair',items:[{name:'Labor',quantity:2,unitPriceMinor:12500}]}).subtotalMinor,25000));
test('calculates invoice total without floating point currency',()=>assert.equal(validateInvoice({items:[{name:'Service',quantity:1,unitPriceMinor:9999}]}).totalMinor,9999));
test('enforces job lifecycle transitions',()=>{assert.equal(transitionJob('requested','scheduled'),'scheduled');assert.throws(()=>transitionJob('requested','completed'),/service_status_transition_invalid/)});
test('normalizes Jobber webhook envelopes without trusting payload instructions',()=>assert.deepEqual(buildJobberWebhookEvent({data:{webHookEvent:{topic:'CLIENT_CREATE',accountId:'acct',itemId:'1',occurredAt:'2026-10-05T10:00:00Z'}}}).provider,'jobber'));
test('requires explicit event type for Zapier hooks',()=>assert.throws(()=>buildZapierHookEvent({x:1}),/event_type_invalid/));
