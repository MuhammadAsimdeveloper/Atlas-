import crypto from 'node:crypto';

const freeze=v=>Object.freeze(v);
const canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');
const text=(v,l,m=180)=>{if(typeof v!=='string'||!v.trim()||v.length>m||/[\r\n\u0000]/.test(v))throw new Error(l+' invalid');return v.trim();};

export const PLATFORM_ROLES=Object.freeze(['platform_owner','platform_security','platform_release_manager']);
export const TENANT_ROLES=Object.freeze(['owner','admin','manager','member','viewer','freelancer']);
export const RISK_LEVELS=Object.freeze(['read','low','medium','high','critical']);

export function defineRole({tenantId,roleId,name,scope='tenant',permissions=[],denies=[]}={}){
  tenantId=scope==='platform'?null:text(tenantId,'tenantId'); roleId=text(roleId,'roleId'); name=text(name,'name');
  const allowedRoles=scope==='platform'?PLATFORM_ROLES:TENANT_ROLES;
  if(!allowedRoles.includes(roleId))throw new Error('roleId is not an Atlas role');
  return freeze({tenantId,roleId,name,scope,permissions:[...new Set(permissions.map(x=>text(x,'permission')))].sort(),denies:[...new Set(denies.map(x=>text(x,'deny')))].sort()});
}

export function authorize({actor,tenantId,permission,risk='read',resourceTenantId=null}={}){
  tenantId=text(tenantId,'tenantId'); permission=text(permission,'permission');
  if(!RISK_LEVELS.includes(risk))throw new Error('risk invalid');
  if(!actor||typeof actor.id!=='string'||!Array.isArray(actor.permissions))return {allowed:false,code:'ACTOR_INVALID'};
  if(resourceTenantId!==null&&resourceTenantId!==tenantId)return {allowed:false,code:'RESOURCE_TENANT_MISMATCH'};
  if(actor.scope!=='platform'&&actor.tenantId!==tenantId)return {allowed:false,code:'TENANT_BOUNDARY_VIOLATION'};
  if(actor.denies?.includes(permission))return {allowed:false,code:'EXPLICIT_DENY'};
  if(!actor.permissions.includes(permission)&&permission!=='read')return {allowed:false,code:'PERMISSION_DENIED'};
  if(actor.scope==='platform'&&risk!=='read'&&actor.role!=='platform_security'&&actor.role!=='platform_release_manager')return {allowed:false,code:'PLATFORM_RISK_ROLE_DENIED'};
  return {allowed:true,tenantId,actorId:actor.id,permission,risk};
}

export function createSecretReference({tenantId,secretRef,provider,purpose,version=1,expiresAt=null,rotationPolicy='90d'}={}){
  tenantId=text(tenantId,'tenantId'); secretRef=text(secretRef,'secretRef',300); provider=text(provider,'provider',100);
  const p=text(purpose,'purpose',160); if(!Number.isSafeInteger(version)||version<1)throw new Error('version invalid');
  if(!['30d','60d','90d','180d','manual'].includes(rotationPolicy))throw new Error('rotation policy invalid');
  if(/(secret|token|password|api[_-]?key|private[_-]?key)/i.test(secretRef)&&!secretRef.startsWith('secret://'))throw new Error('secretRef must reference a secret manager URI');
  const body={tenantId,secretRef,provider,purpose:p,version,expiresAt,rotationPolicy};
  return freeze({...body,referenceHash:hash(body)});
}

export function authorizeSecretAccess({reference,actor,scope,stepUp=false}={}){
  if(!reference||reference.referenceHash!==hash({...reference,referenceHash:undefined}))throw new Error('secret reference integrity invalid');
  if(actor?.tenantId!==reference.tenantId&&actor?.scope!=='platform')return {allowed:false,code:'TENANT_BOUNDARY_VIOLATION'};
  if(!actor?.secretScopes?.includes(scope))return {allowed:false,code:'SECRET_SCOPE_DENIED'};
  if(stepUp!==true&&scope.includes('production'))return {allowed:false,code:'STEP_UP_REQUIRED'};
  return {allowed:true,tenantId:reference.tenantId,secretRef:reference.secretRef,version:reference.version};
}

