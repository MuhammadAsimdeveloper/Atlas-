import { createAuthError } from './auth-contracts.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const PREFIX = /^[a-f0-9]{56}$/;

export class PostgresRuntimeStore {
  constructor(pool) { this.pool = pool; }

  async #tenantTransaction({ actorId, tenantId }, work) {
    if (!UUID.test(actorId || '') || !UUID.test(tenantId || '')) throw createAuthError(409, 'workspace_required');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.actor_id',$1,true)", [actorId]);
      const membership = await client.query(`SELECT m.role_key,m.custom_role_id FROM atlas_organization_memberships m
        JOIN atlas_organizations o ON o.tenant_id=m.tenant_id
        WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND o.status='active'`, [tenantId, actorId]);
      if (!membership.rowCount) throw createAuthError(404, 'organization_not_found');
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      const role=membership.rows[0];
      if (!['owner','admin'].includes(role.role_key)) {
        const grants = role.custom_role_id ? await client.query('SELECT permissions FROM atlas_organization_roles WHERE tenant_id=$1 AND role_id=$2',[tenantId,role.custom_role_id]) : { rows:[] };
        if (!grants.rows[0]?.permissions?.includes('workflows.write')) throw createAuthError(403,'runtime_write_forbidden');
      }
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the operation error. */ }
      throw error;
    } finally { client.release(); }
  }

  async enqueueJob({ actorId, tenantId, jobId, jobType, payloadRef, idempotencyKey, runAt = null, maxAttempts = 5 }) {
    if (!UUID.test(jobId || '') || !/^[a-z][a-z0-9_.-]{1,79}$/.test(jobType || '') || !SHA256.test(idempotencyKey || '') || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 12) {
      throw createAuthError(400, 'runtime_job_invalid');
    }
    return this.#tenantTransaction({ actorId, tenantId }, async client => {
      const { rows } = await client.query('SELECT atlas_v115_enqueue_job($1,$2,$3,$4::jsonb,$5,$6,$7) AS job_id',
        [tenantId, jobId, jobType, JSON.stringify(payloadRef), idempotencyKey, runAt, maxAttempts]);
      return rows[0].job_id;
    });
  }

  async createSchedule({ actorId, tenantId, scheduleId, jobType, payloadRef, idempotencyPrefix, nextRunAt, intervalSeconds = null, maxAttempts = 5 }) {
    if (!UUID.test(scheduleId || '') || !/^[a-z][a-z0-9_.-]{1,79}$/.test(jobType || '') || !PREFIX.test(idempotencyPrefix || '') || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 12 || (intervalSeconds !== null && (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 2_678_400)) || !Number.isFinite(Date.parse(nextRunAt))) {
      throw createAuthError(400, 'runtime_schedule_invalid');
    }
    return this.#tenantTransaction({ actorId, tenantId }, async client => {
      const { rows } = await client.query('SELECT atlas_v115_create_schedule($1,$2,$3,$4::jsonb,$5,$6,$7,$8) AS schedule_id',
        [tenantId, scheduleId, jobType, JSON.stringify(payloadRef), idempotencyPrefix, nextRunAt, intervalSeconds, maxAttempts]);
      return rows[0].schedule_id;
    });
  }

  async pauseSchedule({ actorId, tenantId, scheduleId }) {
    if (!UUID.test(scheduleId || '')) throw createAuthError(400, 'runtime_schedule_invalid');
    return this.#tenantTransaction({ actorId, tenantId }, async client => {
      const { rows } = await client.query('SELECT atlas_v115_pause_schedule($1,$2) AS paused', [tenantId, scheduleId]);
      return rows[0].paused;
    });
  }

  async assertSafeWorkerRole() {
    const { rows } = await this.pool.query(`SELECT r.rolname,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,r.rolinherit,
      EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS has_memberships,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND left(c.relname,6)='atlas_' AND c.relowner=r.oid) AS owns_atlas_relation
      FROM pg_roles r WHERE r.rolname=current_user`);
    const role = rows[0];
    if (!role || role.rolname !== 'atlas_worker' || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole || role.rolinherit || role.has_memberships || role.owns_atlas_relation) {
      throw new Error('ATLAS_WORKER_DATABASE_URL must use the restricted atlas_worker role without elevated privileges, role memberships or Atlas relation ownership.');
    }
    return true;
  }

  async tickSchedules(limit = 100) {
    const { rows } = await this.pool.query('SELECT atlas_v115_tick_schedules($1) AS count', [limit]);
    return rows[0].count;
  }

  async reapJobs(limit = 100) {
    const { rows } = await this.pool.query('SELECT atlas_v115_reap_jobs($1) AS count', [limit]);
    return rows[0].count;
  }

  async reapOutbox(limit = 500) {
    const { rows } = await this.pool.query('SELECT atlas_v115_reap_outbox($1) AS count', [limit]);
    return rows[0].count;
  }

  async claimJobs(workerId, limit = 10, leaseSeconds = 60, jobTypes = null) {
    if (jobTypes !== null && (!Array.isArray(jobTypes) || jobTypes.length < 1 || jobTypes.length > 100 || jobTypes.some(type => !/^[a-z][a-z0-9_.-]{1,79}$/.test(type)))) throw new TypeError('Job type filter is invalid.');
    const { rows } = await this.pool.query('SELECT * FROM atlas_v115_claim_jobs($1,$2,$3,$4::text[])', [workerId, limit, leaseSeconds, jobTypes]);
    return rows;
  }

  async heartbeatJob(job, workerId, leaseSeconds = 60) {
    const { rows } = await this.pool.query('SELECT atlas_v115_heartbeat_job($1,$2,$3,$4) AS renewed', [job.tenant_id, job.job_id, workerId, leaseSeconds]);
    return rows[0].renewed;
  }

  async getProviderConnectionForWorker(job, workerId, connectionId) {
    if (!job || !UUID.test(job.tenant_id || '') || !UUID.test(job.job_id || '') || !UUID.test(connectionId || '') || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(workerId || '')) {
      throw new TypeError('Worker provider connection identity is invalid.');
    }
    const { rows } = await this.pool.query(
      'SELECT * FROM atlas_v125_get_provider_connection_for_worker($1,$2,$3,$4)',
      [job.tenant_id, job.job_id, workerId, connectionId]
    );
    return rows[0] || null;
  }

  async getWorkflowExecutionForJob(job, workerId) {
    const { rows } = await this.pool.query('SELECT * FROM atlas_v120_get_execution_for_job($1,$2,$3)', [job.tenant_id, job.job_id, workerId]);
    return rows[0] || null;
  }

  async updateWorkflowExecutionForJob(job, workerId, update) {
    if (!update || typeof update !== 'object') throw new TypeError('Workflow execution update is required.');
    const { rows } = await this.pool.query(
      'SELECT atlas_v120_update_execution_for_job($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13) AS updated',
      [job.tenant_id, job.job_id, workerId, update.expectedVersion, update.status, update.currentNodeId || null,
        JSON.stringify(update.state), update.stateChecksum, update.lastErrorCode || null, update.retryAt || null,
        update.finishedAt || null, update.canceledBy || null, update.updatedAt || null]
    );
    return rows[0]?.updated === true;
  }

  async appendWorkflowExecutionEventForJob(job, workerId, event = {}) {
    if (!event || typeof event !== 'object') throw new TypeError('Workflow execution event is required.');
    const { rows } = await this.pool.query(
      'SELECT atlas_v120_append_execution_event_for_job($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) AS event_id',
      [job.tenant_id, job.job_id, workerId, event.actorId || null, event.eventType, event.nodeId || null, event.attempt || null,
        event.status || null, JSON.stringify(event.detailsRef || {}), event.createdAt || null]
    );
    return rows[0]?.event_id || null;
  }

  async completeJob(job, workerId) {
    const { rows } = await this.pool.query('SELECT atlas_v115_complete_job($1,$2,$3) AS completed', [job.tenant_id, job.job_id, workerId]);
    return rows[0].completed;
  }

  async failJob(job, workerId, code) {
    const { rows } = await this.pool.query('SELECT atlas_v115_fail_job($1,$2,$3,$4) AS state', [job.tenant_id, job.job_id, workerId, code]);
    return rows[0].state;
  }

  async claimOutbox(workerId, limit = 50, leaseSeconds = 60, eventTypes = null) {
    if (eventTypes !== null && (!Array.isArray(eventTypes) || eventTypes.length < 1 || eventTypes.length > 100 || eventTypes.some(type => !/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){1,5}$/.test(type)))) throw new TypeError('Outbox event type filter is invalid.');
    const { rows } = await this.pool.query('SELECT * FROM atlas_v115_claim_outbox($1,$2,$3,$4::text[])', [workerId, limit, leaseSeconds, eventTypes]);
    return rows;
  }

  async heartbeatOutbox(event, workerId, leaseSeconds = 60) {
    const { rows } = await this.pool.query('SELECT atlas_v115_heartbeat_outbox($1,$2,$3,$4) AS renewed', [event.tenant_id, event.event_id, workerId, leaseSeconds]);
    return rows[0].renewed;
  }

  async ackOutbox(event, workerId) {
    const { rows } = await this.pool.query('SELECT atlas_v115_ack_outbox($1,$2,$3) AS acknowledged', [event.tenant_id, event.event_id, workerId]);
    return rows[0].acknowledged;
  }

  async failOutbox(event, workerId, code) {
    const { rows } = await this.pool.query('SELECT atlas_v115_fail_outbox($1,$2,$3,$4) AS state', [event.tenant_id, event.event_id, workerId, code]);
    return rows[0].state;
  }

  async counts() {
    const { rows } = await this.pool.query('SELECT * FROM atlas_v115_runtime_queue_counts()');
    return rows[0];
  }
}
