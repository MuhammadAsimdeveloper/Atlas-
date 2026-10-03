# Atlas V103 Capability Matrix — US Market

| Domain | GHL benchmark | Atlas target | Hardening advantage |
|---|---|---|---|
| CRM | CRM, pipelines, contacts | V102 CRM + custom properties/associations | tenant RLS, optimistic versions, deterministic search |
| Automation | Workflow Builder + Workflow AI | V102 graph + V103 A→B connector contract | bounded graphs, risk classes, approval, idempotency |
| AI | Conversation/Voice/Agent/Workflow AI | V102 agent runtime + future provider adapters | exact release/tool approval + budgets + leases |
| Phone | calls, SMS/MMS, tracking | V104 provider fabric | consent, scope, spend caps, failover |
| Email | two-way email, email builder | V104/V106 | suppression, consent, deliverability, audit |
| WhatsApp | integrated messaging | V104/V106 | scoped grants + template/consent controls |
| Websites | website/funnel builder | V105 | publish validation + SEO contract + rollback |
| SEO | Search Atlas integration | V105 | metadata contract + indexability checks + site health |
| Calendars | booking calendars | V102 + V104 adapters | concurrency protection + holds + lifecycle versioning |
| Payments | payments/invoicing/rebilling | V103/V107 | double-entry ledger + spend policy + reconciliation |
| SaaS | subaccounts, SaaS Mode | V107/V109 | tenant isolation + billing ledger + provisioning policy |
| Reselling | phone/email/AI/add-ons | V107 | usage meter + hard limits + approval |
| Reputation | reviews/reputation | V109 | consent + workflow risk controls |
| Social | social planner | V109 | provider-scoped publish grants |
| Ads | Ad Manager/prospecting | V109 | spend limits + approval + attribution |
| Forms | forms/surveys/quizzes | V105 | signed submission + anti-abuse + CRM mapping |
| Memberships | courses/communities | V109 | entitlement ledger + content access policies |
| Snapshots | templates/snapshots | V109 | signed packages + provenance + protected assets |
| Marketplace | snapshot/app marketplace | V109 | package signing + permission manifests |
| Freelancer work | not a core GHL primitive | V108 | project RBAC + isolated secrets + financial separation |
| Security | enterprise controls vary by product | V110 | immutable audit, step-up, dual control, DR evidence |
| Trust | platform-level | V103–V110 | bounded/reversible/reconciled external actions |

## US-market requirements

The default US launch profile should support:
- USD billing and accounting boundary;
- CCPA/CPRA privacy workflows;
- CAN-SPAM suppression;
- TCPA consent and opt-out;
- A2P 10DLC readiness;
- PCI scope minimization through tokenized payment providers;
- SOC 2 evidence collection;
- optional HIPAA and GDPR boundaries;
- contractor/1099 record support.

## Financial safety invariants

1. No external money movement without an authorization decision.
2. No high-value money action without step-up and/or approval.
3. Every money action has an idempotency key.
4. Every posted transaction has balanced ledger entries.
5. Payment provider results are reconciled independently.
6. Provider webhook signatures and replay protection are mandatory.
7. AI agents cannot select arbitrary payment amounts outside a policy envelope.
8. Audit and financial ledger rows are append-only to application roles.
9. Tenant isolation is enforced by database policy, not only application filters.
10. Disaster recovery is verified by restore drills, not backup existence alone.
