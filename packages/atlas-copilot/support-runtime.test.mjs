import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createCustomerSupportProfile,createSupportTurnPlan,evaluateSupportResponse,createSupportTrainingExample,buildSupportTrainingPack,runCustomerSupportTurn} from './support-runtime.mjs';
import {createModelAdapter} from '../atlas-agent-fabric/model-runtime.mjs';
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const T='11111111-1111-4111-8111-111111111111';const A='agent-support-1';const R='release-support-1';const S='session-support-1';
const profile=createCustomerSupportProfile({tenantId:T,agentId:A,releaseId:R,version:3,knowledgeVersionRef:'knowledge-v3',systemPromptHash:'a'.repeat(64),escalationQueueRef:'queue-support',channel:'webchat'});
const session={id:S,tenantId:T,agentId:A,releaseId:R,conversationRef:'conversation-1'};
test('V151 support profile and turn plan are tenant-bound and raw-content free',()=>{
 const plan=createSupportTurnPlan({tenantId:T,sessionId:S,turnId:'turn-1',messageHash:'b'.repeat(64),profile,knowledgeRefs:[{ref:'article-1',score:.9}]});
 assert.equal(plan.rawMessageStored,false);assert.equal(plan.knowledgeRefs[0].ref,'article-1');
 assert.throws(()=>createSupportTurnPlan({tenantId:'tenant-b',sessionId:S,turnId:'turn-2',messageHash:'b'.repeat(64),profile}),/cross-tenant|invalid/);
});
test('V151 response evaluator blocks ungrounded factual answers and secret leakage',()=>{
 assert.equal(evaluateSupportResponse({tenantId:T,messageHash:'b'.repeat(64),response:{message:'Policy says yes.',intent:'faq',confidence:.9,groundingRefs:[],handoff:false},allowedKnowledgeRefs:['article-1']}).status,'blocked');
 assert.equal(evaluateSupportResponse({tenantId:T,messageHash:'b'.repeat(64),response:{message:'Bearer abcdefghijklmnop',intent:'faq',confidence:.9,groundingRefs:['article-1'],handoff:false},allowedKnowledgeRefs:['article-1']}).reason,'sensitive_output');
});
test('V151 support training pack is evaluation/grounding data, not raw transcript storage',()=>{
 const e=createSupportTrainingExample({tenantId:T,turnId:'turn-1',messageHash:'b'.repeat(64),expectedIntent:'faq',outcome:'corrected',knowledgeRefs:['article-1'],failureCodes:['missing_citation'],reviewerRef:'reviewer-1'});
 const pack=buildSupportTrainingPack({tenantId:T,examples:[e],knowledgeVersionRef:'knowledge-v3',agentReleaseId:R});
 assert.equal(pack.exampleCount,1);assert.equal(pack.trainingMode,'evaluation_and_grounding');assert.equal(pack.rawMessagesIncluded,false);assert.equal(pack.counts.corrected,1);
});
test('V151 live support turn uses tenant knowledge grounding and keeps raw content transient',async()=>{
 const adapter=createModelAdapter({provider:'model_adapter',infer:async()=>({output:{message:'Your approved policy says yes.',intent:'faq',confidence:.9,groundingRefs:['article-1'],handoff:false}})});
 const result=await runCustomerSupportTurn({tenantId:T,actorId:'actor-1',profile,session,turnId:'turn-3',message:'Can I book?',messageHash:hash('Can I book?'),adapter,knowledgeSearch:async()=>[{tenantId:T,ref:'article-1',score:.92,excerpt:'Approved booking policy.'}]});
 assert.equal(result.status,'answered');assert.equal(result.groundingRefs[0],'article-1');assert.equal(result.rawMessageStored,false);
});
test('V151 support turn rejects cross-tenant knowledge',async()=>{
 const adapter=createModelAdapter({provider:'model_adapter',infer:async()=>({output:{message:'ok',intent:'faq',confidence:.9,groundingRefs:['article-1'],handoff:false}})});
 await assert.rejects(()=>runCustomerSupportTurn({tenantId:T,actorId:'actor-1',profile,session,turnId:'turn-4',message:'Help',messageHash:hash('Help'),adapter,knowledgeSearch:async()=>[{tenantId:'tenant-b',ref:'article-1',score:.9,excerpt:'private'}]}),/tenant mismatch/);
});
