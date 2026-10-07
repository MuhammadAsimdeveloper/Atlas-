import crypto from 'node:crypto';
import { assessSeoReadiness, assessSeoSite } from '../atlas-seo/index.mjs';

const freeze = value => Object.freeze(value);
const canonicalize = value => Array.isArray(value)
  ? value.map(canonicalize)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonicalize(value[k])]))
    : value;
const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
const text = (value, field, max = 500) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(field + ' invalid');
  return value.trim();
};
const optionalText = (value, field, max = 500) => {
  if (value === undefined || value === null || value === '') return '';
  return text(value, field, max);
};
const id = (value, field = 'id') => text(value, field, 180);
const url = (value, field) => {
  try {
    const parsed = new URL(text(value, field, 2048));
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error(field + ' protocol invalid');
    return parsed.toString().replace(/\/$/, '') || parsed.origin;
  } catch {
    throw new Error(field + ' invalid');
  }
};
const usdMinor = (value, field = 'amountMinor') => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(field + ' must be a non-negative safe integer');
  return value;
};
const positiveMinor = (value, field) => {
  usdMinor(value, field);
  if (value < 1) throw new Error(field + ' must be positive');
  return value;
};
const idem = value => {
  if (!/^[A-Za-z0-9._:-]{8,255}$/.test(value || '')) throw new Error('Invalid idempotency key');
  return value;
};

export const PROVIDER_CATALOG = Object.freeze(Object.fromEntries([
  ['stripe', ['payments','subscriptions','invoices','refunds','customers']],
  ['paypal', ['payments','refunds','subscriptions']],
  ['google-calendar', ['calendar','availability','events']],
  ['microsoft-graph', ['calendar','email','contacts','files','teams']],
  ['gmail', ['email']],
  ['outlook-mail', ['email']],
  ['twilio', ['sms','voice','phone']],
  ['whatsapp-cloud', ['whatsapp','templates']],
  ['sendgrid', ['email','templates','events']],
  ['postmark', ['email','templates','events']],
  ['shopify', ['commerce','orders','customers','catalog']],
  ['quickbooks', ['accounting','invoices','payments']],
  ['xero', ['accounting','invoices','payments']],
  ['hubspot', ['crm','marketing','tickets']],
  ['slack', ['messaging','events']],
  ['teams', ['messaging','meetings','files']],
  ['zoom', ['meetings','recordings']],
  ['meta-ads', ['ads','leads','conversions']],
  ['google-ads', ['ads','conversions','reporting']],
  ['s3-compatible', ['storage','objects']],
  ['oidc-identity', ['identity','login']]
].map(([key, capabilities]) => [key, Object.freeze({id:key, capabilities:Object.freeze(capabilities)})])));

export const PROVIDER_RISK = Object.freeze({
  payments:'critical', voice:'high', messaging:'high', email:'high', calendar:'medium',
  crm:'medium', storage:'high', ads:'high', accounting:'critical', identity:'critical'
});

export function defineProviderAdapter({ id: adapterId, category, apiVersion, capabilities = [], auth='oauth2', webhook, rateLimit = { requests: 100, windowSeconds: 60 }, providerBaseUrl = null } = {}) {
  adapterId = id(adapterId, 'adapterId');
  if (!PROVIDER_CATALOG[adapterId]) throw new Error('Provider is not in catalog');
  category = text(category, 'category', 60);
  apiVersion = text(apiVersion, 'apiVersion', 80);
  if (!Array.isArray(capabilities) || capabilities.length > 100) throw new Error('Provider capabilities invalid');
  if (!['oauth2','api_key','service_account','oidc'].includes(auth)) throw new Error('Provider auth invalid');
  if (!webhook || !['hmac_sha256','hmac_sha512','jws'].includes(webhook.algorithm)) throw new Error('Webhook verification policy required');
  if (!Number.isSafeInteger(webhook.toleranceSeconds) || webhook.toleranceSeconds < 30 || webhook.toleranceSeconds > 900) throw new Error('Webhook tolerance invalid');
  if (!Number.isSafeInteger(rateLimit.requests) || rateLimit.requests < 1 || !Number.isSafeInteger(rateLimit.windowSeconds) || rateLimit.windowSeconds < 1) throw new Error('Rate limit invalid');
  const body = {
    id: adapterId, category, apiVersion, capabilities:[...new Set(capabilities)].sort(), auth,
    risk: PROVIDER_RISK[category] || 'medium',
    webhook:{algorithm:webhook.algorithm,toleranceSeconds:webhook.toleranceSeconds},
    rateLimit:{requests:rateLimit.requests,windowSeconds:rateLimit.windowSeconds},
    providerBaseUrl: providerBaseUrl ? url(providerBaseUrl, 'providerBaseUrl') : null
  };
  return freeze({...body, checksum:sha256(body)});
}

