import crypto from 'node:crypto';

const ID=/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;
const PROPERTY=/^[a-z][a-z0-9_]{1,63}$/;
const TYPES=new Set(['string','number','boolean','date','datetime','email','phone','url','enum','json','reference']);
const OPS=new Set(['equals','not_equals','contains','starts_with','ends_with','gt','gte','lt','lte','exists','in','not_in','between']);
const ATTRIBUTION=new Set(['first_touch','last_touch','linear','position_based','time_decay']);
const CHANNELS=new Set(['email','sms','whatsapp','voice','web','social','paid_ads','organic_search','referral','direct','offline']);

function assertId(v,l='id'){if(typeof v!=='string'||!ID.test(v))throw Object.assign(new TypeError(l+' invalid'),{code:'invalid_id'});return v;}
function assertRef(v,l='reference'){if(typeof v!=='string'||!REF.test(v))throw Object.assign(new TypeError(l+' invalid'),{code:'invalid_reference'});return v;}
function assertTenant(v){return assertRef(v,'tenantId');}
function boundedArray(v,l,max){if(!Array.isArray(v)||v.length>max)throw new RangeError(l+' must contain 0-'+max+' items');return v;}
function canonical(v){return JSON.stringify(v,(k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(key=>[key,x[key]])):x);}
function hash(v){return crypto.createHash('sha256').update(canonical(v)).digest('hex');}
function clone(v){return structuredClone(v);}

export function defineObjectSchema({tenantId,key,label,version=1,properties=[],primaryKey='id',associations=[],uniqueFields=[],displayField=null}={}){
  assertTenant(tenantId);assertId(key,'object key');if(typeof label!=='string'||label.length<2||label.length>100)throw new TypeError('label invalid');
  if(!Number.isSafeInteger(version)||version<1||version>100000)throw new RangeError('version invalid');
  boundedArray(properties,'properties',200);boundedArray(associations,'associations',200);boundedArray(uniqueFields,'uniqueFields',50);
  const props=properties.map(p=>{
    if(!p||typeof p!=='object')throw new TypeError('property must be object');assertId(p.key,'property.key');
    if(!TYPES.has(p.type))throw new TypeError('unsupported property type');
    if(p.required!==undefined&&typeof p.required!=='boolean')throw new TypeError('required must be boolean');
    if(p.enumValues!==undefined){boundedArray(p.enumValues,'enumValues',500);if(!p.enumValues.every(v=>typeof v==='string'&&v.length<=200))throw new TypeError('invalid enumValues');}
    return Object.freeze({key:p.key,type:p.type,required:Boolean(p.required),label:String(p.label||p.key),enumValues:p.enumValues?[...p.enumValues]:null});
  });
  const keys=new Set(props.map(p=>p.key));for(const u of uniqueFields)if(!keys.has(u)||!PROPERTY.test(u))throw new TypeError('unique field must reference a declared property');
  if(!keys.has(primaryKey))throw new TypeError('primaryKey must reference a declared property');
  if(displayField!==null&&!keys.has(displayField))throw new TypeError('displayField must reference a declared property');
  return Object.freeze({tenantId,key,label,version,primaryKey,displayField,properties:props,associations:clone(associations),uniqueFields:[...uniqueFields],schemaHash:hash({key,label,version,primaryKey,displayField,properties:props,associations,uniqueFields})});
}

export function validateRecord({schema,record,partial=false}={}){
  if(!schema||typeof schema!=='object')throw new TypeError('schema required');
  if(!record||typeof record!=='object'||Array.isArray(record))throw new TypeError('record must be an object');
  const errors=[];
  for(const p of schema.properties){
    const present=Object.prototype.hasOwnProperty.call(record,p.key);
    if(!partial&&p.required&&!present)errors.push({field:p.key,code:'required'});
    if(!present)continue;
    const v=record[p.key];
    if(v===null)continue;
    const ok=p.type==='json'||p.type==='reference'||p.type==='date'||p.type==='datetime'||p.type==='email'||p.type==='phone'||p.type==='url'||p.type==='enum'
      ? true
      : p.type==='string'?typeof v==='string'
      : p.type==='number'?typeof v==='number'&&Number.isFinite(v)
      : p.type==='boolean'?typeof v==='boolean'
      : false;
    if(!ok)errors.push({field:p.key,code:'type'});
    if(p.type==='enum'&&p.enumValues&&!p.enumValues.includes(v))errors.push({field:p.key,code:'enum'});
    if(p.type==='string'&&typeof v==='string'&&v.length>10000)errors.push({field:p.key,code:'max_length'});
  }
  const allowed=new Set(schema.properties.map(p=>p.key));
  for(const key of Object.keys(record))if(!allowed.has(key))errors.push({field:key,code:'unknown_field'});
  return {valid:errors.length===0,errors};
}

