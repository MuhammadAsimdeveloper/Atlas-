# Atlas Platform Admin Portal — Build Plan (2026-10-10)

## Goal
Deliver a separate, platform-owner-only console for operating Atlas safely across tenants. Required areas: overview, user/workspace management, content controls, payments and transactions, notifications, reports, audit trail, security and configuration.

## Source inspection
- Atlas already has secure cookie sessions, CSRF checks, verified-email platform-owner resolution (`packages/atlas-core/authority.mjs`), Postgres auth/billing stores, and a Node HTTP server serving `apps/command-center` assets.
- `apps/api/paddle-billing.mjs` verifies signed Paddle webhooks and restricts environment selection; reuse this path instead of inventing billing truth.
- The linked private `Vibe-coding-` repository is MIT-licensed and contains the gstack engineering workflow toolkit (review, QA, security review, release). These are developer workflows, not an existing end-user admin portal or billing/users modules. Reuse its QA/review/release discipline; do not copy its unrelated internal scripts into the customer-facing app.

## Competitor direction (research/industry patterns)
- Stripe Dashboard: ledger-like transaction views, searchable payment details, refund/dispute visibility, and role-gated financial actions.
- Shopify Admin: searchable customers/orders, explicit content/product status, and bulk actions with clear confirmation.
- GitHub Organization settings: least-privilege roles, audit log, security controls, and visible access history.
- Intercom/Zendesk: notification delivery state, templates, retries and audience segmentation.
- Supabase/Clerk: member status, invitation lifecycle, role changes, sessions/security signals.

These are design references, not claims that Atlas currently has parity. High-risk actions must have permission checks, CSRF protection, audit events, idempotency, and explicit confirmation.

## Navigation and mandatory areas
1. Overview: account/workspace totals, active subscriptions, payment volume/failures, pending notices, workflow health and recent admin events.
2. Users & workspaces: search, view account/workspace state, verified status, role/membership, suspend/restore, revoke sessions, invite/resend verification. Never expose password hashes or raw tokens.
3. Content control: reported content queue, moderation status/reason, hide/restore, appeal trail, policy/config version. Require reason and audit every mutation.
4. Payments & transactions: provider event, order/subscription, amount/currency, status, reconciliation, refunds and disputes. Refunds must be server-validated against captured balance, with idempotency and approval thresholds.
5. Notifications: templates, delivery channel, audience, scheduled/sent/failed state, retries, provider receipt and suppression preferences.
6. Reports: date-filtered user/workspace growth, subscription/revenue reconciliation, transaction failure/refund rates, content moderation and delivery outcomes. Export only scoped data with audit events.
7. Audit & security: immutable actor/action/subject/time/request metadata, session/security events, permission changes and export log.
8. Platform settings: provider readiness, environment banners, limits, feature flags, maintenance mode and deployment health. Secrets are status-only, never displayed.

## Implementation stages
- Stage A: owner-only route and console shell; reuse current authentication/authority; no tenant role can enter.
- Stage B: read-only overview, users, billing, reports and audit with pagination, filters, redaction and DB-safe queries.
- Stage C: audited user/content/notification mutations with CSRF, exact schemas, confirmation, idempotency and append-only event log.
- Stage D: reconciliation, exports, provider health and operational controls.
- Stage E: adversarial tests, migrations on disposable PostgreSQL, accessibility/mobile QA, security review and production launch gates.

## Launch gates
- [ ] Platform owner determined from server-loaded authenticated user + verified email; never trust client-supplied role.
- [ ] Every endpoint uses no-store, CSRF/origin validation for mutations, strict body schemas, rate limits and safe errors.
- [ ] Tenant boundaries tested; cross-tenant leakage tests pass.
- [ ] Mutations are transactional, idempotent where retried, and audited with before/after metadata.
- [ ] Billing uses verified provider events and reconciled ledger; no UI-only refund authority.
- [ ] Migration upgrade/rollback plan and backups tested.
- [ ] Accessibility, keyboard navigation, responsive layout and empty/loading/error states verified.
- [ ] `npm test`, `npm run check`, security checks, production checks and end-to-end smoke pass.
- [ ] Production secrets, email, billing live mode, monitoring, backup restore and incident runbook configured.

## Current status
Planning and source inspection are complete. This document is not proof that the portal is deployed or launch-ready. Implement and verify each stage before enabling write actions in production.
