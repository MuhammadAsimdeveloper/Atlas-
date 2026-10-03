import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillAssignment, listSkills, operationalPulse, skillPolicy, validateSkill } from './index.js';

const registry = new Map([
  ['crm.search', {name:'crm.search'}],
  ['crm.update', {name:'crm.update'}],
  ['knowledge.search', {name:'knowledge.search'}]
]);
const tenantSkill = {id:'crm-writer',tenantId:'t1',name:'CRM Writer',tools:['crm.search','crm.update'],maxRisk:'write',approval:'write'};
const actor = {id:'u1',tenantId:'t1',tools:['crm.search','crm.update']};
const agent = {id:'a1',tenantId:'t1',tools:['crm.search','crm.update']};

test('custom skills require a tenant, valid tools and a safe approval policy', () => {
  assert.equal(validateSkill(tenantSkill, registry).ok, true);
  assert.equal(validateSkill({...tenantSkill, tenantId:undefined}, registry).ok, false);
  assert.equal(validateSkill({...tenantSkill, approval:'never'}, registry).ok, false);
  assert.equal(validateSkill({...tenantSkill, tools:['crm.unknown']}, registry).ok, false);
});

test('tenant agent skills intersect actor, agent and skill tools and bind approval evidence', () => {
  const result = skillPolicy({skill:tenantSkill,actor,agent,requestedTools:['crm.search','crm.update']});
  assert.equal(result.code, 'APPROVAL_REQUIRED');
  const approvalEvidence = {
    approvalId:'ap1',status:'approved',approvedAt:new Date().toISOString(),
    tenantId:'t1',actorId:'u1',agentId:'a1',skillId:'crm-writer',
    requestedTools:['crm.update','crm.search']
  };
  assert.equal(skillPolicy({skill:tenantSkill,actor,agent,requestedTools:['crm.search','crm.update'],approvalEvidence}).allowed, true);
  assert.equal(skillPolicy({skill:tenantSkill,actor,agent:{...agent,tenantId:'t2'},requestedTools:['crm.search']}).code, 'TENANT_BOUNDARY_VIOLATION');
});

test('built-in skills cannot be shadowed by tenant custom IDs', () => {
  const skills = listSkills([{...tenantSkill,id:'revenue-analyst',name:'Override'}]);
  assert.equal(skills.find(skill=>skill.id==='revenue-analyst').name, 'Revenue Analyst');
});

test('skill assignments require complete tenant and actor identity', () => {
  assert.throws(()=>createSkillAssignment({tenantId:'t1',agentId:'a1',skillId:'s1'}));
  assert.equal(createSkillAssignment({tenantId:'t1',agentId:'a1',skillId:'s1',actorId:'u1'}).tenantId, 't1');
});

test('operational pulse tolerates malformed business values without emitting NaN', () => {
  const rows = {
    contacts:[{}],deals:[{amount:'not-a-number',probability:2,updatedAt:'broken'},{amount:120,probability:.5,updatedAt:new Date(0).toISOString()}],
    tasks:[{dueAt:'bad',status:'open'},{dueAt:new Date(0).toISOString(),status:'open'}],
    workflowRuns:[{status:'FAILED'}],approvals:[{status:'pending'}],usageCounters:[{}]
  };
  const pulse = operationalPulse({tenantCollection:(name,tenantId)=>{assert.equal(tenantId,'t1');return rows[name]||[];}},'t1');
  assert.equal(pulse.metrics.totalPipeline, 120);
  assert.equal(pulse.metrics.weightedPipeline, 60);
  assert.equal(Number.isFinite(pulse.healthScore), true);
  assert.equal(pulse.metrics.overdueTasks, 1);
});
