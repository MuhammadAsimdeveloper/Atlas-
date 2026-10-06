import crypto from 'node:crypto';

const HASH=/^[a-f0-9]{64}$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{2,240}$/;
const TYPES=new Set(['session.started','model.started','model.completed','tool.proposed','tool.completed','approval.required','handoff.requested','turn.completed','turn.failed','session.reset']);

function sha(value){ return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function freeze(value){ if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value; }
function ref(value,label){ if(typeof value!=='string'||!REF.test(value)) throw new TypeError(label+' must be a bounded reference'); return value; }
function bounded(value,label,max=160){ if(typeof value!=='string'||!value.trim()||value.length>max||/[\r\n\u0000]/.test(value)) throw new TypeError(label+' must be bounded text'); return value.trim(); }
function hash(value,label){ if(typeof value!=='string'||!HASH.test(value)) throw new TypeError(label+' must be SHA-256'); return value; }

export function createAgentTimeline({tenantId,sessionId,releaseId,maxEvents=500}={}){
  ref(tenantId,'tenantId');ref(sessionId,'sessionId');ref(releaseId,'releaseId');
  if(!Number.isSafeInteger(maxEvents)||maxEvents<10||maxEvents>2000) throw new TypeError('maxEvents is out of bounds');
  return freeze({tenantId,sessionId,releaseId,maxEvents,events:[]});
}

export function appendAgentTimelineEvent(timeline,{type,turnId=null,nodeRef=null,status='ok',durationMs=null,inputTokens=0,outputTokens=0,costMicros=0,reason=null,refHash=null,now=Date.now()}={}){
  if(!timeline||timeline.tenantId==null) throw new TypeError('timeline required');
  if(!TYPES.has(type)) throw new TypeError('unsupported timeline event type');
  if(turnId!=null) ref(turnId,'turnId');
  if(nodeRef!=null) ref(nodeRef,'nodeRef');
  if(!['ok','failed','waiting','canceled'].includes(status)) throw new TypeError('status invalid');
  for(const [name,value] of [['durationMs',durationMs],['inputTokens',inputTokens],['outputTokens',outputTokens],['costMicros',costMicros]]){
    if(value!=null&&(!Number.isSafeInteger(value)||value<0||value>1_000_000_000)) throw new TypeError(name+' invalid');
  }
  if(reason!=null) bounded(reason,'reason',80);
  if(refHash!=null) hash(refHash,'refHash');
  if(timeline.events.length>=timeline.maxEvents) throw new Error('agent timeline event budget exhausted');
  const event={
    sequence:timeline.events.length+1,type,turnId,nodeRef,status,durationMs,inputTokens,outputTokens,costMicros,
    reason:reason??null,refHash:refHash??null,createdAt:new Date(Number(now)).toISOString()
  };
  const eventChecksum=sha(event);
  return freeze({...timeline,events:[...timeline.events,freeze({...event,eventChecksum})]});
}

export function resetAgentTimeline(timeline,{now=Date.now()}={}){
  return appendAgentTimelineEvent(timeline,{type:'session.reset',status:'ok',now});
}

export function exportAgentTimeline(timeline){
  if(!timeline||!Array.isArray(timeline.events)) throw new TypeError('timeline required');
  return freeze({
    tenantId:timeline.tenantId,sessionId:timeline.sessionId,releaseId:timeline.releaseId,
    eventCount:timeline.events.length,
    timelineHash:sha(timeline.events),
    events:timeline.events.map(event=>({
      sequence:event.sequence,type:event.type,turnId:event.turnId,nodeRef:event.nodeRef,status:event.status,
      durationMs:event.durationMs,inputTokens:event.inputTokens,outputTokens:event.outputTokens,costMicros:event.costMicros,
      reason:event.reason,refHash:event.refHash,createdAt:event.createdAt,eventChecksum:event.eventChecksum
    })),
    exportedAt:new Date().toISOString(),
    rawContentStored:false
  });
}