function timingSafeEqual(left, right) {
  const a=Buffer.from(left,'utf8'); const b=Buffer.from(right,'utf8');
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}

export function verifyWebhookSignature({ rawBody, signature, secret, timestamp, algorithm='hmac_sha256', toleranceSeconds=300, now=Math.floor(Date.now()/1000) } = {}) {
  rawBody = text(rawBody, 'rawBody', 2_000_000);
  secret = text(secret, 'secret', 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > toleranceSeconds) return {verified:false,code:'TIMESTAMP_OUTSIDE_TOLERANCE'};
  if (!['hmac_sha256','hmac_sha512'].includes(algorithm)) throw new Error('Unsupported webhook algorithm');
  const payload = timestamp + '.' + rawBody;
  const digest = crypto.createHmac(algorithm.replace('hmac_',''), secret).update(payload).digest('hex');
  let candidate = String(signature || '').trim();
  const match = candidate.match(/(?:^|,)v1=([a-f0-9]+)(?:,|$)/i);
  if (match) candidate = match[1];
  return timingSafeEqual(digest, candidate) ? {verified:true,code:'VERIFIED'} : {verified:false,code:'SIGNATURE_MISMATCH'};
}

export function planSyncCheckpoint({ tenantId, providerId, resource, direction='inbound', cursor=null, deltaLink=null, etag=null, dedupeKey, conflictPolicy='source_version_then_updated_at', maxBatch=500 } = {}) {
  tenantId=id(tenantId,'tenantId'); providerId=id(providerId,'providerId'); resource=text(resource,'resource',180);
  if (!['inbound','outbound','bidirectional'].includes(direction)) throw new Error('Sync direction invalid');
  if (!['source_version_then_updated_at','atlas_version_then_updated_at','manual_review'].includes(conflictPolicy)) throw new Error('Conflict policy invalid');
  if (!Number.isSafeInteger(maxBatch)||maxBatch<1||maxBatch>5000) throw new Error('Sync batch invalid');
  const body={tenantId,providerId,resource,direction,cursor,deltaLink,etag,dedupeKey:id(dedupeKey,'dedupeKey'),conflictPolicy,maxBatch};
  return freeze({...body,checkpointId:'sync_'+sha256(body).slice(0,24),checksum:sha256(body)});
}

export function assessProviderHealth({ consecutiveFailures=0, errorRate=0, latencyMs=0, webhookLagSeconds=0 } = {}) {
  if (![consecutiveFailures,errorRate,latencyMs,webhookLagSeconds].every(Number.isFinite)) throw new Error('Health metrics invalid');
  if (consecutiveFailures >= 8 || errorRate >= 0.5) return {state:'open', reason:'circuit_breaker'};
  if (consecutiveFailures >= 4 || errorRate >= 0.2 || latencyMs >= 2000 || webhookLagSeconds >= 300) return {state:'degraded', reason:'provider_health_threshold'};
  return {state:'healthy', reason:'within_threshold'};
}

