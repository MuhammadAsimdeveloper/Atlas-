import crypto from 'node:crypto';
import { WORKFLOW_NODE_CATALOG, WORKFLOW_NODE_TYPES } from './workflow-catalog.mjs';
import { createActionRegistry, getAction } from '../atlas-action-fabric/index.mjs';
import { compareJsonSchemas, isGenericJsonSchema, validateJsonSchema } from '../atlas-action-fabric/schema.mjs';

const REF=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;
const clone=value=>structuredClone(value);
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const fail=(code,message,details={})=>{const error=new TypeError(message);error.code=code;Object.assign(error,details);throw error;};
const ref=(value,label)=>{if(typeof value!=='string'||!REF.test(value))fail('invalid_reference',label+' must be a bounded reference');return value;};
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const GENERIC_SCHEMA=Object.freeze({type:'object',additionalProperties:true});
const REF_SCHEMA=Object.freeze({type:'string',minLength:3,maxLength:180});

function objectSchema(properties={},required=[]){
  return {
    type:'object',
    additionalProperties:false,
    required:[...required],
    properties
  };
}
const ARRAY_ITEMS={type:'array',maxItems:100};
const STRING={type:'string',minLength:1,maxLength:4000};
const BOOLEAN={type:'boolean'};
const NUMBER={type:'number'};
const INTEGER={type:'integer'};

const LEGACY_REFERENCE_FIELDS=Object.freeze({
 find_contact:['queryRef'],create_contact:['sourceRef'],copy_contact:['contactRef','targetWorkspaceRef'],delete_contact:['contactRef'],
 set_field:['contactRef'],tag:['contactRef'],assign_contact:['contactRef','assigneeRef'],remove_contact_assignment:['contactRef'],
 manage_contact_followers:['contactRef'],update_engagement_score:['contactRef','scoreRef'],set_contact_dnd:['contactRef'],add_note:['contactRef','noteTemplateRef'],
 create_task:['taskTemplateRef'],edit_conversation:['conversationRef'],create_opportunity:['contactRef','pipelineRef'],update_opportunity:['opportunityRef'],
 remove_opportunity:['opportunityRef','pipelineRef'],associate:[],find_availability:['calendarRef'],book_appointment:['calendarRef'],
 generate_booking_link:['calendarRef','contactRef'],reschedule_appointment:['calendarRef','appointmentRef'],
 cancel_appointment:['calendarRef','appointmentRef'],update_appointment_status:['appointmentRef'],call_contact:['contactRef','connectionRef'],
 manual_action:['taskTemplateRef'],reply_social_comment:['commentRef','contentRef','connectionRef'],send_document_contract:['documentTemplateRef','contactRef','connectionRef'],
 ai_generate:['promptRef'],send_analytics_event:['conversionRef','connectionRef'],send_message:['templateRef','connectionRef'],
 reply_in_conversation:['conversationRef','templateRef','connectionRef'],notify_internal:['recipientRef'],webhook:['connectionRef','operationRef'],
 http_request:['connectionRef','operationRef'],spreadsheet_upsert:['connectionRef','resourceRef'],send_review_request:['contactRef','templateRef','connectionRef'],
 create_payment_link:['customerRef','priceRef','connectionRef'],send_invoice:['invoiceRef','connectionRef'],issue_refund:['paymentRef','connectionRef'],
 publish_social_post:['contentRef','connectionRef'],charge_payment:['customerRef','amountPolicyRef','connectionRef'],
 add_to_audience:['audienceRef','contactRef','connectionRef'],remove_from_audience:['audienceRef','contactRef','connectionRef'],
 add_google_ads_audience:['audienceRef','contactRef','connectionRef'],remove_google_ads_audience:['audienceRef','contactRef','connectionRef'],
 facebook_conversion_event:['conversionRef','connectionRef'],record_conversion:['conversionRef','connectionRef'],affiliate_action:['affiliateRef','connectionRef'],
 update_affiliate:['affiliateRef','connectionRef'],manage_affiliate_campaign:['affiliateRef','campaignRef','connectionRef'],grant_course_access:['memberRef','offerRef'],
 revoke_course_access:['memberRef','offerRef'],set_community_access:['memberRef','groupRef'],ivr_transfer_call:['callSessionRef','routeRef'],
 ivr_gather_input:['callSessionRef'],ivr_play_message:['callSessionRef','contentRef'],ivr_connect_call:['callSessionRef','routeRef'],
 ivr_end_call:['callSessionRef'],record_voicemail:['callSessionRef'],sub_workflow:['workflowReleaseRef'],execute_subworkflow:['workflowReleaseRef'],
 data_table:['tableRef'],mcp_client:['serverRef','operationRef'],mcp_server_trigger:['serverRef'],chat_trigger:['channelRef'],
 schedule_trigger:['scheduleRef'],form_trigger:['formRef'],evaluation_trigger:['evaluationRef'],guardrails:['policyRef'],respond_to_webhook:['responseRef']
});

