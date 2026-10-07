import crypto from 'node:crypto';

const ID=/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;
const AUTH=new Set(['oauth2','api_key','basic','bearer','hmac','custom_headers','none']);
const NODE_KINDS=new Set(['trigger','action','transform','logic','control','subworkflow','agent_tool']);
const CONNECTOR_TIERS=new Set(['first_party','certified','community','private']);

const connector = (id,name,category,auth=['api_key'],features=[]) => Object.freeze({id,name,category,auth:Object.freeze(auth),features:Object.freeze(features),status:'catalog'});
const CONNECTORS = Object.freeze([
  connector('google','Google','productivity',['oauth2'],['drive','calendar','sheets','gmail']),
  connector('microsoft','Microsoft','productivity',['oauth2'],['graph','outlook','onedrive','calendar']),
  connector('slack','Slack','communication',['oauth2','bearer'],['messages','channels','events']),
  connector('discord','Discord','communication',['oauth2','bearer'],['messages','guilds','webhooks']),
  connector('telegram','Telegram','communication',['api_key','bearer'],['bot-api','webhooks']),
  connector('stripe','Stripe','payments',['api_key','bearer'],['customers','payments','subscriptions','webhooks']),
  connector('paypal','PayPal','payments',['oauth2','bearer'],['orders','payments','webhooks']),
  connector('shopify','Shopify','commerce',['oauth2','api_key'],['orders','products','customers','webhooks']),
  connector('woocommerce','WooCommerce','commerce',['api_key','custom_headers'],['orders','products','customers']),
  connector('salesforce','Salesforce','crm',['oauth2'],['objects','bulk','events']),
  connector('hubspot','HubSpot','crm',['oauth2','api_key'],['crm','marketing','webhooks']),
  connector('pipedrive','Pipedrive','crm',['oauth2','api_key'],['deals','persons','activities']),
  connector('mailchimp','Mailchimp','marketing',['oauth2','api_key'],['audiences','campaigns','automation']),
  connector('sendgrid','SendGrid','marketing',['api_key','bearer'],['mail','templates','events']),
  connector('twilio','Twilio','communication',['api_key','basic','bearer'],['sms','voice','messaging']),
  connector('whatsapp','WhatsApp','communication',['bearer'],['cloud-api','webhooks','templates']),
  connector('openai','OpenAI','ai',['api_key','bearer'],['responses','embeddings','moderation']),
  connector('anthropic','Anthropic','ai',['api_key','bearer'],['messages','models']),
  connector('gemini','Gemini','ai',['api_key','bearer'],['generate','embeddings','models']),
  connector('aws','AWS','cloud',['hmac','custom_headers'],['sigv4','s3','sqs','lambda']),
  connector('azure','Azure','cloud',['oauth2','api_key','bearer'],['resource-manager','storage','identity']),
  connector('github','GitHub','developer',['oauth2','bearer'],['repos','issues','pull-requests','webhooks']),
  connector('gitlab','GitLab','developer',['oauth2','api_key','bearer'],['projects','issues','pipelines']),
  connector('notion','Notion','productivity',['oauth2','bearer'],['pages','databases','webhooks']),
  connector('airtable','Airtable','data',['oauth2','api_key','bearer'],['bases','records','webhooks']),
  connector('supabase','Supabase','data',['api_key','bearer'],['postgres','rest','auth','storage']),
  connector('postgresql','PostgreSQL','database',['basic','custom_headers'],['sql','transactions','pooling']),
  connector('mysql','MySQL','database',['basic'],['sql','transactions','pooling']),
  connector('mongodb','MongoDB','database',['basic','api_key'],['query','aggregation','change-streams']),
  connector('redis','Redis','database',['basic','api_key'],['kv','streams','pubsub']),
  connector('s3','S3','storage',['hmac','custom_headers'],['objects','multipart','presigned']),
  connector('dropbox','Dropbox','storage',['oauth2'],['files','sharing','webhooks']),
  connector('google-drive','Google Drive','storage',['oauth2'],['files','folders','changes']),
  connector('calendars','Calendars','productivity',['oauth2'],['events','availability','webhooks']),
  connector('facebook','Facebook','social',['oauth2'],['pages','posts','insights']),
  connector('instagram','Instagram','social',['oauth2'],['media','comments','insights']),
  connector('linkedin','LinkedIn','social',['oauth2'],['profiles','posts','organizations']),
  connector('tiktok','TikTok','social',['oauth2'],['content','publishing','insights']),
  connector('generic-rest','Generic REST','developer',['oauth2','api_key','basic','bearer','hmac','custom_headers','none'],['pagination','rate-limit','webhooks']),
  connector('graphql','GraphQL','developer',['oauth2','api_key','basic','bearer','custom_headers','none'],['variables','pagination']),
  connector('soap','SOAP','developer',['basic','bearer','custom_headers','none'],['wsdl','xml']),
  connector('custom-api','Custom API','developer',['oauth2','api_key','basic','bearer','hmac','custom_headers','none'],['schema','pagination','rate-limit','webhooks'])
]);

