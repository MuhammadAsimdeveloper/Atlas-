import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { PostgresRuntimeStore } from './runtime-store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const digest = value => createHash('sha256').update(value).digest('hex');
const actorA='11111111-1111-4111-8111-111111111111', tenantA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorB='22222222-2222-4222-8222-222222222222', tenantB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const memberA='33333333-3333-4333-8333-333333333333';

async function database() {
  const db = new PGlite();
  const migrationDirectory = path.join(root,'infra/postgres');
  await db.exec('CREATE ROLE atlas_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;');
  const files = (await readdir(migrationDirectory)).filter(name => /^FINAL-MIGRATION-V[0-9]+(?:-V[0-9]+)?\.sql$/.test(name)).sort((a,b) => Number(a.match(/V([0-9]+)/)[1])-Number(b.match(/V([0-9]+)/)[1]) || a.localeCompare(b));
  for (const file of files) await db.exec(await readFile(path.join(migrationDirectory,file),'utf8'));
  await db.exec('CREATE ROLE atlas_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN NOBYPASSRLS;');
  for (const grant of ['API-ROLE-GRANTS-V112.sql','API-ROLE-GRANTS-V114.sql','API-ROLE-GRANTS-V115.sql','API-ROLE-GRANTS-V119.sql','API-ROLE-GRANTS-V120.sql','API-ROLE-GRANTS-V136.sql','API-ROLE-GRANTS-V137.sql','API-ROLE-GRANTS-V138.sql','API-ROLE-GRANTS-V148.sql','API-ROLE-GRANTS-V149.sql']) await db.exec(await readFile(path.join(migrationDirectory,grant),'utf8'));
  await db.exec(`INSERT INTO atlas_auth_users(user_id,email,display_name,password_hash,email_verified_at) VALUES
    ('${actorA}','owner-a@runtime.test','Owner A','scrypt$test',now()),
    ('${actorB}','owner-b@runtime.test','Owner B','scrypt$test',now()),
    ('${memberA}','member-a@runtime.test','Member A','scrypt$test',now());
    INSERT INTO atlas_organizations(tenant_id,name,slug,created_by) VALUES
    ('${tenantA}','Runtime A','runtime-a','${actorA}'),
    ('${tenantB}','Runtime B','runtime-b','${actorB}');
    INSERT INTO atlas_organization_memberships(tenant_id,user_id,role_key) VALUES
    ('${tenantA}','${actorA}','owner'),('${tenantB}','${actorB}','owner'),('${tenantA}','${memberA}','member');`);
  await db.exec('SET ROLE atlas_app;');
  const pool = { connect: async () => ({ query: (...args) => db.query(...args), release() {} }), query: (...args) => db.query(...args), end: async () => {} };
  return { db,pool,api:new PostgresRuntimeStore(pool) };
}

