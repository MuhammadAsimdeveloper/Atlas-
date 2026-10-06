import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createSupportSessionClaims,issueSupportSessionToken,verifySupportSessionToken,validateSupportTurnInput,createSupportTurnEnqueueRequest} from './support-session.mjs';
const S='s'.repeat(32),T='11111111-1111-4111-8111-111111111111';
const sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
test('V152 signed support session is tenant and release bound',()=>{
 const claims=createSupportSessionClaims({tenantId:T,agentReleaseRef:'release-support-1',channel:'webchat',sessionId:'session-support-1'});
 const token=issueSupportSessionToken({claims,secret:S});
 const verified=verifySupportSessionToken({token,secret:S});
 assert.equal(verified.tenantId,T);assert.equal(verified.agentReleaseRef,'release-support-1');
});
test('V152 support session rejects tampering and expiry',()=>{
 const claims=createSupportSessionClaims({tenantId:T,agentReleaseRef:'release-support-1',sessionId:'session-support-2',issuedAt:100000,ttlMs:60000});
 const token=issueSupportSessionToken({claims,secret:S});
 assert.throws(()=>verifySupportSessionToken({token:token.slice(0,-1)+'x',secret:S,now:100001}),/signature/);
 assert.throws(()=>verifySupportSessionToken({token,secret:S,now:160001}),/expired/);
});
test('V152 customer message is hash-bound and never copied into durable enqueue request',()=>{
 const message='I need help with my booking.';
 const claims=createSupportSessionClaims({tenantId:T,agentReleaseRef:'release-support-1',sessionId:'session-support-3'});
 const turn=validateSupportTurnInput({claims,sessionId:claims.sessionId,message,messageHash:sha(message),now:Date.now()});
 const request=createSupportTurnEnqueueRequest({turn,executionId:'execution-support-1',planId:'plan-support-1'});
 assert.equal(request.rawMessageStored,false);assert.equal(request.messageHash,sha(message));assert.equal('message' in request,false);
});
