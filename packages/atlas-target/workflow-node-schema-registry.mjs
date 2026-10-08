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
