# P125 — Production Worker + Provider Action Runtime

P125 turns the durable V119/V120 execution boundary into the production provider-action runtime.

## Guarantees

- Worker claims only deployment-reviewed handler types.
- Workflow execution remains lease-bound and optimistic-versioned.
- External actions require a registered capability, a verified provider connection, consent and approval.
- Provider credentials are referenced by opaque KMS/vault references; secret material never enters workflow state.
- Provider connections are resolved through a lease-bound worker-only database RPC.
- Provider adapters are fixed to allowlisted provider hosts.
- Provider requests are bounded and abortable.
- Queue idempotency keys are passed through to provider actions.
- Provider results are reduced to bounded references before workflow state is persisted.
- Provider failures use the existing workflow retry/dead-letter policy.
- Unknown workflow actions fail closed.
- The worker refuses to boot without a deployment-reviewed secret resolver.

## Supported actions

- communication.email -> Postmark
- communication.sms -> Twilio
- communication.voice -> Twilio
- communication.whatsapp -> Meta WhatsApp Cloud
- automation.webhook -> Zapier
- service.jobber -> Jobber GraphQL

Postmark's email API uses its server-token authenticated email endpoint; Twilio sends through its Messages resource; Jobber uses OAuth access tokens against its GraphQL endpoint. Atlas keeps these details behind provider adapters.

## Workflow node contract

External nodes must contain:

- capabilityId
- connectionRef (provider connection UUID)
- consent: true
- approved: true
- provider-specific bounded request fields

The runtime additionally checks that the stored connection is verified and belongs to the execution tenant.

## Secret resolver contract

The worker loads a deployment-reviewed resolver module from apps/worker/secrets. That module resolves the opaque credential_ref through the deployment's KMS/secret manager. Atlas intentionally does not prescribe a cloud vendor.

The resolver must enforce tenant and credential ownership and reject disabled/expired credentials.

## Deployment

Set:

ATLAS_WORKER_HANDLERS_MODULE=v125-production.mjs

and:

ATLAS_WORKER_SECRET_RESOLVER_MODULE=<reviewed-secret-resolver>.mjs

Mount both reviewed files read-only.

Never put provider credentials into workflow JSON, queue payloads, connection metadata, logs, or Git.

## Live-state rule

P125 source code does not mark a provider Live. A connection becomes Live only after its credential is resolved successfully and the provider connection test/end-to-end test passes.