export function upsertRecord({schema,existing=null,incoming,mergeMode='incoming_wins',version=1}={}){
  const validation=validateRecord({schema,record:incoming});if(!validation.valid)throw Object.assign(new Error('record validation failed'),{code:'record_invalid',errors:validation.errors});
  if(!Number.isSafeInteger(version)||version<1)throw new RangeError('version invalid');
  const base=existing?clone(existing):{};let merged=clone(base);
  if(mergeMode==='incoming_wins')merged={...base,...incoming};
  else if(mergeMode==='existing_wins')merged={...incoming,...base};
  else throw new TypeError('unsupported mergeMode');
  const outValidation=validateRecord({schema,record:merged});if(!outValidation.valid)throw Object.assign(new Error('merged record invalid'),{code:'merged_record_invalid',errors:outValidation.errors});
  return Object.freeze({record:merged,created:!existing,version,recordHash:hash(merged)});
}

function normalizeEmail(v){return typeof v==='string'?v.trim().toLowerCase():null;}
function normalizePhone(v){return typeof v==='string'?v.replace(/[^0-9+]/g,''):null;}
function normalizeText(v){return typeof v==='string'?v.trim().toLowerCase().replace(/\s+/g,' '):null;}

export function dedupeKey({email=null,phone=null,firstName=null,lastName=null,company=null,domain=null}={}){
  const e=normalizeEmail(email),p=normalizePhone(phone),n=[normalizeText(firstName),normalizeText(lastName)].filter(Boolean).join('|')||null,c=normalizeText(company),d=normalizeText(domain);
  return Object.freeze({email:e,phone:p,name:n,company:c,domain:d,hash:hash({email:e,phone:p,name:n,company:c,domain:d})});
}

export function findDedupeCandidates({records=[],candidate,limit=20}={}){
  boundedArray(records,'records',100000);if(!candidate||typeof candidate!=='object')throw new TypeError('candidate required');
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new RangeError('limit invalid');
  const key=dedupeKey(candidate);
  const scored=records.map((record)=>{
    const rk=dedupeKey(record);let score=0;const reasons=[];
    if(key.email&&rk.email&&key.email===rk.email){score+=0.8;reasons.push('email');}
    if(key.phone&&rk.phone&&key.phone===rk.phone){score+=0.8;reasons.push('phone');}
    if(key.name&&rk.name&&key.name===rk.name){score+=0.3;reasons.push('name');}
    if(key.company&&rk.company&&key.company===rk.company){score+=0.2;reasons.push('company');}
    if(key.domain&&rk.domain&&key.domain===rk.domain){score+=0.2;reasons.push('domain');}
    return {recordId:record.id??null,score:Math.min(1,score),reasons};
  }).filter(x=>x.score>=0.6).sort((a,b)=>b.score-a.score).slice(0,limit);
  return scored;
}

export function createMergePlan({tenantId,targetId,sourceIds,fieldPrecedence={}}={}){
  assertTenant(tenantId);assertRef(targetId,'targetId');boundedArray(sourceIds,'sourceIds',100);
  if(sourceIds.length===0||sourceIds.includes(targetId)||new Set(sourceIds).size!==sourceIds.length)throw new TypeError('invalid merge source set');
  return Object.freeze({tenantId,targetId,sourceIds:[...sourceIds],fieldPrecedence:clone(fieldPrecedence),planHash:hash({tenantId,targetId,sourceIds,fieldPrecedence})});
}

export function createSegmentDefinition({tenantId,id,name,logic='and',conditions=[],version=1}={}){
  assertTenant(tenantId);assertId(id,'segmentId');if(typeof name!=='string'||name.length<2||name.length>120)throw new TypeError('name invalid');
  if(!['and','or'].includes(logic))throw new TypeError('logic invalid');boundedArray(conditions,'conditions',100);
  const normalized=conditions.map(c=>{
    if(!c||typeof c!=='object')throw new TypeError('condition invalid');
    assertId(c.field,'condition.field');if(!OPS.has(c.operator))throw new TypeError('unsupported operator');
    return Object.freeze({field:c.field,operator:c.operator,value:clone(c.value)});
  });
  return Object.freeze({tenantId,id,name,logic,conditions:normalized,version,definitionHash:hash({id,name,logic,conditions:normalized,version})});
}

