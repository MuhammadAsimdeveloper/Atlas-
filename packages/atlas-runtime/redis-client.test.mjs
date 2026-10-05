import test from 'node:test';
import assert from 'node:assert/strict';
import { RedisRespClient } from './redis-client.mjs';
test('Redis client rejects unsafe protocol',()=>assert.throws(()=>new RedisRespClient({url:'http://localhost:6379'}),/redis:\/\//));
test('Redis client accepts redis and rediss URLs',()=>{assert.doesNotThrow(()=>new RedisRespClient({url:'redis://localhost:6379/0'}));assert.doesNotThrow(()=>new RedisRespClient({url:'rediss://localhost:6379/0'}));});
test('Redis client enforces bounded connect timeout',()=>assert.throws(()=>new RedisRespClient({url:'redis://localhost:6379',connectTimeoutMs:100}),/timeout/));
