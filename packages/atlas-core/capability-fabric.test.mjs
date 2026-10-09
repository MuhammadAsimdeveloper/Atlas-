import test from 'node:test';
import assert from 'node:assert/strict';
import {ATLAS_CAPABILITIES,assertCapability,assertChannel,capabilityMatrix,externalSideEffectAllowed} from './capability-fabric.mjs';
test('registers every requested capability exactly once',()=>{assert.ok(ATLAS_CAPABILITIES.length>=113);assert.equal(new Set(ATLAS_CAPABILITIES.map(x=>x.id)).size,ATLAS_CAPABILITIES.length);});
test('expanded registry covers the competitive rebase domains',()=>{for(const id of ['platform.action_registry','platform.skill_registry','platform.data_contracts','platform.interfaces','crm.associations','crm.duplicate_detection','crm.data_quality','marketing.sequences','marketing.segmentation','marketing.attribution','learning.courses_memberships_community'])assert.ok(ATLAS_CAPABILITIES.some(x=>x.id===id),id);});

test('expanded registry covers transactional domains',()=>{for(const id of ['commerce.products','commerce.checkout','commerce.orders','commerce.refunds','documents.e_signatures','projects.dependencies','portals.customer','portals.vendor','platform.idempotency_ledger','platform.provider_reconciliation'])assert.ok(ATLAS_CAPABILITIES.some(x=>x.id===id),id);});
test('communication side effects fail closed until provider, consent and approval are verified',()=>{assert.equal(externalSideEffectAllowed({capabilityId:'communication.sms',providerStatus:'configured',consent:true,approved:true}),false);assert.equal(externalSideEffectAllowed({capabilityId:'communication.sms',providerStatus:'verified',consent:true,approved:true}),true);assert.equal(externalSideEffectAllowed({capabilityId:'communication.sms',providerStatus:'verified',consent:false,approved:true}),false);});
test('rejects unsupported channels and risk mismatches',()=>{assert.throws(()=>assertChannel('carrier-pigeon'),/Unsupported communication channel/);assert.throws(()=>assertCapability('communication.email','read'),/risk mismatch/);});
test('matrix is detached from registry objects',()=>{const copy=capabilityMatrix();copy[0].name='tampered';assert.notEqual(ATLAS_CAPABILITIES[0].name,'tampered');});

test('financial actions retain an explicit financial risk policy',()=>{
 assert.equal(assertCapability('commerce.refunds','financial').risk,'financial');
 assert.equal(ATLAS_CAPABILITIES.length>=113,true);
});
