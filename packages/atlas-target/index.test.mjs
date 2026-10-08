import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCrmRecord, defineCrmProperty, updateCrmRecord, createCrmAssociation, createCrmPipeline, transitionCrmDeal, searchCrm,
  createWorkflowGraph, verifyWorkflowGraph, validateWorkflowNodeInput, planWorkflowNode, summarizeWorkflowExecution, WORKFLOW_NODE_TYPES, WORKFLOW_NODE_CATALOG, WORKFLOW_TRIGGER_TYPES, WORKFLOW_TRIGGER_CATALOG,
  createBookingCalendar, verifyBookingCalendar, listAvailableSlots, holdBooking, bookAppointment, rescheduleAppointment, cancelAppointment,
  createAgentRuntimePolicy, defineAgentTool, authorizeAgentToolCall, createAgentSession, consumeAgentBudget, completeAgentSession, validateAgentOutput, summarizeAgentExecution
} from './index.mjs';

function workflowApproval(graph, pending, { executionId, nodeId, requestedByActorId = 'u-requester', approvedByActorId = 'u-reviewer', now = Date.now(), overrides = {} } = {}) {
  const approvedAt = new Date(now).toISOString();
  return {
    status:'approved', approvalId:'approval-1', tenantId:graph.tenantId, graphChecksum:graph.checksum,
    executionId, nodeId, idempotencyKey:pending.idempotencyKey, requestedByActorId, approvedByActorId,
    approvedAt, expiresAt:new Date(now + 5 * 60_000).toISOString(), signature:'trusted-test-signature', ...overrides
  };
}

test('V157 P0 workflow node registry validates typed configs and binds action nodes to registered actions', async () => {
  const { createActionRegistry, defineAction } = await import('../atlas-action-fabric/index.mjs');
  const { createWorkflowNodeSchemaRegistry } = await import('./workflow-node-schema-registry.mjs');
  const actionRegistry = createActionRegistry({actions:[
    defineAction({
      id:'crm.contact.typed-workflow-test',
      name:'Typed Workflow Contact Action',
      domain:'crm',
      risk:'write',
      inputSchema:{type:'object',required:['contactRef'],additionalProperties:false,properties:{contactRef:{type:'string',minLength:3,maxLength:180}}},
      surfaces:['workflow']
    })
  ]});
  const registry = createWorkflowNodeSchemaRegistry({actionRegistry});
  assert.equal(registry.get('action').schemaStatus,'typed');
  assert.equal(registry.get('edit_fields').schemaStatus,'typed');
  assert.throws(()=>registry.validateNodeConfig('action',{actionId:'crm.missing.action'}),/registered|action/i);
  assert.throws(()=>registry.validateNodeConfig('action',{actionId:'crm.contact.typed-workflow-test',input:{}}),/required|contactRef/i);
  assert.doesNotThrow(()=>registry.validateNodeConfig('action',{
    actionId:'crm.contact.typed-workflow-test',
    input:{contactRef:'contact_1'}
  }));
  assert.throws(()=>registry.validateNodeConfig('action',{input:{contactRef:'contact_1'}}),/actionId/i);
  const graph = createWorkflowGraph({
    tenantId:'t1', id:'wf-action-1', version:1, name:'Typed action workflow',
    actionRegistry,
    nodes:[
      {id:'start',type:'trigger',config:{eventType:'contact.created'}},
      {id:'act',type:'action',config:{actionId:'crm.contact.typed-workflow-test',input:{contactRef:'contact_1'}}},
      {id:'done',type:'stop',config:{}}
    ],
    edges:[{from:'start',to:'act',port:'next'},{from:'act',to:'done',port:'next'}]
  });
  assert.equal(graph.nodes.find(node=>node.id==='act').type,'action');
  assert.equal(graph.nodes.find(node=>node.id==='act').config.actionId,'crm.contact.typed-workflow-test');
  assert.throws(()=>createWorkflowGraph({
    tenantId:'t1', id:'wf-action-2', version:1, name:'Invalid action workflow',
    actionRegistry,
    nodes:[
      {id:'start',type:'trigger',config:{eventType:'contact.created'}},
      {id:'act',type:'action',config:{actionId:'crm.missing.action',input:{contactRef:'contact_1'}}},
      {id:'done',type:'stop',config:{}}
    ],
    edges:[{from:'start',to:'act',port:'next'},{from:'act',to:'done',port:'next'}]
  }),/registered|action/i);
});

