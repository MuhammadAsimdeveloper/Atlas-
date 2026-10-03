import crypto from 'node:crypto';

const freeze=value=>Object.freeze(value);
const canon=value=>Array.isArray(value)?value.map(canon):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canon(value[k])])):value;
const sha256=value=>crypto.createHash('sha256').update(JSON.stringify(canon(value))).digest('hex');
const text=(value,label,max=240)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\r\n\u0000]/.test(value))throw new Error(label+' invalid');
  return value.trim();
};
const tenant=value=>text(value,'tenantId',180);
const money=value=>{
  if(!Number.isSafeInteger(value)||value<0)throw new Error('money must be a non-negative integer minor unit');
  return value;
};
const list=(value,label,max=100)=> {
  if(!Array.isArray(value)||value.length>max)throw new Error(label+' invalid');
  return [...new Set(value.map(v=>text(v,label,180)))];
};

export const BUSINESS_RESOURCE_TYPES=Object.freeze([
  'campaign','form','survey','quiz','blog','social_post','review_program','ad_campaign',
  'product','order','subscription','course','lesson','membership_offer','community',
  'affiliate_program','saas_plan','snapshot','marketplace_package','template'
]);

export const BUSINESS_CHANNELS=Object.freeze(['email','sms','mms','whatsapp','messenger','instagram','webchat','voice','facebook','linkedin','tiktok','youtube','pinterest','threads','bluesky']);

export const BUSINESS_RISK=Object.freeze({
  campaign_publish:'high',social_publish:'high',ad_spend:'critical',payment:'critical',refund:'critical',
  entitlement_change:'write',affiliate_payout:'critical',saas_provision:'high',marketplace_publish:'high',
  form_submit:'write',content_edit:'write',read:'read'
});

function resourceBase({tenantId,type,resourceId,name,version=1,status='draft',config={},capabilities=[]}={}){
  tenantId=tenant(tenantId); if(!BUSINESS_RESOURCE_TYPES.includes(type))throw new Error('resource type unsupported');
  resourceId=text(resourceId,'resourceId'); name=text(name,'name');
  if(!Number.isSafeInteger(version)||version<1)throw new Error('version invalid');
  if(!['draft','review','approved','scheduled','published','paused','archived'].includes(status))throw new Error('status invalid');
  if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('config invalid');
  const body={tenantId,type,resourceId,name,version,status,config:structuredClone(config),capabilities:list(capabilities,'capabilities')};
  return freeze({...body,checksum:sha256(body)});
}

export function createCampaign({tenantId,campaignId,name,channel,audienceRef,contentRef,goal='conversion',scheduledAt=null,variants=[],frequencyPolicy=null}={}){
  if(!BUSINESS_CHANNELS.includes(channel))throw new Error('campaign channel unsupported');
  const base=resourceBase({tenantId,type:'campaign',resourceId:campaignId,name,capabilities:['segmentation','scheduling','analytics']});
  if(!text(audienceRef,'audienceRef')||!text(contentRef,'contentRef'))throw new Error('campaign references required');
  if(!['conversion','lead','appointment','retention','awareness'].includes(goal))throw new Error('campaign goal invalid');
  if(!Array.isArray(variants)||variants.length<1||variants.length>20)throw new Error('campaign variants invalid');
  const normalized=variants.map((v,i)=>({id:text(v?.id||('variant_'+(i+1)),'variant id'),contentRef:text(v?.contentRef||contentRef,'variant content'),weight:Number.isFinite(v?.weight)?Math.max(0,Math.min(1,v.weight)):1}));
  const total=normalized.reduce((n,v)=>n+v.weight,0); if(total<=0)throw new Error('campaign weights invalid');
  const body={...base,config:{channel,audienceRef,contentRef,goal,scheduledAt,variants:normalized.map(v=>({...v,weight:v.weight/total})),frequencyPolicy}};
  delete body.checksum; return freeze({...body,checksum:sha256(body)});
}

