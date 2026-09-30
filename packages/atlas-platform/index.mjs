import crypto from 'node:crypto';

export const ACTION_STATES = Object.freeze(['proposed','pending_approval','approved','running','succeeded','failed','canceled','compensating','compensated']);
export const HEALTH_STATES = Object.freeze(['unknown','healthy','degraded','unhealthy']);

export function jitteredBackoff(attempt, baseMs=500, maxMs=30000, jitter=0.2, random=Math.random) {
  const raw=Math.min(maxMs,baseMs*2**Math.max(0,attempt)); const spread=raw*jitter;
  return Math.max(0,Math.round(raw-spread+random()*spread*2));
}
export function assessConnectorHealth({connector, observedCapabilities=[], latencyMs=null, errorRate=0, credentialValid=true}) {
  const advertised=new Set((connector?.capabilities||[]).map(String)); const observed=new Set(observedCapabilities.map(String));
  const missing=[...advertised].filter(x=>!observed.has(x)); let state='healthy';
  if(!credentialValid || errorRate>=0.5) state='unhealthy';
  else if(missing.length || errorRate>=0.1 || (latencyMs!=null && latencyMs>2000)) state='degraded';
  return {connectorId:connector?.id??null,state,missingCapabilities:missing,errorRate,latencyMs,credentialValid,checkedAt:new Date().toISOString()};
}
export function createHealthSnapshot(input){return {...assessConnectorHealth(input),id:`health_${crypto.randomUUID().replaceAll('-','')}`,tenantId:input.tenantId,provider:input.connector?.provider??input.connector?.id??'unknown'};}
export function detectCapabilityDrift(previous,current){
  const before=new Set(previous?.capabilities||[]), after=new Set(current?.capabilities||[]);
  return {added:[...after].filter(x=>!before.has(x)).sort(),removed:[...before].filter(x=>!after.has(x)).sort(),drifted:JSON.stringify([...before].sort())!==JSON.stringify([...after].sort())};
}
export function createGoldenEvaluation({id,tenantId,agentId,input,expectedTools=[],expectedOutcome}){return {id,tenantId,agentId,input,expectedTools:[...new Set(expectedTools)].sort(),expectedOutcome};}
export function evaluateAgentCase({golden,actualTools=[],actualOutcome,trace=[]}){
  const toolsPass=JSON.stringify([...golden.expectedTools].sort())===JSON.stringify([...new Set(actualTools)].sort());
  const outcomePass=JSON.stringify(golden.expectedOutcome)===JSON.stringify(actualOutcome); const traceSafe=trace.every(s=>s.tenantId===golden.tenantId);
  return {caseId:golden.id,pass:toolsPass&&outcomePass&&traceSafe,checks:{tools:toolsPass,outcome:outcomePass,tenantIsolation:traceSafe}};
}
export function scoreEvaluation(cases){const rows=cases||[];const passed=rows.filter(x=>x.pass).length;return {score:rows.length?Math.round(passed/rows.length*10000)/100:0,passed,total:rows.length};}
export function releaseGate({evaluationScore,minScore=95,errorRate=0,maxErrorRate=0.02,criticalFailures=0}){const checks={evaluation:evaluationScore>=minScore,errorRate:errorRate<=maxErrorRate,criticalFailures:criticalFailures===0};return {pass:Object.values(checks).every(Boolean),checks,evaluationScore,minScore,errorRate,maxErrorRate,criticalFailures};}
export function createTelemetryFacade({tracer=null,meter=null,clock=()=>Date.now()}={}){return {
  async span(name,attributes,fn){const start=clock();const span=tracer?.startSpan?.(name,{attributes});try{const result=await fn();span?.setStatus?.({code:1});return result}catch(error){span?.recordException?.(error);span?.setStatus?.({code:2,message:error.message});throw error}finally{meter?.recordDuration?.(name,clock()-start,attributes);span?.end?.()}},
  event(name,attributes){tracer?.emitEvent?.(name,attributes)}, metric(name,value,attributes){meter?.record?.(name,value,attributes)}
};}
export function createAction({tenantId,actorId,proposalId,tool,payload={},risk='write',idempotencyKey}){
  if(!tenantId||!actorId||!proposalId||!tool)throw new Error('tenantId, actorId, proposalId and tool are required');
  return {id:`act_${crypto.randomUUID().replaceAll('-','')}`,tenantId,actorId,proposalId,tool,payload,risk,status:'pending_approval',idempotencyKey:idempotencyKey||crypto.randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),attempts:0};
}
export function transitionAction(action,next,{approved=false}={}){const allowed={proposed:['pending_approval','canceled'],pending_approval:['approved','canceled'],approved:['running','canceled'],running:['succeeded','failed','compensating'],failed:['running','canceled','compensating'],compensating:['compensated','failed'],succeeded:[],canceled:[],compensated:[]};if(!allowed[action.status]?.includes(next))throw new Error(`Invalid action transition ${action.status} -> ${next}`);if(action.status==='pending_approval'&&next==='approved'&&!approved)throw new Error('Approval is required');return {...action,status:next,updatedAt:new Date().toISOString(),attempts:next==='running'?action.attempts+1:action.attempts};}
export function claimIdempotency(store,key,actionId){if(!key)throw new Error('idempotency key required');const existing=store.get(key);if(existing&&existing!==actionId)return {accepted:false,existingActionId:existing};store.set(key,actionId);return {accepted:true,existingActionId:actionId};}
export function deriveCommandCenter({pulse,connectors=[],evaluations=[],actions=[]}){const health=connectors.reduce((n,c)=>n+(c.state==='healthy'?1:0),0);const evalScore=scoreEvaluation(evaluations);return {generatedAt:new Date().toISOString(),health:{connectors:connectors.length,healthy:health,degraded:connectors.filter(c=>c.state==='degraded').length,unhealthy:connectors.filter(c=>c.state==='unhealthy').length},evaluation:evalScore,operations:{risks:pulse?.risks?.length||0,pipeline:Number(pulse?.metrics?.totalPipeline||0),pendingApprovals:actions.filter(a=>a.status==='pending_approval').length,running:actions.filter(a=>a.status==='running').length,failed:actions.filter(a=>a.status==='failed').length},risks:pulse?.risks||[]};}