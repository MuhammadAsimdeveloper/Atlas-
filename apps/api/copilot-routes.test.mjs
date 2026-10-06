import test from 'node:test';
import assert from 'node:assert/strict';

test('V153 Copilot API module loads with verified release import', async () => {
  const mod = await import('./copilot-routes.mjs');
  assert.equal(typeof mod.createCopilotApi, 'function');
  assert.equal(typeof mod.PostgresCopilotStore, 'function');
});

test('V153 Copilot API fails closed when dependencies are incomplete', async () => {
  const { createCopilotApi } = await import('./copilot-routes.mjs');
  assert.throws(() => createCopilotApi({}), /dependencies are incomplete/);
});
