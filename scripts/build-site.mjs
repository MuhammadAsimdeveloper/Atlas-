import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeNoindex, renderPreviewRobots, renderPublicIndex, renderPublicRobots, renderPublicSitemap, validatePublicOrigin } from './seo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(args) {
  let mode = 'preview';
  let origin = process.env.ATLAS_PUBLIC_ORIGIN || '';
  let outputDir = path.join(root, 'dist', 'atlas-site');
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--mode') mode = args[++index];
    else if (arg === '--origin') origin = args[++index];
    else if (arg === '--out-dir') outputDir = args[++index];
    else if (arg === '--help') return { help: true };
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['preview', 'public'].includes(mode)) throw new Error('--mode must be preview or public.');
  if (mode === 'public') origin = validatePublicOrigin(origin);
  return { mode, origin, outputDir };
}

async function assertSafeOutput(destination) {
  const absolute = path.resolve(destination);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output directory must be a child of the Atlas workspace.');
  const distDir = path.join(root, 'dist');
  const relativeToDist = path.relative(distDir, absolute);
  if (!relativeToDist || relativeToDist.startsWith('..') || path.isAbsolute(relativeToDist)) throw new Error('Build output must be inside dist/ and may not replace the dist/ directory.');
  try { if ((await lstat(distDir)).isSymbolicLink()) throw new Error('Refusing to build through a dist/ symbolic link.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return absolute;
}

export async function buildSite(options = {}) {
  const mode = options.mode || 'preview';
  if (!['preview', 'public'].includes(mode)) throw new Error('Build mode must be preview or public.');
  const origin = mode === 'public' ? validatePublicOrigin(options.origin) : '';
  const outputDir = await assertSafeOutput(options.outputDir || path.join(root, 'dist', 'atlas-site'));
  const marketingDir = path.join(root, 'apps', 'marketing-site');
  const appDir = path.join(root, 'apps', 'command-center');
  await readdir(marketingDir);
  await readdir(appDir);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  for (const entry of await readdir(marketingDir, { withFileTypes: true })) {
    if (entry.name === 'index.html') continue;
    await cp(path.join(marketingDir, entry.name), path.join(outputDir, entry.name), { recursive: true });
  }
  const marketingHtml = await readFile(path.join(marketingDir, 'index.html'), 'utf8');
  const publicMetaOptions = {
    googleSiteVerification: process.env.ATLAS_GOOGLE_SITE_VERIFICATION || '',
    bingSiteVerification: process.env.ATLAS_BING_SITE_VERIFICATION || '',
    lastModified: process.env.ATLAS_SITE_LASTMOD || undefined,
  };
  await writeFile(
    path.join(outputDir, 'index.html'),
    mode === 'public' ? renderPublicIndex(marketingHtml, origin, publicMetaOptions) : makeNoindex(marketingHtml),
    'utf8'
  );
  const appOutput = path.join(outputDir, 'app');
  await cp(appDir, appOutput, { recursive: true });
  const appHtmlPath = path.join(appOutput, 'index.html');
  const appHtml = await readFile(appHtmlPath, 'utf8');
  await writeFile(appHtmlPath, makeNoindex(appHtml), 'utf8');
  await writeFile(path.join(outputDir, 'robots.txt'), mode === 'public' ? renderPublicRobots(origin) : renderPreviewRobots(), 'utf8');
  if (mode === 'public') await writeFile(path.join(outputDir, 'sitemap.xml'), renderPublicSitemap(origin), 'utf8');
  return { mode, origin: origin || null, outputDir, files: ['index.html', 'robots.txt', ...(mode === 'public' ? ['sitemap.xml'] : []), 'app/index.html'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write('Atlas static site builder\n  node scripts/build-site.mjs [--mode preview|public] [--origin https://your-domain]\n');
    } else {
      const result = await buildSite(options);
      process.stdout.write(`Atlas ${result.mode} site built at ${path.relative(root, result.outputDir).replaceAll(path.sep, '/')}\n`);
      process.stdout.write(result.mode === 'preview' ? 'Search indexing: disabled (noindex + disallow all).\n' : `Canonical origin: ${result.origin}\nSearch indexing: enabled; app stays noindex.\n`);
    }
  } catch (error) {
    process.stderr.write(`Site build failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