test('V115 tenant enqueue/schedule APIs and worker leases, retries, scheduler and outbox obey isolated roles', async () => {
  const { db,pool,api } = await database();
  const firstJobId=randomUUID();
  const firstKey=digest('tenant-a:retry-job');
  const reference={kind:'workflow',id:randomUUID(),version:1};
  const outboxEventId=randomUUID();
  try {
    assert.equal(await api.enqueueJob({ actorId:actorA,tenantId:tenantA,jobId:firstJobId,jobType:'test.retry',payloadRef:reference,idempotencyKey:firstKey,maxAttempts:2 }),firstJobId);
    assert.equal(await api.enqueueJob({ actorId:actorA,tenantId:tenantA,jobId:firstJobId,jobType:'test.retry',payloadRef:reference,idempotencyKey:firstKey,maxAttempts:2 }),firstJobId,'idempotent enqueue returns the original job');
    await assert.rejects(api.enqueueJob({ actorId:actorA,tenantId:tenantA,jobId:randomUUID(),jobType:'test.retry',payloadRef:{...reference,version:2},idempotencyKey:firstKey,maxAttempts:2 }),/idempotency_conflict/);
    await assert.rejects(api.enqueueJob({ actorId:actorA,tenantId:tenantB,jobId:randomUUID(),jobType:'test.cross-tenant',payloadRef:reference,idempotencyKey:digest('wrong-tenant') }),{code:'organization_not_found'});
    await assert.rejects(api.enqueueJob({ actorId:memberA,tenantId:tenantA,jobId:randomUUID(),jobType:'test.member',payloadRef:reference,idempotencyKey:digest('unprivileged-member') }),{code:'runtime_write_forbidden'});
    await assert.rejects(api.enqueueJob({ actorId:actorA,tenantId:tenantA,jobId:randomUUID(),jobType:'test.payload',payloadRef:{kind:'workflow',id:'x',secret:'must-not-enter-queue'},idempotencyKey:digest('secret-payload')}),/payload_ref/);

    const oneShotId=randomUUID(), intervalId=randomUUID(), pausedId=randomUUID();
    const past=new Date(Date.now()-2_000).toISOString();
    await api.createSchedule({actorId:actorA,tenantId:tenantA,scheduleId:oneShotId,jobType:'test.once',payloadRef:reference,idempotencyPrefix:digest('once').slice(0,56),nextRunAt:past});
    await api.createSchedule({actorId:actorA,tenantId:tenantA,scheduleId:intervalId,jobType:'test.interval',payloadRef:reference,idempotencyPrefix:digest('interval').slice(0,56),nextRunAt:past,intervalSeconds:60});
    await api.createSchedule({actorId:actorA,tenantId:tenantA,scheduleId:pausedId,jobType:'test.paused',payloadRef:reference,idempotencyPrefix:digest('paused').slice(0,56),nextRunAt:past});
    assert.equal(await api.pauseSchedule({actorId:actorA,tenantId:tenantA,scheduleId:pausedId}),true);
    assert.equal(await api.pauseSchedule({actorId:actorA,tenantId:tenantA,scheduleId:pausedId}),false);
    await assert.rejects(api.createSchedule({actorId:actorA,tenantId:tenantA,scheduleId:randomUUID(),jobType:'test.interval',payloadRef:reference,idempotencyPrefix:digest('bad').slice(0,56),nextRunAt:past,intervalSeconds:30}),{code:'runtime_schedule_invalid'});

    await assert.rejects(db.query('SELECT atlas_v115_claim_jobs($1,10,60)', ['api-should-not-claim']));
    await db.query("SELECT set_config('app.tenant_id',$1,false)",[tenantA]);
    assert.equal((await db.query('SELECT count(*) AS count FROM atlas_runtime_jobs')).rows[0].count,1,'API-side queue reads remain tenant-filtered');
    await db.query("SELECT set_config('app.tenant_id',$1,false)",[tenantB]);
    assert.equal((await db.query('SELECT count(*) AS count FROM atlas_runtime_jobs')).rows[0].count,0,'tenant B cannot see tenant A jobs');
    await db.query("SELECT set_config('app.tenant_id',$1,false)",[tenantA]);
    await assert.rejects(db.query('SELECT atlas_v115_enqueue_job($1,$2,$3,$4::jsonb,$5,$6,$7)',[tenantB,randomUUID(),'test.cross-tenant',JSON.stringify(reference),digest('forged-call'),null,5]),/tenant_scope_invalid/);
    await db.query('SELECT atlas_v115_append_outbox_event($1,$2,$3,$4::jsonb)',[tenantA,outboxEventId,'contact.created',JSON.stringify({kind:'contacts',id:randomUUID(),version:1})]);
  } finally {
    // Role reset is needed before closing the local database even if an assertion fails.
    try { await db.exec('RESET ROLE'); } catch { /* Preserve the test failure. */ }
  }

  try {
    await db.exec('SET ROLE atlas_worker;');
    const worker = new PostgresRuntimeStore(pool);
    assert.equal(await worker.assertSafeWorkerRole(),true);
    await assert.rejects(db.query('SELECT * FROM atlas_organizations'),/permission denied/,'worker cannot read tenant business rows');
    assert.equal(Number((await db.query('SELECT count(*) AS count FROM atlas_runtime_jobs')).rows[0].count),1,'worker RLS policy exposes only queue metadata across tenants');
    assert.equal(await worker.tickSchedules(20),2,'due one-shot and recurring schedules become jobs; paused schedule stays paused');
    assert.equal(await worker.tickSchedules(20),0,'completed one-shot and future interval are not duplicated');

    const claimed=await worker.claimJobs('worker-a',10,30);
    const retryJob=claimed.find(job=>job.job_id===firstJobId);
    const scheduledJob=claimed.find(job=>job.job_type==='test.once');
    assert.ok(retryJob && scheduledJob);
    assert.equal(await worker.heartbeatJob(retryJob,'wrong-worker',30),false);
    assert.equal(await worker.heartbeatJob(retryJob,'worker-a',30),true);
    assert.equal(await worker.completeJob(scheduledJob,'worker-a'),true);
    assert.equal(await worker.completeJob(scheduledJob,'worker-a'),false,'completion is lease-owner-bound and single-use');
    assert.equal(await worker.failJob(retryJob,'worker-a','provider_timeout'),'retryable');
    await db.query('UPDATE atlas_runtime_jobs SET run_at=now() WHERE tenant_id=$1 AND job_id=$2',[tenantA,firstJobId]);
    const retry=await worker.claimJobs('worker-b',10,30);
    assert.equal(retry.length,1);
    assert.equal(retry[0].attempts,2);
    assert.equal(await worker.failJob(retry[0],'worker-b','provider_timeout'),'dead_letter');

    const leaseJobId=randomUUID();
    await db.query('INSERT INTO atlas_runtime_jobs(tenant_id,job_id,job_type,payload_ref,idempotency_key) VALUES($1,$2,$3,$4::jsonb,$5)',[tenantB,leaseJobId,'test.lease',JSON.stringify({kind:'workflow',id:randomUUID()}),digest('tenant-b:lease')]);
    const leased=await worker.claimJobs('worker-a',10,30);
    const expiring=leased.find(job=>job.job_id===leaseJobId);
    assert.ok(expiring);
    await db.query("UPDATE atlas_runtime_jobs SET lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND job_id=$2",[tenantB,leaseJobId]);
    assert.equal(await worker.reapJobs(20),1,'expired leases return to the retry queue');
    const recovered=await worker.claimJobs('worker-b',10,30);
    const recoveredJob=recovered.find(job=>job.job_id===leaseJobId);
    assert.ok(recoveredJob);
    assert.equal(await worker.completeJob(expiring,'worker-a'),false,'the previous worker cannot complete after lease loss');
    assert.equal(await worker.completeJob(recoveredJob,'worker-b'),true);

    const outbox=await worker.claimOutbox('worker-outbox',20,30);
    const event=outbox.find(row=>row.event_id===outboxEventId);
    assert.ok(event);
    assert.equal(await worker.ackOutbox(event,'wrong-worker'),false);
    assert.equal(await worker.ackOutbox(event,'worker-outbox'),true);
  } finally { await db.close(); }
});


