import crypto from 'node:crypto';
import { evaluateCapability, normalizeTools, RISK_ORDER } from '../atlas-core/index.mjs';

const APPROVAL_MODES = new Set(['never', 'write', 'always']);

const BUILTIN_SKILLS = [
  {id:'crm-operator',name:'CRM Operator',description:'Read and update CRM records with explicit field-level limits.',tools:['crm.search','crm.company.search','crm.deals.search','crm.update','crm.activity.create'],maxRisk:'write',approval:'write'},
  {id:'workflow-operator',name:'Workflow Operator',description:'Inspect, simulate and run approved production workflows.',tools:['workflow.run'],maxRisk:'write',approval:'write'},
  {id:'revenue-analyst',name:'Revenue Analyst',description:'Explain pipeline, revenue, usage and customer health without side effects.',tools:['analytics.funnel','revenue.usage'],maxRisk:'read',approval:'never'},
  {id:'knowledge-operator',name:'Knowledge Operator',description:'Ground answers in tenant knowledge and customer context.',tools:['knowledge.search'],maxRisk:'read',approval:'never'},
  {id:'customer-operations',name:'Customer Operations',description:'Coordinate CRM, knowledge and workflow actions for customer lifecycle work.',tools:['crm.search','crm.company.search','crm.deals.search','knowledge.search','workflow.run'],maxRisk:'write',approval:'write'},
  {id:'customer-support-agent',name:'Customer Support Agent',description:'Answer tenant customer questions from approved knowledge and hand off uncertain or sensitive requests.',tools:['knowledge.search','support.case.read','support.reply.draft'],maxRisk:'read',approval:'never'},
  {id:'voice-agent-operator',name:'Voice Agent Operator',description:'Operate governed voice-agent sessions, handoffs and booking workflows without bypassing consent or disclosure.',tools:['knowledge.search','workflow.run'],maxRisk:'write',approval:'write'},
  {id:'n8n-automation-operator',name:'Automation Operator',description:'Inspect, simulate and propose n8n-style workflows using bounded nodes, mappings, retries and approvals.',tools:['workflow.run'],maxRisk:'write',approval:'write'}
];
const BUILTIN_IDS = new Set(BUILTIN_SKILLS.map(skill => skill.id));

function requiredId(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(label + ' is required');
  return value.trim();
}

export function listSkills(custom = []) {
  const rows = [...BUILTIN_SKILLS, ...(Array.isArray(custom) ? custom.filter(skill => skill && !BUILTIN_IDS.has(skill.id)) : [])];
  const seen = new Set();
  return rows.filter(skill => {
    if (seen.has(skill.id)) return false;
    seen.add(skill.id);
    return true;
  }).map(skill => ({...skill, tools: normalizeTools(skill.tools)}));
}

export function skillById(id, custom = []) {
  return listSkills(custom).find(skill => skill.id === id) || null;
}

export function validateSkill(skill, toolRegistry) {
  if (!skill || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(String(skill.id || ''))) return {ok:false,error:'Invalid skill id'};
  if (typeof skill.tenantId !== 'string' || !skill.tenantId.trim()) return {ok:false,error:'Tenant scope is required'};
  if (typeof skill.name !== 'string' || !skill.name.trim()) return {ok:false,error:'Skill name is required'};
  if (!Array.isArray(skill.tools)) return {ok:false,error:'Skill tools must be a list'};
  const tools = normalizeTools(skill.tools);
  if (!tools.length || tools.length > 20) return {ok:false,error:'Skill must contain 1-20 valid tools'};
  if (!toolRegistry || typeof toolRegistry.get !== 'function') return {ok:false,error:'Tool registry is required'};
  const missing = tools.filter(name => !toolRegistry.get(name));
  if (missing.length) return {ok:false,error:'Unknown tools: ' + missing.join(', ')};
  const maxRisk = RISK_ORDER[skill.maxRisk || 'read'];
  if (maxRisk === undefined) return {ok:false,error:'Invalid maxRisk'};
  const approval = skill.approval || (maxRisk > 0 ? 'write' : 'never');
  if (!APPROVAL_MODES.has(approval)) return {ok:false,error:'Invalid approval policy'};
  if (approval === 'never' && maxRisk > 0) return {ok:false,error:'Write, financial and destructive skills cannot disable approval'};
  const version = Number(skill.version || 1);
  if (!Number.isSafeInteger(version) || version < 1) return {ok:false,error:'Invalid skill version'};
  return {ok:true,skill:{...skill,tenantId:skill.tenantId.trim(),tools,approval,version}};
}

