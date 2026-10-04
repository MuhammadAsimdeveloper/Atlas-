import assert from 'node:assert/strict';
import test from 'node:test';
import { createGrowthRecord, updateGrowthRecord, transitionGrowthRecord, verifyGrowthRecord, renderGrowthPagePreview, calculateAffiliateCommission, scoreLeadQualification, planLeadStageMove, GROWTH_MODULES } from './index.mjs';

const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId='11111111-1111-4111-8111-111111111111';
const recordId='22222222-2222-4222-8222-222222222222';

test('Growth Center provides strict payload contracts for every requested module', () => {
  assert.equal(GROWTH_MODULES.length,13);
  const cases = [
    ['contacts',{ firstName:'Ari',email:'ari@example.net',consent:{email:false,sms:false,whatsapp:false} }],
    ['leads',{ contactId:actorId,pipelineId:recordId,stageId:'new',status:'new' }],
    ['pipelines',{ name:'Sales',stages:[{id:'new',name:'New'},{id:'won',name:'Won',isClosedWon:true}] }],
    ['tasks',{ title:'Call back',contactId:actorId }],
    ['ai-qualification',{ name:'Lead score',instructions:'Use evidence.',criteria:[{id:'fit',label:'Fit',weight:100}],requireHumanReview:true }],
    ['ai-follow-up',{ name:'Welcome',purpose:'service',trigger:'lead.created',steps:[{id:'one',delayMinutes:0,channel:'webchat',templateId:actorId,connectionId:recordId}] }],
    ['workflows',{ name:'Contact flow',graph:{nodes:[{id:'start',type:'trigger',config:{eventType:'contact.created'}},{id:'end',type:'stop'}],edges:[{from:'start',to:'end'}]} }],
    ['email-templates',{ name:'Welcome',purpose:'service',subject:'Hello',body:'Welcome',format:'plain_text' }],
    ['funnels',{ name:'Service funnel',slug:'service-funnel',blocks:[{type:'hero',heading:'Welcome'}] }],
    ['websites',{ name:'Company site',slug:'company-site',blocks:[{type:'text',body:'About us'}] }],
    ['social-planner',{ name:'Post',channels:['linkedin'],caption:'A useful update',scheduledAt:new Date(Date.now()+60_000).toISOString() }],
    ['affiliate-system',{ name:'Referral partners',code:'NORTHSTAR',commissionBps:800,attributionDays:45 }],
    ['reputation-management',{ name:'Review ask',requestTemplateId:actorId,channels:['email'] }]
  ];
  for (const [module,payload] of cases) {
    const record=createGrowthRecord({ tenantId,module,id:recordId,actorId,payload });
    assert.equal(record.module,module);
    assert.equal(verifyGrowthRecord(record),true);
  }
});

test('contact consent defaults off, payload fields are allowlisted and checksums detect tampering', () => {
  const contact=createGrowthRecord({ tenantId,module:'contacts',id:recordId,actorId,payload:{firstName:'Ari',email:'ari@example.net'} });
  assert.deepEqual(contact.payload.consent,{email:false,sms:false,whatsapp:false});
  assert.throws(() => createGrowthRecord({ tenantId,module:'contacts',id:recordId,actorId,payload:{firstName:'Ari',email:'ari@example.net',platformOwner:true} }), /unsupported fields/);
  assert.throws(() => createGrowthRecord({ tenantId,module:'contacts',id:recordId,actorId,payload:{firstName:'Ari',phone:'5551234567'} }), /E.164/);
  assert.equal(verifyGrowthRecord({...contact,title:'Tampered'}),false);
});

test('invalid workflow graphs fail as bounded client validation errors', () => {
  assert.throws(() => createGrowthRecord({ tenantId, module: 'workflows', id: recordId, actorId, payload: {
    name: 'Bad graph', graph: { nodes: [{ id: 'start', type: 'trigger', config: { eventType: 'contact.created' } }, { id: 'end', type: 'stop' }], edges: [{ from: 'start', to: 'missing' }] }
  } }), error => error.status === 400 && error.code === 'invalid_workflow_graph');
});

test('task revisions maintain state, enforce optimistic locking and block terminal edits', () => {
  const task=createGrowthRecord({tenantId,module:'tasks',id:recordId,actorId,payload:{title:'Call lead',contactId:actorId,status:'open'}});
  const updated=updateGrowthRecord({record:task,tenantId,actorId,expectedVersion:1,payload:{title:'Call lead',contactId:actorId,status:'in_progress'}});
  assert.equal(updated.state,'in_progress');
  assert.equal(updated.version,2);
  assert.throws(() => updateGrowthRecord({record:task,tenantId,actorId,expectedVersion:0,payload:task.payload}), {code:'version_conflict'});
  const completed=transitionGrowthRecord({record:updated,tenantId,actorId,expectedVersion:2,action:'complete'});
  assert.equal(completed.state,'completed');
  assert.throws(() => updateGrowthRecord({record:completed,tenantId,actorId,expectedVersion:3,payload:completed.payload}), {code:'terminal_task_locked'});
});

