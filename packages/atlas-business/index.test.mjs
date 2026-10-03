import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCampaign,submitForm,planSocialPublish,createReviewProgram,createAdCampaign,authorizeAdLaunch,
  createCourse,grantEntitlement,createAffiliateProgram,createSaaSPlan,planSaaSProvision,
  createMarketplacePackage,authorizeMarketplacePublish,planBusinessAction
} from './index.mjs';

test('campaigns are tenant-scoped and variant weights normalize',()=>{
  const c=createCampaign({tenantId:'t1',campaignId:'c1',name:'Launch',channel:'email',audienceRef:'aud1',contentRef:'tpl1',variants:[{id:'a',contentRef:'tpl1',weight:1},{id:'b',contentRef:'tpl2',weight:3}]});
  assert.equal(c.config.variants[0].weight,.25); assert.equal(c.config.variants[1].weight,.75);
});

test('form submissions reject bots and preserve bounded tenant-owned data',()=>{
  assert.equal(submitForm({tenantId:'t1',formId:'f1',submissionId:'s1',honeypot:'x'}).code,'BOT_REJECTED');
  const s=submitForm({tenantId:'t1',formId:'f1',submissionId:'s2',payload:{email:'user@example.com',name:'A'}});
  assert.equal(s.accepted,true); assert.equal(s.tenantId,'t1');
});

test('social and ads require provider grants and spend approval',()=>{
  assert.equal(planSocialPublish({tenantId:'t1',postId:'p1',platform:'instagram',contentRef:'c1',providerGrant:false}).code,'SOCIAL_PUBLISH_GRANT_REQUIRED');
  const ad=createAdCampaign({tenantId:'t1',campaignId:'a1',name:'Test',platform:'meta',dailyBudgetMinor:10000});
  assert.equal(authorizeAdLaunch({campaign:ad,approval:{status:'pending'},providerGrant:true,remainingBudgetMinor:20000}).code,'AD_SPEND_APPROVAL_REQUIRED');
});

test('learning and affiliate records are bounded',()=>{
  const course=createCourse({tenantId:'t1',courseId:'course1',name:'Onboarding',lessons:[{id:'l1',title:'Intro',contentRef:'doc:l1'}]});
  const ent=grantEntitlement({tenantId:'t1',memberId:'m1',resourceType:'course',resourceId:course.resourceId,idempotencyKey:'ent-12345678'});
  assert.equal(ent.status,'active');
  const aff=createAffiliateProgram({tenantId:'t1',programId:'aff1',name:'Referral',commissionType:'percent',commissionValue:20});
  assert.equal(aff.config.commissionValue,20);
});

test('SaaS provisioning cannot cross-tenant silently and needs provider readiness',()=>{
  const plan=createSaaSPlan({tenantId:'agency',planId:'pro',name:'Pro',baseMonthlyMinor:9900});
  assert.equal(planSaaSProvision({plan,customerTenantId:'agency',externalAccountRef:'acct1',idempotencyKey:'saas-12345678'}).code,'TARGET_TENANT_MUST_BE_DISTINCT');
  assert.equal(planSaaSProvision({plan,customerTenantId:'cust',externalAccountRef:'acct1',idempotencyKey:'saas-12345678',providerReady:false}).code,'PROVIDER_NOT_READY');
});

test('marketplace packages require signing, security and dependency evidence',()=>{
  const pkg=createMarketplacePackage({tenantId:'t1',packageId:'pkg1',name:'Starter',version:'1.0.0',resources:[{type:'workflow',resourceId:'w1',checksum:'abc'}],declaredCapabilities:['workflow_automation'],provenanceRef:'sha:build1'});
  assert.equal(authorizeMarketplacePublish(pkg,{signingKeyPresent:false,securityScan:'pass',allDependenciesVerified:true}).code,'SIGNING_KEY_REQUIRED');
  assert.equal(authorizeMarketplacePublish(pkg,{signingKeyPresent:true,securityScan:'fail',allDependenciesVerified:true}).code,'SECURITY_SCAN_REQUIRED');
  assert.equal(authorizeMarketplacePublish(pkg,{signingKeyPresent:true,securityScan:'pass',allDependenciesVerified:true}).allowed,true);
});

test('universal business action planner applies consent, suppression, provider and spend gates',()=>{
  assert.equal(planBusinessAction({tenantId:'t1',featureId:'sms_send',action:'send',risk:'high',consent:false}).code,'CONSENT_REQUIRED');
  assert.equal(planBusinessAction({tenantId:'t1',featureId:'ad_spend',action:'launch',risk:'critical',providerGrant:true,approval:{status:'approved'},spendMinor:101,budgetMinor:100}).code,'SPEND_LIMIT_EXCEEDED');
});
