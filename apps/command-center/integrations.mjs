const $ = selector => document.querySelector(selector);
const state = { providers: [], connections: [], query: '', category: '', busy: new Set() };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}

function message(text, kind = 'success') {
  const host = $('#integration-feedback');
  host.hidden = false;
  host.dataset.kind = kind;
  host.textContent = text;
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: { accept: 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || 'Integration request failed.'), { status: response.status, code: payload.error });
  return payload;
}

function csrfHeaders(contentType = null) {
  return {
    ...(contentType ? { 'content-type': contentType } : {}),
    'x-atlas-csrf': window.AtlasAuth?.csrfToken?.() || ''
  };
}

function providerConnection(providerId) {
  return state.connections.filter(connection => connection.providerId === providerId && connection.status !== 'disconnected');
}

function providerAction(provider, connection) {
  if (provider.id === 'jobber') {
    if (connection) {
      return '<button class="button secondary" type="button" data-connection-action="sync" data-connection-id="' + esc(connection.id) + '">Sync clients</button>' +
        '<button class="button secondary" type="button" data-connection-action="health" data-connection-id="' + esc(connection.id) + '">Health check</button>';
    }
    return '<button class="button primary" type="button" data-connect-jobber>Connect Jobber</button>';
  }
  if (provider.id === 'zapier') {
    if (connection) return '<button class="button secondary" type="button" data-connection-action="test" data-connection-id="' + esc(connection.id) + '">Send test</button>';
    return '<button class="button primary" type="button" data-zapier-setup>Connect webhook</button>';
  }
  return '<button class="button secondary" type="button" data-integration-plan="' + esc(provider.id) + '">Prepare connection</button>';
}

function card(provider) {
  const connection = providerConnection(provider.id)[0] || null;
  const capabilities = provider.capabilities.slice(0, 7).map(item => '<span class="tag">' + esc(item.replaceAll('_', ' ')) + '</span>').join('');
  const auth = provider.auth.join(' / ');
  const status = connection ? connection.status : provider.status;
  const detail = connection
    ? (connection.externalAccountName || connection.displayName || 'Connected workspace')
    : provider.status === 'catalog' ? 'Adapter not enabled yet' : 'Ready for live connection';
  return '<article class="content-card integration-card">' +
    '<div class="section-heading"><div><span class="eyebrow">' + esc(provider.category.replaceAll('_', ' ')) + '</span><h2>' + esc(provider.name) + '</h2></div><span class="live-tag">' + esc(status.replaceAll('_', ' ')) + '</span></div>' +
    '<p class="settings-copy">' + esc((provider.notes || ('Connect ' + provider.name + ' to sync customer and workflow data with Atlas.')).trim()) + '</p>' +
    '<div class="tag-list">' + capabilities + '</div>' +
    '<div class="integration-meta"><span>Auth: <strong>' + esc(auth) + '</strong></span><span>Objects: <strong>' + esc(provider.objects.length) + '</strong></span><span>Events: <strong>' + esc(provider.events.length) + '</strong></span></div>' +
    '<div class="integration-connection-detail"><span>' + esc(detail) + '</span>' + (connection?.lastHealthStatus ? '<span>Health: ' + esc(connection.lastHealthStatus) + '</span>' : '') + '</div>' +
    '<div class="integration-actions">' + providerAction(provider, connection) + (connection ? '<button class="text-button" type="button" data-connection-action="disconnect" data-connection-id="' + esc(connection.id) + '">Disconnect</button>' : '') + (provider.docs ? '<a class="text-button" href="' + esc(provider.docs) + '" target="_blank" rel="noreferrer">Developer docs</a>' : '') + '</div>' +
    '</article>';
}

function renderConnections() {
  const host = $('#integration-connections');
  if (!host) return;
  if (!state.connections.length) {
    host.innerHTML = '<div class="integration-connection-empty">No provider connections yet. Connect Jobber with OAuth or add a Zapier webhook.</div>';
    return;
  }
  host.innerHTML = state.connections.map(connection =>
    '<div class="integration-connection-row">' +
      '<div><strong>' + esc(connection.displayName || connection.providerId) + '</strong><span>' + esc(connection.providerId) + (connection.externalAccountName ? ' · ' + esc(connection.externalAccountName) : '') + '</span></div>' +
      '<div class="integration-connection-status"><span class="live-tag">' + esc(connection.status.replaceAll('_', ' ')) + '</span><span>' + esc(connection.lastHealthStatus || 'health unknown') + '</span></div>' +
    '</div>'
  ).join('');
}

function renderList() {
  const host = $('#integration-list');
  const empty = $('#integration-empty');
  const q = state.query.toLowerCase();
  const providers = state.providers.filter(provider =>
    (!state.category || provider.category === state.category) &&
    (!q || [provider.name, provider.id, provider.category, ...provider.capabilities].join(' ').toLowerCase().includes(q))
  );
  host.innerHTML = providers.map(card).join('');
  empty.hidden = providers.length > 0;
  bindActions();
}

