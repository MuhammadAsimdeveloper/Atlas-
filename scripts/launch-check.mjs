import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = ['README.md', 'RELEASE-MANIFEST.txt', 'docs/LAUNCH-READINESS.md', 'apps/marketing-site/index.html', 'apps/marketing-site/styles.css', 'apps/command-center/index.html', 'apps/command-center/app.mjs', 'scripts/build-site.mjs', 'scripts/seo-check.mjs', '.github/workflows/ci.yml'];
for (const file of required) await access(path.join(root, file));
const marketing = await readFile(path.join(root, 'apps/marketing-site/index.html'), 'utf8');
const release = await readFile(path.join(root, 'RELEASE-MANIFEST.txt'), 'utf8');
const checks = [
  ['marketing page is preview-safe', /noindex,nofollow/.test(marketing)],
  ['marketing page does not claim connected channels', !marketing.includes('Across connected channels')],
  ['release boundary states external production work', release.includes('Not verified / external work')],
  ['launch guide exists', true]
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) process.stdout.write((ok ? 'PASS ' : 'FAIL ') + name + '\n');
if (failed.length) process.exitCode = 1;
else process.stdout.write(`Atlas launch check: ${checks.length}/${checks.length} checks passed.\n`);
