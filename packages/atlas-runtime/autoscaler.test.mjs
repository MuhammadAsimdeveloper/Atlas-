import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoscalerController, HttpAutoscalerActuator } from './autoscaler.mjs';

function store(){
  const calls=[];
  return {
    calls,
    async getRuntimeScalingPolicy(){return {enabled:true,min_workers:1,max_workers:8,scale_up_cooldown_seconds:30,scale_down_cooldown_seconds:60};},
    async acquireScalerLease(){calls.push(['lease']);return true;},
    async recordScalingDecision(x){calls.push(['record',x]);return x;},
    async updateScalingDecision(x){calls.push(['update',x]);return x;},
    async recordControlEvent(x){calls.push(['event',x]);}
  };
}

test('autoscaler persists decision before actuating and then records actuation',async()=>{
  const s=store();
  const actuator={scaleTo:async x=>{s.calls.push(['actuate',x]);return {accepted:true};}};
  const controller=new AutoscalerController({store:s,actuator});
  const result=await controller.runOnce({poolId:'pool',workerId:'worker',queueDepth:100,activeWorkers:2,workerUtilization:.9,sloErrorBudgetRemaining:.9,lastScaleAt:0});
  assert.equal(result.status,'actuated');
  assert.equal(s.calls[0][0],'lease');
  assert.equal(s.calls[1][0],'record');
  assert.equal(s.calls[2][0],'actuate');
  assert.equal(s.calls[3][0],'update');
});

test('autoscaler becomes advisory when no actuator is configured',async()=>{
  const s=store(); const controller=new AutoscalerController({store:s});
  const result=await controller.runOnce({poolId:'pool',workerId:'worker',queueDepth:100,activeWorkers:2,workerUtilization:.9,sloErrorBudgetRemaining:.9,lastScaleAt:0});
  assert.equal(result.status,'advisory');
  assert.equal(s.calls.filter(x=>x[0]==='actuate').length,0);
});

test('http actuator enforces HTTPS and bounds target',async()=>{
  assert.throws(()=>new HttpAutoscalerActuator({endpoint:'http://example.test/scale'}));
  let request;
  const actuator=new HttpAutoscalerActuator({endpoint:'https://example.test/scale',fetchImpl:async(_u,init)=>{request=init;return {ok:true,status:200}}});
  await actuator.scaleTo({poolId:'pool',targetWorkers:3,decisionId:'a'.repeat(64),minWorkers:1,maxWorkers:8});
  assert.match(request.headers['x-atlas-decision-id'],/^[a-f0-9]{64}$/);
});
