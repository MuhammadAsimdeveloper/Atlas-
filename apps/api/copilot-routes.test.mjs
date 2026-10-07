import test from 'node:test';
import assert from 'node:assert/strict';

const TENANT='11111111-1111-4111-8111-111111111111';
const ACTOR='22222222-2222-4222-8222-222222222222';
const ROLE='33333333-3333-4333-8333-333333333333';
const HANDOFF='44444444-4444-4444-8444-444444444444';
const SESSION='55555555-5555-4555-8555-555555555555';

function fakePool({permissions=['inbox.read']}={}) {
  const calls=[];
  const client={
    async query(sql,args=[]){
      calls.push({sql,args});
      if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes("set_config('app.actor_id'")||sql.includes("set_config('app.tenant_id'")) return {rows:[]};
      if(sql.includes('FROM atlas_organization_memberships')) return {rowCount:1,rows:[{role_key:'member',custom_role_id:ROLE}]};
      if(sql.includes('FROM atlas_organization_roles')) return {rowCount:1,rows:[{permissions}]};
      if(sql.startsWith('UPDATE atlas_agent_handoffs')) return {rowCount:1,rows:[{handoff_id:HANDOFF,session_id:SESSION,status:'resolved'}]};
      if(sql.startsWith('UPDATE atlas_ai_agent_sessions')) return {rowCount:1,rows:[]};
      throw new Error('unexpected SQL: '+sql);
    },
    release(){}
  };
  return {connect:async()=>client,calls};
}

test('V153 Copilot API module loads with verified release import', async () => {
  const mod = await import('./copilot-routes.mjs');
  assert.equal(typeof mod.createCopilotApi, 'function');
  assert.equal(typeof mod.PostgresCopilotStore, 'function');
});

test('V153 Copilot API fails closed when dependencies are incomplete', async () => {
  const { createCopilotApi } = await import('./copilot-routes.mjs');
  assert.throws(() => createCopilotApi({}), /dependencies are incomplete/);
});

test('V153 handoff decisions require inbox.respond, not only inbox.read', async () => {
  const { PostgresCopilotStore } = await import('./copilot-routes.mjs');
  const pool = fakePool({permissions:['inbox.read']});
  const store = new PostgresCopilotStore(pool);

  await assert.rejects(
    store.decideHandoff({actorId:ACTOR,tenantId:TENANT}, HANDOFF, {status:'resolved'}),
    error => error?.status === 403 && error?.code === 'copilot_forbidden'
  );

  assert.equal(pool.calls.some(call => call.sql.startsWith('UPDATE atlas_agent_handoffs')), false);
});
