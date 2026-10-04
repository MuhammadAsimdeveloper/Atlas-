import test from 'node:test';
import assert from 'node:assert/strict';
import {
 defineConnector, createConnectorGrant, authorizeConnectorCall, createABAutomation, authorizeABExecution,
 createSpendPolicy, authorizeSpend, createLedgerTransaction, createRefund,
 createFreelancerWorkspace, authorizeFreelancerAction, generateSeoMetadata,
 createSecurityControlPlane, assessHighValueAction
} from './index.mjs';

test('connector fabric enforces scoped A-to-B authorization', () => {
 const c=defineConnector({id:'stripe',provider:'Stripe',category:'payments',operations:['read','create','update','send'],auth:'oauth2',scopes:['payments.write','customers.read']});
 const g=createConnectorGrant({tenantId:'t1',connector:c,principalId:'u1',allowedOperations:['read','create'],allowedScopes:['customers.read'],expiresAt:new Date(Date.now()+600000).toISOString()});
 assert.equal(authorizeConnectorCall({grant:g,connector:c,tenantId:'t1',operation:'read',scope:'customers.read',requestId:'req1'}).allowed,true);
 assert.equal(authorizeConnectorCall({grant:g,connector:c,tenantId:'t1',operation:'send',scope:'customers.read',requestId:'req2'}).code,'OPERATION_DENIED');
 const a=createABAutomation({tenantId:'t1',id:'a1',source:{connectorId:'crm',operation:'read'},destination:{connectorId:'stripe',operation:'send'},trigger:'deal.won',mapping:[{from:'amount',to:'amount'}]});
 assert.equal(authorizeABExecution({automation:a,tenantId:'t1',actorId:'u1',recordCount:1,idempotencyKey:'idem-12345678'}).code,'APPROVAL_REQUIRED');
});

test('billing cannot spend beyond hard limits and ledger must balance', () => {
 const p=createSpendPolicy({tenantId:'t1',maxTransaction:100,dailyLimit:200,monthlyLimit:1000,requireApprovalAbove:50});
 assert.equal(authorizeSpend({policy:p,amount:75,category:'ads',dailySpent:0,monthlySpent:0,idempotencyKey:'spend-12345678'}).code,'APPROVAL_REQUIRED');
 assert.equal(authorizeSpend({policy:p,amount:75,category:'ads',dailySpent:0,monthlySpent:0,idempotencyKey:'spend-12345679',approval:{status:'approved'}}).allowed,true);
 assert.throws(()=>createLedgerTransaction({tenantId:'t1',entries:[{account:'cash',direction:'debit',amount:10},{account:'revenue',direction:'credit',amount:9}],idempotencyKey:'txn-12345678',sourceRef:'order-1'}),/balance/);
 assert.equal(createLedgerTransaction({tenantId:'t1',entries:[{account:'cash',direction:'debit',amount:10},{account:'revenue',direction:'credit',amount:10}],idempotencyKey:'txn-12345679',sourceRef:'order-1'}).currency,'USD');
 assert.equal(createRefund({tenantId:'t1',originalTransactionId:'txn-1',amount:2000,reason:'customer request',idempotencyKey:'refund-12345678'}).status,'needs_approval');
});

test('freelancer workspaces separate permissions from payment approval', () => {
 const w=createFreelancerWorkspace({tenantId:'t1',projectId:'p1',budget:5000,members:[{id:'f1',role:'designer',permissions:['upload_asset','comment']}],approvalThreshold:500});
 assert.equal(authorizeFreelancerAction({workspace:w,memberId:'f1',action:'upload_asset'}).allowed,true);
 assert.equal(authorizeFreelancerAction({workspace:w,memberId:'f1',action:'issue_refund'}).code,'PERMISSION_DENIED');
});

test('SEO metadata and high-value security actions fail closed', () => {
 const seo=generateSeoMetadata({
   title:'Atlas CRM',
   description:'Business OS',
   canonicalUrl:'https://atlas.example.com/',
   siteName:'Atlas',
   imageUrl:'https://atlas.example.com/social-card.svg',
   imageAlt:'Atlas customer operations',
   keywords:['CRM','automation']
 });
 assert.equal(seo.robots,'index,follow,max-image-preview:large');
 assert.equal(seo.canonicalUrl,'https://atlas.example.com');
 assert.equal(seo.twitterCard,'summary_large_image');
 assert.equal(seo.imageAlt,'Atlas customer operations');
 assert.equal(seo.verification.google,null);
 assert.throws(()=>generateSeoMetadata({title:'x',description:'y',canonicalUrl:'https://atlas.example.com/?q=1',siteName:'Atlas'}),/canonicalUrl invalid/);
 assert.throws(()=>generateSeoMetadata({title:'x',description:'y',canonicalUrl:'https://atlas.example.com',siteName:'Atlas',robots:'index,follow,all'}),/robots policy invalid/);
 const sec=createSecurityControlPlane({tenantId:'t1'});
 assert.equal(assessHighValueAction({controlPlane:sec,action:'charge',amount:500}).code,'STEP_UP_REQUIRED');
 assert.equal(assessHighValueAction({controlPlane:sec,action:'charge',amount:500,hasRecentStepUp:true}).allowed,true);
 assert.equal(assessHighValueAction({controlPlane:sec,action:'break_glass',approvals:1}).code,'DUAL_APPROVAL_REQUIRED');
});
