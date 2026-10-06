import test from 'node:test';
import assert from 'node:assert/strict';
import {executeN8nNode,createNodeExecutionEnvelope} from './node-runtime.mjs';
const T='11111111-1111-4111-8111-111111111111';
const base={tenantId:T,id:'node-123',config:{}};
test('V151 n8n node runtime bounds and implements collection nodes',()=>{
 const input=[{id:1,tags:['a','b'],score:2},{id:2,tags:['b'],score:1},{id:2,tags:['c'],score:3}];
 assert.equal(executeN8nNode({tenantId:T,node:{...base,type:'remove_duplicates',config:{key:'id'}},input}).items.length,2);
 assert.deepEqual(executeN8nNode({tenantId:T,node:{...base,type:'sort',config:{key:'score'}},input}).items.map(x=>x.score),[1,2,3]);
 assert.equal(executeN8nNode({tenantId:T,node:{...base,type:'split_out',config:{field:'tags'}},input}).items.length,6);
});
test('V151 condition/switch/wait/stop are deterministic and side-effect free',()=>{
 const condition=executeN8nNode({tenantId:T,node:{...base,type:'condition',config:{key:'score',value:2}},input:[{score:2}]});
 assert.equal(condition.control.branch,'true');
 const sw=executeN8nNode({tenantId:T,node:{...base,type:'switch',config:{key:'score',cases:[{value:2,branch:'qualified'}],defaultBranch:'other'}},input:[{score:2}]});
 assert.equal(sw.control.branch,'qualified');
 const wait=executeN8nNode({tenantId:T,node:{...base,type:'wait',config:{waitMs:1000}},input:[{}],now:Date.parse('2026-10-06T00:00:00Z')});
 assert.equal(wait.control.resumeAt,'2026-10-06T00:00:01.000Z');
 assert.equal(executeN8nNode({tenantId:T,node:{...base,type:'stop_and_error',config:{errorCode:'policy.stop'}},input:[]}).control.status,'failed');
});
test('V151 execution data is reference-safe and envelopes are redacted',()=>{
 const result=executeN8nNode({tenantId:T,node:{...base,type:'execution_data',config:{key:'source',value:'crm'}},input:[{id:1}]});
 assert.equal(result.items[0].executionData.source,'crm');
 const envelope=createNodeExecutionEnvelope({tenantId:T,workflowId:'workflow-123',executionId:'exec-123',nodeId:'node-123',nodeType:'execution_data',inputCount:1,outputCount:1,control:result.control});
 assert.equal(envelope.tenantId,T);assert.equal(typeof envelope.evidenceHash,'string');assert.equal('payload' in envelope,false);
});
test('V151 unsupported connector/AI side effects fail closed',()=>{
 assert.throws(()=>executeN8nNode({tenantId:T,node:{...base,type:'send_message',config:{}},input:[]}),/does not execute/);
 assert.throws(()=>executeN8nNode({tenantId:T,node:{...base,type:'invoke_agent',config:{}},input:[]}),/does not execute/);
});
