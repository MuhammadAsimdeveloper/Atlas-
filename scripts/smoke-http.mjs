import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 42000 + Math.floor(Math.random() * 16000);
const server = spawn(process.execPath, [path.join(root, 'scripts', 'preview.mjs')], {
  cwd: root,
  env: { ...process.env, ATLAS_PREVIEW_PORT: String(port) },
  stdio: 'ignore',
  windowsHide: true
});
const base = `http://127.0.0.1:${port}`;

async function get(pathname = '/') {
  return fetch(`${base}${pathname}`, { signal: AbortSignal.timeout(2000) });
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode != null) throw new Error(`Preview server exited with ${server.exitCode}`);
    try { if ((await get('/')).status === 200) { ready = true; break; } } catch { /* Retry local startup. */ }
    await delay(100);
  }
  assert.equal(ready, true, 'preview server starts on loopback');

  const html = await get('/');
  const htmlText = await html.text();
  assert.match(htmlText, /Atlas Business Command Center/);
  assert.match(html.headers.get('content-security-policy') || '', /default-src 'self'/);
  console.log('PASS HTTP GET /: command-center HTML and CSP');

  const app = await get('/app.mjs');
  const appText = await app.text();
  assert.equal(app.status, 200);
  assert.match(appText, /runAtlasCopilotTurn|Operator copilot/);
  assert.match(appText, /service-desk/);
  assert.match(appText, /message-studio/);
  assert.match(appText, /Missing data stops for review/);
  assert.match(appText, /voice-operations/);
  assert.match(appText, /voice-quality/);
  assert.match(appText, /Illustrative data/);
  assert.match(appText, /zero policy\/disclosure failures/);
  assert.match(appText, /Simulation only/);
  assert.match(appText, /No provider connected/);
  console.log('PASS HTTP GET /app.mjs: Copilot, service desk and voice preview');

  const css = await get('/styles.css');
  const cssText = await css.text();
  assert.equal(css.status, 200);
  assert.match(cssText, /\.sidebar/);
  assert.match(cssText, /prefers-reduced-motion/);
  console.log('PASS HTTP GET /styles.css: responsive workspace navigation');

  const traversal = await get('/..%2fREADME.md');
  assert.equal(traversal.status, 404);
  console.log('PASS HTTP encoded traversal blocked');

  const post = await fetch(`${base}/`, { method: 'POST', signal: AbortSignal.timeout(2000) });
  assert.equal(post.status, 405);
  assert.match(post.headers.get('allow') || '', /GET/);
  console.log('PASS HTTP POST rejected by static preview');
  console.log('Atlas HTTP smoke: 5/5 checks passed.');
} finally {
  server.kill();
}