function evalCondition(record,c){
  const v=record?.[c.field],x=c.value;
  switch(c.operator){
    case 'equals':return v===x;case 'not_equals':return v!==x;case 'contains':return Array.isArray(v)?v.includes(x):typeof v==='string'&&v.includes(String(x));
    case 'starts_with':return typeof v==='string'&&v.startsWith(String(x));case 'ends_with':return typeof v==='string'&&v.endsWith(String(x));
    case 'gt':return typeof v==='number'&&v>x;case 'gte':return typeof v==='number'&&v>=x;case 'lt':return typeof v==='number'&&v<x;case 'lte':return typeof v==='number'&&v<=x;
    case 'exists':return v!==undefined&&v!==null;case 'in':return Array.isArray(x)&&x.includes(v);case 'not_in':return Array.isArray(x)&&!x.includes(v);
    case 'between':return Array.isArray(x)&&x.length===2&&v>=x[0]&&v<=x[1];default:return false;
  }
}

export function evaluateSegment({segment,records=[]}={}){
  if(!segment||typeof segment!=='object')throw new TypeError('segment required');boundedArray(records,'records',100000);
  const evaluate=r=>segment.logic==='and'?segment.conditions.every(c=>evalCondition(r,c)):segment.conditions.some(c=>evalCondition(r,c));
  return records.filter(evaluate).map(r=>r.id??null);
}

export function createActivityEvent({tenantId,recordType,recordId,type,occurredAt=new Date().toISOString(),actorRef=null,sourceRef=null,metadata={}}={}){
  assertTenant(tenantId);assertId(recordType,'recordType');assertRef(recordId,'recordId');assertId(type,'eventType');
  if(actorRef!==null)assertRef(actorRef,'actorRef');if(sourceRef!==null)assertRef(sourceRef,'sourceRef');
  const safe=clone(metadata);if(Object.keys(safe).length>30)throw new RangeError('metadata too large');
  return Object.freeze({tenantId,recordType,recordId,type,occurredAt:new Date(occurredAt).toISOString(),actorRef,sourceRef,metadata:safe,evidenceHash:hash({tenantId,recordType,recordId,type,occurredAt,actorRef,sourceRef,metadata:safe})});
}

export function createAttributionTouch({tenantId,journeyId,touchId,channel,campaignId=null,occurredAt,weight=null,metadata={}}={}){
  assertTenant(tenantId);assertRef(journeyId,'journeyId');assertRef(touchId,'touchId');if(!CHANNELS.has(channel))throw new TypeError('unsupported channel');
  if(campaignId!==null)assertRef(campaignId,'campaignId');if(weight!==null&&(!Number.isFinite(weight)||weight<0||weight>1))throw new RangeError('weight invalid');
  return Object.freeze({tenantId,journeyId,touchId,channel,campaignId,occurredAt:new Date(occurredAt??Date.now()).toISOString(),weight,metadata:clone(metadata)});
}

export function attributeJourney({model='last_touch',touches=[]}={}){
  if(!ATTRIBUTION.has(model))throw new TypeError('unsupported attribution model');boundedArray(touches,'touches',1000);if(touches.length===0)return [];
  const ordered=[...touches].sort((a,b)=>new Date(a.occurredAt)-new Date(b.occurredAt));
  const n=ordered.length;
  const weights=ordered.map((_,i)=>{
    if(model==='first_touch')return i===0?1:0;
    if(model==='last_touch')return i===n-1?1:0;
    if(model==='linear')return 1/n;
    if(model==='position_based')return n===1?1:i===0||i===n-1?0.4:(n<=2?0:0.2/(n-2));
    const age=n-1-i;return Math.pow(0.5,age);
  });
  const sum=weights.reduce((a,b)=>a+b,0)||1;
  return ordered.map((t,i)=>({...clone(t),weight:weights[i]/sum}));
}

