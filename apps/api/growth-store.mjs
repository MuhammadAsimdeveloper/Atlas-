import { randomUUID } from 'node:crypto';
import { createAuthError } from './auth-contracts.mjs';
import { createGrowthRecord, updateGrowthRecord, transitionGrowthRecord, verifyGrowthRecord, GROWTH_MODULES, planLeadStageMove, scoreLeadQualification } from '../../packages/growth-suite/index.mjs';
import { WORKFLOW_NODE_CATALOG, WORKFLOW_TRIGGER_CATALOG } from '../../packages/atlas-target/workflow-catalog.mjs';

const CRM_MODULES = new Set(['contacts', 'leads', 'pipelines', 'tasks']);
const BUILDER_MODULES = new Set(GROWTH_MODULES.filter(module => !CRM_MODULES.has(module)));
const rowToRecord = row => ({
  id: row.item_id, tenantId: row.tenant_id, module: row.module_key, title: row.title, state: row.state,
  version: row.version, payload: row.payload, checksum: row.checksum.trim(), actorId: row.updated_by,
  createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()
});

function canRead(role, permissions, module) {
  if (role === 'owner' || role === 'admin') return true;
  if (CRM_MODULES.has(module)) return role === 'member' || permissions.includes('contacts.read');
  return permissions.includes('workflows.read') || permissions.includes('workflows.write') || permissions.includes('workflows.activate');
}

function canWrite(role, permissions, module, action = 'edit') {
  if (role === 'owner' || role === 'admin') return true;
  if (CRM_MODULES.has(module)) return action === 'edit' && (role === 'member' || permissions.includes('contacts.write'));
  if (action === 'activate') return permissions.includes('workflows.activate');
  return permissions.includes('workflows.write');
}

export class PostgresGrowthStore {
  constructor(pool, { clock = () => new Date(), publisherAuthority = null, verifiedDomain = false } = {}) {
    this.pool = pool;
    this.clock = clock;
    this.publisherAuthority = publisherAuthority;
    this.verifiedDomain = verifiedDomain;
  }

