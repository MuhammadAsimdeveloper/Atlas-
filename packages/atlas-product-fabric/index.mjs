const freeze = value => Object.freeze(value);
const slug = value => String(value).toLowerCase().trim().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');

const phaseMeta = [
  { id:'P1', name:'Integration + Automation Core', focus:'Connector fabric, credentials, n8n-depth workflow controls, execution safety and extension contracts', status:'implemented-foundation' },
  { id:'P2', name:'CRM + Growth + Revenue + Experience', focus:'CRM intelligence, marketing, reputation, sales, commerce, education, forms, documents, portals and projects', status:'roadmap-contracts' },
  { id:'P3', name:'Analytics + AI + Developer Platform', focus:'Reporting, SEO, attribution, AI control plane, agent tools and Atlas platform APIs', status:'roadmap-contracts' },
  { id:'P4', name:'Enterprise Security + Reliability', focus:'Identity, secrets, policy, observability, disaster recovery and production resilience', status:'externally-gated' },
  { id:'P5', name:'Marketplace + Production Ecosystem', focus:'Community extensions, certified providers, multi-region launch proof and ecosystem scale', status:'externally-gated' }
];

const explicit = (id, domain, name, phase, status='roadmap') => ({
  id, domain, name, phase, status,
  guardrails: ['tenant_scope','audit_trail','versioned_contract'],
});

const addMany = (bucket, phase, domain, names, status='roadmap') => {
  for (const name of names) bucket.push({
    id: domain + '.' + slug(name),
    domain, name, phase, status,
    guardrails:['tenant_scope','audit_trail','bounded_inputs']
  });
};

