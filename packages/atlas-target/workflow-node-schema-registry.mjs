import crypto from 'node:crypto';
import { WORKFLOW_NODE_CATALOG, WORKFLOW_NODE_TYPES } from './workflow-catalog.mjs';
import { createActionRegistry, getAction } from '../atlas-action-fabric/index.mjs';
import { validateJsonSchema } from '../atlas-action-fabric/schema.mjs';

const REF=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;
const clone=value=>structuredClone(value);
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const fail=(code,message,details={})=>{const error=new TypeError(message);error.code=code;Object.assign(error,details);throw error;};
const ref=(value,label)=>{if(typeof value!=='string'||!REF.test(value))fail('invalid_reference',label+' must be a bounded reference');return value;};
function digest(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function canonical(value){return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;}

const GENERIC_SCHEMA=Object.freeze({type:'object',additionalProperties:true});
const CONTRACT_SCHEMAS={
 trigger:Object.freeze({
  inputSchema:{type:'object',required:['eventType'],additionalProperties:true,properties:{eventType:{type:'string',minLength:3,maxLength:180}}}
 }),
 action:Object.freeze({
  inputSchema:{type:'object',required:['actionId'],additionalProperties:false,properties:{
    actionId:{type:'string',minLength:3,maxLength:180},
    input:{type:'object',additionalProperties:true},
    connectionRef:{type:'string',minLength:3,maxLength:180},
    operationRef:{type:'string',minLength:3,maxLength:180}
  }}
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
  }}
 }),
 stop:Object.freeze({inputSchema:{type:'object',additionalProperties:false}}),
 wait:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{waitMs:{type:'integer',minimum:1000,maximum:2592000000}}}}),
 delay:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{delayMs:{type:'integer',minimum:1000,maximum:2592000000},waitMs:{type:'integer',minimum:1000,maximum:2592000000}}}}),
 execution_data:Object.freeze({inputSchema:{type:'object',additionalProperties:false,properties:{key:{type:'string',minLength:1,maxLength:120},value:{}}}})
};

function normalizeContract(type,candidate={}){
 const meta=WORKFLOW_NODE_CATALOG[type];
 if(!meta) fail('node_type_not_registered','Workflow node type is not registered: '+type);
 const typed=CONTRACT_SCHEMAS[type];
 const inputSchema=typed?.inputSchema||GENERIC_SCHEMA;
 return freeze({
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
  outputSchema:{type:'object',additionalProperties:true},
  actionBinding:type==='action'?'required':'none',
  ...candidate
 });
}

export function createWorkflowNodeSchemaRegistry({actionRegistry=null,actions=null}={}){
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
 const get=(type)=>{const contract=map.get(type);return contract?clone(contract):null;};
 const list=({schemaStatus=null,category=null}={})=>[...map.values()].filter(c=>(schemaStatus===null||c.schemaStatus===schemaStatus)&&(category===null||c.category===category)).map(clone);
 const validateNodeConfig=(type,config={})=>{
  const contract=map.get(type);
  if(!contract) fail('node_type_not_registered','Workflow node type is not registered: '+type);
  validateJsonSchema(config,contract.inputSchema,'node.config');
  if(type==='action'){
   ref(config.actionId,'actionId');
   const action=resolvedActionRegistry.get(config.actionId);
   if(!action) fail('action_not_registered','Workflow action is not registered: '+config.actionId);
   if(!action.surfaces.includes('workflow')) fail('action_not_workflow_capable','Workflow action is not enabled for the workflow surface: '+config.actionId);
   if(config.connectionRef!==undefined)ref(config.connectionRef,'connectionRef');
   if(config.operationRef!==undefined)ref(config.operationRef,'operationRef');
   if(config.input!==undefined)resolvedActionRegistry.validateInput(config.actionId,config.input);
  }
  return true;
 };
 return freeze({
  version:1,
  get,
  list,
  has:type=>typeof type==='string'&&map.has(type),
  validateNodeConfig,
  validateNodeOutput(type,nodeConfig={},output){
    const contract=map.get(type);
    if(!contract)fail('node_type_not_registered','Workflow node type is not registered: '+type);
    let outputSchema=contract.outputSchema;
    if(type==='action'){
      ref(nodeConfig?.actionId,'actionId');
      const action=resolvedActionRegistry.get(nodeConfig.actionId);
      if(!action)fail('action_not_registered','Workflow action is not registered: '+nodeConfig.actionId);
      outputSchema=action.outputSchema||GENERIC_SCHEMA;
    }
    validateJsonSchema(output,outputSchema,'node.output');
    return true;
  },
  summarizeNodeOutput(type,nodeConfig={},output){
    validateNodeOutput(type,nodeConfig,output);
    return freeze({valid:true, schemaVersion:map.get(type).schemaVersion, outputHash:digest(canonical(output))});
  },
  summary:freeze({total:map.size,typed:[...map.values()].filter(c=>c.schemaStatus==='typed').length,generic:[...map.values()].filter(c=>c.schemaStatus==='catalog-generic').length})
 });
}

export const WORKFLOW_NODE_SCHEMA_REGISTRY=createWorkflowNodeSchemaRegistry();
export const WORKFLOW_NODE_SCHEMA_REGISTRY_SUMMARY=WORKFLOW_NODE_SCHEMA_REGISTRY.summary;