export function createScoreModel({tenantId,id,name,version=1,weights=[],defaultScore=0}={}){
  assertTenant(tenantId);assertId(id,'scoreModelId');if(typeof name!=='string'||name.length<2||name.length>120)throw new TypeError('name invalid');boundedArray(weights,'weights',100);
  const rules=weights.map(w=>{assertId(w.field,'weight.field');if(typeof w.weight!=='number'||!Number.isFinite(w.weight)||w.weight<0||w.weight>100)throw new RangeError('weight invalid');return {field:w.field,operator:w.operator||'equals',value:clone(w.value),weight:w.weight};});
  return Object.freeze({tenantId,id,name,version,defaultScore,weights:rules,modelHash:hash({id,name,version,defaultScore,weights:rules})});
}

export function scoreRecord({model,record}={}){
  if(!model||!record)throw new TypeError('model and record required');let score=Number(model.defaultScore)||0;
  for(const r of model.weights)if(evalCondition(record,{field:r.field,operator:r.operator,value:r.value}))score+=r.weight;
  return Math.max(0,Math.min(100,Math.round(score)));
}

export function createCampaignDefinition({tenantId,id,name,channel,audienceSegmentId,templateRef,schedule=null,suppressionPolicy='global',version=1}={}){
  assertTenant(tenantId);assertId(id,'campaignId');if(typeof name!=='string'||name.length<2||name.length>120)throw new TypeError('name invalid');
  if(!['email','sms','whatsapp'].includes(channel))throw new TypeError('campaign channel unsupported');assertRef(audienceSegmentId,'audienceSegmentId');assertRef(templateRef,'templateRef');
  if(schedule!==null&&(!schedule.timezone||!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime)))throw new TypeError('schedule must be timezone + localTime');
  return Object.freeze({tenantId,id,name,channel,audienceSegmentId,templateRef,schedule:clone(schedule),suppressionPolicy,version,campaignHash:hash({tenantId,id,name,channel,audienceSegmentId,templateRef,schedule,suppressionPolicy,version})});
}

export function createImportPlan({tenantId,importId,schema,rows=[],mode='upsert',dryRun=true}={}){
  assertTenant(tenantId);assertRef(importId,'importId');if(!schema)throw new TypeError('schema required');boundedArray(rows,'rows',100000);if(!['insert','upsert'].includes(mode))throw new TypeError('unsupported import mode');
  const results=rows.map((row,i)=>({row:i+1,...validateRecord({schema,record:row})}));
  const invalid=results.filter(x=>!x.valid).length;
  return Object.freeze({tenantId,importId,rowCount:rows.length,invalidRows:invalid,validRows:rows.length-invalid,mode,dryRun,planHash:hash({tenantId,importId,rowCount:rows.length,invalid,mode,dryRun})});
}

export function createDataQualityReport({tenantId,records=[],requiredFields=[],uniqueFields=[]}={}){
  assertTenant(tenantId);boundedArray(records,'records',100000);boundedArray(requiredFields,'requiredFields',100);boundedArray(uniqueFields,'uniqueFields',100);
  const missing=requiredFields.flatMap(f=>records.filter(r=>r?.[f]===undefined||r?.[f]===null||r?.[f]==='').map(r=>r.id??null));
  const duplicates=uniqueFields.map(field=>{
    const groups=new Map();for(const r of records){const v=r?.[field];if(v===undefined||v===null)continue;const k=typeof v==='string'?v.trim().toLowerCase():JSON.stringify(v);const arr=groups.get(k)||[];arr.push(r.id??null);groups.set(k,arr);}
    return {field,groups:[...groups.entries()].filter(([,ids])=>ids.length>1).map(([value,ids])=>({value,ids}))};
  });
  return Object.freeze({tenantId,recordCount:records.length,missingRequiredIds:[...new Set(missing)],duplicateGroups:duplicates,qualityHash:hash({tenantId,recordCount:records.length,missing,duplicates})});
}

export const CUSTOMER_LIFECYCLE_CAPABILITIES=Object.freeze([
 'crm.custom_objects','crm.associations','crm.duplicate_detection','crm.merge','crm.bulk_import_export','crm.data_quality','crm.timeline',
 'crm.saved_segments','crm.lead_scoring','crm.predictive_scoring','crm.buyer_intent','crm.buying_committee',
 'marketing.campaigns','marketing.sequences','marketing.segmentation','marketing.attribution','marketing.utm','marketing.conversion_tracking',
 'marketing.social_publishing','marketing.reputation','marketing.ads','marketing.forms_surveys','learning.courses_memberships_community'
]);
