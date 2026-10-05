import test from 'node:test';
import assert from 'node:assert/strict';
import { RedisRespClient } from './redis-client.mjs';
import net from 'node:net';
test('Redis client rejects unsafe protocol',()=>assert.throws(()=>new RedisRespClient({url:'http://localhost:6379'}),/redis:\/\//));
test('Redis client accepts redis and rediss URLs',()=>{assert.doesNotThrow(()=>new RedisRespClient({url:'redis://localhost:6379/0'}));assert.doesNotThrow(()=>new RedisRespClient({url:'rediss://localhost:6379/0'}));});
test('Redis client enforces bounded connect timeout',()=>assert.throws(()=>new RedisRespClient({url:'redis://localhost:6379',connectTimeoutMs:100}),/timeout/));

test('Redis client parses RESP replies over a real socket',async()=>{const server=net.createServer(socket=>{socket.once('data',()=>socket.write('+PONG\\r\\n'));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;const client=new RedisRespClient({url:'redis://127.0.0.1:'+port,connectTimeoutMs:1000});try{assert.equal(await client.command('PING'),'PONG');}finally{client.disconnect();await new Promise(resolve=>server.close(resolve));}});
