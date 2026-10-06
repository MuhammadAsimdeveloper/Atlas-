const state = {
  connectors: [{ name: 'CRM', state: 'healthy' }, { name: 'Accounting', state: 'degraded' }, { name: 'Messaging', state: 'healthy' }],
  evaluation: { score: 97 },
  operations: { pipeline: 284500, weighted: 219300, pendingApprovals: 7, running: 3, failed: 1 },
  sync: { lag: 42, webhooks: 128, deadLetters: 2 },
  graph: { customers: 1840, relationships: 6230, atRisk: 37 },
  revenue: { won: 84200, expansion: 14, closePlans: 6 },
  serviceDesk: { open: 12, firstResponseRisk: 2, waitingCustomer: 4, suggestedTeam: 'Scheduling team' },
  risks: [{ type: 'stale_deals', severity: 'high', count: 6 }, { type: 'overdue_tasks', severity: 'medium', count: 14 }, { type: 'failed_workflows', severity: 'high', count: 1 }],
  actions: [{ title: 'Refresh six stale deals', status: 'pending approval' }, { title: 'Retry failed workflow', status: 'pending approval' }, { title: 'Review overdue task queue', status: 'pending approval' }]
};

const automationRecipes = [
  { title: 'Lead intake: set status + tag', trigger: 'Form submitted', channel: 'CRM field + tag + task' },
  { title: 'New lead follow-up', trigger: 'Contact created', channel: 'Email + task' },
  { title: 'AI lead qualification', trigger: 'Form submitted', channel: 'AI agent + task' },
  { title: 'Appointment reminders', trigger: 'Appointment booked', channel: 'Email + SMS' },
  { title: 'Missed-call text-back', trigger: 'Call missed', channel: 'SMS + callback task' },
  { title: 'Voice-agent follow-up', trigger: 'Transcript generated', channel: 'Voice + human handoff' },
  { title: 'Post-service review request', trigger: 'Appointment completed', channel: 'Email + SMS' },
  { title: 'Failed-payment recovery', trigger: 'Payment failed', channel: 'Email + task' },
  { title: 'Abandoned checkout recovery', trigger: 'Checkout abandoned', channel: 'Email + SMS' }
];

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money = value => currency.format(Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const themeValues = new Set(['system', 'light', 'dark']);

function preferredTheme() {
  try {
    const stored = localStorage.getItem('atlas.theme');
    return themeValues.has(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme) {
  const selected = themeValues.has(theme) ? theme : 'system';
  if (selected === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = selected;
  const systemDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = selected === 'dark' || (selected === 'system' && systemDark) ? '#10141d' : '#f5f7fb';
  try { localStorage.setItem('atlas.theme', selected); } catch { /* Theme still applies for this page load. */ }
  const status = document.querySelector('#theme-status');
  if (status) status.textContent = selected === 'system' ? 'Using device theme' : `${selected[0].toUpperCase()}${selected.slice(1)} theme selected`;
}

function riskCard() {
  return state.risks.map(risk => {
    const tone = ['low', 'medium', 'high', 'critical'].includes(risk.severity) ? risk.severity : 'medium';
    return `<div class="row"><span>${escapeHtml(String(risk.type).replaceAll('_', ' '))}</span><span class="pill ${tone}">${escapeHtml(risk.count)} · ${tone}</span></div>`;
  }).join('');
}

function actionCard() {
  return state.actions.map(action => `<div class="action"><div><strong>${escapeHtml(action.title)}</strong><div class="muted">${escapeHtml(action.status)}</div></div><span class="pill neutral">Sample only</span></div>`).join('');
}

function automationCard() {
  return automationRecipes.map(recipe => `<div class="recipe"><div><strong>${escapeHtml(recipe.title)}</strong><div class="muted">When: ${escapeHtml(recipe.trigger)}</div></div><span class="chip">${escapeHtml(recipe.channel)}</span></div>`).join('');
}

function render() {
  const app = document.querySelector('#app');
  const healthy = state.connectors.filter(connector => connector.state === 'healthy').length;
  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar" aria-label="Workspace navigation">
      <a class="brand" href="#overview" aria-label="Atlas Business OS home"><span class="brand-mark">A</span><span>Atlas<small>Business OS</small></span></a>
      <nav class="primary-nav" aria-label="Primary navigation">
        <a href="#overview" aria-current="page"><span aria-hidden="true">⌂</span> Overview</a>
        <a href="#ai-agents"><span aria-hidden="true">✦</span> AI agents</a>
        <a href="/copilot.html"><span aria-hidden="true">◉</span> Copilot Hub</a>
        <a href="#voice-operations"><span aria-hidden="true">☎</span> Voice operations</a>
        <a href="#voice-quality"><span aria-hidden="true">✓</span> Voice QA</a>
        <a href="#service-desk"><span aria-hidden="true">▤</span> Service desk <span class="nav-count">${escapeHtml(state.serviceDesk.open)}</span></a>
        <a href="#automations"><span aria-hidden="true">↗</span> Automations</a>
        <a href="#message-studio"><span aria-hidden="true">✉</span> Message studio</a>
        <a href="#revenue"><span aria-hidden="true">◫</span> Revenue</a>
        <a href="#approvals"><span aria-hidden="true">✓</span> Approvals <span class="nav-count">${escapeHtml(state.operations.pendingApprovals)}</span></a>
      </nav>
      <div class="sidebar-footer"><span class="avatar" aria-hidden="true">AT</span><span>Preview account<small>Tenant workspace demo</small></span></div>
    </aside>
    <main class="shell" id="overview">
    <header class="top">
      <div class="heading"><div class="eyebrow">Atlas · Business OS</div><h1>Command Center</h1><p class="sub">Customer operations, revenue signals and agent health at a glance.</p></div>
      <div class="toolbar"><span class="preview-label"><span class="preview-dot" aria-hidden="true"></span>Preview data</span><details class="settings-menu"><summary>Settings</summary><div class="settings-panel"><label for="theme-picker">Appearance</label><select id="theme-picker" name="theme"><option value="system">Use device</option><option value="light">Light</option><option value="dark">Dark</option></select><p class="muted">Saved on this device</p></div></details></div>
    </header>
    <p id="theme-status" class="sr-only" aria-live="polite"></p>
    <section class="grid" aria-label="Business overview">
      <article class="card metric"><div class="label">Pipeline</div><div class="kpi">${money(state.operations.pipeline)}</div><div class="muted">Weighted ${money(state.operations.weighted)}</div></article>
      <article class="card metric"><div class="label">Connector health</div><div class="kpi">${healthy}/${state.connectors.length}</div><div class="muted">Healthy providers</div></article>
      <article class="card metric"><div class="label">Agent evaluation</div><div class="kpi">${escapeHtml(state.evaluation.score)}%</div><div class="bar" role="img" aria-label="Agent evaluation score ${escapeHtml(state.evaluation.score)} percent"><div class="fill" style="width:${Math.max(0, Math.min(100, Number(state.evaluation.score) || 0))}%"></div></div></article>
      <article class="card metric"><div class="label">Approval queue</div><div class="kpi">${escapeHtml(state.operations.pendingApprovals)}</div><div class="muted">Sample decisions · API not connected</div></article>
      <article class="card panel"><div class="label">Sync fabric</div><div class="row"><span>Sync lag</span><span class="pill medium">${escapeHtml(state.sync.lag)}s</span></div><div class="row"><span>Webhooks accepted</span><span class="pill ok">${escapeHtml(state.sync.webhooks)}</span></div><div class="row"><span>Dead-letter jobs</span><span class="pill high">${escapeHtml(state.sync.deadLetters)}</span></div></article>
      <article class="card panel"><div class="label">Customer intelligence</div><div class="row"><span>Customers</span><strong>${escapeHtml(state.graph.customers)}</strong></div><div class="row"><span>Relationships</span><strong>${escapeHtml(state.graph.relationships)}</strong></div><div class="row"><span>At-risk accounts</span><span class="pill high">${escapeHtml(state.graph.atRisk)}</span></div></article>
      <article class="card panel"><div class="label">Revenue cockpit</div><div class="row"><span>Won</span><strong>${money(state.revenue.won)}</strong></div><div class="row"><span>Expansion candidates</span><strong>${escapeHtml(state.revenue.expansion)}</strong></div><div class="row"><span>Close plans</span><strong>${escapeHtml(state.revenue.closePlans)}</strong></div></article>
      <article class="card panel"><div class="label">Operational risks</div>${riskCard()}</article>
      <article class="card panel agent-panel" id="ai-agents"><div class="panel-heading"><div><div class="label">Customer AI rollout</div><h2>Support agent · canary</h2></div><span class="pill info">10% sample coverage</span></div><p class="muted">Knowledge-grounded agents use tenant-approved tools, request human review for sensitive actions, keep opted-in preferences and hand off uncertainty safely.</p><div class="chip-row"><span class="chip">Web chat</span><span class="chip">WhatsApp</span><span class="chip">Voice-ready contract</span><span class="chip">Human handoff</span></div><p class="footnote">Sample data only · chat, voice and model providers are not connected</p></article>
      <article class="card panel wide voice-panel" id="voice-operations"><div class="panel-heading"><div><div class="label">Voice operations · journey preview</div><h2>One call, a clear next step</h2></div><span class="pill neutral">No provider connected</span></div><div class="voice-preview-controls"><label for="voice-scenario">Service-business call type</label><div><select id="voice-scenario"><option value="booking">Appointment request</option><option value="after-hours">After-hours help</option><option value="billing">Billing question</option></select><button type="button" id="voice-preview-button">Preview journey</button></div></div><p class="voice-preview-result" id="voice-preview-result" aria-live="polite">Preview a call flow. It uses no customer details and will not place a call.</p><div class="chip-row"><span class="chip">AI disclosure first</span><span class="chip">Specialist or human transfer</span><span class="chip">Consent-gated recording</span><span class="chip">Audited outcomes</span></div><p class="footnote">The call-session runtime pins a tenant's evaluated voice-agent release, checks outbound consent and call windows, limits transfer loops, and stores event references without transcripts. This screen is a local preview; phone, speech, calendar and human-routing providers are not connected.</p></article>
      <article class="card panel wide voice-quality-panel" id="voice-quality"><div class="panel-heading"><div><div class="label">Voice quality · sample insights</div><h2>Improve the call, protect the customer</h2></div><span class="pill info">Illustrative data</span></div><div class="voice-quality-metrics"><div><span>Quality score</span><strong>92 / 100</strong></div><div><span>Booking or intake complete</span><strong>88%</strong></div><div><span>Human handoff</span><strong>14%</strong></div><div><span>Median call duration</span><strong>2m 48s</strong></div></div><div class="voice-quality-lower"><div><h3>Review rubric</h3><div class="chip-row"><span class="chip">Policy and privacy</span><span class="chip">AI disclosure</span><span class="chip">Booking / intake</span><span class="chip">Grounded answers</span><span class="chip">Human handoff</span><span class="chip">Follow-up</span></div></div><div class="coaching-preview"><h3>Coaching queue</h3><div class="row"><span>Refresh approved knowledge</span><span class="pill medium">Normal</span></div><div class="row"><span>Improve booking steps</span><span class="pill high">High</span></div><div class="row"><span>Policy / disclosure failures</span><strong>0 sample calls</strong></div></div></div><p class="footnote">V100 reviews use scores and structured evidence references; they do not retain call transcripts or audio. Test calls stay outside live performance metrics. At least 20 reviewed calls, an 85+ quality score and zero policy/disclosure failures flag a release for governance review; Atlas's existing publication gate still applies. Sample data only · live call logs, scheduled reports and provider connections are not configured.</p></article>
      <article class="card panel copilot-panel"><div class="panel-heading"><div><div class="label">Operator copilot · preview</div><h2>Draft with a human in control</h2></div><span class="pill neutral">Not sent</span></div><div class="copilot-draft"><span class="copilot-icon" aria-hidden="true">✦</span><p>“I can help find a new appointment time. Which day works best for you?”</p></div><div class="copilot-meta"><span>Grounded response draft</span><strong>92% confidence · sample</strong></div><p class="footnote">The Copilot runtime can read scoped records and propose reviewed actions. This demo is static; no chat model or customer record is connected.</p></article>
      <article class="card panel service-panel" id="service-desk"><div class="panel-heading"><div><div class="label">Service desk · sample queue</div><h2>Cases that need attention</h2></div><span class="pill high">${escapeHtml(state.serviceDesk.firstResponseRisk)} SLA risk</span></div><div class="row"><span>Open cases</span><strong>${escapeHtml(state.serviceDesk.open)}</strong></div><div class="row"><span>Waiting on customer</span><strong>${escapeHtml(state.serviceDesk.waitingCustomer)}</strong></div><div class="case-preview"><div><strong>Appointment change</strong><div class="muted">Web chat · High priority · 8m to first response</div></div><span class="chip">Suggested: ${escapeHtml(state.serviceDesk.suggestedTeam)}</span></div><p class="footnote">SLA timers, delivery evidence and skill/capacity suggestions are domain contracts. This sample queue is not connected to a live inbox.</p></article>
      <article class="card panel wide" id="automations"><div class="panel-heading"><div><div class="label">Customer growth automations</div><h2>Automation recipe library</h2></div><span class="pill neutral">Configure before activation</span></div><div class="recipe-grid">${automationCard()}</div><p class="footnote">Connect a tenant provider, template and consent policy before sending. Recipes are previews and are not running automations.</p></article>
      <article class="card panel wide message-studio" id="message-studio"><div class="panel-heading"><div><div class="label">Message studio · sample draft</div><h2>Personalize a follow-up safely</h2></div><span class="pill neutral">Rendered preview · not sent</span></div><div class="message-draft"><div class="message-subject"><span>Subject</span><strong>Your visit is confirmed, Amina</strong></div><div class="message-body"><span>Message</span><p>Hello Amina, your appointment is Tuesday at 9:00 AM. Reply if you need to change the time.</p></div></div><div class="chip-row"><span class="chip">Pinned tenant template · v3</span><span class="chip">Personalized fields escaped</span><span class="chip">Missing data stops for review</span></div><p class="footnote">The V98 renderer prepares deterministic drafts from approved templates. The API must load values in the same tenant and recheck consent, quiet hours and suppression before a connected provider can send.</p></article>
      <article class="card panel" id="revenue"><div class="label">Atlas plan targets</div><div class="row"><span>Solo</span><strong>$48.50 / month</strong></div><div class="row"><span>Growth</span><strong>$148.50 / month</strong></div><div class="row"><span>Agency</span><strong>$248.50 / month</strong></div><p class="footnote">Proposed subscription targets benchmarked at half HighLevel's listed monthly platform price. Usage and payment add-ons are separate; checkout is not connected.</p></article>
      <article class="card panel" id="approvals"><div class="label">Action inbox</div>${actionCard()}<p class="footnote">Approvals shown here are sample records. Connect the authenticated API to review or execute real actions.</p></article>
      <article class="card panel wide"><div class="label">AI workforce</div><p>Agent permissions, evaluation gates, customer-memory consent and tool approvals are enforced by server contracts. Durable execution records keep tenant scope and idempotency keys. Automations can pin approved message templates and queue contact-field or tag updates.</p><div class="muted">Atlas V100 · laptop-first Business OS</div></article>
    </section>
  </main></div>`;
  const picker = document.querySelector('#theme-picker');
  picker.value = preferredTheme();
  applyTheme(picker.value);
  picker.addEventListener('change', event => applyTheme(event.target.value));
  const voiceJourneys = {
    booking: 'Disclosure → booking specialist → check calendar availability → confirm a reserved appointment → queue the approved follow-up.',
    'after-hours': 'Disclosure → support agent → capture the request reference → offer a callback task → route urgent cases for human review.',
    billing: 'Disclosure → billing specialist → verify the tenant-scoped account → hand off payment changes to an authorized person.'
  };
  document.querySelector('#voice-preview-button').addEventListener('click', () => {
    const scenario = document.querySelector('#voice-scenario').value;
    document.querySelector('#voice-preview-result').textContent = `Simulation only: ${voiceJourneys[scenario] || voiceJourneys.booking} No call was placed.`;
  });
  document.querySelectorAll('.primary-nav a').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('.primary-nav a').forEach(item => item.removeAttribute('aria-current'));
    link.setAttribute('aria-current', 'page');
  }));
}

render();
