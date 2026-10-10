# Atlas upstream module reuse register — 2026-10-10

## Decision

Atlas will reuse shared Build Vibe/Aira modules through stable adapters when that repository is accessible. Current Atlas docs identify Build Vibe/CodingVibes as the canonical owner of shared orchestration, SEO/audit and developer utilities. This repository connection has not yet been verified from the GitHub account available to this build session, so no module is claimed to have been copied from it.

- Shared orchestration, task decomposition, memory/context controls, research and cross-product integrations: consume through versioned adapters.
- Atlas remains authoritative for tenant data, CRM, communication, billing, approvals, workflow execution policy and audit evidence.
- Never copy a dependency into Atlas when a maintained upstream package/API can be consumed instead.
- Before copying source, verify repository identity, license, dependency tree, security posture, maintenance and whether the feature already exists in Atlas.

## Candidate upstreams to evaluate (not automatically approved for copying)

| Source | Useful area | Integration decision |
|---|---|---|
| https://github.com/activepieces/activepieces | Connector/action definitions and automation UX patterns | Inspect current license and per-package headers first; adapt schemas/contracts, do not bulk-import the platform |
| https://github.com/node-red/node-red | Flow runtime concepts and node lifecycle | Reuse documented patterns; keep Atlas durable execution and tenant authorization authoritative |
| https://github.com/BloopAI/vibe-kanban | Agent task orchestration and developer workflow UX | Evaluate for internal engineering orchestration only, not as a replacement for customer workflow runtime |
| https://github.com/cloudflare/vibesdk | Vibe-coded app deployment/runtime integration | Evaluate only if Atlas website/app-builder deployment needs match; avoid core dependency without a tested use case |
| https://github.com/filipecalegario/awesome-vibe-coding | Discovery index of tools and repositories | Use as a discovery source, not as a runtime dependency |
| https://github.com/n8n-io/n8n | Public behavior and feature benchmark | Do not copy its source, branding or UI; implement behavior behind Atlas-native contracts |

This is a candidate register, not a claim that each project was fully audited or that its code is license-compatible. License and security review is mandatory before code reuse.

## Atlas modules already present to extend before adding dependencies

- apps/api/copilot-routes.mjs: governed copilot API surface.
- apps/api/workflow-execution-store.mjs and apps/api/runtime-store.mjs: execution/runtime persistence contracts.
- packages/atlas-integration-fabric/: connector lifecycle and integration contracts.
- packages/atlas-core/capability-fabric.mjs: capability registry and risk classification.
- packages/atlas-transactional-os/: commerce, inventory, payment and refund state transitions.
- docs/ATLAS-N8N-DEEP-PARITY-AND-COPILOT-PLAN-2026-10.md: authoritative parity roadmap.

## Next implementation sequence

1. Fix current CI failures before expanding scope. Recent CI exposed invalid uppercase coupon IDs, inventory reservation commits that did not bind to the exact state snapshot, payment amount validation ordering, and refunds that did not enforce refundable balance.
2. Add an upstream inventory tool that records repository URL, pinned commit/tag, license, package path, dependency risk, Atlas adapter, tests and owner.
3. Add adapters only where the shared repository can be resolved and its contracts tested. Fail closed when a shared provider is unavailable; do not silently create a second implementation.
4. For every imported behavior, add tests for tenant isolation, authorization, replay/idempotency, error paths and audit events.
5. Update the capability matrix only after implementation and tests exist.

## Gate for accepting a shared module

- [ ] Exact upstream repository and commit identified
- [ ] License and NOTICE obligations reviewed
- [ ] No secrets, tenant data or generated build artifacts imported
- [ ] Dependency and vulnerability review complete
- [ ] Adapter has bounded input/output schemas and versioning
- [ ] Tenant scope, permissions, approvals, quotas and audit ledger remain enforced
- [ ] Unit and integration tests cover failure/replay paths
- [ ] Feature matrix and operations docs updated