export function submitForm({tenantId,formId,submissionId,payload={},honeypot='',source='website'}={}){
  tenantId=tenant(tenantId); formId=text(formId,'formId'); submissionId=text(submissionId,'submissionId');
  if(honeypot) return {accepted:false,code:'BOT_REJECTED'};
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length>100)throw new Error('form payload invalid');
  const clean={}; for(const [k,v] of Object.entries(payload)){const key=text(k,'field',100); if(typeof v==='string'&&v.length>10000)throw new Error('field too large'); clean[key]=typeof v==='string'?v.trim():v;}
  const body={tenantId,formId,submissionId,source:text(source,'source',80),payload:clean,receivedAt:new Date().toISOString()};
  return freeze({...body,accepted:true,checksum:sha256(body)});
}

export function planSocialPublish({tenantId,postId,platform,contentRef,providerGrant,scheduledAt=null,mediaRefs=[]}={}){
  tenantId=tenant(tenantId); postId=text(postId,'postId'); contentRef=text(contentRef,'contentRef');
  if(!BUSINESS_CHANNELS.includes(platform))throw new Error('unsupported social platform');
  const body={tenantId,postId,platform,contentRef,scheduledAt,mediaRefs:list(mediaRefs,'mediaRefs',20)};
  if(providerGrant!==true)return {allowed:false,code:'SOCIAL_PUBLISH_GRANT_REQUIRED',body};
  return freeze({allowed:true,risk:BUSINESS_RISK.social_publish,actionId:'social_'+sha256(body).slice(0,28),...body});
}

export function createReviewProgram({tenantId,programId,name,channels=['google'],requestAfter='event',minimumRatingForPublicReply=1,replyPolicy='human_or_ai_draft'}={}){
  tenantId=tenant(tenantId);
  if(!Array.isArray(channels)||!channels.length)throw new Error('review channels required');
  if(!['event','appointment','purchase','manual'].includes(requestAfter))throw new Error('requestAfter invalid');
  if(!Number.isSafeInteger(minimumRatingForPublicReply)||minimumRatingForPublicReply<1||minimumRatingForPublicReply>5)throw new Error('rating threshold invalid');
  return resourceBase({
    tenantId,type:'review_program',resourceId:programId,name,
    config:{channels:list(channels,'channels',20),requestAfter,minimumRatingForPublicReply,replyPolicy},
    capabilities:['review_requests','review_monitoring','sentiment','reply_workflow']
  });
}

export function createAdCampaign({tenantId,campaignId,name,platform,dailyBudgetMinor,lifetimeBudgetMinor=0,approvalStatus='pending',trackingRefs=[]}={}){
  tenantId=tenant(tenantId); campaignId=text(campaignId,'campaignId'); name=text(name,'name');
  if(!['google','meta','linkedin','tiktok'].includes(platform))throw new Error('ad platform unsupported');
  dailyBudgetMinor=money(dailyBudgetMinor); lifetimeBudgetMinor=money(lifetimeBudgetMinor);
  if(lifetimeBudgetMinor>0&&lifetimeBudgetMinor<dailyBudgetMinor)throw new Error('lifetime budget below daily budget');
  if(!['pending','approved','rejected'].includes(approvalStatus))throw new Error('approvalStatus invalid');
  return resourceBase({
    tenantId,type:'ad_campaign',resourceId:campaignId,name,
    config:{platform,dailyBudgetMinor,lifetimeBudgetMinor,approvalStatus,trackingRefs:list(trackingRefs,'trackingRefs',50)},
    capabilities:['spend_limits','attribution','conversion_tracking']
  });
}

