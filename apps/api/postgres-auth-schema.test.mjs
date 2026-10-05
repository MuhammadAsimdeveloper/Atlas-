import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { PostgresAuthStore } from './postgres-auth-store.mjs';
import { PostgresGrowthStore } from './growth-store.mjs';
import { PostgresRuntimeStore } from './runtime-store.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migration = await readFile(path.join(root, 'infra/postgres/FINAL-MIGRATION-V112.sql'), 'utf8');

test('all PostgreSQL migrations apply in order and V115 keeps tenant data and worker queue roles scoped', async () => {
  const db = new PGlite();
  try {
    const migrationDirectory = path.join(root, 'infra/postgres');
    await db.exec('CREATE ROLE atlas_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;');
  const files = (await readdir(migrationDirectory)).filter(name => /^FINAL-MIGRATION-V[0-9]+(?:-V[0-9]+)?\.sql$/.test(name)).sort((a,b) => Number(a.match(/V([0-9]+)/)[1]) - Number(b.match(/V([0-9]+)/)[1]) || a.localeCompare(b));
    assert.equal(files.at(-1), 'FINAL-MIGRATION-V150.sql');
    for (const file of files) { try { await db.exec(await readFile(path.join(migrationDirectory,file),'utf8')); } catch (error) { throw new Error(`${file}: ${error.message}`); } }
    const automationTable = await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='atlas_v127_automation_events'::regclass");
    assert.equal(automationTable.rows[0].relrowsecurity,true);
    assert.equal(automationTable.rows[0].relforcerowsecurity,true);
    const wakeFunction = await db.query("SELECT proname FROM pg_proc WHERE proname='atlas_v128_tick_workflow_executions'");
    assert.equal(wakeFunction.rowCount,1,'V128 durable workflow wake scheduler is present');
    const inboxTables = await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('atlas_v126_inbox_events'::regclass,'atlas_v126_message_receipts'::regclass) ORDER BY oid::text");
    assert.equal(inboxTables.rows.length,2);
    assert.ok(inboxTables.rows.every(row => row.relrowsecurity && row.relforcerowsecurity),'V126 inbox event/receipt tables use forced RLS');
    const inboxFunctions = await db.query("SELECT proname FROM pg_proc WHERE proname IN ('atlas_v126_get_message_for_worker','atlas_v126_mark_message_for_worker','atlas_v126_ingest_inbound','atlas_v126_apply_receipt')");
    assert.equal(inboxFunctions.rows.length,4,'V126 lease-bound inbox and webhook RPCs are present');
    const trialMarker = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='atlas_paddle_subscriptions' AND column_name='trial_started_at'");
    assert.equal(trialMarker.rowCount,1,'V115 permanently records whether a workspace has used its free trial');
    await db.exec('CREATE ROLE atlas_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN NOBYPASSRLS;');
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V112.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V114.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V115.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V119.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V120.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V122.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V123.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V126.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V127.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V128.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V129.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V130.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V131.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V132.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V133.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V134.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V135.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V136.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V137.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V138.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V139.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V140.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V141.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V142.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V143.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V144.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V146.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V147.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V148.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V149.sql'), 'utf8'));
    await db.exec(await readFile(path.join(root, 'infra', 'postgres', 'API-ROLE-GRANTS-V150.sql'), 'utf8'));

    const sloPolicies = await db.query("SELECT count(*)::integer AS count FROM atlas_runtime_slo_policies WHERE enabled=true");
    assert.equal(sloPolicies.rows[0].count, 5, 'V137 seeds bounded runtime SLO policies');
    const sloFunction = await db.query("SELECT proname FROM pg_proc WHERE proname='atlas_v137_evaluate_runtime_slo'");
    assert.equal(sloFunction.rowCount, 1, 'V137 SLO evaluator is present');
    const workerTelemetry = await db.query("SELECT has_function_privilege('atlas_worker','atlas_v137_evaluate_runtime_slo(text,text,uuid)','EXECUTE') AS can_evaluate,has_table_privilege('atlas_worker','atlas_runtime_alerts','SELECT') AS can_read_alerts");
    const operationalObjects = await db.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('atlas_runtime_scaler_leases','atlas_runtime_scaling_decisions','atlas_runtime_alert_deliveries','atlas_provider_action_reconciliations','atlas_runtime_recovery_drill_steps','atlas_runtime_evidence_reports') ORDER BY table_name");
    assert.equal(operationalObjects.rows.length,6,'V146-V150 durable operational tables are present');
    const operationalFunctions = await db.query("SELECT proname FROM pg_proc WHERE proname IN ('atlas_v146_acquire_scaler_lease','atlas_v148_start_provider_action','atlas_v148_record_provider_outcome')");
    assert.equal(operationalFunctions.rows.length,3,'V146/V148 operational RPCs are present');

    assert.equal(workerTelemetry.rows[0].can_evaluate, true);
    assert.equal(workerTelemetry.rows[0].can_read_alerts, true);

    await db.exec('SET ROLE atlas_app;');
    assert.equal(await new PostgresAuthStore(db).assertSafeRuntimeRole(), true, 'restricted atlas_app passes the production startup check');
    await db.query("INSERT INTO atlas_runtime_pools(pool_id,mode,desired_workers,max_concurrency,enabled) VALUES ('pool-v137','postgres',1,10,true)");
    await db.query("INSERT INTO atlas_runtime_slo_samples(sample_id,pool_id,metric,value,target) VALUES ('44444444-4444-4444-8444-444444444444','pool-v137','success_rate',0,0.995)");
    const evaluation = await db.query("SELECT * FROM atlas_v137_evaluate_runtime_slo('runtime.success-rate','pool-v137','55555555-5555-4555-8555-555555555555')");
    assert.equal(evaluation.rows[0].status, 'critical');
    assert.ok(evaluation.rows[0].alert_id);
    const alert = await db.query("SELECT status,severity FROM atlas_runtime_alerts WHERE pool_id='pool-v137'");
    assert.deepEqual(alert.rows[0], { status:'open', severity:'critical' });
    const incident = await db.query("SELECT status,severity FROM atlas_runtime_incidents WHERE fingerprint=md5('incident:runtime.success-rate:pool-v137')");
    assert.deepEqual(incident.rows[0], { status:'open', severity:'critical' });

    const makeOrg = async ({ actor, email, tenant, name, slug }) => {
      await db.exec('BEGIN');
      await db.query("SELECT set_config('app.auth_email',$1,true)", [email]);
      await db.query('INSERT INTO atlas_auth_users(user_id,email,display_name,password_hash,email_verified_at) VALUES ($1,$2,$3,$4,now())', [actor,email,name,'scrypt$test']);
      await db.query("SELECT set_config('app.actor_id',$1,true)", [actor]);
      await db.query('INSERT INTO atlas_organizations(tenant_id,name,slug,created_by) VALUES ($1,$2,$3,$4)', [tenant,name,slug,actor]);
      await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
      await db.query("INSERT INTO atlas_organization_memberships(tenant_id,user_id,role_key) VALUES ($1,$2,'owner')", [tenant,actor]);
      await db.query('COMMIT');
    };

    const userA = '11111111-1111-4111-8111-111111111111';
    const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const userB = '22222222-2222-4222-8222-222222222222';
    const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await makeOrg({ actor: userA, email: 'owner-a@example.net', tenant: tenantA, name: 'Owner A', slug: 'owner-a' });
    await makeOrg({ actor: userB, email: 'owner-b@example.net', tenant: tenantB, name: 'Owner B', slug: 'owner-b' });

    await db.exec('BEGIN');
    await db.query("SELECT set_config('app.actor_id',$1,true)", [userA]);
    await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenantA]);
    const organizations = await db.query('SELECT tenant_id,name FROM atlas_organizations ORDER BY name');
    assert.deepEqual(organizations.rows.map(row => row.tenant_id), [tenantA]);
    const users = await db.query('SELECT email FROM atlas_auth_users ORDER BY email');
    assert.deepEqual(users.rows.map(row => row.email), ['owner-a@example.net']);
    await assert.rejects(db.query('INSERT INTO atlas_organizations(tenant_id,name,slug,created_by) VALUES ($1,$2,$3,$4)', ['cccccccc-cccc-4ccc-8ccc-cccccccccccc','Foreign','foreign-org',userB]));
    await db.exec('ROLLBACK');

    const forced = await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='atlas_organization_memberships'::regclass");
    assert.equal(forced.rows[0].relrowsecurity, true);
    assert.equal(forced.rows[0].relforcerowsecurity, true);
    const runtime = await db.query("SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='atlas_app'");
    assert.equal(runtime.rows[0].rolsuper, false);
    assert.equal(runtime.rows[0].rolbypassrls, false);
    assert.equal(runtime.rows[0].rolcreatedb, false);
    assert.equal(runtime.rows[0].rolcreaterole, false);
    const identityColumns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='atlas_auth_users'");
    assert.equal(identityColumns.rows.some(row => row.column_name === 'platform_owner'), false);
    const growthPolicy = await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='atlas_growth_items'::regclass");
    assert.equal(growthPolicy.rows[0].relrowsecurity, true);
    assert.equal(growthPolicy.rows[0].relforcerowsecurity, true);
    const jobPolicy = await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='atlas_runtime_jobs'::regclass");
    assert.equal(jobPolicy.rows[0].relrowsecurity, true);
    assert.equal(jobPolicy.rows[0].relforcerowsecurity, true);
    const executionPolicy = await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='atlas_workflow_executions'::regclass");
    assert.equal(executionPolicy.rows[0].relrowsecurity, true);
    assert.equal(executionPolicy.rows[0].relforcerowsecurity, true);
    const executionGrants = await db.query("SELECT has_table_privilege('atlas_app','atlas_workflow_executions','SELECT,INSERT,UPDATE') AS app_can_write,has_table_privilege('atlas_worker','atlas_workflow_executions','SELECT,INSERT,UPDATE') AS worker_direct_access,has_function_privilege('atlas_worker','atlas_v120_get_execution_for_job(uuid,uuid,text)','EXECUTE') AS worker_get_execution,has_function_privilege('atlas_worker','atlas_v120_update_execution_for_job(uuid,uuid,text,integer,text,text,jsonb,text,text,timestamptz,timestamptz,uuid,timestamptz)','EXECUTE') AS worker_update_execution,has_function_privilege('atlas_worker','atlas_v120_append_execution_event_for_job(uuid,uuid,text,uuid,text,text,smallint,text,jsonb,timestamptz)','EXECUTE') AS worker_append_event,has_table_privilege('atlas_worker','atlas_growth_items','SELECT') AS worker_customer_data");
    assert.equal(executionGrants.rows[0].app_can_write, true);
    assert.equal(executionGrants.rows[0].worker_direct_access, false);
    assert.equal(executionGrants.rows[0].worker_get_execution, true);
    assert.equal(executionGrants.rows[0].worker_update_execution, true);
    assert.equal(executionGrants.rows[0].worker_append_event, true);
    assert.equal(executionGrants.rows[0].worker_customer_data, false);
    const apiWorkerGrants = await db.query("SELECT has_function_privilege('atlas_app','atlas_v115_claim_jobs(text,integer,integer,text[])','EXECUTE') AS can_claim,has_table_privilege('atlas_app','atlas_runtime_jobs','UPDATE') AS can_update");
    assert.equal(apiWorkerGrants.rows[0].can_claim, false);
    assert.equal(apiWorkerGrants.rows[0].can_update, false);
    const workerGrants = await db.query("SELECT has_table_privilege('atlas_worker','atlas_runtime_jobs','SELECT,UPDATE') AS can_process,has_table_privilege('atlas_worker','atlas_growth_items','SELECT') AS can_read_customer_data");
    assert.equal(workerGrants.rows[0].can_process, true);
    assert.equal(workerGrants.rows[0].can_read_customer_data, false);
    await db.exec('RESET ROLE; SET ROLE atlas_worker;');
    assert.equal(await new PostgresRuntimeStore(db).assertSafeWorkerRole(), true);
    await assert.rejects(db.query('SELECT * FROM atlas_workflow_executions'), /permission denied|not have permission/i);
    await assert.rejects(db.query('UPDATE atlas_workflow_executions SET status=\'tampered\''), /permission denied|not have permission/i);
  } finally {
    await db.close();
  }
});

