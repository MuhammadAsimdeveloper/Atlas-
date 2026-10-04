import crypto from 'node:crypto';

const freeze = value => Object.freeze(value);
const uniq = values => [...new Set(values)];
const text = (value, field, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(field + ' invalid');
  return value.trim();
};

export const PROVIDER_CATEGORIES = Object.freeze(['crm','field_service','automation','project_management','accounting','support']);
export const AUTH_MODES = Object.freeze(['oauth2','api_key','webhook']);
export const SYNC_MODES = Object.freeze(['inbound','outbound','bidirectional','event_driven']);

const P = (id, name, category, auth, capabilities, operations, events, options = {}) => freeze({
  id, name, category, auth: Array.isArray(auth) ? auth : [auth],
  capabilities: freeze(uniq(capabilities)), operations: freeze(uniq(operations)), events: freeze(uniq(events)),
  api: options.api || null, docs: options.docs || null, notes: options.notes || null,
  scopes: freeze(uniq(options.scopes || [])), syncModes: freeze(uniq(options.syncModes || ['bidirectional'])),
  objects: freeze(uniq(options.objects || [])), status: options.status || 'catalog',
  oauth: options.oauth || null
});

export const PROVIDER_CATALOG = Object.freeze([
  P('jobber','Jobber','field_service',['oauth2'],
    ['clients','companies','properties','jobs','quotes','invoices','payments','appointments','team','webhooks','sync'],
    ['search','read','create','update','send','sync','subscribe'],
    ['client.created','client.updated','job.created','job.updated','job.closed','quote.created','quote.updated','invoice.created','invoice.updated','payment.created','appointment.created','appointment.updated','app.disconnected'],
    {api:'graphql',docs:'https://developer.getjobber.com/docs/',scopes:['clients:read','clients:write'],syncModes:['bidirectional','event_driven'],objects:['Client','Job','Quote','Invoice','Payment','Appointment','TeamMember'],status:'live_adapter',oauth:{authorize:'https://api.getjobber.com/api/oauth/authorize',token:'https://api.getjobber.com/api/oauth/token',pkce:true}}),
  P('zapier','Zapier','automation',['oauth2','api_key','webhook'],
    ['triggers','actions','searches','webhooks','zap_events','workflow_handoff'],
    ['read','create','update','send','receive','subscribe','unsubscribe'],
    ['zap.triggered','zap.action.completed','zap.action.failed','hook.received'],
    {api:'platform',docs:'https://developer.zapier.com/',syncModes:['event_driven','outbound','inbound'],objects:['Trigger','Action','Search','Webhook','Zap'],status:'live_adapter',liveOperations:['send_webhook','receive_webhook','signed_event_delivery','idempotent_delivery']}),
  P('hubspot','HubSpot','crm',['oauth2'],
    ['contacts','companies','deals','tickets','custom_objects','associations','pipelines','webhooks','marketing','conversations','analytics'],
    ['search','read','create','update','delete','send','sync','subscribe'],
    ['contact.created','contact.updated','company.created','deal.created','deal.updated','ticket.created','ticket.updated'],
    {api:'rest',docs:'https://developers.hubspot.com/integrate-with-hubspot',scopes:['crm.objects.contacts.read','crm.objects.contacts.write','crm.objects.companies.read','crm.objects.companies.write','crm.objects.deals.read','crm.objects.deals.write','tickets'],syncModes:['bidirectional','event_driven'],objects:['Contact','Company','Deal','Ticket','CustomObject'],status:'adapter_ready'}),
  P('salesforce','Salesforce','crm',['oauth2'],
    ['leads','contacts','accounts','opportunities','cases','custom_objects','reports','webhooks','bulk_sync'],
    ['search','read','create','update','delete','send','sync','subscribe'],
    ['lead.created','lead.updated','contact.created','account.updated','opportunity.created','opportunity.updated','case.created'],
    {api:'rest',docs:'https://developer.salesforce.com/docs/platform/api-rest/guide/intro-oauth-and-connected-apps.html',syncModes:['bidirectional','event_driven'],objects:['Lead','Contact','Account','Opportunity','Case','CustomObject'],status:'adapter_ready',oauth:{authorize:'https://login.salesforce.com/services/oauth2/authorize',token:'https://login.salesforce.com/services/oauth2/token'}}),
  P('zoho-crm','Zoho CRM','crm',['oauth2'],
    ['leads','contacts','accounts','deals','tasks','calls','custom_modules','webhooks','blueprints'],
    ['search','read','create','update','delete','send','sync','subscribe'],
    ['lead.created','lead.updated','contact.created','deal.created','deal.updated','task.created'],
    {api:'rest',docs:'https://www.zoho.com/crm/developer/docs/api/v8/',syncModes:['bidirectional','event_driven'],objects:['Lead','Contact','Account','Deal','Task','Call','CustomModule'],status:'catalog'}),
  P('pipedrive','Pipedrive','crm',['oauth2'],
    ['persons','organizations','deals','activities','products','pipelines','stages','webhooks'],
    ['search','read','create','update','delete','sync','subscribe'],
    ['person.added','person.updated','organization.added','deal.added','deal.updated','activity.added'],
    {api:'rest',docs:'https://developers.pipedrive.com/docs/api/v1',syncModes:['bidirectional','event_driven'],objects:['Person','Organization','Deal','Activity','Product'],status:'catalog'}),
  P('gohighlevel','HighLevel','crm',['oauth2','api_key'],
    ['contacts','companies','opportunities','pipelines','conversations','appointments','calendars','workflows','forms','surveys','reputation','payments','custom_fields','webhooks'],
    ['search','read','create','update','delete','send','sync','subscribe'],
    ['contact.created','contact.updated','opportunity.created','opportunity.status_changed','appointment.created','conversation.message'],
    {api:'rest',docs:'https://developers.gohighlevel.com/',syncModes:['bidirectional','event_driven'],objects:['Contact','Company','Opportunity','Conversation','Appointment','Calendar','Workflow'],status:'catalog'}),
  P('monday','monday.com','project_management',['oauth2'],
    ['boards','items','columns','groups','updates','users','webhooks','automations'],
    ['search','read','create','update','delete','send','sync','subscribe'],
    ['item.created','item.updated','item.deleted','update.created'],
    {api:'graphql',docs:'https://developer.monday.com/api-reference/docs',syncModes:['bidirectional','event_driven'],objects:['Board','Item','Column','Group','Update'],status:'catalog'}),
  P('servicetitan','ServiceTitan','field_service',['oauth2','api_key'],
    ['customers','locations','jobs','appointments','technicians','estimates','invoices','payments','membership','dispatch'],
    ['search','read','create','update','sync'],
    ['customer.created','job.created','job.updated','appointment.created','invoice.created','payment.created'],
    {api:'rest',docs:'https://developer.servicetitan.io/',syncModes:['bidirectional','event_driven'],objects:['Customer','Location','Job','Appointment','Technician','Estimate','Invoice','Payment'],status:'catalog'}),
  P('housecall-pro','Housecall Pro','field_service',['api_key','webhook'],
    ['customers','jobs','appointments','estimates','invoices','payments','team','webhooks'],
    ['search','read','create','update','sync','subscribe'],
    ['customer.created','job.created','job.updated','appointment.created','estimate.created','invoice.created'],
    {api:'rest',docs:'https://developer.housecallpro.com/',syncModes:['bidirectional','event_driven'],objects:['Customer','Job','Appointment','Estimate','Invoice','Payment'],status:'catalog'}),
  P('freshsales','Freshsales','crm',['oauth2','api_key'],
    ['contacts','accounts','deals','tasks','appointments','pipelines','custom_fields','webhooks'],
    ['search','read','create','update','delete','sync','subscribe'],
    ['contact.created','contact.updated','deal.created','deal.updated','task.created'],
    {api:'rest',docs:'https://developers.freshworks.com/crm/',syncModes:['bidirectional','event_driven'],objects:['Contact','Account','Deal','Task','Appointment'],status:'catalog'}),
  P('close','Close','crm',['oauth2','api_key'],
    ['leads','contacts','opportunities','activities','tasks','calls','emails','custom_fields','webhooks'],
    ['search','read','create','update','delete','send','sync','subscribe'],
    ['lead.created','lead.updated','opportunity.created','activity.created'],
    {api:'rest',docs:'https://developer.close.com/',syncModes:['bidirectional','event_driven'],objects:['Lead','Contact','Opportunity','Activity','Task'],status:'catalog'})
]);