const features = [
  explicit('connector.oauth2','connector','OAuth connector framework','P1','implemented'),
  explicit('connector.api_key','connector','API-key connector framework','P1','implemented'),
  explicit('connector.custom_rest','connector','Custom REST connector','P1','implemented'),
  explicit('connector.graphql','connector','GraphQL connector/node','P1','implemented'),
  explicit('connector.soap','connector','SOAP connector/node','P1','implemented'),
  explicit('connector.webhook','connector','Webhook trigger/response fabric','P1','implemented'),
  explicit('connector.credential_vault','connector','Credential vault','P1','implemented'),
  explicit('connector.rotation','connector','Credential rotation','P1','implemented'),
  explicit('connector.rate_limits','connector','Rate-limit handling','P1','implemented'),
  explicit('connector.pagination','connector','Cursor/page/link pagination','P1','implemented'),
  explicit('connector.token_refresh','connector','Automatic OAuth token refresh contract','P1','implemented'),
  explicit('platform.action_registry','platform','Universal business action registry','P1','implemented-foundation'),
  explicit('platform.skill_registry','platform','Governed agent skill registry','P1','implemented-foundation'),
  explicit('platform.data_contracts','platform','Versioned data/schema contracts','P1','implemented-foundation'),
  explicit('platform.interfaces','platform','Interfaces/forms/portal composition layer','P1','implemented-foundation'),
  explicit('platform.synthetic_tests','platform','Synthetic integration test harness','P1','implemented-foundation'),
  explicit('automation.error_routes','automation','First-class error routes and incomplete executions','P1','implemented-foundation'),
  explicit('automation.compensation','automation','Compensation/saga controls','P1','roadmap'),
  explicit('commerce.transactional_os','commerce','Transactional Commerce OS','P2','implemented-foundation'),
  explicit('commerce.financial_idempotency','commerce','Financial idempotency ledger','P2','implemented-foundation'),
  explicit('commerce.provider_reconciliation','commerce','Provider payment reconciliation','P2','implemented-foundation'),
  explicit('portal.relationship_scopes','portal','Relationship-scoped portal authorization','P2','implemented-foundation'),
  explicit('projects.dependency_graph','projects','Acyclic project dependency graph','P2','implemented-foundation'),
  explicit('documents.evidence_bound_signing','documents','Evidence-bound document approval','P2','implemented-foundation'),
  explicit('connector.auth_modes','connector','Basic/Bearer/HMAC/custom-header auth','P1','implemented'),
  explicit('automation.visual_editor','automation','Visual node editor at n8n depth','P1','implemented-foundation'),
  explicit('automation.node_marketplace','marketplace','Node marketplace','P1'),
  explicit('marketplace.nodes','marketplace','Atlas Node Marketplace','P5'),
  explicit('marketplace.connectors','marketplace','Atlas Connector Marketplace','P5'),
  explicit('marketplace.apps','marketplace','Atlas App Marketplace','P5'),
  explicit('marketplace.ai','marketplace','Atlas AI Marketplace','P5'),
  explicit('marketplace.templates','marketplace','Atlas Template Marketplace','P5'),
  explicit('automation.community_nodes','marketplace','Community nodes','P5'),
  explicit('automation.custom_nodes_sdk','developer','Custom nodes SDK','P1','implemented-contract'),
  explicit('automation.subworkflow','automation','Sub-workflows','P1','implemented'),
  explicit('automation.workflow_as_tool','automation','Workflow-as-tool','P1','implemented'),
  explicit('automation.workflow_as_agent_tool','automation','Workflow-as-agent-tool','P1','implemented-contract'),
  explicit('automation.parallel','automation','Parallel branches','P1','implemented'),
  explicit('automation.dead_letter','automation','Dead-letter queues','P1','implemented'),
  explicit('automation.replay','automation','Replay execution','P1','implemented'),
  explicit('automation.resume','automation','Resume execution','P1','implemented-contract'),
  explicit('automation.snapshots','automation','Execution snapshots','P1','implemented-contract'),
  explicit('automation.environments','automation','Development/staging/production environments','P1','implemented'),
  explicit('automation.promotion','automation','Workflow promotion/diff/rollback','P1','implemented-contract'),
  explicit('crm.custom_objects','crm','Advanced custom objects','P2'),
  explicit('crm.buying_committee','crm','Buying committees','P2'),
  explicit('crm.predictive_scoring','crm','Predictive lead scoring','P2'),
  explicit('crm.import_export','crm','Bulk import/export','P2'),
  explicit('marketing.drip_campaigns','marketing','Drip campaigns','P2'),
  explicit('marketing.attribution','marketing','Attribution','P2'),
  explicit('marketing.social_scheduler','marketing','Social scheduler','P2'),
  explicit('education.course_builder','education','Course builder','P2'),
  explicit('education.community','education','Community','P2'),
  explicit('commerce.cpq','commerce','CPQ','P2'),
  explicit('commerce.usage_billing','commerce','Usage billing','P2'),
  explicit('portal.customer','portal','Customer Portal','P2'),
  explicit('portal.partner','portal','Partner Portal','P2'),
  explicit('portal.freelancer','portal','Freelancer Portal','P2'),
  explicit('portal.agency','portal','Agency Portal','P2'),
  explicit('portal.vendor','portal','Vendor Portal','P2'),
  explicit('projects.gantt','projects','Gantt','P2'),
  explicit('security.sso','security','SSO','P4','externally-gated'),
  explicit('security.scim','security','SCIM','P4','externally-gated'),
  explicit('security.passkeys','security','Passkeys','P4','externally-gated'),
  explicit('security.kms','security','KMS','P4','externally-gated'),
  explicit('reliability.multi_region','reliability','Multi-region','P4','externally-gated'),
  explicit('reliability.otlp','reliability','OTEL export','P4','externally-gated'),
  explicit('reliability.waf','reliability','WAF','P4','externally-gated'),
  explicit('developer.atlas_api','developer','Atlas API','P3'),
  explicit('developer.atlas_sdk','developer','Atlas SDK','P3'),
  explicit('developer.atlas_mcp','developer','Atlas MCP','P3'),
];

addMany(features,'P1','connector',[
  'Google','Microsoft','Slack','Discord','Telegram','Stripe','PayPal','Shopify','WooCommerce','Salesforce',
  'HubSpot','Pipedrive','Mailchimp','SendGrid','Twilio','WhatsApp','OpenAI','Anthropic','Gemini','AWS','Azure',
  'GitHub','GitLab','Notion','Airtable','Supabase','PostgreSQL','MySQL','MongoDB','Redis','S3','Dropbox',
  'Google Drive','Google Calendars','social networks','Facebook','Instagram','LinkedIn','TikTok'
],'contracted');

