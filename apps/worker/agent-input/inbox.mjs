import { loadInboxContentStore } from '../../api/inbox-content.mjs';

const REF=/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}$/;

function boundedRef(value,label){ if(typeof value!=='string'||!REF.test(value)) throw Object.assign(new Error(label+' is invalid'),{code:'agent_input_invalid'}); return value; }
function boundedContent(value,label,max=24000){ if(typeof value!=='string'||value.length>max||/[\u0000]/.test(value)) throw Object.assign(new Error(label+' is invalid'),{code:'agent_input_invalid'}); return value; }

const env=process.env;
const store=await loadInboxContentStore(env);

export async function resolveInput({tenantId,inputRef,context}={}){
  boundedRef(tenantId,'tenantId'); boundedRef(inputRef,'inputRef');
  const executionId=boundedRef(context?.jobId||'agent_job','jobId');
  const item=await context.workerStore.getAgentInputForWorker({
    tenantId,
    jobId:context.jobId,
    workerId:context.workerId,
    executionId:context.executionId||context.payloadExecutionId||context.jobId
  });
  if(!item) throw Object.assign(new Error('Agent input is unavailable'),{code:'agent_input_unavailable'});
  const content=await store.getMessageContent({
    tenantId,
    messageId:item.message_id,
    contentRef:item.content_ref
  });
  if(!content||typeof content.text!=='string') throw Object.assign(new Error('Agent input content is unavailable'),{code:'agent_input_content_unavailable'});
  return Object.freeze({
    prompt:boundedContent(content.text,'prompt'),
    history:[],
    channel:item.channel,
    inputMessageRef:item.message_id,
    conversationRef:item.conversation_id
  });
}

export const resolveInputReady=true;