function legacySchemaFor(type){
  const refs=LEGACY_REFERENCE_FIELDS[type] || [];
  const properties={};
  for(const field of refs) properties[field]=REF_SCHEMA;
  const required=[...refs];
  const add=(name,schema)=>{properties[name]=schema;};
  if(type==='trigger') return objectSchema({eventType:{type:'string',minLength:3,maxLength:180} },['eventType']);
  if(['condition','switch','random_split'].includes(type)) { add('cases',{type:'array',minItems:1,maxItems:32,items:{type:'object',additionalProperties:true}}); add('expression',STRING); }
  if(type==='delay') { add('delayMs',{type:'integer',minimum:1000,maximum:2592000000}); add('waitMs',{type:'integer',minimum:1000,maximum:2592000000}); add('offsetMs',{type:'integer',minimum:-2592000000,maximum:2592000000}); }
  if(type==='wait_until') { add('delayMs',{type:'integer',minimum:1000,maximum:2592000000}); add('offsetMs',{type:'integer',minimum:-2592000000,maximum:2592000000}); add('resumeAt',{type:'string',format:'date-time'}); }
  if(type==='await_event') { add('eventType',{type:'string',minLength:3,maxLength:180}); add('timeoutMs',{type:'integer',minimum:1000,maximum:2592000000}); }
  if(type==='rate_limit_batch') { add('batchSize',{type:'integer',minimum:1,maximum:1000}); add('intervalMs',{type:'integer',minimum:100,maximum:86400000}); }
  if(['split_batches','batch','split_in_batches'].includes(type)) add('batchSize',{type:'integer',minimum:1,maximum:1000});
  if(['loop_over_items','loop','loop_over_items'].includes(type)) { add('batchSize',{type:'integer',minimum:1,maximum:100}); add('maxItems',{type:'integer',minimum:1,maximum:10000}); add('maxIterations',{type:'integer',minimum:1,maximum:10000}); }
  if(['aggregate','remove_duplicates','sort','split_out','remove_duplicates'].includes(type)) { add('maxItems',{type:'integer',minimum:1,maximum:10000}); add('key',STRING); add('field',STRING); add('direction',{type:'string',enum:['asc','desc']}); }
  if(['transform','map_array','filter_array','edit_fields','text_format','math','set_custom_value','json_parse','csv_parse','code_transform'].includes(type)) {
    add('mapping',ARRAY_ITEMS); add('expression',{type:'string',minLength:1,maxLength:4000}); add('source',STRING); add('target',STRING); add('value',{}); add('args',ARRAY_ITEMS);
  }
  if(type==='edit_fields') required.splice(0,required.length, 'mapping');
  if(type==='send_message') { add('channel',{type:'string',enum:['email','sms','whatsapp','facebook','instagram','google_business','webchat','voice']}); add('templateRef',REF_SCHEMA); add('connectionRef',REF_SCHEMA); add('toRef',REF_SCHEMA); }
  if(type==='notify_internal') { add('channel',{type:'string',enum:['email','slack','in_app','web_push']}); add('recipientRef',REF_SCHEMA); add('connectionRef',REF_SCHEMA); }
  if(['find_availability','book_appointment','reschedule_appointment','cancel_appointment'].includes(type)) add('calendarRef',REF_SCHEMA);
  if(['invoke_agent','workflow_as_agent_tool'].includes(type)) add('agentReleaseRef',REF_SCHEMA);
  if(type==='respond_to_webhook') add('statusCode',{type:'integer',minimum:100,maximum:599});
  if(type==='stop_and_error') { add('errorCode',{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,79}
const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const legacy=legacySchemaFor(type);
 const hasLegacy=type!=='action'&&type!=='connector_action'&&Object.keys(legacy.properties||{}).length>0 || ['trigger','condition','switch','random_split','delay','wait_until','edit_fields','execution_data','stop_and_error','knowledge_search'].includes(type);
 const inputSchema=typed?.inputSchema|| (hasLegacy ? legacy : GENERIC_SCHEMA);
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed||hasLegacy?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
}); add('message',{type:'string',minLength:1,maxLength:500}); }
  if(type==='execution_data') { add('key',{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,79}
const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const inputSchema=typed?.inputSchema||GENERIC_SCHEMA;
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
}); add('value',{}); }
  if(type==='error_trigger') add('errorCode',{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,79}
const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const inputSchema=typed?.inputSchema||GENERIC_SCHEMA;
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
});
  if(['graphql_request','soap_request','oauth2','basic_auth','bearer_auth','hmac_auth','custom_headers','pagination','retry','circuit_breaker'].includes(type)) {
    add('connectionRef',REF_SCHEMA); add('operationRef',REF_SCHEMA); add('credentialRef',REF_SCHEMA);
    add('requestHeaders',objectSchema({},[])); add('body',{}); add('variables',{type:'object',additionalProperties:true});
  }
  if(type==='knowledge_search') { add('query',STRING); add('knowledgeVersionRef',REF_SCHEMA); add('topK',{type:'integer',minimum:1,maximum:20}); }
  if(type==='ai_classify') { add('promptRef',REF_SCHEMA); add('labels',{type:'array',minItems:1,maxItems:100,items:STRING}); add('outputSchema',{type:'object',additionalProperties:true}); }
  if(type==='ai_summarize') { add('promptRef',REF_SCHEMA); add('maxChars',{type:'integer',minimum:100,maximum:12000}); }
  if(type==='ai_intent_detect') { add('promptRef',REF_SCHEMA); add('labels',{type:'array',minItems:1,maxItems:100,items:STRING}); }
  if(type==='ai_generate') { add('modelPolicyRef',REF_SCHEMA); add('outputSchema',{type:'object',additionalProperties:true}); }
  if(type==='invoke_agent') { add('agentReleaseRef',REF_SCHEMA); add('input',objectSchema({},[])); }
  if(type==='mcp_client') { add('serverRef',REF_SCHEMA); add('operationRef',REF_SCHEMA); add('input',objectSchema({},[])); }
  if(type==='sub_workflow'||type==='execute_subworkflow') add('input',objectSchema({},[]));
  if(type==='webhook'||type==='http_request') { add('method',{type:'string',enum:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']}); add('input',objectSchema({},[])); }
  if(type==='spreadsheet_upsert') { add('mapping',objectSchema({},[])); add('values',objectSchema({},[])); }
  return objectSchema(properties,required);
}

const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const inputSchema=typed?.inputSchema||GENERIC_SCHEMA;
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
}); add('message',{type:'string',minLength:1,maxLength:500}); }
  if(type==='execution_data') { add('key',{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,79}
const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const legacy=legacySchemaFor(type);
 const hasLegacy=type!=='action'&&type!=='connector_action'&&Object.keys(legacy.properties||{}).length>0 || ['trigger','condition','switch','random_split','delay','wait_until','edit_fields','execution_data','stop_and_error','knowledge_search'].includes(type);
 const inputSchema=typed?.inputSchema|| (hasLegacy ? legacy : GENERIC_SCHEMA);
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed||hasLegacy?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
}); add('message',{type:'string',minLength:1,maxLength:500}); }
  if(type==='execution_data') { add('key',{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,79}
const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const inputSchema=typed?.inputSchema||GENERIC_SCHEMA;
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
}); add('value',{}); }
  if(type==='error_trigger') add('errorCode',{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,79}
const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const inputSchema=typed?.inputSchema||GENERIC_SCHEMA;
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
});
  if(['graphql_request','soap_request','oauth2','basic_auth','bearer_auth','hmac_auth','custom_headers','pagination','retry','circuit_breaker'].includes(type)) {
    add('connectionRef',REF_SCHEMA); add('operationRef',REF_SCHEMA); add('credentialRef',REF_SCHEMA);
    add('requestHeaders',objectSchema({},[])); add('body',{}); add('variables',{type:'object',additionalProperties:true});
  }
  if(type==='knowledge_search') { add('query',STRING); add('knowledgeVersionRef',REF_SCHEMA); add('topK',{type:'integer',minimum:1,maximum:20}); }
  if(type==='ai_classify') { add('promptRef',REF_SCHEMA); add('labels',{type:'array',minItems:1,maxItems:100,items:STRING}); add('outputSchema',{type:'object',additionalProperties:true}); }
  if(type==='ai_summarize') { add('promptRef',REF_SCHEMA); add('maxChars',{type:'integer',minimum:100,maximum:12000}); }
  if(type==='ai_intent_detect') { add('promptRef',REF_SCHEMA); add('labels',{type:'array',minItems:1,maxItems:100,items:STRING}); }
  if(type==='ai_generate') { add('modelPolicyRef',REF_SCHEMA); add('outputSchema',{type:'object',additionalProperties:true}); }
  if(type==='invoke_agent') { add('agentReleaseRef',REF_SCHEMA); add('input',objectSchema({},[])); }
  if(type==='mcp_client') { add('serverRef',REF_SCHEMA); add('operationRef',REF_SCHEMA); add('input',objectSchema({},[])); }
  if(type==='sub_workflow'||type==='execute_subworkflow') add('input',objectSchema({},[]));
  if(type==='webhook'||type==='http_request') { add('method',{type:'string',enum:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']}); add('input',objectSchema({},[])); }
  if(type==='spreadsheet_upsert') { add('mapping',objectSchema({},[])); add('values',objectSchema({},[])); }
  return objectSchema(properties,required);
}

const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const inputSchema=typed?.inputSchema||GENERIC_SCHEMA;
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
}); add('value',{}); }
  if(type==='error_trigger') add('errorCode',{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,79}
const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const legacy=legacySchemaFor(type);
 const hasLegacy=type!=='action'&&type!=='connector_action'&&Object.keys(legacy.properties||{}).length>0 || ['trigger','condition','switch','random_split','delay','wait_until','edit_fields','execution_data','stop_and_error','knowledge_search'].includes(type);
 const inputSchema=typed?.inputSchema|| (hasLegacy ? legacy : GENERIC_SCHEMA);
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed||hasLegacy?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
}); add('message',{type:'string',minLength:1,maxLength:500}); }
  if(type==='execution_data') { add('key',{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,79}
const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const inputSchema=typed?.inputSchema||GENERIC_SCHEMA;
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
}); add('value',{}); }
  if(type==='error_trigger') add('errorCode',{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,79}
const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const inputSchema=typed?.inputSchema||GENERIC_SCHEMA;
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
});
  if(['graphql_request','soap_request','oauth2','basic_auth','bearer_auth','hmac_auth','custom_headers','pagination','retry','circuit_breaker'].includes(type)) {
    add('connectionRef',REF_SCHEMA); add('operationRef',REF_SCHEMA); add('credentialRef',REF_SCHEMA);
    add('requestHeaders',objectSchema({},[])); add('body',{}); add('variables',{type:'object',additionalProperties:true});
  }
  if(type==='knowledge_search') { add('query',STRING); add('knowledgeVersionRef',REF_SCHEMA); add('topK',{type:'integer',minimum:1,maximum:20}); }
  if(type==='ai_classify') { add('promptRef',REF_SCHEMA); add('labels',{type:'array',minItems:1,maxItems:100,items:STRING}); add('outputSchema',{type:'object',additionalProperties:true}); }
  if(type==='ai_summarize') { add('promptRef',REF_SCHEMA); add('maxChars',{type:'integer',minimum:100,maximum:12000}); }
  if(type==='ai_intent_detect') { add('promptRef',REF_SCHEMA); add('labels',{type:'array',minItems:1,maxItems:100,items:STRING}); }
  if(type==='ai_generate') { add('modelPolicyRef',REF_SCHEMA); add('outputSchema',{type:'object',additionalProperties:true}); }
  if(type==='invoke_agent') { add('agentReleaseRef',REF_SCHEMA); add('input',objectSchema({},[])); }
  if(type==='mcp_client') { add('serverRef',REF_SCHEMA); add('operationRef',REF_SCHEMA); add('input',objectSchema({},[])); }
  if(type==='sub_workflow'||type==='execute_subworkflow') add('input',objectSchema({},[]));
  if(type==='webhook'||type==='http_request') { add('method',{type:'string',enum:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']}); add('input',objectSchema({},[])); }
  if(type==='spreadsheet_upsert') { add('mapping',objectSchema({},[])); add('values',objectSchema({},[])); }
  return objectSchema(properties,required);
}

const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const inputSchema=typed?.inputSchema||GENERIC_SCHEMA;
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
});
  if(['graphql_request','soap_request','oauth2','basic_auth','bearer_auth','hmac_auth','custom_headers','pagination','retry','circuit_breaker'].includes(type)) {
    add('connectionRef',REF_SCHEMA); add('operationRef',REF_SCHEMA); add('credentialRef',REF_SCHEMA);
    add('requestHeaders',objectSchema({},[])); add('body',{}); add('variables',{type:'object',additionalProperties:true});
  }
  if(type==='knowledge_search') { add('query',STRING); add('knowledgeVersionRef',REF_SCHEMA); add('topK',{type:'integer',minimum:1,maximum:20}); }
  if(type==='ai_classify') { add('promptRef',REF_SCHEMA); add('labels',{type:'array',minItems:1,maxItems:100,items:STRING}); add('outputSchema',{type:'object',additionalProperties:true}); }
  if(type==='ai_summarize') { add('promptRef',REF_SCHEMA); add('maxChars',{type:'integer',minimum:100,maximum:12000}); }
  if(type==='ai_intent_detect') { add('promptRef',REF_SCHEMA); add('labels',{type:'array',minItems:1,maxItems:100,items:STRING}); }
  if(type==='ai_generate') { add('modelPolicyRef',REF_SCHEMA); add('outputSchema',{type:'object',additionalProperties:true}); }
  if(type==='invoke_agent') { add('agentReleaseRef',REF_SCHEMA); add('input',objectSchema({},[])); }
  if(type==='mcp_client') { add('serverRef',REF_SCHEMA); add('operationRef',REF_SCHEMA); add('input',objectSchema({},[])); }
  if(type==='sub_workflow'||type==='execute_subworkflow') add('input',objectSchema({},[]));
  if(type==='webhook'||type==='http_request') { add('method',{type:'string',enum:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']}); add('input',objectSchema({},[])); }
  if(type==='spreadsheet_upsert') { add('mapping',objectSchema({},[])); add('values',objectSchema({},[])); }
  return objectSchema(properties,required);
}


const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const legacy=legacySchemaFor(type);
 const hasLegacy=type!=='action'&&type!=='connector_action'&&Object.keys(legacy.properties||{}).length>0 || ['trigger','condition','switch','random_split','delay','wait_until','edit_fields','execution_data','stop_and_error','knowledge_search'].includes(type);
 const inputSchema=typed?.inputSchema|| (hasLegacy ? legacy : GENERIC_SCHEMA);
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed||hasLegacy?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
}); add('message',{type:'string',minLength:1,maxLength:500}); }
  if(type==='execution_data') { add('key',{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,79}
const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const inputSchema=typed?.inputSchema||GENERIC_SCHEMA;
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
}); add('value',{}); }
  if(type==='error_trigger') add('errorCode',{type:'string',pattern:'^[a-z][a-z0-9_.-]{0,79}
const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const inputSchema=typed?.inputSchema||GENERIC_SCHEMA;
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
});
  if(['graphql_request','soap_request','oauth2','basic_auth','bearer_auth','hmac_auth','custom_headers','pagination','retry','circuit_breaker'].includes(type)) {
    add('connectionRef',REF_SCHEMA); add('operationRef',REF_SCHEMA); add('credentialRef',REF_SCHEMA);
    add('requestHeaders',objectSchema({},[])); add('body',{}); add('variables',{type:'object',additionalProperties:true});
  }
  if(type==='knowledge_search') { add('query',STRING); add('knowledgeVersionRef',REF_SCHEMA); add('topK',{type:'integer',minimum:1,maximum:20}); }
  if(type==='ai_classify') { add('promptRef',REF_SCHEMA); add('labels',{type:'array',minItems:1,maxItems:100,items:STRING}); add('outputSchema',{type:'object',additionalProperties:true}); }
  if(type==='ai_summarize') { add('promptRef',REF_SCHEMA); add('maxChars',{type:'integer',minimum:100,maximum:12000}); }
  if(type==='ai_intent_detect') { add('promptRef',REF_SCHEMA); add('labels',{type:'array',minItems:1,maxItems:100,items:STRING}); }
  if(type==='ai_generate') { add('modelPolicyRef',REF_SCHEMA); add('outputSchema',{type:'object',additionalProperties:true}); }
  if(type==='invoke_agent') { add('agentReleaseRef',REF_SCHEMA); add('input',objectSchema({},[])); }
  if(type==='mcp_client') { add('serverRef',REF_SCHEMA); add('operationRef',REF_SCHEMA); add('input',objectSchema({},[])); }
  if(type==='sub_workflow'||type==='execute_subworkflow') add('input',objectSchema({},[]));
  if(type==='webhook'||type==='http_request') { add('method',{type:'string',enum:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']}); add('input',objectSchema({},[])); }
  if(type==='spreadsheet_upsert') { add('mapping',objectSchema({},[])); add('values',objectSchema({},[])); }
  return objectSchema(properties,required);
}

const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }},
  runtimeInputSchema:{}
 }),
 connector_action:Object.freeze({
  inputSchema:{type:'object',required:['connectorRef','connectionRef','operationRef'],additionalProperties:false,properties:{
    connectorRef:{type:'string',minLength:3,maxLength:180},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true}
  }},
  runtimeInputSchema:{}
 }),
 edit_fields:Object.freeze({
  inputSchema:{type:'object',required:['mapping'],additionalProperties:true,properties:{
    mapping:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
      source:{type:'string',minLength:3,maxLength:180},
      expression:{type:'string',minLength:1,maxLength:4000},
      target:{type:'string',minLength:3,maxLength:180},
      transform:{type:'string',minLength:1,maxLength:30},
      args:{type:'array',maxItems:5}
    }}}
  }},
  runtimeInputSchema:{type:'object',additionalProperties:true}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false},runtimeInputSchema:{}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}},runtimeInputSchema:{type:'object',additionalProperties:true}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}},runtimeInputSchema:{type:'object',additionalProperties:true}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const inputSchema=typed?.inputSchema||GENERIC_SCHEMA;
 const runtimeInputSchema=typed?.runtimeInputSchema||inputSchema;
 return {
  type,
  category:meta.category,
  risk:meta.risk,
  guard:meta.guard,
  execution:meta.execution,
  requiresApproval:meta.requiresApproval,
  retrySafe:meta.retrySafe,
  requiresAdapter:meta.requiresAdapter,
  schemaVersion:1,
  schemaStatus:typed?'typed':'catalog-generic',
  inputSchema:clone(inputSchema),
  runtimeInputSchema:clone(runtimeInputSchema),
  outputSchema:clone(GENERIC_SCHEMA),
  actionBinding:type==='action'?'required':'none',
  ...candidate
 };
}

