import {startWorkflowStep,completeWorkflowStep,failWorkflowStep,resumeWorkflowExecution} from '../../packages/atlas-target/workflow-execution-engine.mjs';
import {externalSideEffectAllowed} from '../../packages/atlas-core/capability-fabric.mjs';
const UUID=/^[0-9a-f-]{8,120}$/i;

function currentAttempt(execution,nodeId){
 const attempts=execution.steps.filter(s=>s.nodeId===nodeId).map(s=>Number(s.attempt)||0);
 return Math.max(0,...attempts)+1;
}
function safeEventDetails(value){
 const text=JSON.stringify(value??{});
 if(text.length>4000) return {kind:'redacted',reason:'details_too_large'};
 return value??{};
}

export async function executeWorkflowJob({store,job,workerId,resolveAction=async()=>({status:'completed'}),verifyExternalAction=async()=>false,signal=null,now=Date.now()}){
 if(!store||!job||typeof workerId!=='string')throw new TypeError('Workflow executor requires store, leased job and worker.');
 let execution=await store.getWorkflowExecutionForJob(job,workerId);
 if(!execution)throw Object.assign(new Error('Execution is unavailable for the leased job.'),{code:'execution_unavailable'});
 if(execution.status==='waiting'){
   const resumed=resumeWorkflowExecution({execution,now});
   if(resumed===execution)return {status:'waiting',execution};
   const updated=await store.updateWorkflowExecutionForJob(job,workerId,{expectedVersion:execution.version,status:resumed.status,currentNodeId:resumed.currentNodeId,state:resumed,stateChecksum:resumed.checksum,lastErrorCode:resumed.lastErrorCode,retryAt:resumed.retryAt,finishedAt:resumed.endedAt});
   if(!updated)throw Object.assign(new Error('Execution changed during resume.'),{code:'execution_version_conflict'});
   execution=resumed;
 }
 if(['completed','canceled','dead_letter'].includes(execution.status))return {status:execution.status,execution};
 const nodeId=execution.currentNodeId;
 if(!UUID.test(nodeId||'')&&!/^[A-Za-z][A-Za-z0-9_.:-]{0,179}$/.test(nodeId||''))throw Object.assign(new Error('Current workflow node is invalid.'),{code:'execution_node_invalid'});
 const node=execution.workflowNodes.find(n=>n.id===nodeId);
 if(!node)throw Object.assign(new Error('Current workflow node is unavailable.'),{code:'execution_node_missing'});
 const attempt=currentAttempt(execution,nodeId);
 if(attempt>node.retry.maxAttempts)throw Object.assign(new Error('Workflow step attempt limit exceeded.'),{code:'workflow_attempt_limit'});
 let next=startWorkflowStep(execution,{nodeId,attempt,now});
 if(next!==execution){
   const ok=await store.updateWorkflowExecutionForJob(job,workerId,{expectedVersion:execution.version,status:next.status,currentNodeId:next.currentNodeId,state:next,stateChecksum:next.checksum,lastErrorCode:next.lastErrorCode,retryAt:next.retryAt,finishedAt:next.endedAt});
   if(!ok)throw Object.assign(new Error('Execution changed while starting step.'),{code:'execution_version_conflict'});
   execution=next;
 }
 if(node.requiresApproval)return {status:'waiting_approval',execution};
 try{
   const capabilityId=typeof node.config?.capabilityId==='string'?node.config.capabilityId:null;
   const inferredCapabilityId=node.type==='send_message'&&typeof node.config?.channel==='string'?'communication.'+node.config.channel:null;
   const effectiveCapabilityId=capabilityId||inferredCapabilityId;
   const providerStatus=node.config?.providerStatus;
   const verifiedByDeployment=providerStatus==='verified'||await verifyExternalAction(Object.freeze({node,job,workerId,tenantId:job.tenant_id}));
   if(node.requiresAdapter&&(!effectiveCapabilityId||!externalSideEffectAllowed({capabilityId:effectiveCapabilityId,providerStatus:verifiedByDeployment?'verified':providerStatus,consent:node.config?.consent===true,approved:node.config?.approved===true})))
     throw Object.assign(new Error('External side effect is not verified for this node.'),{code:'provider_not_verified'});
   const result=await resolveAction(Object.freeze({node,execution,tenantId:job.tenant_id,jobId:job.job_id,workerId,attempt,signal}));
   next=completeWorkflowStep({execution,nodeId,attempt,resultRef:result?.resultRef||null,selectedPort:result?.selectedPort||'next',now});
 }catch(error){
   next=failWorkflowStep({execution,nodeId,attempt,errorCode:/^[a-z][a-z0-9_.-]{0,79}$/.test(error?.code||'')?error.code:'handler_failed',now});
 }
 const ok=await store.updateWorkflowExecutionForJob(job,workerId,{expectedVersion:execution.version,status:next.status,currentNodeId:next.currentNodeId,state:next,stateChecksum:next.checksum,lastErrorCode:next.lastErrorCode,retryAt:next.retryAt,finishedAt:next.endedAt});
 if(!ok)throw Object.assign(new Error('Execution changed while completing step.'),{code:'execution_version_conflict'});
 if(typeof store.appendWorkflowExecutionEventForJob==='function'){
   await store.appendWorkflowExecutionEventForJob(job,workerId,{eventType:'workflow.step.completed',nodeId,attempt,status:next.status,detailsRef:safeEventDetails({resultRef:next.steps.at(-1)?.resultRef||null,errorCode:next.lastErrorCode})});
 }
 return {status:next.status,execution:next};
}
