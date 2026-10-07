import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WEBSITE_INSPECTOR_TOOL,
  assertInspectableUrl,
  redactSecrets,
  normalizeInspectionInput,
  buildInspectionReport,
  isPrivateIpAddress
} from './index.mjs';

test('website inspector exposes a read-only tool contract', () => {
  assert.equal(WEBSITE_INSPECTOR_TOOL.name, 'web.inspect');
  assert.equal(WEBSITE_INSPECTOR_TOOL.risk, 'read');
  assert.match(WEBSITE_INSPECTOR_TOOL.description, /isolated browser/i);
  assert.ok(WEBSITE_INSPECTOR_TOOL.capabilities.includes('dom'));
  assert.ok(WEBSITE_INSPECTOR_TOOL.capabilities.includes('network'));
  assert.ok(WEBSITE_INSPECTOR_TOOL.capabilities.includes('client_code'));
});

test('normalizes bounded inspection input and defaults to a safe navigation mode', () => {
  const result = normalizeInspectionInput({ url: 'https://example.com/', selector: 'main', includeSource: true });
  assert.equal(result.url, 'https://example.com/');
  assert.equal(result.selector, 'main');
  assert.equal(result.includeSource, true);
  assert.equal(result.waitUntil, 'domcontentloaded');
  assert.equal(result.maxRequests, 150);
  assert.equal(result.maxAssetBytes, 262144);
});

test('rejects malformed URLs, embedded credentials and unsupported schemes', async () => {
  await assert.rejects(() => assertInspectableUrl('not-a-url'), /valid HTTP(S) URL/i);
  await assert.rejects(() => assertInspectableUrl('https://user:pass@example.com'), /embedded credentials/i);
  await assert.rejects(() => assertInspectableUrl('file:///etc/passwd'), /HTTP(S)/i);
});

test('recognizes private and loopback IP addresses', () => {
  assert.equal(isPrivateIpAddress('127.0.0.1'), true);
  assert.equal(isPrivateIpAddress('10.10.10.10'), true);
  assert.equal(isPrivateIpAddress('172.16.0.10'), true);
  assert.equal(isPrivateIpAddress('192.168.1.10'), true);
  assert.equal(isPrivateIpAddress('169.254.1.1'), true);
  assert.equal(isPrivateIpAddress('::1'), true);
  assert.equal(isPrivateIpAddress('fc00::1'), true);
  assert.equal(isPrivateIpAddress('2001:db8::1'), true);
  assert.equal(isPrivateIpAddress('8.8.8.8'), false);
});

test('redacts credential-shaped material before returning inspected client code', () => {
  const source = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def const key = "sk-test-12345678901234567890";';
  const redacted = redactSecrets(source);
  assert.doesNotMatch(redacted, /eyJhbGci/);
  assert.doesNotMatch(redacted, /sk-test/);
  assert.match(redacted, /[REDACTED]/);
});

test('builds a bounded report from browser observations without credential fields', () => {
  const report = buildInspectionReport({
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    status: 200,
    title: 'Example',
    html: '<main>Hello</main>',
    scripts: [{ src: 'https://cdn.example/app.js', inline: 'const token = "sk-test-12345678901234567890"' }],
    styles: [{ href: 'https://cdn.example/app.css', inline: 'body{margin:0}' }],
    network: [{ method: 'GET', url: 'https://example.com/?token=secret', status: 200, resourceType: 'document' }],
    console: [{ level: 'error', text: 'Bearer eyJhbGciOiJIUzI1NiJ9.abc.def' }],
    performance: { domContentLoadedMs: 42 }
  });
  assert.equal(report.finalUrl, 'https://example.com/');
  assert.equal(report.page.title, 'Example');
  assert.doesNotMatch(JSON.stringify(report), /sk-test-/);
  assert.doesNotMatch(JSON.stringify(report), /eyJhbGci/);
  assert.doesNotMatch(report.network[0].url, /token=secret/);
  assert.equal(report.schemaVersion, '1.0');
});
