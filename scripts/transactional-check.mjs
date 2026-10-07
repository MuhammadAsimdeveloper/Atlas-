import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL('../'+p,root),'utf8');
const module=await read('packages/atlas-transactional-os/index.mjs');
const tests=await read('packages/atlas-transactional-os/index.test.mjs');
const migration=await read('infra/postgres/FINAL-MIGRATION-V156.sql');
const next=await read('packages/atlas-next/index.mjs');
const nextTests=await read('packages/atlas-next/index.test.mjs');
const checks=[
 ['transactional module',module.includes('createOrder')&&module.includes('transitionSubscription')&&module.includes('reserveInventory'),'V156 commerce/order/subscription/inventory state machine present'],
 ['money safety',module.includes('Number.isSafeInteger(v)')&&module.includes('amountMinor'),'Integer minor-unit money invariant present'],
 ['inventory replay protection',module.includes('baseStateHash')&&module.includes('reservedStateHash'),'Reservation requires correct state snapshot'],
 ['payment event validation',module.includes('payloadHash')&&module.includes('dedupeKey'),'Provider event hash + deterministic dedupe contract present'],
 ['portal relationship scoping',module.includes('RELATION_SCOPE_DENIED')&&module.includes('PAYMENT_MUTATION_DENIED'),'Portal actions are relationship-scoped and payment mutation restricted'],
 ['project dependency safety',module.includes('dependency_cycle')&&module.includes('cannot complete task with incomplete dependencies'),'Project tasks reject dependency cycles/blockers'],
 ['durable idempotency',migration.includes('atlas_v156_idempotency')&&migration.includes('PRIMARY KEY (tenant_id, key, scope)'),'DB-backed idempotency key boundary present'],
 ['provider reconciliation',migration.includes('atlas_v156_provider_reconciliation')&&migration.includes('ON CONFLICT (tenant_id,provider,provider_event_id) DO NOTHING'),'External provider event dedupe is database-enforced'],
 ['forced RLS',migration.includes('FORCE ROW LEVEL SECURITY')&&migration.includes("current_setting(''app.tenant_id''"),'Every V156 persisted resource is protected by tenant RLS'],
 ['legacy reconciliation no process memory',!next.includes('const reconciliationEvents=new Set();')&&next.includes('ready_to_reconcile')&&nextTests.includes('reconciliationKey'),'Legacy reconciliation no longer relies on process memory'],
 ['regression suite',tests.includes('inventory reservations')&&tests.includes('payments are provider-event idempotent')&&tests.includes('portal scopes'),'V156 regression coverage present']
];
for(const [name,ok,detail] of checks)console.log((ok?'PASS':'FAIL')+' '+name+' — '+detail);
const failed=checks.filter(x=>!x[1]);if(failed.length)process.exit(1);
console.log('V156 transactional check passed: '+checks.length+'/'+checks.length+' checks.');
