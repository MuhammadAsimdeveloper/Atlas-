import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  PROVIDER_CATALOG, defineProviderAdapter, verifyWebhookSignature, planSyncCheckpoint, assessProviderHealth,
  createSiteDefinition, createDomainBinding, createPublishPlan,
  authorizeCommunicationSend, createDeliveryEnvelope,
  createUsageMeter, recordUsage, createInvoice, reconcileProviderPayment,
  createAgencyProject, authorizeWorkAction, createDeliverableReview,
  GHL_CAPABILITY_CATALOG, createSnapshotManifest, assessCapabilityCoverage,
  createControlRegister, recordControlEvidence, evaluateRecoveryDrill, calculateSloStatus, createReleaseGate
} from './index.mjs';

test('V104 provider adapter fabric is scoped, signed-webhook aware and outage-safe', () => {
  assert.ok(PROVIDER_CATALOG.stripe);
  const adapter = defineProviderAdapter({
    id: 'stripe',
    category: 'payments',
    apiVersion: '2026-01-28',
    capabilities: ['customers.read', 'payments.write'],
    webhook: { algorithm: 'hmac_sha256', toleranceSeconds: 300 }
  });
  const raw = '{"id":"evt_1"}';
  const secret = 'whsec_test';
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', secret).update(timestamp + '.' + raw).digest('hex');
  assert.equal(verifyWebhookSignature({rawBody: raw, signature, secret, timestamp, toleranceSeconds: 300}).verified, true);
  assert.equal(planSyncCheckpoint({tenantId:'t1',providerId:adapter.id,resource:'customers',direction:'inbound',cursor:'c1',etag:'e1',dedupeKey:'d1'}).conflictPolicy,'source_version_then_updated_at');
  assert.equal(assessProviderHealth({consecutiveFailures:4,errorRate:0.3,latencyMs:2000}).state,'degraded');
});

test('V105 website publish plan prevents unsafe public publication', () => {
  const site = createSiteDefinition({
    tenantId:'t1',
    origin:'https://acme.example',
    pages:[{path:'/',title:'Acme Home',description:'Acme services',indexable:true},
           {path:'/services',title:'Services',description:'Acme services',indexable:true}]
  });
  assert.equal(createDomainBinding({tenantId:'t1',domain:'acme.example',verification:'dns_txt',verified:true}).verified,true);
  const preview = createPublishPlan({site,mode:'preview',artifactHash:'a1'});
  assert.equal(preview.robots,'noindex,nofollow');
  assert.equal(createPublishPlan({site,mode:'public',artifactHash:'a2',verifiedDomain:true}).sitemapEntries.length,2);
  assert.throws(() => createPublishPlan({site:{...site,origin:'http://acme.example'},mode:'public',artifactHash:'a3'}),/HTTPS/);
});

test('V106 communications fail closed on consent, suppression, and idempotency boundaries', () => {
  const allowed = authorizeCommunicationSend({
    tenantId:'t1',channel:'sms',purpose:'transactional',consent:{status:'opted_in',source:'web_form',capturedAt:'2026-10-01T10:00:00Z'},
    suppression:{suppressed:false},frequency:{sentLast24h:1,max24h:5}
  });
  assert.equal(allowed.allowed,true);
  assert.equal(authorizeCommunicationSend({
    tenantId:'t1',channel:'sms',purpose:'marketing',consent:{status:'opted_out'},
    suppression:{suppressed:true},frequency:{sentLast24h:0,max24h:5}
  }).code,'SUPPRESSED');
  const envelope=createDeliveryEnvelope({tenantId:'t1',channel:'email',purpose:'marketing',recipient:'user@example.com',idempotencyKey:'msg-12345678',templateReleaseHash:'tpl1'});
  assert.equal(envelope.status,'pending');
});

