import test from 'node:test';
import assert from 'node:assert/strict';
import { assertIanaTimezone, nextCronOccurrence, nextIntervalOccurrence, evaluatePredicate, routeEvent, eventDedupKey, actionAllowed, createPromotionManifest, canPromote } from './production-frontier.mjs';

test('production frontier scheduling validates IANA zones and advances cron', () => {
  assert.equal(assertIanaTimezone('UTC'), 'UTC');
  assert.match(nextCronOccurrence({expression:'*/15 * * * *',timezone:'UTC',after:new Date('2026-01-01T00:00:00Z')}), /^2026-01-01T00:15:00\.000Z$/);
  assert.equal(nextIntervalOccurrence({expression:'60',after:new Date('2026-01-01T00:00:00Z')}),'2026-01-01T00:01:00.000Z');
});

test('event routing supports bounded predicates and deterministic priority', () => {
  const event={customer:{tier:'gold'},amount:250};
  assert.equal(evaluatePredicate(event,{all:[{path:'customer.tier',equals:'gold'},{path:'amount',gte:200}]}),true);
  const routes=routeEvent({event,routes:[
    {route_id:'low',priority:1,enabled:true,predicate:{path:'amount',gte:100}},
    {route_id:'high',priority:10,enabled:true,predicate:{path:'customer.tier',equals:'gold'}}
  ]});
  assert.deepEqual(routes.map(r=>r.route_id),['high','low']);
});

test('dedup and promotion hashes are stable and approval is mandatory', () => {
  const a=eventDedupKey({tenantId:'t',eventType:'x',eventRef:'r',payloadHash:'h'});
  assert.equal(a,eventDedupKey({tenantId:'t',eventType:'x',eventRef:'r',payloadHash:'h'}));
  assert.equal(actionAllowed({riskClass:'financial',requiresApproval:true,approved:false,capabilityVerified:true}),false);
  assert.equal(actionAllowed({riskClass:'financial',requiresApproval:true,approved:true,capabilityVerified:true}),true);
  const m=createPromotionManifest({workflowId:'w',version:1,payload:{a:1}});
  assert.equal(canPromote({sourceStage:'staging',targetStage:'production',approved:true,manifestSha256:m.sha256}),true);
});
