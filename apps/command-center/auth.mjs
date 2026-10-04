const PERMISSIONS = [
  ['dashboard.read', 'Read dashboard'], ['contacts.read', 'View contacts'], ['contacts.write', 'Edit contacts'],
  ['workflows.read', 'View automations'], ['workflows.write', 'Edit automations'], ['workflows.activate', 'Activate automations'],
  ['inbox.read', 'View conversations'], ['inbox.respond', 'Respond to customers'], ['billing.read', 'View billing'],
  ['billing.manage', 'Manage billing'], ['reports.read', 'View reports'], ['integrations.read', 'View integrations'], ['integrations.manage', 'Manage integrations']
];
const state = { csrf: null, me: null, dashboard: null, organizations: [], members: [], invitations: [], roles: [], inviteToken: null };
const $ = selector => document.querySelector(selector);
const element = (tag, text, className = '') => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };

function setAuthNotice(message, kind = 'info') {
  const notice = $('#auth-notice');
  notice.hidden = !message;
  notice.dataset.kind = kind;
  notice.textContent = message || '';
}

function setWorkspaceNotice(message, kind = 'info') {
  const notice = $('#workspace-notice');
  notice.hidden = !message;
  notice.dataset.kind = kind;
  notice.textContent = message || '';
  $('#footer-status').textContent = message ? (kind === 'error' ? 'Needs attention' : 'Updated') : 'Ready';
}

function showAuth(view = 'login', message = '', kind = 'info') {
  $('#auth-shell').hidden = false;
  $('#workspace').hidden = true;
  const views = { login: '#login-form', signup: '#signup-form', forgot: '#forgot-form', reset: '#reset-form' };
  for (const [key, selector] of Object.entries(views)) $(selector).hidden = key !== view;
  $('#auth-title').textContent = ({ login: 'Welcome back', signup: 'Create your workspace', forgot: 'Reset your password', reset: 'Choose a new password' })[view];
  $('#auth-description').textContent = ({ login: 'Sign in to your secure company workspace.', signup: 'Start with a private workspace for your company.', forgot: 'We will send a link if this address has an Atlas account.', reset: 'Choose a strong password to secure your account.' })[view];
  $('#auth-switch').hidden = view === 'forgot' || view === 'reset';
  $('#auth-switch').replaceChildren(
    element('span', view === 'signup' ? 'Already have an account?' : 'New to Atlas?'),
    Object.assign(element('button', view === 'signup' ? 'Sign in' : 'Create an account', 'text-button'), { type: 'button' })
  );
  $('#auth-switch button').dataset.view = view === 'signup' ? 'login' : 'signup';
  setAuthNotice(message, kind);
}

async function request(path, { method = 'GET', body, csrf = false } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrf && state.csrf) headers['x-atlas-csrf'] = state.csrf;
  const response = await fetch(`/api/v1${path}`, { method, headers, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || 'Atlas could not complete the request.');
    error.status = response.status;
    error.code = payload.error;
    throw error;
  }
  return payload;
}

function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
function setBusy(form, busy) { const button = form.querySelector('button[type="submit"]'); if (button) { button.disabled = busy; button.setAttribute('aria-busy', String(busy)); } }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date); }

function renderOrganizationPicker() {
  const picker = $('#workspace-picker');
  picker.replaceChildren();
  for (const org of state.organizations) {
    const option = document.createElement('option');
    option.value = org.id;
    option.textContent = org.name;
    option.selected = org.id === state.me.activeOrganization?.id;
    picker.append(option);
  }
  const create = document.createElement('option');
  create.value = '__create__'; create.textContent = '+ Create a workspace';
  picker.append(create);
}

