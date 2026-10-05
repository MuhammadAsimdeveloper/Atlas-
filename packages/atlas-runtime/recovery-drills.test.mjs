import test from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryDrillRunner, simulateRecoveryScenario, buildDrillEvidence } from './recovery-drills.mjs';

test('all recovery simulations match expected failover behavior',()=>{
  for(const scenario of ['worker_crash','redis_failure','postgres_failure','duplicate_execution','split_brain']){
    const result=simulateRecoveryScenario(scenario);assert.equal(result.expected,result.observed);
  }
});

test('drill runner persists bounded evidence and final result',async()=>{
  const calls=[];
  const store={
    async startRecoveryDrill(x){calls.push(['start',x]);},
    async recordRecoveryDrillStep(x){calls.push(['step',x]);},
    async finishRecoveryDrill(x){calls.push(['finish',x]);}
  };
  const runner=new RecoveryDrillRunner({store});
  const result=await runner.run({drillId:'d1',poolId:'pool',scenario:'redis_failure'});
  assert.equal(result.status,'passed');
  assert.equal(result.evidenceSha256.length,64);
  assert.equal(calls[1][1].status,'passed');
  assert.equal(calls[2][1].status,'passed');
});

test('drill evidence is deterministic',()=>{
  const a=buildDrillEvidence({drillId:'d',poolId:'p',scenario:'redis_failure',steps:[{action:'verify',status:'passed'}]});
  const b=buildDrillEvidence({drillId:'d',poolId:'p',scenario:'redis_failure',steps:[{action:'verify',status:'passed'}]});
  assert.equal(a.evidenceSha256,b.evidenceSha256);
});
