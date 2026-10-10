import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlatformAdminApi } from './platform-admin-routes.mjs';
import { hashOpaqueToken } from './auth-contracts.mjs';

function harness({ email='owner@atlas.test', verified=true }={}) {
  const env={ NODE_ENV:'test', ATLAS_PLATFORM_OWNER_EMAIL:'owner@atlas.test', ATLAS_SESSION_SECRET:'test-secret-long-enough-for-hmac' };
  const token='test-session-token';
  const authStore={
    async consumeRateLimit(){return true;},
    async getSession({sessionHash}) {
      if(sessionHash!==hashOpaqueToken(token)) return null;
      return { user:{id:'user-1',email,displayName:'Platform Admin',emailVerified:verified,status:'active'}, tenantId:null, memberships:[], csrfHash:'', expiresAt:new Date(Date.now()+60000) };
    }
  };
  const calls=[];
  const pool={ async query(sql,params=[]) {
    calls.push({sql,params});
    if(sql.includes('FROM atlas_auth_users') && sql.includes('count(*)')) return {rows:[{total:10,verified:8,disabled:1}]};
    if(sql.includes('FROM atlas_organizations')) return {rows:[{total:3}]};
    if(sql.includes('FROM atlas_auth_audit_events WHERE created_at')) return {rows:[{total:5}]};
    if(sql.includes('FROM atlas_v156_payment_events')) return {rows:[{total:20,failed:2,captured:10,captured_minor:'125000'}]};
    return {rows:[]};
  }};
  const api=createPlatformAdminApi({pool,authStore,env});
  const res={status:0,headers:{},body:'',writeHead(status,headers){this.status=status;this.headers=headers;},end(body=''){this.body=body;}};
  const req={url:'/api/v1/platform-admin/overview',method:'GET',headers:{cookie:'atlas_session='+token},socket:{remoteAddress:'127.0.0.1'}};
  return {api,req,res,calls};
}

test('platform admin overview requires the configured verified platform owner', async()=>{
  const h=harness();
  assert.equal(await h.api.handle(h.req,h.res),true);
  assert.equal(h.res.status,200);
  const body=JSON.parse(h.res.body);
  assert.equal(body.data.users.total,10);
  assert.equal(body.data.payments.status,'unavailable');
  assert.equal(h.res.headers['cache-control'],'no-store');
});

test('tenant admins and unverified accounts cannot read platform admin data', async()=>{
  for(const options of [{email:'tenant-admin@atlas.test',verified:true},{email:'owner@atlas.test',verified:false}]) {
    const h=harness(options);
    await h.api.handle(h.req,h.res);
    assert.equal(h.res.status,403);
    assert.equal(h.calls.length,0);
  }
});

test('unknown platform admin paths do not execute SQL', async()=>{
  const h=harness();
  h.req.url='/api/v1/platform-admin/secret-dump';
  await h.api.handle(h.req,h.res);
  assert.equal(h.res.status,404);
  assert.equal(h.calls.length,0);
});

test('cross-tenant payment ledger stays unavailable until an RLS-safe read model exists',async()=>{
 const h=harness();
 h.req.url='/api/v1/platform-admin/payments';
 await h.api.handle(h.req,h.res);
 assert.equal(h.res.status,503);
 assert.equal(JSON.parse(h.res.body).error,'platform_finance_read_model_required');
 assert.equal(h.calls.length,0);
});

test('content moderation queue uses the narrow versioned read function', async()=>{
 const h=harness();
 h.req.url='/api/v1/platform-admin/content?status=open&limit=10';
 await h.api.handle(h.req,h.res);
 assert.equal(h.res.status,200);
 assert.equal(JSON.parse(h.res.body).status,'available');
 const query=h.calls.find(c=>c.sql.includes('atlas_v157_admin_list_content_reports'));
 assert.ok(query);
 assert.deepEqual(query.params,['open',10]);
});

test('notification center uses the narrow versioned read function', async()=>{
 const h=harness();
 h.req.url='/api/v1/platform-admin/notifications?status=failed&limit=7';
 await h.api.handle(h.req,h.res);
 assert.equal(h.res.status,200);
 assert.equal(JSON.parse(h.res.body).delivery,'provider_worker_not_connected');
 const query=h.calls.find(c=>c.sql.includes('atlas_v157_admin_list_notifications'));
 assert.ok(query);
 assert.deepEqual(query.params,['failed',7]);
});

test('moderation and notification filters reject unknown states before querying', async()=>{
 for (const path of ['/api/v1/platform-admin/content?status=delete-all','/api/v1/platform-admin/notifications?status=delivered']) {
  const h=harness();
  h.req.url=path;
  await h.api.handle(h.req,h.res);
  assert.equal(h.res.status,400);
  assert.equal(h.calls.length,0);
 }
});

test('notification attempt history requires a UUID and uses the bounded database function', async()=>{
 const h=harness();
 h.req.url='/api/v1/platform-admin/notifications/00000000-0000-4000-8000-000000000001/attempts';
 await h.api.handle(h.req,h.res);
 assert.equal(h.res.status,200);
 assert.ok(h.calls.some(call=>call.sql.includes('atlas_v157_admin_notification_attempts') && call.params[0]==='00000000-0000-4000-8000-000000000001'));
 const bad=harness();
 bad.req.url='/api/v1/platform-admin/notifications/not-a-uuid/attempts';
 await bad.api.handle(bad.req,bad.res);
 assert.equal(bad.res.status,400);
 assert.equal(bad.calls.length,0);
});
