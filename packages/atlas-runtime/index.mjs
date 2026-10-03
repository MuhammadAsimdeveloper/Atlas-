import crypto from 'node:crypto';

const freeze = value => Object.freeze(value);
const canon = value => Array.isArray(value)
  ? value.map(canon)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canon(value[k])]))
    : value;
const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(canon(value))).digest('hex');
const text = (value,label,max=180) => {
  if (typeof value !== 'string' || !value.trim() || value.length>max || /[\r\n\u0000]/.test(value)) throw new Error(label+' invalid');
  return value.trim();
};

export const N8N_CLASS_NODE_TYPES = Object.freeze([
  'manual_trigger','schedule_trigger','webhook_trigger','app_event_trigger','chat_trigger','sse_trigger','polling_trigger',
  'if','switch','merge','loop','split_out','aggregate','filter','sort','remove_duplicates','limit','wait',
  'execute_workflow','stop_error','no_op','set','transform','code_javascript','code_python',
  'http_request','graphql','webhook','jwt','ftp','sftp','ssh','ldap','imap','rss','html','markdown','xml','compression','crypto','git',
  'data_table','pagination','approval','human_in_the_loop','ai_agent','mcp_client','mcp_server','vector_retriever',
  'embedding','document_loader','text_splitter','reranker','search','calculator','subworkflow'
]);

const TERMINAL = new Set(['succeeded','failed','canceled','dead_letter']);
const EXECUTION_STATES = Object.freeze(['queued','running','waiting','succeeded','failed','canceled','dead_letter']);

function topological(nodes,edges){
  const indegree=new Map(nodes.map(n=>[n.id,0]));
  const outgoing=new Map(nodes.map(n=>[n.id,[]]));
  for(const e of edges){ indegree.set(e.to,indegree.get(e.to)+1); outgoing.get(e.from).push(e.to); }
  const queue=[...nodes.filter(n=>indegree.get(n.id)===0).map(n=>n.id).sort()];
  const order=[];
  while(queue.length){
    const current=queue.shift();
    order.push(current);
    for(const next of outgoing.get(current).sort()){
      const value=indegree.get(next)-1;
      indegree.set(next,value);
      if(value===0) queue.push(next);
      queue.sort();
    }
  }
  if(order.length!==nodes.length) throw new Error('Workflow contains a cycle');
  return order;
}

export function compileDurableWorkflow({tenantId,workflowId,version=1,name,nodes,edges}={}){
  tenantId=text(tenantId,'tenantId'); workflowId=text(workflowId,'workflowId'); name=text(name,'name',240);
  if(!Number.isSafeInteger(version)||version<1) throw new Error('version invalid');
  if(!Array.isArray(nodes)||nodes.length<2||nodes.length>500) throw new Error('nodes out of bounds');
  if(!Array.isArray(edges)||edges.length<1||edges.length>1200) throw new Error('edges out of bounds');
  const ids=new Set();
  const normalized=nodes.map((n,i)=>{
    const id=text(n?.id||('node_'+(i+1)),'nodeId');
    if(ids.has(id)) throw new Error('duplicate node id');
    ids.add(id);
    const type=text(n?.type,'nodeType',80);
    if(!N8N_CLASS_NODE_TYPES.includes(type)) throw new Error('unsupported node type: '+type);
    const timeoutMs=Number.isSafeInteger(n?.timeoutMs)?n.timeoutMs:30000;
    if(timeoutMs<100||timeoutMs>24*60*60*1000) throw new Error('node timeout invalid');
    const maxAttempts=Number.isSafeInteger(n?.retry?.maxAttempts)?n.retry.maxAttempts:3;
    if(maxAttempts<1||maxAttempts>20) throw new Error('retry maxAttempts invalid');
    return {id,type,name:text(n?.name||id,'nodeName',200),config:n?.config??{},timeoutMs,maxAttempts};
  });
  const safeEdges=edges.map((e,i)=>{
    if(!e||typeof e!=='object'||!ids.has(e.from)||!ids.has(e.to)||e.from===e.to) throw new Error('invalid edge '+(i+1));
    return {id:text(e.id||('edge_'+(i+1)),'edgeId'),from:e.from,to:e.to,port:text(e.port||'next','edgePort',80)};
  });
  if(new Set(safeEdges.map(e=>e.id)).size!==safeEdges.length) throw new Error('duplicate edge id');
  const roots=normalized.filter(n=>n.type.endsWith('_trigger')||n.type==='manual_trigger');
  if(roots.length!==1) throw new Error('durable workflow requires exactly one trigger');
  const order=topological(normalized,safeEdges);
  const steps=order.map((nodeId,index)=>{
    const node=normalized.find(n=>n.id===nodeId);
    return {
      sequence:index,stepId:'step_'+sha256({workflowId,version,nodeId,index}).slice(0,24),
      nodeId:node.id,nodeType:node.type,maxAttempts:node.maxAttempts,timeoutMs:node.timeoutMs,
      idempotencyScope:tenantId+':'+workflowId+':'+version+':'+node.id
    };
  });
  const body={tenantId,workflowId,version,name,nodes:normalized,edges:safeEdges,order,steps};
  return freeze({...body,checksum:sha256(body)});
}

