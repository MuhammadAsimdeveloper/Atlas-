import test from "node:test";
import assert from "node:assert/strict";
import { effectiveToolSet, evaluateCapability, negotiateConnectorCapabilities, planPulseActions, scoreAgentEvaluation } from "./index.mjs";

test("intersects actor, agent and skill capabilities", () => {
  const result = effectiveToolSet({ actorTools: ["crm.search", "workflow.run"], agentTools: ["crm.search", "workflow.run"], skillTools: ["crm.search"], requestedTools: ["crm.search", "workflow.run"] });
  assert.deepEqual(result.effective, ["crm.search"]);
  assert.deepEqual(result.denied, ["workflow.run"]);
});

test("rejects cross-tenant capability evaluation", () => {
  const result = evaluateCapability({
    actor: { tenantId: "t1", tools: ["crm.search"] },
    agent: { tenantId: "t2", tools: ["crm.search"] },
    skill: { tenantId: "t1", tools: ["crm.search"] },
    requestedTools: ["crm.search"]
  });
  assert.equal(result.code, "TENANT_BOUNDARY_VIOLATION");
});

test("requires approval for side-effect skills", () => {
  const result = evaluateCapability({
    actor: { tenantId: "t1", tools: ["crm.update"] },
    agent: { tenantId: "t1", tools: ["crm.update"] },
    skill: { tenantId: "t1", tools: ["crm.update"], maxRisk: "write", approval: "write" },
    requestedTools: ["crm.update"]
  });
  assert.equal(result.code, "APPROVAL_REQUIRED");
});

test("allows a read-only skill without approval", () => {
  const result = evaluateCapability({
    actor: { tenantId: "t1", tools: ["knowledge.search"] },
    agent: { tenantId: "t1", tools: ["knowledge.search"] },
    skill: { tenantId: "t1", tools: ["knowledge.search"], maxRisk: "read", approval: "never" },
    requestedTools: ["knowledge.search"]
  });
  assert.equal(result.allowed, true);
});

test("negotiates connector capabilities without permission escalation", () => {
  const result = negotiateConnectorCapabilities({
    connector: { id: "hubspot", status: "healthy", capabilities: ["contacts.read", "contacts.write"] },
    requested: ["contacts.read", "deals.write"],
    policy: { allowedCapabilities: ["contacts.read"] }
  });
  assert.deepEqual(result.granted, ["contacts.read"]);
  assert.deepEqual(result.unsupported, ["deals.write"]);
  assert.equal(result.degraded, true);
});

test("maps pulse risks to approval-gated action proposals", () => {
  const result = planPulseActions({ risks: [{ type: "stale_deals", severity: "medium", count: 2 }, { type: "failed_workflows", severity: "high", count: 1 }] });
  assert.equal(result.length, 2);
  assert.equal(result[0].mode, "approval");
  assert.equal(result[1].priority, "high");
});

test("scores agent evaluation cases deterministically", () => {
  assert.deepEqual(scoreAgentEvaluation([{ pass: true }, { pass: false }, { pass: true }]), { score: 66.67, passed: 2, total: 3 });
});

test("a caller boolean cannot stand in for tenant-bound persisted approval", () => {
  const context = {
    actor: { id: "u1", tenantId: "t1", tools: ["crm.update"] },
    agent: { id: "a1", tenantId: "t1", tools: ["crm.update"] },
    skill: { id: "s1", tenantId: "t1", tools: ["crm.update"], maxRisk: "write", approval: "write" },
    requestedTools: ["crm.update"],
    approved: true
  };
  assert.equal(evaluateCapability(context).code, "APPROVAL_REQUIRED");
  const evidence = { approvalId: "ap1", status: "approved", approvedAt: new Date().toISOString(), tenantId: "t1", actorId: "u1", agentId: "a1", skillId: "s1", requestedTools: ["crm.update"] };
  assert.equal(evaluateCapability({ ...context, approvalEvidence: evidence }).allowed, true);
  assert.equal(evaluateCapability({ ...context, approvalEvidence: { ...evidence, tenantId: "t2" } }).allowed, false);
});

test("connector negotiation denies by default and denies unhealthy connectors", () => {
  const connector = { id: "c1", status: "healthy", capabilities: ["contacts.read"] };
  assert.deepEqual(negotiateConnectorCapabilities({ connector, requested: ["contacts.read"] }).granted, []);
  assert.deepEqual(negotiateConnectorCapabilities({ connector: { ...connector, status: "unhealthy" }, requested: ["contacts.read"], policy: { allowedCapabilities: ["contacts.read"] } }).granted, []);
});

test("evaluation pass flags must be literal true", () => {
  assert.deepEqual(scoreAgentEvaluation([{ pass: "true" }, { pass: true }]), { score: 50, passed: 1, total: 2 });
});
