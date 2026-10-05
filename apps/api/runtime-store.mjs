import { randomUUID, createHash } from 'node:crypto';
import { createAuthError } from './auth-contracts.mjs';
import { nextScheduleOccurrence, assertIanaTimezone, boundedJson, eventDedupKey } from '../../packages/atlas-core/production-frontier.mjs';

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

  async recordAutomationEvent({ actorId, tenantId, eventRef, eventType, resourceRef, payloadHash }) {
    if (!/^[A-Za-z0-9_.:/@+-]{1,240}$/.test(eventRef || '') || !/^[a-z][a-z0-9_.:-]{0,119}$/.test(eventType || '') || !resourceRef || typeof resourceRef !== 'object' || Array.isArray(resourceRef) || !SHA256.test(payloadHash || '')) {
      throw createAuthError(400, 'automation_event_invalid');
    }
    if (!/^[A-Za-z0-9_.:/@+-]{1,160}$/.test(String(resourceRef.id || '')) || !/^[a-z][a-z0-9_.-]{0,79}$/.test(String(resourceRef.kind || '')) || (resourceRef.version !== undefined && (!Number.isSafeInteger(resourceRef.version) || resourceRef.version < 1))) {
      throw createAuthError(400, 'automation_resource_ref_invalid');
    }
    return this.#tenantTransaction({ actorId, tenantId }, async client => {
      const { rows } = await client.query('SELECT * FROM atlas_v127_record_automation_event($1,$2,$3,$4::jsonb,$5)', [tenantId,eventRef,eventType,JSON.stringify(resourceRef),payloadHash]);
      return { eventId: rows[0].event_id, inserted: rows[0].inserted };
    });
  }

  async finalizeAutomationEvent({ actorId, tenantId, eventId, matchedWorkflows, failedWorkflows }) {
    if (!UUID.test(eventId || '') || !Number.isInteger(matchedWorkflows) || !Number.isInteger(failedWorkflows)) throw createAuthError(400, 'automation_event_invalid');
    return this.#tenantTransaction({ actorId, tenantId }, async client => {
      const { rows } = await client.query('SELECT atlas_v127_finalize_automation_event($1,$2,$3,$4) AS finalized', [tenantId,eventId,matchedWorkflows,failedWorkflows]);
      if (!rows[0]?.finalized) throw createAuthError(404, 'automation_event_not_found');
      return true;
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

  async tickWorkflowExecutions(limit = 100) {
    const { rows } = await this.pool.query('SELECT atlas_v128_tick_workflow_executions($1) AS count', [limit]);
    return Number(rows[0]?.count || 0);
  }

  async reapJobs(limit = 100) {
    const { rows } = await this.pool.query('SELECT atlas_v115_reap_jobs($1) AS count', [limit]);
    return rows[0].count;
  }

  async reapOutbox(limit = 500) {
    const { rows } = await this.pool.query('SELECT atlas_v115_reap_outbox($1) AS count', [limit]);
    return rows[0].count;
  }

  async acquireRuntimeCapacity(poolId, workerId, requested, leaseSeconds = 60) {
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(poolId || '') || !/^[A-Za-z0-9_.:-]{1,120}$/.test(workerId || '') || !Number.isInteger(requested) || requested < 1 || requested > 100000) throw new TypeError('Runtime capacity request is invalid.');
    const { rows } = await this.pool.query('SELECT atlas_v138_acquire_runtime_capacity($1,$2,$3,$4) AS granted', [poolId,workerId,requested,leaseSeconds]);
    return Number(rows[0]?.granted || 0);
  }

  async releaseRuntimeCapacity(poolId, workerId, slots = 1) {
    const { rows } = await this.pool.query('SELECT atlas_v138_release_runtime_capacity($1,$2,$3) AS remaining', [poolId,workerId,slots]);
    return Number(rows[0]?.remaining || 0);
  }

  async getRuntimeCapacitySnapshot(poolId) {
    const { rows } = await this.pool.query('SELECT * FROM atlas_v138_runtime_capacity_snapshot($1)', [poolId]);
    return rows[0] || null;
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

  async getInboxMessageForWorker(job, workerId, messageId) {
    if (!job || !UUID.test(job.tenant_id || '') || !UUID.test(job.job_id || '') || !UUID.test(messageId || '') || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(workerId || '')) throw new TypeError('Worker inbox message identity is invalid.');
    const { rows } = await this.pool.query('SELECT * FROM atlas_v126_get_message_for_worker($1,$2,$3,$4)', [job.tenant_id, job.job_id, workerId, messageId]);
    return rows[0] || null;
  }

  async markInboxMessageForWorker(job, workerId, messageId, status, providerRef = null, errorCode = null) {
    if (!job || !UUID.test(job.tenant_id || '') || !UUID.test(job.job_id || '') || !UUID.test(messageId || '') || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(workerId || '') || !/^[a-z][a-z0-9_.-]{0,79}$/.test(status || '')) throw new TypeError('Worker inbox message update is invalid.');
    const { rows } = await this.pool.query('SELECT atlas_v126_mark_message_for_worker($1,$2,$3,$4,$5,$6,$7) AS updated', [job.tenant_id, job.job_id, workerId, messageId, status, providerRef, errorCode]);
    return rows[0]?.updated === true;
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

  async getExecutionInspector({ actorId, tenantId, executionId, limit = 200 } = {}) {
    if (!UUID.test(executionId || '') || !Number.isInteger(limit) || limit < 1 || limit > 500) throw createAuthError(400, 'execution_inspector_invalid');
    return this.#tenantTransaction({ actorId, tenantId }, async client => {
      const execution = await client.query('SELECT execution_id,workflow_id,workflow_version,status,started_at,finished_at,summary,checksum,graph_checksum,current_node_id,trigger_event_type,trigger_event_ref,last_error_code,retry_at,created_by,canceled_by,replay_of_execution_id,version,created_at,updated_at FROM atlas_workflow_executions WHERE tenant_id=$1 AND execution_id=$2', [tenantId, executionId]);
      if (!execution.rowCount) throw createAuthError(404, 'execution_not_found');
      const timeline = await client.query('SELECT event_id,event_type,node_id,attempt,status,details_ref,created_at FROM atlas_workflow_execution_events WHERE tenant_id=$1 AND execution_id=$2 ORDER BY created_at ASC,event_id ASC LIMIT $3', [tenantId, executionId, limit]);
      const diagnostics = await client.query('SELECT diagnostic_id,event_id,severity,code,node_id,attempt,details_ref,created_at FROM atlas_workflow_execution_diagnostics WHERE tenant_id=$1 AND execution_id=$2 ORDER BY created_at ASC,diagnostic_id ASC LIMIT $3', [tenantId, executionId, limit]);
      const replays = await client.query('SELECT replay_id,source_version,target_workflow_version,requested_by,status,reason,created_at,updated_at FROM atlas_workflow_execution_replays WHERE tenant_id=$1 AND source_execution_id=$2 ORDER BY created_at DESC LIMIT 50', [tenantId, executionId]);
      return { execution: execution.rows[0], timeline: timeline.rows, diagnostics: diagnostics.rows, replays: replays.rows };
    });
  }

  async requestExecutionReplay({ actorId, tenantId, replayId, sourceExecutionId, sourceVersion, targetWorkflowVersion, reason = null } = {}) {
    if (!UUID.test(replayId || '') || !Number.isInteger(sourceVersion) || sourceVersion < 1 || !Number.isInteger(targetWorkflowVersion) || targetWorkflowVersion < 1 || !/^[A-Za-z0-9_.:/@+-]{1,160}$/.test(sourceExecutionId || '')) throw createAuthError(400, 'execution_replay_invalid');
    return this.#tenantTransaction({ actorId, tenantId }, async client => {
      const source = await client.query('SELECT 1 FROM atlas_workflow_executions WHERE tenant_id=$1 AND execution_id=$2 AND version >= $3', [tenantId, sourceExecutionId, sourceVersion]);
      if (!source.rowCount) throw createAuthError(404, 'execution_not_found');
      await client.query('INSERT INTO atlas_workflow_execution_replays(tenant_id,replay_id,source_execution_id,source_version,target_workflow_version,requested_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7)', [tenantId,replayId,sourceExecutionId,sourceVersion,targetWorkflowVersion,actorId,reason]);
      return replayId;
    });
  }

  async createWorkflowSchedule({ actorId, tenantId, scheduleId, workflowId, workflowVersion, scheduleKind, expression, timezone, dstPolicy = 'skip', nextRunAt } = {}) {
    if (!UUID.test(scheduleId || '') || !/^[A-Za-z0-9_.:/@+-]{1,160}$/.test(workflowId || '') || !Number.isInteger(workflowVersion) || workflowVersion < 1 || !['cron','interval','calendar'].includes(scheduleKind) || typeof expression !== 'string' || expression.length < 1 || expression.length > 240 || typeof timezone !== 'string' || !['skip','shift_forward','run_once'].includes(dstPolicy) || !Number.isFinite(Date.parse(nextRunAt))) throw createAuthError(400, 'workflow_schedule_invalid');
    try { assertIanaTimezone(timezone); if(scheduleKind === 'cron') nextScheduleOccurrence({schedule_kind:scheduleKind,expression,timezone,dst_policy:dstPolicy},new Date(nextRunAt)); } catch { throw createAuthError(400,'workflow_schedule_invalid'); }
    return this.#tenantTransaction({ actorId, tenantId }, async client => {
      await client.query('INSERT INTO atlas_workflow_schedules(tenant_id,schedule_id,workflow_id,workflow_version,schedule_kind,expression,timezone,dst_policy,next_run_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [tenantId,scheduleId,workflowId,workflowVersion,scheduleKind,expression,timezone,dstPolicy,nextRunAt]);
      return scheduleId;
    });
  }

  async listWorkflowEventRoutes({ actorId, tenantId, eventType = null, limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw createAuthError(400, 'event_route_invalid');
    return this.#tenantTransaction({ actorId, tenantId }, async client => {
      const { rows } = await client.query(`SELECT route_id,workflow_id,workflow_version,event_type,priority,predicate,branch_key,dedup_window_seconds,enabled,created_at,updated_at FROM atlas_workflow_event_routes WHERE tenant_id=$1 AND ($2::text IS NULL OR event_type=$2) ORDER BY priority DESC,route_id LIMIT $3`, [tenantId,eventType,limit]);
      return rows;
    });
  }

  async createWorkflowEventRoute({ actorId, tenantId, routeId, workflowId, workflowVersion, eventType, priority = 0, predicate = {}, branchKey = null, dedupWindowSeconds = 0 }) {
    if (!UUID.test(routeId || '') || !/^[A-Za-z0-9_.:/@+-]{1,160}$/.test(workflowId || '') || !Number.isInteger(workflowVersion) || workflowVersion < 1 || !/^[a-z][a-z0-9_.:-]{0,119}$/.test(eventType || '') || !Number.isInteger(priority) || priority < -10000 || priority > 10000 || !Number.isInteger(dedupWindowSeconds) || dedupWindowSeconds < 0 || dedupWindowSeconds > 604800) throw createAuthError(400,'event_route_invalid');
    boundedJson(predicate,16000);
    return this.#tenantTransaction({ actorId, tenantId }, async client => {
      await client.query('INSERT INTO atlas_workflow_event_routes(tenant_id,route_id,workflow_id,workflow_version,event_type,priority,predicate,branch_key,dedup_window_seconds) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)',[tenantId,routeId,workflowId,workflowVersion,eventType,priority,JSON.stringify(predicate),branchKey,dedupWindowSeconds]);
      return routeId;
    });
  }

  async recordEventRouteDedup({ actorId, tenantId, routeId, eventType, eventRef, payloadHash, windowSeconds = 60 } = {}) {
    if (!UUID.test(routeId || '') || !/^[a-z][a-z0-9_.:-]{0,119}$/.test(eventType || '') || !/^[A-Za-z0-9_.:/@+-]{1,240}$/.test(eventRef || '') || !SHA256.test(payloadHash || '') || !Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 604800) throw createAuthError(400,'event_dedup_invalid');
    const key=eventDedupKey({tenantId,eventType,eventRef,payloadHash});
    return this.#tenantTransaction({ actorId, tenantId }, async client => {
      const { rows }=await client.query(`INSERT INTO atlas_workflow_event_dedup(tenant_id,dedup_key,route_id,expires_at) VALUES($1,$2,$3,now()+make_interval(secs=>$4)) ON CONFLICT(tenant_id,dedup_key) DO UPDATE SET expires_at=EXCLUDED.expires_at WHERE atlas_workflow_event_dedup.expires_at < now() RETURNING dedup_key`,[tenantId,key,routeId,windowSeconds]);
      return { key, inserted:Boolean(rows.length) };
    });
  }

  async listConnectorInstallations({ actorId, tenantId, status = null, limit = 100 } = {}) {
    if (!Number.isInteger(limit)||limit<1||limit>500) throw createAuthError(400,'connector_invalid');
    return this.#tenantTransaction({ actorId, tenantId }, async client => {
      const {rows}=await client.query(`SELECT installation_id,connector_key,external_account_ref,scopes_hash,token_expires_at,last_health_at,status,last_error_code,installed_by,created_at,updated_at FROM atlas_connector_installations WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC LIMIT $3`,[tenantId,status,limit]);
      return rows;
    });
  }

  async upsertConnectorInstallation({ actorId, tenantId, installationId, connectorKey, externalAccountRef, credentialRef = null, scopesHash = null, tokenExpiresAt = null, status='pending' }) {
    if(!UUID.test(installationId||'')||!/^[a-z][a-z0-9_.-]{1,79}$/.test(connectorKey||'')||!/^[A-Za-z0-9_.:/@+-]{1,240}$/.test(externalAccountRef||'')||!['pending','active','degraded','reauth_required','revoked','disabled'].includes(status)) throw createAuthError(400,'connector_invalid');
    if(credentialRef!==null && !/^[A-Za-z0-9_.:/@+-]{1,240}$/.test(credentialRef)) throw createAuthError(400,'credential_ref_invalid');
    if(scopesHash!==null&&!SHA256.test(scopesHash)) throw createAuthError(400,'scopes_hash_invalid');
    return this.#tenantTransaction({actorId,tenantId},async client=>{
      await client.query(`INSERT INTO atlas_connector_installations(tenant_id,installation_id,connector_key,external_account_ref,credential_ref,scopes_hash,token_expires_at,status,installed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,connector_key,external_account_ref) DO UPDATE SET credential_ref=EXCLUDED.credential_ref,scopes_hash=EXCLUDED.scopes_hash,token_expires_at=EXCLUDED.token_expires_at,status=EXCLUDED.status,updated_at=now()`,[tenantId,installationId,connectorKey,externalAccountRef,credentialRef,scopesHash,tokenExpiresAt,status,actorId]);
      return installationId;
    });
  }

  async recordConnectorHealth({ actorId, tenantId, installationId, status, code = null, detailsRef = {} } = {}) {
    if(!UUID.test(installationId||'')||!['pending','active','degraded','reauth_required','revoked','disabled'].includes(status)) throw createAuthError(400,'connector_health_invalid');
    boundedJson(detailsRef,8000);
    return this.#tenantTransaction({actorId,tenantId},async client=>{
      const {rows}=await client.query('INSERT INTO atlas_connector_health_events(tenant_id,installation_id,status,code,details_ref) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING event_id',[tenantId,installationId,status,code,JSON.stringify(detailsRef)]);
      await client.query('UPDATE atlas_connector_installations SET status=$3,last_health_at=now(),last_error_code=$4,updated_at=now() WHERE tenant_id=$1 AND installation_id=$2',[tenantId,installationId,status,code]);
      return rows[0].event_id;
    });
  }

  async listActionCatalog({ actorId, tenantId, connectorKey = null, limit = 200 } = {}) {
    if(!Number.isInteger(limit)||limit<1||limit>500) throw createAuthError(400,'action_catalog_invalid');
    return this.#tenantTransaction({actorId,tenantId},async client=>{
      const {rows}=await client.query(`SELECT a.action_key,a.connector_key,a.action_version,a.input_schema,a.output_schema,a.risk_class,a.requires_approval,a.enabled,b.enabled AS tenant_enabled,b.installation_id FROM atlas_action_catalog a LEFT JOIN atlas_tenant_action_bindings b ON b.action_key=a.action_key AND b.tenant_id=$1 WHERE ($2::text IS NULL OR a.connector_key=$2) ORDER BY a.connector_key,a.action_key LIMIT $3`,[tenantId,connectorKey,limit]);
      return rows;
    });
  }

  async bindTenantAction({ actorId, tenantId, actionKey, enabled = true, installationId = null }) {
    if(typeof actionKey!=='string'||actionKey.length<2||actionKey.length>160||!/^[a-z][a-z0-9_.:-]+$/.test(actionKey)||(installationId!==null&&!UUID.test(installationId))) throw createAuthError(400,'action_binding_invalid');
    return this.#tenantTransaction({actorId,tenantId},async client=>{
      await client.query('INSERT INTO atlas_tenant_action_bindings(tenant_id,action_key,enabled,installation_id) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,action_key) DO UPDATE SET enabled=EXCLUDED.enabled,installation_id=EXCLUDED.installation_id',[tenantId,actionKey,Boolean(enabled),installationId]);
      return actionKey;
    });
  }

  async createAgentSession({ actorId, tenantId, sessionId, agentReleaseRef, channel, customerRef = null, memoryScope='session' }) {
    if(!UUID.test(sessionId||'')||!/^[A-Za-z0-9_.:/@+-]{1,160}$/.test(agentReleaseRef||'')||!/^[a-z][a-z0-9_.-]{1,79}$/.test(channel||'')||!['none','session','tenant'].includes(memoryScope)) throw createAuthError(400,'agent_session_invalid');
    if(customerRef!==null&&!/^[A-Za-z0-9_.:/@+-]{1,240}$/.test(customerRef)) throw createAuthError(400,'customer_ref_invalid');
    return this.#tenantTransaction({actorId,tenantId},async client=>{
      await client.query('INSERT INTO atlas_ai_agent_sessions(tenant_id,session_id,agent_release_ref,channel,customer_ref,memory_scope,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenantId,sessionId,agentReleaseRef,channel,customerRef,memoryScope,actorId]);
      return sessionId;
    });
  }

  async requestAgentToolApproval({ actorId, tenantId, approvalId, sessionId, actionKey }) {
    if(!UUID.test(approvalId||'')||!UUID.test(sessionId||'')||typeof actionKey!=='string'||!/^[a-z][a-z0-9_.:-]+$/.test(actionKey)) throw createAuthError(400,'agent_approval_invalid');
    return this.#tenantTransaction({actorId,tenantId},async client=>{
      await client.query('INSERT INTO atlas_agent_tool_approvals(tenant_id,approval_id,session_id,action_key) VALUES($1,$2,$3,$4)',[tenantId,approvalId,sessionId,actionKey]);
      return approvalId;
    });
  }

  async decideAgentToolApproval({ actorId, tenantId, approvalId, status }) {
    if(!UUID.test(approvalId||'')||!['approved','denied','expired'].includes(status)) throw createAuthError(400,'agent_approval_invalid');
    return this.#tenantTransaction({actorId,tenantId},async client=>{
      const {rows}=await client.query('UPDATE atlas_agent_tool_approvals SET status=$3,decided_at=now(),decided_by=$4 WHERE tenant_id=$1 AND approval_id=$2 AND status=\'pending\' RETURNING approval_id',[tenantId,approvalId,status,actorId]);
      if(!rows.length) throw createAuthError(404,'agent_approval_not_found');
      return approvalId;
    });
  }

  async transitionAgentSession({ actorId, tenantId, sessionId, status }) {
    if(!UUID.test(sessionId||'')||!['active','waiting_approval','handoff','completed','failed','canceled'].includes(status)) throw createAuthError(400,'agent_session_invalid');
    return this.#tenantTransaction({actorId,tenantId},async client=>{
      const {rows}=await client.query('UPDATE atlas_ai_agent_sessions SET status=$3,updated_at=now() WHERE tenant_id=$1 AND session_id=$2 RETURNING session_id,status,updated_at',[tenantId,sessionId,status]);
      if(!rows.length) throw createAuthError(404,'agent_session_not_found');
      return rows[0];
    });
  }

  async listWorkflowEnvironments({ actorId, tenantId }) {
    return this.#tenantTransaction({actorId,tenantId},async client=>{
      const {rows}=await client.query('SELECT environment_id,name,stage,created_at FROM atlas_workflow_environments WHERE tenant_id=$1 ORDER BY stage,name',[tenantId]); return rows;
    });
  }

  async createWorkflowPromotion({ actorId, tenantId, promotionId, workflowId, sourceEnvironmentId, targetEnvironmentId, sourceVersion, targetVersion, manifestSha256 }) {
    if(!UUID.test(promotionId||'')||!/^[A-Za-z0-9_.:/@+-]{1,160}$/.test(workflowId||'')||!UUID.test(sourceEnvironmentId||'')||!UUID.test(targetEnvironmentId||'')||!Number.isInteger(sourceVersion)||sourceVersion<1||!Number.isInteger(targetVersion)||targetVersion<1||!SHA256.test(manifestSha256||'')) throw createAuthError(400,'promotion_invalid');
    return this.#tenantTransaction({actorId,tenantId},async client=>{
      await client.query('INSERT INTO atlas_workflow_promotions(tenant_id,promotion_id,workflow_id,source_environment_id,target_environment_id,source_version,target_version,manifest_sha256,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[tenantId,promotionId,workflowId,sourceEnvironmentId,targetEnvironmentId,sourceVersion,targetVersion,manifestSha256,actorId]);
      return promotionId;
    });
  }

  async approveWorkflowPromotion({ actorId, tenantId, promotionId, approve = true }) {
    if(!UUID.test(promotionId||'')) throw createAuthError(400,'promotion_invalid');
    return this.#tenantTransaction({actorId,tenantId},async client=>{
      const {rows}=await client.query(`UPDATE atlas_workflow_promotions SET status=$3,approved_by=$4,updated_at=now() WHERE tenant_id=$1 AND promotion_id=$2 AND status IN ('requested','approved') RETURNING promotion_id,status`,[tenantId,promotionId,approve?'approved':'failed',actorId]);
      if(!rows.length) throw createAuthError(404,'promotion_not_found');
      return rows[0];
    });
  }

  async rollbackWorkflowPromotion({ actorId, tenantId, promotionId, fromVersion, toVersion, reason }) {
    if(!UUID.test(promotionId||'')||!Number.isInteger(fromVersion)||!Number.isInteger(toVersion)||!reason||reason.length>1000) throw createAuthError(400,'rollback_invalid');
    return this.#tenantTransaction({actorId,tenantId},async client=>{
      const {rows}=await client.query('INSERT INTO atlas_workflow_rollbacks(tenant_id,promotion_id,from_version,to_version,reason,requested_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING rollback_id',[tenantId,promotionId,fromVersion,toVersion,reason,actorId]);
      await client.query("UPDATE atlas_workflow_promotions SET status='rolled_back',updated_at=now() WHERE tenant_id=$1 AND promotion_id=$2",[tenantId,promotionId]);
      return rows[0].rollback_id;
    });
  }

  async recordRuntimeHeartbeat({ poolId, workerId, queueDepth=0, activeJobs=0 } = {}) {
    if(!/^[A-Za-z0-9_.:-]{1,120}$/.test(poolId||'')||!/^[A-Za-z0-9_.:-]{1,120}$/.test(workerId||'')||!Number.isInteger(queueDepth)||queueDepth<0||!Number.isInteger(activeJobs)||activeJobs<0) throw new TypeError('runtime_heartbeat_invalid');
    const {rows}=await this.pool.query('INSERT INTO atlas_runtime_pool_heartbeats(pool_id,worker_id,queue_depth,active_jobs) VALUES($1,$2,$3,$4) ON CONFLICT(pool_id,worker_id) DO UPDATE SET queue_depth=EXCLUDED.queue_depth,active_jobs=EXCLUDED.active_jobs,observed_at=now() RETURNING observed_at',[poolId,workerId,queueDepth,activeJobs]);
    return rows[0];
  }

  async recordRuntimeSlo({ poolId, metric, value, target } = {}) {
    if(!/^[A-Za-z0-9_.:-]{1,120}$/.test(poolId||'')||!['queue_latency_ms','job_duration_ms','error_rate','success_rate','lease_recovery_rate'].includes(metric)||!Number.isFinite(value)||!Number.isFinite(target)) throw new TypeError('runtime_slo_invalid');
    const {rows}=await this.pool.query('INSERT INTO atlas_runtime_slo_samples(sample_id,pool_id,metric,value,target) VALUES($1,$2,$3,$4,$5) RETURNING sample_id,observed_at',[randomUUID(),poolId,metric,value,target]);
    return rows[0];
  }

  async listRuntimeSloPolicies() {
    const { rows } = await this.pool.query('SELECT policy_id,metric,window_seconds,target,allowed_bad_ratio,warning_bad_ratio,critical_bad_ratio,enabled FROM atlas_runtime_slo_policies WHERE enabled=true ORDER BY policy_id');
    return rows;
  }

  async evaluateRuntimeSlo({ poolId, policyId, evaluationId = randomUUID() } = {}) {
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(poolId || '') || !/^[A-Za-z0-9_.:-]{1,120}$/.test(policyId || '') || !UUID.test(evaluationId || '')) throw new TypeError('runtime_slo_evaluation_invalid');
    const { rows } = await this.pool.query('SELECT * FROM atlas_v137_evaluate_runtime_slo($1,$2,$3)', [policyId, poolId, evaluationId]);
    return rows[0] || null;
  }

  async listRuntimeAlerts({ poolId = null, status = 'open', limit = 100 } = {}) {
    if (poolId !== null && !/^[A-Za-z0-9_.:-]{1,120}$/.test(poolId || '')) throw new TypeError('runtime_alert_pool_invalid');
    if (!['open','acknowledged','resolved'].includes(status) || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new TypeError('runtime_alert_filter_invalid');
    const { rows } = await this.pool.query('SELECT alert_id,fingerprint,policy_id,pool_id,severity,status,current_value,threshold,first_seen_at,last_seen_at,acknowledged_at,resolved_at FROM atlas_runtime_alerts WHERE ($1::text IS NULL OR pool_id=$1) AND status=$2 ORDER BY last_seen_at DESC LIMIT $3', [poolId,status,limit]);
    return rows;
  }

  async claimWorkflowSchedules(limit=100) {
    if(!Number.isInteger(limit)||limit<1||limit>500) throw new TypeError('schedule_claim_invalid');
    const {rows}=await this.pool.query('SELECT * FROM atlas_v130_claim_workflow_schedules($1)',[limit]);
    return rows;
  }

  async finalizeWorkflowSchedule({tenantId,scheduleId,nextRunAt,state='active'}) {
    if(!UUID.test(tenantId||'')||!UUID.test(scheduleId||'')||!Number.isFinite(Date.parse(nextRunAt))||!['active','paused','completed'].includes(state)) throw new TypeError('schedule_finalize_invalid');
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      const {rows}=await client.query('UPDATE atlas_workflow_schedules SET next_run_at=$3,state=$4,updated_at=now() WHERE tenant_id=$1 AND schedule_id=$2 RETURNING schedule_id,next_run_at,state',[tenantId,scheduleId,nextRunAt,state]);
      await client.query('COMMIT');
      return rows[0]||null;
    }catch(error){try{await client.query('ROLLBACK');}catch{} throw error;}finally{client.release();}
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

  async recordDispatchState({ tenantId, jobId, jobType, attempt = 1, status = 'published', errorCode = null } = {}) {
    if (!UUID.test(tenantId || '') || !UUID.test(jobId || '') || !/^[a-z][a-z0-9_.-]{1,79}$/.test(jobType || '') || !Number.isInteger(attempt) || attempt < 0 || attempt > 1000 || !['pending','published','degraded','failed'].includes(status)) throw new TypeError('dispatch_state_invalid');
    const sql = "INSERT INTO atlas_runtime_dispatch_records(tenant_id,dispatch_id,job_id,job_type,priority,transport,envelope_sha256,status,attempts,last_error_code,last_attempt_at,acknowledged_at) VALUES($1,$2,$2,$3,5,'postgres',$7,$4,$5,$6,now(),CASE WHEN $4='published' THEN now() ELSE NULL END) ON CONFLICT(tenant_id,job_id) DO UPDATE SET status=EXCLUDED.status,attempts=atlas_runtime_dispatch_records.attempts+1,last_error_code=EXCLUDED.last_error_code,last_attempt_at=now(),acknowledged_at=CASE WHEN EXCLUDED.status='published' THEN now() ELSE atlas_runtime_dispatch_records.acknowledged_at END RETURNING dispatch_id,status,attempts";
    const { rows } = await this.pool.query(sql,[tenantId,jobId,jobType,status,attempt,errorCode,createHash('sha256').update(jobId).digest('hex')]); return rows[0];
  }

  async recordControlEvent(event) {
    if (!event || typeof event.eventId !== 'string' || !/^[a-f0-9-]{36}$/i.test(event.eventId)) throw new TypeError('control_event_invalid');
    const decision=JSON.stringify(event.decision||{}); if(Buffer.byteLength(decision,'utf8')>4096) throw new TypeError('control_event_too_large');
    const sql="INSERT INTO atlas_runtime_control_events(event_id,event_type,severity,pool_id,worker_id,decision,decision_sha256,occurred_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT(event_id) DO NOTHING RETURNING event_id";
    const {rows}=await this.pool.query(sql,[event.eventId,event.type,event.severity,event.poolId,event.workerId,decision,event.decisionSha256,event.occurredAt]); return rows[0]||null;
  }

  async counts() {
    const { rows } = await this.pool.query('SELECT * FROM atlas_v115_runtime_queue_counts()');
    return rows[0];
  }
}
