import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createPostgresPoolConfig } from '../api/database-config.mjs';
import { PostgresRuntimeStore } from '../api/runtime-store.mjs';
import { AutoscalerController, HttpAutoscalerActuator } from '../../packages/atlas-runtime/autoscaler.mjs';
import { AlertRouter } from '../../packages/atlas-runtime/alert-router.mjs';

const env=process.env;
const here=path.dirname(fileURLToPath(import.meta.url));
async function loadResolver(){
 const moduleName=env.ATLAS_WORKER_SECRET_RESOLVER_MODULE;
 if(!moduleName)return null;
 if(!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.mjs$/.test(moduleName))throw new Error('Invalid worker secret resolver module.');
 const base=path.resolve(here,'secrets'),target=path.resolve(base,moduleName);
 if(!target.startsWith(base+path.sep))throw new Error('Secret resolver path escapes reviewed worker directory.');
 const loaded=await import(pathToFileURL(target).href);
 if(typeof loaded.resolveSecret!=='function')throw new Error('Secret resolver must export resolveSecret.');
 return loaded.resolveSecret;
}
const databaseUrl=env.ATLAS_WORKER_DATABASE_URL || (env.NODE_ENV==='production'?'':env.ATLAS_DATABASE_URL);
if(!databaseUrl)throw new Error('Set ATLAS_WORKER_DATABASE_URL.');
const {Pool}=await import('pg');
const pool=new Pool(await createPostgresPoolConfig({...env,ATLAS_DATABASE_URL:databaseUrl},{application_name:'atlas-runtime-control-plane',max:2}));
const store=new PostgresRuntimeStore(pool);
await store.assertSafeWorkerRole();
const poolId=env.ATLAS_RUNTIME_POOL_ID;
if(!poolId)throw new Error('Set ATLAS_RUNTIME_POOL_ID for the runtime control plane.');
const workerId=env.ATLAS_WORKER_ID?env.ATLAS_WORKER_ID+'-control':'control-'+randomUUID();
const resolver=await loadResolver();

let actuator=null;
if(env.ATLAS_AUTOSCALER_ACTUATOR_URL){
 const token=env.ATLAS_AUTOSCALER_ACTUATOR_SECRET_REF&&resolver ? await resolver({secretRef:env.ATLAS_AUTOSCALER_ACTUATOR_SECRET_REF}) : null;
 actuator=new HttpAutoscalerActuator({endpoint:env.ATLAS_AUTOSCALER_ACTUATOR_URL,bearerToken:token,timeoutMs:Number(env.ATLAS_AUTOSCALER_TIMEOUT_MS||5000)});
}
const scaler=env.ATLAS_AUTOSCALER_ENABLED==='true'?new AutoscalerController({store,actuator,leaseSeconds:Number(env.ATLAS_AUTOSCALER_LEASE_SECONDS||60)}):null;
const alerts=env.ATLAS_ALERT_ROUTER_ENABLED==='true'?new AlertRouter({store,secretResolver:resolver}):null;
const intervalMs=Math.max(5000,Math.min(300000,Number(env.ATLAS_AUTOSCALER_INTERVAL_MS||30000)));
let stopping=false,timer;

async function cycle(){
 const snapshot=await store.getRuntimeWorkerSnapshot(poolId);
 if(scaler){
  const budget=await store.getRuntimeSloBudget(poolId);
  const lastScaleAge=await store.getLastScalingActuation(poolId);
  const activeWorkers=Number(snapshot.active_workers||0);
  const utilization=Math.min(1,Number(snapshot.active_jobs||0)/Math.max(1,activeWorkers));
  await scaler.runOnce({
    poolId,workerId,
    queueDepth:Number(snapshot.queue_depth||0),
    activeWorkers:Math.max(1,activeWorkers),
    workerUtilization:utilization,
    sloErrorBudgetRemaining:budget,
    lastScaleAt:Date.now()-lastScaleAge
  });
 }
 if(alerts)await alerts.runOnce();
}

async function loop(){
 while(!stopping){
  try{await cycle();}
  catch(error){process.stderr.write('Atlas control-plane cycle failed ('+(error?.code||'control_plane_failed')+').\n');}
  if(!stopping)await new Promise(resolve=>{timer=setTimeout(resolve,intervalMs);timer.unref?.();});
 }
}
const shutdown=()=>{stopping=true;clearTimeout(timer);};
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
process.stdout.write('Atlas runtime control plane started for pool '+poolId+'.\n');
try{await loop();}finally{await pool.end();}
