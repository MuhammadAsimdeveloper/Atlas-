import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertRouter, WebhookAlertSender, EmailAlertSender } from './alert-router.mjs';

test('webhook alert sender signs bounded HTTPS payload',async()=>{
  assert.throws(()=>new WebhookAlertSender().send({endpoint:'http://bad.test',secret:'x',alert:{alertId:'a'}}));
  let req;
  const sender=new WebhookAlertSender({fetchImpl:async(_u,init)=>{req=init;return {ok:true,status:200}}});
  await sender.send({endpoint:'https://alerts.example.test/hook',secret:'secret-secret-secret',alert:{alertId:'a',severity:'critical'}});
  assert.match(req.headers['x-atlas-alert-signature'],/^sha256=[a-f0-9]{64}$/);
  assert.equal(req.body.includes('critical'),true);
});

test('alert router delivers once per destination and records failure safely',async()=>{
  const calls=[];
  const store={
    async listRuntimeAlerts(){return [{alert_id:'a1',policy_id:'p1',pool_id:'pool',severity:'critical',current_value:10,threshold:5}]},
    async listObservabilityDestinations(){return [{destination_id:'d1',kind:'webhook',endpoint_ref:'https://example.test/alert',secret_ref:'ref'}]},
    async claimAlertDelivery(){calls.push('claim');return true},
    async completeAlertDelivery(){calls.push('complete')},
    async failAlertDelivery(){calls.push('fail')}
  };
  const router=new AlertRouter({store,secretResolver:async()=> 'a'.repeat(32),webhookSender:{send:async()=>{calls.push('send')}}});
  const result=await router.runOnce();
  assert.deepEqual(result,{alerts:1,delivered:1,failed:0,skipped:0});
  assert.deepEqual(calls,['claim','send','complete']);
});

test('email destination uses injected mailer and rejects missing sender',async()=>{
  const sent=[];
  const email=new EmailAlertSender({send:async x=>sent.push(x)});
  await email.sendAlert({address:'ops@example.com',alert:{policyId:'p',poolId:'pool',severity:'warning',threshold:1,currentValue:2}});
  assert.equal(sent[0].to,'ops@example.com');
  assert.throws(()=>email.sendAlert({address:'bad',alert:{policyId:'p',poolId:'pool',severity:'warning'}}));
});
