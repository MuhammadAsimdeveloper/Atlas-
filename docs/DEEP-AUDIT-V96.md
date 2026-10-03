# Atlas V96 deep audit

## Scope

Reviewed the V95 support-case/Copilot code and added a business-hours SLA domain: calendar ownership, checksum/revision validation, timezone conversion, daylight-saving gaps and repeated hours, holiday overrides, deadline calculation, status-derived customer-wait pauses, SQL RLS and release metadata. Vendor references were refreshed on 3 October 2026 using current first-party HighLevel and n8n documentation. Checks cover domain behavior and static-schema invariants, not a production security certification.

## Findings addressed

| Finding | Change | Evidence |
|---|---|---|
| SLA deadlines only understood elapsed UTC time. | Added tenant-owned business calendars, holidays, one-off date overrides and DST-aware deadline calculation. | Business calendar tests cover weekdays, holiday precedence, spring-forward and fall-back. |
| Calendar edits could silently change historic SLA interpretation. | Calendar versions are checksummed and immutable; cases pin calendar ID/version. | Revision tests; V96 append-only database trigger and composite foreign key. |
| Customer-wait pause accounting could treat nights/weekends as contractual pause time. | Rebuild wait intervals from support status events and add only overlapping scheduled business minutes back to due times. | Case pause test checks one scheduled hour and resulting deadline. |
| RLS and case/calendar relationships were missing. | Added tenant-forced RLS calendar table, append-only revision behavior and tenant-composite calendar reference. | V96 SQL and Atlas doctor checks. |
| Competitor notes lagged newly shipped agent/workflow features. | Added HighLevel streaming workflow AI, clarify/preview and guided templates; updated n8n agent publish/session/schedule/delegation behavior and its agent queue-mode limitation. | `docs/COMPETITOR-BENCHMARK-2026-10.md` links first-party pages. |

## Business-calendar decisions

- Weekly day numbers are local weekdays, not UTC weekdays. All published wall-hour windows are converted to actual UTC instants for the selected IANA timezone.
- Spring-forward nonexistent boundaries move to the next valid local minute. Fall-back ambiguous opening chooses the earlier instant and ambiguous closing the later instant. This favors honoring the full declared window.
- Date overrides intentionally beat holiday closures to represent emergency or special opening hours.
- Case history reconstructs waiting-on-customer intervals, so changes to current calendar revisions cannot rewrite past pause policy.
- The maximum SLA duration and calendar-day iteration bounds avoid unbounded date loops on malformed input.

## Risks that remain

- Pure domain functions cannot prove a passed calendar revision came from the database. Authenticated API/worker adapters must load it by tenant, ID and version from trusted storage and verify the checksum.
- The static command center has no live SLA calendar editor. V96 also does not run a durable due-time scheduler, send escalation notices, or synchronize holidays from external calendars.
- Calendar changes are immutable inserts, but API write transactions must prevent unauthorized version reuse and enforce tenant membership. The SQL migration has not been executed against a live PostgreSQL server in this environment.
- Timezone database rules may change. Existing cases retain absolute due timestamps and a pinned schedule revision, but a future recalculation service must decide how to handle legal timezone-rule changes and retain the timezone-data/runtime version used for recalculation.
- Long ranges across unusual historical timezone/date-line transitions need targeted production-date tests before enabling backdated SLA recalculation.
- Native channel, CRM, scheduling, payment, voice and email/SMS providers, live team inbox, workflow execution UI, deployment secrets/KMS, managed Postgres/Redis/object storage/CDN/WAF/OTel, backups, failover and millions-of-users capacity are still external or unverified.

## Authority boundary

Calendar revisions are tenant resources and require the company's active owner/admin role. Only Khan's configured, verified platform identity receives platform authority. Tenant authority cannot be promoted by calendar configuration, request JSON, email text or an imported calendar.

## Verification gate

Release checks are listed in `RELEASE-MANIFEST.txt`. The automated DST and SLA suite validates representative U.S. timezone transitions; it does not replace testing all tenant timezones or applying the SQL against the supported production PostgreSQL version. No `npm audit` result is claimed if npm is unavailable.