addMany(features,'P1','automation',[
  'Loop node','Batch node','Split-in-batches','Merge node','Wait node','Delay node','Schedule node','Cron',
  'Conditional branching','Switch','Router','Error branches','Error workflows','Retry policies',
  'Exponential backoff','Partial execution','Execution snapshots','Version rollback','Workflow diff',
  'Workflow promotion','Automation tables','Data stores','Variables','Static workflow data','Key/value storage',
  'Temporary execution data','Data transformation nodes','JSON manipulation','CSV parser','XML parser',
  'Spreadsheet nodes','SQL nodes','Generic REST node','HTTP request node','OAuth2 node','Basic auth',
  'Bearer auth','HMAC auth','Custom headers','Webhook response','Webhook trigger','Rate-limit handling',
  'Automatic token refresh','Credential rotation','Credential vault','Custom API connector','GraphQL node',
  'SOAP support','Connector SDK','Node SDK','Trigger SDK','Custom action SDK','OAuth app framework',
  'Private integrations','Public integration marketplace','Versioned integrations','Connector certification',
  'Integration health monitoring'
],'implemented-foundation');

addMany(features,'P2','crm',[
  'Advanced custom objects','Object associations','Association labels','Record timelines','Lifecycle stages',
  'Lead scoring','Predictive lead scoring','Account scoring','Buying committees','Buyer intent','Data enrichment',
  'Duplicate detection','Merge records','Bulk editing','Bulk import/export','CSV import wizard','Data quality center',
  'Sales sequences','Email tracking','Email templates','Meeting scheduler','Sales playbooks','Quotes','Proposals',
  'E-signatures','Products','Product catalog','Price books','CPQ','Forecasting','Sales goals','Territory management',
  'Ticketing','Helpdesk','SLA','Service queues','Knowledge base','Customer portal','Customer feedback','CSAT','NPS',
  'Ticket automation','Escalation rules','Customer data platform','Data warehouse integrations','Data synchronization',
  'Reverse ETL','Data governance','Schema management','Data lineage','Sandbox environments'
]);

addMany(features,'P2','marketing',[
  'Email campaign builder','Visual email designer','SMS campaign builder','Drip campaigns','Broadcast campaigns',
  'Segmentation','Dynamic lists','Behavioral triggers','Lead scoring','Campaign analytics','Attribution',
  'Marketing calendar','UTM management','Conversion tracking','Social scheduler','Social inbox','Post composer',
  'Media library','Content calendar','Social analytics','AI content generation','Facebook Ads integration','Google Ads',
  'LinkedIn Ads','Campaign creation','Campaign monitoring','Lead attribution','ROAS dashboard','Ad-to-CRM attribution',
  'AI campaign optimization'
]);

addMany(features,'P2','reputation',[
  'Reputation management system','Google reviews','Facebook reviews','Review requests','Automated review campaigns',
  'Review monitoring','Review response AI','Review routing','Negative-review interception','Reputation dashboard',
  'Location-level reputation'
]);

addMany(features,'P2','education',[
  'Course builder','Lessons','Memberships','Protected content','Community','Discussion','Member profiles',
  'Subscription access','Drip content','Certificates'
]);

addMany(features,'P2','forms',[
  'Atlas Forms','Drag/drop forms','Conditional fields','Multi-step forms','File uploads','Calculated fields',
  'Hidden fields','UTM capture','CAPTCHA','Spam protection','Webhooks','CRM mapping','Form analytics',
  'Surveys','NPS','CSAT','Customer surveys','Quiz builder','Conditional logic','Survey analytics'
]);

addMany(features,'P2','documents',[
  'Document builder','Proposal builder','Quote builder','Contract templates','E-signature','Variables',
  'Approval workflows','Document tracking','Expiration','Versioning','PDF generation','Audit trail'
]);

addMany(features,'P2','commerce',[
  'Products','Product variants','SKU','Pricing','Price books','Taxes','Discounts','Coupons','Subscriptions',
  'Usage billing','Inventory','Orders','Checkout','Shopping cart','Payment links','Upsells','Cross-sells',
  'Refunds','Credits'
]);

addMany(features,'P2','portals',[
  'Customer Portal','Partner Portal','Freelancer Portal','Agency Portal','Vendor Portal',
  'Portal scoped records','Portal scoped tasks','Portal scoped messages','Portal scoped files','Portal scoped contracts',
  'Portal scoped payments','Portal scoped appointments','Portal scoped reports','Portal scoped approvals'
]);