test('V114 Growth Center CRUD, revisions, Paddle webhook state and tenant isolation work under atlas_app RLS', async () => {
  const db = new PGlite();
  try {
    const migrationDirectory = path.join(root, 'infra/postgres');
    await db.exec('CREATE ROLE atlas_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;');
    const files = (await readdir(migrationDirectory)).filter(name => /^FINAL-MIGRATION-V[0-9]+(?:-V[0-9]+)?\.sql$/.test(name)).sort((a,b) => Number(a.match(/V([0-9]+)/)[1]) - Number(b.match(/V([0-9]+)/)[1]) || a.localeCompare(b));
    for (const file of files) await db.exec(await readFile(path.join(migrationDirectory,file),'utf8'));
    await db.exec('CREATE ROLE atlas_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN NOBYPASSRLS;');
    await db.exec(await readFile(path.join(root,'infra/postgres/API-ROLE-GRANTS-V112.sql'),'utf8'));
    await db.exec(await readFile(path.join(root,'infra/postgres/API-ROLE-GRANTS-V114.sql'),'utf8'));
    await db.exec(await readFile(path.join(root,'infra/postgres/API-ROLE-GRANTS-V115.sql'),'utf8'));
    await db.exec(await readFile(path.join(root,'infra/postgres/API-ROLE-GRANTS-V119.sql'),'utf8'));
    await db.exec('SET ROLE atlas_app;');
    const actorA='11111111-1111-4111-8111-111111111111', tenantA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const actorB='22222222-2222-4222-8222-222222222222', tenantB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const memberA='33333333-3333-4333-8333-333333333333';
    const createOrganization = async ({ actor, tenant, email, name, slug }) => {
      await db.exec('BEGIN');
      await db.query("SELECT set_config('app.auth_email',$1,true)", [email]);
      await db.query('INSERT INTO atlas_auth_users(user_id,email,display_name,password_hash,email_verified_at) VALUES ($1,$2,$3,$4,now())', [actor,email,name,'scrypt$test']);
      await db.query("SELECT set_config('app.actor_id',$1,true)", [actor]);
      await db.query('INSERT INTO atlas_organizations(tenant_id,name,slug,created_by) VALUES ($1,$2,$3,$4)', [tenant,name,slug,actor]);
      await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
      await db.query("INSERT INTO atlas_organization_memberships(tenant_id,user_id,role_key,status) VALUES ($1,$2,'owner','active')", [tenant,actor]);
      await db.exec('COMMIT');
    };
    await createOrganization({ actor:actorA,tenant:tenantA,email:'growth-a@example.net',name:'Growth A',slug:'growth-a' });
    await createOrganization({ actor:actorB,tenant:tenantB,email:'growth-b@example.net',name:'Growth B',slug:'growth-b' });
    await db.exec('BEGIN');
    await db.query("SELECT set_config('app.auth_email',$1,true)", ['member-a@example.net']);
    await db.query('INSERT INTO atlas_auth_users(user_id,email,display_name,password_hash,email_verified_at) VALUES ($1,$2,$3,$4,now())', [memberA,'member-a@example.net','Member A','scrypt$test']);
    await db.query("SELECT set_config('app.actor_id',$1,true)", [memberA]);
    await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenantA]);
    await db.query("INSERT INTO atlas_organization_memberships(tenant_id,user_id,role_key,status) VALUES ($1,$2,'member','active')", [tenantA,memberA]);
    await db.exec('COMMIT');

    const pool = { connect: async () => ({ query: (...args) => db.query(...args), release() {} }), query: (...args) => db.query(...args) };
    const store = new PostgresGrowthStore(pool);
    const pipeline = await store.create({ actorId:actorA,tenantId:tenantA,module:'pipelines',payload:{ name:'Sales',stages:[{id:'new',name:'New',probability:0},{id:'qualified',name:'Qualified',probability:0.5},{id:'won',name:'Won',probability:1,isClosedWon:true }] } });
    const contact = await store.create({ actorId:actorA,tenantId:tenantA,module:'contacts',idempotencyKey:'a'.repeat(64),payload:{ firstName:'Ari',email:'ari@example.net' } });
    const retry = await store.create({ actorId:actorA,tenantId:tenantA,module:'contacts',idempotencyKey:'a'.repeat(64),payload:{ firstName:'ignored',email:'ignored@example.net' } });
    assert.equal(retry.id, contact.id, 'replayed create returns the existing record');
    const lead = await store.create({ actorId:actorA,tenantId:tenantA,module:'leads',payload:{ contactId:contact.id,pipelineId:pipeline.id,stageId:'new',status:'new' } });
    assert.equal((await store.list({ actorId:actorA,tenantId:tenantA,module:'leads' })).items[0].id, lead.id);
    const qualification = await store.create({ actorId:actorA,tenantId:tenantA,module:'ai-qualification',payload:{ name:'Fit rubric',instructions:'Score only supported evidence.',criteria:[{id:'fit',label:'Service fit',weight:100,evidenceRequired:true}] } });
    const publishedQualification = await store.transition({ actorId:actorA,tenantId:tenantA,module:'ai-qualification',id:qualification.id,action:'publish',expectedVersion:1 });
    const evaluation = await store.evaluateLead({ actorId:memberA,tenantId:tenantA,profileId:publishedQualification.id,leadId:lead.id,expectedVersion:1,ratings:{fit:85},evidenceRefs:{fit:'call:session-42'} });
    assert.equal(evaluation.evaluation.score,85);
    assert.equal(evaluation.item.payload.qualification.status,'needs_review','human review remains mandatory by default');
    const movedLead = await store.moveLeadStage({ actorId:memberA,tenantId:tenantA,leadId:lead.id,expectedVersion:2,stageId:'qualified' });
    assert.equal(movedLead.item.payload.stageId,'qualified');
    assert.equal(movedLead.item.version,3);
    await assert.rejects(store.moveLeadStage({ actorId:actorA,tenantId:tenantA,leadId:lead.id,expectedVersion:2,stageId:'won' }),{code:'version_conflict'});
    await assert.rejects(store.get({ actorId:actorA,tenantId:tenantB,module:'contacts',id:contact.id }), { code:'organization_not_found' });
    const updated = await store.update({ actorId:memberA,tenantId:tenantA,module:'contacts',id:contact.id,expectedVersion:1,payload:{ firstName:'Ari',lastName:'Member edit',email:'ari@example.net' } });
    assert.equal(updated.version,2, 'a different tenant member can edit a record without violating creator-bound RLS');
    await db.exec('BEGIN');
    await db.query("SELECT set_config('app.actor_id',$1,true)", [actorA]);
    await db.query("SELECT set_config('app.tenant_id',$1,true)", [tenantA]);
    const versions = await db.query('SELECT version FROM atlas_growth_item_versions WHERE tenant_id=$1 AND item_id=$2 ORDER BY version', [tenantA,contact.id]);
    await db.exec('ROLLBACK');
    assert.deepEqual(versions.rows.map(row => row.version),[1,2]);
    await assert.rejects(store.update({ actorId:actorA,tenantId:tenantA,module:'contacts',id:contact.id,expectedVersion:1,payload:{ firstName:'Stale',email:'ari@example.net' } }), { code:'version_conflict' });

    const occurredAt = new Date().toISOString();
    const event = { disposition:'apply',eventId:'evt_1234567890',eventType:'subscription.created',occurredAt,tenantId:tenantA,subscriptionId:'sub_1234567890',customerId:'ctm_1234567890',priceId:'pri_1234567890',planKey:'starter',status:'active',currentPeriodEndsAt:null,cancelAtPeriodEnd:false,trialStartedAt:null };
    assert.equal((await store.applyPaddleEvent(event,'f'.repeat(64))).status,'applied');
    assert.equal((await store.applyPaddleEvent(event,'f'.repeat(64))).status,'duplicate');
    assert.equal((await store.applyPaddleEvent({ ...event,eventId:'evt_1234567891',occurredAt:new Date(Date.parse(occurredAt)-60_000).toISOString(),status:'past_due' },'e'.repeat(64))).status,'stale');
    assert.equal((await store.getSubscription({ actorId:actorA,tenantId:tenantA })).status,'active');
    const trialStartedAt=new Date(Date.parse(occurredAt)+10_000).toISOString();
    const trialEvent={...event,eventId:'evt_1234567892',eventType:'subscription.trialing',status:'trialing',occurredAt:trialStartedAt,trialStartedAt,currentPeriodEndsAt:new Date(Date.parse(trialStartedAt)+14*86400_000).toISOString()};
    assert.equal((await store.applyPaddleEvent(trialEvent,'d'.repeat(64))).status,'applied');
    const canceledEvent={...trialEvent,eventId:'evt_1234567893',eventType:'subscription.canceled',status:'canceled',occurredAt:new Date(Date.parse(trialStartedAt)+20_000).toISOString(),trialStartedAt:null};
    assert.equal((await store.applyPaddleEvent(canceledEvent,'c'.repeat(64))).status,'applied');
    const canceledSubscription=await store.getSubscription({ actorId:actorA,tenantId:tenantA });
    assert.equal(canceledSubscription.status,'canceled');
    assert.equal(new Date(canceledSubscription.trialStartedAt).toISOString(),trialStartedAt,'trial use remains recorded after cancellation');
    await db.exec('RESET ROLE; SET ROLE atlas_worker;');
    const runtime = new PostgresRuntimeStore(pool);
    assert.equal(await runtime.assertSafeWorkerRole(), true);
    const outboxEvents = await runtime.claimOutbox('integration-worker',100,60);
    assert.ok(outboxEvents.some(row => row.event_type === 'contacts.created'), 'Growth Center writes a contact event to the transactional outbox');
    const createdContactEvent = outboxEvents.find(row => row.event_type === 'contacts.created');
    assert.deepEqual(Object.keys(createdContactEvent.payload_ref).sort(), ['id','kind','version']);
    assert.equal(await runtime.ackOutbox(createdContactEvent,'wrong-worker'), false, 'another worker cannot acknowledge a lease');
    assert.equal(await runtime.ackOutbox(createdContactEvent,'integration-worker'), true);
  } finally { await db.close(); }
});

