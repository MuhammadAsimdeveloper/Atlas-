import {readFile} from 'node:fs/promises';import {ATLAS_CAPABILITIES} from '../packages/atlas-core/capability-fabric.mjs';
const required=['apps/api/capability-store.mjs','apps/api/capability-routes.mjs','apps/api/event-ingress.mjs','apps/worker/workflow-executor.mjs','apps/worker/provider-adapters.mjs','infra/postgres/FINAL-MIGRATION-V122.sql'];
for(const path of required)await readFile(new URL('../'+path,import.meta.url));
if(ATLAS_CAPABILITIES.length<113)throw new Error('Capability registry regression: expected at least 113 governed capabilities after the V156 transactional stage.');
const domains=new Set(ATLAS_CAPABILITIES.map(x=>x.domain));for(const d of ['communication','automation','crm','marketing','ai','saas','enterprise','platform','learning'])if(!domains.has(d))throw new Error('Missing capability domain '+d);
console.log('Atlas capability check passed: expanded V155 capability registry, runtime boundaries and migration present.');