test('V120 workflow execution access is lease-bound and mediated by the worker adapter', async () => {
  const { db, pool } = await database();
  const executionId = randomUUID();
  const jobId = randomUUID();
  const workflowId = randomUUID();
  const graphChecksum = digest('workflow-graph');
  const stateChecksum = digest('workflow-state-1');
  try {
    await db.exec('BEGIN');
    await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenantA]);
    await db.query(
      `INSERT INTO atlas_workflow_executions(
        tenant_id,execution_id,workflow_id,workflow_version,status,started_at,summary,checksum,
        graph_checksum,current_node_id,trigger_event_type,trigger_event_ref,state,state_checksum,
        version,created_at,updated_at
      ) VALUES($1,$2,$3,1,'queued',now(),'{}'::jsonb,$4,$5,'start','contact.created','event-ref',
        $6::jsonb,$7,1,now(),now())`,
      [tenantA, executionId, workflowId, stateChecksum, graphChecksum, JSON.stringify({ currentNodeId: 'start', steps: [] }), stateChecksum]
    );
    await db.query(
      'SELECT atlas_v115_enqueue_job($1,$2,$3,$4::jsonb,$5,$6,$7)',
      [tenantA, jobId, 'workflow.execute', JSON.stringify({ kind: 'workflow_execution', id: executionId, version: 1 }), digest('workflow-job'), null, 8]
    );
    await db.exec('COMMIT');
    await db.exec('SET ROLE atlas_worker;');
    const worker = new PostgresRuntimeStore(pool);
    const claimed = await worker.claimJobs('worker-v120', 10, 60, ['workflow.execute']);
    const job = claimed.find(item => item.job_id === jobId);
    assert.ok(job);
    const loaded = await worker.getWorkflowExecutionForJob(job, 'worker-v120');
    assert.equal(loaded.execution_id, executionId);
    assert.equal(loaded.tenant_id, tenantA);
    assert.equal(loaded.version, 1);

    const updated = await worker.updateWorkflowExecutionForJob(job, 'worker-v120', {
      expectedVersion: 1,
      status: 'running',
      currentNodeId: 'next',
      state: { currentNodeId: 'next', steps: [{ nodeId: 'start', status: 'completed' }] },
      stateChecksum: digest('workflow-state-2')
    });
    assert.equal(updated, true);
    assert.equal((await worker.getWorkflowExecutionForJob(job, 'worker-v120')).status, 'running');

    const eventId = await worker.appendWorkflowExecutionEventForJob(job, 'worker-v120', {
      actorId: actorA,
      eventType: 'execution.step_completed',
      nodeId: 'start',
      attempt: 1,
      status: 'running',
      detailsRef: { kind: 'workflow_execution', id: executionId, version: 2 }
    });
    assert.match(eventId, /^[0-9a-f-]{36}$/i);

    assert.equal(await worker.getWorkflowExecutionForJob({ ...job, tenant_id: tenantB }, 'worker-v120'), null);
  } finally {
    try { await db.exec('RESET ROLE'); } catch {}
    await db.close();
  }
});


