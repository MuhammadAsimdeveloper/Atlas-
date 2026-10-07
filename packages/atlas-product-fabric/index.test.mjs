import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATLAS_PHASES,
  ATLAS_FEATURES,
  ATLAS_MISSING_FEATURES,
  featureSummary,
  phaseFeatureMatrix
} from './index.mjs';

test('Atlas build is organized into exactly five implementation phases', () => {
  assert.equal(ATLAS_PHASES.length, 5);
  assert.deepEqual(ATLAS_PHASES.map(item => item.id), ['P1','P2','P3','P4','P5']);
});

test('requested core domains are represented in the feature registry', () => {
  const ids = new Set(ATLAS_FEATURES.map(item => item.id));
  for (const id of [
    'connector.oauth2','connector.api_key','connector.custom_rest','connector.graphql',
    'connector.soap','connector.webhook','connector.credential_vault','connector.rotation',
    'platform.action_registry','platform.skill_registry','platform.data_contracts','platform.interfaces','platform.synthetic_tests','commerce.transactional_os','commerce.financial_idempotency','commerce.provider_reconciliation','portal.relationship_scopes','projects.dependency_graph','documents.evidence_bound_signing',
    'automation.visual_editor','automation.error_routes','automation.subworkflow','automation.parallel','automation.dead_letter',
    'crm.custom_objects','crm.buying_committee','crm.predictive_scoring','crm.import_export',
    'marketing.drip_campaigns','marketing.attribution','marketing.social_scheduler',
    'education.course_builder','education.community','commerce.cpq','commerce.usage_billing',
    'portal.customer','portal.partner','portal.freelancer','portal.agency','portal.vendor',
    'projects.gantt','security.sso','security.scim','security.passkeys','security.kms',
    'reliability.multi_region','reliability.otlp','reliability.waf','developer.atlas_api',
    'developer.atlas_sdk','developer.atlas_mcp','marketplace.connectors','marketplace.nodes'
  ]) assert.equal(ids.has(id), true, id);
});

test('feature registry includes gap-closing features beyond the user list', () => {
  const featureIds = new Set(ATLAS_FEATURES.map(item => item.id));
  const gapIds = new Set(ATLAS_MISSING_FEATURES.map(item => item.id));
  for (const id of [
    'core.idempotency','core.event_bus','core.outbox_inbox','core.schema_registry',
    'security.abac','security.data_residency','security.privacy_center',
    'reliability.circuit_breakers','reliability.bulkheads','reliability.backpressure',
    'data.data_lineage','data.data_contracts','ai.prompt_registry','ai.model_routing',
    'ai.eval_harness','ops.incident_management','ops.cost_controls','ops.rate_quotas'
  ]) assert.equal(featureIds.has(id) || gapIds.has(id), true, id);
});

test('feature summary is consistent and every feature belongs to one phase', () => {
  const summary = featureSummary();
  assert.equal(summary.featureCount, ATLAS_FEATURES.length);
  assert.equal(summary.phaseCount, 5);
  for (const feature of ATLAS_FEATURES) assert.ok(['P1','P2','P3','P4','P5'].includes(feature.phase));
  assert.equal(phaseFeatureMatrix().length, 5);
});
