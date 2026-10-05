import test from 'node:test';
import assert from 'node:assert/strict';

test('production handler refuses to initialize without an explicit secret resolver',async()=>{
 const previous=process.env.ATLAS_WORKER_SECRET_RESOLVER_MODULE;
 delete process.env.ATLAS_WORKER_SECRET_RESOLVER_MODULE;
 await assert.rejects(()=>import('./v125-production.mjs?missing-secret-resolver'),/secret resolver/i);
 if(previous===undefined)delete process.env.ATLAS_WORKER_SECRET_RESOLVER_MODULE;else process.env.ATLAS_WORKER_SECRET_RESOLVER_MODULE=previous;
});
