import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createWorkflowGraph } from '../../packages/atlas-target/index.mjs';
import { PostgresWorkflowExecutionStore } from './workflow-execution-store.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const tenantA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenantB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actorA='11111111-1111-4111-8111-111111111111';
const actorB='22222222-2222-4222-8222-222222222222';
const workflowId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventRef='evt_v119_0001';

async function setup(){
  const db=new PGlite();
  const migrationDirectory=path.join(root,'infra/postgres');
  await db.exec('CREATE ROLE atlas_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;');
  const files=(await readdir(migrationDirectory)).filter(name=>/^FINAL-MIGRATION-V[0-9]+(?:-V[0-9]+)?\.sql$/.test(name)).sort((a,b)=>Number(a.match(/V([0-9]+)/)[1])-Number(b.match(/V([0-9]+)/)[1])||a.localeCompare(b));
  for(const file of files) await db.exec(await readFile(path.join(migrationDirectory,file),'utf8'));
  await db.exec('CREATE ROLE atlas_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN NOBYPASSRLS;');
  await db.exec(await readFile(path.join(root,'infra/postgres/API-ROLE-GRANTS-V112.sql'),'utf8'));
  await db.exec(await readFile(path.join(root,'infra/postgres/API-ROLE-GRANTS-V114.sql'),'utf8'));
  await db.exec(await readFile(path.join(root,'infra/postgres/API-ROLE-GRANTS-V115.sql'),'utf8'));
  await db.exec(await readFile(path.join(root,'infra/postgres/API-ROLE-GRANTS-V119.sql'),'utf8'));

  for(const [actor,tenant,email,slug] of [[actorA,tenantA,'a@example.net','v119-a'],[actorB,tenantB,'b@example.net','v119-b']]){
    await db.exec('BEGIN');
    await db.query("SELECT set_config('app.auth_email',$1,true)",[email]);
    await db.query('INSERT INTO atlas_auth_users(user_id,email,display_name,password_hash,email_verified_at) VALUES ($1,$2,$3,$4,now())',[actor,email,actor===actorA?'A':'B','scrypt$test']);
    await db.query("SELECT set_config('app.actor_id',$1,true)",[actor]);
    await db.query('INSERT INTO atlas_organizations(tenant_id,name,slug,created_by) VALUES ($1,$2,$3,$4)',[tenant,slug,slug,actor]);
    await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
    await db.query("INSERT INTO atlas_organization_memberships(tenant_id,user_id,role_key,status) VALUES ($1,$2,'owner','active')",[tenant,actor]);
    await db.exec('COMMIT');
  }

  await db.exec('SET ROLE atlas_app;');
  const pool={connect:async()=>({query:(...args)=>db.query(...args),release(){}}),query:(...args)=>db.query(...args)};
  return {db,pool};
}

test('V119 persists a pinned workflow execution and atomically queues its execution job',async()=>{
  const {db,pool}=await setup();
  try{
    const store=new PostgresWorkflowExecutionStore(pool);
    const workflow={id:workflowId,tenantId:tenantA,module:'workflows',state:'published',payload:{graph:createWorkflowGraph({tenantId:tenantA,id:workflowId,version:5,name:'Lead journey',nodes:[{id:'start',type:'trigger',config:{eventType:'contact.created'}},{id:'stop',type:'stop'}],edges:[{id:'e1',from:'start',to:'stop',port:'next'}]})}};
    const execution=await store.create({actorId:actorA,tenantId:tenantA,workflow,triggerEventRef:eventRef,executionId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',now:'2026-10-05T10:00:00Z'});
    assert.equal(execution.status,'queued');
    assert.equal(execution.workflowVersion,5);
    await db.query("SELECT set_config('app.tenant_id',$1,false)",[tenantA]);
    const job=await db.query("SELECT job_type,payload_ref::text AS payload,status FROM atlas_runtime_jobs WHERE tenant_id=$1 AND job_id=$2",[tenantA,execution.executionId]);
    assert.equal(job.rows[0].job_type,'workflow.execute');
    assert.equal(job.rows[0].status,'queued');
    assert.match(job.rows[0].payload,/workflow_execution/);
    const loaded=await store.get({actorId:actorA,tenantId:tenantA,workflowId,executionId:execution.executionId});
    assert.equal(loaded.graphChecksum,execution.graphChecksum);
  }finally{await db.close();}
});

test('V119 execution control actions are optimistic and cross-tenant lookups fail closed',async()=>{
  const {db,pool}=await setup();
  try{
    const store=new PostgresWorkflowExecutionStore(pool);
    const workflow={id:workflowId,tenantId:tenantA,module:'workflows',state:'published',payload:{graph:createWorkflowGraph({tenantId:tenantA,id:workflowId,version:5,name:'Lead journey',nodes:[{id:'start',type:'trigger',config:{eventType:'contact.created'}},{id:'stop',type:'stop'}],edges:[{id:'e1',from:'start',to:'stop'}]})}};
    const execution=await store.create({actorId:actorA,tenantId:tenantA,workflow,triggerEventRef:'evt_v119_0002',executionId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',now:'2026-10-05T10:00:00Z'});
    const canceled=await store.cancel({actorId:actorA,tenantId:tenantA,workflowId,executionId:execution.executionId,expectedVersion:1,now:'2026-10-05T10:01:00Z'});
    assert.equal(canceled.status,'canceled');
    await assert.rejects(store.cancel({actorId:actorA,tenantId:tenantA,workflowId,executionId:execution.executionId,expectedVersion:1}),/changed|conflict/i);
    await assert.rejects(store.get({actorId:actorB,tenantId:tenantB,workflowId,executionId:execution.executionId}),/not_found|organization/i);
    await db.query("SELECT set_config('app.tenant_id',$1,false)",[tenantA]);
    const audit=await db.query("SELECT event_type,status FROM atlas_workflow_execution_events WHERE tenant_id=$1 AND execution_id=$2 ORDER BY created_at,event_id",[tenantA,execution.executionId]);
    assert.deepEqual(audit.rows.map(row=>row.event_type),['execution.created','execution.cancel']);
  }finally{await db.close();}
});