async function refreshConnections() {
  try {
    const result = await request('/api/v1/integrations/connections');
    state.connections = result.connections || [];
  } catch (error) {
    state.connections = [];
    if (error.status !== 403) message(error.message, 'error');
  }
  renderConnections();
  renderList();
}

async function doConnectionAction(button) {
  const id = button.dataset.connectionId;
  const action = button.dataset.connectionAction;
  const key = action + ':' + id;
  if (state.busy.has(key)) return;
  state.busy.add(key);
  button.disabled = true;
  try {
    const result = await request('/api/v1/integrations/connections/' + encodeURIComponent(id) + '/' + action, {
      method: 'POST',
      headers: csrfHeaders()
    });
    if (action === 'disconnect') {
      message('The provider connection was disconnected and its stored credentials were removed.');
      await refreshConnections();
    } else {
      message(result.task ? 'The ' + action + ' job was queued. The worker will update the result when it finishes.' : 'Connection updated.');
    }
  } catch (error) {
    message(error.message, 'error');
  } finally {
    button.disabled = false;
    state.busy.delete(key);
  }
}

async function connectJobber(button) {
  button.disabled = true;
  try {
    const result = await request('/api/v1/integrations/oauth/jobber/start', {
      method: 'POST',
      headers: csrfHeaders()
    });
    window.location.assign(result.authorizeUrl);
  } catch (error) {
    message(error.message, 'error');
    button.disabled = false;
  }
}

async function createZapierConnection(button) {
  const form = $('#zapier-form');
  const displayName = $('#zapier-display-name').value.trim();
  const targetUrl = $('#zapier-target-url').value.trim();
  const signingSecret = $('#zapier-signing-secret').value;
  if (!targetUrl) return message('Paste the Zapier Catch Hook URL first.', 'error');
  button.disabled = true;
  try {
    const result = await request('/api/v1/integrations/zapier/connections', {
      method: 'POST',
      headers: csrfHeaders('application/json'),
      body: JSON.stringify({ displayName, targetUrl, signingSecret })
    });
    form.hidden = true;
    $('#zapier-result').hidden = false;
    $('#zapier-result').innerHTML = '<strong>Zapier endpoint created.</strong><p>Use this one-time Atlas inbound URL in a Zap to send events back into this workspace:</p><code>' + esc(result.inboundUrl) + '</code><p>Store the inbound key securely; Atlas will not show it again.</p>';
    $('#zapier-target-url').value = '';
    $('#zapier-signing-secret').value = '';
    await refreshConnections();
    message('Zapier webhook connection created.');
  } catch (error) {
    message(error.message, 'error');
  } finally { button.disabled = false; }
}

async function bindActions() {
  document.querySelectorAll('[data-connect-jobber]').forEach(button => button.onclick = () => connectJobber(button));
  document.querySelectorAll('[data-zapier-setup]').forEach(button => button.onclick = () => {
    $('#zapier-form').hidden = false;
    $('#zapier-result').hidden = true;
    $('#zapier-target-url')?.focus();
  });
  document.querySelectorAll('[data-connection-action]').forEach(button => button.onclick = () => doConnectionAction(button));
  document.querySelectorAll('[data-integration-plan]').forEach(button => button.onclick = async () => {
    button.disabled = true;
    try {
      const provider = state.providers.find(item => item.id === button.dataset.integrationPlan);
      const result = await request('/api/v1/integrations/connection-plan', {
        method: 'POST',
        headers: csrfHeaders('application/json'),
        body: JSON.stringify({ providerId: provider.id, requestedCapabilities: provider.capabilities.slice(0, 6), syncMode: provider.syncModes[0] || 'bidirectional' })
      });
      message(result.plan.nextSteps.join(' '));
    } catch (error) {
      message(error.status === 403 ? 'Only workspace owners or administrators can prepare a provider connection.' : error.message, 'error');
    } finally { button.disabled = false; }
  });
}

async function render() {
  try {
    const result = await request('/api/v1/integrations/providers');
    state.providers = result.providers || [];
    const categories = [...new Set(state.providers.map(p => p.category))].sort();
    const select = $('#integration-category');
    select.replaceChildren(new Option('All provider types', ''));
    categories.forEach(category => select.append(new Option(category.replaceAll('_', ' '), category)));
    renderConnections();
    renderList();
    await refreshConnections();
  } catch (error) {
    $('#integration-list').replaceChildren();
    $('#integration-empty').hidden = false;
    $('#integration-empty').textContent = error.message;
  }
}

$('#integration-search')?.addEventListener('input', event => { state.query = event.target.value; renderList(); });
$('#integration-category')?.addEventListener('change', event => { state.category = event.target.value; renderList(); });
$('#zapier-submit')?.addEventListener('click', () => createZapierConnection($('#zapier-submit')));
window.AtlasIntegrations = { render };
