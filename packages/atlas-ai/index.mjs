import crypto from 'node:crypto';

const freeze=v=>Object.freeze(v);
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');
const text=(v,l,m=240)=>{if(typeof v!=='string'||!v.trim()||v.length>m||/[\r\n\u0000]/.test(v))throw new Error(l+' invalid');return v.trim();};
const tenant=v=>text(v,'tenantId',180);

const SECRET_PATTERN=/(password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|credential|authorization|cookie|card[_-]?number|cvv)/i;
const PROMPT_INJECTION=/(ignore (all|any|previous) (previous )?instructions|reveal (system|developer) prompt|disable safety|bypass (security|approval)|exfiltrat|do anything now)/i;

export const AGENT_TYPES=Object.freeze(['assistant','conversation','workflow','research','sales','support','voice','orchestrator']);
export const AI_RISK=Object.freeze({read:'read',generate:'low',write:'write',external:'high',financial:'critical'});

function safeObject(value,label,maxKeys=100){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>maxKeys)throw new Error(label+' invalid');
  for(const key of Object.keys(value)){if(SECRET_PATTERN.test(key))throw new Error('Raw secret-like field is not allowed: '+key);}
  return structuredClone(value);
}

export function defineAgent({
  tenantId,agentId,name,type='assistant',version=1,instructions='',models=[],tools=[],
  maxToolCalls=20,maxTokens=4000,budgetMinor=1000,requiresHumanApprovalFor=['financial','external']
}={}){
  tenantId=tenant(tenantId); agentId=text(agentId,'agentId'); name=text(name,'name');
  if(!AGENT_TYPES.includes(type))throw new Error('agent type unsupported');
  if(!Number.isSafeInteger(version)||version<1)throw new Error('version invalid');
  instructions=text(instructions||'Provide tenant-safe assistance.','instructions',10000);
  if(PROMPT_INJECTION.test(instructions))throw new Error('unsafe agent instruction');
  const normalizedModels=[...new Set((Array.isArray(models)?models:[]).map(x=>text(x,'model',160)))].sort();
  const normalizedTools=[...new Set((Array.isArray(tools)?tools:[]).map(x=>text(x,'tool',180)))].sort();
  if(!Number.isSafeInteger(maxToolCalls)||maxToolCalls<1||maxToolCalls>200)throw new Error('maxToolCalls invalid');
  if(!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>1_000_000)throw new Error('maxTokens invalid');
  if(!Number.isSafeInteger(budgetMinor)||budgetMinor<0)throw new Error('budgetMinor invalid');
  const body={tenantId,agentId,name,type,version,instructions,models:normalizedModels,tools:normalizedTools,maxToolCalls,maxTokens,budgetMinor,requiresHumanApprovalFor:[...new Set(requiresHumanApprovalFor)].sort()};
  const checksum=hash(body);
  const releaseId='agent_'+checksum.slice(0,28);
  return freeze({...body,releaseId,checksum});
}

export function planAgentToolCall({agent,actor,tool,args={},risk='read',approval=null,remainingBudgetMinor=0,callNumber=1}={}){
  if(!agent||typeof agent!=='object')throw new Error('agent checksum invalid');
  const {releaseId,checksum,...material}=agent;
  if(typeof checksum!=='string'||checksum!==hash(material)||releaseId!=='agent_'+checksum.slice(0,28))throw new Error('agent checksum invalid');
  if(actor?.tenantId!==agent.tenantId)return {allowed:false,code:'TENANT_BOUNDARY_VIOLATION'};
  tool=text(tool,'tool');
  if(!agent.tools.includes(tool))return {allowed:false,code:'TOOL_NOT_GRANTED'};
  if(!Object.values(AI_RISK).includes(risk))throw new Error('risk invalid');
  safeObject(args,'toolArgs',100);
  if(!Number.isSafeInteger(callNumber)||callNumber<1||callNumber>agent.maxToolCalls)return {allowed:false,code:'TOOL_CALL_BUDGET_EXCEEDED'};
  if(!Number.isSafeInteger(remainingBudgetMinor)||remainingBudgetMinor<0||remainingBudgetMinor>agent.budgetMinor)return {allowed:false,code:'AI_BUDGET_INVALID'};
  if((risk==='financial'||(risk==='external'&&agent.requiresHumanApprovalFor.includes('external'))) && approval?.status!=='approved'){
    return {allowed:false,code:'HUMAN_APPROVAL_REQUIRED'};
  }
  return freeze({
    allowed:true,tenantId:agent.tenantId,agentId:agent.agentId,releaseId:agent.releaseId,tool,risk,
    requestId:'aitool_'+hash({tenantId:agent.tenantId,agentId:agent.agentId,releaseId:agent.releaseId,tool,args,callNumber}).slice(0,28)
  });
}

export function createKnowledgeDocument({tenantId,documentId,title,sourceRef,textContent,chunkVersion=1,metadata={}}={}){
  tenantId=tenant(tenantId); documentId=text(documentId,'documentId'); title=text(title,'title');
  sourceRef=text(sourceRef,'sourceRef',1000); textContent=text(textContent,'textContent',2_000_000);
  if(!Number.isSafeInteger(chunkVersion)||chunkVersion<1)throw new Error('chunkVersion invalid');
  const safeMeta=safeObject(metadata,'metadata',50);
  if(PROMPT_INJECTION.test(textContent))return {accepted:false,code:'PROMPT_INJECTION_REVIEW',tenantId,documentId};
  const body={tenantId,documentId,title,sourceRef,textHash:hash(textContent),chunkVersion,metadata:safeMeta};
  return freeze({...body,documentHash:hash(body),status:'ready'});
}

