import crypto from 'node:crypto';

const freeze = value => Object.freeze(value);
const canonicalize = value => Array.isArray(value)
  ? value.map(canonicalize)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonicalize(value[k])]))
    : value;
const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
const id = (value, field='id') => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,180}$/.test(value.trim())) throw new Error(field+' invalid');
  return value.trim();
};
const boundedText = (value, field, max=240) => {
  if (typeof value !== 'string' || !value.trim() || value.length>max) throw new Error(field+' invalid');
  return value.trim();
};
const object = (value, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(field+' invalid');
  return value;
};

export const PRODUCT_RESOURCE_TYPES = Object.freeze([
  'contact','company','business','opportunity','ticket','task','note','custom_object',
  'form','survey','quiz','funnel','site','page','blog','email_campaign','sms_campaign','social_campaign',
  'ad_campaign','calendar','service','review_program','course','membership','community','affiliate_program',
  'product','price','order','invoice','subscription','payment','refund','gift_card','loyalty_program',
  'saas_plan','snapshot','marketplace_package','agency_project','workflow','connector','agent','knowledge_base',
  'dashboard','report','template'
]);

const SENSITIVE_TYPES = new Set(['payment','refund','subscription','invoice','connector','agent','marketplace_package','saas_plan']);

export function defineProductResource({
  tenantId,type,resourceId,name,version=1,status='draft',config={},capabilities=[],dependencies=[],sensitivity='normal'
}={}) {
  tenantId=id(tenantId,'tenantId');
  type=id(type,'type');
  if (!PRODUCT_RESOURCE_TYPES.includes(type)) throw new Error('Unsupported resource type');
  resourceId=id(resourceId,'resourceId'); name=boundedText(name,'name');
  if (!Number.isSafeInteger(version)||version<1) throw new Error('version invalid');
  if (!['draft','review','approved','published','paused','archived'].includes(status)) throw new Error('status invalid');
  if (!['normal','sensitive','critical'].includes(sensitivity)) throw new Error('sensitivity invalid');
  object(config,'config');
  if (JSON.stringify(config).match(/(secret|token|password|private.?key|card.?number|cvv)/i)) throw new Error('Raw secret/payment credential in resource config');
  const body={
    tenantId,type,resourceId,name,version,status,
    config:JSON.parse(JSON.stringify(config)),
    capabilities:[...new Set(capabilities.map(x=>boundedText(x,'capability',120)))].sort(),
    dependencies:[...new Set(dependencies.map(x=>id(x,'dependency')))].sort(),
    sensitivity:SENSITIVE_TYPES.has(type)?'critical':sensitivity
  };
  return freeze({...body,checksum:sha256(body)});
}

export function verifyProductResource(resource,{tenantId=null}={}) {
  if (!resource || resource.checksum!==sha256({...resource,checksum:undefined})) throw new Error('Resource checksum invalid');
  if (tenantId!==null && resource.tenantId!==tenantId) throw new Error('Resource tenant mismatch');
  return freeze({...resource});
}

export function planProductResourcePublish({
  resource,actorRole,approvals={},verifiedDependencies=[],policy={}
}={}) {
  verifyProductResource(resource);
  const allowedRoles=new Set(['owner','admin','platform_release_manager']);
  if (!allowedRoles.has(actorRole)) return {allowed:false,code:'PUBLISH_ROLE_DENIED'};
  const critical=resource.sensitivity==='critical';
  if (critical && approvals.stepUp!==true) return {allowed:false,code:'STEP_UP_REQUIRED'};
  if (critical && approvals.secondApprover!==true) return {allowed:false,code:'DUAL_APPROVAL_REQUIRED'};
  const missing=resource.dependencies.filter(dep=>!verifiedDependencies.includes(dep));
  if (missing.length) return {allowed:false,code:'DEPENDENCIES_UNVERIFIED',missingDependencies:missing};
  if (resource.type==='site' && policy.domainVerified!==true) return {allowed:false,code:'DOMAIN_NOT_VERIFIED'};
  if (resource.type==='connector' && policy.webhookVerified===false) return {allowed:false,code:'WEBHOOK_NOT_VERIFIED'};
  if (resource.type==='social_campaign' && policy.providerPublishGrant!==true) return {allowed:false,code:'SOCIAL_PUBLISH_GRANT_REQUIRED'};
  if (resource.type==='ad_campaign' && policy.spendApproval!==true) return {allowed:false,code:'AD_SPEND_APPROVAL_REQUIRED'};
  if (resource.type==='payment' && policy.paymentProviderReady!==true) return {allowed:false,code:'PAYMENT_PROVIDER_NOT_READY'};
  return freeze({
    allowed:true,
    actionId:'publish_'+sha256({resource:resource.checksum,actorRole,approvals,verifiedDependencies,policy}).slice(0,28),
    tenantId:resource.tenantId,
    resourceId:resource.resourceId,
    resourceChecksum:resource.checksum,
    immutableVersion:resource.version
  });
}

export function planResourceAction({
  resource,action,actor={role:'member',permissions:[],secretScopes:[]},risk='normal',approval=null,secretScope=null
}={}) {
  verifyProductResource(resource);
  if (action==='access_secret') {
    if (!secretScope || !actor.secretScopes?.includes(secretScope)) return {allowed:false,code:'SECRET_SCOPE_DENIED'};
    return {allowed:true,code:'ALLOWED'};
  }
  if (risk==='critical' && actor.role!=='owner' && actor.role!=='admin') return {allowed:false,code:'CRITICAL_ROLE_DENIED'};
  if (risk==='critical' && approval?.status!=='approved') return {allowed:false,code:'APPROVAL_REQUIRED'};
  if (!actor.permissions?.includes(action) && !['read','view','comment'].includes(action)) return {allowed:false,code:'PERMISSION_DENIED'};
  return {allowed:true,code:'ALLOWED'};
}

export function createFeatureBundle({
  tenantId,bundleId,name,resources=[],declaredCapabilities=[],version='1.0.0'
}={}) {
  tenantId=id(tenantId,'tenantId'); bundleId=id(bundleId,'bundleId'); name=boundedText(name,'name');
  if (!Array.isArray(resources)||resources.length>500) throw new Error('resources invalid');
  const verified=resources.map(r=>verifyProductResource(r,{tenantId}));
  const caps=[...new Set(declaredCapabilities.map(x=>boundedText(x,'capability',120)))].sort();
  const body={
    tenantId,bundleId,name,version,
    declaredCapabilities:caps,
    resourceRefs:verified.map(r=>({type:r.type,resourceId:r.resourceId,version:r.version,checksum:r.checksum})).sort((a,b)=>(a.type+a.resourceId).localeCompare(b.type+b.resourceId))
  };
  return freeze({...body,checksum:sha256(body)});
}

export function inspectFeatureBundle(bundle,{requiredCapabilities=[]}={}) {
  if (!bundle || bundle.checksum!==sha256({...bundle,checksum:undefined})) throw new Error('Bundle checksum invalid');
  const missing=requiredCapabilities.filter(x=>!bundle.declaredCapabilities.includes(x));
  return {
    tenantId:bundle.tenantId,bundleId:bundle.bundleId,version:bundle.version,
    valid:missing.length===0,missingCapabilities:missing,resourceCount:bundle.resourceRefs.length,checksum:bundle.checksum
  };
}