const PROVIDERS = new Map(PROVIDER_CATALOG.map(provider => [provider.id, provider]));

export function listProviders({ category = null, query = '', status = null } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  return PROVIDER_CATALOG.filter(provider =>
    (!category || provider.category === category) &&
    (!status || provider.status === status) &&
    (!needle || [provider.id, provider.name, provider.category, ...provider.capabilities].join(' ').toLowerCase().includes(needle))
  );
}

export function getProvider(id) {
  const provider = PROVIDERS.get(text(id, 'providerId', 80));
  if (!provider) throw Object.assign(new Error('Integration provider not found'), { code: 'provider_not_found', status: 404 });
  return provider;
}

export function buildProviderConnectionPlan({ providerId, tenantId, requestedCapabilities = [], syncMode = 'bidirectional' } = {}) {
  tenantId = text(tenantId, 'tenantId', 160);
  const provider = getProvider(providerId);
  if (!provider.syncModes.includes(syncMode)) throw Object.assign(new Error('Provider does not support the requested sync mode'), { code: 'sync_mode_unsupported', status: 400 });
  const capabilities = requestedCapabilities.length ? uniq(requestedCapabilities) : provider.capabilities;
  const unsupported = capabilities.filter(capability => !provider.capabilities.includes(capability));
  if (unsupported.length) throw Object.assign(new Error('Provider capability is not supported'), { code: 'capability_unsupported', status: 400, unsupported });
  return freeze({
    id: 'plan_' + crypto.randomUUID().replaceAll('-', ''),
    tenantId, providerId: provider.id, provider: provider.name, auth: provider.auth,
    syncMode, capabilities, operations: provider.operations, objects: provider.objects,
    scopes: provider.scopes, webhookEvents: provider.events,
    nextSteps: [
      provider.auth.includes('oauth2') ? 'Configure provider OAuth client and callback URL.' : 'Configure provider credential or webhook secret.',
      'Grant only the scopes required by the selected capabilities.',
      'Run a connection health check before enabling workflow actions.',
      'Enable idempotent inbound/outbound sync and review conflict policy.'
    ]
  });
}

