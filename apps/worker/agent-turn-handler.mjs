import { createAgentReleaseManifest, buildAgentJourneyContext } from '../../packages/atlas-agent-fabric/index.mjs';
import { runAgentTurn } from '../../packages/atlas-agent-fabric/turn-runtime.mjs';
import { createAgentRuntimePolicy, createAgentSession } from '../../packages/atlas-target/index.mjs';

function ref(value,label){ if(typeof value!=='string'||value.length<3||value.length>240||/[\r\n\u0000]/.test(value)) throw new TypeError(label+' invalid'); return value; }
function hash(value,label){ if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value)) throw new TypeError(label+' invalid'); return value; }
function freeze(value){ if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value; }

function rebuildRelease(snapshot,tenantId){
  if(!snapshot||snapshot.tenantId!==tenantId) throw Object.assign(new Error('Agent release tenant mismatch'),{code:'agent_release_scope_invalid'});
  return createAgentReleaseManifest(snapshot);
}

export function createAgentTurnJobHandler({
  resolveInput,
  getModelAdapter,
  tools={},
  executeTool,
  deliverResponse,
  buildRuntime=null
}={}){
  if(typeof resolveInput!=='function'||typeof getModelAdapter!=='function'||typeof executeTool!=='function'||typeof deliverResponse!=='function') throw new TypeError('Agent turn handler dependencies are incomplete');
  return async (payloadRef,context)=>{
    const store=context?.workerStore;
    const tenantId=ref(context?.tenantId,'tenantId'), jobId=ref(context?.jobId,'jobId'), workerId=ref(context?.workerId,'workerId');
    const executionId=ref(payloadRef?.executionId,'executionId');
    const execution=await store.getAgentTurnForWorker({tenantId,jobId,workerId});
    if(!execution||execution.execution_id!==executionId) throw Object.assign(new Error('Agent turn execution is unavailable or not lease-bound'),{code:'agent_turn_not_found'});
    if(execution.status!=='queued'&&execution.status!=='running'&&execution.status!=='retryable') return freeze({status:execution.status,ignored:true});
    hash(execution.prompt_hash,'prompt_hash');
    const release=rebuildRelease(execution.release_snapshot,tenantId);
    if(release.releaseId!==execution.release_id||release.version!==execution.release_version) throw Object.assign(new Error('Agent release snapshot mismatch'),{code:'agent_release_snapshot_mismatch'});
    const actorId=ref(execution.created_by || context.actorId || workerId,'actorId');
    const conversationId=ref(execution.conversation_ref || execution.input_ref,'conversationId');
    const runtime=buildRuntime ? await buildRuntime({tenantId,release,execution,context}) : createAgentRuntimePolicy({
      tenantId,agentId:release.agentId,releaseId:release.releaseId,
      allowedTools:release.allowedTools,maxTurns:8,maxToolCalls:20,
      maxExecutionMs:Math.min(120000,Math.max(1000,(release.modelPolicy?.timeoutMs||30000)*8)),
      maxResponseChars:Math.min(20000,Math.max(400,(release.modelPolicy?.maxOutputTokens||1200)*4))
    });
    const session=createAgentSession({
      runtime,tenantId,conversationId,actorId,sessionId:execution.session_id,now:Date.now(),
      leaseMs:Math.min(300000,Math.max(1000,(release.modelPolicy?.timeoutMs||30000)))
    });
    const runningUpdated=await store.updateAgentTurnForWorker({
      tenantId,jobId,workerId,executionId,expectedVersion:execution.version,status:'running',
      resultRef:null,outputHash:null,toolCalls:0,inputTokens:0,outputTokens:0,latencyMs:null,waitingReason:null,errorCode:null,
      checksum:execution.checksum
    });
    if(!runningUpdated) throw Object.assign(new Error('Agent turn lease/version was lost before execution'),{code:'agent_turn_update_rejected'});
    const runningVersion=execution.version+1;
    const resolved=await resolveInput({tenantId,inputRef:ref(execution.input_ref,'inputRef'),executionId,execution,context});
    if(!resolved||typeof resolved!=='object') throw Object.assign(new Error('Transient agent input resolver returned no input'),{code:'agent_input_unavailable'});
    const adapter=await getModelAdapter({tenantId,release,execution,context});
    const journey=execution.journey_context ? buildAgentJourneyContext(execution.journey_context) : buildAgentJourneyContext({tenantId,journeyId:'agent-journey-'+execution.execution_id,conversationRef:conversationId});
    const result=await runAgentTurn({
      tenantId,actorId,release,session,runtime,turnId:execution.turn_id,
      promptHash:execution.prompt_hash,
      runtimeInput:{...resolved,journeyContext:journey},
      adapter,tools,executeTool,now:Date.now(),signal:context.signal,timeline:null
    });
    const redacted=result.redacted||{};
    const outputRef=result.output==null ? null : await deliverResponse({tenantId,execution,output:result.output,channel:resolved.channel,redacted,context});
    const status = result.status==='needs_approval' ? 'waiting_approval' : result.status==='handoff' ? 'handoff' : result.status==='canceled' ? 'canceled' : result.status==='completed' ? 'completed' : 'failed';
    const checksum=execution.checksum;
    const updated=await store.updateAgentTurnForWorker({
      tenantId,jobId,workerId,executionId,expectedVersion:runningVersion,status,
      resultRef:outputRef||result.handoff||result.redacted?.pendingTool ? (outputRef||{kind:result.status==='handoff'?'agent_handoff':'agent_result',id:result.handoff?.handoffId||execution.execution_id,version:1}) : null,
      outputHash:redacted?.model?.outputHash||null,toolCalls:redacted.toolCalls||0,
      inputTokens:redacted?.model?.usage?.inputTokens||redacted?.usage?.inputTokens||0,
      outputTokens:redacted?.model?.usage?.outputTokens||redacted?.usage?.outputTokens||0,
      latencyMs:redacted?.model?.latencyMs||null,
      waitingReason:status==='waiting_approval'?'tool_approval':status==='handoff'?'human_handoff':null,
      errorCode:status==='failed'?(redacted.reason||redacted.code||'agent_turn_failed'):null,checksum
    });
    if(!updated) throw Object.assign(new Error('Agent turn lease/version was lost'),{code:'agent_turn_update_rejected'});
    return freeze({status,executionId,outputRef:redacted.outputHash ? outputRef : outputRef||null,redacted});
  };
}
