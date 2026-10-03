import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');
const checks = [];
const check = (name, passed, detail) => checks.push({ name, passed: Boolean(passed), detail });

try {
  const pkg = JSON.parse(await read('package.json'));
  const lock = JSON.parse(await read('package-lock.json'));
  check('runtime', Number(process.versions.node.split('.')[0]) >= 20, `Node ${process.versions.node}; Atlas requires >=20`);
  check('release metadata', pkg.version === '110.0.0' && lock.version === pkg.version && lock.packages?.['']?.version === pkg.version, `package ${pkg.version}; lock ${lock.version}`);
  check('no runtime package dependencies', Object.keys(pkg.dependencies || {}).length === 0 && Object.keys(lock.packages?.['']?.dependencies || {}).length === 0, 'No third-party runtime packages are declared');

  const authority = await read('packages/atlas-core/authority.mjs');
  check('single-owner authority', authority.includes("actor?.emailVerified === true") && authority.includes('verifiedActorEmail === configuredOwner') && authority.includes('trustedAuthorities.add(authority)'), 'Global owner requires verified configured identity and an internally resolved authority object');

  const v92 = await read('infra/postgres/FINAL-MIGRATION-V92.sql');
  check('encrypted memory schema', v92.includes('encrypted_value BYTEA NOT NULL') && !/\bplaintext_value\b/i.test(v92), 'Memory facts have ciphertext storage and no plaintext value field');
  const v93 = await read('infra/postgres/FINAL-MIGRATION-V93.sql');
  const actionTable = v93.slice(v93.indexOf('CREATE TABLE IF NOT EXISTS atlas_workflow_business_action_invocations'));
  check('tenant action isolation', actionTable.includes('tenant_id TEXT NOT NULL') && v93.includes('ENABLE ROW LEVEL SECURITY') && v93.includes('FORCE ROW LEVEL SECURITY') && v93.includes("tenant_id = nullif(current_setting('app.tenant_id', true), '')"), 'V93 business action invocations require explicit tenant RLS');
  check('minimal action payload', actionTable.includes('action_config_sha256') && !/payload|body_template|message_body/i.test(actionTable), 'Durable contact action rows contain a config hash and no action payload or message body');
  const v94 = await read('infra/postgres/FINAL-MIGRATION-V94.sql');
  const supportCases = v94.slice(v94.indexOf('CREATE TABLE IF NOT EXISTS atlas_support_cases'), v94.indexOf('CREATE INDEX IF NOT EXISTS idx_atlas_support_cases_queue'));
  const supportEvents = v94.slice(v94.indexOf('CREATE TABLE IF NOT EXISTS atlas_support_case_events'), v94.indexOf('CREATE INDEX IF NOT EXISTS idx_atlas_support_case_events_timeline'));
  check('support case RLS and privacy', supportCases.includes('tenant_id TEXT NOT NULL') && v94.includes('ALTER TABLE atlas_support_cases FORCE ROW LEVEL SECURITY') && !/message_body|conversation_body|credential_value/i.test(supportCases), 'Support cases force tenant RLS and store references rather than message bodies or secrets');
  check('support event idempotency', supportEvents.includes('UNIQUE (tenant_id, case_id, command_id)') && v94.includes('REVOKE UPDATE, DELETE ON atlas_support_case_events FROM PUBLIC'), 'Support timeline events have tenant-scoped command idempotency and append-only application permissions');
  const v95 = await read('infra/postgres/FINAL-MIGRATION-V95.sql');
  check('duplicate case tenant boundary', v95.includes('FOREIGN KEY (tenant_id, duplicate_of_ref)') && v95.includes('case.duplicate_linked') && v95.includes('duplicate_case'), 'Case links retain tenant scope and their action is recorded as an allowed event');
  const calendar = await read('packages/customer-operations/business-calendar.mjs');
  const v96 = await read('infra/postgres/FINAL-MIGRATION-V96.sql');
  check('business SLA calendars', calendar.includes('requireTenantRole(authority, tenantId, [\'owner\', \'admin\'])') && calendar.includes('checksum') && calendar.includes('localBoundary') && calendar.includes('addBusinessMinutesExcludingPauses') && v96.includes('FORCE ROW LEVEL SECURITY') && v96.includes('PRIMARY KEY (tenant_id, calendar_id, version)') && v96.includes('BEFORE UPDATE OR DELETE'), 'Business schedules are immutable, tenant-scoped, DST-aware revisions pinned to support cases');
  const voice = await read('packages/customer-operations/voice-operations.mjs');
  const voiceSql = await read('infra/postgres/FINAL-MIGRATION-V99.sql');
  check('voice-call lifecycle and transfer safety', voice.includes('verifyVoiceCallSession') && voice.includes('MAX_AGENT_TRANSFERS = 3') && voice.includes("new Set(['completed', 'failed', 'abandoned', 'needs_review'])") && voice.includes('appointment_booking_evidence_required') && voice.includes('ai_disclosure_required_before_agent_connection') && voice.includes('explicit_voice_consent_required') && voiceSql.includes('FORCE ROW LEVEL SECURITY') && voiceSql.includes('REVOKE UPDATE, DELETE, TRUNCATE ON atlas_voice_call_events FROM PUBLIC'), 'Voice calls pin checksummed same-tenant releases, require booking evidence, disclosure and outbound safeguards, and keep an RLS-protected append-only event log');
  const voiceQuality = await read('packages/customer-operations/voice-quality.mjs');
  const voiceQualitySql = await read('infra/postgres/FINAL-MIGRATION-V100.sql');
  check('voice QA privacy, coaching and tenant boundaries', voiceQuality.includes('createVoiceCallQualityReview') && voiceQuality.includes('summarizeVoiceCallQuality') && voiceQuality.includes('businessIntentEvidenceRef') && voiceQuality.includes('existing_agent_governance_required') && voiceQuality.includes('criticalFailures') && voiceQualitySql.includes('business_intent_evidence_ref TEXT NOT NULL') && voiceQualitySql.includes('FORCE ROW LEVEL SECURITY') && voiceQualitySql.includes('REVOKE UPDATE, DELETE, TRUNCATE ON atlas_voice_call_quality_reviews FROM PUBLIC') && !/transcript|recording_url|call_audio/i.test(voiceQualitySql), 'V100 quality reviews use intent-bound evidence refs without call content and keep release insights tenant-bound and advisory');
  const commandCenterSource = await read('apps/command-center/app.mjs');
  check('voice QA desktop preview', commandCenterSource.includes('id="voice-quality"') && commandCenterSource.includes('Illustrative data') && commandCenterSource.includes('Atlas V100'), 'The laptop-first command center labels quality metrics and coaching examples as sample data');
  const copilot = await read('packages/atlas-copilot/index.mjs');
  check('Copilot scope, approvals and replay safety', copilot.includes('PLATFORM_READ_TOOLS') && copilot.includes('actionStore.createPending') && copilot.includes('Promise.race') && copilot.includes('request_canceled') && copilot.includes('hashAction(action)') && copilot.includes('act_copilot_${idempotencyKey}'), 'Copilot restricts global tools, approval-gates writes, bounds adapters and verifies a stable replay identity');
  const sqlWithoutComments = `${v92}\n${v93}\n${v94}\n${v95}\n${v96}\n${voiceSql}\n${voiceQualitySql}`.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('no RLS bypass grant', !/\b(?:ALTER\s+ROLE|GRANT)[^;]*\bBYPASSRLS\b/i.test(sqlWithoutComments), 'Migrations do not grant BYPASSRLS');

  const docs = await read('README.md');
  check('production boundary documented', docs.includes('No millions-of-users capacity claim is verified') && docs.includes('Local JSON/state is development-only'), 'Capacity and local-state limits are stated explicitly');
  const seo = await read('scripts/seo.mjs');
  const marketing = await read('apps/marketing-site/index.html');
  const commandCenter = await read('apps/command-center/index.html');
  check('SEO preview and public boundary', seo.includes('renderPreviewRobots') && seo.includes('renderPublicSitemap') && seo.includes('validatePublicOrigin') && marketing.includes('noindex,nofollow') && commandCenter.includes('noindex,nofollow'), 'Preview is noindex; public SEO metadata and sitemap require a validated real HTTPS origin');
  check('domain-independent SEO setup documented', docs.includes('SEO deployment') && docs.includes('ATLAS_PUBLIC_ORIGIN') && await read('docs/SEO-DEPLOYMENT.md').then(value => value.includes('public domain yet') && value.includes('Search Console')), 'No-domain preview and future indexing configuration are documented');
  const target = await read('packages/atlas-target/index.mjs');
  const targetTest = await read('packages/atlas-target/index.test.mjs');
  const targetSql = await read('infra/postgres/FINAL-MIGRATION-V102.sql');
  check('V102 CRM target', target.includes('CRM_OBJECT_TYPES') && target.includes('transitionCrmDeal') && target.includes('searchCrm') && targetTest.includes('typed properties'), 'CRM objects, schemas, versioned mutations, associations, pipelines and deterministic search are implemented and tested');
  check('V102 workflow node target', target.includes('WORKFLOW_NODE_CATALOG') && target.includes('createWorkflowGraph') && target.includes('planWorkflowNode') && target.includes('summarizeWorkflowExecution') && targetTest.includes('workflow-node target'), 'Workflow graph is bounded, checksum protected, cycle checked, reachable and approval aware');
  check('V102 booking calendar target', target.includes('createBookingCalendar') && target.includes('listAvailableSlots') && target.includes('holdBooking') && target.includes('bookAppointment') && targetTest.includes('booking calendar target'), 'Customer-facing booking calendars provide timezone-aware availability, holds and versioned lifecycle commands');
  check('V102 agent runtime target', target.includes('createAgentRuntimePolicy') && target.includes('authorizeAgentToolCall') && target.includes('consumeAgentBudget') && target.includes('validateAgentOutput') && targetTest.includes('agent runtime target'), 'Agent runtime pins tenant/release, bounds budgets, requires exact write approval and validates structured output');
  check('V102 SQL tenant isolation', targetSql.includes('FORCE ROW LEVEL SECURITY') && targetSql.includes('atlas_crm_records') && targetSql.includes('atlas_booking_calendars') && targetSql.includes('atlas_agent_sessions') && !/BYPASSRLS/i.test(targetSql), 'New V102 persistence tables use forced tenant RLS and do not grant BYPASSRLS');

  const trust = await read('packages/atlas-trust/index.mjs');
  const trustTest = await read('packages/atlas-trust/index.test.mjs');
  const trustSql = await read('infra/postgres/FINAL-MIGRATION-V103.sql');
  check('V103 connector fabric', trust.includes('defineConnector') && trust.includes('createConnectorGrant') && trust.includes('authorizeConnectorCall') && trust.includes('createABAutomation') && trust.includes('authorizeABExecution') && trustTest.includes('connector fabric'), 'Third-party connectors and A-to-B automations use scoped grants, operations, expiries, idempotency and approval');
  check('V103 financial safety', trust.includes('createSpendPolicy') && trust.includes('authorizeSpend') && trust.includes('createLedgerTransaction') && trust.includes('createRefund') && trustTest.includes('ledger must balance'), 'Billing uses hard spend limits, approval thresholds, idempotency and balanced ledger transactions');
  check('V103 freelancer isolation', trust.includes('createFreelancerWorkspace') && trust.includes('authorizeFreelancerAction') && trustTest.includes('freelancer workspaces'), 'Contractor permissions are separated from money authority');
  check('V103 SEO contract', trust.includes('generateSeoMetadata') && trustTest.includes('SEO metadata'), 'Generated websites have deterministic SEO metadata with canonical and robots controls');
  check('V103 security control plane', trust.includes('createSecurityControlPlane') && trust.includes('assessHighValueAction') && trustTest.includes('high-value security'), 'Money, secret and break-glass actions fail closed behind step-up/dual approval controls');
  check('V103 tenant RLS', trustSql.includes('FORCE ROW LEVEL SECURITY') && trustSql.includes('atlas_billing_ledger') && trustSql.includes('atlas_security_events') && !/BYPASSRLS/i.test(trustSql), 'V103 persistence targets use forced tenant RLS and protect ledger/security rows from application updates/deletes');

  const next = await read('packages/atlas-next/index.mjs');
  const nextTest = await read('packages/atlas-next/index.test.mjs');
  const nextSql = await read('infra/postgres/FINAL-MIGRATION-V104-V110.sql');
  check('V104 provider adapter fabric', next.includes('defineProviderAdapter') && next.includes('verifyWebhookSignature') && next.includes('planSyncCheckpoint') && next.includes('assessProviderHealth') && nextTest.includes('V104 provider adapter'), 'Provider adapters enforce verification, bounded sync and health states');
  check('V105 website publish fabric', next.includes('createSiteDefinition') && next.includes('createPublishPlan') && next.includes('DOMAIN_NOT_VERIFIED') && nextTest.includes('V105 website'), 'Website publication uses normalized routes, HTTPS and verified-domain gates');
  check('V106 communication OS', next.includes('authorizeCommunicationSend') && next.includes('createDeliveryEnvelope') && next.includes('CONSENT_REQUIRED') && next.includes('SUPPRESSED') && nextTest.includes('V106 communications'), 'Outbound delivery is idempotent and policy-gated');
  check('V107 financial OS', next.includes('createUsageMeter') && next.includes('recordUsage') && next.includes('createInvoice') && next.includes('reconcileProviderPayment') && nextTest.includes('V107 financial'), 'Financial documents use integer USD minor units and duplicate-safe reconciliation');
  check('V108 agency work OS', next.includes('createAgencyProject') && next.includes('authorizeWorkAction') && next.includes('FINANCE_AUTHORITY_SEPARATED') && nextTest.includes('V108 freelancer'), 'Freelancer work is scoped and separated from finance authority');
  check('V109 capability parity', next.includes('GHL_CAPABILITY_CATALOG') && next.includes('createSnapshotManifest') && nextTest.includes('V109 GHL'), 'GHL benchmark capabilities and signed/integrity-protected snapshots are explicit');
  check('V110 trust and recovery gates', next.includes('createControlRegister') && next.includes('recordControlEvidence') && next.includes('evaluateRecoveryDrill') && next.includes('calculateSloStatus') && next.includes('createReleaseGate') && nextSql.includes('atlas_trust_control_evidence') && nextSql.includes('atlas_release_gates'), 'Trust evidence, DR, SLO and release gates are explicit');

  const featureCatalog = await read('packages/atlas-feature-catalog/index.mjs');
  const featureCatalogTest = await read('packages/atlas-feature-catalog/index.test.mjs');
  check('V111 full feature catalog', featureCatalog.includes('FULL_FEATURE_CATALOG') && featureCatalog.includes('GHL_FEATURES') && featureCatalog.includes('N8N_FEATURES') && featureCatalogTest.includes('exhaustive enough'), 'GHL and n8n benchmark features are machine-mapped to stages and Atlas anchors');
  const runtime = await read('packages/atlas-runtime/index.mjs');
  const runtimeTest = await read('packages/atlas-runtime/index.test.mjs');
  check('V111 durable runtime', runtime.includes('compileDurableWorkflow') && runtime.includes('checkpointExecution') && runtime.includes('createQueueJob') && runtime.includes('createConnectorSdkDefinition') && runtimeTest.includes('queue leases'), 'n8n-class workflow execution has deterministic compilation, checkpoint/resume, queue leases and connector invocation gates');
  const product = await read('packages/atlas-product/index.mjs');
  const productTest = await read('packages/atlas-product/index.test.mjs');
  check('V111 product resource safety', product.includes('defineProductResource') && product.includes('planProductResourcePublish') && product.includes('createFeatureBundle') && productTest.includes('feature bundles'), 'GHL-class product resources are tenant-bound, checksummed and protected by publish/permission gates');

  const business = await read('packages/atlas-business/index.mjs');
  const businessTest = await read('packages/atlas-business/index.test.mjs');
  check('V111 business surface', business.includes('createCampaign') && business.includes('submitForm') && business.includes('createAdCampaign') && business.includes('createCourse') && business.includes('createSaaSPlan') && businessTest.includes('marketplace packages'), 'GHL-class business resources have bounded tenant-safe contracts and publish/spend/entitlement gates');
  const v111Sql = await read('infra/postgres/FINAL-MIGRATION-V111.sql');
  check('V111 durable persistence', v111Sql.includes('atlas_product_resources') && v111Sql.includes('atlas_workflow_executions') && v111Sql.includes('atlas_queue_jobs') && v111Sql.includes('FORCE ROW LEVEL SECURITY') && !/BYPASSRLS/i.test(v111Sql), 'V111 product/workflow/queue persistence is tenant-isolated with forced RLS');

  const engagement = await read('packages/customer-operations/engagement.mjs');
  check('tenant-bound message renderer', engagement.includes('export function renderMessageTemplateVersion') && engagement.includes('Message template tenant does not match') && engagement.includes('Email HTML contains a tag or attribute outside the safe formatting allowlist') && engagement.includes('needs_data'), 'Template renderer is tenant-bound, context-escapes HTML, restricts markup and fails closed on missing fields');
} catch (error) {
  checks.push({ name: 'doctor setup', passed: false, detail: error.message });
}

for (const result of checks) process.stdout.write(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}\n`);
const failed = checks.filter(result => !result.passed).length;
process.stdout.write(`Atlas doctor: ${checks.length - failed}/${checks.length} checks passed.\n`);
if (failed) process.exitCode = 1;
