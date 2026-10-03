import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'command-center');
const port = Number(process.env.ATLAS_PREVIEW_PORT || 4173);
const types = new Map([['.html', 'text/html; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8']]);

if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('ATLAS_PREVIEW_PORT must be from 1024 to 65535');

http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method || '')) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname); }
  catch { response.writeHead(400).end(); return; }
  if (pathname === '/') pathname = '/index.html';
  const target = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(404).end(); return; }
  try {
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': types.get(path.extname(target)) || 'application/octet-stream', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    if (request.method === 'HEAD') response.end(); else response.end(body);
  } catch { response.writeHead(404).end(); }
}).listen(port, '127.0.0.1', () => process.stdout.write(`Atlas command-center preview: http://127.0.0.1:${port}/\n`));