const NODE = (id,label,kind,version='1.0.0') => Object.freeze({id,label,kind,version});
const NODES = Object.freeze([
  NODE('trigger.webhook','Webhook Trigger','trigger'), NODE('trigger.schedule','Schedule','trigger'),
  NODE('trigger.cron','Cron','trigger'), NODE('trigger.event','Event Trigger','trigger'),
  NODE('http.request','HTTP Request','action'), NODE('http.response','Webhook Response','action'),
  NODE('auth.oauth2','OAuth2','action'), NODE('auth.basic','Basic Auth','action'),
  NODE('auth.bearer','Bearer Auth','action'), NODE('auth.hmac','HMAC Auth','action'),
  NODE('auth.headers','Custom Headers','action'), NODE('http.graphql','GraphQL','action'),
  NODE('http.soap','SOAP','action'), NODE('logic.if','Conditional Branch','logic'),
  NODE('logic.switch','Switch','logic'), NODE('logic.router','Router','logic'),
  NODE('logic.parallel','Parallel Branches','logic'), NODE('control.loop','Loop','control'),
  NODE('control.batch','Batch','control'), NODE('control.split_in_batches','Split in Batches','control'),
  NODE('control.merge','Merge','control'), NODE('control.wait','Wait','control'),
  NODE('control.delay','Delay','control'), NODE('control.retry','Retry Policy','control'),
  NODE('control.error','Error Branch','control'), NODE('control.dead_letter','Dead Letter Queue','control'),
  NODE('data.json','JSON Transform','transform'), NODE('data.csv','CSV Parser','transform'),
  NODE('data.xml','XML Parser','transform'), NODE('data.spreadsheet','Spreadsheet','transform'),
  NODE('data.sql','SQL','action'), NODE('code.javascript','JavaScript Sandbox','action'),
  NODE('code.python','Python Sandbox','action'), NODE('workflow.subworkflow','Sub-workflow','subworkflow'),
  NODE('workflow.as_tool','Workflow as Tool','agent_tool'), NODE('workflow.as_agent_tool','Workflow as Agent Tool','agent_tool')
]);

function assertId(value,label='id'){ if(typeof value!=='string'||!ID.test(value)) throw Object.assign(new TypeError(label+' is invalid'),{code:'invalid_id'}); return value; }
function assertRef(value,label='reference'){ if(typeof value!=='string'||!REF.test(value)) throw Object.assign(new TypeError(label+' is invalid'),{code:'invalid_reference'}); return value; }
function assertObject(value,label){ if(!value||typeof value!=='object'||Array.isArray(value)) throw new TypeError(label+' must be an object'); return value; }
function boundedInt(value,label,min,max){ if(!Number.isSafeInteger(value)||value<min||value>max) throw new RangeError(label+' out of bounds'); return value; }

