import { spawn } from 'node:child_process';

const strictExternal = process.argv.includes('--strict-external');
const checks = [
  ['unit tests','npm',['test']],
  ['repository check','npm',['run','check']],
  ['security doctor','npm',['run','security:check']],
  ['MiroFish','npm',['run','mirofish:check']],
  ['documentation check','npm',['run','docs:check']],
  ['SEO check','npm',['run','seo:check']],
  ['launch check','npm',['run','launch:check']],
  ['production check','npm',['run','production:check']],
  ['production activation gate','npm',['run','production:activation-check']]
];

function run(label, command, args){
  return new Promise(resolve=>{
    const child=spawn(command,args,{stdio:'inherit',env:process.env,shell:false});
    child.once('exit',code=>resolve({label,code:code??1}));
    child.once('error',error=>{process.stderr.write(label+': '+error.message+'\n');resolve({label,code:1});});
  });
}

if(strictExternal){
  const required=['ATLAS_PUBLIC_ORIGIN','ATLAS_SECURITY_CONTACT','ATLAS_PROVIDER_ACTIVATION_EVIDENCE_REF','ATLAS_REDIS_URL'];
  const missing=required.filter(k=>!process.env[k]);
  if(missing.length){process.stderr.write('Strict external preflight missing: '+missing.join(', ')+'\n');process.exit(2);}
}
const results=[];
for(const [label,command,args] of checks){
  const result=await run(label,command,args); results.push(result);
  if(result.code!==0) break;
}
const failed=results.filter(r=>r.code!==0);
process.stdout.write(JSON.stringify({status:failed.length?'failed':'passed',strictExternal,checks:results},null,2)+'\n');
if(failed.length) process.exit(1);
