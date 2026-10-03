export const RISK_ORDER = Object.freeze({ read: 0, write: 1, financial: 2, destructive: 3 });

const APPROVAL_MODES = new Set(["never", "write", "always"]);

export function normalizeTools(tools = []) {
  if (!Array.isArray(tools)) return [];
  return [...new Set(tools.filter(tool => typeof tool === "string").map(tool => tool.trim()).filter(Boolean))].sort();
}

export function effectiveToolSet({ actorTools = [], agentTools = [], skillTools = [], requestedTools = [] } = {}) {
  const actor = new Set(normalizeTools(actorTools));
  const agent = new Set(normalizeTools(agentTools));
  const skill = new Set(normalizeTools(skillTools));
  const requested = normalizeTools(requestedTools);
  const effective = requested.filter(tool => actor.has(tool) && agent.has(tool) && skill.has(tool));
  return { effective, denied: requested.filter(tool => !effective.includes(tool)) };
}

function approvalMatches(evidence, { actor, agent, skill, requestedTools }) {
  if (!evidence || evidence.status !== "approved") return false;
  if (!evidence.approvalId || !Number.isFinite(Date.parse(evidence.approvedAt))) return false;
  if (evidence.tenantId !== actor.tenantId || evidence.actorId !== actor.id) return false;
  if (evidence.agentId !== agent.id || evidence.skillId !== skill.id) return false;
  return JSON.stringify(normalizeTools(evidence.requestedTools)) === JSON.stringify(normalizeTools(requestedTools));
}

/**
 * Policy primitive only. The caller must load approvalEvidence from the durable,
 * tenant-scoped approval store; a request-body boolean is not approval evidence.
 */
export function evaluateCapability({ actor, agent, skill, requestedTools = [], approvalEvidence = null } = {}) {
  const requested = normalizeTools(requestedTools);
  if (!actor?.tenantId || typeof actor.tenantId !== "string" ||
      actor.tenantId !== agent?.tenantId || actor.tenantId !== skill?.tenantId) {
    return { allowed: false, code: "TENANT_BOUNDARY_VIOLATION", effective: [], denied: requested };
  }

  const maxRisk = RISK_ORDER[skill.maxRisk ?? "read"];
  if (maxRisk === undefined) {
    return { allowed: false, code: "INVALID_SKILL_RISK", effective: [], denied: requested };
  }
  const approvalMode = skill.approval ?? (maxRisk > RISK_ORDER.read ? "write" : "never");
  if (!APPROVAL_MODES.has(approvalMode) || (approvalMode === "never" && maxRisk > RISK_ORDER.read)) {
    return { allowed: false, code: "INVALID_APPROVAL_POLICY", effective: [], denied: requested };
  }

  const capability = effectiveToolSet({
    actorTools: actor.tools,
    agentTools: agent.tools,
    skillTools: skill.tools,
    requestedTools: requested
  });
  if (capability.denied.length) {
    return { allowed: false, code: "CAPABILITY_NOT_GRANTED", ...capability };
  }

  const requiresApproval = approvalMode === "always" || (approvalMode === "write" && maxRisk > RISK_ORDER.read);
  if (requiresApproval && !approvalMatches(approvalEvidence, { actor, agent, skill, requestedTools: requested })) {
    return { allowed: false, code: "APPROVAL_REQUIRED", requiresApproval: true, ...capability };
  }
  return { allowed: true, requiresApproval: false, ...capability };
}

export function negotiateConnectorCapabilities({ connector, requested = [], policy = {} } = {}) {
  const available = new Set(normalizeTools(connector?.capabilities));
  const allowed = new Set(normalizeTools(policy?.allowedCapabilities));
  const wanted = normalizeTools(requested);
  const connected = connector?.status === "healthy" && typeof connector?.id === "string" && connector.id.length > 0;
  const granted = connected ? wanted.filter(capability => available.has(capability) && allowed.has(capability)) : [];
  const unsupported = wanted.filter(capability => !available.has(capability));
  const policyDenied = wanted.filter(capability => available.has(capability) && !allowed.has(capability));
  return {
    connectorId: connector?.id ?? null,
    status: connector?.status ?? "unknown",
    granted,
    unsupported,
    policyDenied,
    statusDenied: connected ? [] : wanted,
    degraded: !connected || unsupported.length > 0 || policyDenied.length > 0
  };
}

export function planPulseActions(pulse) {
  const actions = [];
  for (const risk of pulse?.risks ?? []) {
    if (risk.type === "stale_deals") actions.push({ id: "refresh-stale-deals", riskType: risk.type, mode: "approval", priority: risk.severity === "high" ? "high" : "normal", proposedTools: ["crm.deals.search", "crm.activity.create"] });
    if (risk.type === "overdue_tasks") actions.push({ id: "triage-overdue-tasks", riskType: risk.type, mode: "approval", priority: risk.severity === "high" ? "high" : "normal", proposedTools: ["crm.search", "crm.activity.create"] });
    if (risk.type === "failed_workflows") actions.push({ id: "inspect-failed-workflows", riskType: risk.type, mode: "approval", priority: "high", proposedTools: ["workflow.run"] });
    if (risk.type === "pending_approvals") actions.push({ id: "surface-pending-approvals", riskType: risk.type, mode: "notify", priority: "normal", proposedTools: [] });
  }
  return actions;
}

export function scoreAgentEvaluation(cases) {
  const rows = Array.isArray(cases) ? cases : [];
  if (!rows.length) return { score: 0, passed: 0, total: 0 };
  const passed = rows.filter(test => test?.pass === true).length;
  return { score: Math.round((passed / rows.length) * 10000) / 100, passed, total: rows.length };
}