test('V138 runtime capacity is globally bounded, lease-owned and recoverable', async () => {
  const { db,pool } = await database();
  try {
    await db.query("INSERT INTO atlas_runtime_pools(pool_id,mode,desired_workers,max_concurrency,enabled) VALUES ('pool-cap','postgres',2,2,true)");
    await db.exec('SET ROLE atlas_worker;');
    const worker = new PostgresRuntimeStore(pool);
    assert.equal(await worker.acquireRuntimeCapacity('pool-cap','worker-a',2,60),2);
    assert.equal(await worker.acquireRuntimeCapacity('pool-cap','worker-b',2,60),0);
    assert.deepEqual((await worker.getRuntimeCapacitySnapshot('pool-cap')).available_slots,0);
    assert.equal(await worker.releaseRuntimeCapacity('pool-cap','worker-a',1),1);
    assert.equal(await worker.acquireRuntimeCapacity('pool-cap','worker-b',2,60),1);
    assert.equal(await worker.releaseRuntimeCapacity('pool-cap','worker-a',1),0);
    assert.equal(await worker.releaseRuntimeCapacity('pool-cap','worker-b',1),0);
  } finally {
    try { await db.exec('RESET ROLE'); } catch {}
    await db.close();
  }
});


test('V149 agent tool approvals are replay-safe and reject identity/status conflicts', async () => {
  const { db, api } = await database();
  const approvalId=randomUUID(), sessionId=randomUUID();
  try {
    assert.equal(await api.requestAgentToolApproval({actorId:actorA,tenantId:tenantA,approvalId,sessionId,actionKey:'communications.send'}),approvalId);
    assert.equal(await api.requestAgentToolApproval({actorId:actorA,tenantId:tenantA,approvalId,sessionId,actionKey:'communications.send'}),approvalId,'identical replay must be idempotent');
    await assert.rejects(
      api.requestAgentToolApproval({actorId:actorA,tenantId:tenantA,approvalId,sessionId,actionKey:'finance.charge'}),
      {code:'agent_approval_identity_conflict'}
    );
    assert.equal(await api.decideAgentToolApproval({actorId:actorA,tenantId:tenantA,approvalId,status:'approved'}),approvalId);
    assert.equal(await api.decideAgentToolApproval({actorId:actorA,tenantId:tenantA,approvalId,status:'approved'}),approvalId,'identical decision replay must be idempotent');
    await assert.rejects(
      api.decideAgentToolApproval({actorId:actorA,tenantId:tenantA,approvalId,status:'denied'}),
      {code:'agent_approval_already_decided'}
    );
    await assert.rejects(
      api.requestAgentToolApproval({actorId:actorB,tenantId:tenantB,approvalId,sessionId,actionKey:'communications.send'}),
      {code:'organization_not_found'}
    );
  } finally { await db.close(); }
});