const normalizePath = raw => {
  let p=text(raw,'path',500);
  if (!p.startsWith('/')) p='/'+p;
  p=p.replace(/\\/g,'/').replace(/\/+/g,'/');
  if (p.length>1 && p.endsWith('/')) p=p.slice(0,-1);
  if (p.includes('..') || /[?#]/.test(p)) throw new Error('Unsafe page path');
  return p;
};

export function createSiteDefinition({ tenantId, siteId='site_'+crypto.randomUUID().replaceAll('-',''), origin, pages, locale='en-US' } = {}) {
  tenantId=id(tenantId,'tenantId'); siteId=id(siteId,'siteId'); origin=url(origin,'origin');
  if (!Array.isArray(pages)||pages.length<1||pages.length>500) throw new Error('Pages invalid');
  const seen=new Set();
  const normalized=pages.map(page=>{
    const path=normalizePath(page.path);
    if(seen.has(path)) throw new Error('Duplicate page path: ' + path);
    seen.add(path);
    const title=text(page.title,'page title',120);
    const description=text(page.description,'page description',320);
    if (page.indexable && !/^https:\/\//.test(origin)) throw new Error('Indexable pages require HTTPS origin');
    const canonicalPath=page.canonicalPath?normalizePath(page.canonicalPath):path;
    const seo=page.seo && typeof page.seo==='object' ? {
      h1:optionalText(page.seo.h1,'seo h1',200),
      headings:Array.isArray(page.seo.headings)?page.seo.headings.slice(0,50):[],
      bodyText:optionalText(page.seo.bodyText,'seo bodyText',100000),
      focusKeywords:Array.isArray(page.seo.focusKeywords)?page.seo.focusKeywords.slice(0,12):[],
      internalLinks:Number.isSafeInteger(page.seo.internalLinks)?Math.max(0,page.seo.internalLinks):0,
      externalLinks:Number.isSafeInteger(page.seo.externalLinks)?Math.max(0,page.seo.externalLinks):0,
      images:Array.isArray(page.seo.images)?page.seo.images.slice(0,100):[],
      imageAltCoverage:Number.isFinite(page.seo.imageAltCoverage)?page.seo.imageAltCoverage:null,
      mobileFriendly:typeof page.seo.mobileFriendly==='boolean'?page.seo.mobileFriendly:null,
      coreWebVitals:page.seo.coreWebVitals ?? null,
      updatedRecently:typeof page.seo.updatedRecently==='boolean'?page.seo.updatedRecently:null,
      authorOrPublisher:optionalText(page.seo.authorOrPublisher,'seo authorOrPublisher',200),
      transparentClaims:page.seo.transparentClaims===true
    } : null;
    return {
      path,title,description,indexable:page.indexable!==false,
      canonicalPath,
      ogImage:page.ogImage ? url(page.ogImage,'ogImage') : null,
      structuredData:Array.isArray(page.structuredData)?page.structuredData.slice(0,20):[],
      seo
    };
  }).sort((a,b)=>a.path.localeCompare(b.path));
  const body={tenantId,siteId,origin,locale,pages:normalized};
  return freeze({...body,checksum:sha256(body)});
}

export function createDomainBinding({ tenantId, domain, verification='dns_txt', verified=false } = {}) {
  tenantId=id(tenantId,'tenantId'); domain=text(domain,'domain',253).toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('Domain invalid');
  if (!['dns_txt','dns_cname','http_token'].includes(verification)) throw new Error('Domain verification method invalid');
  const body={tenantId,domain,verification,verified:Boolean(verified)};
  return freeze({...body,checksum:sha256(body)});
}

export function createPublishPlan({ site, mode='preview', artifactHash, verifiedDomain=false, now=new Date().toISOString() } = {}) {
  if (!site || site.checksum!==sha256({...site,checksum:undefined})) throw new Error('Site definition invalid');
  artifactHash=text(artifactHash,'artifactHash',200);
  if (!['preview','public'].includes(mode)) throw new Error('Publish mode invalid');
  if (mode==='public') {
    if (!site.origin.startsWith('https://')) throw new Error('Public publication requires HTTPS');
    if (!verifiedDomain) return freeze({status:'blocked',code:'DOMAIN_NOT_VERIFIED',mode,artifactHash,createdAt:now});
  }
  const seoPages=site.pages.map(page=>assessSeoReadiness({
    title:page.title,
    description:page.description,
    canonicalUrl:site.origin + page.canonicalPath,
    robots:page.indexable ? 'index,follow' : 'noindex,nofollow',
    indexable:page.indexable,
    sitemapIncluded:mode==='public' ? page.indexable : false,
    https:site.origin.startsWith('https://'),
    structuredDataTypes:page.structuredData.map(item=>typeof item==='object' ? item['@type'] : '').filter(Boolean),
    ...(page.seo || {})
  }));
  const seoReadiness=assessSeoSite({
    pages:site.pages.map((page,index)=>({
      path:page.path,
      title:page.title,
      description:page.description,
      canonicalUrl:site.origin + page.canonicalPath,
      indexable:page.indexable,
      incomingLinks:page.seo?.internalLinks || 0,
      sitemapIncluded:mode==='public' ? page.indexable : false,
      ...page.seo,
      _pageReadiness:seoPages[index]
    }))
  });
  const sitemapEntries = mode==='public' ? site.pages.filter(p=>p.indexable).map(p=>site.origin + p.path) : [];
  const robots = mode==='public' ? 'index,follow,max-image-preview:large' : 'noindex,nofollow';
  const body={status:'ready',mode,artifactHash,robots,canonicalOrigin:mode==='public'?site.origin:null,sitemapEntries,seoReadiness:mode==='public'?seoReadiness:null,createdAt:now,rollbackKey:sha256({site:site.checksum,artifactHash})};
  return freeze(body);
}

export function authorizeCommunicationSend({ tenantId, channel, purpose, consent, suppression, frequency={sentLast24h:0,max24h:20}, quietHours=null, now=new Date() } = {}) {
  tenantId=id(tenantId,'tenantId');
  if (!['email','sms','whatsapp','voice','chat'].includes(channel)) throw new Error('Channel invalid');
  if (!['marketing','transactional','service'].includes(purpose)) throw new Error('Purpose invalid');
  if (suppression?.suppressed) return {allowed:false,code:'SUPPRESSED'};
  if (purpose==='marketing' && consent?.status!=='opted_in') return {allowed:false,code:'CONSENT_REQUIRED'};
  if (purpose!=='marketing' && consent?.status==='opted_out' && channel!=='service') return {allowed:false,code:'OPTED_OUT'};
  if (!Number.isSafeInteger(frequency.sentLast24h)||!Number.isSafeInteger(frequency.max24h)||frequency.sentLast24h>=frequency.max24h) return {allowed:false,code:'FREQUENCY_LIMIT'};
  if (quietHours && quietHours.start && quietHours.end) {
    const minute=now.getHours()*60+now.getMinutes();
    const start=quietHours.start.split(':').map(Number); const end=quietHours.end.split(':').map(Number);
    const a=start[0]*60+start[1], b=end[0]*60+end[1];
    const quiet=a<b ? minute>=a&&minute<b : minute>=a||minute<b;
    if (quiet) return {allowed:false,code:'QUIET_HOURS'};
  }
  if (channel==='sms' && purpose==='marketing' && consent?.channel!=='sms') return {allowed:false,code:'CHANNEL_CONSENT_REQUIRED'};
  return {allowed:true,code:'ALLOWED',tenantId};
}

export function createDeliveryEnvelope({ tenantId, channel, purpose, recipient, idempotencyKey, templateReleaseHash, threadId=null, scheduledAt=null, metadata={} } = {}) {
  tenantId=id(tenantId,'tenantId'); recipient=text(recipient,'recipient',500); templateReleaseHash=text(templateReleaseHash,'templateReleaseHash',128); idem(idempotencyKey);
  const body={id:'del_'+sha256({tenantId,idempotencyKey}).slice(0,28),tenantId,channel,purpose,recipient,idempotencyKey,templateReleaseHash,threadId,scheduledAt,status:'pending',metadata};
  return freeze({...body,checksum:sha256(body)});
}

export function createUsageMeter({ tenantId, metric, unitPriceMinor, currency='USD', maxQuantityPerWindow=1_000_000 } = {}) {
  tenantId=id(tenantId,'tenantId'); metric=text(metric,'metric',120); unitPriceMinor=usdMinor(unitPriceMinor,'unitPriceMinor');
  if (currency!=='USD') throw new Error('Financial OS currently uses USD boundary');
  if (!Number.isSafeInteger(maxQuantityPerWindow)||maxQuantityPerWindow<1) throw new Error('Meter quantity limit invalid');
  const body={tenantId,metric,unitPriceMinor,currency,maxQuantityPerWindow};
  return freeze({...body,checksum:sha256(body)});
}

export function recordUsage({ meter, quantity, idempotencyKey, timestamp=new Date().toISOString() } = {}) {
  if (!meter || meter.checksum!==sha256({...meter,checksum:undefined})) throw new Error('Meter invalid');
  if (!Number.isSafeInteger(quantity)||quantity<1||quantity>meter.maxQuantityPerWindow) throw new Error('Usage quantity invalid');
  idem(idempotencyKey);
  const amountMinor=quantity*meter.unitPriceMinor;
  if (!Number.isSafeInteger(amountMinor)) throw new Error('Usage amount overflow');
  const body={id:'use_'+sha256({tenantId:meter.tenantId,meter:meter.checksum,idempotencyKey}).slice(0,28),tenantId:meter.tenantId,metric:meter.metric,quantity,unitPriceMinor:meter.unitPriceMinor,amountMinor,currency:meter.currency,idempotencyKey,timestamp};
  return freeze({...body,checksum:sha256(body)});
}

export function createInvoice({ tenantId, currency='USD', lines, taxMinor=0, creditMinor=0, dueAt=null, customerRef=null } = {}) {
  tenantId=id(tenantId,'tenantId');
  if(currency!=='USD') throw new Error('Invoice currency must be USD');
  if(!Array.isArray(lines)||lines.length<1||lines.length>100) throw new Error('Invoice lines invalid');
  const normalized=lines.map(line=>({
    description:text(line.description,'line description',300),
    quantity:positiveMinor(line.quantity,'line quantity'),
    unitPriceMinor:usdMinor(line.unitPriceMinor,'unitPriceMinor')
  }));
  const subtotalMinor=normalized.reduce((sum,line)=>sum+(line.quantity*line.unitPriceMinor),0);
  if(!Number.isSafeInteger(subtotalMinor)) throw new Error('Invoice subtotal overflow');
  taxMinor=usdMinor(taxMinor,'taxMinor'); creditMinor=usdMinor(creditMinor,'creditMinor');
  const totalMinor=subtotalMinor+taxMinor-creditMinor;
  if(totalMinor<0 || !Number.isSafeInteger(totalMinor)) throw new Error('Invoice total invalid');
  const body={id:'inv_'+crypto.randomUUID().replaceAll('-',''),tenantId,currency,lines:normalized,subtotalMinor,taxMinor,creditMinor,totalMinor,dueAt,customerRef,status:'open'};
  return freeze({...body,checksum:sha256(body)});
}

export function reconcileProviderPayment({ tenantId, provider, providerEventId, amountMinor, currency='USD', invoiceId } = {}) {
  tenantId=id(tenantId,'tenantId'); provider=text(provider,'provider',80); providerEventId=id(providerEventId,'providerEventId'); invoiceId=id(invoiceId,'invoiceId'); amountMinor=positiveMinor(amountMinor,'amountMinor');
  if(currency!=='USD') throw new Error('Payment reconciliation requires USD');
  const reconciliationKey=sha256({tenantId,provider,providerEventId});
  return freeze({status:'ready_to_reconcile',reconciliationKey,tenantId,provider,providerEventId,amountMinor,currency,invoiceId,uniqueConstraint:'(tenant_id, provider, provider_event_id)',applySemantics:'INSERT ... ON CONFLICT DO NOTHING'});
}

export function createAgencyProject({ tenantId, projectId, budgetMinor, currency='USD', members, milestones=[] } = {}) {
  tenantId=id(tenantId,'tenantId'); projectId=id(projectId,'projectId'); budgetMinor=positiveMinor(budgetMinor,'budgetMinor');
  if(currency!=='USD') throw new Error('Agency workspace requires USD');
  if(!Array.isArray(members)||members.length<1||members.length>200) throw new Error('Members invalid');
  const normalizedMembers=members.map(member=>({
    id:id(member.id,'memberId'),role:text(member.role,'role',80),
    permissions:[...new Set(member.permissions||[])],secretScopes:[...new Set(member.secretScopes||[])]
  }));
  const normalizedMilestones=milestones.map(m=>({
    id:id(m.id,'milestoneId'),name:text(m.name,'milestone name',200),amountMinor:positiveMinor(m.amountMinor,'milestone amount')
  }));
  const allocated=normalizedMilestones.reduce((sum,m)=>sum+m.amountMinor,0);
  if(!Number.isSafeInteger(allocated)||allocated>budgetMinor) throw new Error('Milestones exceed project budget');
  const body={tenantId,projectId,budgetMinor,currency,members:normalizedMembers,milestones:normalizedMilestones,allocatedMinor:allocated,status:'active'};
  return freeze({...body,checksum:sha256(body)});
}

export function authorizeWorkAction({ project, memberId, action, secretScope=null, spendMinor=0, approval=null } = {}) {
  if(!project||project.checksum!==sha256({...project,checksum:undefined})) throw new Error('Project invalid');
  const member=project.members.find(m=>m.id===memberId);
  if(!member) return {allowed:false,code:'MEMBER_NOT_FOUND'};
  if(action==='access_secret' && (!secretScope || !member.secretScopes.includes(secretScope))) return {allowed:false,code:'SECRET_SCOPE_DENIED'};
  if(action!=='access_secret' && ['refund_customer','change_billing','issue_payout'].includes(action)) return {allowed:false,code:'FINANCE_AUTHORITY_SEPARATED'};
  if(action!=='access_secret' && !member.permissions.includes(action)) return {allowed:false,code:'PERMISSION_DENIED'};
  spendMinor=usdMinor(spendMinor,'spendMinor');
  if(spendMinor>0 && approval?.status!=='approved') return {allowed:false,code:'SPEND_APPROVAL_REQUIRED'};
  return {allowed:true,code:'ALLOWED'};
}

export function createDeliverableReview({ projectId, milestoneId, reviewerId, decision, evidenceRefs=[] } = {}) {
  projectId=id(projectId,'projectId'); milestoneId=id(milestoneId,'milestoneId'); reviewerId=id(reviewerId,'reviewerId');
  if(!['approved','changes_requested','rejected'].includes(decision)) throw new Error('Review decision invalid');
  if(!Array.isArray(evidenceRefs)||evidenceRefs.length>50) throw new Error('Review evidence invalid');
  const body={id:'review_'+crypto.randomUUID().replaceAll('-',''),projectId,milestoneId,reviewerId,decision,evidenceRefs:[...new Set(evidenceRefs.map(x=>text(x,'evidenceRef',500)))]};
  return freeze({...body,checksum:sha256(body)});
}

export const GHL_CAPABILITY_CATALOG = Object.freeze([
  'crm','custom_objects','pipelines','unified_conversations','email','sms','whatsapp','phone_calling','voice_ai',
  'conversation_ai','workflow_automation','workflow_ai','forms_surveys_quizzes','landing_pages','funnels','website_builder',
  'domains_dns','seo','social_publishing','reputation_reviews','ads_prospecting','calendars_booking','payments_invoicing',
  'subscriptions','memberships_courses_community','api_webhooks_mcp','agency_subaccounts','snapshots_templates',
  'marketplace','white_label_saas','reporting_attribution','ai_workforce'
]);

export function createSnapshotManifest({ tenantId, name, version, capabilities, assets, signingSecret=null } = {}) {
  tenantId=id(tenantId,'tenantId'); name=text(name,'name',160); version=text(version,'version',60);
  if(!Array.isArray(capabilities)||capabilities.length>100) throw new Error('Snapshot capabilities invalid');
  if(!Array.isArray(assets)||assets.length>1000) throw new Error('Snapshot assets invalid');
  const body={
    tenantId,name,version,capabilities:[...new Set(capabilities)].sort(),
    assets:assets.map(asset=>({path:text(asset.path,'asset path',1000),sha256:text(asset.sha256,'asset sha256',128)})).sort((a,b)=>a.path.localeCompare(b.path))
  };
  const material=JSON.stringify(canonicalize(body));
  const signature=signingSecret
    ? crypto.createHmac('sha256',text(signingSecret,'signingSecret',2000)).update(material).digest('hex')
    : sha256(body);
  return freeze({...body,signature,signatureMode:signingSecret?'hmac_sha256_integrity':'sha256_integrity_target'});
}

export function assessCapabilityCoverage({ implemented, catalog=GHL_CAPABILITY_CATALOG } = {}) {
  if(!Array.isArray(implemented)) throw new Error('Implemented capability list invalid');
  const set=new Set(implemented); const total=catalog.length; const implementedCount=catalog.filter(x=>set.has(x)).length;
  return {total,implemented:implementedCount,coveragePercent:Number((implementedCount/total*100).toFixed(2)),missing:catalog.filter(x=>!set.has(x))};
}

const DEFAULT_CONTROLS=Object.freeze(['CC1','CC2','CC3','CC4','CC5','A1','A2','PI1','AVAIL1','DR1','DR2','PRIV1','MSG1','FIN1']);
export function createControlRegister({ tenantId, controls=[] } = {}) {
  tenantId=id(tenantId,'tenantId');
  if(!Array.isArray(controls)||controls.length>100) throw new Error('Controls invalid');
  const normalized=(controls.length
    ? controls.map(c=>({id:id(c.id,'controlId'),framework:text(c.framework,'framework',80),title:text(c.title,'control title',240),severity:c.severity||'medium'}))
    : DEFAULT_CONTROLS.map(cid=>({id:cid,framework:cid.startsWith('CC')?'SOC2':'ATLAS',title:'Atlas control '+cid,severity:'medium'})));
  const evidenceCount=Object.fromEntries(normalized.map(c=>[c.id,0]));
  const body={tenantId,controls:normalized,evidenceCount};
  return freeze({...body,checksum:sha256(body)});
}

export function recordControlEvidence({ register, controlId, evidenceId, kind, capturedAt, retentionUntil=null } = {}) {
  if(!register||register.checksum!==sha256({...register,checksum:undefined})) throw new Error('Control register invalid');
  controlId=id(controlId,'controlId'); evidenceId=id(evidenceId,'evidenceId'); kind=text(kind,'evidence kind',100); capturedAt=text(capturedAt,'capturedAt',80);
  if(!(controlId in register.evidenceCount)) throw new Error('Control not found');
  const evidenceCount={...register.evidenceCount,[controlId]:register.evidenceCount[controlId]+1};
  const lastEvidence={controlId,evidenceId,kind,capturedAt,retentionUntil};
  const body={tenantId:register.tenantId,controls:register.controls,evidenceCount,lastEvidence};
  return freeze({...body,checksum:sha256(body)});
}

export function evaluateRecoveryDrill({ rtoMinutes, rpoMinutes, measuredRtoMinutes, measuredRpoMinutes, restoreVerified, backupIntegrityVerified=true } = {}) {
  if(![rtoMinutes,rpoMinutes,measuredRtoMinutes,measuredRpoMinutes].every(v=>Number.isFinite(v)&&v>=0)) throw new Error('Recovery targets invalid');
  const passed=Boolean(restoreVerified&&backupIntegrityVerified&&measuredRtoMinutes<=rtoMinutes&&measuredRpoMinutes<=rpoMinutes);
  return {status:passed?'pass':'fail',rtoMinutes,rpoMinutes,measuredRtoMinutes,measuredRpoMinutes,restoreVerified:Boolean(restoreVerified),backupIntegrityVerified:Boolean(backupIntegrityVerified)};
}

export function calculateSloStatus({ targetAvailability, observedAvailability, periodMinutes, totalErrorBudgetBurnMinutes=null } = {}) {
  if(![targetAvailability,observedAvailability].every(v=>Number.isFinite(v)&&v>0&&v<1)) throw new Error('Availability values invalid');
  if(!Number.isFinite(periodMinutes)||periodMinutes<=0) throw new Error('SLO period invalid');
  const budget=1-targetAvailability; const observedError=Math.max(0,1-observedAvailability);
  const allowedErrorMinutes=budget*periodMinutes; const observedErrorMinutes=observedError*periodMinutes;
  const remaining=Math.max(0,allowedErrorMinutes-observedErrorMinutes); const burn=budget===0?0:observedError/budget;
  const cumulativeBurn=Number.isFinite(totalErrorBudgetBurnMinutes)?Math.max(0,totalErrorBudgetBurnMinutes):observedErrorMinutes;
  return {status:observedAvailability>=targetAvailability?'within_budget':'budget_exhausted',targetAvailability,observedAvailability,errorBudgetFraction:budget,allowedErrorMinutes,observedErrorMinutes,remainingErrorBudgetMinutes:remaining,burnMultiple:Number(burn.toFixed(4)),totalErrorBudgetBurnMinutes:cumulativeBurn};
}

export function createReleaseGate({ release, checks, required } = {}) {
  release=id(release,'release');
  if(!checks||typeof checks!=='object'||Array.isArray(checks)) throw new Error('Release checks invalid');
  if(!Array.isArray(required)||required.length<1) throw new Error('Release requirements invalid');
  const failed=required.filter(key=>checks[key]!==true); const status=failed.length?'blocked':'approved';
  return freeze({release,status,failedChecks:failed,approvedAt:status==='approved'?new Date().toISOString():null,checksum:sha256({release,status,failedChecks:failed})});
}
