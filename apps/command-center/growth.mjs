const MODULES = [
  ['contacts','Contacts'],['leads','Leads'],['pipelines','Pipelines'],['tasks','Tasks'],['ai-qualification','AI Lead Qualification'],
  ['ai-follow-up','AI Follow-up'],['workflows','Workflow Builder'],['email-templates','Email Builder'],['funnels','Funnel Builder'],
  ['websites','Website Builder'],['social-planner','Social Planner'],['affiliate-system','Affiliate System'],['reputation-management','Reputation Management']
];
const $ = selector => document.querySelector(selector);
const node = (tag, value, className = '') => { const output = document.createElement(tag); output.textContent = value; if (className) output.className = className; return output; };
const state = { module: 'contacts', items: [], current: null, canWrite: false, busy: false, activated: false, searchTimer: null };
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function csrfToken() {
  const name = location.protocol === 'https:' ? '__Host-atlas_csrf' : 'atlas_csrf';
  const item = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  if (!item) return '';
  try { return decodeURIComponent(item.slice(name.length + 1)); } catch { return ''; }
}

async function api(path, { method = 'GET', body } = {}) {
  const token = csrfToken();
  const response = await fetch(`/api/v1${path}`, {
    method, credentials: 'same-origin', headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(method === 'GET' ? {} : { 'x-atlas-csrf': token }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(result.message || result.error || 'Atlas could not complete this request.'); error.status = response.status; error.code = result.error; throw error; }
  return result;
}

function notice(message, kind = 'info') {
  const target = $('#growth-feedback'); target.hidden = !message; target.textContent = message || ''; target.dataset.kind = kind;
}

function starter(module) {
  const now = new Date(Date.now() + 60 * 60_000).toISOString();
  const page = name => ({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), title: name, description: '', blocks: [{ id: 'hero', type: 'hero', heading: name, body: 'Describe the value your business provides.' }, { id: 'lead-form', type: 'lead_form', heading: 'Request a conversation', body: 'Share a few details and our team will follow up.' }], seo: { indexable: false, title: name, description: '' } });
  const sample = {
    contacts: { firstName: 'Alex', lastName: 'Morgan', email: 'alex@example.net', company: 'Northstar Services', source: 'website', tags: [], consent: { email: false, sms: false, whatsapp: false } },
    leads: { contactId: UUID_A, pipelineId: UUID_B, stageId: 'new', status: 'new', source: 'website', score: 0, valueMinor: 0, currency: 'USD', qualification: { status: 'not_run', reasonCodes: [], evidenceRefs: [] } },
    pipelines: { name: 'New business', stages: [{ id: 'new', name: 'New lead', probability: 0 }, { id: 'qualified', name: 'Qualified', probability: 0.4 }, { id: 'won', name: 'Won', probability: 1, isClosedWon: true }, { id: 'lost', name: 'Lost', probability: 0, isClosedLost: true }], rules: { allowBackward: true, allowSkip: false, requireApprovalOnBackward: true } },
    tasks: { title: 'Follow up with lead', description: '', status: 'open', priority: 'normal', contactId: UUID_A },
    'ai-qualification': { name: 'Lead readiness', instructions: 'Score only evidence visible in approved workspace records. Explain uncertainty and request human review for missing or conflicting data.', criteria: [{ id: 'fit', label: 'Service fit', weight: 40, evidenceRequired: true }, { id: 'intent', label: 'Purchase intent', weight: 35, evidenceRequired: true }, { id: 'timing', label: 'Decision timing', weight: 25, evidenceRequired: true }], scoreBands: [{ min: 0, max: 39, outcome: 'review' }, { min: 40, max: 69, outcome: 'nurture' }, { min: 70, max: 100, outcome: 'sales_ready' }], allowedReadTools: ['read_contact', 'read_pipeline', 'search_knowledge'], requireHumanReview: true },
    'ai-follow-up': { name: 'New lead follow-up', purpose: 'marketing', trigger: 'lead.created', steps: [{ id: 'step_1', delayMinutes: 0, channel: 'email', templateId: UUID_A, connectionId: UUID_B, approvalRequired: true }], stopOnReply: true, approvalRequired: true },
    workflows: { name: 'New contact intake', graph: { nodes: [{ id: 'start', type: 'trigger', name: 'Contact created', config: { eventType: 'contact.created' } }, { id: 'end', type: 'stop', name: 'End' }], edges: [{ id: 'next', from: 'start', to: 'end', port: 'next' }] } },
    'email-templates': { name: 'Welcome email', channel: 'email', purpose: 'marketing', locale: 'en-US', subject: 'Thanks for reaching out', body: 'Hi {{contact.firstName}},\n\nThanks for contacting us. Our team will be in touch shortly.\n\nReply to this email if you need help.', format: 'plain_text' },
    funnels: page('Service inquiry funnel'), websites: page('Company website'),
    'social-planner': { name: 'Scheduled post', channels: ['facebook'], caption: 'Add your approved campaign caption here.', mediaRefs: [], scheduledAt: now, approvalRequired: true },
    'affiliate-system': { name: 'Partner referrals', code: 'PARTNER-2026', commissionBps: 1000, attributionDays: 30, currency: 'USD', terms: 'Commissions are reviewed against eligible paid conversions.' },
    'reputation-management': { name: 'Completed service review request', requestTemplateId: UUID_A, channels: ['email'], eligibilityRule: 'all_completed_customers', incentiveOffered: false, responseTemplate: 'Thank you for sharing your feedback.' }
  };
  return JSON.stringify(sample[module], null, 2);
}

function setupCreatePanel() {
  const columns = $('.growth-columns');
  if (!columns || $('#growth-create')) return;
  const panel = document.createElement('section'); panel.id = 'growth-create'; panel.className = 'growth-create'; panel.hidden = true;
  const title = document.createElement('div'); title.className = 'growth-create-title'; title.append(node('h3', 'Create a workspace record'), node('span', 'Draft by default', 'growth-state'));
  const help = node('p', 'Start from a module example, then edit the JSON content. Replace example IDs with records from this workspace where a relationship is required.', 'field-help');
  const label = document.createElement('label'); label.textContent = 'Validated record content';
  const textarea = document.createElement('textarea'); textarea.id = 'growth-new-payload'; textarea.spellcheck = false; textarea.rows = 12; textarea.required = true; label.append(textarea);
  const actions = document.createElement('div'); actions.className = 'growth-create-actions';
  const cancel = node('button', 'Cancel', 'button subtle'); cancel.type = 'button'; cancel.addEventListener('click', () => { panel.hidden = true; });
  const create = node('button', 'Create draft', 'button primary'); create.type = 'button'; create.addEventListener('click', createRecord);
  const sampleButton = node('button', 'Load module example', 'growth-sample-button'); sampleButton.type = 'button'; sampleButton.addEventListener('click', () => { textarea.value = starter(state.module); });
  const sampleRow = document.createElement('div'); sampleRow.className = 'growth-template-help'; sampleRow.append(help, sampleButton);
  actions.append(cancel, create); panel.append(title, sampleRow, label, actions); columns.before(panel);
}

function moduleLabel(key) { return MODULES.find(([id]) => id === key)?.[1] || key; }

function renderModules() {
  $('#growth-module').replaceChildren(...MODULES.map(([key, label]) => { const option = document.createElement('option'); option.value = key; option.textContent = label; return option; }));
  $('#growth-module').value = state.module;
  $('#growth-list-title').textContent = moduleLabel(state.module);
}

function renderItems() {
  const list = $('#growth-list'); list.replaceChildren();
  $('#growth-count').textContent = `${state.items.length} ${state.items.length === 1 ? 'record' : 'records'}`;
  $('#growth-empty').hidden = state.items.length > 0;
  for (const item of state.items) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'growth-record'; button.dataset.id = item.id;
    button.setAttribute('aria-current', state.current?.id === item.id ? 'true' : 'false');
    const copy = document.createElement('span'); copy.className = 'growth-record-copy';
    copy.append(node('strong', item.title), node('small', `Updated ${new Date(item.updatedAt).toLocaleString()} · v${item.version}`));
    button.append(copy, node('span', item.state.replaceAll('_', ' '), 'growth-state'));
    button.addEventListener('click', () => showRecord(item)); list.append(button);
  }
}

