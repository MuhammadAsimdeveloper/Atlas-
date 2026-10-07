import { normalizeActionSchemas, validateJsonSchema } from './schema.mjs';
import { evaluateExpression } from '../atlas-core/expression-engine.mjs';
import crypto from 'node:crypto';

const ID=/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;
const RISKS=new Set(['read','write','external_side_effect','financial','privileged']);
const SURFACES=new Set(['api','workflow','mcp','agent','ui','portal','webhook']);
const APPROVALS=new Set(['none','human','policy','dual_control']);

const ACTIONS=Object.freeze([
  Object.freeze({id:'crm.contact.upsert',name:'Upsert Contact',domain:'crm',risk:'write',approval:'none',surfaces:['api','workflow','mcp','agent','ui','portal']}),
  Object.freeze({id:'crm.record.merge',name:'Merge Records',domain:'crm',risk:'write',approval:'human',surfaces:['api','workflow','mcp','agent','ui']}),
  Object.freeze({id:'marketing.campaign.send',name:'Send Campaign',domain:'marketing',risk:'external_side_effect',approval:'policy',surfaces:['api','workflow','mcp','agent','ui']}),
  Object.freeze({id:'commerce.payment.refund',name:'Refund Payment',domain:'commerce',risk:'financial',approval:'human',surfaces:['api','workflow','mcp','agent','ui','portal']}),
  Object.freeze({id:'service.quote.send',name:'Send Quote',domain:'service',risk:'external_side_effect',approval:'policy',surfaces:['api','workflow','mcp','agent','ui','portal']}),
  Object.freeze({id:'workflow.execute',name:'Execute Workflow',domain:'automation',risk:'external_side_effect',approval:'policy',surfaces:['api','workflow','mcp','agent','ui','webhook']})
]);