test('V107 financial OS uses integer minor units, metering and reconciled payments', () => {
  const meter=createUsageMeter({tenantId:'t1',metric:'sms_segments',unitPriceMinor:3,currency:'USD'});
  const usage=recordUsage({meter,quantity:100,idempotencyKey:'usage-12345678'});
  assert.equal(usage.amountMinor,300);
  const invoice=createInvoice({
    tenantId:'t1',currency:'USD',
    lines:[{description:'Platform',quantity:1,unitPriceMinor:5000},{description:'SMS',quantity:100,unitPriceMinor:3}],
    taxMinor:500,creditMinor:300
  });
  assert.equal(invoice.totalMinor,5500);
  assert.equal(reconcileProviderPayment({tenantId:'t1',provider:'stripe',providerEventId:'evt_1',amountMinor:5500,currency:'USD',invoiceId:invoice.id}).status,'reconciled');
  assert.equal(reconcileProviderPayment({tenantId:'t1',provider:'stripe',providerEventId:'evt_1',amountMinor:5500,currency:'USD',invoiceId:invoice.id}).status,'duplicate');
});

test('V108 freelancer workspace separates work permissions, approvals and secrets', () => {
  const project=createAgencyProject({
    tenantId:'t1',projectId:'p1',budgetMinor:100000,currency:'USD',
    members:[{id:'f1',role:'designer',permissions:['upload_asset','comment','submit_deliverable'],secretScopes:['project.assets']}],
    milestones:[{id:'m1',name:'Homepage',amountMinor:30000}]
  });
  assert.equal(authorizeWorkAction({project,memberId:'f1',action:'upload_asset'}).allowed,true);
  assert.equal(authorizeWorkAction({project,memberId:'f1',action:'refund_customer'}).code,'FINANCE_AUTHORITY_SEPARATED');
  assert.equal(authorizeWorkAction({project,memberId:'f1',action:'access_secret',secretScope:'billing.keys'}).code,'SECRET_SCOPE_DENIED');
  assert.equal(createDeliverableReview({projectId:'p1',milestoneId:'m1',reviewerId:'owner1',decision:'approved',evidenceRefs:['sha:abc']}).decision,'approved');
});

test('V109 GHL parity catalog is explicit and snapshot packages are integrity-protected', () => {
  assert.ok(GHL_CAPABILITY_CATALOG.length >= 25);
  const snap=createSnapshotManifest({tenantId:'t1',name:'agency-template',version:'1.0.0',capabilities:['crm','workflow_automation','website_builder','calendars_booking','payments_invoicing'],assets:[{path:'workflow.json',sha256:'abc'}]});
  assert.equal(snap.signature.length,64);
  const coverage=assessCapabilityCoverage({implemented:['crm','workflow_automation','website_builder','calendars_booking','payments_invoicing'],catalog:GHL_CAPABILITY_CATALOG});
  assert.ok(coverage.implemented >= 5);
  assert.equal(coverage.missing.filter(x=>x==='crm').length,0);
});

test('V110 trust center requires evidence, tested recovery, SLO health and release gates', () => {
  const controls=createControlRegister({tenantId:'t1',controls:[
    {id:'CC1',framework:'SOC2',title:'Access control',severity:'high'},
    {id:'CC2',framework:'PCI',title:'Payment boundary',severity:'critical'}
  ]});
  const withEvidence=recordControlEvidence({register:controls,controlId:'CC1',evidenceId:'ev1',kind:'audit_log',capturedAt:'2026-10-04T00:00:00Z'});
  assert.equal(withEvidence.evidenceCount.CC1,1);
  assert.equal(evaluateRecoveryDrill({rtoMinutes:30,rpoMinutes:5,measuredRtoMinutes:24,measuredRpoMinutes:2,restoreVerified:true}).status,'pass');
  const slo=calculateSloStatus({targetAvailability:0.999,observedAvailability:0.9995,periodMinutes:43200});
  assert.equal(slo.status,'within_budget');
  assert.equal(createReleaseGate({release:'V110',checks:{tests:true,security:true,dr:true,slo:true,docs:true},required:['tests','security','dr','slo','docs']}).status,'approved');
});