function renderWorkspace(me) {
  state.me = me;
  state.csrf = me.csrfToken || state.csrf;
  state.organizations = me.organizations || [];
  $('#auth-shell').hidden = true;
  $('#workspace').hidden = false;
  const name = me.activeOrganization?.name || 'Your workspace';
  $('#welcome-title').textContent = name;
  $('#active-role').textContent = me.activeOrganization?.role?.replaceAll('_', ' ') || 'Choose a workspace';
  $('#sidebar-user').textContent = me.user.displayName;
  $('#user-avatar').textContent = me.user.displayName.trim().slice(0, 1).toUpperCase() || 'A';
  renderOrganizationPicker();
  $('#overview-panel').hidden = false;
  $('#growth-panel').hidden = true;
  $('#team-panel').hidden = true;
  $('#page-title').textContent = 'Overview';
  $('#breadcrumb').textContent = 'Workspace overview';
  loadDashboard();
}

async function loadDashboard() {
  try {
    const result = await request('/dashboard/summary');
    state.dashboard = result;
    $('#metric-members').textContent = String(result.metrics.activeMembers);
    $('#metric-invites').textContent = String(result.metrics.pendingInvitations);
    $('#metric-activity').textContent = String(result.metrics.auditEventsLast7Days);
    setWorkspaceNotice('Live account and workspace metrics updated.', 'success');
    setTimeout(() => setWorkspaceNotice(''), 2200);
  } catch (error) {
    $('#metric-members').textContent = '—'; $('#metric-invites').textContent = '—'; $('#metric-activity').textContent = '—';
    setWorkspaceNotice(error.status === 409 ? 'Select a workspace to see its live metrics.' : error.message, error.status >= 500 ? 'error' : 'info');
  }
}

function renderMembers() {
  const rows = $('#member-rows');
  rows.replaceChildren();
  for (const member of state.members) {
    const row = document.createElement('tr');
    row.append(element('td', member.displayName || 'Atlas member'), element('td', member.email), element('td', (member.customRoleName || member.role).replaceAll('_', ' ')), element('td', member.status.replaceAll('_', ' ')));
    rows.append(row);
  }
  $('#team-count').textContent = `${state.members.length} ${state.members.length === 1 ? 'person' : 'people'}`;
}

function renderInvitations() {
  const list = $('#invitation-list');
  list.replaceChildren();
  const active = state.invitations.filter(item => item.status === 'pending');
  $('#invitation-empty').hidden = active.length > 0;
  for (const invitation of active) {
    const row = document.createElement('div'); row.className = 'list-row';
    const identity = document.createElement('div'); identity.append(element('strong', invitation.email), element('small', `${invitation.role.replaceAll('_', ' ')} · expires ${formatDate(invitation.expiresAt)}`));
    row.append(identity, element('span', 'Pending', 'module-state')); list.append(row);
  }
}

function renderRoles() {
  const list = $('#role-list'); list.replaceChildren();
  if (!state.roles.length) list.append(element('div', 'No custom roles yet.', 'empty-state'));
  for (const role of state.roles) {
    const row = document.createElement('div'); row.className = 'role-row';
    const label = document.createElement('div'); label.append(element('strong', role.name), element('small', role.key));
    row.append(label, element('span', `${role.permissions.length} permissions`, 'module-state')); list.append(row);
  }
  const picker = $('#invite-role');
  if (picker) {
    const builtIns = [['member','Member'],['viewer','Viewer'],['billing_admin','Billing administrator'],['admin','Administrator']];
    picker.replaceChildren(...builtIns.map(([value,label]) => { const option = document.createElement('option'); option.value=value; option.textContent=label; return option; }));
    for (const role of state.roles) { const option = document.createElement('option'); option.value=role.key; option.textContent=`${role.name} · custom`; option.dataset.customRoleId=role.id; picker.append(option); }
  }
}

async function loadTeam() {
  const id = state.me?.activeOrganization?.id;
  if (!id) { setWorkspaceNotice('Create or select a workspace before managing its team.', 'info'); return; }
  try {
    const [members, invitations, roles] = await Promise.all([
      request(`/organizations/${id}/members`), request(`/organizations/${id}/invitations`), request(`/organizations/${id}/roles`)
    ]);
    state.members = members.members; state.invitations = invitations.invitations; state.roles = roles.roles;
    renderMembers(); renderInvitations(); renderRoles();
    const canManage = ['owner', 'admin'].includes(state.me.activeOrganization.role);
    $('#invite-card').hidden = !canManage; $('#role-card').hidden = !canManage;
  } catch (error) {
    state.members = []; renderMembers();
    setWorkspaceNotice(error.status === 403 ? 'Team access is available to workspace owners and administrators.' : error.message, error.status >= 500 ? 'error' : 'info');
  }
}

