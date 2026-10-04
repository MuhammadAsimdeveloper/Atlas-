import { createHmac } from 'node:crypto';
import {
  createJobberClient,
  editJobberClient,
  getJobberAccount,
  listJobberClientsPage,
  refreshJobberToken
} from '../../../packages/atlas-integrations/jobber.mjs';
import { normalizeCrmRecord } from '../../../packages/atlas-integrations/index.mjs';
import { createGrowthRecord, updateGrowthRecord, verifyGrowthRecord } from '../../../packages/growth-suite/index.mjs';

const EVENT_TYPES = Object.freeze([
  'contacts.created','contacts.updated','contacts.integration_upserted',
  'leads.created','leads.updated','leads.stage_moved','leads.qualification_evaluated',
  'pipelines.created','pipelines.updated','tasks.created','tasks.updated'
]);

function errorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'integration_handler_failed';
}

function retryable(error) {
  return error?.code === 'jobber_rate_limited'
    || error?.code === 'jobber_timeout'
    || error?.code === 'jobber_network_error'
    || error?.code === 'zapier_timeout'
    || error?.code === 'zapier_network_error'
    || error?.status >= 500;
}

function providerError(message, code, status = 500) {
  throw Object.assign(new Error(message), { code, status });
}

function safeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function safePhone(value) {
  if (typeof value !== 'string') return null;
  const phone = value.trim();
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

function toAtlasContact(jobberClient) {
  const normalized = normalizeCrmRecord('jobber', {
    ...jobberClient,
    company: jobberClient.companyName || null,
    objectType: 'contact'
  });
  const email = safeEmail(normalized.email);
  const phone = safePhone(normalized.phone);
  if (!email && !phone) return null;
  const firstName = String(jobberClient.firstName || '').trim() || normalized.name?.split(/\s+/)[0] || jobberClient.companyName?.trim() || 'Jobber';
  const remainingName = String(jobberClient.lastName || '').trim();
  const tags = ['jobber'];
  if (jobberClient.isLead) tags.push('jobber_lead');
  if (jobberClient.isArchived) tags.push('jobber_archived');
  return {
    firstName: firstName.slice(0, 80),
    lastName: remainingName.slice(0, 80),
    email,
    phone,
    company: typeof jobberClient.companyName === 'string' && jobberClient.companyName.trim() ? jobberClient.companyName.trim().slice(0,120) : null,
    source: 'jobber',
    tags,
    timeZone: null,
    consent: { email: false, sms: false, whatsapp: false }
  };
}

function currentOrNewRecord({ mapped, tenantId, actorId, payload }) {
  if (mapped) {
    return updateGrowthRecord({
      record: {
        id: mapped.atlas_item_id,
        tenantId,
        module: mapped.module_key,
        title: mapped.title,
        state: mapped.state,
        version: Number(mapped.version),
        payload: mapped.payload,
        checksum: String(mapped.checksum).trim(),
        actorId: mapped.updated_by,
        createdAt: new Date(mapped.created_at).toISOString(),
        updatedAt: new Date(mapped.updated_at).toISOString()
      },
      tenantId,
      actorId,
      expectedVersion: Number(mapped.version),
      payload,
      now: Date.now()
    });
  }
  return createGrowthRecord({ tenantId, actorId, module: 'contacts', payload });
}

async function postJson(urlValue, payload, headers = {}, { timeoutMs = 10_000 } = {}) {
  let url;
  try { url = new URL(urlValue); } catch { providerError('Zapier target URL is invalid.', 'zapier_target_invalid', 400); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || !(host === 'hooks.zapier.com' || host.endsWith('.zapier.com') || host.endsWith('.zapier.app'))) {
    providerError('Zapier target URL is not an approved HTTPS Zapier endpoint.', 'zapier_target_invalid', 400);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Math.min(30_000, timeoutMs)));
  timer.unref?.();
  try {
    const raw = JSON.stringify(payload);
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': 'Atlas-Integrations/118',
        ...headers
      },
      body: raw,
      signal: controller.signal
    });
    if (response.status === 429) providerError('Zapier rate limit reached.', 'zapier_rate_limited', 429);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = Object.assign(new Error(`Zapier webhook returned HTTP ${response.status}.`), {
        code: 'zapier_destination_rejected',
        status: response.status,
        responseBody: body.slice(0, 300)
      });
      throw error;
    }
    return { status: response.status };
  } catch (error) {
    if (error?.code) throw error;
    if (error?.name === 'AbortError') providerError('Zapier webhook request timed out.', 'zapier_timeout', 504);
    providerError('Zapier webhook delivery failed.', 'zapier_network_error', 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function createHandlers({ runtimeStore, integrationStore, env = process.env } = {}) {
  if (!integrationStore) throw new Error('Provider handlers require ATLAS_INTEGRATION_ENCRYPTION_KEY and the V118 database migration.');

  async function jobberAccess(task) {
    const version = task.config?.graphqlVersion || env.ATLAS_JOBBER_GRAPHQL_VERSION;
    if (!version) providerError('ATLAS_JOBBER_GRAPHQL_VERSION is not configured.', 'jobber_graphql_version_missing', 503);
    const pair = await integrationStore.workerGetValidJobberSecret({
      tenantId: task.tenant_id,
      connectionId: task.connection_id,
      refresh: refreshToken => refreshJobberToken({
        clientId: env.ATLAS_JOBBER_CLIENT_ID,
        clientSecret: env.ATLAS_JOBBER_CLIENT_SECRET,
        refreshToken
      })
    });
    return { version, accessToken: pair.secret.accessToken };
  }

  async function syncOneClient(task, client) {
    const normalized = normalizeCrmRecord('jobber', { ...client, company: client.companyName || null, objectType: 'contact' });
    const payload = toAtlasContact(client);
    if (!payload) return { status: 'skipped', reason: 'missing_email_and_e164_phone', externalId: normalized.externalId };
    const mapped = await integrationStore.workerGetMappedContact({
      tenantId: task.tenant_id, connectionId: task.connection_id, externalId: normalized.externalId
    });
    if (mapped && !verifyGrowthRecord({
      id: mapped.atlas_item_id, tenantId: task.tenant_id, module: mapped.module_key, title: mapped.title, state: mapped.state,
      version: Number(mapped.version), payload: mapped.payload, checksum: String(mapped.checksum).trim(), actorId: mapped.updated_by,
      createdAt: new Date(mapped.created_at).toISOString(), updatedAt: new Date(mapped.updated_at).toISOString()
    })) providerError('Atlas contact integrity check failed.', 'atlas_contact_integrity_failed', 500);
    const record = currentOrNewRecord({ mapped, tenantId: task.tenant_id, actorId: task.connection_created_by, payload });
    const result = await integrationStore.workerUpsertContact({
      tenantId: task.tenant_id,
      connectionId: task.connection_id,
      externalId: normalized.externalId,
      sourceUpdatedAt: client.updatedAt || null,
      record
    });
    return { status: result?.result_code || 'updated', externalId: normalized.externalId, atlasItemId: result?.atlas_item_id || record.id };
  }

  async function syncClients(task, { onlyId = null } = {}) {
    const { version, accessToken } = await jobberAccess(task);
    let after = null;
    let pages = 0;
    let processed = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let foundOnly = false;
    for (;;) {
      pages += 1;
      if (pages > 50) providerError('Jobber client synchronization reached the safe page limit.', 'jobber_sync_limit', 500);
      const page = await listJobberClientsPage({
        accessToken, graphqlVersion: version, after, first: 100
      });
      for (const client of page.clients) {
        if (onlyId && client.id !== onlyId) continue;
        const outcome = await syncOneClient(task, client);
        processed += 1;
        if (outcome.status === 'created') created += 1;
        else if (outcome.status === 'updated') updated += 1;
        else skipped += 1;
        if (onlyId) { foundOnly = true; break; }
      }
      if (onlyId && foundOnly) break;
      if (!page.hasNextPage || !page.endCursor) break;
      after = page.endCursor;
    }
    if (onlyId && !foundOnly) return { mode: 'single', found: false, pages, processed: 0 };
    return { mode: onlyId ? 'single' : 'full', pages, processed, created, updated, skipped };
  }

  async function upsertJobberClient(task) {
    const atlasItemId = typeof task.request?.atlasItemId === 'string' ? task.request.atlasItemId : null;
    if (!/^[0-9a-f-]{36}$/i.test(atlasItemId || '')) providerError('A valid Atlas contact id is required.', 'atlas_contact_id_invalid', 400);
    const record = await integrationStore.workerGetGrowthRecord({ tenantId: task.tenant_id, itemId: atlasItemId });
    if (!record || record.module_key !== 'contacts') providerError('Atlas contact was not found.', 'atlas_contact_not_found', 404);
    const valid = verifyGrowthRecord({
      id: record.item_id, tenantId: task.tenant_id, module: record.module_key, title: record.title, state: record.state,
      version: Number(record.version), payload: record.payload, checksum: String(record.checksum).trim(), actorId: record.updated_by,
      createdAt: new Date(record.created_at).toISOString(), updatedAt: new Date(record.updated_at).toISOString()
    });
    if (!valid) providerError('Atlas contact integrity check failed.', 'atlas_contact_integrity_failed', 500);
    const email = safeEmail(record.payload?.email);
    if (!email) providerError('Jobber client write requires a valid Atlas contact email.', 'jobber_contact_email_required', 400);
    const { accessToken, version } = await jobberAccess(task);
    const mapped = await integrationStore.workerGetMappingForAtlasItem({
      tenantId: task.tenant_id, connectionId: task.connection_id, atlasItemId, providerObjectType: 'Client'
    });
    let external;
    if (mapped?.external_id) {
      external = await editJobberClient({
        accessToken, graphqlVersion: version, clientId: mapped.external_id,
        firstName: record.payload?.firstName || undefined,
        lastName: record.payload?.lastName || undefined,
        companyName: record.payload?.company || null,
        email
      });
    } else {
      external = await createJobberClient({
        accessToken, graphqlVersion: version,
        firstName: record.payload?.firstName || String(record.title || 'Customer').split(/\s+/)[0] || 'Customer',
        lastName: record.payload?.lastName || '',
        companyName: record.payload?.company || null,
        email
      });
    }
    await integrationStore.workerAttachMapping({
      tenantId: task.tenant_id,
      connectionId: task.connection_id,
      providerObjectType: 'Client',
      externalId: external.id,
      atlasModule: 'contacts',
      atlasItemId,
      sourceUpdatedAt: record.updated_at
    });
    await integrationStore.workerMarkHealth({ tenantId: task.tenant_id, connectionId: task.connection_id, healthy: true });
    return { status: mapped?.external_id ? 'updated' : 'created', externalId: external.id, atlasItemId };
  }

  async function executeJobberTask(task) {
    try {
      if (task.operation === 'jobber.health') {
        const { version, accessToken } = await jobberAccess(task);
        const account = await getJobberAccount({ accessToken, graphqlVersion: version });
        await integrationStore.workerMarkHealth({ tenantId: task.tenant_id, connectionId: task.connection_id, healthy: true });
        return { status: 'healthy', account: { id: account.id, name: account.name, countryCode: account.countryCode || null } };
      }
      if (task.operation === 'jobber.sync_clients') {
        const result = await syncClients(task);
        await integrationStore.workerMarkHealth({ tenantId: task.tenant_id, connectionId: task.connection_id, healthy: true });
        return result;
      }
      if (task.operation === 'jobber.sync_client') {
        const externalId = typeof task.request?.externalId === 'string' ? task.request.externalId : null;
        const result = await syncClients(task, { onlyId: externalId });
        await integrationStore.workerMarkHealth({ tenantId: task.tenant_id, connectionId: task.connection_id, healthy: true });
        return result;
      }
      if (task.operation === 'jobber.upsert_client') return await upsertJobberClient(task);
      throw Object.assign(new Error(`Unsupported Jobber integration operation: ${task.operation}`), { code: 'integration_operation_unsupported', status: 400 });
    } catch (error) {
      if (error?.code === 'jobber_reauth_required' || error?.code === 'jobber_token_expired' || error?.code === 'jobber_oauth_invalid_grant') {
        await integrationStore.workerMarkHealth({ tenantId: task.tenant_id, connectionId: task.connection_id, healthy: false, errorCode: 'jobber_reauth_required' });
      }
      throw error;
    }
  }

  async function deliverEventToZapier(payloadRef, context) {
    const record = await integrationStore.workerGetGrowthRecord({ tenantId: context.tenantId, itemId: payloadRef.id });
    if (!record) return { delivered: 0, skipped: 0, reason: 'record_not_found' };
    const connections = await integrationStore.workerListZapierConnections({ tenantId: context.tenantId });
    let delivered = 0;
    let skipped = 0;
    const failures = [];
    const payload = {
      source: 'Atlas',
      event: {
        id: context.eventId,
        type: context.eventType,
        occurredAt: new Date().toISOString(),
        version: Number(payloadRef.version || record.version)
      },
      workspace: { id: context.tenantId },
      object: {
        id: record.item_id,
        type: record.module_key,
        title: record.title,
        state: record.state,
        version: record.version,
        payload: record.payload
      }
    };
    const raw = JSON.stringify(payload);
    for (const connection of connections) {
      const delivery = await integrationStore.workerBeginZapierDelivery({
        tenantId: context.tenantId, connectionId: connection.connection_id, eventId: context.eventId, eventType: context.eventType
      });
      if (!delivery.shouldSend) { skipped += 1; continue; }
      try {
        const secret = integrationStore.decryptSecret(connection);
        const signature = secret.signingSecret
          ? createHmac('sha256', secret.signingSecret).update(raw).digest('base64url')
          : null;
        await postJson(secret.targetUrl, payload, {
          'x-atlas-event-id': context.eventId,
          'x-atlas-event-type': context.eventType,
          ...(signature ? { 'x-atlas-event-signature': signature } : {})
        });
        await integrationStore.workerCompleteZapierDelivery({
          tenantId: context.tenantId, connectionId: connection.connection_id, eventId: context.eventId, responseStatus: 200
        });
        delivered += 1;
      } catch (error) {
        await integrationStore.workerFailZapierDelivery({
          tenantId: context.tenantId, connectionId: connection.connection_id, eventId: context.eventId,
          responseStatus: Number.isInteger(error?.status) ? error.status : null, errorCode: errorCode(error)
        });
        failures.push({ connectionId: connection.connection_id, code: errorCode(error), retryable: retryable(error) });
      }
    }
    if (failures.length) {
      const error = Object.assign(new Error('One or more Zapier deliveries failed.'), { code: failures.some(item => item.retryable) ? 'zapier_delivery_retryable' : 'zapier_delivery_failed', status: failures.some(item => item.retryable) ? 502 : 400, failures });
      throw error;
    }
    return { delivered, skipped };
  }

  async function executeZapierTask(task, context) {
    if (task.operation === 'zapier.receive') {
      const webhookEventId = task.request?.webhookEventId;
      if (typeof webhookEventId === 'string' && /^[0-9a-f-]{36}$/i.test(webhookEventId)) {
        await integrationStore.workerMarkWebhookProcessed({ tenantId: task.tenant_id, webhookEventId, status: 'applied' });
      }
      return { status: 'received', webhookEventId: webhookEventId || null };
    }
    if (task.operation !== 'zapier.send_test') throw Object.assign(new Error(`Unsupported Zapier integration operation: ${task.operation}`), { code: 'integration_operation_unsupported', status: 400 });
    const connection = await integrationStore.workerGetConnection({ tenantId: task.tenant_id, connectionId: task.connection_id });
    if (connection.provider_id !== 'zapier' || connection.auth_mode !== 'webhook' || connection.status !== 'connected') {
      providerError('The selected Zapier connection is not available for testing.', 'integration_connection_unavailable', 409);
    }
    const sent = [];
    {
      const secret = integrationStore.decryptSecret(connection);
      const testId = task.task_id;
      const payload = { source: 'Atlas', type: 'integration.test', testId, workspace: { id: task.tenant_id }, message: 'Atlas ↔ Zapier connection test' };
      const raw = JSON.stringify(payload);
      const signature = secret.signingSecret ? createHmac('sha256', secret.signingSecret).update(raw).digest('base64url') : null;
      const response = await postJson(secret.targetUrl, payload, {
        'x-atlas-test-id': testId,
        ...(signature ? { 'x-atlas-event-signature': signature } : {})
      });
      sent.push({ connectionId: connection.connection_id, status: response.status });
    }
    return { sent };
  }

  async function executeTask(payload, context) {
    const taskId = payload?.id;
    const task = await integrationStore.workerGetTask({ tenantId: context.tenantId, taskId });
    if (task.status === 'succeeded' || task.status === 'canceled') return { status: task.status };
    await integrationStore.workerMarkTask(task, 'processing', null, null);
    try {
      let result;
      if (task.provider_id === 'jobber') result = await executeJobberTask(task, context);
      else if (task.provider_id === 'zapier') result = await executeZapierTask(task, context);
      else throw Object.assign(new Error(`No live worker adapter is enabled for provider ${task.provider_id}.`), { code: 'provider_adapter_unavailable', status: 400 });
      await integrationStore.workerMarkTask(task, 'succeeded', result, null);
      return result;
    } catch (error) {
      const code = errorCode(error);
      const permanent = !retryable(error) || context.attempt >= 8;
      await integrationStore.workerMarkTask(task, permanent ? 'dead_letter' : 'retryable', null, code);
      if (permanent) return { status: 'dead_letter', error: code };
      throw error;
    }
  }

  const jobHandlers = { 'integration.execute': executeTask };
  const eventHandlers = Object.fromEntries(EVENT_TYPES.map(eventType => [eventType, deliverEventToZapier]));
  return { jobHandlers, eventHandlers };
}