export function normalizeCrmRecord(providerId, record) {
  const provider = getProvider(providerId);
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('CRM record invalid');
  const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : null;
  const phone = typeof record.phone === 'string' ? record.phone.trim() : null;
  const name = typeof record.name === 'string' ? record.name.trim() : [record.firstName, record.lastName].filter(Boolean).join(' ').trim();
  return freeze({
    providerId: provider.id, provider: provider.name,
    externalId: text(String(record.id ?? record.externalId ?? ''), 'externalId', 240),
    objectType: text(String(record.objectType ?? record.type ?? 'contact'), 'objectType', 80),
    name: name || null, email: email || null, phone: phone || null,
    company: typeof record.company === 'string' ? record.company.trim() : null,
    status: typeof record.status === 'string' ? record.status.trim() : null,
    stage: typeof record.stage === 'string' ? record.stage.trim() : null,
    rawRef: typeof record.rawRef === 'string' ? record.rawRef.trim() : null
  });
}

export function mapAtlasToProvider({ providerId, atlasContact, fieldMap = {} } = {}) {
  const provider = getProvider(providerId);
  if (!atlasContact || typeof atlasContact !== 'object') throw new Error('Atlas contact invalid');
  const map = { firstName:'firstName', lastName:'lastName', email:'email', phone:'phone', company:'company', ...fieldMap };
  const output = {};
  for (const [atlasField, providerField] of Object.entries(map)) {
    if (providerField && atlasContact[atlasField] !== undefined) output[providerField] = atlasContact[atlasField];
  }
  return freeze({ providerId: provider.id, object: 'contact', fields: output });
}

export const INTEGRATION_RECIPES = Object.freeze([
  {id:'lead-to-jobber-client',name:'Atlas lead → Jobber client',from:'atlas.leads',to:'jobber.clients',trigger:'lead.stage_changed',condition:'stage=qualified',actions:['create_or_update_client','attach_note','create_follow_up_task']},
  {id:'jobber-job-to-atlas',name:'Jobber job → Atlas opportunity',from:'jobber.jobs',to:'atlas.leads',trigger:'job.created',actions:['upsert_contact','create_or_update_opportunity','append_activity']},
  {id:'atlas-to-zapier',name:'Atlas event → Zapier',from:'atlas.events',to:'zapier.webhook',trigger:'atlas.event',actions:['deliver_signed_event','record_delivery','retry_idempotently']},
  {id:'hubspot-to-atlas',name:'HubSpot CRM → Atlas',from:'hubspot.crm',to:'atlas.crm',trigger:'contact_or_deal.changed',actions:['upsert_contact','upsert_opportunity','append_activity']},
  {id:'salesforce-to-atlas',name:'Salesforce → Atlas',from:'salesforce.crm',to:'atlas.crm',trigger:'record.changed',actions:['upsert_contact','upsert_opportunity','append_activity']},
  {id:'highlevel-to-atlas',name:'HighLevel → Atlas',from:'highlevel.crm',to:'atlas.crm',trigger:'contact_or_opportunity.changed',actions:['upsert_contact','upsert_opportunity','append_activity']},
  {id:'atlas-to-jobber',name:'Atlas won deal → Jobber job',from:'atlas.leads',to:'jobber.jobs',trigger:'lead.stage_changed',condition:'stage=won',actions:['find_or_create_client','create_job','create_note']}
]);

export function listIntegrationRecipes({ providerId = null } = {}) {
  if (!providerId) return INTEGRATION_RECIPES;
  const id = text(providerId, 'providerId', 80);
  return INTEGRATION_RECIPES.filter(recipe => recipe.from.includes(id) || recipe.to.includes(id));
}