export function createPolicyRule({tenantId,policyId,name,effect='deny',principal='*',action='*',resource='*',conditions={}}={}){
  tenantId=text(tenantId,'tenantId'); policyId=text(policyId,'policyId'); name=text(name,'name');
  if(!['allow','deny'].includes(effect))throw new Error('effect invalid');
  const body={tenantId,policyId,name,effect,principal:text(principal,'principal',180),action:text(action,'action',180),resource:text(resource,'resource',500),conditions:structuredClone(conditions)};
  return freeze({...body,checksum:hash(body)});
}

export function evaluatePolicy({rules=[],actor,action,resource,context={}}={}){
  const candidates=(Array.isArray(rules)?rules:[]).filter(rule=>rule?.checksum===hash({...rule,checksum:undefined})&&
    (rule.principal==='*'||rule.principal===actor?.role||rule.principal===actor?.id) &&
    (rule.action==='*'||rule.action===action) &&
    (rule.resource==='*'||rule.resource===resource));
  const explicitDeny=candidates.some(r=>r.effect==='deny');
  const explicitAllow=candidates.some(r=>r.effect==='allow');
  if(explicitDeny)return {allowed:false,code:'POLICY_DENY',matched:candidates.length};
  if(explicitAllow)return {allowed:true,code:'POLICY_ALLOW',matched:candidates.length};
  return {allowed:false,code:'POLICY_DEFAULT_DENY',matched:candidates.length};
}

export function createAuditEvent({tenantId,actorId,action,resourceType,resourceId,risk='read',decision='allowed',metadata={},previousHash='' }={}){
  tenantId=text(tenantId,'tenantId'); actorId=text(actorId,'actorId'); action=text(action,'action'); resourceType=text(resourceType,'resourceType');
  resourceId=text(resourceId,'resourceId'); if(!RISK_LEVELS.includes(risk))throw new Error('risk invalid');
  if(!['allowed','denied','approved','executed','failed'].includes(decision))throw new Error('decision invalid');
  const body={tenantId,actorId,action,resourceType,resourceId,risk,decision,metadata:structuredClone(metadata),previousHash,timestamp:new Date().toISOString()};
  return freeze({...body,eventId:'audit_'+hash(body).slice(0,28),eventHash:hash(body)});
}

export function verifyAuditChain(events=[]){
  const rows=Array.isArray(events)?events:[]; let previous='';
  for(const event of rows){
    if(event?.eventHash!==hash({...event,eventHash:undefined})||event.previousHash!==previous)return {valid:false,failedEventId:event?.eventId||null};
    previous=event.eventHash;
  }
  return {valid:true,length:rows.length,lastHash:previous};
}

export function createSsoPolicy({tenantId,provider='oidc',issuer,clientId,allowedDomains=[],requiredClaims=['sub','email'],enforceMfa=true}={}){
  tenantId=text(tenantId,'tenantId'); issuer=text(issuer,'issuer',1000); clientId=text(clientId,'clientId',300);
  if(!['oidc','saml','ldap'].includes(provider))throw new Error('SSO provider invalid');
  const body={tenantId,provider,issuer,clientId,allowedDomains:[...new Set(allowedDomains.map(x=>text(x,'domain',253)))].sort(),requiredClaims:[...new Set(requiredClaims.map(x=>text(x,'claim',100)))].sort(),enforceMfa:Boolean(enforceMfa)};
  return freeze({...body,checksum:hash(body)});
}

export function validateSsoAssertion({policy,tenantId,claims={}}={}){
  if(!policy||policy.checksum!==hash({...policy,checksum:undefined}))throw new Error('SSO policy checksum invalid');
  if(policy.tenantId!==tenantId)return {valid:false,code:'TENANT_BOUNDARY_VIOLATION'};
  const missing=policy.requiredClaims.filter(c=>typeof claims[c]!=='string'||!claims[c].trim());
  if(missing.length)return {valid:false,code:'REQUIRED_CLAIMS_MISSING',missing};
  if(policy.allowedDomains.length){
    const email=String(claims.email).toLowerCase(); const domain=email.split('@')[1]||'';
    if(!policy.allowedDomains.includes(domain))return {valid:false,code:'EMAIL_DOMAIN_NOT_ALLOWED'};
  }
  if(policy.enforceMfa&&claims.mfa!==true)return {valid:false,code:'MFA_REQUIRED'};
  return {valid:true,tenantId};
}
