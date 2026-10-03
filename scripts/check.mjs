import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['packages', 'apps', 'scripts'];
const sourceExtensions = new Set(['.mjs', '.js', '.cjs']);

async function collect(directory, result = []) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(absolute, result);
    else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) result.push(absolute);
  }
  return result;
}

const files = (await Promise.all(roots.map(directory => collect(path.join(root, directory))))).flat().sort();
if (!files.length) {
  process.stderr.write('No JavaScript source files were discovered.\n');
  process.exitCode = 1;
} else {
  let failed = false;
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      failed = true;
      process.stderr.write(`${path.relative(root, file)}\n${result.stderr || result.stdout}`);
    } else process.stdout.write(`PASS syntax ${path.relative(root, file)}\n`);
  }
  if (failed) process.exitCode = 1;
}
