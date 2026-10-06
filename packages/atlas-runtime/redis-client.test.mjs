import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRedisUrl } from './redis-client.mjs';

test('V150 Redis URL parsing supports TLS, credentials and database selection',()=>{
  assert.deepEqual(parseRedisUrl('rediss://atlas%40worker:secret%21@redis.example.com:6380/3'),{
    tls:true,host:'redis.example.com',port:6380,db:3,password:'secret!',username:'atlas@worker'
  });
});
test('V150 Redis URL parsing rejects unsafe schemes',()=>{
  assert.throws(()=>parseRedisUrl('http://redis.example.com'),/redis:\/\/ or rediss:\/\//);
});