export function createRetrievalPlan({tenantId,query,knowledgeDocuments=[],topK=5,minScore=0.65}={}){
  tenantId=tenant(tenantId); query=text(query,'query',10000);
  if(PROMPT_INJECTION.test(query))return {allowed:false,code:'PROMPT_INJECTION_REVIEW'};
  if(!Number.isSafeInteger(topK)||topK<1||topK>50)throw new Error('topK invalid');
  if(!Number.isFinite(minScore)||minScore<0||minScore>1)throw new Error('minScore invalid');
  const docs=(Array.isArray(knowledgeDocuments)?knowledgeDocuments:[]).filter(d=>d?.tenantId===tenantId&&d?.status==='ready'&&typeof d.documentHash==='string').slice(0,500);
  return freeze({allowed:true,tenantId,queryHash:hash(query),topK,minScore,candidates:docs.map(d=>({documentId:d.documentId,documentHash:d.documentHash,sourceRef:d.sourceRef}))});
}

export function createMcpCapability({tenantId,serverId,name,tools=[],resources=[],risk='read',requiresApproval=false}={}){
  tenantId=tenant(tenantId); serverId=text(serverId,'serverId'); name=text(name,'name');
  if(!['read','write','external','financial'].includes(risk))throw new Error('MCP risk invalid');
  const body={tenantId,serverId,name,tools:[...new Set((Array.isArray(tools)?tools:[]).map(x=>text(x,'MCP tool',180)))].sort(),resources:[...new Set((Array.isArray(resources)?resources:[]).map(x=>text(x,'MCP resource',500)))].sort(),risk,requiresApproval:Boolean(requiresApproval)};
  return freeze({...body,capabilityHash:hash(body)});
}

export function authorizeMcpUse({capability,actor,tool,approval=null}={}){
  if(!capability||capability.capabilityHash!==hash({...capability,capabilityHash:undefined}))throw new Error('MCP capability checksum invalid');
  if(actor?.tenantId!==capability.tenantId)return {allowed:false,code:'TENANT_BOUNDARY_VIOLATION'};
  tool=text(tool,'tool');
  if(!capability.tools.includes(tool))return {allowed:false,code:'MCP_TOOL_NOT_GRANTED'};
  if(capability.requiresApproval&&approval?.status!=='approved')return {allowed:false,code:'HUMAN_APPROVAL_REQUIRED'};
  return {allowed:true,tenantId:capability.tenantId,serverId:capability.serverId,tool};
}

export function createAiEvaluation({tenantId,evaluationId,agentReleaseId,caseInput,expectedOutput,requiredTools=[],maxCostMinor=100}={}){
  tenantId=tenant(tenantId); evaluationId=text(evaluationId,'evaluationId'); agentReleaseId=text(agentReleaseId,'agentReleaseId');
  const body={tenantId,evaluationId,agentReleaseId,inputHash:hash(caseInput),expectedOutput:safeObject(expectedOutput,'expectedOutput',50),requiredTools:[...new Set((Array.isArray(requiredTools)?requiredTools:[]).map(x=>text(x,'requiredTool',180)))].sort(),maxCostMinor};
  return freeze({...body,checksum:hash(body)});
}

export function scoreAiEvaluation({evaluation,actualOutput,actualTools=[],costMinor=0,groundingSources=[],tenantId}={}){
  if(!evaluation||evaluation.checksum!==hash({...evaluation,checksum:undefined}))throw new Error('evaluation checksum invalid');
  if(tenantId!==evaluation.tenantId)return {pass:false,code:'TENANT_BOUNDARY_VIOLATION'};
  const tools=[...new Set(actualTools)].sort();
  const required=evaluation.requiredTools;
  const toolPass=JSON.stringify(tools)===JSON.stringify(required);
  const outputPass=JSON.stringify(canon(actualOutput))===JSON.stringify(canon(evaluation.expectedOutput));
  const sourcesPass=Array.isArray(groundingSources)&&groundingSources.every(s=>s?.tenantId===evaluation.tenantId);
  const costPass=Number.isSafeInteger(costMinor)&&costMinor>=0&&costMinor<=evaluation.maxCostMinor;
  return {pass:toolPass&&outputPass&&sourcesPass&&costPass,checks:{tools:toolPass,output:outputPass,grounding:sourcesPass,cost:costPass},costMinor};
}

export function planHumanHandoff({tenantId,agentReleaseId,reason,priority='normal',contextRefs=[],requiredRole='support'}={}){
  tenantId=tenant(tenantId); agentReleaseId=text(agentReleaseId,'agentReleaseId'); reason=text(reason,'reason',1000);
  if(!['low','normal','high','urgent'].includes(priority))throw new Error('priority invalid');
  return freeze({tenantId,agentReleaseId,reason,priority,contextRefs:[...new Set((Array.isArray(contextRefs)?contextRefs:[]).map(x=>text(x,'contextRef',500)))],requiredRole,status:'pending',handoffId:'handoff_'+hash({tenantId,agentReleaseId,reason,priority}).slice(0,28)});
}

export function redactAiTraceEvent({tenantId,event,keepKeys=[]}={}){
  tenantId=tenant(tenantId); safeObject(event,'event',200);
  const keep=new Set(keepKeys);
  const output={tenantId};
  for(const [k,v] of Object.entries(event)) {
    if(keep.has(k) && !SECRET_PATTERN.test(k)) output[k]=typeof v==='string'?v.slice(0,500):typeof v==='number'||typeof v==='boolean'?v:'[REDACTED]';
    else output[k]='[REDACTED]';
  }
  return output;
}
