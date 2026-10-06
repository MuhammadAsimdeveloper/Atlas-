# Atlas V149 hardening slice — 6 October 2026

## Purpose

V149 is the post-V148 reliability hardening pass. It does not claim external providers or managed infrastructure are live. It closes defects found by CI/MiroFish and tightens the highest-risk replay boundaries before the next product expansion.

## Fixed in this slice

1. **MiroFish approval replay scenario**
   - The scenario previously evaluated an approval-only result with journey stakeholder expectations, producing a false 0.60 consensus even though the approval decision itself was deterministic and correct.
   - The scenario now evaluates the approval result inside a complete customer journey and preserves explicit approval replay evidence.

2. **Model latency accounting**
   - Model latency is measured from actual invocation start instead of the caller-provided request timestamp.
   - This prevents stale queue timestamps from producing misleading zero/negative latency evidence.

3. **OpenAI-compatible SSE framing**
   - Streaming chunks now split only complete newline-delimited SSE records and retain the unterminated final record.
   - This prevents a partial event from being reprocessed when the next network chunk arrives.

4. **Durable agent approval replay**
   - Repeating the same approval request is idempotent.
   - Reusing an approval identifier for a different session/action is rejected with an identity conflict.
   - Repeating an identical approval decision is idempotent.
   - Attempting to change an already-decided approval is rejected instead of being reported as a missing approval.

5. **Regression coverage**
   - Added SSE framing and model-latency tests.
   - Added PostgreSQL/PGlite approval replay and conflict tests.
   - Existing MiroFish scenarios remain the strategic safety gate.

## Remaining P0/P1 gaps

These are still deliberately external or incomplete and must not be marked Live merely because repository contracts exist:

- managed PostgreSQL/Redis/object storage/WAF/CDN/KMS deployment evidence
- real model/provider credentials and end-to-end model traffic
- general approval resume from durable waiting state into a new worker execution
- full visual Agent Studio and conversation emulator
- complete social/web-chat inbox channels
- full n8n visual canvas, expression mapper and execution inspector UI
- broad connector/OAuth catalog and credential rotation
- Google/Outlook calendar sync and public booking
- campaign audience/sequence delivery and suppression lifecycle
- public website hosting/form ingress and conversion event pipeline
- Search Console/crawl evidence and attribution joins
- social publishing/reputation ingestion
- product/invoice/refund/tax/dunning/usage billing
- course/community/membership surfaces
- agency/SaaS provisioning and white-label control plane
- external KMS/SSO/2FA/API-key lifecycle
- load, restore, failover and multi-region certification

## Current vendor-derived expansion targets

HighLevel's current AI surface includes Ask AI, Conversation AI, Voice AI, Managed Agents, Agent Studio, Workflow AI, Funnel & Website AI, Email AI, Knowledge Base, Content AI, Reviews AI and AI Studio. Its current workflow documentation also supports multiple triggers, branching and chaining; Conversation AI can wait for a customer reply and route based on conditions. Atlas should add these as governed, testable capabilities rather than UI-only labels. citeturn0search0turn0search2turn0search3

n8n's current platform documentation covers workflow sharing/RBAC, sub-workflows, data tables, execution data, error handling, queue mode, credentials, source control, MCP, AI workflow builder and evaluations. Atlas already has several corresponding contracts, but the remaining work is to connect them to durable execution and real provider boundaries without weakening tenant isolation or secret handling. citeturn1search0

## Completion rule

A capability is complete only when persistence, authorization, side-effect controls, idempotency/replay behavior, downstream outcome, tests and operational evidence are connected. A catalog entry or mock provider never counts as live execution.