function recordAction(item) {
  if (item.module === 'tasks') {
    if (['completed', 'canceled'].includes(item.state)) return null;
    return { action: 'complete', text: 'Mark complete' };
  }
  if (item.module === 'social-planner' && item.state === 'scheduled' && item.payload.approvalStatus === 'pending') return { action: 'approve', text: 'Approve post' };
  if (['published', 'scheduled'].includes(item.state)) return { action: 'pause', text: 'Pause' };
  if (['draft', 'paused'].includes(item.state) && !['affiliate-system', 'reputation-management'].includes(item.module)) return { action: 'publish', text: item.module === 'social-planner' ? 'Submit for approval' : 'Publish' };
  if (item.state !== 'archived') return { action: 'archive', text: 'Archive' };
  return null;
}

function showRecord(item) {
  state.current = item;
  $('#growth-detail-title').textContent = item.title;
  $('#growth-version').textContent = `Version ${item.version} · ${item.state.replaceAll('_', ' ')}`;
  $('#growth-version').hidden = false; $('#growth-detail-empty').hidden = true; $('#growth-detail-form').hidden = false;
  $('#growth-payload').value = JSON.stringify(item.payload, null, 2);
  $('#growth-save').disabled = !state.canWrite;
  const note = ['published', 'scheduled'].includes(item.state) ? 'Pause this item before editing its content.' : providerNote(item.module);
  $('#growth-provider-note').textContent = note;
  const action = recordAction(item); const lifecycle = $('#growth-lifecycle');
  lifecycle.hidden = !action || !state.canWrite; lifecycle.textContent = action?.text || '';
  lifecycle.onclick = action ? () => transition(action.action) : null;
  void renderLeadControls(item);
  renderItems();
}