export function authorizeAdLaunch({campaign,approval,providerGrant,remainingBudgetMinor}={}){
  if(!campaign||campaign.type!=='ad_campaign'||campaign.checksum!==sha256({...campaign,checksum:undefined}))throw new Error('ad campaign invalid');
  if(campaign.config.approvalStatus!=='approved'||approval?.status!=='approved')return {allowed:false,code:'AD_SPEND_APPROVAL_REQUIRED'};
  if(providerGrant!==true)return {allowed:false,code:'AD_PROVIDER_GRANT_REQUIRED'};
  if(!Number.isSafeInteger(remainingBudgetMinor)||remainingBudgetMinor<campaign.config.dailyBudgetMinor)return {allowed:false,code:'AD_BUDGET_EXCEEDED'};
  return {allowed:true,actionId:'adlaunch_'+sha256({campaign:campaign.checksum,approval,providerGrant,remainingBudgetMinor}).slice(0,28)};
}

export function createCourse({tenantId,courseId,name,lessons=[],access='entitled',certificate=false}={}){
  tenantId=tenant(tenantId); courseId=text(courseId,'courseId'); name=text(name,'name');
  if(!Array.isArray(lessons)||lessons.length<1||lessons.length>500)throw new Error('lessons invalid');
  const normalized=lessons.map((l,i)=>({id:text(l?.id||('lesson_'+(i+1)),'lesson id'),title:text(l?.title||('Lesson '+(i+1)),'lesson title'),position:i,contentRef:text(l?.contentRef,'contentRef')}));
  return resourceBase({tenantId,type:'course',resourceId:courseId,name,config:{lessons:normalized,access,certificate},capabilities:['lessons','entitlements','progress','completion']});
}

export function grantEntitlement({tenantId,memberId,resourceType,resourceId,source='manual',expiresAt=null,idempotencyKey}={}){
  tenantId=tenant(tenantId); memberId=text(memberId,'memberId'); resourceId=text(resourceId,'resourceId'); idempotencyKey=text(idempotencyKey,'idempotencyKey',255);
  if(!['course','membership','community'].includes(resourceType))throw new Error('entitlement type invalid');
  const body={tenantId,memberId,resourceType,resourceId,source:text(source,'source',80),expiresAt,idempotencyKey,status:'active',grantedAt:new Date().toISOString()};
  return freeze({...body,entitlementId:'ent_'+sha256(body).slice(0,28),checksum:sha256(body)});
}

export function createAffiliateProgram({tenantId,programId,name,commissionType='percent',commissionValue,attributionWindowDays=30,approvalRequired=true}={}){
  tenantId=tenant(tenantId); programId=text(programId,'programId'); name=text(name,'name');
  if(!['percent','fixed_minor'].includes(commissionType))throw new Error('commission type invalid');
  if(!Number.isFinite(commissionValue)||commissionValue<0)throw new Error('commission value invalid');
  if(commissionType==='percent'&&commissionValue>100)throw new Error('commission percent invalid');
  if(!Number.isSafeInteger(attributionWindowDays)||attributionWindowDays<1||attributionWindowDays>365)throw new Error('attribution window invalid');
  return resourceBase({tenantId,type:'affiliate_program',resourceId:programId,name,config:{commissionType,commissionValue,attributionWindowDays,approvalRequired},capabilities:['tracking','attribution','commission_ledger']});
}

export function createSaaSPlan({tenantId,planId,name,baseMonthlyMinor,usageMeters=[],includedCapabilities=[],limits={}}={}){
  tenantId=tenant(tenantId); planId=text(planId,'planId'); name=text(name,'name');
  baseMonthlyMinor=money(baseMonthlyMinor);
  if(baseMonthlyMinor<1)throw new Error('base monthly price must be positive');
  if(!Array.isArray(usageMeters)||usageMeters.length>100)throw new Error('usageMeters invalid');
  const meters=usageMeters.map(m=>({metric:text(m?.metric,'meter metric'),unitPriceMinor:money(m?.unitPriceMinor),includedQuantity:Number.isSafeInteger(m?.includedQuantity)?m.includedQuantity:0}));
  return resourceBase({tenantId,type:'saas_plan',resourceId:planId,name,config:{baseMonthlyMinor,usageMeters:meters,includedCapabilities:list(includedCapabilities,'includedCapabilities',100),limits:structuredClone(limits)},capabilities:['subscriptions','usage_billing','provisioning','rebilling']});
}

