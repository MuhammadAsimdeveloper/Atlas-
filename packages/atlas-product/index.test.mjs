import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_RESOURCE_TYPES,defineProductResource,verifyProductResource,planProductResourcePublish,
  planResourceAction,createFeatureBundle,inspectFeatureBundle
} from './index.mjs';

test('product resources are tenant bound, versioned and credential-safe', () => {
  const site=defineProductResource({
    tenantId:'t1',type:'site',resourceId:'site1',name:'Main Site',
    capabilities:['website_builder','seo'],dependencies:['domain:verified'],config:{routeCount:4}
  });
  assert.equal(verifyProductResource(site,{tenantId:'t1'}).resourceId,'site1');
  assert.throws(()=>defineProductResource({tenantId:'t1',type:'site',resourceId:'site2',name:'Unsafe',config:{apiToken:'secret'}}),/credential/);
  assert.ok(PRODUCT_RESOURCE_TYPES.includes('site'));
});

test('critical publishes require explicit authority and dependency evidence', () => {
  const payment=defineProductResource({
    tenantId:'t1',type:'payment',resourceId:'pay1',name:'Checkout',config:{provider:'stripe'}
  });
  assert.equal(planProductResourcePublish({resource:payment,actorRole:'admin',policy:{paymentProviderReady:true}}).code,'STEP_UP_REQUIRED');
  const approved=planProductResourcePublish({
    resource:payment,actorRole:'admin',
    approvals:{stepUp:true,secondApprover:true},
    verifiedDependencies:[],policy:{paymentProviderReady:true}
  });
  assert.equal(approved.code,'PAYMENT_PROVIDER_NOT_READY');
});

test('website, social, ads and connector publishes have domain/provider gates', () => {
  const site=defineProductResource({tenantId:'t1',type:'site',resourceId:'s',name:'Site',dependencies:['domain:verified']});
  assert.equal(planProductResourcePublish({resource:site,actorRole:'owner',verifiedDependencies:['domain:verified'],policy:{domainVerified:false}}).code,'DOMAIN_NOT_VERIFIED');
  const social=defineProductResource({tenantId:'t1',type:'social_campaign',resourceId:'sc',name:'Social'});
  assert.equal(planProductResourcePublish({resource:social,actorRole:'owner',policy:{providerPublishGrant:false}}).code,'SOCIAL_PUBLISH_GRANT_REQUIRED');
  const ads=defineProductResource({tenantId:'t1',type:'ad_campaign',resourceId:'ad',name:'Ads'});
  assert.equal(planProductResourcePublish({resource:ads,actorRole:'owner',policy:{spendApproval:false}}).code,'AD_SPEND_APPROVAL_REQUIRED');
  const connector=defineProductResource({tenantId:'t1',type:'connector',resourceId:'c',name:'Connector'});
  assert.equal(planProductResourcePublish({resource:connector,actorRole:'owner',policy:{webhookVerified:false}}).code,'WEBHOOK_NOT_VERIFIED');
});

test('work permissions cannot silently grant secret or financial authority', () => {
  const project=defineProductResource({tenantId:'t1',type:'agency_project',resourceId:'p',name:'Client Work'});
  assert.equal(planResourceAction({resource:project,action:'access_secret',actor:{role:'member',secretScopes:[]},secretScope:'billing.keys'}).code,'SECRET_SCOPE_DENIED');
  assert.equal(planResourceAction({resource:project,action:'issue_payout',actor:{role:'member',permissions:['issue_payout']},risk:'critical'}).code,'CRITICAL_ROLE_DENIED');
});

test('feature bundles retain tenant, resource and capability integrity', () => {
  const a=defineProductResource({tenantId:'t1',type:'workflow',resourceId:'w1',name:'Lead Follow-up',capabilities:['workflow_automation']});
  const b=defineProductResource({tenantId:'t1',type:'site',resourceId:'s1',name:'Marketing Site',capabilities:['website_builder','seo']});
  const bundle=createFeatureBundle({tenantId:'t1',bundleId:'b1',name:'Agency Starter',resources:[a,b],declaredCapabilities:['workflow_automation','website_builder','seo']});
  assert.equal(inspectFeatureBundle(bundle,{requiredCapabilities:['crm']}).valid,false);
  assert.deepEqual(inspectFeatureBundle(bundle,{requiredCapabilities:['workflow_automation','seo']}).missingCapabilities,[]);
});