addMany(features,'P2','projects',[
  'Projects','Tasks','Subtasks','Kanban','Dependencies','Milestones','Recurring tasks','Team assignment',
  'Time tracking','Workload','Capacity','Gantt','Project templates','Client projects','Client approvals'
]);

addMany(features,'P2','saas',[
  'Agency account','Sub-accounts','Agency dashboard','White-label SaaS','Custom branding','Custom domains',
  'Client snapshots/templates','Snapshot cloning','Account cloning','Agency billing','Client billing','Reseller model',
  'SaaS plans','Usage-based billing','Feature entitlements','Seat management','Agency-level reporting'
]);

addMany(features,'P3','analytics',[
  'Executive dashboard','CRM dashboard','Sales dashboard','Marketing dashboard','Automation dashboard','Agent dashboard',
  'Voice dashboard','Inbox dashboard','Revenue dashboard','Customer-success dashboard','Campaign dashboard',
  'Funnel analytics','Attribution','Cohort analysis','Retention','LTV','CAC','MRR','ARR','Churn','Conversion rates',
  'Pipeline velocity','Agent cost','AI token cost','Provider cost','Workflow cost','Profitability','Custom report builder',
  'Drag/drop metrics','Dimensions','Filters','Calculated fields','Saved reports','Scheduled reports','Export CSV',
  'Export PDF','Dashboard sharing'
]);

addMany(features,'P3','seo',[
  'SEO audit','Keyword research','Keyword clustering','Rank tracking','Competitor tracking','Backlink monitoring',
  'Internal-link suggestions','Schema.org generator','Sitemap management','Robots.txt','Canonicals','Redirect manager',
  'Core Web Vitals','Technical SEO scanner','Local SEO','Google Business Profile','Content briefs','AI article generation',
  'Content calendar','Content optimization','SERP analysis'
]);

addMany(features,'P3','ai',[
  'Prompt registry','Model routing','Model fallback','AI budget controls','Token accounting','Provider cost controls',
  'Knowledge base','RAG','Reranking','Citation enforcement','Prompt-injection defenses','Exfiltration defenses',
  'Agent Studio','Agent sessions','Agent memory lifecycle','Agent evaluations','Human-in-the-loop','Tool permissions',
  'Agent-to-workflow calls','Workflow-to-agent calls'
]);

addMany(features,'P3','developer',[
  'Atlas Developer Platform','Atlas API','Atlas SDK','Atlas MCP','Atlas App Marketplace','Atlas Node Marketplace',
  'Atlas AI Marketplace','Atlas Template Marketplace','Atlas Connector Marketplace','Atlas Embedded Automation',
  'Atlas White Label','Atlas Agency Platform','Atlas CLI','Webhook SDK','Event schema registry','Integration test harness',
  'Connector certification toolkit'
]);

addMany(features,'P4','security',[
  'SSO','SAML','SCIM','MFA/2FA','Passkeys','OAuth provider','API keys','Service accounts','Machine identities',
  'IP allowlists','Device management','Session management','Organization policies','Data-retention policies',
  'Legal holds','Audit-log explorer','SIEM export','Environment management','Secrets manager','KMS',
  'Backup automation','Restore automation','Security policy engine','ABAC','Data residency','Privacy center',
  'Data subject requests','Encryption key rotation','Break-glass access','Dual control','Dependency scanning',
  'Container scanning','Penetration-test evidence'
],'externally-gated');

addMany(features,'P4','reliability',[
  'Multi-region','Failover','Load testing','Chaos testing','SLO dashboards','Error budgets','OTEL export','SIEM',
  'WAF','CDN','DDoS protection','Autoscaling actuator','Real Redis','Provider reconciliation','Circuit breakers',
  'Bulkheads','Backpressure','Queue fairness','Priority scheduling','Replay-safe regional recovery','Data residency',
  'Backup/PITR evidence','Restore drills'
],'externally-gated');

addMany(features,'P5','marketplace',[
  'Signed templates','Compatibility checks','Community extension risk scanning','Extension sandboxing','Rollback-safe extensions',
  'Community connector certification','Private app distribution','Public app review','App version migration',
  'Marketplace payouts','Developer analytics','Connector health SLA'
],'externally-gated');