export function createExecution({workflow,executionId=crypto.randomUUID(),triggerEvent={},idempotencyKey,maxSteps=10000,deadlineAt=null}={}){
  if(!workflow||workflow.checksum!==sha256({...workflow,checksum:undefined})) throw new Error('workflow checksum invalid');
  const key=text(idempotencyKey,'idempotencyKey',255);
  if(!Number.isSafeInteger(maxSteps)||maxSteps<1||maxSteps>1_000_000) throw new Error('maxSteps invalid');
  const execution={
    executionId:text(executionId,'executionId'),tenantId:workflow.tenantId,workflowId:workflow.workflowId,workflowVersion:workflow.version,
    workflowChecksum:workflow.checksum,idempotencyKey:key,state:'queued',cursor:0,completedSteps:[],
    attemptsByStep:{},triggerEvent:structuredClone(triggerEvent),maxSteps,deadlineAt,
    createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
  };
  return freeze({...execution,checksum:sha256(execution)});
}

export function checkpointExecution(execution,{expectedChecksum,stepId,stepResult,nextState='running'}={}){
  if(!execution||execution.checksum!==expectedChecksum) throw new Error('execution version conflict');
  if(!execution.workflowChecksum||!text(stepId,'stepId')) throw new Error('checkpoint input invalid');
  if(!EXECUTION_STATES.includes(nextState)) throw new Error('execution state invalid');
  if(execution.completedSteps.includes(stepId)) return execution;
  const next={
    ...execution,state:nextState,cursor:execution.cursor+1,
    completedSteps:[...execution.completedSteps,stepId],
    attemptsByStep:{...execution.attemptsByStep,[stepId]:(execution.attemptsByStep[stepId]||0)+1},
    lastStep:{stepId,result:stepResult},updatedAt:new Date().toISOString()
  };
  const {checksum,...body}=next;
  return freeze({...body,checksum:sha256(body)});
}

export function resumeExecution(execution,{workflow,expectedChecksum}={}){
  if(!execution||execution.checksum!==expectedChecksum) throw new Error('execution checksum conflict');
  if(!workflow||workflow.checksum!==execution.workflowChecksum) throw new Error('workflow release mismatch');
  const nextStep=workflow.steps.find(step=>!execution.completedSteps.includes(step.stepId));
  return {
    executionId:execution.executionId,tenantId:execution.tenantId,
    state:TERMINAL.has(execution.state)?execution.state:'running',
    nextStep:nextStep||null,
    remainingSteps:workflow.steps.filter(step=>!execution.completedSteps.includes(step.stepId)).length
  };
}

export function createQueueJob({tenantId,queue='default',jobId=crypto.randomUUID(),executionId,stepId,payload={},availableAt=new Date().toISOString(),maxAttempts=3}={}){
  tenantId=text(tenantId,'tenantId'); queue=text(queue,'queue',80); jobId=text(jobId,'jobId'); executionId=text(executionId,'executionId'); stepId=text(stepId,'stepId');
  if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>20) throw new Error('maxAttempts invalid');
  const body={jobId,tenantId,queue,executionId,stepId,payload:structuredClone(payload),availableAt,maxAttempts,attempts:0,state:'queued',lease:null};
  return freeze({...body,checksum:sha256(body)});
}

export function claimQueueJob(store,job,{workerId,leaseMs=30000,nowMs=Date.now()}={}){
  if(!(store instanceof Map)) throw new Error('queue store must be a Map');
  if(!job||job.checksum!==sha256({...job,checksum:undefined})) throw new Error('job checksum invalid');
  workerId=text(workerId,'workerId',120);
  const current=store.get(job.jobId);
  if(current&&current.checksum!==job.checksum) return {status:'conflict',code:'JOB_VERSION_CONFLICT'};
  if(job.state!=='queued' || new Date(job.availableAt).getTime()>nowMs) return {status:'not_claimable',code:'JOB_NOT_CLAIMABLE'};
  const claimed={...job,state:'running',attempts:job.attempts+1,lease:{workerId,expiresAt:new Date(nowMs+leaseMs).toISOString()},updatedAt:new Date(nowMs).toISOString()};
  claimed.checksum=sha256({...claimed,checksum:undefined});
  store.set(job.jobId,claimed);
  return {status:'claimed',job:freeze(claimed)};
}

export function heartbeatQueueJob(store,jobId,{workerId,leaseMs=30000,nowMs=Date.now()}={}){
  const job=store.get(jobId);
  if(!job||job.state!=='running'||job.lease?.workerId!==workerId) return {status:'not_owned'};
  if(Date.parse(job.lease.expiresAt)<=nowMs) return {status:'lease_expired'};
  const next={...job,lease:{workerId,expiresAt:new Date(nowMs+leaseMs).toISOString()},updatedAt:new Date(nowMs).toISOString()};
  next.checksum=sha256({...next,checksum:undefined}); store.set(jobId,next); return {status:'renewed',job:freeze(next)};
}

