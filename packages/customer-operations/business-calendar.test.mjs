import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAtlasAuthority } from '../atlas-core/authority.mjs';
import {
  addBusinessMinutes, businessMinutesBetween, createSupportBusinessCalendar,
  reviseSupportBusinessCalendar, validateSupportBusinessCalendar
} from './business-calendar.mjs';
import { assessSupportCaseSla, createSupportCase, transitionSupportCase } from './service-desk.mjs';

const tenantId = 'tenant-calendar';
const admin = resolveAtlasAuthority({
  actor: { id: 'calendar-admin', authenticated: true }, tenantId,
  memberships: [{ id: 'calendar-admin-membership', actorId: 'calendar-admin', tenantId, role: 'admin', status: 'active' }],
  ownerEmail: 'khan@example.test'
});
const member = resolveAtlasAuthority({
  actor: { id: 'calendar-member', authenticated: true }, tenantId,
  memberships: [{ id: 'calendar-member-membership', actorId: 'calendar-member', tenantId, role: 'member', status: 'active' }],
  ownerEmail: 'khan@example.test'
});
const allDays = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, [{ start: '09:00', end: '17:00' }]]));

test('business calendars are tenant-admin-owned immutable checksummed revisions', () => {
  const calendar = createSupportBusinessCalendar({ authority: admin, tenantId, id: 'support-hours', timeZone: 'America/Los_Angeles', weeklyHours: allDays });
  assert.equal(calendar.version, 1);
  assert.equal(validateSupportBusinessCalendar(calendar, tenantId).checksum, calendar.checksum);
  const changed = reviseSupportBusinessCalendar({ authority: admin, previousCalendar: calendar, holidays: ['2026-12-25'] });
  assert.equal(changed.version, 2);
  assert.deepEqual(calendar.holidays, []);
  assert.deepEqual(changed.holidays, ['2026-12-25']);
  assert.throws(() => validateSupportBusinessCalendar({ ...calendar, weeklyHours: {} }, tenantId), /checksum/);
  assert.throws(() => validateSupportBusinessCalendar(calendar, 'tenant-other'), /tenant scope/);
  assert.throws(() => createSupportBusinessCalendar({ authority: member, tenantId, id: 'member-calendar', timeZone: 'UTC', weeklyHours: allDays }), /Tenant membership/);
  assert.throws(() => createSupportBusinessCalendar({ authority: admin, tenantId, id: 'bad-zone', timeZone: 'Mars/Olympus', weeklyHours: allDays }), /IANA timezone/);
  assert.throws(() => createSupportBusinessCalendar({ authority: admin, tenantId, id: 'overlap', timeZone: 'UTC', weeklyHours: { 1: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }] } }), /overlap/);
  assert.throws(() => createSupportBusinessCalendar({ authority: admin, tenantId, id: 'bad-date', timeZone: 'UTC', holidays: ['2026-02-30'] }), /real date/);
});