test('V157 P0 node registry validates typed outputs and returns reference-safe output metadata', async () => {
  const { createActionRegistry, defineAction } = await import('../atlas-action-fabric/index.mjs');
  const { createWorkflowNodeSchemaRegistry } = await import('./workflow-node-schema-registry.mjs');
  const actionRegistry = createActionRegistry({actions:[
    defineAction({
      id:'crm.contact.output-test',
      name:'Output Test',
      domain:'crm',
      risk:'read',
      outputSchema:{type:'object',required:['status','score'],additionalProperties:false,properties:{status:{type:'string',enum:['ok','failed']},score:{type:'number',minimum:0,maximum:100}}},
      surfaces:['workflow']
    })
  ]});
  const registry = createWorkflowNodeSchemaRegistry({actionRegistry});
  assert.equal(registry.validateNodeOutput('action',{actionId:'crm.contact.output-test'},{status:'ok',score:91}),true);
  assert.throws(()=>registry.validateNodeOutput('action',{actionId:'crm.contact.output-test'},{status:'ok',score:'91'}),/schema|score/i);
  const summary=registry.summarizeNodeOutput('action',{actionId:'crm.contact.output-test'},{status:'ok',score:91});
  assert.equal(summary.valid,true);
  assert.equal(typeof summary.outputHash,'string');
  assert.equal(summary.outputHash.length,64);
  assert.equal('output' in summary,false);
});

