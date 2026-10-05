import { createHash } from 'node:crypto';

export const DEPLOYMENT_CONTROLS=Object.freeze([
 'managed_postgres','redis_ha','kms','waf_cdn','backup_pitr',
 'restore_drill','load_test','disaster_recovery','provider_credentials','public_origin'
]);
const SHA=/^[a-f0-9]{64}$/;
const STATUS=new Set(['unverified','verified','expired']);

function text(v,label,max=240){
 if(typeof v!=='string'||!v.trim()||v.length>max||/[\r\n\u0000]/.test(v))throw new TypeError(label+' is invalid');
 return v.trim();
}
function hash(v){return createHash('sha256').update(v).digest('hex');}

export function validateEvidenceRecord(record,{now=new Date(),maxAgeDays=30}={}){
 if(!record||typeof record!=='object')throw new TypeError('evidence record is invalid');
 const control=text(record.control,'control',80);
 if(!DEPLOYMENT_CONTROLS.includes(control))throw new TypeError('unknown deployment control');
 if(!STATUS.has(record.status))throw new TypeError('evidence status is invalid');
 if(record.status==='verified'&&(!record.verifiedAt||Number.isNaN(Date.parse(record.verifiedAt))))throw new TypeError('verified evidence requires verifiedAt');
 if(record.evidenceSha256!==null&&!SHA.test(record.evidenceSha256||''))throw new TypeError('evidenceSha256 is invalid');
 const verifiedAt=record.verifiedAt?new Date(record.verifiedAt):null;
 const expiresAt=record.expiresAt?new Date(record.expiresAt):new Date((verifiedAt||now).getTime()+maxAgeDays*86400000);
 const expired=record.status==='expired'||expiresAt<=now;
 return Object.freeze({control,status:expired?'expired':record.status,evidenceSha256:record.evidenceSha256||null,verifiedAt:verifiedAt?.toISOString()||null,expiresAt:expiresAt.toISOString()});
}

export function buildEvidenceReport({release,manifest,records,now=new Date()}={}){
 text(release,'release',80);
 if(!manifest||manifest.schema!==1||!Array.isArray(manifest.requiredControls))throw new TypeError('manifest is invalid');
 const recordMap=new Map();
 for(const record of records||[]){const normalized=validateEvidenceRecord(record,{now,maxAgeDays:manifest.evidenceRules?.maxAgeDays||30});recordMap.set(normalized.control,normalized);}
 const rows=manifest.requiredControls.map(control=>recordMap.get(control)||{control,status:'unverified',evidenceSha256:null,verifiedAt:null,expiresAt:null});
 const verified=rows.filter(x=>x.status==='verified');
 const expired=rows.filter(x=>x.status==='expired');
 const manifestSha256=hash(JSON.stringify(manifest));
 const ready=rows.length===manifest.requiredControls.length&&verified.length===rows.length;
 return Object.freeze({schema:1,release,manifestSha256,ready,status:ready?'ready':expired.length?'expired':'incomplete',requiredControls:rows,verifiedControls:verified.length,requiredCount:rows.length,missing:rows.filter(x=>x.status!=='verified').map(x=>x.control),generatedAt:now.toISOString()});
}

export function serializeEvidenceReport(report){return JSON.stringify(report,null,2);}