function labeledControl(labelText, control) {
  const label = document.createElement('label'); label.append(node('span', labelText), control); return label;
}

async function renderLeadControls(item) {
  const host = $('#growth-special-controls'); host.replaceChildren(); host.dataset.recordId = item.id;
  if (item.module !== 'leads') return;
  const pipelineSection = document.createElement('section'); pipelineSection.className = 'growth-special-card';
  pipelineSection.append(node('h3', 'Pipeline stage'));
  try {
    const result = await api(`/growth/pipelines/${item.payload.pipelineId}`);
    if (host.dataset.recordId !== item.id) return;
    const select = document.createElement('select');
    for (const stage of result.item.payload.stages) { const option = document.createElement('option'); option.value = stage.id; option.textContent = stage.name; select.append(option); }
    select.value = item.payload.stageId;
    const move = node('button', 'Move lead', 'button subtle'); move.type = 'button'; move.disabled = !state.canWrite;
    move.addEventListener('click', async () => {
      try {
        const updated = await api(`/growth/leads/${item.id}/move-stage`, { method: 'POST', body: { expectedVersion: item.version, stageId: select.value } });
        state.current = updated.item; await loadRecords({ keepSelection: true });
        notice(`Lead moved to ${updated.move.stageName || select.selectedOptions[0]?.textContent || 'the selected stage'}.`, 'success');
      } catch (error) { notice(error.message, 'error'); }
    });
    pipelineSection.append(labeledControl('Move to stage', select), move);
  } catch (error) { if (host.dataset.recordId !== item.id) return; pipelineSection.append(node('p', `Pipeline controls unavailable: ${error.message}`, 'field-help')); }
  host.append(pipelineSection);

  const qualificationSection = document.createElement('section'); qualificationSection.className = 'growth-special-card';
  qualificationSection.append(node('h3', 'Evidence rubric review'));
  qualificationSection.append(node('p', 'A transparent weighted score from the published workspace rubric. Required evidence gaps stay in human review; Atlas does not send lead data to a model here.', 'field-help'));
  try {
    const result = await api('/growth/ai-qualification?publishedOnly=true&limit=100');
    if (host.dataset.recordId !== item.id) return;
    if (!result.items.length) {
      qualificationSection.append(node('p', 'Publish a qualification rubric before scoring leads.', 'field-help'));
      host.append(qualificationSection); return;
    }
    const profileSelect = document.createElement('select');
    for (const profile of result.items) { const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.title; profileSelect.append(option); }
    qualificationSection.append(labeledControl('Published rubric', profileSelect));
    const criteria = document.createElement('div'); criteria.className = 'growth-criteria';
    qualificationSection.append(criteria);
    const profiles = result.items;
    const renderCriteria = () => {
      const profile = profiles.find(entry => entry.id === profileSelect.value);
      criteria.replaceChildren();
      for (const criterion of profile?.payload.criteria || []) {
        const row = document.createElement('div'); row.className = 'growth-criterion-row'; row.dataset.criterionId = criterion.id;
        const rating = document.createElement('input'); rating.type = 'number'; rating.min = '0'; rating.max = '100'; rating.step = '1'; rating.inputMode = 'numeric'; rating.setAttribute('aria-label', `${criterion.label} score`);
        const evidence = document.createElement('input'); evidence.type = 'text'; evidence.maxLength = 180; evidence.placeholder = criterion.evidenceRequired ? 'Required evidence reference' : 'Evidence reference'; evidence.setAttribute('aria-label', `${criterion.label} evidence reference`);
        row.append(node('strong', `${criterion.label} · ${criterion.weight}%`), labeledControl('Score 0–100', rating), labeledControl('Evidence ID', evidence)); criteria.append(row);
      }
    };
    profileSelect.addEventListener('change', renderCriteria); renderCriteria();
    const evaluate = node('button', 'Evaluate lead', 'button primary'); evaluate.type = 'button'; evaluate.disabled = !state.canWrite;
    evaluate.addEventListener('click', async () => {
      const ratings = {}; const evidenceRefs = {};
      for (const row of criteria.querySelectorAll('[data-criterion-id]')) {
        const [rating, evidence] = row.querySelectorAll('input');
        if (rating.value !== '') ratings[row.dataset.criterionId] = Number(rating.value);
        if (evidence.value.trim()) evidenceRefs[row.dataset.criterionId] = evidence.value.trim();
      }
      try {
        const evaluated = await api(`/growth/ai-qualification/${profileSelect.value}/evaluate`, { method: 'POST', body: { expectedVersion: item.version, leadId: item.id, ratings, evidenceRefs } });
        state.current = evaluated.item; await loadRecords({ keepSelection: true });
        const review = evaluated.evaluation.status === 'needs_review' ? ' · human review required' : '';
        notice(`Rubric score ${evaluated.evaluation.score}/100 (${evaluated.evaluation.outcome})${review}.`, 'success');
      } catch (error) { notice(error.message, 'error'); }
    });
    qualificationSection.append(evaluate); host.append(qualificationSection);
  } catch (error) { if (host.dataset.recordId !== item.id) return; qualificationSection.append(node('p', `Published qualification rubrics unavailable: ${error.message}`, 'field-help')); host.append(qualificationSection); }
}

