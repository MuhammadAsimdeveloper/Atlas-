const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const state = { providers: [], query: '', category: '' };

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { accept: 'application/json', ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || 'Integration request failed.'), { status: response.status });
  return payload;
}

function card(provider) {
  const capabilities = provider.capabilities.slice(0, 7).map(item => '<span class="tag">' + esc(item.replaceAll('_',' ')) + '</span>').join('');
  const auth = provider.auth.join(' / ');
  return '<article class="content-card integration-card">' +
    '<div class="section-heading"><div><span class="eyebrow">' + esc(provider.category.replaceAll('_',' ')) + '</span><h2>' + esc(provider.name) + '</h2></div><span class="live-tag">' + esc(provider.status.replaceAll('_',' ')) + '</span></div>' +
    '<p class="settings-copy">' + esc((provider.notes || ('Connect ' + provider.name + ' to sync customer and workflow data with Atlas.')).trim()) + '</p>' +
    '<div class="tag-list">' + capabilities + '</div>' +
    '<div class="integration-meta"><span>Auth: <strong>' + esc(auth) + '</strong></span><span>Objects: <strong>' + esc(provider.objects.length) + '</strong></span><span>Events: <strong>' + esc(provider.events.length) + '</strong></span></div>' +
    '<div class="integration-actions"><button class="button secondary" type="button" data-integration-plan="' + esc(provider.id) + '">Prepare connection</button>' + (provider.docs ? '<a class="text-button" href="' + esc(provider.docs) + '" target="_blank" rel="noreferrer">Developer docs</a>' : '') + '</div>' +
    '</article>';
}

function renderList() {
  const host = $('#integration-list');
  const empty = $('#integration-empty');
  const q = state.query.toLowerCase();
  const providers = state.providers.filter(p => (!state.category || p.category === state.category) && (!q || [p.name,p.id,p.category,...p.capabilities].join(' ').toLowerCase().includes(q)));
  host.innerHTML = providers.map(card).join('');
  empty.hidden = providers.length > 0;
  host.querySelectorAll('[data-integration-plan]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const provider = state.providers.find(item => item.id === button.dataset.integrationPlan);
      const result = await request('/api/v1/integrations/connection-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-atlas-csrf': window.AtlasAuth?.csrfToken?.() || '' },
        body: JSON.stringify({ providerId: provider.id, requestedCapabilities: provider.capabilities.slice(0, 6), syncMode: provider.syncModes[0] || 'bidirectional' })
      });
      $('#integration-feedback').hidden = false;
      $('#integration-feedback').textContent = result.plan.nextSteps.join(' ');
      $('#integration-feedback').dataset.kind = 'success';
    } catch (error) {
      $('#integration-feedback').hidden = false;
      $('#integration-feedback').textContent = error.status === 403 ? 'Only workspace owners or administrators can prepare a provider connection.' : error.message;
      $('#integration-feedback').dataset.kind = 'error';
    } finally { button.disabled = false; }
  }));
}

async function render() {
  try {
    const result = await request('/api/v1/integrations/providers');
    state.providers = result.providers || [];
    const categories = [...new Set(state.providers.map(p => p.category))].sort();
    const select = $('#integration-category');
    select.replaceChildren(new Option('All provider types', ''));
    categories.forEach(category => select.append(new Option(category.replaceAll('_',' '), category)));
    renderList();
  } catch (error) {
    $('#integration-list').replaceChildren();
    $('#integration-empty').hidden = false;
    $('#integration-empty').textContent = error.message;
  }
}

$('#integration-search')?.addEventListener('input', event => { state.query = event.target.value; renderList(); });
$('#integration-category')?.addEventListener('change', event => { state.category = event.target.value; renderList(); });
window.AtlasIntegrations = { render };