  async #transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the operation error. */ }
      throw error;
    } finally { client.release(); }
  }

  async #scope(client, { actorId, tenantId }, { module = null, write = false, action = 'edit' } = {}) {
    if (typeof actorId !== 'string' || typeof tenantId !== 'string') throw createAuthError(409, 'workspace_required', 'Select an active workspace first.');
    await client.query("SELECT set_config('app.actor_id',$1,true)", [actorId]);
    const { rows } = await client.query(`
      SELECT m.role_key, m.custom_role_id, o.status AS organization_status
      FROM atlas_organization_memberships m
      JOIN atlas_organizations o ON o.tenant_id=m.tenant_id
      WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND o.status='active'
      LIMIT 1`, [tenantId, actorId]);
    const membership = rows[0];
    if (!membership) throw createAuthError(404, 'organization_not_found');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
    const role = membership.role_key;
    let permissions = [];
    if (membership.custom_role_id) {
      const custom = await client.query('SELECT permissions FROM atlas_organization_roles WHERE tenant_id=$1 AND role_id=$2', [tenantId, membership.custom_role_id]);
      permissions = Array.isArray(custom.rows[0]?.permissions) ? custom.rows[0].permissions : [];
    }
    if (module && (write ? !canWrite(role, permissions, module, action) : !canRead(role, permissions, module))) throw createAuthError(403, write ? 'growth_write_forbidden' : 'growth_read_forbidden');
    return { role, permissions };
  }

  async list({ actorId, tenantId, module, query = '', limit = 50, offset = 0 }) {
    if (!GROWTH_MODULES.includes(module)) throw createAuthError(404, 'growth_module_not_found');
    return this.#transaction(async client => {
      const scope = await this.#scope(client, { actorId, tenantId }, { module });
      const safeLimit = Math.min(100, Math.max(1, Number.isInteger(limit) ? limit : 50));
      const safeOffset = Math.min(10_000, Math.max(0, Number.isInteger(offset) ? offset : 0));
      const search = typeof query === 'string' ? query.trim().slice(0, 120) : '';
      const { rows } = await client.query(`SELECT * FROM atlas_growth_items WHERE tenant_id=$1 AND module_key=$2 AND state <> 'archived' AND ($3='' OR title ILIKE '%' || $3 || '%') ORDER BY updated_at DESC,item_id LIMIT $4 OFFSET $5`, [tenantId, module, search, safeLimit, safeOffset]);
      return { items: rows.map(rowToRecord), limit: safeLimit, offset: safeOffset, canWrite: canWrite(scope.role, scope.permissions, module) };
    });
  }

  async listPublishedQualificationProfiles({ actorId, tenantId, limit = 100 }) {
    return this.#transaction(async client => {
      await this.#scope(client, { actorId, tenantId }, { module: 'leads' });
      const safeLimit = Math.min(100, Math.max(1, Number.isInteger(limit) ? limit : 100));
      const { rows } = await client.query("SELECT * FROM atlas_growth_items WHERE tenant_id=$1 AND module_key='ai-qualification' AND state='published' ORDER BY updated_at DESC,item_id LIMIT $2", [tenantId, safeLimit]);
      const records = rows.map(rowToRecord);
      if (records.some(record => !verifyGrowthRecord(record))) throw createAuthError(500, 'growth_integrity_failed');
      return { items: records, canWrite: false, limit: safeLimit, offset: 0 };
    });
  }

  async getWorkflowCatalog({ actorId, tenantId }) {
    return this.#transaction(async client => {
      await this.#scope(client, { actorId, tenantId }, { module: 'workflows' });
      return {
        executionAvailable: false,
        previewAvailable: true,
        triggers: Object.values(WORKFLOW_TRIGGER_CATALOG),
        nodes: Object.values(WORKFLOW_NODE_CATALOG)
      };
    });
  }

  async get({ actorId, tenantId, module, id }) {
    if (!GROWTH_MODULES.includes(module)) throw createAuthError(404, 'growth_module_not_found');
    return this.#transaction(async client => {
      await this.#scope(client, { actorId, tenantId }, { module });
      const { rows } = await client.query('SELECT * FROM atlas_growth_items WHERE tenant_id=$1 AND module_key=$2 AND item_id=$3', [tenantId, module, id]);
      if (!rows[0]) throw createAuthError(404, 'growth_record_not_found');
      const record = rowToRecord(rows[0]);
      if (!verifyGrowthRecord(record)) throw createAuthError(500, 'growth_integrity_failed');
      return record;
    });
  }

  async create({ actorId, tenantId, module, payload, idempotencyKey = null }) {
    if (!GROWTH_MODULES.includes(module)) throw createAuthError(404, 'growth_module_not_found');
    return this.#transaction(async client => {
      await this.#scope(client, { actorId, tenantId }, { module, write: true });
      const id = randomUUID();
      const record = createGrowthRecord({ tenantId, module, id, payload, actorId, now: this.clock() });
      await this.#validateReferences(client, tenantId, module, record.payload);
      const inserted = await client.query(`INSERT INTO atlas_growth_items(tenant_id,item_id,module_key,title,state,version,payload,checksum,created_by,updated_by,idempotency_key,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$9,$10,$11,$11)
        ON CONFLICT (tenant_id,module_key,idempotency_key) DO NOTHING RETURNING item_id`, [tenantId, id, module, record.title, record.state, record.version, JSON.stringify(record.payload), record.checksum, actorId, idempotencyKey, record.createdAt]);
      if (!inserted.rowCount) {
        const { rows: duplicate } = await client.query('SELECT * FROM atlas_growth_items WHERE tenant_id=$1 AND module_key=$2 AND idempotency_key=$3', [tenantId, module, idempotencyKey]);
        if (duplicate[0]) return rowToRecord(duplicate[0]);
        throw createAuthError(409, 'idempotency_conflict');
      }
      await this.#appendVersion(client, record, actorId);
      await this.#event(client, { actorId, tenantId, id, module, action: 'created', version: record.version });
      return record;
    });
  }

  async update({ actorId, tenantId, module, id, expectedVersion, payload }) {
    if (!GROWTH_MODULES.includes(module)) throw createAuthError(404, 'growth_module_not_found');
    return this.#transaction(async client => {
      await this.#scope(client, { actorId, tenantId }, { module, write: true });
      const { rows } = await client.query('SELECT * FROM atlas_growth_items WHERE tenant_id=$1 AND module_key=$2 AND item_id=$3 FOR UPDATE', [tenantId, module, id]);
      if (!rows[0]) throw createAuthError(404, 'growth_record_not_found');
      const current = rowToRecord(rows[0]);
      const next = updateGrowthRecord({ record: current, tenantId, actorId, expectedVersion, payload, now: this.clock() });
      await this.#validateReferences(client, tenantId, module, next.payload);
      const changed = await client.query(`UPDATE atlas_growth_items SET title=$4,state=$5,version=$6,payload=$7::jsonb,checksum=$8,updated_by=$9,updated_at=$10
        WHERE tenant_id=$1 AND item_id=$2 AND module_key=$3 AND version=$11`, [tenantId, id, module, next.title, next.state, next.version, JSON.stringify(next.payload), next.checksum, actorId, next.updatedAt, expectedVersion]);
      if (!changed.rowCount) throw Object.assign(new Error('This record changed. Refresh and try again.'), { status: 409, code: 'version_conflict' });
      await this.#appendVersion(client, next, actorId);
      await this.#event(client, { actorId, tenantId, id, module, action: 'updated', version: next.version });
      return next;
    });
  }

  async transition({ actorId, tenantId, module, id, action, expectedVersion, publisherAuthority = null }) {
    if (!GROWTH_MODULES.includes(module)) throw createAuthError(404, 'growth_module_not_found');
    return this.#transaction(async client => {
      const authorityType = ['publish', 'pause', 'approve'].includes(action) ? 'activate' : 'edit';
      await this.#scope(client, { actorId, tenantId }, { module, write: true, action: authorityType });
      const { rows } = await client.query('SELECT * FROM atlas_growth_items WHERE tenant_id=$1 AND module_key=$2 AND item_id=$3 FOR UPDATE', [tenantId, module, id]);
      if (!rows[0]) throw createAuthError(404, 'growth_record_not_found');
      const current = rowToRecord(rows[0]);
      const next = transitionGrowthRecord({ record: current, tenantId, actorId, action, expectedVersion, publisherAuthority: publisherAuthority || this.publisherAuthority, verifiedDomain: this.verifiedDomain, now: this.clock() });
      if (next === current) return current;
      const changed = await client.query(`UPDATE atlas_growth_items SET title=$4,state=$5,version=$6,payload=$7::jsonb,checksum=$8,updated_by=$9,updated_at=$10
        WHERE tenant_id=$1 AND item_id=$2 AND module_key=$3 AND version=$11`, [tenantId, id, module, next.title, next.state, next.version, JSON.stringify(next.payload), next.checksum, actorId, next.updatedAt, expectedVersion]);
      if (!changed.rowCount) throw Object.assign(new Error('This record changed. Refresh and try again.'), { status: 409, code: 'version_conflict' });
      await this.#appendVersion(client, next, actorId);
      await this.#event(client, { actorId, tenantId, id, module, action, version: next.version });
      return next;
    });
  }

  async moveLeadStage({ actorId, tenantId, leadId, expectedVersion, stageId }) {
    return this.#transaction(async client => {
      await this.#scope(client, { actorId, tenantId }, { module: 'leads', write: true });
      const { rows } = await client.query("SELECT * FROM atlas_growth_items WHERE tenant_id=$1 AND module_key='leads' AND item_id=$2 FOR UPDATE", [tenantId, leadId]);
      if (!rows[0]) throw createAuthError(404, 'growth_record_not_found');
      const lead = rowToRecord(rows[0]);
      if (!verifyGrowthRecord(lead)) throw createAuthError(500, 'growth_integrity_failed');
      if (lead.version !== expectedVersion) throw Object.assign(new Error('This lead changed. Refresh before moving it.'), { status: 409, code: 'version_conflict' });
      const pipelineRows = await client.query("SELECT * FROM atlas_growth_items WHERE tenant_id=$1 AND module_key='pipelines' AND item_id=$2 AND state <> 'archived' FOR SHARE", [tenantId, lead.payload.pipelineId]);
      if (!pipelineRows.rows[0]) throw createAuthError(400, 'growth_reference_invalid', 'The linked pipeline is missing or belongs to another workspace.');
      const pipeline = rowToRecord(pipelineRows.rows[0]);
      const move = planLeadStageMove({ lead, pipeline, stageId });
      if (!move.changed) return lead;
      const next = updateGrowthRecord({ record: lead, tenantId, actorId, expectedVersion, payload: { ...lead.payload, stageId: move.stageId, status: move.status }, now: this.clock() });
      const changed = await client.query(`UPDATE atlas_growth_items SET title=$3,state=$4,version=$5,payload=$6::jsonb,checksum=$7,updated_by=$8,updated_at=$9
        WHERE tenant_id=$1 AND item_id=$2 AND module_key='leads' AND version=$10`, [tenantId, leadId, next.title, next.state, next.version, JSON.stringify(next.payload), next.checksum, actorId, next.updatedAt, expectedVersion]);
      if (!changed.rowCount) throw Object.assign(new Error('This lead changed. Refresh before moving it.'), { status: 409, code: 'version_conflict' });
      await this.#appendVersion(client, next, actorId);
      await this.#event(client, { actorId, tenantId, id: leadId, module: 'leads', action: 'stage_moved', version: next.version });
      return { item: next, move: { stageId: move.stageId, stageName: move.stageName, direction: move.direction } };
    });
  }

  async evaluateLead({ actorId, tenantId, profileId, leadId, expectedVersion, ratings, evidenceRefs }) {
    return this.#transaction(async client => {
      await this.#scope(client, { actorId, tenantId }, { module: 'leads', write: true });
      const profileResult = await client.query("SELECT * FROM atlas_growth_items WHERE tenant_id=$1 AND module_key='ai-qualification' AND item_id=$2 AND state='published'", [tenantId, profileId]);
      if (!profileResult.rows[0]) throw createAuthError(404, 'qualification_profile_not_found');
      const profile = rowToRecord(profileResult.rows[0]);
      if (!verifyGrowthRecord(profile)) throw createAuthError(500, 'growth_integrity_failed');
      await this.#scope(client, { actorId, tenantId }, { module: 'leads', write: true });
      const leadResult = await client.query("SELECT * FROM atlas_growth_items WHERE tenant_id=$1 AND module_key='leads' AND item_id=$2 AND state <> 'archived' FOR UPDATE", [tenantId, leadId]);
      if (!leadResult.rows[0]) throw createAuthError(404, 'growth_record_not_found');
      const lead = rowToRecord(leadResult.rows[0]);
      if (!verifyGrowthRecord(lead)) throw createAuthError(500, 'growth_integrity_failed');
      if (lead.version !== expectedVersion) throw Object.assign(new Error('This lead changed. Refresh before evaluating it.'), { status: 409, code: 'version_conflict' });
      const evaluation = scoreLeadQualification({ profile: profile.payload, ratings, evidenceRefs, now: this.clock() });
      const qualification = {
        status: evaluation.status, score: evaluation.score, reasonCodes: evaluation.reasonCodes,
        evidenceRefs: evaluation.evidenceRefs, evaluatedAt: evaluation.evaluatedAt, releaseRef: profile.id
      };
      const next = updateGrowthRecord({ record: lead, tenantId, actorId, expectedVersion, payload: { ...lead.payload, qualification }, now: this.clock() });
      await this.#validateReferences(client, tenantId, 'leads', next.payload);
      const changed = await client.query(`UPDATE atlas_growth_items SET title=$3,state=$4,version=$5,payload=$6::jsonb,checksum=$7,updated_by=$8,updated_at=$9
        WHERE tenant_id=$1 AND item_id=$2 AND module_key='leads' AND version=$10`, [tenantId, leadId, next.title, next.state, next.version, JSON.stringify(next.payload), next.checksum, actorId, next.updatedAt, expectedVersion]);
      if (!changed.rowCount) throw Object.assign(new Error('This lead changed. Refresh before evaluating it.'), { status: 409, code: 'version_conflict' });
      await this.#appendVersion(client, next, actorId);
      await this.#event(client, { actorId, tenantId, id: leadId, module: 'leads', action: 'qualification_evaluated', version: next.version });
      return { item: next, evaluation };
    });
  }

  async #appendVersion(client, record, actorId) {
    await client.query(`INSERT INTO atlas_growth_item_versions(tenant_id,item_id,version,module_key,title,state,payload,checksum,actor_id,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`, [record.tenantId, record.id, record.version, record.module, record.title, record.state, JSON.stringify(record.payload), record.checksum, actorId, record.updatedAt]);
  }

  async #validateReferences(client, tenantId, module, payload) {
    let references = [];
    if (module === 'leads') references = [[payload.contactId, 'contacts'], [payload.pipelineId, 'pipelines']];
    if (module === 'tasks') references = [[payload.contactId, 'contacts'], [payload.leadId, 'leads']].filter(([id]) => id);
    if (references.length) {
      const ids = references.map(([id]) => id);
      const { rows } = await client.query("SELECT item_id,module_key FROM atlas_growth_items WHERE tenant_id=$1 AND item_id=ANY($2::uuid[]) AND state <> 'archived'", [tenantId, ids]);
      const found = new Map(rows.map(row => [row.item_id, row.module_key]));
      for (const [id, expected] of references) if (found.get(id) !== expected) throw createAuthError(400, 'growth_reference_invalid', `The linked ${expected.replaceAll('-', ' ')} is missing or belongs to another workspace.`);
      if (module === 'leads') {
        const { rows: pipelines } = await client.query("SELECT payload FROM atlas_growth_items WHERE tenant_id=$1 AND item_id=$2 AND module_key='pipelines' AND state <> 'archived'", [tenantId, payload.pipelineId]);
        if (!pipelines[0]?.payload?.stages?.some(stage => stage.id === payload.stageId)) throw createAuthError(400, 'growth_stage_invalid', 'Choose a stage from the selected workspace pipeline.');
      }
    }
    if (module === 'tasks' && payload.assignedTo) {
      const { rows } = await client.query("SELECT user_id FROM atlas_organization_memberships WHERE tenant_id=$1 AND user_id=$2 AND status='active'", [tenantId, payload.assignedTo]);
      if (!rows[0]) throw createAuthError(400, 'growth_assignee_invalid', 'The assignee must be an active member of this workspace.');
    }
  }

  async #event(client, { actorId, tenantId, id, module, action, version }) {
    const eventId = randomUUID();
    await client.query('INSERT INTO atlas_growth_item_events(tenant_id,event_id,item_id,actor_id,module_key,action,version) VALUES ($1,$2,$3,$4,$5,$6,$7)', [tenantId, eventId, id, actorId, module, action, version]);
    await client.query('SELECT atlas_v115_append_outbox_event($1,$2,$3,$4::jsonb)', [tenantId, eventId, `${module}.${action}`, JSON.stringify({ kind: module, id, version })]);
  }

  async overview({ actorId, tenantId }) {
    return this.#transaction(async client => {
      const scope = await this.#scope(client, { actorId, tenantId });
      const { rows } = await client.query(`SELECT module_key,state,count(*)::integer AS count FROM atlas_growth_items WHERE tenant_id=$1 AND state <> 'archived' GROUP BY module_key,state`, [tenantId]);
      const counts = Object.fromEntries(GROWTH_MODULES.map(module => [module, { total: 0, active: 0, drafts: 0 }]));
      for (const row of rows) {
        const group = counts[row.module_key];
        if (!group) continue;
        group.total += row.count;
        if (['active', 'published', 'scheduled', 'open', 'in_progress'].includes(row.state)) group.active += row.count;
        if (['draft', 'review', 'paused'].includes(row.state)) group.drafts += row.count;
      }
      for (const module of GROWTH_MODULES) if (!canRead(scope.role, scope.permissions, module)) counts[module] = { total: 0, active: 0, drafts: 0 };
      return { modules: counts, capabilities: { aiExecution: false, emailDelivery: false, socialPublishing: false, workflowWorkers: false, pagePublishing: false }, status: 'tenant_database_backed' };
    });
  }

  async getSubscription({ actorId, tenantId }) {
    return this.#transaction(async client => {
      const { role, permissions } = await this.#scope(client, { actorId, tenantId });
      if (!['owner', 'admin', 'billing_admin'].includes(role) && !permissions.includes('billing.read') && !permissions.includes('billing.manage')) throw createAuthError(403, 'billing_read_forbidden');
      const { rows } = await client.query('SELECT paddle_subscription_id,paddle_customer_id,paddle_price_id,plan_key,status,current_period_ends_at,cancel_at_period_end,trial_started_at,updated_at FROM atlas_paddle_subscriptions WHERE tenant_id=$1', [tenantId]);
      return rows[0] ? { subscriptionId: rows[0].paddle_subscription_id, customerId: rows[0].paddle_customer_id, priceId: rows[0].paddle_price_id, planKey: rows[0].plan_key, status: rows[0].status, currentPeriodEndsAt: rows[0].current_period_ends_at, cancelAtPeriodEnd: rows[0].cancel_at_period_end, trialStartedAt: rows[0].trial_started_at, updatedAt: rows[0].updated_at } : null;
    });
  }

  async requireBillingManager({ actorId, tenantId }) {
    return this.#transaction(async client => {
      const { role, permissions } = await this.#scope(client, { actorId, tenantId });
      if (!['owner', 'admin', 'billing_admin'].includes(role) && !permissions.includes('billing.manage')) throw createAuthError(403, 'billing_manage_forbidden');
      return true;
    });
  }

  async applyPaddleEvent(event, bodySha256) {
    if (event.disposition !== 'apply') return { status: 'ignored' };
    return this.#transaction(async client => {
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [event.tenantId]);
      // Serialize subscription lifecycle reconciliation per tenant before comparing event times.
      // Without this lock, an older concurrent event can be marked applied after a newer one wins.
      const tenant = await client.query("SELECT tenant_id FROM atlas_organizations WHERE tenant_id=$1 AND status='active' FOR UPDATE", [event.tenantId]);
      if (!tenant.rowCount) return { status: 'ignored' };
      const existing = await client.query('SELECT last_event_occurred_at FROM atlas_paddle_subscriptions WHERE tenant_id=$1', [event.tenantId]);
      const stale = existing.rows[0] && new Date(existing.rows[0].last_event_occurred_at).getTime() > Date.parse(event.occurredAt);
      const inserted = await client.query(`INSERT INTO atlas_paddle_events(tenant_id,paddle_event_id,event_type,occurred_at,body_sha256,process_status)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id,paddle_event_id) DO NOTHING RETURNING paddle_event_id`, [event.tenantId, event.eventId, event.eventType, event.occurredAt, bodySha256, stale ? 'ignored' : 'applied']);
      if (!inserted.rowCount) return { status: 'duplicate' };
      if (stale) return { status: 'stale' };
      await client.query(`INSERT INTO atlas_paddle_subscriptions(tenant_id,paddle_subscription_id,paddle_customer_id,paddle_price_id,plan_key,status,current_period_ends_at,cancel_at_period_end,last_event_id,last_event_occurred_at,trial_started_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (tenant_id) DO UPDATE SET paddle_subscription_id=EXCLUDED.paddle_subscription_id,paddle_customer_id=EXCLUDED.paddle_customer_id,paddle_price_id=EXCLUDED.paddle_price_id,
        plan_key=EXCLUDED.plan_key,status=EXCLUDED.status,current_period_ends_at=EXCLUDED.current_period_ends_at,cancel_at_period_end=EXCLUDED.cancel_at_period_end,
        trial_started_at=coalesce(atlas_paddle_subscriptions.trial_started_at,EXCLUDED.trial_started_at),
        last_event_id=EXCLUDED.last_event_id,last_event_occurred_at=EXCLUDED.last_event_occurred_at,updated_at=EXCLUDED.updated_at
        WHERE atlas_paddle_subscriptions.last_event_occurred_at <= EXCLUDED.last_event_occurred_at`, [event.tenantId, event.subscriptionId, event.customerId, event.priceId, event.planKey, event.status, event.currentPeriodEndsAt, event.cancelAtPeriodEnd, event.eventId, event.occurredAt, event.trialStartedAt, this.clock()]);
      return { status: 'applied' };
    });
  }
}
