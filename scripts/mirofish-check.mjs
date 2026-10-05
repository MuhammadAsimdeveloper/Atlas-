import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../docs/MIROFISH-ATLAS-DECISION-RECORD-2026-10.md', import.meta.url), 'utf8');

const required = [
  ['six-stage simulation process', 'The MiroFish run completed the six-stage decision process'],
  ['ten simulated stakeholders', '10. International SaaS buyer'],
  ['trust as a first-class feature', 'Trust is a first-class feature'],
  ['killer workflow', 'Lead → CRM → qualification → automated follow-up → appointment → pipeline update → reporting'],
  ['execution milestone', 'Execution becomes the next major platform milestone'],
  ['hypothesis evidence policy', 'MiroFish findings are hypotheses'],
  ['no false market certainty', 'probability of Atlas success']
];

for (const [label, phrase] of required) {
  if (!source.includes(phrase)) throw new Error(`MiroFish regression failed: missing ${label}`);
}

console.log('PASS MiroFish decision-record regression: strategic constraints remain encoded');