/**
 * Skill policy is evaluated only for a tenant-resolved skill assignment and an
 * authenticated actor/agent. Approval evidence must come from durable storage.
 */
export function skillPolicy({skill,actor,agent,requestedTools=[],approvalEvidence=null}={}) {
  return evaluateCapability({skill,actor,agent,requestedTools,approvalEvidence});
}

export function createSkillAssignment({tenantId,agentId,skillId,actorId}={}) {
  return {
    id:'skillassign_' + crypto.randomUUID().replaceAll('-',''),
    tenantId:requiredId(tenantId,'tenantId'),
    agentId:requiredId(agentId,'agentId'),
    skillId:requiredId(skillId,'skillId'),
    actorId:requiredId(actorId,'actorId'),
    createdAt:new Date().toISOString(),
    status:'active'
  };
}

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteNonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 1_000_000_000_000)) : 0;
}

export function operationalPulse(store,tenantId) {
  requiredId(tenantId,'tenantId');
  if (!store || typeof store.tenantCollection !== 'function') throw new Error('Tenant-scoped store is required');
  const contacts=store.tenantCollection('contacts',tenantId),deals=store.tenantCollection('deals',tenantId),tasks=store.tenantCollection('tasks',tenantId),runs=store.tenantCollection('workflowRuns',tenantId),approvals=store.tenantCollection('approvals',tenantId),usage=store.tenantCollection('usageCounters',tenantId);
  const now=Date.now(), staleBefore=now-7*86400000;
  const staleDeals=deals.filter(d=>{const updated=timestamp(d.updatedAt);return updated!==null&&updated<staleBefore;});
  const overdueTasks=tasks.filter(t=>{const due=timestamp(t.dueAt);return due!==null&&due<now&&!['completed','done','canceled'].includes(String(t.status||'').toLowerCase());});
  const failedRuns=runs.filter(r=>['failed','error'].includes(String(r.status||'').toLowerCase()));
  const openApprovals=approvals.filter(a=>a.status==='pending');
  const totalPipeline=deals.reduce((n,d)=>n+finiteNonNegative(d.amount),0);
  const weightedPipeline=deals.reduce((n,d)=>n+finiteNonNegative(d.amount)*Math.min(1,finiteNonNegative(d.probability)),0);
  const risks=[];
  if(staleDeals.length)risks.push({type:'stale_deals',severity:staleDeals.length>5?'high':'medium',count:staleDeals.length});
  if(overdueTasks.length)risks.push({type:'overdue_tasks',severity:overdueTasks.length>10?'high':'medium',count:overdueTasks.length});
  if(failedRuns.length)risks.push({type:'failed_workflows',severity:failedRuns.length>5?'high':'medium',count:failedRuns.length});
  if(openApprovals.length)risks.push({type:'pending_approvals',severity:'low',count:openApprovals.length});
  return {tenantId,generatedAt:new Date(now).toISOString(),healthScore:Math.max(0,100-risks.reduce((n,r)=>n+(r.severity==='high'?20:r.severity==='medium'?10:3),0)),metrics:{contacts:contacts.length,deals:deals.length,totalPipeline,weightedPipeline,overdueTasks:overdueTasks.length,failedWorkflowRuns:failedRuns.length,openApprovals:openApprovals.length,usageRows:usage.length},risks};
}
