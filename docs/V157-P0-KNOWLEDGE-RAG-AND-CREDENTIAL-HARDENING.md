# V157 P0 — Knowledge, RAG and Credential/Execution Hardening

Date: 2026-10-08
Status: IMPLEMENTED FOUNDATION / EXTERNALLY GATED

## Delivered in this slice

### Connector and credential lifecycle

- tenant-scoped connector operation schema binding and execution;
- bearer, basic, API-key, HMAC and OAuth2 connector authentication paths;
- OAuth2 refresh through an external secret resolver with optional vault rotation;
- non-secret custom request headers with reserved control-header protection;
- credential metadata create/list/get/rotate/revoke API backed by the existing V122 table;
- no plaintext credential material in workflow definitions, queue payloads or execution state.

### Workflow execution contracts

- typed output validation with hash-only step persistence;
- conservative output-schema propagation into downstream nodes;
- durable `reconciliation_required` support through the existing V120 worker RPC boundary;
- authenticated operator reconciliation with optimistic versioning and atomic re-queue on confirmed success;
- replay-idempotent reconciliation handling.

### Strict legacy-node schemas

A broad legacy-node cluster is now typed from the existing workflow compiler semantics, including reference-bearing CRM/booking/communication/integration nodes, timing/branching/batching/error controls, and AI/knowledge configuration nodes. Unknown configuration keys fail closed. Nodes not yet covered remain explicitly catalog-generic.

### Tenant-safe knowledge/RAG foundation

`packages/atlas-knowledge-fabric/index.mjs` now provides:

- checksummed tenant-bound knowledge-store definitions;
- document metadata with external `contentRef` and `contentHash` rather than durable raw document bodies;
- deterministic bounded retrieval and reranker-aware ordering;
- source-type filtering and tenant/store isolation;
- citation allowlists that fail closed on missing or foreign evidence;
- prompt-injection and exfiltration classification;
- redaction of emails, phone-like values and secret-bearing fields;
- consent, retention and size controls for memory facts.

V157 also adds durable Postgres metadata tables for knowledge stores, documents, chunks and retrieval policies, all forced through tenant RLS and granted only to `atlas_app`.

The existing customer-support runtime consumes the new knowledge safety gates: hostile knowledge is dropped before model invocation, sensitive text is redacted, and knowledge-backed answers require citations.

Authenticated knowledge administration routes:

- `GET/POST /api/v1/growth/knowledge/stores`
- `GET/POST /api/v1/growth/knowledge/documents`
- `GET/POST /api/v1/growth/knowledge/policies`

## Remaining V157 frontier

- full provider-specific auth/adapter coverage and production certification;
- credential-provider secret-store/KMS implementation and rotation scheduling;
- strict schemas for the remaining catalog-generic node types;
- visual test/preview parity and execution-inspector evidence for the new schema contracts;
- vector/embedding provider adapters and durable retrieval index synchronization;
- reranker provider execution and evaluation datasets;
- end-to-end agent memory persistence beyond contract validation;
- signed citation/evidence propagation through the general agent-turn runtime;
- adversarial prompt-injection/exfiltration evaluation suites wired to release promotion.

External provider credentials, managed vector stores, KMS, model services and production infrastructure remain explicit deployment gates; source code alone does not claim those services are live.