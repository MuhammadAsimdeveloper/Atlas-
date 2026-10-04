const element = (tag, value = '', className = '') => {
  const output = document.createElement(tag);
  if (value) output.textContent = value;
  if (className) output.className = className;
  return output;
};

const makeId = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random().toString(16).slice(2)}`}`;
const label = (text, control) => {
  const item = document.createElement('label');
  item.append(element('span', text), control);
  return item;
};
const option = (value, text) => {
  const item = document.createElement('option'); item.value = value; item.textContent = text; return item;
};

function defaultConfig(type) {
  if (type === 'condition' || type === 'switch' || type === 'random_split') return { cases: [{ id: 'yes', label: 'Yes' }] };
  if (type === 'delay' || type === 'wait_until') return { delayMs: 60_000 };
  if (type === 'split_batches') return { batchSize: 100 };
  if (type === 'rate_limit_batch') return { batchSize: 20, intervalMs: 1000 };
  return {};
}

function displayOrder(nodes, edges) {
  const trigger = nodes.find(node => node.type === 'trigger');
  if (!trigger) return nodes;
  const outgoing = new Map(nodes.map(node => [node.id, []]));
  for (const edge of edges) outgoing.get(edge.from)?.push(edge.to);
  const seen = new Set(), ordered = [], queue = [trigger.id];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const current = nodes.find(node => node.id === id);
    if (current) ordered.push(current);
    for (const target of outgoing.get(id) || []) if (!seen.has(target)) queue.push(target);
  }
  return [...ordered, ...nodes.filter(node => !seen.has(node.id))];
}