export function planSaaSProvision({plan,customerTenantId,externalAccountRef,idempotencyKey,providerReady=true}={}){
  if(!plan||plan.type!=='saas_plan'||plan.checksum!==sha256({...plan,checksum:undefined}))throw new Error('SaaS plan invalid');
  customerTenantId=tenant(customerTenantId); externalAccountRef=text(externalAccountRef,'externalAccountRef'); idempotencyKey=text(idempotencyKey,'idempotencyKey',255);
  if(customerTenantId===plan.tenantId) return {allowed:false,code:'TARGET_TENANT_MUST_BE_DISTINCT'};
  if(providerReady!==true)return {allowed:false,code:'PROVIDER_NOT_READY'};
  return freeze({allowed:true,actionId:'saas_'+sha256({plan:plan.checksum,customerTenantId,externalAccountRef,idempotencyKey}).slice(0,28),sourceTenantId:plan.tenantId,customerTenantId,externalAccountRef,idempotencyKey});
}

export function createMarketplacePackage({tenantId,packageId,name,version,resources=[],declaredCapabilities=[],provenanceRef,signature=null}={}){
  tenantId=tenant(tenantId); packageId=text(packageId,'packageId'); name=text(name,'name'); version=text(version,'version');
  const refs=Array.isArray(resources)?resources:[]; if(refs.length>500)throw new Error('resources invalid');
  const normalized=refs.map(r=>({type:text(r?.type,'resource type'),resourceId:text(r?.resourceId,'resourceId'),checksum:text(r?.checksum,'resource checksum',128)}));
  const body={tenantId,packageId,name,version,resources:normalized,declaredCapabilities:list(declaredCapabilities,'declaredCapabilities',200),provenanceRef:text(provenanceRef,'provenanceRef'),signature};
  return freeze({...body,packageHash:sha256(body),checksum:sha256(body)});
}

export function authorizeMarketplacePublish(pkg,{signingKeyPresent=false,securityScan='pass',allDependenciesVerified=false}={}){
  if(!pkg||pkg.checksum!==sha256({...pkg,checksum:undefined}))throw new Error('package checksum invalid');
  if(signingKeyPresent!==true)return {allowed:false,code:'SIGNING_KEY_REQUIRED'};
  if(securityScan!=='pass')return {allowed:false,code:'SECURITY_SCAN_REQUIRED'};
  if(allDependenciesVerified!==true)return {allowed:false,code:'DEPENDENCIES_UNVERIFIED'};
  return {allowed:true,packageHash:pkg.packageHash};
}

export function planBusinessAction({tenantId,featureId,action,risk='read',approval=null,providerGrant=true,consent=true,suppressed=false,spendMinor=0,budgetMinor=0}={}){
  tenantId=tenant(tenantId); featureId=text(featureId,'featureId'); action=text(action,'action',100);
  if(!Object.values(BUSINESS_RISK).includes(risk))throw new Error('risk invalid');
  money(spendMinor); money(budgetMinor);
  if(suppressed)return {allowed:false,code:'SUPPRESSED'};
  if(['email','sms','mms','whatsapp','voice'].some(c=>featureId.includes(c))&&consent!==true)return {allowed:false,code:'CONSENT_REQUIRED'};
  if(['high','critical'].includes(risk)&&providerGrant!==true)return {allowed:false,code:'PROVIDER_GRANT_REQUIRED'};
  if(risk==='critical'&&approval?.status!=='approved')return {allowed:false,code:'APPROVAL_REQUIRED'};
  if(spendMinor>budgetMinor)return {allowed:false,code:'SPEND_LIMIT_EXCEEDED'};
  return freeze({allowed:true,tenantId,featureId,action,risk,requestId:'biz_'+sha256({tenantId,featureId,action,spendMinor,budgetMinor}).slice(0,28)});
}
