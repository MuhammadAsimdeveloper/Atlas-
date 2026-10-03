import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCrmRecord, defineCrmProperty, updateCrmRecord, createCrmAssociation, createCrmPipeline, transitionCrmDeal, searchCrm,
  createWorkflowGraph, verifyWorkflowGraph, planWorkflowNode, summarizeWorkflowExecution, WORKFLOW_NODE_TYPES,
  createBookingCalendar, verifyBookingCalendar, listAvailableSlots, holdBooking, bookAppointment, rescheduleAppointment, cancelAppointment,
  createAgentRuntimePolicy, defineAgentTool, authorizeAgentToolCall, createAgentSession, consumeAgentBudget, completeAgentSession, validateAgentOutput, summarizeAgentExecution
} from './index.mjs';

test('CRM target enforces typed properties, tenant scope, optimistic versions, associations and pipeline governance', () => {
  const schemas = new Map([
    ['stage_id', defineCrmProperty({ key:'stage_id', type:'select', label:'Stage', options:['new','qualified','won'], required:true })],
    ['score', defineCrmProperty({ key:'score', type:'number', label:'Score' })]
  ]);
  assert.throws(() => createCrmRecord({ tenantId:'t1', type:'deal', schemas, properties:{ score:4 } }), /Required CRM property missing/);
  const deal = createCrmRecord({ tenantId:'t1', type:'deal', id:'d1', schemas, properties:{ stage_id:'new', score:4 } });
  const updated = updateCrmRecord({ record:deal, tenantId:'t1', expectedVersion:1, patch:{ score:7 }, schemas });
  assert.equal(updated.version, 2);
  assert.throws(() => updateCrmRecord({ record:updated, tenantId:'t1', expectedVersion:2, patch:{ stage_id:undefined }, schemas }), /cannot be removed/);
  assert.throws(() => updateCrmRecord({ record:deal, tenantId:'t2', expectedVersion:1, patch:{ score:8 }, schemas }), /tenant mismatch/);
  const association = createCrmAssociation({ tenantId:'t1', fromType:'contact', fromId:'c1', toType:'company', toId:'co1', label:'works_at' });
  assert.equal(typeof association.checksum, 'string');
  const pipeline = createCrmPipeline({ tenantId:'t1', id:'sales', name:'Sales', stages:[{id:'new',name:'New'},{id:'qualified',name:'Qualified'},{id:'won',name:'Won',isClosedWon:true}], rules:{allowBackward:false,allowSkip:false} });
  const moved = transitionCrmDeal({ deal, pipeline, toStageId:'qualified', expectedVersion:1 });
  assert.equal(moved.status, 'updated');
  assert.throws(() => transitionCrmDeal({ deal:moved.deal, pipeline, toStageId:'new', expectedVersion:2 }), /Backward/);
  assert.equal(searchCrm({ records:[deal, updated], tenantId:'t1', type:'deal', query:'d1', limit:1 }).items.length, 1);
});

test('workflow-node target is n8n/GHL-shaped but deterministic, bounded and approval-gated', () => {
  for (const type of ['trigger','condition','switch','delay','wait_until','transform','set_field','tag','associate','create_task','send_message','find_availability','book_appointment','reschedule_appointment','cancel_appointment','invoke_agent','sub_workflow','approval','webhook','stop']) assert.ok(WORKFLOW_NODE_TYPES.includes(type));
  const graph = createWorkflowGraph({
    tenantId:'t1', id:'wf1', name:'Lead to booking',
    nodes:[
      {id:'start',type:'trigger',config:{eventType:'contact.created'}},
      {id:'availability',type:'find_availability',config:{calendarRef:'cal1'}},
      {id:'book',type:'book_appointment',config:{calendarRef:'cal1'}},
      {id:'done',type:'stop'}
    ],
    edges:[{from:'start',to:'availability'},{from:'availability',to:'book',port:'available'},{from:'book',to:'done',port:'booked'}]
  });
  assert.equal(verifyWorkflowGraph(graph), true);
  assert.throws(() => createWorkflowGraph({...graph,nodes:[{id:'start',type:'trigger',config:{eventType:'x'}},{id:'done',type:'stop'}],edges:[{from:'start',to:'done'},{from:'done',to:'start'}],checksum:undefined}), /cycle/);
  const destructive = createWorkflowGraph({
    tenantId:'t1', id:'wf2', name:'Cancel',
    nodes:[{id:'start',type:'trigger',config:{eventType:'appointment.canceled'}},{id:'cancel',type:'cancel_appointment',config:{calendarRef:'cal1'}},{id:'done',type:'stop'}],
    edges:[{from:'start',to:'cancel'},{from:'cancel',to:'done'}]
  });
  const pending = planWorkflowNode({ graph:destructive, nodeId:'cancel', tenantId:'t1', executionId:'e1' });
  assert.equal(pending.status, 'needs_approval');
  assert.equal(planWorkflowNode({ graph:destructive, nodeId:'cancel', tenantId:'t1', executionId:'e1', approvalEvidence:{status:'approved',tenantId:'t1',nodeId:'cancel',idempotencyKey:pending.idempotencyKey} }).status, 'planned');
  const summary = summarizeWorkflowExecution({ executionId:'e1', tenantId:'t1', steps:[{nodeId:'cancel',status:'failed',retryCount:2}] });
  assert.equal(summary.retries, 2);
});

