import { createHash } from 'node:crypto';
import { loadInboxContentStore } from '../../api/inbox-content.mjs';

const REF=/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}$/;
function ref(value,label){ if(typeof value!=='string'||!REF.test(value)) throw Object.assign(new Error(label+' is invalid'),{code:'agent_response_invalid'}); return value; }
function bounded(value,label,max=24000){ const text=typeof value==='string'?value:JSON.stringify(value); if(typeof text!=='string'||text.length>max||/\u0000/.test(text)) throw Object.assign(new Error(label+' is invalid'),{code:'agent_response_invalid'}); return text; }

const store=await loadInboxContentStore(process.env);

export async function deliverResponse({tenantId,execution,output,channel='webchat',context}={}){
  ref(tenantId,'tenantId');
  const executionId=ref(execution?.execution_id||execution?.executionId,'executionId');
  const workerStore=context?.workerStore;
  if(!workerStore||typeof workerStore.createAgentResponseForWorker!=='function') throw Object.assign(new Error('Agent response worker store is unavailable'),{code:'agent_response_store_unavailable'});
  const contentRef='agent-response:'+executionId;
  const messageId=executionId;
  await store.putMessageContent({
    tenantId,
    messageId,
    channel:typeof channel==='string'&&channel.length<=40?channel:'webchat',
    text:bounded(output,'agent output'),
    html:null,
    attachments:[],
    metadata:{source:'atlas_agent_turn',executionRef:executionId}
  });
  const created=await workerStore.createAgentResponseForWorker({
    tenantId,
    jobId:ref(context.jobId,'jobId'),
    workerId:ref(context.workerId,'workerId'),
    executionId,
    contentRef
  });
  if(!created?.message_id) throw Object.assign(new Error('Agent response message was not created'),{code:'agent_response_create_failed'});
  return Object.freeze({kind:'inbox_message',id:created.message_id,version:1});
}

export const deliverResponseReady=true;

export async function deliverStreamDelta({tenantId,execution,delta,sequence,context}={}) {
  ref(tenantId,'tenantId'); const executionId=ref(execution?.execution_id||execution?.executionId,'executionId');
  if(!Number.isSafeInteger(sequence)||sequence<1) throw Object.assign(new Error('Stream sequence is invalid'),{code:'agent_stream_invalid'});
  const text=bounded(delta,'agent delta',2000);
  const workerStore=context?.workerStore;
  if(!workerStore||typeof workerStore.appendAgentStreamEvent!=='function') throw Object.assign(new Error('Agent stream worker store is unavailable'),{code:'agent_stream_store_unavailable'});
  const contentRef='agent-stream:'+executionId+':'+sequence;
  await store.putMessageContent({tenantId,messageId:executionId,channel:'webchat',text,html:null,attachments:[],metadata:{source:'atlas_agent_stream',executionRef:executionId,sequence}});
  const contentHash=createHash('sha256').update(text).digest('hex');
  await workerStore.appendAgentStreamEvent({tenantId,jobId:ref(context.jobId,'jobId'),workerId:ref(context.workerId,'workerId'),executionId,sequence,eventType:'delta',contentRef,contentHash});
}
export async function deliverStreamTerminal({tenantId,execution,status,sequence,output=null,context}={}) {
  ref(tenantId,'tenantId'); const executionId=ref(execution?.execution_id||execution?.executionId,'executionId');
  const workerStore=context?.workerStore;
  if(!workerStore||typeof workerStore.appendAgentStreamEvent!=='function') throw Object.assign(new Error('Agent stream worker store is unavailable'),{code:'agent_stream_store_unavailable'});
  let contentRef=null,contentHash=null;
  if(output!=null){
    const text=bounded(output,'agent terminal output');
    contentRef='agent-stream-final:'+executionId;
    await store.putMessageContent({tenantId,messageId:executionId,channel:'webchat',text,html:null,attachments:[],metadata:{source:'atlas_agent_stream_terminal',executionRef:executionId}});
    contentHash=createHash('sha256').update(text).digest('hex');
  }
  await workerStore.appendAgentStreamEvent({tenantId,jobId:ref(context.jobId,'jobId'),workerId:ref(context.workerId,'workerId'),executionId,sequence,eventType:status==='failed'?'error':'done',contentRef,contentHash});
}
