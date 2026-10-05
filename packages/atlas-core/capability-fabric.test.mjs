import test from 'node:test';
import assert from 'node:assert/strict';
import {ATLAS_CAPABILITIES,assertCapability,assertChannel,capabilityMatrix,externalSideEffectAllowed} from './capability-fabric.mjs';
test('registers every requested capability exactly once',()=>{assert.equal(ATLAS_CAPABILITIES.length,60);assert.equal(new Set(ATLAS_CAPABILITIES.map(x=>x.id)).size,60);});
test('communication side effects fail closed until provider, consent and approval are verified',()=>{assert.equal(externalSideEffectAllowed({capabilityId:'communication.sms',providerStatus:'configured',consent:true,approved:true}),false);assert.equal(externalSideEffectAllowed({capabilityId:'communication.sms',providerStatus:'verified',consent:true,approved:true}),true);assert.equal(externalSideEffectAllowed({capabilityId:'communication.sms',providerStatus:'verified',consent:false,approved:true}),false);});
test('rejects unsupported channels and risk mismatches',()=>{assert.throws(()=>assertChannel('carrier-pigeon'),/Unsupported communication channel/);assert.throws(()=>assertCapability('communication.email','read'),/risk mismatch/);});
test('matrix is detached from registry objects',()=>{const copy=capabilityMatrix();copy[0].name='tampered';assert.notEqual(ATLAS_CAPABILITIES[0].name,'tampered');});