function openPanel(panel) {
  const isTeam = panel === 'team';
  const isGrowth = panel === 'growth';
  $('#overview-panel').hidden = isTeam || isGrowth;
  $('#growth-panel').hidden = !isGrowth;
  $('#team-panel').hidden = !isTeam;
  $('#page-title').textContent = isTeam ? 'Team & access' : isGrowth ? 'Growth Center' : 'Overview';
  $('#breadcrumb').textContent = isTeam ? 'Workspace settings' : isGrowth ? 'Customer operations' : 'Workspace overview';
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.panel === panel));
  if (isTeam) loadTeam(); else if (isGrowth) window.AtlasGrowth?.activate(); else loadDashboard();
}

async function completeSignIn(payload) {
  state.csrf = payload.csrfToken;
  const me = await request('/me');
  renderWorkspace(me);
  if (state.inviteToken) {
    try {
      const accepted = await request('/invitations/accept', { method: 'POST', body: { token: state.inviteToken }, csrf: true });
      state.inviteToken = null;
      setWorkspaceNotice(`Invitation accepted for ${accepted.organization.name}.`, 'success');
      const updated = await request('/me'); renderWorkspace(updated);
    } catch (error) { setWorkspaceNotice(error.message, 'error'); }
  }
}

$('#auth-shell').addEventListener('click', event => {
  const button = event.target.closest('[data-view]');
  if (button) showAuth(button.dataset.view);
});
document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => openPanel(button.dataset.panel)));
document.querySelectorAll('[data-open-growth]').forEach(button => button.addEventListener('click', () => openPanel('growth')));

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
  try { const result = await request('/auth/login', { method: 'POST', body: formData(form) }); await completeSignIn(result); }
  catch (error) { setAuthNotice(error.status === 503 ? 'Atlas account services are not connected yet.' : error.message, 'error'); }
  finally { setBusy(form, false); }
});

$('#signup-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
  try {
    await request('/auth/signup', { method: 'POST', body: formData(form) });
    showAuth('login', 'If the account can be created, Atlas will send an email verification link. Open that link before signing in.', 'success');
  } catch (error) { setAuthNotice(error.message, 'error'); }
  finally { setBusy(form, false); }
});

$('#forgot-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
  try { await request('/auth/password/forgot', { method: 'POST', body: formData(form) }); showAuth('login', 'If the account exists, Atlas will send a password reset link.', 'success'); }
  catch (error) { setAuthNotice(error.message, 'error'); }
  finally { setBusy(form, false); }
});

$('#reset-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
  try { await request('/auth/password/reset', { method: 'POST', body: { token: state.resetToken, password: formData(form).password } }); state.resetToken = null; showAuth('login', 'Your password has been updated. Sign in again.', 'success'); history.replaceState({}, '', '/'); }
  catch (error) { setAuthNotice(error.message, 'error'); }
  finally { setBusy(form, false); }
});

$('#logout-button').addEventListener('click', async () => {
  try { await request('/auth/logout', { method: 'POST', csrf: true }); }
  catch (error) { setWorkspaceNotice(error.message, 'error'); return; }
  state.me = null; state.csrf = null; showAuth('login', 'You have signed out.', 'success');
});

$('#workspace-picker').addEventListener('change', async event => {
  if (event.target.value === '__create__') {
    renderOrganizationPicker();
    $('#create-workspace-form').reset(); $('#dialog-notice').hidden = true;
    $('#workspace-dialog').showModal();
    return;
  }
  try { await request(`/organizations/${event.target.value}/select`, { method: 'POST', csrf: true }); const me = await request('/me'); renderWorkspace(me); }
  catch (error) { setWorkspaceNotice(error.message, 'error'); renderOrganizationPicker(); }
});

