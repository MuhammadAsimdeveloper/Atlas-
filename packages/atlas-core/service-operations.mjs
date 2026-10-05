const ID=/^[0-9a-f-]{8,120}$/i;
const STATUSES=new Set(['draft','requested','scheduled','in_progress','completed','canceled']);
const money=v=>Number.isInteger(v)&&v>=0?v:0;
export function validateServiceRequest(input={}){
 if(typeof input.title!=='string'||input.title.trim().length<2||input.title.length>200)throw new Error('service_request_title_invalid');
 if(input.customerId&&!ID.test(input.customerId))throw new Error('customer_id_invalid');
 return Object.freeze({title:input.title.trim(),description:typeof input.description==='string'?input.description.trim():'',customerId:input.customerId||null,priority:['low','normal','high','urgent'].includes(input.priority)?input.priority:'normal',status:'requested'});
}
export function validateVisit(input={}){
 if(!ID.test(input.jobId||''))throw new Error('job_id_invalid');
 if(!input.startsAt||Number.isNaN(Date.parse(input.startsAt)))throw new Error('visit_start_invalid');
 if(input.endsAt&&Number.isNaN(Date.parse(input.endsAt)))throw new Error('visit_end_invalid');
 if(input.endsAt&&Date.parse(input.endsAt)<=Date.parse(input.startsAt))throw new Error('visit_window_invalid');
 return Object.freeze({jobId:input.jobId,startsAt:new Date(input.startsAt).toISOString(),endsAt:input.endsAt?new Date(input.endsAt).toISOString():null,assigneeId:input.assigneeId||null,crewId:input.crewId||null,routeOrder:Number.isInteger(input.routeOrder)&&input.routeOrder>=0?input.routeOrder:null});
}
export function validateQuote(input={}){
 if(typeof input.title!=='string'||!input.title.trim())throw new Error('quote_title_invalid');
 const items=(Array.isArray(input.items)?input.items:[]).map(item=>({name:String(item.name||'').trim(),quantity:Number(item.quantity)||0,unitPriceMinor:money(item.unitPriceMinor)}));
 if(!items.length||items.some(x=>!x.name||x.quantity<=0))throw new Error('quote_items_invalid');
 const subtotal=items.reduce((n,x)=>n+Math.round(x.quantity*x.unitPriceMinor),0);
 return Object.freeze({title:input.title.trim(),items,subtotalMinor:subtotal,currency:typeof input.currency==='string'?input.currency.toUpperCase():'USD',status:'draft'});
}
export function validateInvoice(input={}){
 if(!Array.isArray(input.items)||!input.items.length)throw new Error('invoice_items_invalid');
 const items=input.items.map(item=>({name:String(item.name||'').trim(),quantity:Number(item.quantity)||0,unitPriceMinor:money(item.unitPriceMinor)}));
 if(items.some(x=>!x.name||x.quantity<=0))throw new Error('invoice_items_invalid');
 const total=items.reduce((n,x)=>n+Math.round(x.quantity*x.unitPriceMinor),0);
 return Object.freeze({items,totalMinor:total,currency:typeof input.currency==='string'?input.currency.toUpperCase():'USD',status:'draft'});
}
export function transitionJob(current,next){
 if(!STATUSES.has(next))throw new Error('service_status_invalid');
 const allowed={draft:['requested','canceled'],requested:['scheduled','canceled'],scheduled:['in_progress','canceled'],in_progress:['completed','canceled'],completed:[],canceled:[]};
 if(!(allowed[current]||[]).includes(next))throw new Error('service_status_transition_invalid');
 return next;
}
export function buildJobberWebhookEvent(payload){
 const e=payload?.data?.webHookEvent;if(!e?.topic||!e?.accountId||!e?.itemId||!e?.occurredAt)throw new Error('jobber_webhook_invalid');
 return Object.freeze({provider:'jobber',topic:e.topic,accountId:e.accountId,itemId:e.itemId,occurredAt:new Date(e.occurredAt).toISOString()});
}
export function buildZapierHookEvent(payload,{eventType}={}){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('zapier_hook_invalid');
 if(typeof eventType!=='string'||!/^[a-z][a-z0-9_.-]{1,100}$/.test(eventType))throw new Error('event_type_invalid');
 return Object.freeze({provider:'zapier',eventType,payload});
}
