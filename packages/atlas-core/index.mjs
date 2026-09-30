export const RISK_ORDER = Object.freeze({ read: 0, write: 1, financial: 2, destructive: 3 });

export function normalizeTools(tools = []) {
  return [...new Set(tools.map(String).filter(Boolean))].sort();
}

export function effectiveToolSet({ actorTools = [], agentTools = [], skillTools = [], requestedTools = [] }) {
  const actor = new Set(normalizeTools(actorTools));
  const agent = new Set(normalizeTools(agentTools));
  const skill = new Set(normalizeTools(skillTools));
  const requested = normalizeTools(requestedTools);
  const effective = requested.filter(tool => actor.has(tool) && agent.has(tool) && skill.has(tool));
  return { effective, denied: requested.filter(tool => !effective.includes(tool)) };
}

export function evaluateCapability({ actor, agent, skill, requestedTools = [], approved = false }) {
  if (!actor?.tenantId || actor.tenantId !== agent?.tenantId || actor.tenantId !== skill?.tenantId) {
    return { allowed: false, code: "TENANT_BOUNDARY_VIOLATION", effective: [], denied: normalizeTools(requestedTools) };
  }
  const maxRisk = RISK_ORDER[skill.maxRisk ?? "read"];
  if (maxRisk === undefined) return { allowed: false, code: "INVALID_SKILL_RISK", effective: [], denied: normalizeTools(requestedTools) };
  const capability = effectiveToolSet({ actorTools: actor.tools, agentTools: agent.tools, skillTools: skill.tools, requestedTools });
  if (capability.denied.length) return { allowed: false, code: "CAPABILITY_NOT_GRANTED", ...capability };
  const requiresApproval = (skill.approval ?? "write") !== "never" && maxRisk > RISK_ORDER.read;
  if (requiresApproval && !approved) return { allowed: false, code: "APPROVAL_REQUIRED", requiresApproval: true, ...capability };
  return { allowed: true, requiresApproval: false, ...capability };
}

export function negotiateConnectorCapabilities({ connector, requested = [], policy = {} }) {
  const available = new Set(normalizeTools(connector?.capabilities));
  const allowed = new Set(normalizeTools(policy.allowedCapabilities ?? requested));
  const wanted = normalizeTools(requested);
  const granted = wanted.filter(capability => available.has(capability) && allowed.has(capability));
  const unsupported = wanted.filter(capability => !available.has(capability));
  const policyDenied = wanted.filter(capability => available.has(capability) && !allowed.has(capability));
  return { connectorId: connector?.id ?? null, status: connector?.status ?? "unknown", granted, unsupported, policyDenied, degraded: unsupported.length > 0 || policyDenied.length > 0 };
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
  const rows = cases ?? [];
  if (!rows.length) return { score: 0, passed: 0, total: 0 };
  const passed = rows.filter(test => test.pass === true).length;
  return { score: Math.round((passed / rows.length) * 10000) / 100, passed, total: rows.length };
}