$('#cancel-workspace').addEventListener('click', () => $('#workspace-dialog').close());
$('#create-workspace-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
  $('#dialog-notice').hidden = true;
  try {
    await request('/organizations', { method: 'POST', body: { name: formData(form).name }, csrf: true });
    $('#workspace-dialog').close(); const me = await request('/me'); renderWorkspace(me); setWorkspaceNotice('Workspace created and selected.', 'success');
  } catch (error) { const notice = $('#dialog-notice'); notice.hidden=false; notice.dataset.kind='error'; notice.textContent=error.message; }
  finally { setBusy(form, false); }
});

$('#invite-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
  try {
    const id = state.me.activeOrganization.id;
    const fields = formData(form); const option = $('#invite-role').selectedOptions[0];
    const result = await request(`/organizations/${id}/invitations`, { method: 'POST', body: { ...fields, ...(option.dataset.customRoleId ? { customRoleId: option.dataset.customRoleId } : {}) }, csrf: true });
    form.reset(); await loadTeam(); setWorkspaceNotice(result.delivery === 'sent' ? 'Invitation email sent.' : 'Invitation saved, but email delivery is unavailable. Check the provider setup before asking the teammate to join.', result.delivery === 'sent' ? 'success' : 'error');
  } catch (error) { setWorkspaceNotice(error.message, 'error'); }
  finally { setBusy(form, false); }
});

$('#permission-options').replaceChildren(...PERMISSIONS.map(([value, label]) => {
  const wrapper = document.createElement('label'); wrapper.className = 'permission-option';
  const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'permission'; input.value = value;
  wrapper.append(input, element('span', label)); return wrapper;
}));

$('#role-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget; setBusy(form, true);
  const data = formData(form); const keyInput = form.elements.key.value.trim();
  const permissions = [...form.querySelectorAll('input[name="permission"]:checked')].map(input => input.value);
  try {
    const id = state.me.activeOrganization.id;
    await request(`/organizations/${id}/roles`, { method: 'POST', body: { key: `custom:${keyInput}`, name: data.name, permissions }, csrf: true });
    form.reset(); await loadTeam(); setWorkspaceNotice('Custom workspace role saved.', 'success');
  } catch (error) { setWorkspaceNotice(error.message, 'error'); }
  finally { setBusy(form, false); }
});

async function initialize() {
  const params = new URLSearchParams(location.search);
  if (location.pathname === '/verify-email' && params.has('token')) {
    const token = params.get('token'); history.replaceState({}, '', '/');
    try { await request('/auth/verify-email', { method: 'POST', body: { token } }); showAuth('login', 'Email verified. You can now sign in.', 'success'); }
    catch (error) { showAuth('login', error.message, 'error'); }
    return;
  }
  if (location.pathname === '/reset-password' && params.has('token')) {
    state.resetToken = params.get('token'); history.replaceState({}, '', '/'); showAuth('reset'); return;
  }
  if (location.pathname === '/accept-invitation' && params.has('token')) {
    state.inviteToken = params.get('token'); history.replaceState({}, '', '/');
  }
  try {
    const me = await request('/me');
    state.csrf = me.csrfToken;
    renderWorkspace(me);
    if (state.inviteToken) {
      const result = await request('/invitations/accept', { method: 'POST', body: { token: state.inviteToken }, csrf: true });
      state.inviteToken = null; setWorkspaceNotice(`Invitation accepted for ${result.organization.name}.`, 'success'); renderWorkspace(await request('/me'));
    }
  } catch (error) {
    const message = state.inviteToken ? 'Sign in with the invited email to accept this workspace invitation.' : error.status === 503 ? 'Account services are not connected yet. Configure PostgreSQL and apply the migrations.' : '';
    showAuth('login', message, error.status === 503 ? 'error' : 'info');
  }
}

initialize();