test('V157 P0 node registry covers the entire catalog and exposes deterministic schema metadata', async () => {
  const { createWorkflowNodeSchemaRegistry, WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY } = await import('./workflow-node-schema-registry.mjs');
  const registry=createWorkflowNodeSchemaRegistry();
  assert.equal(registry.summary.total, WORKFLOW_NODE_TYPES.length);
  assert.equal(WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY.total, WORKFLOW_NODE_TYPES.length);
  for(const type of WORKFLOW_NODE_TYPES){
    const contract=registry.get(type);
    assert.equal(contract.type,type);
    assert.equal(typeof contract.schemaVersion,'number');
    assert.equal(typeof contract.schemaStatus,'string');
  }
  assert.equal(registry.list({schemaStatus:'typed'}).some(c=>c.type==='action'),true);
  assert.equal(registry.list({schemaStatus:'typed'}).some(c=>c.type==='edit_fields'),true);
});

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
  for (const type of ['trigger','condition','switch','goal','random_split','delay','wait_until','await_event','rate_limit_batch','transform','map_array','filter_array','split_batches','merge','text_format','math','set_custom_value','find_contact','create_contact','copy_contact','delete_contact','set_field','tag','assign_contact','remove_contact_assignment','manage_contact_followers','update_engagement_score','set_contact_dnd','add_note','create_task','edit_conversation','create_opportunity','update_opportunity','remove_opportunity','associate','send_message','reply_in_conversation','reply_social_comment','notify_internal','send_review_request','send_document_contract','call_contact','manual_action','webhook','http_request','spreadsheet_upsert','find_availability','book_appointment','generate_booking_link','reschedule_appointment','cancel_appointment','update_appointment_status','invoke_agent','ai_generate','ai_classify','ai_summarize','ai_intent_detect','knowledge_search','create_payment_link','charge_payment','send_invoice','issue_refund','publish_social_post','add_to_audience','remove_from_audience','record_conversion','send_analytics_event','affiliate_action','update_affiliate','manage_affiliate_campaign','grant_course_access','revoke_course_access','set_community_access','ivr_gather_input','ivr_play_message','ivr_transfer_call','ivr_connect_call','ivr_end_call','record_voicemail','sub_workflow','approval','remove_from_workflow','stop']) assert.ok(WORKFLOW_NODE_TYPES.includes(type));
  assert.equal(Object.isFrozen(WORKFLOW_NODE_CATALOG.issue_refund), true);
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
  assert.throws(() => createWorkflowGraph({...graph,nodes:[{id:'start',type:'trigger',config:{eventType:'contact.created'}},{id:'done',type:'stop'}],edges:[{from:'start',to:'done'},{from:'done',to:'start'}],checksum:undefined}), /cycle/);
  const destructive = createWorkflowGraph({
    tenantId:'t1', id:'wf2', name:'Cancel',
    nodes:[{id:'start',type:'trigger',config:{eventType:'appointment.canceled'}},{id:'cancel',type:'cancel_appointment',config:{calendarRef:'cal1'}},{id:'done',type:'stop'}],
    edges:[{from:'start',to:'cancel'},{from:'cancel',to:'done'}]
  });
  const pending = planWorkflowNode({ graph:destructive, nodeId:'cancel', tenantId:'t1', executionId:'e1' });
  assert.equal(pending.status, 'needs_approval');
  const approval = workflowApproval(destructive, pending, { executionId:'e1', nodeId:'cancel' });
  assert.equal(planWorkflowNode({ graph:destructive, nodeId:'cancel', tenantId:'t1', executionId:'e1', approvalEvidence:approval, approvalVerifier:evidence => evidence.signature === 'trusted-test-signature' }).status, 'planned');
  assert.equal(planWorkflowNode({ graph:destructive, nodeId:'cancel', tenantId:'t1', executionId:'e1', approvalEvidence:approval }).status, 'needs_approval');
  assert.equal(planWorkflowNode({ graph:destructive, nodeId:'cancel', tenantId:'t1', executionId:'e1', approvalEvidence:workflowApproval(destructive, pending, { executionId:'e2', nodeId:'cancel' }), approvalVerifier:() => true }).status, 'needs_approval');
  assert.equal(planWorkflowNode({ graph:destructive, nodeId:'cancel', tenantId:'t1', executionId:'e1', approvalEvidence:workflowApproval(destructive, pending, { executionId:'e1', nodeId:'cancel', approvedByActorId:'u-requester' }), approvalVerifier:() => true, requestedByActorId:'u-requester' }).status, 'needs_approval');
  assert.equal(planWorkflowNode({ graph:destructive, nodeId:'cancel', tenantId:'t1', executionId:'e1', approvalEvidence:workflowApproval(destructive, pending, { executionId:'e1', nodeId:'cancel', now:Date.now() - 20 * 60_000 }), approvalVerifier:() => true }).status, 'needs_approval');
  const summary = summarizeWorkflowExecution({ executionId:'e1', tenantId:'t1', steps:[{nodeId:'cancel',status:'failed',retryCount:2}] });
  assert.equal(summary.retries, 2);
});

