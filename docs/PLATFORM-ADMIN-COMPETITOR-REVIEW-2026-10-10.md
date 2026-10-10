# Admin portal competitor review — 2026-10-10

This is a focused product-direction review for Atlas Platform Admin, not a claim that Atlas has feature parity with these products.

## Patterns to adopt

### GitHub organization administration
Official docs distinguish organization owners, members, moderators, billing managers and security managers; they recommend assigning roles according to the minimum access needed. Its audit log supports filtering and export, with event actor/action/time context. Atlas direction: keep the global platform-owner role separate from tenant roles, add delegated admin roles only with granular permissions, and make sensitive operations auditable.
- Roles: https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization
- Audit log: https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization

### Stripe Dashboard
Stripe documents dashboard-wide search across payments, customers, invoices, payouts and products, with filters and identifier-based navigation. Atlas direction: searchable transaction/event tables, clear provider identifiers, date/status filters, and a distinction between payment events and reconciled accounting totals.
- Dashboard search: https://docs.stripe.com/dashboard/search

### Shopify Admin
Shopify user management supports assigning roles and permissions so team members only access the areas required for their work. Atlas direction: user/workspace directory, status and verification, least-privilege access, and deliberate confirmation for high-impact changes.
- User management: https://help.shopify.com/en/manual/your-account/users

### Intercom reporting
Intercom's current reporting guidance emphasizes customizable reports, filters and access controls. Atlas direction: date windows, report definitions, permission-aware exports and explicit metric definitions. Do not present raw event counts as revenue or customer outcomes.
- Reports: https://www.intercom.com/help/en/articles/200-intercom-reports-explained

## Product decisions
- Always show platform environment and data freshness; never substitute fake/sample data when the API is unavailable.
- Search/filter/paginate users and transactions; redact credentials and sensitive provider payloads.
- Separate user administration, content moderation, finance and notification permissions.
- Require reason, approval and idempotency for suspensions, refunds and moderation decisions.
- Keep a durable audit trail with actor, action, target, timestamp, request/correlation ID, reason, and safe before/after fields.
- Add notification delivery lifecycle: queued, sent, delivered, bounced/failed, retrying, suppressed; never equate API acceptance with delivery.
- Reports must define timezone, currency, inclusion/exclusion logic, and source ledger.
- Provide loading, empty, permission-denied and provider-unavailable states; don't imply launch readiness if any critical module is stubbed.

## Vibe-coding repository reuse
The private MIT-licensed `MuhammadAsimdeveloper/Vibe-coding-` repository is a gstack-style engineering workflow toolkit (review, QA, security review and release automation), not an existing Atlas admin application. Atlas should reuse those workflows to qualify this console, but should not import unrelated CLI internals into the product. Exact source inspected: https://github.com/MuhammadAsimdeveloper/Vibe-coding- .

## Known implementation gaps after initial console commit
- Content moderation queue and decisions are not yet implemented.
- Notification templates, scheduling, provider delivery and retries are not yet implemented.
- Admin write actions are deliberately disabled pending transactional persistence and audited mutation handlers.
- Reports currently cover daily auth-audit event counts only; financial reconciliation and business KPIs are not yet certified.
- The initial database read paths must be verified under the production database role and RLS policies before launch.
