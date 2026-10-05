# V123 — Production integration and service operations

## Zapier analysis

Current Zapier capabilities include 9,000+ apps, triggers/actions, filters, paths, loops, webhooks, schedules, code/API actions, Tables, Interfaces, MCP and SDK. Atlas therefore treats an integration as a governed capability rather than a hard-coded connector: OAuth/credential references, scopes, idempotency, retries, rate limits, audit and tenant isolation are first-class.

## Jobber analysis

Current Jobber capabilities include client/lead management, requests and online booking, scheduling, routing, crews, job tracking, forms/checklists, time/location tracking, automated reminders/follow-ups, quotes, invoices, payments, client hub, communication history, notifications, job costing and AI voice/chat. Atlas V123 adds the internal service-operations model and a Jobber GraphQL/OAuth boundary.

## Production truth

A connector is only **live** after an administrator supplies a real OAuth/token reference and completes verification. Source code cannot create a customer's external account, phone number, payment processor, KMS or WAF. Atlas therefore fails closed instead of reporting configuration as proof.

## Next production gates

- OAuth callback/token rotation backed by deployment KMS.
- Provider verification and sandbox delivery.
- Real Jobber app registration and marketplace review.
- Zapier app/OAuth registration or customer-owned webhook.
- Provider webhook subscriptions and reconciliation.
- Payment processor and accounting integrations.
- Measured load/failover and restore evidence.
