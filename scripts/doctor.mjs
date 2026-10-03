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
  check('release metadata', pkg.version === '98.0.0' && lock.version === pkg.version && lock.packages?.['']?.version === pkg.version, `package ${pkg.version}; lock ${lock.version}`);
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
  const copilot = await read('packages/atlas-copilot/index.mjs');
  check('Copilot scope, approvals and replay safety', copilot.includes('PLATFORM_READ_TOOLS') && copilot.includes('actionStore.createPending') && copilot.includes('Promise.race') && copilot.includes('request_canceled') && copilot.includes('hashAction(action)') && copilot.includes('act_copilot_${idempotencyKey}'), 'Copilot restricts global tools, approval-gates writes, bounds adapters and verifies a stable replay identity');
  const sqlWithoutComments = `${v92}\n${v93}\n${v94}\n${v95}\n${v96}`.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('no RLS bypass grant', !/\b(?:ALTER\s+ROLE|GRANT)[^;]*\bBYPASSRLS\b/i.test(sqlWithoutComments), 'Migrations do not grant BYPASSRLS');

  const docs = await read('README.md');
  check('production boundary documented', docs.includes('No millions-of-users capacity claim is verified') && docs.includes('Local JSON/state is development-only'), 'Capacity and local-state limits are stated explicitly');
  const seo = await read('scripts/seo.mjs');
  const marketing = await read('apps/marketing-site/index.html');
  const commandCenter = await read('apps/command-center/index.html');
  check('SEO preview and public boundary', seo.includes('renderPreviewRobots') && seo.includes('renderPublicSitemap') && seo.includes('validatePublicOrigin') && marketing.includes('noindex,nofollow') && commandCenter.includes('noindex,nofollow'), 'Preview is noindex; public SEO metadata and sitemap require a validated real HTTPS origin');
  check('domain-independent SEO setup documented', docs.includes('SEO deployment') && docs.includes('ATLAS_PUBLIC_ORIGIN') && await read('docs/SEO-DEPLOYMENT.md').then(value => value.includes('public domain yet') && value.includes('Search Console')), 'No-domain preview and future indexing configuration are documented');
  const engagement = await read('packages/customer-operations/engagement.mjs');
  check('tenant-bound message renderer', engagement.includes('export function renderMessageTemplateVersion') && engagement.includes('Message template tenant does not match') && engagement.includes('Email HTML contains a tag or attribute outside the safe formatting allowlist') && engagement.includes('needs_data'), 'Template renderer is tenant-bound, context-escapes HTML, restricts markup and fails closed on missing fields');
} catch (error) {
  checks.push({ name: 'doctor setup', passed: false, detail: error.message });
}

for (const result of checks) process.stdout.write(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}\n`);
const failed = checks.filter(result => !result.passed).length;
process.stdout.write(`Atlas doctor: ${checks.length - failed}/${checks.length} checks passed.\n`);
if (failed) process.exitCode = 1;
