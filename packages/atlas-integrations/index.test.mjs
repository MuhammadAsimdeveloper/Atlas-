import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_CATALOG, listProviders, getProvider, buildProviderConnectionPlan,
  normalizeCrmRecord, mapAtlasToProvider, listIntegrationRecipes
} from './index.mjs';

test('provider catalog contains Jobber, Zapier and major CRM/service providers', () => {
  for (const id of ['jobber','zapier','hubspot','salesforce','zoho-crm','pipedrive','gohighlevel','servicetitan','housecall-pro']) {
    assert.ok(PROVIDER_CATALOG.some(provider => provider.id === id), id);
  }
});

test('provider capability search and connection planning fail closed', () => {
  assert.equal(listProviders({query:'jobber'})[0].id, 'jobber');
  assert.throws(() => getProvider('missing-provider'), /not found/);
  const plan = buildProviderConnectionPlan({providerId:'jobber',tenantId:'tenant-1',requestedCapabilities:['clients','jobs'],syncMode:'bidirectional'});
  assert.deepEqual(plan.capabilities,['clients','jobs']);
  assert.ok(plan.scopes.includes('clients:read'));
  assert.throws(() => buildProviderConnectionPlan({providerId:'jobber',tenantId:'tenant-1',requestedCapabilities:['payments'],syncMode:'outbound'}), /sync mode/);
});

test('CRM normalization and field mapping are provider-neutral', () => {
  const record = normalizeCrmRecord('hubspot',{id:'123',type:'contact',firstName:'Ada',lastName:'Lovelace',email:' ADA@EXAMPLE.COM ',phone:'+1 555 0100'});
  assert.equal(record.name,'Ada Lovelace');
  assert.equal(record.email,'ada@example.com');
  const mapped = mapAtlasToProvider({providerId:'salesforce',atlasContact:{firstName:'Ada',lastName:'Lovelace',email:'ada@example.com'}});
  assert.equal(mapped.fields.firstName,'Ada');
  assert.equal(mapped.fields.email,'ada@example.com');
});

test('recipes expose Jobber/Zapier handoffs without pretending they are live', () => {
  assert.ok(listIntegrationRecipes({providerId:'jobber'}).length >= 2);
  assert.ok(listIntegrationRecipes({providerId:'zapier'}).length >= 1);
});
