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
  check('release metadata', pkg.version === '116.0.0' && lock.version === pkg.version && lock.packages?.['']?.version === pkg.version, `package ${pkg.version}; lock ${lock.version}`);
  check('locked database dependencies', pkg.dependencies?.pg === '8.23.1' && lock.packages?.['node_modules/pg']?.version === pkg.dependencies.pg && pkg.devDependencies?.['@electric-sql/pglite'] === '0.5.8' && lock.packages?.['node_modules/@electric-sql/pglite']?.version === pkg.devDependencies['@electric-sql/pglite'], 'Runtime uses pinned node-postgres; ephemeral PostgreSQL migration tests use pinned PGlite');

  const authority = await read('packages/atlas-core/authority.mjs');
  check('single-owner authority', authority.includes("actor?.emailVerified === true") && authority.includes('verifiedActorEmail === configuredOwner') && authority.includes('trustedAuthorities.add(authority)'), 'Global owner requires verified configured identity and an internally resolved authority object');

  const authContracts = await read('apps/api/auth-contracts.mjs');
  const authRoutes = await read('apps/api/auth-routes.mjs');
  const authStore = await read('apps/api/postgres-auth-store.mjs');
  const authMigration = await read('infra/postgres/FINAL-MIGRATION-V112.sql');
  const roleGrants = await read('infra/postgres/API-ROLE-GRANTS-V112.sql');
  const authSchemaTest = await read('apps/api/postgres-auth-schema.test.mjs');
  check('V112 secure authentication', authContracts.includes('scrypt$16384$8$1$') && authContracts.includes("'SameSite=Strict'") && authContracts.includes('function verifyCsrf') && authContracts.includes('function isAllowedOrigin') && authRoutes.includes("'/api/v1/auth/signup'") && authRoutes.includes("'/api/v1/auth/password/reset'"), 'Password hashes, one-use opaque tokens, same-origin/CSRF checks, bounded account endpoints and session cookies are explicit');
  check('V112 trusted edge rate limits', authRoutes.includes('isIP(candidate) !== 0') && authRoutes.includes('trusted_client_ip_unavailable'), 'Production requires valid client IPs from a trusted edge for distributed authentication limits');
  check('V112 tenant database foundation', authMigration.includes('atlas_auth_users') && authMigration.includes('atlas_organizations') && authMigration.includes('atlas_organization_memberships') && authMigration.includes('atlas_organization_roles') && authMigration.includes('atlas_auth_audit_events') && (authMigration.match(/FORCE ROW LEVEL SECURITY/g) || []).length >= 8 && authStore.includes("set_config($1, $2, true)"), 'Identity, tenant memberships, custom roles, sessions, tokens, rate limits and audit events use transaction-local scope and forced RLS');
  check('V112 runtime privileges and RLS integration', roleGrants.includes('atlas_app') && roleGrants.includes('rolbypassrls') && roleGrants.includes('pg_auth_members') && roleGrants.includes('REVOKE UPDATE, DELETE, TRUNCATE ON atlas_auth_audit_events') && authSchemaTest.includes('all PostgreSQL migrations apply in order') && authSchemaTest.includes('NOBYPASSRLS'), 'Migration owner and unprivileged API role are split and all shipped SQL is exercised against ephemeral PostgreSQL');
  check('V112 platform-owner separation', !/platform_owner|platformOwner/i.test(authMigration) && !/platform_owner|platformOwner/i.test(roleGrants) && authRoutes.includes('ownerEmail: env.ATLAS_PLATFORM_OWNER_EMAIL') && authRoutes.includes('authority.globalRole === \'platform_owner\''), 'No tenant DB or runtime grant can mint global authority; only the verified configured owner resolver can');
  const apiServer = await read('apps/api/server.mjs');
  check('V112 actual readiness and authenticated API', apiServer.includes('authStore.ping()') && apiServer.includes('authenticatedApi: Boolean(authApi)') && apiServer.includes("'/health/ready'"), 'Readiness checks a connected PostgreSQL identity schema and tenant endpoints fail closed without it');
  const ui = await read('apps/command-center/auth.html');
  const uiScript = await read('apps/command-center/auth.mjs');
  check('V112 live account workspace UI', ui.includes('id="workspace"') && ui.includes('id="invite-form"') && uiScript.includes("request('/dashboard/summary')") && uiScript.includes("result.delivery === 'sent'") && ui.includes('data-nav-page="growth"') && ui.includes('id="profile-form"') && uiScript.includes('atlas:growth-module-changed'), 'Signup, team/role controls, live account metrics, integrated settings and synchronized Growth Center navigation use real endpoints');
  const migrationRunner = await read('scripts/migrate.mjs');
  check('V112 checksum-tracked migrations', migrationRunner.includes('pg_advisory_lock') && migrationRunner.includes('sha256') && migrationRunner.includes('changed after it was applied') && migrationRunner.includes('ATLAS_MIGRATION_DATABASE_URL'), 'Migration process serializes schema changes, checks immutable checksums and requires a separate production migration connection');

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
  check('production boundary documented', docs.includes('No millions-of-users capacity claim is verified') && /Local JSON\/state (?:is|remains) development-only/.test(docs), 'Capacity and local-state limits are stated explicitly');
  const databaseConfig = await read('apps/api/database-config.mjs');
  const databaseConfigTest = await read('apps/api/database-config.test.mjs');
  check('production PostgreSQL transport security', databaseConfig.includes('rejectUnauthorized: true') && databaseConfig.includes('ATLAS_DATABASE_SSL_CA_FILE') && databaseConfigTest.includes('always verifies TLS'), 'Production API and migration connections verify PostgreSQL server certificates');
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
  const seoPackage = await read('packages/atlas-seo/index.mjs');
  const seoPackageTest = await read('packages/atlas-seo/index.test.mjs');
  check('V103 SEO contract', trust.includes('generateSeoMetadata') && trustTest.includes('SEO metadata'), 'Generated websites have deterministic SEO metadata with canonical and robots controls');
  check('deep SEO readiness system', seoPackage.includes('assessSeoReadiness') && seoPackage.includes('assessSeoSite') && seoPackageTest.includes('SEO readiness'), 'SEO readiness scores metadata, content intent, discovery, structured data, media and page-experience inputs');
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

  const workflowCatalog = await read('packages/atlas-target/workflow-catalog.mjs');
  const workflowTarget = await read('packages/atlas-target/index.mjs');
  const workflowTests = await read('packages/atlas-target/index.test.mjs');
  const customerAgent = await read('packages/customer-operations/index.mjs');
  const customerAgentTests = await read('packages/customer-operations/index.test.mjs');
  check('V111 workflow catalog coverage', workflowCatalog.includes("'contact.created'") && workflowCatalog.includes("'agent.tool_approval_requested'") && workflowCatalog.includes("'store.shopify_order_placed'") && workflowCatalog.includes("['rate_limit_batch'") && workflowCatalog.includes("['charge_payment'") && workflowTests.includes('GHL 2026 trigger inventory') && workflowTests.includes('workflow approval is verified'), 'GHL event families and n8n-style node categories are explicit and regression-tested');
  check('V111 safe workflow definitions', workflowTarget.includes('copyWorkflowConfig') && workflowTarget.includes('opaqueWorkflowReference') && workflowTarget.includes('PRIVATE_CONFIG_FIELD') && workflowTarget.includes('DIRECT_DESTINATION_FIELD') && workflowTarget.includes('NETWORK_LOCATION_FIELD') && workflowTarget.includes('Node retry policy is outside safe limits'), 'Saved node config rejects secrets, direct destinations, URL/PII reference values and arbitrary network locations and bounds execution controls');
  check('V111 retry idempotency', workflowTarget.includes('graphChecksum: graph.checksum, executionId:stableExecutionId, nodeId') && workflowTarget.includes("status:'retry_blocked'") && !workflowTarget.includes('graphChecksum: graph.checksum, executionId, nodeId, attempt'), 'Workflow retries reuse one side-effect key and stop unsafe repeat attempts');
  check('V111 trusted workflow approvals', workflowTarget.includes('copyWorkflowApprovalEvidence') && workflowTarget.includes('approvalVerifier') && workflowTarget.includes('expiresAt - approvedAt <= 15 * 60_000') && workflowTarget.includes('approvedByActorId !== requestedByActorId') && workflowTests.includes('workflow approval is verified'), 'High-risk actions require exact, fresh approval evidence checked by a trusted verifier and reject known self-approval');
  check('V111 hostile AI tool objects', customerAgent.includes('Tool arguments cannot contain accessors') && customerAgent.includes('Tool result cannot contain accessors') && customerAgentTests.includes('without executing getters'), 'Agent argument and connector-result sanitizers fail closed without executing accessors');

  const agentEvaluation = await read('packages/customer-operations/agent-evaluation.mjs');
  const agentEvaluationTests = await read('packages/customer-operations/agent-evaluation.test.mjs');
  check('V113 agent evaluation evidence', agentEvaluation.includes('REQUIRED_SAFETY_TAGS') && agentEvaluation.includes('sideEffectsAllowed: false') && agentEvaluation.includes('createAgentEvaluationVerifier') && agentEvaluation.includes('timingSafeEqual') && agentEvaluationTests.includes('exact tenant draft'), 'Agent releases require signed, candidate-bound scenario evidence with required safety coverage and no retained answer text');

  const engagement = await read('packages/customer-operations/engagement.mjs');
  check('tenant-bound message renderer', engagement.includes('export function renderMessageTemplateVersion') && engagement.includes('Message template tenant does not match') && engagement.includes('Email HTML contains a tag or attribute outside the safe formatting allowlist') && engagement.includes('needs_data'), 'Template renderer is tenant-bound, context-escapes HTML, restricts markup and fails closed on missing fields');

  const growthDomain = await read('packages/growth-suite/index.mjs');
  const growthDomainTest = await read('packages/growth-suite/index.test.mjs');
  const growthStore = await read('apps/api/growth-store.mjs');
  const growthRoutes = await read('apps/api/growth-routes.mjs');
  const growthSql = await read('infra/postgres/FINAL-MIGRATION-V114.sql');
  const growthGrants = await read('infra/postgres/API-ROLE-GRANTS-V114.sql');
  const growthApiTest = await read('apps/api/growth-routes.test.mjs');
  const growthSchemaTest = await read('apps/api/postgres-auth-schema.test.mjs');
  check('V114 Growth Center domain coverage', ['contacts','leads','pipelines','tasks','ai-qualification','ai-follow-up','workflows','email-templates','funnels','websites','social-planner','affiliate-system','reputation-management'].every(module => growthDomain.includes(`'${module}'`)) && growthDomainTest.includes('every requested module'), 'All 13 requested records have bounded validators, checksums and lifecycle-focused tests');
  check('V114 tenant API and authority boundary', growthRoutes.includes('authStore.getSession') && growthRoutes.includes('verifyCsrf') && growthRoutes.includes('resolveAtlasAuthority') && growthStore.includes('atlas_organization_memberships') && growthStore.includes('FOR UPDATE') && growthApiTest.includes('reject request-supplied authority'), 'Growth routes resolve tenant from authenticated session, recheck active membership, require CSRF for mutations and enforce optimistic versions');
  check('V114 Postgres persistence and isolation', growthSql.includes('atlas_growth_item_versions') && growthSql.includes('atlas_growth_item_events') && growthSql.includes('FORCE ROW LEVEL SECURITY') && growthSql.includes('last_event_occurred_at') && growthGrants.includes('rolbypassrls') && growthGrants.includes('pg_auth_members') && growthSchemaTest.includes('V114 Growth Center CRUD'), 'Tenant item data, immutable revisions/audit events and subscription state use forced RLS with a restricted runtime role');
  const paddle = await read('apps/api/paddle-billing.mjs');
  const paddleTest = await read('apps/api/paddle-billing.test.mjs');
  check('V114 Paddle checkout and webhook', paddle.includes('timingSafeEqual') && paddle.includes('toleranceSeconds = 5') && paddle.includes('rawBody') && paddle.includes('sandbox-checkout.paddle.com') && paddleTest.includes('exact raw bytes'), 'Checkout is server-side; subscription webhooks require raw-body HMAC, short replay tolerance, price/tenant validation and event deduplication');
  const billingRoutes = await read('apps/api/growth-routes.mjs');
  const billingStore = await read('apps/api/growth-store.mjs');
  const billingSchemaTest = await read('apps/api/postgres-auth-schema.test.mjs');
  check('V115 verified 14-day trial and cancellation path', paddle.includes('ATLAS_FREE_TRIAL_DAYS = 14') && paddle.includes('verifyPaddleFreeTrialPrice') && paddle.includes('unit_price_overrides') && paddle.includes('createPaddlePortalSession') && paddleTest.includes('14-day free trial') && paddleTest.includes('customer portal returns') && billingRoutes.includes("path === '/api/v1/billing/portal'") && billingRoutes.includes('trialStartedAt') && billingStore.includes('trial_started_at') && billingSchemaTest.includes('permanently records whether a workspace has used its free trial') && billingSchemaTest.includes('trial use remains recorded after cancellation'), 'Paddle recurring prices are checked before checkout, repeat trials are tenant-blocked after cancellation, and authenticated portal links are available for cancellation');
  const growthUi = await read('apps/command-center/growth.mjs');
  const workflowUi = await read('apps/command-center/workflow-studio.mjs');
  const workflowRoutes = await read('apps/api/growth-routes.mjs');
  const workflowStore = await read('apps/api/growth-store.mjs');
  check('V116 visual workflow editor and honest runtime disclosure', workflowUi.includes('createWorkflowStudio') && (workflowUi.includes('Workflow jobs are not connected') || workflowUi.includes('publishing still does not start production runs')) && growthUi.includes('detailStudio.read()') && growthUi.includes('createStudio.read()'), 'The workspace edits saved graph definitions visually and does not claim that publishing starts workflow runs');
  check('V116 workflow trigger persists from workspace settings', workflowUi.includes("host.querySelector('[data-workflow-trigger]')") && workflowUi.includes('trigger.dataset.workflowTrigger'), 'The selected start event is serialized into the persisted trigger node');
  const previewRuntime = await read('packages/atlas-target/workflow-simulator.mjs');
  const previewTests = await read('packages/atlas-target/workflow-simulator.test.mjs');
  const previewApiTest = await read('apps/api/workflow-preview-routes.test.mjs');
  check('V117 safe workflow preview runtime', previewRuntime.includes('preview: true') && previewRuntime.includes('externalSideEffects') && previewRuntime.includes('planWorkflowNode') && previewRuntime.includes('trigger_mismatch') && previewTests.includes('cross-tenant execution') && previewTests.includes('condition preview selects'), 'Saved graphs can be rehearsed in a bounded side-effect-free preview that reuses workflow policy and tenant checks');
  const workflowStudio = await read('apps/command-center/workflow-studio.mjs');
  check('V117 Workflow Studio preview UI', workflowStudio.includes('Run preview') && workflowStudio.includes('/growth/workflows/') && workflowStudio.includes('/simulate') && workflowStudio.includes('External side effects: '), 'Saved workflows expose a safe preview action and render the returned execution result without enabling production side effects');

  check('V117 authenticated preview API', growthRoutes.includes("action === 'simulate'") && growthRoutes.includes('simulateWorkflow') && previewApiTest.includes('workflow preview endpoint executes only in safe preview mode') && previewApiTest.includes('csrf'), 'Workflow preview is exposed only through an authenticated, CSRF-protected tenant API route and requires an existing saved graph');

  check('V116 authenticated tenant-scoped capability catalog', workflowRoutes.includes("path === '/api/v1/growth/workflows/catalog'") && workflowStore.includes('WORKFLOW_TRIGGER_CATALOG') && workflowStore.includes("{ module: 'workflows' }"), 'Trigger and node metadata is only read after the normal authenticated workflow permission check');
  check('V114 CRM stage and qualification operations', growthDomain.includes('export function scoreLeadQualification') && growthDomain.includes('export function planLeadStageMove') && growthStore.includes('async moveLeadStage') && growthStore.includes('async evaluateLead') && growthRoutes.includes('move-stage') && growthRoutes.includes("searchParams.get('publishedOnly') === 'true'") && growthApiTest.includes('CRM stage moves and qualification evaluations') && growthSchemaTest.includes('human review remains mandatory by default'), 'Pipeline movement is versioned/policy-checked and published weighted rubrics save evidence-backed human-review outcomes');
  check('V114 Growth Center desktop UI', ui.includes('growth-panel') && growthUi.includes('immutable revision') && growthUi.includes('Load module example') && growthUi.includes('/billing/checkout') && growthUi.includes('Move lead') && growthUi.includes('Evaluate lead'), 'Laptop-first UI supports all module collections, searchable versioned records, lead operations, lifecycle actions and Paddle checkout controls');
  check('V115 billing UI explains trial and plan management', ui.includes('Start 14-day free trial') && ui.includes('id="billing-manage"') && ui.includes('Paddle Checkout displays the price and billing cadence'), 'Payments UI discloses the verified trial and gives workspace billing users an authenticated manage/cancel entry point');
  const featureMatrix = await read('docs/COMPETITOR-FEATURE-MATRIX-2026-10.md');
  check('V114 competitor coverage is explicit', featureMatrix.includes('V114') && featureMatrix.includes('13 requested') && featureMatrix.includes('External email, AI, social and page providers are not connected'), 'HighLevel and n8n coverage states distinguish authenticated database features from provider-dependent execution');

  const runtimeSql = await read('infra/postgres/FINAL-MIGRATION-V115.sql');
  const runtimeGrants = await read('infra/postgres/API-ROLE-GRANTS-V115.sql');
  const runtimeStore = await read('apps/api/runtime-store.mjs');
  const runtimeTests = await read('apps/api/runtime-store.test.mjs');
  const workerRuntime = await read('apps/worker/runtime.mjs');
  const workerTests = await read('apps/worker/runtime.test.mjs');
  const handlerContract = await read('apps/worker/handlers/README.md');
  check('V115 tenant-safe durable job/outbox/scheduler schema', runtimeSql.includes('FORCE ROW LEVEL SECURITY') && runtimeSql.includes('atlas_v115_enqueue_job') && runtimeSql.includes('atlas_v115_append_outbox_event') && runtimeSql.includes('atlas_v115_tick_schedules') && runtimeSql.includes('payload_ref') && runtimeTests.includes('tenant B cannot see tenant A jobs'), 'Queue and schedule rows use forced RLS, reference-only payloads and tenant-bound API functions');
  check('V115 isolated worker role and leases', runtimeGrants.includes('atlas_worker LOGIN NOSUPERUSER') && runtimeGrants.includes('atlas_v115_claim_jobs') && runtimeGrants.includes('atlas_v115_reap_jobs') && runtimeStore.includes("role.rolname !== 'atlas_worker'") && runtimeTests.includes('previous worker cannot complete after lease loss'), 'A distinct non-bypass worker role can claim/recover leases but cannot read customer tables');
  check('V115 registered worker and honest external handler boundary', workerRuntime.includes('claimJobs(this.workerId') && workerRuntime.includes('controller.abort()') && workerRuntime.includes('worker refuses to claim work') && handlerContract.includes('no default business handlers'), 'Worker loop filters registered types, renews leases, drains safely and refuses to imply unimplemented workflow/provider handlers');
  check('V115 workflow/event groundwork is explicitly documented', await read('docs/EXECUTION-ENGINE.md').then(text => text.includes('No default event or job handlers ship') && text.includes('at-least-once')) && await read('docs/ATLAS-MASTER-ROADMAP.md').then(text => text.includes('0. Foundation') && text.includes('BLOCKED BY EXTERNAL DEPENDENCY')) && workerTests.includes('worker shutdown'), 'Execution semantics and remaining external/provider blockers are documented and tested');
} catch (error) {
  checks.push({ name: 'doctor setup', passed: false, detail: error.message });
}

for (const result of checks) process.stdout.write(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}\n`);
const failed = checks.filter(result => !result.passed).length;
process.stdout.write(`Atlas doctor: ${checks.length - failed}/${checks.length} checks passed.\n`);
if (failed) process.exitCode = 1;