test('business deadlines skip closed periods, holidays and daylight-saving offsets', () => {
  const weekdayCalendar = createSupportBusinessCalendar({
    authority: admin, tenantId, id: 'weekday-hours', timeZone: 'America/Los_Angeles',
    weeklyHours: { 1: [{ start: '09:00', end: '17:00' }], 2: [{ start: '09:00', end: '17:00' }], 3: [{ start: '09:00', end: '17:00' }], 4: [{ start: '09:00', end: '17:00' }], 5: [{ start: '09:00', end: '17:00' }] }
  });
  assert.equal(addBusinessMinutes({ calendar: weekdayCalendar, startAt: '2026-10-02T23:30:00.000Z', minutes: 90 }), '2026-10-05T17:00:00.000Z');
  assert.equal(businessMinutesBetween({ calendar: weekdayCalendar, startAt: '2026-10-02T23:30:00.000Z', endAt: '2026-10-05T17:00:00.000Z' }), 90);

  const holidayCalendar = reviseSupportBusinessCalendar({ authority: admin, previousCalendar: weekdayCalendar, holidays: ['2026-10-05'] });
  assert.equal(addBusinessMinutes({ calendar: holidayCalendar, startAt: '2026-10-02T23:30:00.000Z', minutes: 90 }), '2026-10-06T17:00:00.000Z');
  const openHoliday = reviseSupportBusinessCalendar({ authority: admin, previousCalendar: holidayCalendar, dateOverrides: { '2026-10-05': [{ start: '12:00', end: '13:00' }] } });
  assert.equal(addBusinessMinutes({ calendar: openHoliday, startAt: '2026-10-03T00:00:00.000Z', minutes: 60 }), '2026-10-05T20:00:00.000Z');

  const dstCalendar = createSupportBusinessCalendar({ authority: admin, tenantId, id: 'dst-hours', timeZone: 'America/Los_Angeles', weeklyHours: {
    0: [{ start: '01:00', end: '02:30' }, { start: '02:30', end: '04:00' }]
  } });
  assert.equal(businessMinutesBetween({ calendar: dstCalendar, startAt: '2026-11-01T08:00:00.000Z', endAt: '2026-11-01T10:30:00.000Z' }), 150);
  assert.equal(addBusinessMinutes({ calendar: dstCalendar, startAt: '2026-03-08T09:00:00.000Z', minutes: 90 }), '2026-03-08T10:30:00.000Z');
  assert.equal(businessMinutesBetween({ calendar: dstCalendar, startAt: '2026-03-08T10:00:00.000Z', endAt: '2026-03-08T11:00:00.000Z' }), 60);
});

test('support SLA deadlines pin a calendar revision and customer waits pause business minutes', () => {
  const calendar = createSupportBusinessCalendar({ authority: admin, tenantId, id: 'daily-hours', timeZone: 'America/Los_Angeles', weeklyHours: allDays });
  const supportCase = createSupportCase({
    authority: admin, id: 'case-business-sla', tenantId, channel: 'webchat', subject: 'Appointment reschedule',
    createdAt: '2026-10-02T16:00:00.000Z', slaCalendar: calendar, firstResponseSlaMinutes: 120, resolutionSlaMinutes: 600
  });
  assert.equal(supportCase.firstResponseDueAt, '2026-10-02T18:00:00.000Z');
  assert.equal(supportCase.resolutionDueAt, '2026-10-03T18:00:00.000Z');
  assert.equal(supportCase.slaCalendarRef, 'daily-hours');
  assert.equal(supportCase.slaCalendarVersion, 1);
  assert.throws(() => createSupportCase({ authority: admin, tenantId, channel: 'webchat', subject: 'bad', slaCalendar: calendar, firstResponseSlaMinutes: 15, firstResponseDueAt: '2026-10-02T17:00:00.000Z' }), /either computed business/);
  assert.throws(() => assessSupportCaseSla({ caseRecord: supportCase, now: Date.parse('2026-10-02T17:00:00.000Z'), calendar: reviseSupportBusinessCalendar({ authority: admin, previousCalendar: calendar }) }), /pinned tenant calendar/);

  const waiting = transitionSupportCase({ caseRecord: supportCase, authority: admin, tenantId, status: 'waiting_customer', reasonCode: 'appointment_help', commandId: 'wait-start', expectedVersion: 1, now: '2026-10-02T17:00:00.000Z' });
  const resumed = transitionSupportCase({ caseRecord: waiting, authority: admin, tenantId, status: 'in_progress', reasonCode: 'other', commandId: 'wait-end', expectedVersion: 2, now: '2026-10-02T18:00:00.000Z' });
  const assessment = assessSupportCaseSla({ caseRecord: resumed, now: Date.parse('2026-10-02T18:30:00.000Z'), calendar });
  assert.equal(assessment.firstResponse.dueAt, '2026-10-02T19:00:00.000Z');
  assert.equal(assessment.firstResponse.remainingMs, 30 * 60_000);
  assert.equal(assessment.slaPausedBusinessMinutes, 60);
  assert.equal(assessment.slaCalendarVersion, 1);
  assert.throws(() => assessSupportCaseSla({ caseRecord: supportCase, now: Date.parse('2026-10-02T17:00:00.000Z') }), /calendar snapshot is required/);
});
