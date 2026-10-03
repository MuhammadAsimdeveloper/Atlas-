import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FULL_FEATURE_CATALOG,GHL_FEATURES,N8N_FEATURES,STATUS,
  assessFullFeatureCoverage,assertFeatureCatalogComplete,COVERAGE_DEFINITIONS,NEXT_FRONTIER
} from './index.mjs';

test('full GHL+n8n catalog is exhaustive enough to prevent silent omissions', () => {
  const result=assertFeatureCatalogComplete();
  assert.equal(result.ok,true);
  assert.ok(result.total>=300);
  assert.ok(result.ghl>=200);
  assert.ok(result.n8n>=100);
});

test('every feature is mapped to an Atlas implementation anchor and stage', () => {
  for (const row of FULL_FEATURE_CATALOG) {
    assert.ok(row.atlasAnchor);
    assert.match(row.stage,/^V105$|^V11[1-9]$|^V120$/);
    assert.ok(Object.values(STATUS).includes(row.atlasStatus));
  }
});

test('coverage report separates contract, build and deployment boundaries', () => {
  const report=assessFullFeatureCoverage({
    implemented:['contacts','crm','workflow_automation'],
    deployed:['contacts']
  });
  assert.ok(report.total>=300);
  assert.ok(report.contract>0);
  assert.ok(report.build>0);
  assert.ok(report.implemented>=0);
  assert.ok(report.notImplemented.length>0);
  assert.ok(report.notDeployed.length>0);
  assert.match(COVERAGE_DEFINITIONS.contract,/not a claim of live/);
});

test('frontier contains V111 through V120 without gaps', () => {
  assert.deepEqual(NEXT_FRONTIER.map(x=>x.slice(0,4)),['V111','V112','V113','V114','V115','V116','V117','V118','V119','V120']);
  assert.equal(GHL_FEATURES.every(x=>x.benchmark==='GHL'),true);
  assert.equal(N8N_FEATURES.every(x=>x.benchmark==='n8n'),true);
});