test('booking calendar target supports availability, holds, capacity and versioned lifecycle', () => {
  const calendar = createBookingCalendar({
    tenantId:'t1', id:'cal1', timeZone:'UTC',
    weeklyHours:{1:[{start:'09:00',end:'17:00'}],2:[{start:'09:00',end:'17:00'}]},
    minNoticeMinutes:0, slotDurationMinutes:30, slotIntervalMinutes:30, hosts:['h1','h2']
  });
  assert.equal(verifyBookingCalendar(calendar), true);
  const slots = listAvailableSlots({ calendar, startAt:'2026-10-05T09:00:00Z', endAt:'2026-10-05T10:30:00Z', existingBookings:[{tenantId:'t1',startAt:'2026-10-05T09:00:00Z',endAt:'2026-10-05T09:30:00Z',hostRef:'h1',status:'booked'}], limit:2, now:Date.parse('2026-10-04T10:00:00Z') });
  assert.equal(slots[0].hostRef, 'h2');
  const hold = holdBooking({ calendar, startAt:'2026-10-06T10:00:00Z', endAt:'2026-10-06T10:30:00Z', contactRef:'c1', idempotencyKey:'hold1', now:Date.parse('2026-10-04T10:00:00Z') });
  assert.equal(hold.status, 'held');
  const booked = bookAppointment({ calendar, hold:hold.hold, contactRef:'c1', idempotencyKey:'book1', now:Date.parse('2026-10-04T10:00:00Z') });
  assert.equal(booked.status, 'booked');
  assert.equal(bookAppointment({ calendar, appointments:[booked.appointment], contactRef:'c1', idempotencyKey:'book1', startAt:booked.appointment.startAt, endAt:booked.appointment.endAt, now:Date.parse('2026-10-04T10:00:00Z') }).status, 'idempotent');
  const moved = rescheduleAppointment({ calendar, appointment:booked.appointment, appointments:[booked.appointment], newStartAt:'2026-10-06T11:00:00Z', newEndAt:'2026-10-06T11:30:00Z', expectedVersion:1, now:Date.parse('2026-10-04T10:00:00Z') });
  assert.equal(moved.status, 'rescheduled');
  assert.equal(cancelAppointment({ appointment:moved.appointment, tenantId:'t1', expectedVersion:2 }).status, 'canceled');
  assert.equal(cancelAppointment({ appointment:moved.appointment, tenantId:'t1', expectedVersion:2 }).status, 'canceled');
});

test('agent runtime target enforces release/argument-bound approvals, budgets and structured output', () => {
  const runtime = createAgentRuntimePolicy({ tenantId:'t1', agentId:'a1', releaseId:'r1', allowedTools:['crm.search','crm.update'], maxTurns:2, maxToolCalls:1 });
  const readTool = defineAgentTool({ name:'crm.search', risk:'read' });
  const writeTool = defineAgentTool({ name:'crm.update', risk:'write' });
  assert.equal(authorizeAgentToolCall({ runtime, tool:readTool, tenantId:'t1', actorId:'u1', argumentsValue:{q:'lead'} }).allowed, true);
  const pending = authorizeAgentToolCall({ runtime, tool:writeTool, tenantId:'t1', actorId:'u1', argumentsValue:{recordId:'d1'} });
  assert.equal(pending.code, 'APPROVAL_REQUIRED');
  const evidence = { status:'approved', tenantId:'t1', agentId:'a1', releaseId:'r1', actorId:'u1', toolName:'crm.update', argumentsHash:pending.argumentsHash, idempotencyKey:pending.idempotencyKey, approvedAt:new Date().toISOString(), expiresAt:new Date(Date.now()+60000).toISOString() };
  assert.equal(authorizeAgentToolCall({ runtime, tool:writeTool, tenantId:'t1', actorId:'u1', argumentsValue:{recordId:'d1'}, approvalEvidence:evidence }).allowed, true);
  let session = createAgentSession({ runtime, tenantId:'t1', conversationId:'c1', actorId:'u1', leaseMs:10000 });
  session = consumeAgentBudget({ session, runtime, kind:'turn' }).session;
  session = consumeAgentBudget({ session, runtime, kind:'turn' }).session;
  assert.equal(consumeAgentBudget({ session, runtime, kind:'turn' }).ok, false);
  assert.equal(validateAgentOutput({status:'qualified',score:8},{type:'object',required:['status'],properties:{status:{type:'string',enum:['qualified','unqualified']},score:{type:'number'}}}), true);
  session = completeAgentSession({ session, tenantId:'t1', status:'needs_approval' });
  assert.match(summarizeAgentExecution({ session, events:[{status:'needs_approval'}] }).headline, /approval/);
});