function providerNote(module) {
  if (['ai-qualification', 'ai-follow-up'].includes(module)) return 'This saves agent policy and configuration. No model is invoked and no customer message is sent until a provider and governed runtime are configured.';
  if (['workflows'].includes(module)) return 'Workflow definitions are versioned. Activation does not start a worker until the durable workflow service and integrations are configured.';
  if (['email-templates'].includes(module)) return 'Templates are saved here. Delivery, unsubscribe handling and provider event processing require a connected email provider.';
  if (['funnels', 'websites'].includes(module)) return 'This editor saves page drafts. Public hosting and publication require a verified workspace domain and configured page host.';
  if (module === 'social-planner') return 'Scheduling and approval are recorded. Publishing needs connected social accounts and a provider worker.';
  if (module === 'affiliate-system') return 'Campaign policy is recorded. Attribution and commission payouts are not active until commerce and payout providers are configured.';
  if (module === 'reputation-management') return 'Review policy is recorded. Requests are only sent to eligible customers after messaging is connected.';
  return 'Tenant data is isolated. Changes create an immutable revision and are recorded in the workspace activity trail.';
}

async function loadOverview() {
  try {
    const result = await api('/growth/overview');
    const groups = [
      ['CRM & Sales', ['contacts','leads','pipelines','tasks']],['AI Operations', ['ai-qualification','ai-follow-up']],
      ['Automation', ['workflows','email-templates']],['Growth', ['funnels','websites','social-planner','affiliate-system','reputation-management']]
    ];
    $('#growth-kpis').replaceChildren(...groups.map(([label, modules]) => {
      const card = document.createElement('article'); card.className = 'growth-kpi';
      const total = modules.reduce((sum, key) => sum + (result.modules[key]?.total || 0), 0);
      card.append(node('span', label), node('strong', String(total))); return card;
    }));
  } catch (error) { notice(error.message, 'error'); }
}

async function loadBilling() {
  try {
    const [plans, subscription] = await Promise.all([api('/billing/plans'), api('/billing/subscription')]);
    const select = $('#billing-plan');
    select.replaceChildren(...plans.plans.map(plan => { const option = document.createElement('option'); option.value = plan.key; option.textContent = `${plan.name}${plan.checkoutAvailable ? '' : ' · setup required'}`; option.disabled = !plan.checkoutAvailable; return option; }));
    const current = subscription.subscription;
    $('#billing-current').textContent = current ? `${moduleLabel(current.planKey)} plan` : 'No paid plan yet';
    $('#billing-status').textContent = current ? `${current.status.replaceAll('_',' ')}${current.currentPeriodEndsAt ? ` · renews ${new Date(current.currentPeriodEndsAt).toLocaleDateString()}` : ''}` : 'Secure Paddle checkout is available after plan IDs and provider credentials are configured.';
    const button = $('#billing-checkout'); button.disabled = !plans.plans.some(plan => plan.checkoutAvailable);
  } catch (error) { $('#billing-current').textContent = 'Billing unavailable'; $('#billing-status').textContent = error.message; $('#billing-checkout').disabled = true; }
}

