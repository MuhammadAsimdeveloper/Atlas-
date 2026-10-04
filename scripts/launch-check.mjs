import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = ['README.md', 'RELEASE-MANIFEST.txt', 'docs/LAUNCH-READINESS.md', 'docs/14-DAY-FREE-TRIAL.md', 'docs/ATLAS-MASTER-ROADMAP.md', 'docs/EXECUTION-ENGINE.md', 'docs/V116-WORKFLOW-STUDIO.md', 'docs/PRODUCTION-ARCHITECTURE.md', 'apps/marketing-site/index.html', 'apps/marketing-site/styles.css', 'apps/command-center/index.html', 'apps/command-center/app.mjs', 'apps/command-center/workflow-studio.mjs', 'scripts/build-site.mjs', 'scripts/seo-check.mjs', '.github/workflows/ci.yml'];
for (const file of required) await access(path.join(root, file));
const marketing = await readFile(path.join(root, 'apps/marketing-site/index.html'), 'utf8');
const release = await readFile(path.join(root, 'RELEASE-MANIFEST.txt'), 'utf8');
const trialGuide = await readFile(path.join(root, 'docs/14-DAY-FREE-TRIAL.md'), 'utf8');
const billingUi = await readFile(path.join(root, 'apps/command-center/auth.html'), 'utf8');
const checks = [
  ['marketing page is preview-safe', /noindex,nofollow/.test(marketing)],
  ['marketing page does not claim connected channels', !marketing.includes('Across connected channels')],
  ['release boundary states external production work', release.includes('Not verified / external work')],
  ['trial guide covers provider setup and cancellation', trialGuide.includes('14-day') && trialGuide.includes('cancel') && trialGuide.includes('do not create a real Paddle customer')],
  ['workspace shows trial and cancellation controls', billingUi.includes('Start 14-day free trial') && billingUi.includes('Manage or cancel plan')],
  ['launch guide exists', true]
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) process.stdout.write((ok ? 'PASS ' : 'FAIL ') + name + '\n');
if (failed.length) process.exitCode = 1;
else process.stdout.write(`Atlas launch check: ${checks.length}/${checks.length} checks passed.\n`);
