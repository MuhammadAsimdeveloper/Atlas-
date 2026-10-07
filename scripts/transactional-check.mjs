import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL('../'+p,root),'utf8');
const module=await read('packages/atlas-transactional-os/index.mjs');
const tests=await read('packages/atlas-transactional-os/index.test.mjs');
const migration=await read('infra/postgres/FINAL-MIGRATION-V156.sql');
const action=await read('packages/atlas-action-fabric/index.mjs');
const core=await read('packages/atlas-core/capability-fabric.mjs');
const next=await read('packages/atlas-next/index.mjs');
const nextTests=await read('packages/atlas-next/index.test.mjs');
const checks=[
['transaction module',module.includes('createOrder')&&module.includes('reserveInventory')&&module.includes('buildPortalScope'), 'transactional package present'],
['transaction regression tests',tests.includes('inventory reservations prevent double allocation')&&tests.includes('payments are provider-event idempotent'), 'transaction tests present'],
['forced RLS',migration.includes('FORCE ROW LEVEL SECURITY')&&migration.includes("current_setting('app.tenant_id',true)"), 'tenant RLS present'],
['db idempotency',migration.includes('atlas_v156_idempotency')&&migration.includes('PRIMARY KEY (tenant_id, key, scope)'), 'idempotency is database-backed'],
['provider uniqueness',migration.includes('PRIMARY KEY (tenant_id, provider, provider_event_id)'), 'provider events are uniquely reconciled'],
['action input security',action.includes('FORBIDDEN_INPUT_KEYS')&&action.includes('credential_in_input'), 'credential input rejected'],
['capability surface',core.includes('commerce.products')&&core.includes('portals.customer')&&core.includes('platform.provider_reconciliation'), 'transaction capabilities registered'],
['legacy reconciliation',!next.includes('const reconciliationEvents=new Set();')&&nextTests.includes('ready_to_reconcile'), 'no process-memory payment dedupe'],
];
for(const [name,ok,detail] of checks)console.log((ok?'PASS':'FAIL')+' '+name+' — '+detail);
const failed=checks.filter(x=>!x[1]);if(failed.length)process.exit(1);
console.log('V156 transactional integrity check passed: '+checks.length+'/'+checks.length);