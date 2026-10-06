import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { jobHandlers as productionHandlers } from './v125-production.mjs';
import { createAgentTurnJobHandler } from '../agent-turn-handler.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));

async function loadReviewed(dirName,envName){
  const moduleName=process.env[envName];
  if(!moduleName||!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.mjs$/.test(moduleName)){
    throw Object.assign(new Error(envName+' must reference a reviewed .mjs module.'),{code:'agent_provider_unavailable'});
  }
  const base=path.resolve(here,'../',dirName);
  const target=path.resolve(base,moduleName);
  if(!target.startsWith(base+path.sep)) throw Object.assign(new Error(envName+' path escapes reviewed directory.'),{code:'agent_provider_path_invalid'});
  return import(pathToFileURL(target).href);
}

let inputModule=null;
let modelModule=null;
let sinkModule=null;
let toolModule={agentTools:{},executeTool:async()=>{throw Object.assign(new Error('No reviewed agent tool executor is configured.'),{code:'agent_tool_executor_unavailable'});}};

if(process.env.ATLAS_AGENT_TURN_EXECUTION_ENABLED==='true'){
  inputModule=await loadReviewed('agent-input','ATLAS_AGENT_INPUT_RESOLVER_MODULE');
  modelModule=await loadReviewed('model-adapters','ATLAS_MODEL_ADAPTER_MODULE');
  sinkModule=await loadReviewed('response-sinks','ATLAS_AGENT_RESPONSE_SINK_MODULE');
  if(process.env.ATLAS_AGENT_TOOL_MODULE) toolModule=await loadReviewed('agent-tools','ATLAS_AGENT_TOOL_MODULE');
  if(typeof inputModule.resolveInput!=='function'||typeof modelModule.getModelAdapter!=='function'||typeof sinkModule.deliverResponse!=='function'||typeof toolModule.executeTool!=='function') throw Object.assign(new Error('Reviewed agent runtime module contract is incomplete.'),{code:'agent_runtime_contract_invalid'});
  if(!inputModule.resolveInputReady||!modelModule.getModelAdapterReady||!sinkModule.deliverResponseReady) throw Object.assign(new Error('Agent runtime providers must explicitly declare readiness.'),{code:'agent_runtime_not_ready'});
}

export const jobHandlers=Object.freeze(process.env.ATLAS_AGENT_TURN_EXECUTION_ENABLED==='true'
 ? {
    ...productionHandlers,
    'agent.turn.execute': createAgentTurnJobHandler({
      resolveInput:inputModule.resolveInput,
      getModelAdapter:modelModule.getModelAdapter,
      tools:toolModule.agentTools||{},
      executeTool:toolModule.executeTool,
      deliverResponse:sinkModule.deliverResponse,
      deliverStreamDelta:sinkModule.deliverStreamDelta,
      deliverStreamTerminal:sinkModule.deliverStreamTerminal
    })
  }
 : productionHandlers);
export const eventHandlers=Object.freeze({});
