import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defineRole,authorize,createSecretReference,authorizeSecretAccess,createPolicyRule,evaluatePolicy,
  createAuditEvent,verifyAuditChain,createSsoPolicy,validateSsoAssertion
} from './index.mjs';

test('tenant roles and platform roles are distinct',()=>{
  assert.equal(defineRole({tenantId:'t1',roleId:'owner',name:'Owner'}).tenantId,'t1');
  assert.equal(defineRole({roleId:'platform_owner',name:'Platform Owner',scope:'platform'}).tenantId,null);
  assert.throws(()=>defineRole({tenantId:'t1',roleId:'platform_owner',name:'Bad'}),/not an Atlas role/);
});

test('authorization fails closed across tenants and high-risk platform actions',()=>{
  assert.equal(authorize({actor:{id:'u1',tenantId:'t2',permissions:['billing.read'],scope:'tenant'},tenantId:'t1',permission:'billing.read'}).code,'TENANT_BOUNDARY_VIOLATION');
  assert.equal(authorize({actor:{id:'p1',scope:'platform',role:'platform_owner',permissions:['write']},tenantId:'t1',permission:'write',risk:'critical'}).code,'PLATFORM_RISK_ROLE_DENIED');
});

test('secret references never carry secret values and production scopes require step-up',()=>{
  const ref=createSecretReference({tenantId:'t1',secretRef:'secret://stripe/prod',provider:'stripe',purpose:'payments'});
  assert.equal(authorizeSecretAccess({reference:ref,actor:{tenantId:'t1',secretScopes:['production.payments']},scope:'production.payments'}).code,'STEP_UP_REQUIRED');
  assert.equal(authorizeSecretAccess({reference:ref,actor:{tenantId:'t1',secretScopes:['production.payments']},scope:'production.payments',stepUp:true}).allowed,true);
});

test('policy engine is default deny and explicit deny wins',()=>{
  const allow=createPolicyRule({tenantId:'t1',policyId:'p1',name:'Allow Read',effect:'allow',principal:'member',action:'crm.read',resource:'contact'});
  const deny=createPolicyRule({tenantId:'t1',policyId:'p2',name:'Deny',effect:'deny',principal:'member',action:'crm.read',resource:'contact'});
  assert.equal(evaluatePolicy({rules:[allow],actor:{role:'member'},action:'crm.read',resource:'contact'}).allowed,true);
  assert.equal(evaluatePolicy({rules:[allow,deny],actor:{role:'member'},action:'crm.read',resource:'contact'}).code,'POLICY_DENY');
});

test('audit hashes form an append-only tamper-evident chain',()=>{
  const a=createAuditEvent({tenantId:'t1',actorId:'u1',action:'read',resourceType:'contact',resourceId:'c1'});
  const b=createAuditEvent({tenantId:'t1',actorId:'u1',action:'update',resourceType:'contact',resourceId:'c1',previousHash:a.eventHash});
  assert.equal(verifyAuditChain([a,b]).valid,true);
  assert.equal(verifyAuditChain([{...b,action:'delete'},b]).valid,false);
});

test('SSO policies require tenant binding, domains and MFA',()=>{
  const policy=createSsoPolicy({tenantId:'t1',provider:'oidc',issuer:'https://id.example.com',clientId:'atlas',allowedDomains:['example.com'],enforceMfa:true});
  assert.equal(validateSsoAssertion({policy,tenantId:'t1',claims:{sub:'u1',email:'u@example.com'}}).code,'MFA_REQUIRED');
  assert.equal(validateSsoAssertion({policy,tenantId:'t1',claims:{sub:'u1',email:'u@example.com',mfa:true}}).valid,true);
  assert.equal(validateSsoAssertion({policy,tenantId:'t2',claims:{sub:'u1',email:'u@example.com',mfa:true}}).code,'TENANT_BOUNDARY_VIOLATION');
});
