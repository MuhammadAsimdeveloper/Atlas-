const $ = (selector) => document.querySelector(selector);
const state = { view: 'overview', overview: null, query: '', data: [] };
const views = {
  overview: ['PLATFORM OVERVIEW','Good operations start with visibility.','A secure, cross-workspace view of Atlas health and activity.'],
  users: ['IDENTITY & WORKSPACES','Users and workspaces','Search account status and verification. Write actions remain disabled until audited admin mutations are implemented.'],
  content: ['POLICY OPERATIONS','Content control','Moderation queue, policy decisions and appeal history.'],
  payments: ['FINANCIAL OPERATIONS','Payments and transactions','Provider events from the Atlas payment event ledger. Amounts are stored in minor units.'],
  notifications: ['COMMUNICATION OPERATIONS','Notifications','Delivery state, audience, retries and provider receipts.'],
  reports: ['PLATFORM INTELLIGENCE','Reports','Daily platform audit activity for the last 30 days.'],
  audit: ['TRUST & SAFETY','Audit and security','Recent identity and workspace audit events.']
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const number = value => new Intl.NumberFormat('en-US').format(Number(value || 0));
const date = value => value ? new Date(value).toLocaleString() : '—';
function showAlert(message) { const el=$('#alert'); el.textContent=message; el.hidden=!message; }
async function api(path) {
  const response = await fetch('/api/v1/platform-admin/'+path, {credentials:'same-origin',headers:{accept:'application/json'},cache:'no-store'});
  const body = await response.json().catch(()=>({error:'invalid_response'}));
  if (!response.ok) {
    if (response.status===401) throw new Error('Please sign in with the verified platform-owner account.');
    if (response.status===403) throw new Error('Platform-owner permission is required for this console.');
    throw new Error(body.error || 'Unable to load platform data.');
  }
  return body;
}
function stat(label,value,note,icon) { return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon" aria-hidden="true">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></article>`; }
function panel(title,subtitle,body) { return `<section class="panel"><div class="panel-head"><div><h2>${title}</h2><div class="panel-sub">${subtitle}</div></div></div>${body}</section>`; }
function table(headers,rows) { return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(h=>'<th>'+h+'</th>').join('')}</tr></thead><tbody>${rows || ''}</tbody></table></div>`; }
function status(value) { const key=String(value||'unknown').toLowerCase(); const cls=['active','captured','verified','disabled','failed','pending','authorized'].includes(key)?key:'pending'; return `<span class="status ${cls}">${escapeHtml(value||'unknown')}</span>`; }
async function renderOverview() {
  const result=await api('overview'); const d=result.data; state.overview=d;
  const p=d.payments||{};
  const financeReady=p.status!=='unavailable';
  const stats=stat('Registered users',number(d.users?.total),number(d.users?.verified)+' verified','♙')+
    stat('Workspaces',number(d.workspaces?.total),'Across Atlas','▦')+
    stat('Captured payment events',financeReady?number(p.captured):'—',financeReady?'Recorded in payment ledger':'Disabled until RLS-safe read model','＄')+
    stat('Failed payment events',financeReady?number(p.failed):'—',financeReady?'Review provider and reconciliation state':'Financial data intentionally unavailable','!')+
    stat('Admin/audit events · 24h',number(d.audit24h),'Identity and workspace activity','◷')+
    stat('Disabled accounts',number(d.users?.disabled),'Access should be reviewed regularly','⊘')+
    stat('Unverified accounts',number(Math.max(0,(d.users?.total||0)-(d.users?.verified||0))),'Verification status','✉')+
    stat('Payment event volume',number(p.total),'All recorded payment events','↗');
  const max=Math.max(1,Number(p.total)||0);
  const bars=[['Captured',Number(p.captured)||0],['Failed',Number(p.failed)||0],['Other statuses',Math.max(0,max-(Number(p.captured)||0)-(Number(p.failed)||0))]];
  const barHtml=financeReady?bars.map(([label,n])=>`<div><div class="bar-label"><span>${label}</span><span>${number(n)}</span></div><div class="track"><div class="fill" style="width:${Math.min(100,100*n/max)}%"></div></div></div>`).join(''):'<p class="panel-sub">Finance charts are withheld until a tenant-isolated, audited cross-tenant read model is installed. No zero-value fallback is shown.</p>';
  const events=await api('audit?limit=6');
  const activity=events.data.length?events.data.map(e=>`<div class="activity-row"><span class="activity-dot"></span><div><strong>${escapeHtml(e.action)}</strong><p>${escapeHtml(e.actorId||'System')} · ${escapeHtml(date(e.createdAt))}</p></div></div>`).join(''):'<div class="empty">No audit events available.</div>';
  $('#content').innerHTML=`<div class="stats">${stats}</div><div class="grid-two">${panel('Payment activity','Recorded provider event status',`<div class="bar-list">${barHtml}</div><p class="panel-sub">${financeReady?'Captured total (minor units): '+escapeHtml(p.captured_minor||'0')+' · Currency is defined by the ledger.':'Finance data unavailable by design until cross-tenant RLS is safely handled.'}</p>`)}${panel('Recent audit activity','Latest account and workspace events',`<div class="activity">${activity}</div>`)}</div><div class="grid-two"><div class="panel"><div class="panel-head"><div><h2>Operational modules</h2><div class="panel-sub">Enabled and pending foundations</div></div></div><div class="feature-list"><div class="feature-card"><h3>User & workspace directory</h3><p>Search verified identities and account status.</p><span class="state good">READ AVAILABLE</span></div><div class="feature-card"><h3>Payment event ledger</h3><p>Provider-received event status and reconciliation keys remain server-side.</p><span class="state good">READ AVAILABLE</span></div><div class="feature-card"><h3>Content moderation</h3><p>Queue, review decisions and appeal history require a versioned persistence schema.</p><span class="state">FOUNDATION REQUIRED</span></div><div class="feature-card"><h3>Notification center</h3><p>Templates, delivery tracking and retries need a provider-backed delivery store.</p><span class="state">FOUNDATION REQUIRED</span></div></div></div>${panel('Security posture','Access boundary',`<div class="activity-row"><span class="activity-dot"></span><div><strong>Platform-owner authorization</strong><p>Server-verified identity and configured owner email.</p></div></div><div class="activity-row"><span class="activity-dot"></span><div><strong>Read-only console</strong><p>Destructive and financial write actions are not exposed by this initial release.</p></div></div><div class="activity-row"><span class="activity-dot"></span><div><strong>Private responses</strong><p>Admin API responses use no-store cache headers.</p></div></div>`)}</div>`;
  $('#connection-state').textContent='Owner session verified';
}
async function renderUsers() {
  const q=encodeURIComponent(state.query); const result=await api('users?limit=100&q='+q);
  const rows=result.data.map(u=>`<tr><td><strong>${escapeHtml(u.displayName)}</strong><small>${escapeHtml(u.id)}</small></td><td>${escapeHtml(u.email)}</td><td>${status(u.emailVerified?'verified':'pending')}</td><td>${status(u.disabled?'disabled':'active')}</td><td>${escapeHtml(date(u.createdAt))}</td></tr>`).join('');
  $('#content').innerHTML=`<section class="panel"><div class="toolbar"><div><h2>Account directory</h2><div class="panel-sub">Up to 100 newest accounts · sensitive credentials are never returned</div></div><input id="user-search" class="search" type="search" placeholder="Search name or email…" value="${escapeHtml(state.query)}" aria-label="Search users"></div>${table(['User','Email','Verification','Account status','Created'],rows||'<tr><td colspan="5" class="empty">No matching accounts.</td></tr>')}</section>`;
  $('#user-search').addEventListener('input',e=>{state.query=e.target.value;clearTimeout(window.__atlasSearch);window.__atlasSearch=setTimeout(()=>renderUsers().catch(err=>showAlert(err.message)),250)});
}
async function renderPayments() {
 const result=await api('payments?limit=100'); const rows=result.data.map(p=>`<tr><td><strong>${escapeHtml(p.paymentId)}</strong><small>${escapeHtml(p.provider)} · ${escapeHtml(p.providerEventId)}</small></td><td>${escapeHtml(p.workspaceId)}</td><td>${status(p.status)}</td><td>${escapeHtml(p.currency)} ${number(Number(p.amountMinor)/100)}</td><td>${escapeHtml(date(p.occurredAt))}</td><td>${escapeHtml(date(p.receivedAt))}</td></tr>`).join('');
 $('#content').innerHTML=`<section class="panel"><div class="toolbar"><div><h2>Payment events</h2><div class="panel-sub">Most recent 100 events · immutable provider-event view</div></div><span class="pill">${number(result.data.length)} loaded</span></div>${table(['Payment / provider event','Workspace','Status','Amount','Occurred','Received'],rows||'<tr><td colspan="6" class="empty">No payment events recorded.</td></tr>')}</section><p class="panel-sub">This is a payment-event view, not a reconciled accounting statement. Refund execution is intentionally unavailable until approval, idempotency and ledger reconciliation workflows are enabled.</p>`;
}
async function renderAudit() {
 const result=await api('audit?limit=100'); const rows=result.data.map(e=>`<tr><td>${escapeHtml(date(e.createdAt))}</td><td><strong>${escapeHtml(e.action)}</strong><small>${escapeHtml(e.id)}</small></td><td>${escapeHtml(e.actorId||'—')}</td><td>${escapeHtml(e.workspaceId||'Platform')}</td><td>${escapeHtml(e.subjectRef||'—')}</td><td><code>${escapeHtml(JSON.stringify(e.metadata||{}).slice(0,180))}</code></td></tr>`).join('');
 $('#content').innerHTML=`<section class="panel"><div class="toolbar"><div><h2>Audit event stream</h2><div class="panel-sub">Latest 100 account and workspace events</div></div><span class="pill">READ ONLY</span></div>${table(['Timestamp','Action','Actor','Workspace','Subject','Metadata'],rows||'<tr><td colspan="6" class="empty">No audit events recorded.</td></tr>')}</section>`;
}
async function renderReports() {
 const result=await api('reports'); const items=result.data; const max=Math.max(1,...items.map(x=>Number(x.events)||0));
 const bars=items.map(x=>`<div class="report-day" title="${escapeHtml(x.day)}: ${number(x.events)} events"><i style="height:${Math.max(3,(Number(x.events)||0)/max*100)}%"></i><small>${escapeHtml(String(x.day).slice(8,10))}</small></div>`).join('');
 $('#content').innerHTML=`<div class="grid-two"><section class="panel"><div class="panel-head"><div><h2>Audit activity trend</h2><div class="panel-sub">Daily event counts · last 30 days</div></div><span class="pill">30 DAYS</span></div><div class="report-bars">${bars||'<div class="empty">No report data yet.</div>'}</div><div class="panel-sub">Bars show recorded audit events, not unique users or business outcomes.</div></section><section class="panel"><h2>Report catalogue</h2><div class="panel-sub">Available and planned datasets</div><div class="activity"><div class="activity-row"><span class="activity-dot"></span><div><strong>Identity growth</strong><p>Available via overview totals; historical cohort reporting not yet implemented.</p></div></div><div class="activity-row"><span class="activity-dot"></span><div><strong>Payment reconciliation</strong><p>Requires provider settlement and refund ledger reconciliation.</p></div></div><div class="activity-row"><span class="activity-dot"></span><div><strong>Content and notifications</strong><p>Requires moderation and delivery event stores.</p></div></div></div></section></div>`;
}
async function renderContent() {
 const result=await api('content?limit=100');
 const rows=result.data.map(r=>`<tr><td><strong>${escapeHtml(r.content_type)} · ${escapeHtml(r.content_ref)}</strong><small>${escapeHtml(r.report_id)}</small></td><td>${escapeHtml(r.category)}</td><td>${status(r.status)}</td><td>${escapeHtml(r.tenant_id||'Platform')}</td><td>${escapeHtml(date(r.created_at))}</td><td>${escapeHtml(r.decision_reason||'—')}</td></tr>`).join('');
 $('#content').innerHTML=`<section class="panel"><div class="toolbar"><div><h2>Moderation queue</h2><div class="panel-sub">Reported items · reasoned decisions and appeal handling remain write-gated</div></div><span class="pill">${number(result.data.length)} loaded</span></div>${table(['Reported item','Category','Status','Workspace','Reported','Decision reason'],rows||'<tr><td colspan="6" class="empty">No content reports recorded.</td></tr>')}</section><p class="panel-sub">Decisions are intentionally read-only in this release. Hide/restore, warning, suspension and appeal resolution require transactional content adapters and append-only moderation events before they can be enabled.</p>`;
}
async function renderNotifications() {
 const result=await api('notifications?limit=100');
 const rows=result.data.map(n=>`<tr><td><strong>${escapeHtml(n.subject)}</strong><small>${escapeHtml(n.notification_id)}</small></td><td>${escapeHtml(n.kind)} · ${escapeHtml(n.channel)}</td><td>${escapeHtml(n.audience)}</td><td>${status(n.status)}</td><td>${number(n.attempt_count)}</td><td>${escapeHtml(date(n.scheduled_at||n.created_at))}</td><td>${escapeHtml(n.last_error_code||'—')}</td></tr>`).join('');
 $('#content').innerHTML=`<section class="panel"><div class="toolbar"><div><h2>Notification operations</h2><div class="panel-sub">Template/audience metadata and delivery state · provider dispatch is not connected</div></div><span class="pill">${number(result.data.length)} loaded</span></div>${table(['Notification','Kind / channel','Audience','Status','Attempts','Scheduled / created','Last error'],rows||'<tr><td colspan="7" class="empty">No platform notifications recorded.</td></tr>')}</section><p class="panel-sub">Send, retry, cancel and bulk broadcast actions remain disabled until a provider-backed queue, suppression checks, per-recipient delivery records and idempotent worker are connected.</p>`;
}

async function render() {
 showAlert(''); const [eyebrow,title,description]=views[state.view]; $('#eyebrow').textContent=eyebrow;$('#page-title').textContent=title;$('#page-description').textContent=description;
 $('#content').innerHTML='<div class="loading"><span class="spinner"></span> Loading platform data securely…</div>';
 try {
   if(state.view==='overview') await renderOverview();
   else if(state.view==='users') await renderUsers();
   else if(state.view==='payments') await renderPayments();
   else if(state.view==='audit') await renderAudit();
   else if(state.view==='reports') await renderReports();
   else if(state.view==='content') await renderContent();
   else if(state.view==='notifications') await renderNotifications();
   else await renderUnavailable(state.view);
 } catch(error) { showAlert(error.message);$('#content').innerHTML='<section class="panel empty">Platform data could not be loaded. No sample data has been substituted.</section>';$('#connection-state').textContent='Access or API unavailable'; }
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{state.view=button.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button));render()}));
$('#refresh').addEventListener('click',()=>render());
$('#today-label').textContent=new Intl.DateTimeFormat(undefined,{dateStyle:'full'}).format(new Date());
render();
