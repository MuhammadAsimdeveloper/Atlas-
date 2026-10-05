import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvidenceReport } from '../packages/atlas-runtime/deployment-evidence.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(path.join(root,'infra/production/atlas-production.manifest.json'),'utf8'));
const evidenceDir=process.env.ATLAS_EVIDENCE_DIR?path.resolve(process.env.ATLAS_EVIDENCE_DIR):path.join(root,'infra/production/evidence');
let names=[];try{names=await readdir(evidenceDir);}catch{names=[];}
const records=[];
for(const name of names.filter(n=>n.endsWith('.json'))){
 try{records.push(JSON.parse(await readFile(path.join(evidenceDir,name),'utf8')));}catch{}
}
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const report=buildEvidenceReport({release:pkg.version,manifest,records});
console.log(JSON.stringify(report,null,2));
if(!report.ready)process.exitCode=1;
