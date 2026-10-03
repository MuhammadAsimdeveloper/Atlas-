import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileDurableWorkflow,createExecution,checkpointExecution,resumeExecution,
  createQueueJob,claimQueueJob,heartbeatQueueJob,completeQueueJob,failQueueJob,
  createConnectorSdkDefinition,planConnectorInvocation
} from './index.mjs';

test('durable workflow compilation is deterministic and cycle-safe',()=>{
  const workflow=compileDurableWorkflow({
    tenantId:'t1',workflowId:'w1',name:'Lead sync',
    nodes:[{id:'tr',type:'manual_trigger'},{id:'http',type:'http_request',retry:{maxAttempts:2}}],
    edges:[{id:'e1',from:'tr',to:'http'}]
  });
  assert.equal(workflow.order.join(','),'tr,http');
  assert.equal(workflow.steps.length,2);
  assert.throws(()=>compileDurableWorkflow({
    tenantId:'t1',workflowId:'w2',name:'Cycle',
    nodes:[{id:'tr',type:'manual_trigger'},{id:'a',type:'set'}],
    edges:[{from:'tr',to:'a'},{from:'a',to:'tr'}]
  }),/cycle/);
});

test('execution checkpoints support deterministic resume without cross-release drift',()=>{
  const workflow=compileDurableWorkflow({
    tenantId:'t1',workflowId:'w1',name:'Flow',
    nodes:[{id:'tr',type:'manual_trigger'},{id:'a',type:'set'},{id:'b',type:'http_request'}],
    edges:[{from:'tr',to:'a'},{from:'a',to:'b'}]
  });
  const execution=createExecution({workflow,executionId:'ex1',idempotencyKey:'exec-12345678'});
  const after=checkpointExecution(execution,{expectedChecksum:execution.checksum,stepId:workflow.steps[0].stepId,stepResult:{ok:true}});
  const resumed=resumeExecution(after,{workflow,expectedChecksum:after.checksum});
  assert.equal(resumed.remainingSteps,2);
  assert.equal(resumed.nextStep.nodeId,'a');
});

test('queue leases prevent unowned completion and support retry/dead-letter',()=>{
  const job=createQueueJob({tenantId:'t1',executionId:'e1',stepId:'s1',maxAttempts:1,availableAt:'1970-01-01T00:00:00.000Z'});
  const store=new Map();
  const claimed=claimQueueJob(store,job,{workerId:'worker-a',nowMs:1000});
  assert.equal(claimed.status,'claimed');
  assert.equal(heartbeatQueueJob(store,job.jobId,{workerId:'worker-b',nowMs:2000}).status,'not_owned');
  assert.equal(completeQueueJob(store,job.jobId,{workerId:'worker-b',nowMs:2000}).status,'not_owned');
  const failed=failQueueJob(store,job.jobId,{workerId:'worker-a',nowMs:2000,errorCode:'TIMEOUT'});
  assert.equal(failed.status,'dead_letter');
});

test('connector SDK enforces scopes, idempotency and approval',()=>{
  const def=createConnectorSdkDefinition({
    provider:'stripe',category:'payments',apiVersion:'2026-01-28',
    operations:[{name:'payment.read',method:'GET',path:'/v1/payment_intents',risk:'read',scopes:['payments.read']},
                {name:'refund.create',method:'POST',path:'/v1/refunds',risk:'high',scopes:['refunds.write']}]
  });
  assert.equal(planConnectorInvocation({definition:def,tenantId:'t1',operation:'refund.create',grantedScopes:['refunds.write'],idempotencyKey:'refund-12345678'}).code,'APPROVAL_REQUIRED');
  const ok=planConnectorInvocation({definition:def,tenantId:'t1',operation:'payment.read',grantedScopes:['payments.read'],idempotencyKey:'read-12345678'});
  assert.equal(ok.allowed,true);
});