test('GHL 2026 trigger inventory maps documented workflow events to canonical Atlas event families', () => {
  const documented = [
    'contact.created','contact.updated','contact.dnd_changed','contact.tag_added','contact.tag_removed','contact.custom_date_due','contact.birthday_due','contact.note_added','contact.note_changed','contact.engagement_threshold','task.created','task.reminder_due','task.completed',
    'webhook.received','schedule.fired','call.details_matched','email.delivered','email.opened','email.clicked','email.bounced','email.spam','email.unsubscribed','message.customer_replied','conversation.ai_triggered','custom.event','form.submitted','survey.submitted','trigger_link.clicked','lead_form.facebook_submitted','lead_form.tiktok_submitted','video.threshold_reached','contact.phone_validation_completed','message.sms_error','lead_form.linkedin_submitted','funnel.page_viewed','quiz.submitted','review.received','prospect.generated','social.click_to_whatsapp_started','tracking.external_event',
    'appointment.booked','appointment.service_booked','rental.booked','opportunity.status_changed','opportunity.created','opportunity.updated','opportunity.stage_changed','opportunity.stale','affiliate.created','affiliate.sale','affiliate.campaign_enrolled','affiliate.lead_created',
    'course.category_started','course.category_completed','course.lesson_started','course.lesson_completed','course.signup','course.access_granted','course.access_removed','course.product_started','course.product_completed','course.user_login',
    'invoice.created','payment.received','order.form_submitted','order.submitted','document.sent','document.signed','document.declined','estimate.sent','estimate.accepted','estimate.declined','subscription.created','subscription.updated','subscription.paused','subscription.resumed','subscription.canceled','payment.refunded','coupon.applied','coupon.limit_reached','coupon.expired','coupon.redeemed',
    'store.shopify_abandoned_cart','store.shopify_order_placed','store.shopify_order_fulfilled','store.order_fulfilled','store.product_review_submitted','store.checkout_abandoned','ivr.started','social.facebook_comment','social.instagram_comment','community.group_access_granted','community.group_access_revoked','community.private_channel_granted','community.private_channel_revoked','community.level_changed','certificate.issued','social.tiktok_comment','call.transcript_generated','lead_form.google_submitted'
  ];
  for (const type of documented) assert.ok(Object.hasOwn(WORKFLOW_TRIGGER_CATALOG, type), `missing documented trigger ${type}`);
  assert.equal(new Set(WORKFLOW_TRIGGER_TYPES).size, WORKFLOW_TRIGGER_TYPES.length);
  assert.equal(WORKFLOW_TRIGGER_CATALOG['webhook.received'].trust, 'verified-adapter-required');
  assert.equal(WORKFLOW_TRIGGER_CATALOG['tracking.external_event'].family, 'marketing');
  assert.equal(WORKFLOW_TRIGGER_CATALOG['agent.tool_approval_requested'].family, 'ai');
});

test('workflow graph rejects unknown triggers, secret material, direct destinations and arbitrary URLs', () => {
  const graph = nodes => createWorkflowGraph({ tenantId:'t1', name:'Safe graph', nodes, edges:[{from:'start',to:'finish'}] });
  assert.throws(() => graph([{id:'start',type:'trigger',config:{eventType:'anything.here'}},{id:'finish',type:'stop'}]), /supported eventType/);
  assert.throws(() => graph([{id:'start',type:'trigger',config:{eventType:'contact.created'}},{id:'request',type:'http_request',config:{connectionRef:'c1',operationRef:'post',apiKey:'secret'}},{id:'finish',type:'stop'}]), /credential or private-content/);
  assert.throws(() => graph([{id:'start',type:'trigger',config:{eventType:'contact.created'}},{id:'request',type:'http_request',config:{connectionRef:'c1',operationRef:'post',recipient_email:'person@example.com'}},{id:'finish',type:'stop'}]), /direct recipient data/);
  assert.throws(() => graph([{id:'start',type:'trigger',config:{eventType:'contact.created'}},{id:'request',type:'http_request',config:{connectionRef:'c1',operationRef:'post',endpoint_url:'https://attacker.invalid'}},{id:'finish',type:'stop'}]), /network location/);
  const accessorConfig = { eventType:'contact.created' };
  Object.defineProperty(accessorConfig, 'x', { enumerable:true, get() { assert.fail('must not execute config getters'); } });
  assert.throws(() => graph([{id:'start',type:'trigger',config:accessorConfig},{id:'finish',type:'stop'}]), /accessors/);
  const cyclic = {}; cyclic.loop = cyclic;
  assert.throws(() => graph([{id:'start',type:'trigger',config:{eventType:'contact.created'}},{id:'merge',type:'merge',config:cyclic},{id:'finish',type:'stop'}]), /acyclic JSON/);
});

