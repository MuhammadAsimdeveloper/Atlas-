# V95 — Case Intelligence

## Recent duplicate suggestions

`findPotentialDuplicateSupportCases` requires a trusted authority for the case tenant and filters candidate cases to the same tenant, recent window and non-closed states. It identifies a shared conversation reference, or a shared contact plus a subject token similarity threshold. Email/phone-like substrings are removed before local subject tokenization. Results include only case references, a coarse confidence label, a similarity score and reason codes; the function does not return candidate subject or conversation text.

This is deterministic string similarity, not an embedding/LLM judgement. It is intentionally a shortlist signal: false positives and misses are expected, especially for short subjects, multiple languages, spelling variation and unnamed contacts. Operators should review the underlying case timeline before acting.

## Human-confirmed link

`linkDuplicateSupportCase` is limited to an authenticated tenant owner/admin. It checks both cases belong to the tenant, requires a separate active canonical case, requires fresh versions for both records, rejects linking cycles by refusing an already-linked target, and writes a deterministic append-only event. It marks the selected duplicate case closed with `duplicateOfRef`; it never deletes a case, merges contact history, changes the canonical case or sends a customer message.

The API must lock both case rows in a deterministic order, reload the primary/duplicate records, verify they remain same-tenant and active, call the domain function, update the duplicate with `WHERE version = expected_version`, and insert the event in one transaction. The composite tenant foreign key is a second database-level boundary. A production implementation should support undo by an explicit audited admin command before broad rollout.

## Copilot action retry integrity

V95 also fixes an approval replay defect from V94. The tool request hashes trusted tenant/actor/conversation plus tool/arguments into an idempotency key, then derives a stable action ID from that key. `actionStore.createPending` must insert-or-load under `(tenant_id, idempotency_key)`. It returns the persisted `actionId`, pending status, idempotency key and `hashAction(action)` digest. The Copilot checks every value before telling the operator an approval exists. If the write times out, the call is still ambiguous; reconcile the approval inbox using the deterministic ID/key.

The SQL V95 migration extends V94 support cases with a tenant-composite duplicate reference and allows a `case.duplicate_linked` event/reason. Apply V95 after V94. Both V94 and V95 migrations have not been run against a live PostgreSQL instance in this workspace.
