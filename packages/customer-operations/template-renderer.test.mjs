import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtlasAuthority } from '../atlas-core/authority.mjs';
import { createMessageTemplateVersion, renderMessageTemplateVersion } from './engagement.mjs';
import * as customerOperations from './index.mjs';

const tenantId = 'tenant-render';
const publisherAuthority = resolveAtlasAuthority({
  actor: { id: 'tenant-owner', authenticated: true, email: 'owner@render.example.test' },
  tenantId,
  memberships: [{ id: 'membership-render', actorId: 'tenant-owner', tenantId, role: 'owner', status: 'active' }],
  ownerEmail: 'khan@example.test',
});

test('message renderer is available from the customer-operations package entry point', () => {
  assert.equal(customerOperations.renderMessageTemplateVersion, renderMessageTemplateVersion);
});

function emailTemplate(overrides = {}) {
  return createMessageTemplateVersion({
    tenantId, id: 'appointment-reminder', version: 2, channel: 'email', purpose: 'appointment',
    subjectTemplate: 'Visit for {{contact.first_name}} at {{appointment.start_time}}',
    bodyTemplate: '<p>Hello {{contact.first_name}} &amp; welcome.</p><p><a href="https://book.atlas.example.com/visit">Confirm visit</a></p>',
    bodyFormat: 'html', publisherAuthority, now: 1791043200000, ...overrides,
  });
}

test('renders tenant email drafts with escaped scalar data and safe fixed links', () => {
  const result = renderMessageTemplateVersion({
    template: emailTemplate(), tenantId,
    variables: { contact: { first_name: '<Ada & Co>' }, appointment: { start_time: 'Tuesday, 9 AM' } },
  });
  assert.equal(result.status, 'rendered');
  assert.equal(result.subject, 'Visit for <Ada & Co> at Tuesday, 9 AM');
  assert.match(result.body, /Hello &lt;Ada &amp; Co&gt; &amp; welcome\./);
  assert.match(result.body, /href="https:\/\/book\.atlas\.example\.com\/visit"/);
  assert.deepEqual(result.variablesUsed, ['appointment.start_time', 'contact.first_name']);
  assert.equal(result.templateRef.checksum, emailTemplate().checksum);
  assert.equal(Object.isFrozen(result), true);
});

test('missing merge fields produce a non-sendable needs-data result without partial content', () => {
  const result = renderMessageTemplateVersion({ template: emailTemplate(), tenantId, variables: { contact: {} } });
  assert.equal(result.status, 'needs_data');
  assert.deepEqual(result.missingVariables, ['appointment.start_time', 'contact.first_name']);
  assert.equal(Object.hasOwn(result, 'body'), false);
  assert.equal(Object.hasOwn(result, 'subject'), false);
});

test('renderer rejects foreign tenants, altered releases and malformed template fields', () => {
  const template = emailTemplate();
  assert.throws(() => renderMessageTemplateVersion({ template, tenantId: 'tenant-foreign', variables: {} }), /tenant does not match/);
  assert.throws(() => renderMessageTemplateVersion({ template: { ...template, bodyTemplate: '<script>x</script>' }, tenantId, variables: {} }), /checksum/);
  assert.throws(() => renderMessageTemplateVersion({ template: { ...template, bodyFormat: 'markdown' }, tenantId, variables: {} }), /checksum/);
});

test('HTML templates reject scriptable markup, dynamic attributes and unsafe links', () => {
  for (const bodyTemplate of [
    '<script>alert(1)</script>',
    '<img src="https://example.com/x">',
    '<a href="{{links.booking_url}}">Book</a>',
    '<a href="javascript:alert(1)">Book</a>',
    '<p><strong>unclosed</p>',
    '<p>Compare 1 < 2</p>',
  ]) assert.throws(() => emailTemplate({ bodyTemplate }), /HTML/);
  assert.throws(() => emailTemplate({ bodyTemplate: '<p>{{account.password}}</p>' }), /approved business-data/);
  assert.throws(() => emailTemplate({ bodyTemplate: '<p>{{contact.custom.constructor}}</p>' }), /approved business-data/);
  assert.throws(() => emailTemplate({ bodyTemplate: '<p>{{contact.card_number}}</p>' }), /credential or sensitive-payment/);
  assert.throws(() => emailTemplate({ bodyTemplate: '<p>{{contact.custom.session_token}}</p>' }), /credential or sensitive-payment/);
});

test('email subject data cannot inject headers and object values are never coerced', () => {
  const template = emailTemplate({ subjectTemplate: 'Hello {{contact.first_name}}' });
  assert.throws(() => renderMessageTemplateVersion({ template, tenantId, variables: { contact: { first_name: 'Ada\r\nBcc: victim@example.test' }, appointment: { start_time: '09:00' } } }), /header control characters/);
  assert.throws(() => renderMessageTemplateVersion({ template, tenantId, variables: { contact: { first_name: { toString: 'unsafe' } }, appointment: { start_time: '09:00' } } }), /scalar data/);
});

test('missing accessor-only data is not executed and non-email output stays plain text', () => {
  let invoked = false;
  const contact = {};
  Object.defineProperty(contact, 'first_name', { enumerable: true, get() { invoked = true; return 'unsafe'; } });
  const missing = renderMessageTemplateVersion({ template: emailTemplate(), tenantId, variables: { contact, appointment: { start_time: '09:00' } } });
  assert.equal(invoked, false);
  assert.deepEqual(missing.missingVariables, ['contact.first_name']);

  const sms = createMessageTemplateVersion({
    tenantId, id: 'sms-follow-up', version: 1, channel: 'sms', purpose: 'service',
    bodyTemplate: 'Thanks {{contact.first_name}} <reply STOP to opt out>', publisherAuthority, now: 1791043200000,
  });
  const rendered = renderMessageTemplateVersion({ template: sms, tenantId, variables: { contact: { first_name: '<Ada>' } } });
  assert.equal(rendered.body, 'Thanks <Ada> <reply STOP to opt out>');
  assert.equal(rendered.subject, null);
  assert.throws(() => createMessageTemplateVersion({ tenantId, id: 'bad-sms', version: 1, channel: 'sms', purpose: 'service', bodyTemplate: 'Hi', bodyFormat: 'html', publisherAuthority }), /Only email/);
});