export function listConnectors({category=null,auth=null}={}) {
  return CONNECTORS.filter(c=>(category===null||c.category===category)&&(auth===null||c.auth.includes(auth))).map(c=>({...c,auth:[...c.auth],features:[...c.features]}));
}
export function getConnector(id){ assertId(id,'connectorId'); return CONNECTORS.find(c=>c.id===id)||null; }
export function listNodes({kind=null}={}) { return NODES.filter(n=>kind===null||n.kind===kind).map(n=>({...n})); }
export function getNode(id){ assertId(id,'nodeId'); return NODES.find(n=>n.id===id)||null; }

export function definePrivateConnector({tenantId,id,name,category,auth,baseUrl,scopes=[],version='1.0.0'}={}) {
  assertRef(tenantId,'tenantId'); assertId(id,'connectorId'); assertId(category,'category');
  if(typeof name!=='string'||name.length<2||name.length>120) throw new TypeError('name is invalid');
  if(!AUTH.has(auth)) throw new TypeError('unsupported auth');
  const url=new URL(baseUrl); if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash) throw new TypeError('private connector baseUrl must be HTTPS without embedded credentials/query');
  if(!Array.isArray(scopes)||scopes.length>100) throw new RangeError('scopes out of bounds');
  return Object.freeze({tenantId,id,name,category,auth,baseUrl:url.origin,scopes:[...scopes],version,status:'private'});
}

export function validateConnectorManifest(manifest) {
  assertObject(manifest,'manifest');
  const id=assertId(manifest.id,'manifest.id');
  if(typeof manifest.name!=='string'||manifest.name.length<2||manifest.name.length>120) throw new TypeError('manifest.name invalid');
  if(!CONNECTOR_TIERS.has(manifest.tier??'community')) throw new TypeError('manifest.tier invalid');
  if(!AUTH.has(manifest.auth?.type??'none')) throw new TypeError('manifest.auth.type invalid');
  const baseUrl=new URL(manifest.baseUrl); if(baseUrl.protocol!=='https:'||baseUrl.username||baseUrl.password||baseUrl.search||baseUrl.hash) throw new TypeError('manifest.baseUrl must be HTTPS without embedded credentials/query');
  if(manifest.webhook?.enabled && manifest.webhook.verification!=='signed') throw new TypeError('webhooks require signed verification');
  return Object.freeze({id,name:manifest.name,tier:manifest.tier??'community',auth:{type:manifest.auth?.type??'none'},baseUrl:baseUrl.origin});
}

export function createCredentialEnvelope({tenantId,connectionId,connectorId,version,secretRef,expiresAt=null,rotatedAt=null}={}) {
  assertRef(tenantId,'tenantId'); assertRef(connectionId,'connectionId'); assertId(connectorId,'connectorId'); assertId(version,'version'); assertRef(secretRef,'secretRef');
  if(!/^(?:vault|kms|secret|credential)_[A-Za-z0-9_.:-]{3,160}$/.test(secretRef)) throw new TypeError('secretRef must be an opaque vault/KMS reference');
  if(expiresAt!==null && !Number.isSafeInteger(expiresAt)) throw new TypeError('expiresAt must be epoch milliseconds');
  if(rotatedAt!==null && !Number.isSafeInteger(rotatedAt)) throw new TypeError('rotatedAt must be epoch milliseconds');
  return Object.freeze({tenantId,connectionId,connectorId,version,secretRef,expiresAt,rotatedAt,secretState:expiresAt!==null&&expiresAt<=Date.now()?'expired':'active'});
}

