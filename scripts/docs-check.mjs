import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'data' || entry.name === 'work') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(full);
  }
}

await walk(root);
let errors = 0;
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  if (!source.endsWith('\n')) { process.stderr.write(`${relative}: missing final newline\n`); errors++; }
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (/[\t ]+$/.test(lines[index])) { process.stderr.write(`${relative}:${index + 1}: trailing whitespace\n`); errors++; }
  }
}
process.stdout.write(`Documentation check: ${files.length} Markdown files, ${errors} error(s).\n`);
if (errors) process.exitCode = 1;