test('Postgres auth store completes tenant account, invitation, dashboard, reset and session lifecycle under RLS', async () => {
  const db = new PGlite();
  const now = () => new Date();
  try {
    await db.exec(migration);
    await db.exec(`CREATE ROLE atlas_auth_runtime NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN NOBYPASSRLS;
      GRANT SELECT,INSERT,UPDATE ON atlas_auth_users,atlas_organizations,atlas_organization_roles,atlas_organization_memberships,atlas_auth_tokens,atlas_auth_rate_limits TO atlas_auth_runtime;
      GRANT SELECT,INSERT,UPDATE,DELETE ON atlas_auth_sessions TO atlas_auth_runtime;
      GRANT SELECT,INSERT ON atlas_auth_audit_events TO atlas_auth_runtime;
      SET ROLE atlas_auth_runtime;`);
    const pool = { connect: async () => ({ query: (...args) => db.query(...args), release() {} }), query: (...args) => db.query(...args), end: async () => {} };
    const store = new PostgresAuthStore(pool, { clock: now });
    const expiresAt = () => new Date(now().getTime() + 30 * 60_000);
    const accountA = { email:'owner-a@atlas.test', displayName:'Owner A', organizationName:'Northstar HVAC', industryKey:'home_services', timeZone:'America/Los_Angeles', passwordHash:'scrypt$16384$8$1$dummy$dummy', verificationTokenHash:'a'.repeat(64), expiresAt:expiresAt() };
    const accountB = { email:'member-b@atlas.test', displayName:'Member B', organizationName:'Bright Dental', industryKey:'appointment_services', timeZone:'America/New_York', passwordHash:'scrypt$16384$8$1$dummy$dummy', verificationTokenHash:'b'.repeat(64), expiresAt:expiresAt() };
    const createdA = await store.createAccount(accountA);
    const createdB = await store.createAccount(accountB);
    assert.equal(createdA.created, true); assert.equal(createdB.created, true);
    assert.equal((await store.findUserForLogin(accountA.email)).emailVerified, false);
    assert.equal((await store.verifyEmail({ tokenHash:accountA.verificationTokenHash })).emailVerified, true);
    assert.equal((await store.verifyEmail({ tokenHash:accountA.verificationTokenHash })), null, 'verification token is single-use');
    await store.verifyEmail({ tokenHash:accountB.verificationTokenHash });

    const role = await store.createCustomRole({ userId:createdA.userId, tenantId:createdA.tenantId, roleId:'33333333-3333-4333-8333-333333333333', role:{ key:'custom:support-coordinator',name:'Support coordinator',permissions:['inbox.read','inbox.respond'] } });
    const inviteHash = 'c'.repeat(64);
    await store.createInvitation({ userId:createdA.userId, tenantId:createdA.tenantId, email:accountB.email, roleKey:role.key, customRoleId:role.id, tokenHash:inviteHash, expiresAt:expiresAt() });
    assert.equal((await store.listInvitations({ userId:createdA.userId, tenantId:createdA.tenantId }))[0].status, 'pending');
    const replacementInviteHash = '8'.repeat(64);
    await store.createInvitation({ userId:createdA.userId, tenantId:createdA.tenantId, email:accountB.email, roleKey:role.key, customRoleId:role.id, tokenHash:replacementInviteHash, expiresAt:expiresAt() });
    const currentInvitations = await store.listInvitations({ userId:createdA.userId, tenantId:createdA.tenantId });
    assert.deepEqual(currentInvitations.map(invite => invite.status).sort(), ['pending', 'replaced']);
    await assert.rejects(store.acceptInvitation({ userId:createdB.userId, email:accountB.email, tokenHash:inviteHash }), { code:'invalid_or_expired_invitation' });
    const accepted = await store.acceptInvitation({ userId:createdB.userId, email:accountB.email, tokenHash:replacementInviteHash });
    assert.equal(accepted.id, createdA.tenantId);
    assert.equal(accepted.role, 'custom:support-coordinator');
    assert.equal((await store.listMembers({ userId:createdA.userId, tenantId:createdA.tenantId })).length, 2);
    assert.equal((await store.listCustomRoles({ userId:createdB.userId, tenantId:createdA.tenantId })).length, 1);
    await assert.rejects(store.getDashboard({ userId:createdA.userId, tenantId:createdB.tenantId }), { code:'organization_not_found' });

    const csrf = 'd'.repeat(64); const sessionHash = 'e'.repeat(64);
    const session = await store.createSession({ userId:createdA.userId, sessionHash, csrfHash:csrf, expiresAt:expiresAt(), userAgent:'integration test', ipHash:null });
    assert.equal(session.tenantId, createdA.tenantId);
    const dashboard = await store.getDashboard({ userId:createdA.userId, tenantId:createdA.tenantId });
    assert.equal(dashboard.organization.industry, 'home_services');
    assert.equal(dashboard.metrics.activeMembers, 2);
    assert.equal(dashboard.metrics.pendingInvitations, 0);
    const identity = await store.getSession({ sessionHash });
    assert.equal(identity.user.email, accountA.email);
    assert.equal(identity.memberships.length, 1);
    const changedProfile = await store.updateProfile({ userId:createdA.userId, displayName:'Khan Owner' });
    assert.equal(changedProfile.displayName, 'Khan Owner');

    const rateKey = 'f'.repeat(64);
    assert.equal(await store.consumeRateLimit({ key:rateKey, now:now(), windowSeconds:60, limit:2 }), true);
    assert.equal(await store.consumeRateLimit({ key:rateKey, now:now(), windowSeconds:60, limit:2 }), true);
    assert.equal(await store.consumeRateLimit({ key:rateKey, now:now(), windowSeconds:60, limit:2 }), false);

    const resetHash = '9'.repeat(64);
    assert.equal(await store.issuePasswordReset({ email:accountA.email, tokenHash:resetHash, expiresAt:expiresAt() }), true);
    await store.resetPassword({ tokenHash:resetHash, passwordHash:'scrypt$16384$8$1$new$hash' });
    assert.equal(await store.getSession({ sessionHash }), null, 'password reset revokes existing sessions');
    assert.equal(await store.revokeSession({ sessionHash }), false);
  } finally {
    await db.close();
  }
});
