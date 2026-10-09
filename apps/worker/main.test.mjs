import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Redis worker subscribes using raw queue names because the transport adds namespace keys', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8');
  assert.match(source, /redisWakeup\.receive\(queues,\s*5\)/);
  assert.doesNotMatch(source, /redisWakeup\.receive\(queues\.map\(q\s*=>/);
});