export function rotateCredential({current,nextSecretRef,now=Date.now()}={}) {
  assertObject(current,'current'); assertRef(current.tenantId,'current.tenantId'); assertRef(current.connectionId,'current.connectionId');
  assertRef(nextSecretRef,'nextSecretRef'); if(nextSecretRef===current.secretRef) throw new Error('rotation requires a new secret reference');
  return createCredentialEnvelope({tenantId:current.tenantId,connectionId:current.connectionId,connectorId:current.connectorId,version:current.version,secretRef:nextSecretRef,expiresAt:current.expiresAt,rotatedAt:now});
}

export function retryPolicy({maxAttempts=3,baseDelayMs=500,maxDelayMs=30000,jitterRatio=0.2}={}) {
  boundedInt(maxAttempts,'maxAttempts',1,20); boundedInt(baseDelayMs,'baseDelayMs',50,300000); boundedInt(maxDelayMs,'maxDelayMs',baseDelayMs,3600000);
  if(typeof jitterRatio!=='number'||jitterRatio<0||jitterRatio>1) throw new RangeError('jitterRatio out of bounds');
  return Object.freeze({maxAttempts,baseDelayMs,maxDelayMs,jitterRatio});
}
export function backoffDelay(policy,attempt,{random=Math.random}={}) {
  const p=retryPolicy(policy); boundedInt(attempt,'attempt',1,p.maxAttempts);
  const exp=Math.min(p.maxDelayMs,p.baseDelayMs*2**(attempt-1));
  const jitter=exp*p.jitterRatio*Math.max(-1,Math.min(1,random()*2-1));
  return Math.max(0,Math.round(exp+jitter));
}

export function rateLimitDecision({remaining,resetAt,now=Date.now(),minimumRemaining=0}={}) {
  if(!Number.isSafeInteger(remaining)||remaining<0) throw new RangeError('remaining invalid');
  if(!Number.isSafeInteger(resetAt)||resetAt<now) return Object.freeze({allowed:remaining>minimumRemaining,retryAfterMs:0});
  if(remaining>minimumRemaining) return Object.freeze({allowed:true,retryAfterMs:0});
  return Object.freeze({allowed:false,retryAfterMs:resetAt-now});
}

export function paginationPlan({strategy='cursor',pageSize=100,maxPages=1000}={}) {
  if(!['cursor','offset','page','link_header'].includes(strategy)) throw new TypeError('unsupported pagination strategy');
  boundedInt(pageSize,'pageSize',1,1000); boundedInt(maxPages,'maxPages',1,10000);
  return Object.freeze({strategy,pageSize,maxPages});
}

export function nodeDefinition({id,label,kind,version='1.0.0',inputs=1,outputs=1,sideEffect=false}={}) {
  assertId(id,'id'); if(typeof label!=='string'||label.length<1) throw new TypeError('label invalid');
  if(!NODE_KINDS.has(kind)) throw new TypeError('kind invalid');
  boundedInt(inputs,'inputs',0,64); boundedInt(outputs,'outputs',0,64);
  return Object.freeze({id,label,kind,version,inputs,outputs,sideEffect:Boolean(sideEffect)});
}

export function createExecutionSnapshot({tenantId,workflowId,executionId,version,nodes,variables={}}={}) {
  assertRef(tenantId,'tenantId'); assertRef(workflowId,'workflowId'); assertRef(executionId,'executionId');
  assertId(version,'version'); if(!Array.isArray(nodes)||nodes.length>500) throw new RangeError('nodes out of bounds');
  const canonical=JSON.stringify({tenantId,workflowId,executionId,version,nodes,variables});
  return Object.freeze({tenantId,workflowId,executionId,version,nodeCount:nodes.length,hash:crypto.createHash('sha256').update(canonical).digest('hex'),capturedAt:new Date().toISOString()});
}

export const CONNECTOR_COUNT=CONNECTORS.length;
export const NODE_COUNT=NODES.length;
export const CONNECTOR_IDS=Object.freeze(CONNECTORS.map(x=>x.id));
export const NODE_IDS=Object.freeze(NODES.map(x=>x.id));
