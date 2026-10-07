import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKFLOW_NODE_CATALOG, WORKFLOW_NODE_TYPES } from './workflow-catalog.mjs';

test('extended workflow catalog exposes hardened n8n-depth control nodes', () => {
  for (const type of [
    'connector_action','graphql_request','soap_request','oauth2','basic_auth','bearer_auth','hmac_auth',
    'custom_headers','pagination','retry','circuit_breaker','batch','parallel','router','error_branch',
    'dead_letter','replay_execution','resume_execution','execution_snapshot','workflow_diff',
    'workflow_promote','workflow_rollback','workflow_as_tool','workflow_as_agent_tool','credential_ref',
    'kv_get','kv_set','json_parse','csv_parse','xml_parse','sql_query','javascript_sandbox','python_sandbox'
  ]) {
    assert.equal(Object.hasOwn(WORKFLOW_NODE_CATALOG, type), true, type);
    assert.equal(WORKFLOW_NODE_TYPES.includes(type), true, type);
  }
});

test('network and code nodes remain explicitly adapter/sandbox gated', () => {
  assert.equal(WORKFLOW_NODE_CATALOG.connector_action.requiresAdapter, true);
  assert.equal(WORKFLOW_NODE_CATALOG.graphql_request.requiresAdapter, true);
  assert.equal(WORKFLOW_NODE_CATALOG.soap_request.requiresAdapter, true);
  assert.equal(WORKFLOW_NODE_CATALOG.javascript_sandbox.requiresAdapter, true);
  assert.equal(WORKFLOW_NODE_CATALOG.python_sandbox.requiresAdapter, true);
});