async function loadRecords({ keepSelection = false } = {}) {
  const query = $('#growth-search').value.trim();
  try {
    const result = await api(`/growth/${state.module}?limit=100&q=${encodeURIComponent(query)}`);
    state.items = result.items; state.canWrite = result.canWrite;
    if (keepSelection && state.current) state.current = state.items.find(item => item.id === state.current.id) || null;
    if (state.current) showRecord(state.current);
    else { $('#growth-detail-title').textContent = 'Choose a record'; $('#growth-version').hidden = true; $('#growth-detail-empty').hidden = false; $('#growth-detail-form').hidden = true; }
    renderItems(); notice('', 'info');
  } catch (error) { state.items = []; state.canWrite = false; renderItems(); notice(error.message, 'error'); }
}

async function refresh() { await Promise.all([loadOverview(), loadBilling(), loadRecords({ keepSelection: true })]); }

async function createRecord() {
  try {
    const payload = JSON.parse($('#growth-new-payload').value);
    const result = await api(`/growth/${state.module}`, { method: 'POST', body: { payload } });
    $('#growth-create').hidden = true; state.current = result.item;
    await loadRecords({ keepSelection: false });
    const saved = state.items.find(item => item.id === result.item.id); if (saved) showRecord(saved);
    notice('Draft saved. It is isolated to this workspace and has a versioned audit trail.', 'success');
  } catch (error) { notice(error instanceof SyntaxError ? 'Record content must be valid JSON.' : error.message, 'error'); }
}

async function saveRecord(event) {
  event.preventDefault(); if (!state.current || !state.canWrite) return;
  try {
    const payload = JSON.parse($('#growth-payload').value);
    const result = await api(`/growth/${state.module}/${state.current.id}`, { method: 'PATCH', body: { expectedVersion: state.current.version, payload } });
    state.current = result.item; await loadRecords({ keepSelection: true }); showRecord(result.item); notice('A new immutable revision was saved.', 'success');
  } catch (error) { notice(error instanceof SyntaxError ? 'Record content must be valid JSON.' : error.message, 'error'); }
}

async function transition(action) {
  if (!state.current || !state.canWrite) return;
  try {
    const result = await api(`/growth/${state.module}/${state.current.id}/${action}`, { method: 'POST', body: { expectedVersion: state.current.version } });
    state.current = result.item;
    if (action === 'archive') { state.current = null; $('#growth-detail-form').hidden = true; $('#growth-detail-empty').hidden = false; $('#growth-detail-title').textContent = 'Choose a record'; }
    await loadRecords({ keepSelection: true }); notice(`Record ${action} completed.`, 'success');
  } catch (error) { notice(error.message, 'error'); }
}

function activate() {
  setupCreatePanel(); renderModules(); state.activated = true; refresh();
}

$('#growth-module').addEventListener('change', async event => {
  state.module = event.target.value; state.current = null; $('#growth-list-title').textContent = moduleLabel(state.module); $('#growth-detail-form').hidden = true; $('#growth-detail-empty').hidden = false; $('#growth-detail-title').textContent = 'Choose a record'; $('#growth-version').hidden = true; $('#growth-create').hidden = true; await loadRecords();
});
$('#growth-refresh').addEventListener('click', refresh);
$('#growth-new').addEventListener('click', () => {
  if (!state.canWrite) { notice('Your workspace role can view this area but cannot create records.', 'error'); return; }
  setupCreatePanel(); $('#growth-new-payload').value = starter(state.module); $('#growth-create').hidden = false; $('#growth-create').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('#growth-search').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => loadRecords({ keepSelection: true }), 240); });
$('#growth-detail-form').addEventListener('submit', saveRecord);
$('#billing-checkout').addEventListener('click', async () => {
  try { const result = await api('/billing/checkout', { method: 'POST', body: { planKey: $('#billing-plan').value } }); location.assign(result.checkout.checkoutUrl); }
  catch (error) { notice(error.message, 'error'); }
});

window.AtlasGrowth = Object.freeze({ activate });
