import crypto from 'node:crypto';
import { validateDataMapping, applyDataMapping } from './safe-data-mapping.mjs';

const MAX_ITEMS=1000;
const MAX_STEPS=500;
const REF=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;

const sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ref=(v,l)=>{if(typeof v!=='string'||!REF.test(v))throw new TypeError(l+' must be a bounded reference');return v;};
const int=(v,l,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw new TypeError(l+' must be '+min+'-'+max);return v;};
const arr=(v,l,max=MAX_ITEMS)=>{if(!Array.isArray(v)||v.length>max)throw new TypeError(l+' must be a bounded array');return v;};
const clone=v=>structuredClone(v);
const pathGet=(obj,path)=>String(path).split('.').filter(Boolean).reduce((v,k)=>v==null?undefined:v[k],obj);
const pathSet=(obj,path,value)=>{const parts=String(path).split('.').filter(Boolean);if(!parts.length)throw new TypeError('path required');let cur=obj;for(const p of parts.slice(0,-1)){if(!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(p))throw new TypeError('unsafe path');cur[p]??={};if(typeof cur[p]!=='object'||Array.isArray(cur[p]))throw new TypeError('path collision');}cur[parts.at(-1)]=value;};

function itemKey(item,key){const value=pathGet(item,key);return JSON.stringify(value===undefined?null:value);}
function compare(a,b,key,direction='asc'){const av=pathGet(a,key),bv=pathGet(b,key);if(av===bv)return 0;if(av==null)return 1;if(bv==null)return -1;const n=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv));return direction==='desc'?-n:n;}

export function executeN8nNode({tenantId,node,input=[],context={},policy={},now=Date.now()}={}){
  ref(tenantId,'tenantId');ref(node?.id,'node.id');
  const type=node.type; const config=node.config||{};
  const items=arr(input,'input',policy.maxLoopItems||MAX_ITEMS);
  const maxItems=Math.min(policy.maxLoopItems||MAX_ITEMS,MAX_ITEMS);
  const maxSteps=policy.maxSteps||MAX_STEPS;
  if(!Number.isSafeInteger(maxSteps)||maxSteps<1||maxSteps>MAX_STEPS)throw new TypeError('maxSteps out of bounds');
  switch(type){
    case 'no_op': return {items:clone(items),control:{status:'continue'}};
    case 'loop_over_items': {
      const batchSize=int(config.batchSize??1,'batchSize',1,100);
      const limited=items.slice(0,maxItems);
      const batches=[];for(let i=0;i<limited.length;i+=batchSize)batches.push(limited.slice(i,i+batchSize));
      return {items:batches.flat(),control:{status:'loop',batches,totalItems:limited.length,maxIterations:batches.length}};
    }
    case 'split_out': {
      const field=String(config.field||'items'); const out=[];for(const item of items){const value=pathGet(item,field);if(!Array.isArray(value))continue;for(const child of value.slice(0,maxItems-out.length))out.push({...item,item:child});if(out.length>=maxItems)break;}return {items:out,control:{status:'continue'}};
    }
    case 'aggregate': {
      const field=String(config.field||'items');const values=items.map(x=>pathGet(x,field)).filter(v=>v!==undefined);return {items:[{[field]:values.slice(0,maxItems)}],control:{status:'continue'}};
    }
    case 'remove_duplicates': {const key=String(config.key||'id');const seen=new Set();const out=[];for(const item of items){const k=itemKey(item,key);if(seen.has(k))continue;seen.add(k);out.push(item);}return {items:clone(out),control:{status:'continue'}};}
    case 'sort': {const key=String(config.key||'id');const direction=config.direction==='desc'?'desc':'asc';const out=clone(items);out.sort((a,b)=>compare(a,b,key,direction));return {items:out,control:{status:'continue'}};}
    case 'filter': case 'filter_array': {const key=String(config.key||'');const op=config.operator||'equals';const expected=config.value;const out=items.filter(item=>{const actual=pathGet(item,key);if(op==='equals')return actual===expected;if(op==='not_equals')return actual!==expected;if(op==='contains')return Array.isArray(actual)?actual.includes(expected):typeof actual==='string'&&actual.includes(String(expected));if(op==='exists')return actual!==undefined&&actual!==null;return false;});return {items:clone(out),control:{status:'continue'}};}
    case 'edit_fields': {const mapping=validateDataMapping({mapping:config.mapping});const out=items.map(item=>applyDataMapping({mapping,context:{...context,input:item}}));return {items:out,control:{status:'continue'}};}
    case 'condition': case 'if': {const key=String(config.key||'');const actual=pathGet(items[0]||{},key);const pass=config.operator==='exists'?actual!=null:config.operator==='contains'?(Array.isArray(actual)?actual.includes(config.value):String(actual??'').includes(String(config.value??''))):actual===config.value;return {items:clone(items),control:{status:'branch',branch:pass?'true':'false'}};}
    case 'switch': {const key=String(config.key||'');const actual=pathGet(items[0]||{},key);const match=(config.cases||[]).find(c=>c?.value===actual);return {items:clone(items),control:{status:'branch',branch:match?.branch||config.defaultBranch||'default'}};}
    case 'wait': case 'delay': {const waitMs=int(config.waitMs??config.delayMs??1000,'waitMs',1000,30*24*60*60_000);return {items:clone(items),control:{status:'waiting',resumeAt:new Date(Number(now)+waitMs).toISOString(),waitMs}};}
    case 'stop_and_error': {const errorCode=String(config.errorCode||'workflow.stopped');if(!/^[a-z][a-z0-9_.-]{2,79}$/.test(errorCode))throw new TypeError('invalid errorCode');return {items:[],control:{status:'failed',errorCode,retryable:config.retryable===true}};}
    case 'error_trigger': {const errorRef=ref(config.errorRef||context.errorRef,'errorRef');return {items:[{errorRef}],control:{status:'continue'}};}
    case 'execution_data': {const key=String(config.key||'value');return {items:items.map(item=>({...item,executionData:{[key]:config.value??null}})),control:{status:'continue'}};}
    default: throw new Error('N8N node runtime does not execute connector/AI side effects: '+type);
  }
}

export function createNodeExecutionEnvelope({tenantId,workflowId,executionId,nodeId,nodeType,inputCount,outputCount,control,now=Date.now()}={}){
  ref(tenantId,'tenantId');ref(workflowId,'workflowId');ref(executionId,'executionId');ref(nodeId,'nodeId');
  int(inputCount,'inputCount',0,MAX_ITEMS);int(outputCount,'outputCount',0,MAX_ITEMS);
  const safeControl=control&&typeof control==='object'?Object.fromEntries(['status','branch','resumeAt','waitMs','errorCode','retryable','totalItems','maxIterations'].filter(k=>k in control).map(k=>[k,control[k]])):{}; return Object.freeze({tenantId,workflowId,executionId,nodeId,nodeType,inputCount,outputCount,control:safeControl,status:safeControl.status||'continue',occurredAt:new Date(now).toISOString(),evidenceHash:sha({tenantId,workflowId,executionId,nodeId,nodeType,inputCount,outputCount,control:safeControl})});
}
