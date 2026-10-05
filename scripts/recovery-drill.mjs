import { randomUUID } from 'node:crypto';
import { createPostgresPoolConfig } from '../apps/api/database-config.mjs';
import { PostgresRuntimeStore } from '../apps/api/runtime-store.mjs';
import { RecoveryDrillRunner } from '../packages/atlas-runtime/recovery-drills.mjs';

const env=process.env;
const argv=process.argv.slice(2);
function arg(name, fallback=null){const index=argv.indexOf(name);return index>=0?argv[index+1]||fallback:fallback;}
const scenario=arg('--scenario','redis_failure');
const poolId=arg('--pool',env.ATLAS_RUNTIME_POOL_ID);
if(!poolId)throw new Error('Set ATLAS_RUNTIME_POOL_ID or pass --pool.');
const databaseUrl=env.ATLAS_WORKER_DATABASE_URL || (env.NODE_ENV==='production'?'':env.ATLAS_DATABASE_URL);
if(!databaseUrl)throw new Error('Set ATLAS_WORKER_DATABASE_URL.');
const {Pool}=await import('pg');
const pool=new Pool(await createPostgresPoolConfig({...env,ATLAS_DATABASE_URL:databaseUrl},{application_name:'atlas-recovery-drill',max:1}));
const store=new PostgresRuntimeStore(pool);
await store.assertSafeWorkerRole();
try{
 const drill=new RecoveryDrillRunner({store});
 const result=await drill.run({drillId:'drill-'+randomUUID(),poolId,scenario,simulate:env.ATLAS_RECOVERY_LIVE==='true'?false:true});
 console.log(JSON.stringify(result,null,2));
 if(result.status!=='passed')process.exitCode=1;
}finally{await pool.end();}