export function createWorkflowStudio(host, request) {
  const state = { catalog: null, catalogError: '', name: '', nodes: [], edges: [], readOnly: false };

  async function ensureCatalog() {
    if (state.catalog || state.catalogError) return;
    try { state.catalog = await request('/growth/workflows/catalog'); }
    catch (error) { state.catalogError = error.message || 'Workflow catalog unavailable'; }
  }

  function read() {
    if (state.catalogError) throw new Error(state.catalogError);
    const nameField = host.querySelector('[data-workflow-name]');
    if (!nameField) throw new Error('Workflow catalog is still loading. Try again in a moment.');
    const name = nameField.value.trim();
    if (!name) throw new Error('Workflow name is required.');
    const nodes = [...host.querySelectorAll('[data-workflow-node]')].map(card => {
      const source = state.nodes.find(item => item.id === card.dataset.workflowNode);
      const type = card.querySelector('[data-node-type]')?.value || source?.type;
      const nodeName = card.querySelector('[data-node-name]')?.value.trim() || source?.id;
      let config = {};
      if (type === 'trigger') {
        config = { eventType: host.querySelector('[data-workflow-trigger]')?.value };
      } else {
        try { config = JSON.parse(card.querySelector('[data-node-config]')?.value || '{}'); }
        catch { throw new Error(`Settings for “${nodeName}” must be valid JSON.`); }
        if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error(`Settings for “${nodeName}” must be a JSON object.`);
      }
      return { id: source.id, type, name: nodeName, config, retry: source.retry || { maxAttempts: 3, backoffMs: 500 }, timeoutMs: source.timeoutMs || 30_000 };
    });
    return {
      name,
      graph: {
        nodes,
        edges: state.edges.map(edge => ({ ...edge }))
      }
    };
  }

  function addStep(type) {
    const node = { id: makeId('node'), type, name: type.replaceAll('_', ' '), config: defaultConfig(type), retry: { maxAttempts: 3, backoffMs: 500 }, timeoutMs: 30_000 };
    const stops = state.nodes.filter(item => item.type === 'stop');
    if (stops.length) {
      const stopIds = new Set(stops.map(item => item.id));
      const incoming = state.edges.filter(edge => stopIds.has(edge.to));
      state.edges = state.edges.filter(edge => !stopIds.has(edge.to));
      for (const edge of incoming) state.edges.push({ ...edge, id: makeId('edge'), to: node.id });
      for (const stop of stops) state.edges.push({ id: makeId('edge'), from: node.id, to: stop.id, port: 'next' });
    } else {
      const parents = new Set(state.edges.map(edge => edge.from));
      for (const leaf of state.nodes.filter(item => !parents.has(item.id))) state.edges.push({ id: makeId('edge'), from: leaf.id, to: node.id, port: 'next' });
      const stop = { id: makeId('node'), type: 'stop', name: 'End', config: {}, retry: { maxAttempts: 3, backoffMs: 500 }, timeoutMs: 30_000 };
      state.nodes.push(node, stop);
      state.edges.push({ id: makeId('edge'), from: node.id, to: stop.id, port: 'next' });
      render();
      return;
    }
    state.nodes.push(node);
    render();
  }

  function render() {
    host.replaceChildren();
    if (!state.catalog) {
      const message = element('p', state.catalogError || 'Loading workflow capabilities…', 'workflow-catalog-error');
      host.append(message);
      return;
    }
    const header = element('div', '', 'workflow-studio-heading');
    const title = element('div'); title.append(element('span', 'Automation', 'eyebrow'), element('h3', 'Workflow Studio'));
    const badge = element('span', 'Draft definition', 'workflow-badge');
    header.append(title, badge);
    const nameInput = document.createElement('input'); nameInput.dataset.workflowName = 'true'; nameInput.maxLength = 120; nameInput.value = state.name; nameInput.required = true;
    const trigger = document.createElement('select'); trigger.dataset.workflowTrigger = 'true'; trigger.disabled = state.readOnly;
    for (const event of state.catalog.triggers) trigger.append(option(event.type, `${event.type.replaceAll('.', ' ')} · ${event.family}`));
    const primary = state.nodes.find(item => item.type === 'trigger');
    trigger.value = primary?.config?.eventType || 'contact.created';
    trigger.addEventListener('change', () => { if (primary) primary.config = { ...(primary.config || {}), eventType: trigger.value }; });
    const basics = element('div', '', 'workflow-basics');
    basics.append(label('Workflow name', nameInput), label('Starts when', trigger));

    const limitNotice = element('div', 'This deployment stores and validates workflow versions. Workflow jobs are not connected, so publish does not start runs.', 'workflow-runtime-notice');
    const canvasHead = element('div', '', 'workflow-canvas-heading');
    canvasHead.append(element('div', '', 'workflow-heading-copy'));
    canvasHead.firstChild.append(element('h4', 'Flow'), element('p', 'Connect steps to shape the path. Each node keeps its own bounded settings.'));
    const addSelect = document.createElement('select'); addSelect.dataset.addType = 'true'; addSelect.disabled = state.readOnly;
    addSelect.append(option('', 'Add a step…'));
    for (const item of state.catalog.nodes.filter(entry => !['trigger', 'stop'].includes(entry.type))) addSelect.append(option(item.type, `${item.type.replaceAll('_', ' ')} · ${item.category}`));
    const addButton = element('button', 'Add step', 'button subtle'); addButton.type = 'button'; addButton.disabled = state.readOnly;
    addButton.addEventListener('click', () => { if (addSelect.value) addStep(addSelect.value); });
    const addControls = element('div', '', 'workflow-add-controls'); addControls.append(addSelect, addButton); canvasHead.append(addControls);

    const canvas = element('div', '', 'workflow-canvas');
    const nodes = displayOrder(state.nodes, state.edges);
    for (const item of nodes) {
      const definition = state.catalog.nodes.find(candidate => candidate.type === item.type) || { category: 'unknown', risk: 'write', requiresAdapter: true, execution: 'connector' };
      const card = element('article', '', 'workflow-node'); card.dataset.workflowNode = item.id;
      const cardHeader = element('div', '', 'workflow-node-header');
      const left = element('div', '', 'workflow-node-identity'); left.append(element('span', definition.category, 'workflow-node-category'), element('strong', item.name || item.type.replaceAll('_', ' ')));
      const capability = element('span', definition.requiresAdapter ? 'Adapter needed' : 'Runtime pending', definition.requiresAdapter ? 'workflow-capability is-adapter' : 'workflow-capability');
      cardHeader.append(left, capability);
      const controls = element('div', '', 'workflow-node-fields');
      if (item.type !== 'trigger') {
        const typeSelect = document.createElement('select'); typeSelect.dataset.nodeType = 'true'; typeSelect.disabled = state.readOnly;
        for (const entry of state.catalog.nodes.filter(candidate => candidate.type !== 'trigger')) typeSelect.append(option(entry.type, `${entry.type.replaceAll('_', ' ')} · ${entry.category}`));
        typeSelect.value = item.type;
        typeSelect.addEventListener('change', () => { item.type = typeSelect.value; item.config = defaultConfig(item.type); render(); });
        controls.append(label('Step type', typeSelect));
      }
      const name = document.createElement('input'); name.dataset.nodeName = 'true'; name.value = item.name || item.type; name.maxLength = 120; name.disabled = state.readOnly;
      controls.append(label('Step name', name));
      if (item.type !== 'trigger') {
        const config = document.createElement('textarea'); config.dataset.nodeConfig = 'true'; config.rows = 3; config.spellcheck = false; config.value = JSON.stringify(item.config || {}, null, 2); config.disabled = state.readOnly;
        controls.append(label('Step settings · JSON', config));
        if (definition.requiresApproval) controls.append(element('p', 'This action is approval-gated by its server-side policy.', 'workflow-node-hint'));
        if (definition.requiresAdapter) controls.append(element('p', `Requires a configured ${definition.execution} adapter before it can run.`, 'workflow-node-hint'));
      } else controls.append(element('p', `Starts on ${item.config?.eventType || 'contact.created'}. Change the event from the workflow settings above.`, 'workflow-node-hint'));
      const footer = element('div', '', 'workflow-node-footer');
      footer.append(element('span', `Risk: ${definition.risk.replaceAll('_', ' ')}`, 'field-help'));
      if (item.type !== 'trigger') {
        const remove = element('button', 'Remove step', 'workflow-remove-node'); remove.type = 'button'; remove.disabled = state.readOnly;
        remove.addEventListener('click', () => { state.nodes = state.nodes.filter(entry => entry.id !== item.id); state.edges = state.edges.filter(edge => edge.from !== item.id && edge.to !== item.id); render(); });
        footer.append(remove);
      }
      card.append(cardHeader, controls, footer); canvas.append(card);
    }

    const connections = element('section', '', 'workflow-connections');
    const connectionHeader = element('div', '', 'workflow-connection-header'); connectionHeader.append(element('h4', `Connections · ${state.edges.length}`), element('span', 'Branches and terminal paths are checked when saved.'));
    connections.append(connectionHeader);
    for (const edge of state.edges) {
      const row = element('div', '', 'workflow-edge');
      const from = document.createElement('select'); from.dataset.edgeFrom = edge.id; from.disabled = state.readOnly;
      const to = document.createElement('select'); to.dataset.edgeTo = edge.id; to.disabled = state.readOnly;
      for (const item of state.nodes) { from.append(option(item.id, `${item.name} · ${item.type}`)); if (item.id !== edge.from) to.append(option(item.id, `${item.name} · ${item.type}`)); }
      from.value = edge.from; to.value = edge.to;
      from.addEventListener('change', () => { edge.from = from.value; });
      to.addEventListener('change', () => { edge.to = to.value; });
      const port = document.createElement('input'); port.dataset.edgePort = edge.id; port.value = edge.port || 'next'; port.maxLength = 40; port.disabled = state.readOnly;
      port.addEventListener('input', () => { edge.port = port.value; });
      const remove = element('button', 'Remove', 'workflow-remove-node'); remove.type = 'button'; remove.disabled = state.readOnly;
      remove.addEventListener('click', () => { state.edges = state.edges.filter(entry => entry.id !== edge.id); render(); });
      row.append(label('From', from), label('To', to), label('Port', port), remove); connections.append(row);
    }
    const addEdgeRow = element('div', '', 'workflow-add-edge');
    const from = document.createElement('select'); from.dataset.newEdgeFrom = 'true'; from.disabled = state.readOnly;
    const to = document.createElement('select'); to.dataset.newEdgeTo = 'true'; to.disabled = state.readOnly;
    from.append(option('', 'From step…')); to.append(option('', 'To step…'));
    for (const item of state.nodes) { from.append(option(item.id, item.name || item.type)); to.append(option(item.id, item.name || item.type)); }
    const port = document.createElement('input'); port.dataset.newEdgePort = 'true'; port.value = 'next'; port.maxLength = 40; port.setAttribute('aria-label', 'Connection port'); port.disabled = state.readOnly;
    const connect = element('button', 'Connect steps', 'button subtle'); connect.type = 'button'; connect.disabled = state.readOnly;
    connect.addEventListener('click', () => {
      if (!from.value || !to.value || from.value === to.value) return;
      state.edges.push({ id: makeId('edge'), from: from.value, to: to.value, port: port.value.trim() || 'next' }); render();
    });
    addEdgeRow.append(from, to, port, connect); connections.append(addEdgeRow);

    const footer = element('p', `Capability registry: ${state.catalog.triggers.length} event types · ${state.catalog.nodes.length} node types. “Adapter needed” means the provider operation has a contract but is not configured here.`, 'workflow-studio-footer');
    host.append(header, basics, limitNotice, canvasHead, canvas, connections, footer);
  }

  async function load(payload, { readOnly = false } = {}) {
    await ensureCatalog();
    state.readOnly = readOnly;
    state.name = payload?.name || 'New workflow';
    state.nodes = Array.isArray(payload?.graph?.nodes) ? payload.graph.nodes.map(item => ({ id: item.id, type: item.type, name: item.name || item.id, config: item.config || {}, retry: item.retry, timeoutMs: item.timeoutMs })) : [
      { id: 'start', type: 'trigger', name: 'Contact created', config: { eventType: 'contact.created' } },
      { id: 'end', type: 'stop', name: 'End', config: {} }
    ];
    state.edges = Array.isArray(payload?.graph?.edges) ? payload.graph.edges.map(edge => ({ id: edge.id || makeId('edge'), from: edge.from, to: edge.to, port: edge.port || 'next' })) : [{ id: 'first_edge', from: 'start', to: 'end', port: 'next' }];
    render();
  }

  return { load, read, render };
}
