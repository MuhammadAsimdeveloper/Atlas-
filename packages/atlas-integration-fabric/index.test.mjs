import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONNECTOR_COUNT,NODE_COUNT,listConnectors,listNodes,getConnector,getNode,
  definePrivateConnector,validateConnectorManifest,createCredentialEnvelope,rotateCredential,
  retryPolicy,backoffDelay,rateLimitDecision,paginationPlan,nodeDefinition,createExecutionSnapshot
} from './index.mjs';

test('catalog covers the requested core connector marketplace',()=>{
  assert.ok(CONNECTOR_COUNT>=40);
  for(const id of ['google','microsoft','slack','discord','telegram','stripe','paypal','shopify','woocommerce','salesforce','hubspot','pipedrive','mailchimp','sendgrid','twilio','whatsapp','openai','anthropic','gemini','aws','azure','github','gitlab','notion','airtable','supabase','postgresql','mysql','mongodb','redis','s3','dropbox','google-drive','calendars','facebook','instagram','linkedin','tiktok','generic-rest','graphql','soap','custom-api']) assert.ok(getConnector(id),id);
});

test('node catalog covers n8n-depth control primitives',()=>{
  assert.ok(NODE_COUNT>=35);
  for(const id of ['trigger.webhook','http.request','http.response','auth.oauth2','auth.basic','auth.bearer','auth.hmac','auth.headers','http.graphql','http.soap','logic.if','logic.switch','logic.router','logic.parallel','control.loop','control.batch','control.split_in_batches','control.merge','control.wait','control.delay','control.retry','control.error','control.dead_letter','workflow.subworkflow','workflow.as_tool','workflow.as_agent_tool']) assert.ok(getNode(id),id);
});

test('private connector definitions are tenant bound and HTTPS only',()=>{
  const c=definePrivateConnector({tenantId:'tenant_1',id:'acme-api',name:'Acme API',category:'private',auth:'oauth2',baseUrl:'https://api.acme.test',scopes:['read']});
  assert.equal(c.tenantId,'tenant_1'); assert.equal(c.baseUrl,'https://api.acme.test');
  assert.throws(()=>definePrivateConnector({tenantId:'tenant_1',id:'acme-api',name:'Acme API',category:'private',auth:'oauth2',baseUrl:'http://api.acme.test'}),/HTTPS/);\n  assert.throws(()=>definePrivateConnector({tenantId:'tenant_1',id:'acme-api',name:'Acme API',category:'private',auth:'oauth2',baseUrl:'https://user:pass@api.acme.test'}),/embedded credentials/);
});

test('community manifests require signed webhooks',()=>{
  const ok=validateConnectorManifest({id:'community.demo',name:'Demo',tier:'community',auth:{type:'api_key'},baseUrl:'https://demo.test',webhook:{enabled:true,verification:'signed'}});
  assert.equal(ok.id,'community.demo');
  assert.throws(()=>validateConnectorManifest({id:'community.demo',name:'Demo',tier:'community',auth:{type:'api_key'},baseUrl:'https://demo.test',webhook:{enabled:true,verification:'none'}}),/signed/);
});

test('credential envelopes contain references, never secret material',()=>{
  const c=createCredentialEnvelope({tenantId:'tenant_1',connectionId:'conn_1',connectorId:'stripe',version:'v1',secretRef:'vault_ref_abc',expiresAt:Date.now()+10000});
  assert.equal(c.secretRef,'vault_ref_abc'); assert.equal(Object.keys(c).includes('token'),false);\n  assert.throws(()=>createCredentialEnvelope({tenantId:'tenant_1',connectionId:'conn_1',connectorId:'stripe',version:'v1',secretRef:'sk_live_real_secret'}),/opaque/);
  assert.equal(rotateCredential({current:c,nextSecretRef:'vault_ref_def'}).secretRef,'vault_ref_def');
  assert.throws(()=>rotateCredential({current:c,nextSecretRef:'vault_ref_abc'}),/new secret/);
});

test('retry, backoff, rate limit and pagination are bounded',()=>{
  const p=retryPolicy({maxAttempts:4,baseDelayMs:100,maxDelayMs:1000,jitterRatio:0});
  assert.deepEqual(p,{maxAttempts:4,baseDelayMs:100,maxDelayMs:1000,jitterRatio:0});
  assert.equal(backoffDelay(p,4,{random:()=>0.5}),800);
  assert.deepEqual(rateLimitDecision({remaining:0,resetAt:2000,now:1000}),{allowed:false,retryAfterMs:1000});
  assert.deepEqual(paginationPlan({strategy:'link_header',pageSize:50,maxPages:20}),{strategy:'link_header',pageSize:50,maxPages:20});
});

test('node definitions and execution snapshots are immutable and hashed',()=>{
  const n=nodeDefinition({id:'http.request',label:'HTTP Request',kind:'action',sideEffect:true});
  assert.equal(n.sideEffect,true);
  const s=createExecutionSnapshot({tenantId:'tenant_1',workflowId:'wf_1',executionId:'ex_1',version:'v1',nodes:[n]});
  assert.equal(s.nodeCount,1); assert.match(s.hash,/^[a-f0-9]{64}$/);
  assert.throws(()=>nodeDefinition({id:'bad',label:'bad',kind:'unknown'}),/kind invalid/);
});
