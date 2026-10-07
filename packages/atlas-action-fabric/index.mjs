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
function bounded(v,l,max){if(!Array.isArray(v)||v.length>max)throw new RangeError(l+' must contain <= '+max+' items');return v;}

export function defineAction({id,name,domain,risk='write',approval='none',inputSchema={},outputSchema={},surfaces=['api','workflow'],requiredScopes=[],providerRefs=[]}={}){
  assertId(id,'actionId');if(typeof name!=='string'||name.length<2||name.length>120)throw new TypeError('name invalid');
  assertId(domain,'domain');if(!RISKS.has(risk)||!APPROVALS.has(approval))throw new TypeError('invalid risk or approval');
  bounded(surfaces,'surfaces',20);if(!surfaces.every(x=>SURFACES.has(x)))throw new TypeError('unsupported surface');
  bounded(requiredScopes,'requiredScopes',50);bounded(providerRefs,'providerRefs',50);
  return Object.freeze({id,name,domain,risk,approval,inputSchema:clone(inputSchema),outputSchema:clone(outputSchema),surfaces:[...surfaces],requiredScopes:[...requiredScopes],providerRefs:[...providerRefs],definitionHash:hash({id,name,domain,risk,approval,inputSchema,outputSchema,surfaces,requiredScopes,providerRefs})});
}

export function getAction(id){assertId(id,'actionId');const action=ACTIONS.find(x=>x.id===id);return action?clone(action):null;}
export function listActions({domain=null,risk=null,surface=null}={}){return ACTIONS.filter(a=>(domain===null||a.domain===domain)&&(risk===null||a.risk===risk)&&(surface===null||a.surfaces.includes(surface))).map(clone);}

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

export function createInvocation({tenantId,actionId,requestId,actorRef,idempotencyKey,input={},mode='dry_run',providerState='verified',consent=true,approved=false}={}){
  assertRef(tenantId,'tenantId');assertId(actionId,'actionId');assertRef(requestId,'requestId');assertRef(actorRef,'actorRef');assertRef(idempotencyKey,'idempotencyKey');
  if(!['dry_run','live'].includes(mode))throw new TypeError('mode invalid');
  const action=getAction(actionId);if(!action)throw Object.assign(new Error('action not registered'),{code:'action_not_registered'});
  if(mode==='live'){
    if(action.risk==='external_side_effect'||action.risk==='financial'||action.risk==='privileged'){
      if(providerState!=='verified')throw Object.assign(new Error('provider is not verified'),{code:'provider_unverified'});
      if(!consent)throw Object.assign(new Error('consent required'),{code:'consent_required'});
      if(action.approval!=='none'&&!approved)throw Object.assign(new Error('approval required'),{code:'approval_required'});
    }
  }
  return Object.freeze({tenantId,actionId,requestId,actorRef,idempotencyKey,mode,providerState,consent,approved,input:clone(input),actionHash:hash({tenantId,actionId,requestId,idempotencyKey,mode,input})});
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