function mergeOutputSchemas(schemas){
 if(!schemas.length) return clone(GENERIC_SCHEMA);
 if(schemas.length===1) return clone(schemas[0]);
 if(schemas.some(isGenericJsonSchema)) return clone(GENERIC_SCHEMA);
 if(!schemas.every(schema=>schema?.type==='object')) return clone(GENERIC_SCHEMA);
 const keys=[...new Set(schemas.flatMap(schema=>Object.keys(schema.properties||{})))];
 const properties={};
 for(const key of keys){
  const candidates=schemas.filter(schema=>Object.hasOwn(schema.properties||{},key)).map(schema=>schema.properties[key]);
  if(candidates.every(candidate=>JSON.stringify(canonical(candidate))===JSON.stringify(canonical(candidates[0])))) properties[key]=clone(candidates[0]);
 }
 const required=(schemas[0].required||[]).filter(key=>schemas.every(schema=>(schema.required||[]).includes(key)));
 return {
  type:'object',
  properties,
  required,
  additionalProperties:schemas.some(schema=>schema.additionalProperties!==false)
 };
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null,connectorRegistry=null}={}){
 const resolvedActionRegistry=actionRegistry||createActionRegistry({actions:actions||[
  getAction('crm.contact.upsert'),
  getAction('crm.record.merge'),
  getAction('marketing.campaign.send'),
  getAction('commerce.payment.refund'),
  getAction('service.quote.send'),
  getAction('workflow.execute')
].filter(Boolean)});
 const contracts=Object.fromEntries(WORKFLOW_NODE_TYPES.map(type=>[type,normalizeContract(type)]));
 const map=new Map(Object.entries(contracts));

 const resolveContract=(type,config={},options={})=>{
  const base=map.get(type);
  if(!base) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  if(type==='action' && config.actionId){
    const action=resolvedActionRegistry.get(ref(config.actionId,'actionId'));
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    return freeze({...clone(base),schemaStatus:'typed',runtimeInputSchema:clone(action.inputSchema||{}),outputSchema:clone(action.outputSchema||GENERIC_SCHEMA)});
  }
  if(type==='connector_action' && config.connectorRef){
    if(!connectorRegistry || typeof connectorRegistry.getOperationSchema!=='function') fail('connector_registry_required','Connector schema registry is required for connector_action');
    const operation=connectorRegistry.getOperationSchema({tenantId:options.tenantId,connectorRef:ref(config.connectorRef,'connectorRef'),operationRef:ref(config.operationRef,'operationRef')});
    return freeze({...clone(base),schemaStatus:operation.schemaStatus==='typed'?'typed':'connector-generic',runtimeInputSchema:clone(operation.inputSchema),outputSchema:clone(operation.outputSchema),connectorOperation:clone(operation)});
  }
  return freeze(clone(base));
 };

 const get=(type,config=null,options={})=>clone(resolveContract(type,config||{},options));
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);

 const validateNodeConfig=(type,config={},options={})=>{
  const contract=resolveContract(type,config,options);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
    ref(config.actionId,'actionId');
    const action=resolvedActionRegistry.get(config.actionId);
    if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
    if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
    if(config.input!==undefined) resolvedActionRegistry.validateInput(config.actionId,config.input);
    if(config.connectionRef!==undefined) ref(config.connectionRef,'connectionRef');
    if(config.operationRef!==undefined) ref(config.operationRef,'operationRef');
  }
  if(type==='connector_action'){
    ref(config.connectorRef,'connectorRef');
    ref(config.connectionRef,'connectionRef');
    ref(config.operationRef,'operationRef');
    if(config.input!==undefined) validateJsonSchema(config.input,contract.runtimeInputSchema,'node.config.input');
  }
  return true;
 };

 const validateNodeOutput=(type,nodeConfig={},output,options={})=>{
  const contract=resolveContract(type,nodeConfig,options);
  validateJsonSchema(output,contract.outputSchema,'node.output');
  return true;
 };

 const summarizeNodeOutput=(type,nodeConfig={},output,options={})=>{
  validateNodeOutput(type,nodeConfig,output,options);
  return freeze({valid:true,schemaVersion:resolveContract(type,nodeConfig,options).schemaVersion,outputHash:digest(output)});
 };

 const propagateOutputSchemas=({nodes,edges}={},options={})=>{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>150) fail('node_set_invalid','nodes must contain 1-150 entries');
  if(!Array.isArray(edges)||edges.length>300) fail('edge_set_invalid','edges must contain <=300 entries');
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const incoming=new Map(nodes.map(node=>[node.id,[]]));
  const outgoing=new Map(nodes.map(node=>[node.id,[]]));
  for(const edge of edges){
    if(!byId.has(edge.from)||!byId.has(edge.to)) fail('edge_reference_invalid','schema propagation edge references an unknown node');
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }
  const indegree=new Map(nodes.map(node=>[node.id,incoming.get(node.id).length]));
  const ready=nodes.filter(node=>indegree.get(node.id)===0).map(node=>node.id).sort();
  const built=new Map();
  while(ready.length){
    const nodeId=ready.shift();
    const node=byId.get(nodeId);
    const contract=resolveContract(node.type,node.config||{},options);
    const predecessors=incoming.get(nodeId).map(id=>built.get(id));
    const upstreamOutputSchemas=predecessors.map(previous=>({nodeId:previous.id,schema:clone(previous.outputSchema)}));
    const upstreamSchema=mergeOutputSchemas(predecessors.map(previous=>previous.outputSchema));
    const declaredInput=clone(contract.runtimeInputSchema||{});
    let propagatedInputSchema=declaredInput;
    let schemaStatus=contract.schemaStatus;
    if(predecessors.length===1){
      const comparison=compareJsonSchemas(predecessors[0].outputSchema,declaredInput);
      if(!isGenericJsonSchema(declaredInput)){
        if(!comparison.compatible) fail('workflow_schema_incompatible','Upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessors[0].id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        schemaStatus=comparison.indeterminate?'typed-compatible-unknown':'typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    } else if(predecessors.length>1){
      if(!isGenericJsonSchema(declaredInput)){
        for(const predecessor of predecessors){
          const comparison=compareJsonSchemas(predecessor.outputSchema,declaredInput);
          if(!comparison.compatible) fail('workflow_schema_incompatible','One upstream output cannot satisfy downstream input schema '+nodeId,{nodeId,upstreamNodeId:predecessor.id,reason:comparison.reason||'schema_mismatch',path:comparison.path});
        }
        schemaStatus='typed-compatible';
      } else {
        propagatedInputSchema=clone(upstreamSchema);
        schemaStatus='propagated';
      }
    }
    const enriched=freeze({
      ...clone(node),
      inputSchema:clone(contract.inputSchema),
      runtimeInputSchema:declaredInput,
      outputSchema:clone(contract.outputSchema),
      propagatedInputSchema,
      upstreamNodes:incoming.get(nodeId).slice().sort(),
      upstreamOutputSchemas,
      schemaVersion:contract.schemaVersion,
      schemaStatus,
      schemaFingerprint:digest({inputSchema:contract.inputSchema,runtimeInputSchema:declaredInput,outputSchema:contract.outputSchema,upstreamOutputSchemas})
    });
    built.set(nodeId,enriched);
    for(const targetId of outgoing.get(nodeId)){
      indegree.set(targetId,indegree.get(targetId)-1);
      if(indegree.get(targetId)===0){
        ready.push(targetId);ready.sort();
      }
    }
  }
  if(built.size!==nodes.length) fail('workflow_schema_cycle','Cannot propagate schemas through a cyclic graph');
  return nodes.map(node=>built.get(node.id));
 };

 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput,
  summarizeNodeOutput,
  propagateOutputSchemas,
  validateNodeInput(type,nodeConfig,input,options={}) {
    const contract=resolveContract(type,nodeConfig,options);
    validateJsonSchema(input,contract.runtimeInputSchema,'node.input');
    return true;
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
