import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceReport, validateEvidenceRecord } from './deployment-evidence.mjs';

const manifest={schema:1,requiredControls:['managed_postgres','redis_ha'],evidenceRules:{maxAgeDays:30}};
const record=(control,status='verified')=>({control,status,evidenceSha256:'a'.repeat(64),verifiedAt:'2026-10-05T00:00:00Z'});

test('deployment evidence expires and launch cannot be inferred from repository presence',()=>{
 const r=buildEvidenceReport({release:'150.0.0',manifest,records:[record('managed_postgres')] ,now:new Date('2026-12-01T00:00:00Z')});
 assert.equal(r.ready,false);assert.equal(r.status,'expired');assert.deepEqual(r.missing,['managed_postgres','redis_ha']);
});

test('complete verified evidence produces a ready report',()=>{
 const r=buildEvidenceReport({release:'150.0.0',manifest,records:[record('managed_postgres'),record('redis_ha')],now:new Date('2026-10-06T00:00:00Z')});
 assert.equal(r.ready,true);assert.equal(r.verifiedControls,2);assert.equal(r.status,'ready');assert.equal(r.manifestSha256.length,64);
});

test('evidence records require known controls and verified timestamps',()=>{
 assert.throws(()=>validateEvidenceRecord({control:'unknown',status:'verified',verifiedAt:'2026-10-05T00:00:00Z'}));
 assert.throws(()=>validateEvidenceRecord({control:'redis_ha',status:'verified'}));
});
