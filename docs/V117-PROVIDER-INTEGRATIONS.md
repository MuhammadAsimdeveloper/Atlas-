# V117 — Provider Integration Center

## Goal

Atlas already has tenant-scoped CRM objects, workflow node contracts, connector authorization primitives and a durable outbox. V117 adds the missing provider catalog and integration UX without coupling the Atlas CRM model to one vendor.

## Providers

| Provider | Type | Main objects/capabilities | Auth |
| --- | --- | --- | --- |
| Jobber | Field service | Clients, jobs, quotes, invoices, payments, appointments, team, webhooks | OAuth 2.0 |
| Zapier | Automation | Triggers, actions, searches, webhooks and workflow handoff | OAuth/API key/webhook |
| HubSpot | CRM | Contacts, companies, deals, tickets, custom objects, associations, webhooks | OAuth 2.0 |
| Salesforce | CRM | Leads, contacts, accounts, opportunities, cases, custom objects, bulk sync | OAuth 2.0 |
| Zoho CRM | CRM | Leads, contacts, accounts, deals, tasks, calls, custom modules | OAuth 2.0 |
| Pipedrive | CRM | Persons, organizations, deals, activities, products, pipelines | OAuth 2.0 |
| HighLevel | CRM | Contacts, opportunities, conversations, appointments, calendars, workflows, reputation | OAuth/API key |
| monday.com | Project management | Boards, items, columns, groups, updates, webhooks | OAuth 2.0 |
| ServiceTitan | Field service | Customers, locations, jobs, appointments, technicians, estimates, invoices, payments | OAuth/API key |
| Housecall Pro | Field service | Customers, jobs, appointments, estimates, invoices, payments, webhooks | API key/webhook |
| Freshsales | CRM | Contacts, accounts, deals, tasks, appointments, pipelines | OAuth/API key |
| Close | CRM | Leads, contacts, opportunities, activities, tasks, calls, emails | OAuth/API key |

## Implemented Atlas layer

- packages/atlas-integrations/index.mjs: provider registry, capability negotiation, sync-mode validation, normalized CRM records, field mapping and integration recipes.
- apps/api/integration-routes.mjs: authenticated provider catalog, provider detail, recipe discovery and administrator-gated connection-plan generation.
- apps/command-center/integrations.mjs: provider search, category filtering, capability display and connection-plan preparation.
- apps/command-center/auth.html: real Integrations workspace page instead of the old unavailable placeholder.

## Jobber-specific design

Jobber's API is GraphQL over HTTPS and uses OAuth 2.0 authorization-code flow with PKCE. Atlas models Jobber as an OAuth/GraphQL provider with scoped clients, jobs, quotes, invoices, payments and appointments plus event-driven webhook synchronization.

Jobber webhook delivery must be authenticated with its HMAC-SHA256 signature, and Atlas should deduplicate webhook events before creating workflow work.

Sources:
- https://developer.getjobber.com/docs/
- https://developer.getjobber.com/docs/building_your_app/app_authorization/
- https://developer.getjobber.com/docs/using_jobbers_api/setting_up_webhooks/

## Zapier-specific design

Zapier is modeled as an automation handoff rather than as Atlas's CRM database. Atlas recipes can emit signed, idempotent events to Zapier and receive webhook-triggered events back into the tenant workflow system. Provider-specific Zapier app authentication and action definitions belong in the provider adapter layer.

Source:
- https://developer.zapier.com/

## CRM normalization

External providers must be normalized into the Atlas CRM graph before workflow logic consumes them. The normalization contract currently carries:
- external ID and provider identity
- object type
- name
- email
- phone
- company
- lifecycle/status
- pipeline stage
- raw external reference.

Provider-specific fields should remain in an adapter-owned extension payload; they must not weaken Atlas tenant authorization or record-version checks.

## Production completion gate

V117 intentionally does not claim a provider is live merely because it exists in the catalog. A production provider connection requires all of:
1. provider OAuth/API credentials configured in a deployment secret manager
2. tenant-scoped encrypted credential storage with rotation
3. OAuth callback and token refresh/disconnect handling
4. provider health check
5. signed webhook ingress and replay/idempotency protection
6. worker handlers for read/write/sync operations
7. provider rate-limit and retry policy
8. field mapping/version migration rules
9. audit records for connection and high-risk writes
10. sandbox/contract tests against the provider.

This boundary prevents Atlas from presenting a catalog entry as a working integration before the external credentials and worker infrastructure actually exist.