test('workflow retry and timeout controls are bounded and high-risk nodes require approval', () => {
  const build = (nodeOverrides = {}) => createWorkflowGraph({ tenantId:'t1', name:'Policy', nodes:[
    {id:'start',type:'trigger',config:{eventType:'payment.failed'}},
    {id:'action',type:nodeOverrides.type || 'issue_refund',config:nodeOverrides.config || {paymentRef:'p1',connectionRef:'c1'},retry:nodeOverrides.retry,timeoutMs:nodeOverrides.timeoutMs},
    {id:'finish',type:'stop'}
  ], edges:[{from:'start',to:'action'},{from:'action',to:'finish'}] });
  assert.throws(() => build({retry:{maxAttempts:100}}), /retry policy/);
  assert.throws(() => build({retry:{backoffMs:1}}), /retry policy/);
  assert.throws(() => build({timeoutMs:900000}), /timeout/);
  const graph = build();
  const pending = planWorkflowNode({graph,nodeId:'action',tenantId:'t1',executionId:'run-1'});
  assert.equal(pending.status,'needs_approval');
  assert.equal(pending.execution,'connector');
  assert.equal(pending.requiresAdapter,true);
  const retry = planWorkflowNode({graph,nodeId:'action',tenantId:'t1',executionId:'run-1',attempt:2});
  assert.equal(retry.idempotencyKey,pending.idempotencyKey);
  assert.equal(retry.status,'needs_approval');
  const approval = workflowApproval(graph, pending, { executionId:'run-1', nodeId:'action' });
  assert.equal(planWorkflowNode({graph,nodeId:'action',tenantId:'t1',executionId:'run-1',approvalEvidence:approval,approvalVerifier:evidence => evidence.signature === 'trusted-test-signature'}).status,'planned');
  assert.throws(() => build({config:{paymentRef:'p1',connectionRef:'c1',accessToken:'abc'}}), /credential or private-content/);
  assert.throws(() => planWorkflowNode({graph,nodeId:'action',tenantId:'t1',executionId:'run-1',attempt:4}), /retry limit/);
  const unsafe = createWorkflowGraph({tenantId:'t1',name:'Unsafe retry',nodes:[{id:'start',type:'trigger',config:{eventType:'schedule.fired'}},{id:'publish',type:'publish_social_post',config:{contentRef:'post-1',connectionRef:'social-1'}},{id:'finish',type:'stop'}],edges:[{from:'start',to:'publish'},{from:'publish',to:'finish'}]});
  assert.equal(planWorkflowNode({graph:unsafe,nodeId:'publish',tenantId:'t1',executionId:'run-2',attempt:2}).status,'retry_blocked');
});

test('workflow compiler clones caller configuration instead of freezing caller-owned input', () => {
  const config = {eventType:'contact.created', metadata:{segment:'new'} };
  const graph = createWorkflowGraph({tenantId:'t1',name:'Copy',nodes:[{id:'start',type:'trigger',config},{id:'finish',type:'stop'}],edges:[{from:'start',to:'finish'}]});
  assert.equal(Object.isFrozen(config),false);
  assert.equal(Object.isFrozen(config.metadata),false);
  assert.equal(Object.isFrozen(graph.nodes.find(node => node.id === 'start').config),true);
  assert.equal(verifyWorkflowGraph(graph),true);
});

test('workflow approval is verified, short-lived, execution-bound and separates requester from reviewer', () => {
  const graph = createWorkflowGraph({tenantId:'t1',name:'Sensitive payment',nodes:[
    {id:'start',type:'trigger',config:{eventType:'payment.failed'}},
    {id:'refund',type:'issue_refund',config:{paymentRef:'p1',connectionRef:'c1'}},
    {id:'finish',type:'stop'}
  ],edges:[{from:'start',to:'refund'},{from:'refund',to:'finish'}]});
  const pending = planWorkflowNode({graph,nodeId:'refund',tenantId:'t1',executionId:'exec-1'});
  const verifier = evidence => evidence.signature === 'verified-by-approval-service';
  const valid = workflowApproval(graph, pending, {executionId:'exec-1',nodeId:'refund',requestedByActorId:'requester',overrides:{signature:'verified-by-approval-service'}});
  assert.equal(planWorkflowNode({graph,nodeId:'refund',tenantId:'t1',executionId:'exec-1',approvalEvidence:valid,approvalVerifier:verifier,requestedByActorId:'requester'}).status,'planned');
  assert.equal(planWorkflowNode({graph,nodeId:'refund',tenantId:'t1',executionId:'exec-1',approvalEvidence:valid,approvalVerifier:() => false,requestedByActorId:'requester'}).status,'needs_approval');
  assert.equal(planWorkflowNode({graph,nodeId:'refund',tenantId:'t1',executionId:'exec-1',approvalEvidence:workflowApproval(graph,pending,{executionId:'exec-1',nodeId:'refund',requestedByActorId:'requester',approvedByActorId:'requester',overrides:{signature:'verified-by-approval-service'}}),approvalVerifier:verifier,requestedByActorId:'requester'}).status,'needs_approval');
  let getterRan = false;
  const accessorEvidence = { ...valid };
  Object.defineProperty(accessorEvidence,'approvedByActorId',{enumerable:true,get() { getterRan = true; return 'u-reviewer'; }});
  assert.equal(planWorkflowNode({graph,nodeId:'refund',tenantId:'t1',executionId:'exec-1',approvalEvidence:accessorEvidence,approvalVerifier:verifier,requestedByActorId:'requester'}).status,'needs_approval');
  assert.equal(getterRan,false);
});

