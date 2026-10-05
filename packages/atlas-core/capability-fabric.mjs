const ID=/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const CHANNELS=new Set(['email','sms','whatsapp','voice']);
const RISK=new Set(['read','write','external_side_effect','privileged']);
export const ATLAS_CAPABILITIES=Object.freeze([
['communication.unified_inbox','Unified inbox','communication','write'],['communication.sms','SMS provider','communication','external_side_effect'],['communication.whatsapp','WhatsApp provider','communication','external_side_effect'],['communication.email','Email provider','communication','external_side_effect'],['communication.voice','Voice provider','communication','external_side_effect'],['communication.calling_agent','Calling agent','communication','external_side_effect'],['communication.threading','Conversation threading','communication','write'],['communication.handoff','Agent handoff','communication','write'],
['automation.worker_executor','Production worker executor','automation','external_side_effect'],['automation.provider_actions','Real provider actions','automation','external_side_effect'],['automation.webhooks','Webhook triggers','automation','write'],['automation.schedules','Scheduled triggers','automation','write'],['automation.events','Event triggers','automation','write'],['automation.oauth','OAuth provider connections','automation','write'],['automation.marketplace','Integration marketplace','automation','write'],['automation.credentials','Credential management UI','automation','privileged'],
['crm.pipelines','Advanced pipeline management','crm','write'],['crm.custom_objects','Custom objects','crm','write'],['crm.custom_fields','Custom fields','crm','write'],['crm.lead_scoring','Lead scoring','crm','write'],['crm.forecasting','Sales forecasting','crm','read'],['crm.tasks','Tasks','crm','write'],['crm.notes','Notes','crm','write'],['crm.timeline','Activity timeline','crm','read'],['crm.segmentation','Advanced segmentation','crm','read'],
['marketing.campaigns','Campaigns','marketing','write'],['marketing.email','Email marketing','marketing','external_side_effect'],['marketing.sms','SMS marketing','marketing','external_side_effect'],['marketing.forms','Forms','marketing','write'],['marketing.funnels','Funnels','marketing','write'],['marketing.landing_pages','Landing-page builder','marketing','write'],['marketing.websites','Website builder','marketing','write'],['marketing.attribution','Attribution','marketing','read'],['marketing.ab_testing','A/B testing','marketing','write'],
['ai.workflow_generator','AI workflow generator','ai','write'],['ai.agent_builder','AI agent builder','ai','write'],['ai.sales_agent','AI sales agent','ai','external_side_effect'],['ai.support_agent','AI support agent','ai','external_side_effect'],['ai.calling_agent','AI calling agent','ai','external_side_effect'],['ai.crm_assistant','AI CRM assistant','ai','write'],['ai.customer_intelligence','Customer Intelligence Graph','ai','read'],['ai.knowledge_graph','Knowledge Graph','ai','read'],['ai.workforce','AI Workforce','ai','external_side_effect'],
['saas.white_label','White-label SaaS','saas','privileged'],['saas.agency_hierarchy','Agency hierarchy','saas','privileged'],['saas.client_accounts','Client accounts','saas','write'],['saas.client_portal','Client portal','saas','write'],['saas.snapshots','SaaS snapshots/templates','saas','write'],['saas.marketplace','Marketplace','saas','write'],['saas.billing','Agency billing','saas','write'],
['enterprise.mfa','MFA','enterprise','privileged'],['enterprise.sso_saml','SSO/SAML','enterprise','privileged'],['enterprise.scim','SCIM','enterprise','privileged'],['enterprise.waf','WAF','enterprise','privileged'],['enterprise.kms','KMS','enterprise','privileged'],['enterprise.secret_rotation','Secret rotation','enterprise','privileged'],['enterprise.audit_compliance','Advanced audit/compliance','enterprise','privileged'],['enterprise.pen_test','Penetration testing','enterprise','privileged'],['enterprise.dr','Disaster recovery','enterprise','privileged'],['enterprise.load_failover','Production-scale load/failover testing','enterprise','privileged']
].map(([id,name,domain,risk])=>Object.freeze({id,name,domain,risk})));

const byId=new Map(ATLAS_CAPABILITIES.map(x=>[x.id,x]));
export function capability(id){ if(typeof id!=='string'||!ID.test(id)) return null; return byId.get(id)||null; }
export function capabilityMatrix(){ return ATLAS_CAPABILITIES.map(x=>({...x})); }
export function assertCapability(id, expectedRisk=null){
 const item=capability(id); if(!item) throw Object.assign(new Error('Capability is not registered.'),{code:'capability_not_registered'});
 if(expectedRisk!==null&&!RISK.has(expectedRisk)) throw Object.assign(new Error('Capability risk policy is invalid.'),{code:'capability_policy_invalid'});
 if(expectedRisk!==null&&item.risk!==expectedRisk) throw Object.assign(new Error('Capability risk mismatch.'),{code:'capability_risk_mismatch'});
 return item;
}
export function assertChannel(channel){if(typeof channel!=='string'||!CHANNELS.has(channel)) throw Object.assign(new Error('Unsupported communication channel.'),{code:'channel_unsupported'});return channel;}
export function externalSideEffectAllowed({capabilityId,providerStatus,consent=true,approved=false}={}){
 const item=assertCapability(capabilityId);
 if(item.risk!=='external_side_effect') return true;
 if(providerStatus!=='verified') return false;
 if(!consent||!approved) return false;
 return true;
}
