# V96 — Business-Hours SLA Engine

V96 adds timezone-aware service calendars behind the support-case lifecycle. Deadlines are calculated from scheduled business minutes rather than wall-clock elapsed time. The service desk can use a company calendar with weekly opening hours, holidays, and date-specific exceptions.

## Calendar ownership and versioning

`createSupportBusinessCalendar()` requires an active tenant owner/admin. Each revision has a tenant ID, calendar ID, positive revision number, valid IANA timezone, normalized schedule, and SHA-256 content checksum. `reviseSupportBusinessCalendar()` creates a new revision and leaves the prior value intact. The persistence key is `(tenant_id, calendar_id, version)` and database revisions reject update/delete.

Cases store both `slaCalendarRef` and `slaCalendarVersion`. A case keeps using the exact revision from intake even after an administrator publishes new hours. API handlers must resolve that revision from trusted tenant-scoped storage. A caller-supplied calendar object is only valid after the application loads it from the matching database key and verifies its checksum.

## Schedule rules

- `weeklyHours` uses local weekday keys `0` through `6` (`0` is Sunday); an omitted weekday is closed.
- Each weekday or date exception can have up to eight non-overlapping same-day windows. Use `24:00` as an exclusive end-of-day boundary. Overnight windows must be represented as two local-day windows.
- Holidays are closed dates. A date override takes precedence over a holiday, so an exceptional opening can be configured explicitly.
- There can be at most 5,000 holiday dates and 1,000 date overrides in one revision.
- Deadlines accept a positive whole number of business minutes, up to 525,600 minutes. Iteration is bounded to a ten-year calendar horizon.
- DST gaps advance a nonexistent local boundary to the next real local minute. When local time repeats during a fall-back transition, opening boundaries select the earlier occurrence and closing boundaries select the later occurrence so the full published window is honored.

## Creating a case with business SLAs

```js
const supportCase = createSupportCase({
  authority: trustedTenantAuthority,
  tenantId: trustedTenantId,
  channel: 'webchat',
  subject: 'Appointment reschedule',
  createdAt: new Date().toISOString(),
  slaCalendar: calendarLoadedFromTrustedStore,
  firstResponseSlaMinutes: 60,
  resolutionSlaMinutes: 480
});
```

The case stores absolute UTC deadlines and the calendar revision used to calculate them. This keeps the initial due date queryable in SQL and makes the rule revision auditable. Do not mix explicit deadlines with business-minute durations in the same case command.

## Pauses and assessment

`assessSupportCaseSla()` requires the pinned calendar snapshot for calendar-backed cases and rejects another tenant or revision. It reconstructs customer-wait intervals from the append-only status-event history, intersects those intervals with scheduled open windows, and advances each business deadline by the remaining business time. Time spent waiting outside open hours does not add further pause credit. The assessment reports the elapsed pause milliseconds and paused business minutes.

The legacy elapsed-time path continues to support older cases with explicit deadlines and no calendar reference. It remains unsuitable for contractual business-hour commitments.

## Persistence and security

`FINAL-MIGRATION-V96.sql` adds an RLS-protected calendar revision table, append-only trigger and tenant-composite case/calendar foreign key. Calendar content is bounded JSON data; provider secrets, customer message text and credentials do not belong in the calendar.

The API transaction must set `app.tenant_id` from the verified session/membership, load the pinned calendar revision, and then invoke the domain function. Company admins may manage their own calendars; no calendar operation grants Atlas platform-owner authority.

## Explicit limits

This release computes deadlines and pause accounting. It does not include a live calendar administration page, calendar holiday import/provider sync, an SLA escalation scheduler, notifications, agent staffing calendars or contractual reports. A durable worker must scan indexed due times, emit tenant-scoped escalation events idempotently, and recheck case state/version before notifying. Database execution and cross-zone deployment behavior still require production verification.
