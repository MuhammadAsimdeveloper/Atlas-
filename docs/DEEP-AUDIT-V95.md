# Atlas V95 deep audit

## Scope

Continues the V94 code/security review across the Copilot action flow, service-case lifecycle, case ranking, audit events, release migrations, UI preview and release checks. The audit includes test-driven retries, case duplication and cross-tenant attempts; it does not certify production deployment or every feature of HighLevel, n8n, monday.com or HubSpot.

## V95 changes

- Duplicate detection is limited to recent cases in the same tenant, and only uses shared conversation references or shared contact plus normalized subject similarity. It strips email/phone-shaped strings before tokenization and returns no subject or message content.
- Duplicate results are advisory. Only a tenant owner/admin can link a duplicate to a separate active canonical case. Linking preserves both records, closes only the duplicate record, writes an append-only event and checks optimistic versions for both records.
- The V94 migration remains the base service-desk schema. V95 adds a tenant-composite self-reference, event/reason checks and duplicate lookup index in a separate forward migration.
- Copilot pending-action retries now reuse a deterministic action ID and require the durable action store to return a matching action-binding hash.

## Known concurrency considerations

- Duplicate link adapters must lock both case rows in deterministic order and re-check versions, tenant, status and existing links inside the same transaction as the event insert. The pure domain check cannot prevent a race between two independent database transactions.
- Do not expose the similarity score as truth. Thresholds need evaluation on tenant-approved, de-identified historical support subjects before production rollout. Do not send raw transcript content to duplicate detection.
- A closed duplicate retains its original case timeline. Any undo/reopen path should require a separate authorized and audited command.

## Unresolved competitor and deployment gaps

- Business-hour/time-zone/holiday SLA calculation; native team inbox, email/SMS/WhatsApp/social/voice/calendar/payment connectors; production customer AI coverage UI; voice runtime; duplicate suggestions currently cover only contact/conversation references and subject text.
- No transcript summary/sentiment, batch agent evaluations/coaching UI, semantic knowledge citations UI, live API/signup/login, persistent production action service, app worker, managed queue/Redis/KMS/object storage/CDN/WAF/OTel, automated backup/failover or multi-region configuration.
- Existing GitHub/Figma integrations are not connected in the current task environment. The source worktree initially had no Git history/remote; package creation and local repository state are tracked separately from remote publication.
- npm is absent in the runtime, so `npm audit` cannot run; the lockfile declares no third-party runtime dependencies. PostgreSQL tooling/service is unavailable, so migrations are source-reviewed and doctor-checked only.

## Release controls

Run the full Node test suite, syntax checker, Markdown documentation checker, Atlas doctor and HTTP smoke. Re-run documentation checks after changing Markdown, and record final results/hash in `RELEASE-MANIFEST.txt`. Do not claim channel delivery, working calendars, high availability or millions-of-users scale based on the static preview and pure domain contracts.