function assertId(v,l='id'){if(typeof v!=='string'||!ID.test(v))throw Object.assign(new TypeError(l+' invalid'),{code:'invalid_id'});return v;}
function assertRef(v,l='reference'){if(typeof v!=='string'||!REF.test(v))throw Object.assign(new TypeError(l+' invalid'),{code:'invalid_reference'});return v;}
function hash(v){return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');}
function clone(v){return structuredClone(v);}
const FORBIDDEN_INPUT_KEYS=new Set(['password','passwd','secret','token','access_token','refresh_token','client_secret','api_key','apikey','private_key','authorization','cookie']);
function validateInput(value,depth=0){
  if(depth>8)throw Object.assign(new Error('action input nesting too deep'),{code:'input_too_deep'});
  if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return;
  if(Array.isArray(value)){if(value.length>500)throw Object.assign(new Error('action input array too large'),{code:'input_too_large'});for(const item of value)validateInput(item,depth+1);return;}
  if(typeof value==='object'){const keys=Object.keys(value);if(keys.length>100)throw Object.assign(new Error('action input object too large'),{code:'input_too_large'});for(const key of keys){if(FORBIDDEN_INPUT_KEYS.has(key.toLowerCase())||/(?:^|_)(?:secret|token|password|api[_-]?key|private[_-]?key)(?:$|_)/i.test(key))throw Object.assign(new Error('action input contains credential material'),{code:'credential_in_input'});validateInput(value[key],depth+1);}return;}
  throw Object.assign(new Error('unsupported action input value'),{code:'input_value_invalid'});
}
function bounded(v,l,max){if(!Array.isArray(v)||v.length>max)throw new RangeError(l+' must contain <= '+max+' items');return v;}
function isPlainObject(v){return v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype&&Object.getOwnPropertySymbols(v).length===0;}
function resolveExpressionValue(value,context,depth=0){
  if(depth>8)throw Object.assign(new Error('action expression nesting too deep'),{code:'expression_too_deep'});
  if(Array.isArray(value)){if(value.length>500)throw Object.assign(new Error('action input array too large'),{code:'input_too_large'});return value.map(item=>resolveExpressionValue(item,context,depth+1));}
  if(!isPlainObject(value))return value;
  const keys=Object.keys(value);
  if(keys.length>100)throw Object.assign(new Error('action input object too large'),{code:'input_too_large'});
  if(keys.length===1&&keys[0]==='$expression'){
    if(typeof value.$expression!=='string')throw Object.assign(new Error('action expression must be text'),{code:'expression_invalid'});
    return evaluateExpression({expression:value.$expression,context});
  }
  return Object.fromEntries(keys.map(key=>[key,resolveExpressionValue(value[key],context,depth+1)]));
}
export function resolveActionInputExpressions({input={},context}={}){
  if(!isPlainObject(input)&&!Array.isArray(input))throw new TypeError('action input must be a plain object or array');
  if(!isPlainObject(context))throw new TypeError('expression context must be a plain object');
  return clone(resolveExpressionValue(input,context));
}

export function createActionRegistry({actions=[]}={}){
  if(!Array.isArray(actions)||actions.length>500) throw new TypeError('actions must be a bounded array');
  const normalized=actions.map((action,index)=>{
    if(!action||typeof action!=='object'||Array.isArray(action)) throw new TypeError('action '+(index+1)+' is invalid');
    assertId(action.id,'actionId');assertId(action.domain,'domain');
    if(typeof action.name!=='string'||action.name.length<2||action.name.length>120) throw new TypeError('action name invalid');
    if(!RISKS.has(action.risk)||!APPROVALS.has(action.approval)) throw new TypeError('action risk or approval invalid');
    bounded(action.surfaces||[],'surfaces',20);
    if(!(action.surfaces||[]).every(x=>SURFACES.has(x))) throw new TypeError('unsupported action surface');
    const schemas=normalizeActionSchemas({inputSchema:action.inputSchema||{},outputSchema:action.outputSchema||{}});
    const body={
      id:action.id,name:action.name,domain:action.domain,risk:action.risk,approval:action.approval,
      inputSchema:schemas.inputSchema,outputSchema:schemas.outputSchema,
      surfaces:[...(action.surfaces||[])],requiredScopes:[...(action.requiredScopes||[])],providerRefs:[...(action.providerRefs||[])]
    };
    return Object.freeze({...body,definitionHash:hash(body)});
  });
  const ids=new Set();
  for(const action of normalized){if(ids.has(action.id)) throw new TypeError('duplicate action id');ids.add(action.id);}
  const byId=new Map(normalized.map(action=>[action.id,action]));
  return Object.freeze({
    get(id){assertId(id,'actionId');const action=byId.get(id);return action?clone(action):null;},
    has(id){assertId(id,'actionId');return byId.has(id);},
    list({domain=null,risk=null,surface=null}={}){
      return normalized.filter(a=>(domain===null||a.domain===domain)&&(risk===null||a.risk===risk)&&(surface===null||a.surfaces.includes(surface))).map(clone);
    },
    validateInput(id,input){
      const action=byId.get(id);if(!action) throw Object.assign(new Error('action not registered'),{code:'action_not_registered'});
      validateJsonSchema(input,action.inputSchema,'input');return true;
    }
  });
}

export function defineAction({id,name,domain,risk='write',approval='none',inputSchema={},outputSchema={},surfaces=['api','workflow'],requiredScopes=[],providerRefs=[]}={}){
  assertId(id,'actionId');if(typeof name!=='string'||name.length<2||name.length>120)throw new TypeError('name invalid');
  assertId(domain,'domain');if(!RISKS.has(risk)||!APPROVALS.has(approval))throw new TypeError('invalid risk or approval');
  bounded(surfaces,'surfaces',20);if(!surfaces.every(x=>SURFACES.has(x)))throw new TypeError('unsupported surface');
  bounded(requiredScopes,'requiredScopes',50);bounded(providerRefs,'providerRefs',50);
  const schemas=normalizeActionSchemas({inputSchema,outputSchema});
  const body={id,name,domain,risk,approval,inputSchema:schemas.inputSchema,outputSchema:schemas.outputSchema,surfaces:[...surfaces],requiredScopes:[...requiredScopes],providerRefs:[...providerRefs]};
  return Object.freeze({...body,definitionHash:hash(body)});
}

const DEFAULT_ACTION_REGISTRY=createActionRegistry({actions:ACTIONS});
export function getAction(id){return DEFAULT_ACTION_REGISTRY.get(id);}
export function listActions(filters={}){return DEFAULT_ACTION_REGISTRY.list(filters);}

export function compileActionSurfaces(action){
  if(!action||typeof action!=='object')throw new TypeError('action required');
  return Object.freeze({
    api:action.surfaces.includes('api')?Object.freeze({method:action.risk==='read'?'GET':'POST',operationId:action.id}):null,
    workflow:action.surfaces.includes('workflow')?Object.freeze({nodeType:'action',actionId:action.id}):null,
    mcp:action.surfaces.includes('mcp')?Object.freeze({toolName:action.id,requiresApproval:action.approval!=='none'}):null,
    agent:action.surfaces.includes('agent')?Object.freeze({skillAction:action.id,risk:action.risk}):null,
    ui:action.surfaces.includes('ui')?Object.freeze({component:'action',actionId:action.id}):null,
    portal:action.surfaces.includes('portal')?Object.freeze({component:'portal-action',actionId:action.id}):null,
    webhook:action.surfaces.includes('webhook')?Object.freeze({handler:action.id}):null
  });
}

export function createInvocation({registry=DEFAULT_ACTION_REGISTRY,tenantId,actionId,requestId,actorRef,idempotencyKey,input={},expressionContext=null,mode='dry_run',providerState='verified',consent=true,approved=false}={}){
  assertRef(tenantId,'tenantId');assertId(actionId,'actionId');assertRef(requestId,'requestId');assertRef(actorRef,'actorRef');assertRef(idempotencyKey,'idempotencyKey');
  if(!registry||typeof registry.get!=='function'||typeof registry.validateInput!=='function')throw new TypeError('registry is invalid');
  if(!['dry_run','live'].includes(mode))throw new TypeError('mode invalid');
  const resolvedInput=expressionContext===null?input:resolveActionInputExpressions({input,context:expressionContext});
  validateInput(resolvedInput);
  const serialized=JSON.stringify(resolvedInput);if(serialized.length>100000)throw Object.assign(new Error('action input too large'),{code:'input_too_large'});
  const action=registry.get(actionId);if(!action)throw Object.assign(new Error('action not registered'),{code:'action_not_registered'});
  registry.validateInput(actionId,resolvedInput);
  if(mode==='live'){
    if(action.risk==='external_side_effect'||action.risk==='financial'||action.risk==='privileged'){
      if(providerState!=='verified')throw Object.assign(new Error('provider is not verified'),{code:'provider_unverified'});
      if(!consent)throw Object.assign(new Error('consent required'),{code:'consent_required'});
      if(action.approval!=='none'&&!approved)throw Object.assign(new Error('approval required'),{code:'approval_required'});
    }
  }
  return Object.freeze({tenantId,actionId,requestId,actorRef,idempotencyKey,mode,providerState,consent,approved,input:clone(resolvedInput),actionHash:hash({tenantId,actionId,requestId,idempotencyKey,mode,input:resolvedInput})});
}

export function syntheticTestPlan({tenantId,actionId,fixtures=[],expectedOutcomes=['success','retry','failure']}={}){
  assertRef(tenantId,'tenantId');assertId(actionId,'actionId');bounded(fixtures,'fixtures',100);bounded(expectedOutcomes,'expectedOutcomes',10);
  return Object.freeze({tenantId,actionId,testRunId:'synthetic_'+hash({tenantId,actionId,fixtures,expectedOutcomes}).slice(0,20),mode:'synthetic',fixtures:clone(fixtures),expectedOutcomes:[...expectedOutcomes],sideEffects:'disabled'});
}

export function buildBusinessCapability({action,interfaceConfig=null}={}){
  const surfaces=compileActionSurfaces(action);
  return Object.freeze({actionId:action.id,definitionHash:action.definitionHash,surfaces,interfaceConfig:interfaceConfig?clone(interfaceConfig):null});
}

export const ACTION_CATALOG_COUNT=ACTIONS.length;
export const ACTION_IDS=Object.freeze(ACTIONS.map(x=>x.id));
