import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 43000 + Math.floor(Math.random() * 14000);
const server = spawn(process.execPath, [path.join(root, 'apps', 'api', 'server.mjs')], {
  cwd: root,
  env: { ...process.env, NODE_ENV: 'test', PORT: String(port), ATLAS_RELEASE: 'V112', ATLAS_DATABASE_URL: '', ATLAS_PUBLIC_ORIGIN: '', ATLAS_PLATFORM_OWNER_EMAIL: '' },
  stdio: 'ignore', windowsHide: true
});
const base = `http://127.0.0.1:${port}`;
const get = pathname => fetch(`${base}${pathname}`, { signal: AbortSignal.timeout(2500) });

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode != null) throw new Error(`Atlas API exited with ${server.exitCode}`);
    try { if ((await get('/health/live')).status === 200) { ready = true; break; } } catch { /* Local startup can need another tick. */ }
    await delay(100);
  }
  assert.equal(ready, true, 'Atlas API starts');

  const live = await get('/health/live');
  assert.equal((await live.json()).release, 'V112');
  const homepage = await get('/');
  const html = await homepage.text();
  assert.equal(homepage.status, 200);
  assert.match(html, /Create workspace/);
  assert.match(html, /Business time zone/);
  assert.match(homepage.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.match(homepage.headers.get('cache-control') || '', /no-store/);

  const module = await get('/auth.mjs');
  assert.equal(module.status, 200);
  assert.match(await module.text(), /csrf/);
  const styles = await get('/auth.css');
  assert.equal(styles.status, 200);
  assert.match(await styles.text(), /prefers-reduced-motion/);
  const modalStyles = await get('/auth-modal.css');
  assert.equal(modalStyles.status, 200);
  assert.match(await modalStyles.text(), /workspace-dialog/);

  const status = await get('/api/v1/status');
  assert.equal((await status.json()).authenticatedApi, false);
  const readyResponse = await get('/health/ready');
  assert.equal(readyResponse.status, 503);
  assert.equal((await readyResponse.json()).database, 'missing');
  const me = await get('/api/v1/me');
  assert.equal(me.status, 503);
  assert.equal((await me.json()).error, 'database_required');
  console.log('Atlas API HTTP smoke: 8/8 checks passed (auth UI, assets, status, readiness and fail-closed tenant routes).');
} finally {
  server.kill();
}