export function completeQueueJob(store,jobId,{workerId,result=null,nowMs=Date.now()}={}){
  const job=store.get(jobId);
  if(!job||job.state!=='running'||job.lease?.workerId!==workerId) return {status:'not_owned'};
  if(Date.parse(job.lease.expiresAt)<=nowMs) return {status:'lease_expired'};
  const next={...job,state:'succeeded',lease:null,result,completedAt:new Date(nowMs).toISOString(),updatedAt:new Date(nowMs).toISOString()};
  next.checksum=sha256({...next,checksum:undefined}); store.set(jobId,next); return {status:'succeeded',job:freeze(next)};
}

export function failQueueJob(store,jobId,{workerId,errorCode='WORKER_FAILED',retryAt=null,nowMs=Date.now()}={}){
  const job=store.get(jobId);
  if(!job||job.state!=='running'||job.lease?.workerId!==workerId) return {status:'not_owned'};
  if(Date.parse(job.lease.expiresAt)<=nowMs) return {status:'lease_expired'};
  const exhausted=job.attempts>=job.maxAttempts;
  const next={
    ...job,state:exhausted?'dead_letter':'queued',
    availableAt:retryAt||new Date(nowMs+Math.min(30*60*1000,500*2**Math.max(0,job.attempts-1))).toISOString(),
    lease:null,lastError:errorCode,updatedAt:new Date(nowMs).toISOString()
  };
  if(exhausted) next.deadLetteredAt=new Date(nowMs).toISOString();
  next.checksum=sha256({...next,checksum:undefined}); store.set(jobId,next);
  return {status:next.state,job:freeze(next)};
}

export function createConnectorSdkDefinition({provider,category,apiVersion,auth='oauth2',operations=[],triggers=[],webhook=null,rateLimit={requests:100,windowSeconds:60},risk='medium'}={}){
  provider=text(provider,'provider',100); category=text(category,'category',80); apiVersion=text(apiVersion,'apiVersion',80);
  if(!['oauth2','api_key','service_account','oidc','basic'].includes(auth)) throw new Error('auth mode invalid');
  if(!Array.isArray(operations)||operations.length<1||operations.length>1000) throw new Error('operations invalid');
  const normalizedOps=operations.map(op=>{
    const name=text(op?.name,'operation name',120);
    const method=text(op?.method||'GET','method',12).toUpperCase();
    if(!['GET','POST','PUT','PATCH','DELETE'].includes(method)) throw new Error('HTTP method invalid');
    const opRisk=['read','write','high','critical'].includes(op?.risk)?op.risk:'write';
    const scopes=[...new Set((Array.isArray(op?.scopes)?op.scopes:[]).map(x=>text(x,'scope',100)))].sort();
    return {name,method,path:text(op?.path||'/','operation path',500),risk:opRisk,scopes};
  }).sort((a,b)=>a.name.localeCompare(b.name));
  const body={provider,category,apiVersion,auth,operations:normalizedOps,triggers:Array.isArray(triggers)?triggers.map(x=>text(x,'trigger',100)).sort():[],webhook:webhook?{
    algorithm:text(webhook.algorithm,'webhook algorithm',40),
    toleranceSeconds:Number.isSafeInteger(webhook.toleranceSeconds)?webhook.toleranceSeconds:300
  }:null,rateLimit,risk};
  return freeze({...body,checksum:sha256(body)});
}

export function planConnectorInvocation({definition,tenantId,operation,grantedScopes=[],idempotencyKey,approval=null}={}){
  if(!definition||definition.checksum!==sha256({...definition,checksum:undefined})) throw new Error('connector definition checksum invalid');
  tenantId=text(tenantId,'tenantId'); operation=text(operation,'operation',120); idempotencyKey=text(idempotencyKey,'idempotencyKey',255);
  const op=definition.operations.find(x=>x.name===operation);
  if(!op) return {allowed:false,code:'OPERATION_NOT_SUPPORTED'};
  const granted=new Set(grantedScopes);
  const missing=op.scopes.filter(scope=>!granted.has(scope));
  if(missing.length) return {allowed:false,code:'SCOPES_MISSING',missingScopes:missing};
  if(op.risk==='critical'&&approval?.stepUp!==true) return {allowed:false,code:'STEP_UP_REQUIRED'};
  if(['high','critical'].includes(op.risk)&&approval?.status!=='approved') return {allowed:false,code:'APPROVAL_REQUIRED'};
  return freeze({
    allowed:true,tenantId,provider:definition.provider,operation:op.name,method:op.method,path:op.path,
    idempotencyKey,operationRisk:op.risk,
    requestKey:sha256({tenantId,provider:definition.provider,operation,idempotencyKey})
  });
}