test('page preview escapes content, keeps previews non-indexable, and requires a verified domain to publish', () => {
  const page=createGrowthRecord({tenantId,module:'websites',id:recordId,actorId,payload:{name:'Safe site',slug:'safe-site',title:'<script>hi</script>',blocks:[{type:'text',heading:'<img src=x>',body:'Safe copy'}]}});
  const preview=renderGrowthPagePreview({record:page,tenantId});
  assert.match(preview,/&lt;script&gt;/);
  assert.match(preview,/noindex,nofollow/);
  assert.throws(() => transitionGrowthRecord({record:page,tenantId,actorId,expectedVersion:1,action:'publish'}), {code:'verified_domain_required'});
});

test('social publishing stays approval-gated and affiliate commissions use minor currency units', () => {
  const post=createGrowthRecord({tenantId,module:'social-planner',id:recordId,actorId,payload:{name:'Weekly note',channels:['linkedin'],caption:'One thing we learned',scheduledAt:new Date(Date.now()+60_000).toISOString(),approvalRequired:true}});
  const scheduled=transitionGrowthRecord({record:post,tenantId,actorId,expectedVersion:1,action:'publish'});
  assert.equal(scheduled.state,'scheduled');
  assert.equal(scheduled.payload.approvalStatus,'pending');
  const approved=transitionGrowthRecord({record:scheduled,tenantId,actorId,expectedVersion:2,action:'approve'});
  assert.equal(approved.payload.approvalStatus,'approved');
  assert.deepEqual(calculateAffiliateCommission({amountMinor:12_345,commissionBps:1000,currency:'USD'}),{status:'pending_review',commissionMinor:1234,currency:'USD'});
  assert.equal(calculateAffiliateCommission({amountMinor:12_345,commissionBps:1000,currency:'USD',paid:false}).status,'ineligible');
});

test('lead qualification rubric is weighted, evidence-aware and explicitly reviewable', () => {
  const profile=createGrowthRecord({tenantId,module:'ai-qualification',id:recordId,actorId,payload:{name:'Service fit',instructions:'Score evidence only.',criteria:[{id:'fit',label:'Service fit',weight:60,evidenceRequired:true},{id:'timing',label:'Timing',weight:40,evidenceRequired:true}],requireHumanReview:false}});
  const result=scoreLeadQualification({profile:profile.payload,ratings:{fit:90,timing:70},evidenceRefs:{fit:'call:12',timing:'form:8'},now:'2026-10-03T12:00:00Z'});
  assert.equal(result.score,82);
  assert.equal(result.status,'ready');
  assert.equal(result.outcome,'sales_ready');
  assert.deepEqual(result.evidenceRefs,['call:12','form:8']);
  const incomplete=scoreLeadQualification({profile:profile.payload,ratings:{fit:90},evidenceRefs:{fit:'call:12'}});
  assert.equal(incomplete.status,'needs_review');
  assert.ok(incomplete.reasonCodes.includes('missing_evidence:timing'));
  assert.throws(() => scoreLeadQualification({profile:profile.payload,ratings:{fit:101},evidenceRefs:{}}),/integer from 0 to 100/);
  assert.throws(() => createGrowthRecord({tenantId,module:'ai-qualification',id:recordId,actorId,payload:{name:'Bad bands',instructions:'Score evidence only.',criteria:[{id:'fit',label:'Service fit',weight:100}],scoreBands:[{min:0,max:40,outcome:'review'},{min:45,max:70,outcome:'nurture'},{min:71,max:100,outcome:'sales_ready'}]}}),/cover 0-100 exactly once/);
});

test('pipeline stage moves are tenant-pinned and honor forward, skip and backward rules', () => {
  const pipeline=createGrowthRecord({tenantId,module:'pipelines',id:recordId,actorId,payload:{name:'Sales',stages:[{id:'new',name:'New'},{id:'qualified',name:'Qualified'},{id:'won',name:'Won',isClosedWon:true}]}});
  const lead=createGrowthRecord({tenantId,module:'leads',id:'33333333-3333-4333-8333-333333333333',actorId,payload:{contactId:actorId,pipelineId:recordId,stageId:'new',status:'new'}});
  const next=planLeadStageMove({lead,pipeline,stageId:'qualified'});
  assert.deepEqual({changed:next.changed,stageId:next.stageId,status:next.status,direction:next.direction},{changed:true,stageId:'qualified',status:'new',direction:'forward'});
  assert.throws(() => planLeadStageMove({lead,pipeline,stageId:'won'}),{code:'stage_skip_blocked'});
  const moved=updateGrowthRecord({record:lead,tenantId,actorId,expectedVersion:1,payload:{...lead.payload,stageId:'qualified'}});
  assert.throws(() => planLeadStageMove({lead:moved,pipeline,stageId:'new'}),{code:'stage_move_approval_required'});
  const allowSkipPipeline=createGrowthRecord({tenantId,module:'pipelines',id:'44444444-4444-4444-8444-444444444444',actorId,payload:{name:'Flexible',stages:[{id:'new',name:'New'},{id:'won',name:'Won',isClosedWon:true}],rules:{allowBackward:true,allowSkip:true,requireApprovalOnBackward:false}}});
  const flexibleLead=createGrowthRecord({tenantId,module:'leads',id:'55555555-5555-4555-8555-555555555555',actorId,payload:{contactId:actorId,pipelineId:allowSkipPipeline.id,stageId:'new',status:'new'}});
  const flexibleWon=planLeadStageMove({lead:flexibleLead,pipeline:allowSkipPipeline,stageId:'won'});
  assert.equal(flexibleWon.status,'won');
  assert.equal(flexibleWon.direction,'forward');
});