addMany(features,'P5','production',[
  'Provider certification matrix','Real production credentials','Real HTTPS domain','Managed PostgreSQL',
  'Managed Redis','Managed object storage','Managed edge services','SLO paging','Target-scale load evidence',
  'Backup/PITR restore evidence','Disaster recovery certification','Security/compliance review','Data residency controls',
  'Regional routing','Incident response drills'
],'externally-gated');

// Additional gaps that materially improve Atlas beyond the requested surface.
const gaps = [
  explicit('core.idempotency','core','Idempotency keys','P1','implemented-foundation'),
  explicit('data.data_lineage','data','Data lineage','P3'),
  explicit('ai.eval_harness','ai','Evaluation regression harness','P3'),
  explicit('ops.cost_controls','ops','Cost controls','P4','externally-gated'),
  explicit('ops.rate_quotas','ops','Rate quotas','P4','externally-gated'),
  explicit('core.event_bus','core','Event bus','P1','implemented-foundation'),
  explicit('core.event_bus','core','Event bus','P1','implemented-foundation'),
  explicit('core.outbox_inbox','core','Outbox/inbox pattern','P1','implemented-foundation'),
  explicit('core.schema_registry','core','Schema registry','P1','implemented-foundation'),
];addMany(gaps,'P1','core',[
  'Idempotency keys','Outbox/inbox pattern','Event bus','Event replay','Schema registry','Schema compatibility checks',
  'Feature flags','Tenant quotas','Rate quotas','Cost controls','Usage metering','Request correlation IDs','Audit event immutability',
  'Global search','Notification center','Timezone/DST policy','Localization','Currency normalization',
  'Consent ledger','Suppression lists','Provider webhooks reconciliation'
],'implemented-foundation');
addMany(gaps,'P4','ops',[
  'Incident management','On-call routing','Alert deduplication','Change management','Runbooks','Cost anomaly detection',
  'Budget guardrails','Rate quotas','Capacity planning','SLO burn-rate alerts'
],'externally-gated');
addMany(gaps,'P3','data',[
  'Data contracts','Data quality rules','Data profiling','Data lineage explorer','Warehouse semantic layer',
  'Incremental sync checkpoints','Conflict resolution','Dead-letter repair','Reverse sync guardrails'
]);
addMany(gaps,'P3','ai',[
  'Model health routing','Prompt versioning','Evaluation regression gates','Ground-truth datasets',
  'Tool-call tracing','Model spend caps','Provider outage failover'
]);
addMany(gaps,'P5','platform',[
  'Public status page','Changelog feed','Developer docs portal','API version lifecycle','Webhook replay console',
  'Sandbox tenants','Test data generator','Contract-test fixtures','Migration assistant'
],'externally-gated');

export const ATLAS_PHASES = freeze(phaseMeta.map(item => freeze({...item})));

function normalizeAll(items) {
  const byId = new Map();
  for (const item of items) {
    const current = byId.get(item.id);
    if (!current || current.status === 'roadmap') byId.set(item.id, freeze({...item}));
  }
  return [...byId.values()];
}

export const ATLAS_FEATURES = freeze(normalizeAll(features));
export const ATLAS_MISSING_FEATURES = freeze(normalizeAll(gaps));

export function featureSummary() {
  const byPhase = Object.fromEntries(ATLAS_PHASES.map(phase => [phase.id,0]));
  for (const item of ATLAS_FEATURES) byPhase[item.phase] = (byPhase[item.phase] || 0) + 1;
  return freeze({
    featureCount: ATLAS_FEATURES.length,
    phaseCount: ATLAS_PHASES.length,
    byPhase: freeze(byPhase)
  });
}

export function phaseFeatureMatrix() {
  return freeze(ATLAS_PHASES.map(phase => freeze({
    ...phase,
    features: freeze(ATLAS_FEATURES.filter(item => item.phase === phase.id))
  })));
}

export function capabilityReadiness(id) {
  const item = ATLAS_FEATURES.find(candidate => candidate.id === id) || ATLAS_MISSING_FEATURES.find(candidate => candidate.id === id);
  if (!item) return null;
  return freeze({
    id:item.id, name:item.name, phase:item.phase, status:item.status,
    guardrails:[...item.guardrails]
  });
}