test('communication and AI nodes keep message content and connection secrets behind references', () => {
  const graph = createWorkflowGraph({tenantId:'t1',name:'Review follow-up',nodes:[
    {id:'start',type:'trigger',config:{eventType:'appointment.completed'}},
    {id:'message',type:'send_message',config:{channel:'google_business',purpose:'support',templateRef:'review-template-v1',connectionRef:'business-messages'}},
    {id:'finish',type:'stop'}
  ],edges:[{from:'start',to:'message'},{from:'message',to:'finish'}]});
  const plan = planWorkflowNode({graph,nodeId:'message',tenantId:'t1',executionId:'review-run'});
  assert.equal(plan.requiresAdapter,true);
  assert.equal(plan.guard,'fresh_message_policy_template_and_delivery_idempotency');
  assert.throws(() => createWorkflowGraph({tenantId:'t1',name:'Unsafe message',nodes:[
    {id:'start',type:'trigger',config:{eventType:'appointment.completed'}},
    {id:'message',type:'send_message',config:{channel:'email',connectionRef:'mail-1',to:'person@example.test',templateRef:'t1'}},
    {id:'finish',type:'stop'}
  ],edges:[{from:'start',to:'message'},{from:'message',to:'finish'}]}), /direct recipient data/);
  assert.throws(() => createWorkflowGraph({tenantId:'t1',name:'Incomplete message',nodes:[
    {id:'start',type:'trigger',config:{eventType:'appointment.completed'}},
    {id:'message',type:'send_message',config:{channel:'email',connectionRef:'mail-1'}},
    {id:'finish',type:'stop'}
  ],edges:[{from:'start',to:'message'},{from:'message',to:'finish'}]}), /templateRef/);
  for (const config of [
    {channel:'email',purpose:'support',templateRef:'customer@example.test',connectionRef:'mail-1'},
    {channel:'email',purpose:'support',templateRef:'template-1',connectionRef:'https://mail.example.test/send'},
    {channel:'email',purpose:'support',templateRef:'template-1',connectionRef:'15551234567'}
  ]) assert.throws(() => createWorkflowGraph({tenantId:'t1',name:'Direct message reference',nodes:[
    {id:'start',type:'trigger',config:{eventType:'contact.created'}},
    {id:'message',type:'send_message',config},
    {id:'finish',type:'stop'}
  ],edges:[{from:'start',to:'message'},{from:'message',to:'finish'}]}), /opaque reference/);
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


test('V157 P0 next frontier propagates connector output schemas into downstream validation', async () => {
  const { createActionRegistry, defineAction } = await import('../atlas-action-fabric/index.mjs');
  const { createConnectorDefinition, createConnectorSchemaRegistry } = await import('../atlas-integration-fabric/index.mjs');
  const { createWorkflowNodeSchemaRegistry } = await import('./workflow-node-schema-registry.mjs');

  const connector = createConnectorDefinition({
    tenantId:'t1',
    id:'crm_api',
    name:'CRM API',
    auth:'bearer',
    baseUrl:'https://api.example.com',
    operations:[{
      id:'contact.lookup',
      method:'POST',
      path:'/contacts/lookup',
      inputSchema:{
        type:'object',
        required:['contactRef'],
        additionalProperties:false,
        properties:{contactRef:{type:'string',minLength:3,maxLength:180}}
      },
      outputSchema:{
        type:'object',
        required:['contact'],
        additionalProperties:false,
        properties:{
          contact:{
            type:'object',
            required:['id','name'],
            additionalProperties:false,
            properties:{
              id:{type:'string',minLength:3},
              name:{type:'string',minLength:1}
            }
          }
        }
      }
    }]
  });
  const connectorRegistry=createConnectorSchemaRegistry({connectors:[connector]});
  const operation=connectorRegistry.getOperationSchema({tenantId:'t1',connectorRef:'crm_api',operationRef:'contact.lookup'});
  assert.equal(operation.schemaStatus,'typed');
  assert.equal(operation.inputSchema.properties.contactRef.type,'string');
  assert.equal(operation.outputSchema.properties.contact.properties.name.type,'string');

  const actionRegistry=createActionRegistry({actions:[defineAction({
    id:'crm.contact.consume',
    name:'Consume Contact',
    domain:'crm',
    risk:'read',
    inputSchema:{
      type:'object',
      required:['contact'],
      additionalProperties:false,
      properties:{
        contact:{
          type:'object',
          required:['id','name'],
          additionalProperties:false,
          properties:{id:{type:'string'},name:{type:'string'}}
        }
      }
    },
    surfaces:['workflow']
  })]});
  const schemaRegistry=createWorkflowNodeSchemaRegistry({actionRegistry,connectorRegistry});
  const graph=createWorkflowGraph({
    tenantId:'t1',
    id:'wf-schema-propagation',
    name:'Connector to action',
    actionRegistry,
    schemaRegistry,
    nodes:[
      {id:'start',type:'trigger',config:{eventType:'contact.created'}},
      {id:'lookup',type:'connector_action',config:{connectorRef:'crm_api',connectionRef:'conn_1',operationRef:'contact.lookup',input:{contactRef:'contact_1'}}},
      {id:'consume',type:'action',config:{actionId:'crm.contact.consume'}},
      {id:'done',type:'stop'}
    ],
    edges:[
      {from:'start',to:'lookup'},
      {from:'lookup',to:'consume'},
      {from:'consume',to:'done'}
    ]
  });
  const consume=graph.nodes.find(node=>node.id==='consume');
  assert.equal(consume.schemaStatus,'typed-compatible');
  assert.equal(consume.propagatedInputSchema.properties.contact.properties.id.type,'string');
  assert.equal(consume.upstreamNodes.includes('lookup'),true);
  assert.doesNotThrow(()=>validateWorkflowNodeInput({graph,nodeId:'consume',input:{contact:{id:'c1',name:'Ada'}}}));
  assert.throws(()=>validateWorkflowNodeInput({graph,nodeId:'consume',input:{contact:{id:'c1'}}}),/schema|name|required/i);
  assert.equal(graph.nodes.find(node=>node.id==='lookup').outputSchema.properties.contact.type,'object');
});

test('V157 P0 connector schema binding fails closed on unknown operation, cross-tenant connector and incompatible downstream shape', async () => {
  const { createActionRegistry, defineAction } = await import('../atlas-action-fabric/index.mjs');
  const { createConnectorDefinition, createConnectorSchemaRegistry } = await import('../atlas-integration-fabric/index.mjs');
  const { createWorkflowNodeSchemaRegistry } = await import('./workflow-node-schema-registry.mjs');
  const connector=createConnectorDefinition({
    tenantId:'t1',id:'crm_api',name:'CRM API',auth:'bearer',baseUrl:'https://api.example.com',
    operations:[{id:'contact.lookup',method:'GET',path:'/contacts/lookup',inputSchema:{type:'object'},outputSchema:{type:'object',required:['contact'],additionalProperties:false,properties:{contact:{type:'object',required:['id'],additionalProperties:false,properties:{id:{type:'string'}}}}}}]
  });
  const registry=createConnectorSchemaRegistry({connectors:[connector]});
  assert.throws(()=>registry.getOperationSchema({tenantId:'t2',connectorRef:'crm_api',operationRef:'contact.lookup'}),/tenant|scope/i);
  assert.throws(()=>registry.getOperationSchema({tenantId:'t1',connectorRef:'crm_api',operationRef:'missing'}),/operation|registered|granted/i);

  const actionRegistry=createActionRegistry({actions:[defineAction({
    id:'crm.bad.consumer',name:'Bad Consumer',domain:'crm',risk:'read',surfaces:['workflow'],
    inputSchema:{type:'object',required:['paymentId'],additionalProperties:false,properties:{paymentId:{type:'string'}}}
  })]});
  const schemaRegistry=createWorkflowNodeSchemaRegistry({actionRegistry,connectorRegistry:registry});
  assert.throws(()=>createWorkflowGraph({
    tenantId:'t1',id:'wf-schema-mismatch',name:'Mismatch',actionRegistry,schemaRegistry,
    nodes:[
      {id:'start',type:'trigger',config:{eventType:'contact.created'}},
      {id:'lookup',type:'connector_action',config:{connectorRef:'crm_api',connectionRef:'conn_1',operationRef:'contact.lookup',input:{}}},
      {id:'bad',type:'action',config:{actionId:'crm.bad.consumer'}},
      {id:'done',type:'stop'}
    ],
    edges:[{from:'start',to:'lookup'},{from:'lookup',to:'bad'},{from:'bad',to:'done'}]
  }),/incompatible|schema/i);
});


test('V157 P0 legacy workflow nodes expose strict input schemas for references, timing and bounded controls',async()=>{
 const {createWorkflowNodeSchemaRegistry}=await import('./workflow-node-schema-registry.mjs');
 const registry=createWorkflowNodeSchemaRegistry();
 for(const [type,config,requiredField] of [
   ['create_contact',{sourceRef:'contact_source'},'sourceRef'],
   ['create_task',{taskTemplateRef:'task_template'},'taskTemplateRef'],
   ['send_message',{templateRef:'template_ref',connectionRef:'connection_ref',channel:'email'},'templateRef'],
   ['find_availability',{calendarRef:'calendar_ref'},'calendarRef'],
   ['mcp_client',{serverRef:'server_ref',operationRef:'operation_ref'},'serverRef'],
   ['respond_to_webhook',{responseRef:'response_ref',statusCode:200},'responseRef']
 ]){
   const contract=registry.get(type,config);
   assert.equal(contract.schemaStatus,'typed',type);
   assert.equal(contract.inputSchema.type,'object',type);
   assert.ok(contract.inputSchema.required.includes(requiredField),type);
   assert.throws(()=>registry.validateNodeConfig(type,{...config,[requiredField]:undefined}),/required|invalid|schema/i,type);
 }
 const delay=registry.get('delay',{delayMs:60000});
 assert.equal(delay.inputSchema.properties.delayMs.type,'integer');
 assert.throws(()=>registry.validateNodeConfig('delay',{delayMs:0}),/schema|minimum|duration/i);
 const split=registry.get('split_batches',{batchSize:100});
 assert.equal(split.inputSchema.properties.batchSize.type,'integer');
 assert.throws(()=>registry.validateNodeConfig('split_batches',{batchSize:0}),/schema|minimum|batch/i);
});

test('V157 P0 strict legacy schemas reject unknown config keys instead of silently accepting them',async()=>{
 const {createWorkflowNodeSchemaRegistry}=await import('./workflow-node-schema-registry.mjs');
 const registry=createWorkflowNodeSchemaRegistry();
 assert.throws(()=>registry.validateNodeConfig('create_task',{taskTemplateRef:'task_template',secretHint:'should_fail'}),/schema|additional|secret/i);
 assert.throws(()=>registry.validateNodeConfig('send_message',{templateRef:'t',connectionRef:'c',channel:'email',recipient:'person@example.com'}),/schema|credential|recipient|direct/i);
 assert.throws(()=>registry.validateNodeConfig('webhook',{connectionRef:'c',operationRef:'op',endpoint_url:'https://attacker.invalid'}),/schema|network|url/i);
});
