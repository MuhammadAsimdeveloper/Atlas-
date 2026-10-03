import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './build-site.mjs';
import { validatePublicOrigin } from './seo.mjs';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(workspaceRoot, 'dist'), { recursive: true });
const temporaryRoot = await mkdtemp(path.join(workspaceRoot, 'dist', 'atlas-seo-check-'));
let assertions = 0;
function verify(condition, message) { assert.ok(condition, message); assertions++; }
function includes(source, value, message) { verify(source.includes(value), message); }
async function smokeSiteHttp(siteDir, isPublic) {
  const routes = new Map([
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/robots.txt', ['robots.txt', 'text/plain; charset=utf-8']],
    ['/app/', ['app/index.html', 'text/html; charset=utf-8']],
    ...(isPublic ? [['/sitemap.xml', ['sitemap.xml', 'application/xml; charset=utf-8']]] : []),
  ]);
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }).end(); return; }
    let url;
    try { url = new URL(request.url || '/', 'http://127.0.0.1'); } catch { response.writeHead(400).end(); return; }
    const route = routes.get(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!route) { response.writeHead(404).end(); return; }
    try { response.writeHead(200, { 'Content-Type': route[1], 'X-Content-Type-Options': 'nosniff' }).end(await readFile(path.join(siteDir, route[0]))); }
    catch { response.writeHead(500).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const page = await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) });
    const pageHtml = await page.text();
    verify(page.status === 200 && pageHtml.includes(isPublic ? 'rel="canonical"' : 'noindex,nofollow'), `${isPublic ? 'Public' : 'Preview'} landing page serves correct index policy over HTTP`);
    const robots = await fetch(`${base}/robots.txt`, { signal: AbortSignal.timeout(2000) });
    const robotsBody = await robots.text();
    verify(robots.status === 200 && robotsBody.includes(isPublic ? 'Sitemap:' : 'Disallow: /'), `${isPublic ? 'Public' : 'Preview'} robots file serves over HTTP`);
    const app = await fetch(`${base}/app/`, { signal: AbortSignal.timeout(2000) });
    verify(app.status === 200 && (await app.text()).includes('noindex,nofollow'), 'Command-center sample serves over HTTP with noindex');
    if (isPublic) {
      const sitemap = await fetch(`${base}/sitemap.xml`, { signal: AbortSignal.timeout(2000) });
      verify(sitemap.status === 200 && (await sitemap.text()).includes('atlas-preview.com/'), 'Public sitemap serves over HTTP');
    }
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
try {
  const previewDir = path.join(temporaryRoot, 'preview');
  await buildSite({ mode: 'preview', outputDir: previewDir });
  const previewHtml = await readFile(path.join(previewDir, 'index.html'), 'utf8');
  const previewRobots = await readFile(path.join(previewDir, 'robots.txt'), 'utf8');
  const previewApp = await readFile(path.join(previewDir, 'app', 'index.html'), 'utf8');
  includes(previewHtml, 'name="robots" content="noindex,nofollow"', 'Preview landing page remains noindex');
  includes(previewRobots, 'Disallow: /', 'Preview robots blocks indexing');
  includes(previewApp, 'name="robots" content="noindex,nofollow"', 'Command center is noindex');
  verify(!previewHtml.includes('rel="canonical"'), 'Preview has no invented canonical domain');
  verify(!previewHtml.includes('application/ld+json'), 'Preview has no indexable structured data');
  let previewHasSitemap = true;
  try { await readFile(path.join(previewDir, 'sitemap.xml')); } catch (error) { if (error.code === 'ENOENT') previewHasSitemap = false; else throw error; }
  verify(!previewHasSitemap, 'Preview has no sitemap');
  await smokeSiteHttp(previewDir, false);

  const origin = 'https://atlas-preview.com';
  verify(validatePublicOrigin(`${origin}/`) === origin, 'Public origin normalizes a harmless trailing slash');
  for (const invalidOrigin of ['http://atlas-preview.com', 'https://atlas-preview.com/path', 'https://localhost.', 'https://192.168.1.8', 'https://atlas.example']) {
    let rejected = false;
    try { validatePublicOrigin(invalidOrigin); } catch { rejected = true; }
    verify(rejected, `Unsafe or reserved public origin is rejected: ${invalidOrigin}`);
  }
  const publicDir = path.join(temporaryRoot, 'public');
  await buildSite({ mode: 'public', origin, outputDir: publicDir });
  const publicHtml = await readFile(path.join(publicDir, 'index.html'), 'utf8');
  const publicRobots = await readFile(path.join(publicDir, 'robots.txt'), 'utf8');
  const sitemap = await readFile(path.join(publicDir, 'sitemap.xml'), 'utf8');
  const structuredBlocks = [...publicHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  verify(structuredBlocks.length === 1, 'Public page has one JSON-LD block');
  const graph = JSON.parse(structuredBlocks[0][1]);
  verify(graph['@graph'].some(item => item['@type'] === 'FAQPage' && item.mainEntity.length === 3), 'JSON-LD FAQ matches visible FAQ count');
  includes(publicHtml, `rel="canonical" href="${origin}/"`, 'Public page has configured canonical');
  verify((publicHtml.match(/rel="canonical"/g) || []).length === 1, 'Public page has exactly one canonical URL');
  verify((publicHtml.match(/name="robots"/g) || []).length === 1, 'Public page has exactly one robots directive');
  includes(publicHtml, 'name="robots" content="index,follow,max-image-preview:large"', 'Public landing is indexable');
  includes(publicHtml, 'name="description" content="Bring customer conversations, governed AI agents, service-desk operations and follow-up automation into one workspace for service businesses."', 'Search description matches the release metadata');
  includes(publicHtml, 'property="og:url" content="https://atlas-preview.com/"', 'Open Graph URL uses configured origin');
  includes(publicRobots, `Sitemap: ${origin}/sitemap.xml`, 'Public robots advertises sitemap');
  includes(sitemap, `<loc>${origin}/</loc>`, 'Sitemap only exposes marketing root');
  verify(!sitemap.includes('/app/'), 'Sample app is excluded from sitemap');
  includes(await readFile(path.join(publicDir, 'app', 'index.html'), 'utf8'), 'name="robots" content="noindex,nofollow"', 'App remains noindex in public build');
  verify(!String(await readFile(path.join(publicDir, 'styles.css'), 'utf8')).includes('fonts.googleapis.com'), 'Marketing stylesheet has no external font dependency');
  verify((publicHtml.match(/<h1\b/g) || []).length === 1, 'Marketing page has exactly one primary heading');
  await smokeSiteHttp(publicDir, true);

  process.stdout.write(`SEO build check: ${assertions} assertions passed (preview noindex, public metadata, schema, sitemap, app exclusion).\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
