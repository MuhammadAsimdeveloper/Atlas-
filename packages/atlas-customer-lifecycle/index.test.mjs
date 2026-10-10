import test from 'node:test';
import assert from 'node:assert/strict';
import {
 defineObjectSchema,validateRecord,upsertRecord,dedupeKey,findDedupeCandidates,createMergePlan,
 createSegmentDefinition,evaluateSegment,createActivityEvent,createAttributionTouch,attributeJourney,
 createScoreModel,scoreRecord,createCampaignDefinition,createImportPlan,createDataQualityReport,createCsvExportPlan,CUSTOMER_LIFECYCLE_CAPABILITIES
} from './index.mjs';

const schema=defineObjectSchema({
 tenantId:'tenant_1',key:'vehicle',label:'Vehicle',primaryKey:'id',displayField:'name',uniqueFields:['vin'],
 properties:[
  {key:'id',type:'string',required:true},{key:'name',type:'string',required:true},{key:'vin',type:'string',required:true},
  {key:'price',type:'number'},{key:'active',type:'boolean'},{key:'segment',type:'enum',enumValues:['vip','standard']}
 ]
});

test('object schema and server-side record validation are deterministic',()=>{
 assert.equal(schema.tenantId,'tenant_1');assert.match(schema.schemaHash,/^[a-f0-9]{64}$/);
 assert.equal(validateRecord({schema,record:{id:'v1',name:'Truck',vin:'VIN1'}}).valid,true);
 assert.equal(validateRecord({schema,record:{id:'v1',name:'Truck'}}).valid,false);
 assert.equal(validateRecord({schema,record:{id:'v1',name:'Truck',vin:'VIN1',secret:'x'}}).valid,false);
});

test('upsert supports explicit conflict policy and immutable record hash',()=>{
 const out=upsertRecord({schema,existing:{id:'v1',name:'Old',vin:'VIN1'},incoming:{id:'v1',name:'New',vin:'VIN1',price:12}});
 assert.equal(out.record.name,'New');assert.match(out.recordHash,/^[a-f0-9]{64}$/);
});

test('dedupe requires strong identity signals before proposing candidates',()=>{
 const a=dedupeKey({email:' USER@Example.COM ',phone:'+92 (300) 123-4567',firstName:'A',lastName:'Person'});
 assert.equal(a.email,'user@example.com');assert.equal(a.phone,'+923001234567');
 const c=findDedupeCandidates({candidate:{email:'user@example.com'},records:[{id:'1',email:'user@example.com'},{id:'2',email:'other@example.com'}]});
 assert.deepEqual(c[0].reasons,['email']);assert.equal(c[0].score,0.8);
});

test('merge is an auditable tenant-bound plan',()=>{
 const p=createMergePlan({tenantId:'tenant_1',targetId:'1',sourceIds:['2','3'],fieldPrecedence:{email:'target'}});
 assert.match(p.planHash,/^[a-f0-9]{64}$/);assert.throws(()=>createMergePlan({tenantId:'tenant_1',targetId:'1',sourceIds:['1']}),/source/);
});

test('segments use a closed operator set, never dynamic evaluation',()=>{
 const s=createSegmentDefinition({tenantId:'tenant_1',id:'vip-leads',name:'VIP Leads',conditions:[{field:'score',operator:'gte',value:80},{field:'status',operator:'equals',value:'open'}]});
 assert.deepEqual(evaluateSegment({segment:s,records:[{id:'1',score:90,status:'open'},{id:'2',score:50,status:'open'}]}),['1']);
});

test('timeline events are bounded, tenant-bound, and hashed',()=>{
 const e=createActivityEvent({tenantId:'tenant_1',recordType:'contact',recordId:'c1',type:'email.sent',actorRef:'user_1',metadata:{source:'campaign'}});
 assert.equal(e.tenantId,'tenant_1');assert.match(e.evidenceHash,/^[a-f0-9]{64}$/);
});

test('attribution models normalize to 1.0',()=>{
 const touches=['organic_search','paid_ads','email'].map((channel,i)=>createAttributionTouch({tenantId:'tenant_1',journeyId:'j1',touchId:'t'+i,channel,occurredAt:Date.UTC(2026,0,i)}));
 for(const model of ['first_touch','last_touch','linear','position_based','time_decay']){
   const out=attributeJourney({model,touches});assert.ok(Math.abs(out.reduce((s,x)=>s+x.weight,0)-1)<1e-9);
 }
});

test('scoring and campaigns remain declarative',()=>{
 const model=createScoreModel({tenantId:'tenant_1',id:'lead-score',name:'Lead Score',weights:[{field:'emailVerified',operator:'equals',value:true,weight:30},{field:'employees',operator:'gte',value:50,weight:40}]});
 assert.equal(scoreRecord({model,record:{emailVerified:true,employees:60}}),70);
 const campaign=createCampaignDefinition({tenantId:'tenant_1',id:'welcome',name:'Welcome',channel:'email',audienceSegmentId:'seg_1',templateRef:'tpl_1',schedule:{timezone:'UTC',localTime:'09:00'}});
 assert.equal(campaign.channel,'email');assert.match(campaign.campaignHash,/^[a-f0-9]{64}$/);
});

test('import plans are dry-run first and data quality detects duplicates',()=>{
 const p=createImportPlan({tenantId:'tenant_1',importId:'imp_1',schema,rows:[{id:'1',name:'A',vin:'x'},{id:'2',name:'B'}],dryRun:true});
 assert.equal(p.invalidRows,1);assert.equal(p.dryRun,true);
 const q=createDataQualityReport({tenantId:'tenant_1',records:[{id:'1',email:'A@x.com'},{id:'2',email:'a@x.com'}],uniqueFields:['email']});
 assert.equal(q.duplicateGroups[0].groups.length,1);
});

test('requested Phase 2 capability surface is represented',()=>assert.ok(CUSTOMER_LIFECYCLE_CAPABILITIES.length>=20));


test('CSV export is schema-bound, deterministic, and resists spreadsheet formula injection',()=>{
 const exportPlan=createCsvExportPlan({
  tenantId:'tenant_1',exportId:'export_1',schema,
  fields:['id','name','vin'],records:[
   {id:'v1',name:'=HYPERLINK("https://evil.example")',vin:'VIN-1'},
   {id:'v2',name:'Truck, "Blue"',vin:'VIN-2'}
  ]
 });
 assert.equal(exportPlan.rowCount,2);
 assert.equal(exportPlan.contentType,'text/csv; charset=utf-8');
 assert.match(exportPlan.csv,/'=HYPERLINK/);
 assert.match(exportPlan.csv,/"Truck, ""Blue"""/);
 assert.match(exportPlan.artifactHash,/^[a-f0-9]{64}$/);
 assert.throws(()=>createCsvExportPlan({tenantId:'tenant_2',exportId:'export_1',schema,records:[]}),{code:'tenant_mismatch'});
 assert.throws(()=>createCsvExportPlan({tenantId:'tenant_1',exportId:'export_1',schema,fields:['secret'],records:[]}),{code:'export_fields_invalid'});
 assert.throws(()=>createCsvExportPlan({tenantId:'tenant_1',exportId:'export_1',schema,records:[{id:'v1',name:'bad'}]}),{code:'export_record_invalid'});
});
