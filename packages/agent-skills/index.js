import crypto from 'node:crypto';

const RISK_ORDER={read:0,write:1,financial:2,destructive:3};

const BUILTIN_SKILLS=[
  {id:'crm-operator',name:'CRM Operator',description:'Read and update CRM records with explicit field-level limits.',tools:['crm.search','crm.company.search','crm.deals.search','crm.update','crm.activity.create'],maxRisk:'write',approval:'write'},
  {id:'workflow-operator',name:'Workflow Operator',description:'Inspect, simulate and run approved production workflows.',tools:['workflow.run'],maxRisk:'write',approval:'write'},
  {id:'revenue-analyst',name:'Revenue Analyst',description:'Explain pipeline, revenue, usage and customer health without side effects.',tools:['analytics.funnel','revenue.usage'],maxRisk:'read',approval:'never'},
  {id:'knowledge-operator',name:'Knowledge Operator',description:'Ground answers in tenant knowledge and customer context.',tools:['knowledge.search'],maxRisk:'read',approval:'never'},
  {id:'customer-operations',name:'Customer Operations',description:'Coordinate CRM, knowledge and workflow actions for customer lifecycle work.',tools:['crm.search','crm.company.search','crm.deals.search','knowledge.search','workflow.run'],maxRisk:'write',approval:'write'}
];

export function listSkills(custom=[]){
  const rows=[...BUILTIN_SKILLS,...custom];
  return rows.map(x=>({...x,tools:[...new Set(x.tools||[])]}));
}

export function skillById(id,custom=[]){return listSkills(custom).find(x=>x.id===id)||null;}

export function validateSkill(skill,toolRegistry){
  if(!skill||!/^[a-z0-9][a-z0-9-]{2,63}$/.test(String(skill.id||'')))return {ok:false,error:'Invalid skill id'};
  if(!String(skill.name||'').trim())return {ok:false,error:'Skill name is required'};
  const tools=[...new Set((skill.tools||[]).map(String))];
  if(!tools.length||tools.length>20)return {ok:false,error:'Skill must contain 1-20 tools'};
  const missing=tools.filter(name=>!toolRegistry.get(name));
  if(missing.length)return {ok:false,error:`Unknown tools: ${missing.join(', ')}`};
  const maxRisk=RISK_ORDER[skill.maxRisk||'read'];
  if(maxRisk===undefined)return {ok:false,error:'Invalid maxRisk'};
  return {ok:true,skill:{...skill,tools,approval:skill.approval||'write',version:Number(skill.version||1)}};
}

export function skillPolicy({skill,actor,requestedTools=[],approved=false}){
  const requested=[...new Set(requestedTools.map(String))];
  const allowed=new Set(skill?.tools||[]);
  const denied=requested.filter(x=>!allowed.has(x));
  if(denied.length)return {allowed:false,code:'SKILL_TOOL_NOT_ALLOWED',denied};
  if((skill?.approval||'write')==='never')return {allowed:true,requiresApproval:false};
  const risky=skill?.maxRisk&&RISK_ORDER[skill.maxRisk]>0;
  if(risky && !approved)return {allowed:false,requiresApproval:true,code:'SKILL_APPROVAL_REQUIRED',actorId:actor?.id||null};
  return {allowed:true,requiresApproval:false};
}

export function createSkillAssignment({tenantId,agentId,skillId,actorId}){
  return {id:`skillassign_${crypto.randomUUID().replaceAll('-','')}`,tenantId,agentId,skillId,actorId,createdAt:new Date().toISOString(),status:'active'};
}

export function operationalPulse(store,tenantId){
  const contacts=store.tenantCollection('contacts',tenantId),deals=store.tenantCollection('deals',tenantId),tasks=store.tenantCollection('tasks',tenantId),runs=store.tenantCollection('workflowRuns',tenantId),approvals=store.tenantCollection('approvals',tenantId),usage=store.tenantCollection('usageCounters',tenantId);
  const staleDeals=deals.filter(d=>d.updatedAt&&Date.now()-Date.parse(d.updatedAt)>7*86400000);
  const overdueTasks=tasks.filter(t=>t.dueAt&&Date.parse(t.dueAt)<Date.now()&&!['completed','done','canceled'].includes(t.status));
  const failedRuns=runs.filter(r=>['failed','error'].includes(r.status));
  const openApprovals=approvals.filter(a=>a.status==='pending');
  const totalPipeline=deals.reduce((n,d)=>n+Number(d.amount||0),0);
  const weightedPipeline=deals.reduce((n,d)=>n+Number(d.amount||0)*Number(d.probability||0),0);
  const risks=[];
  if(staleDeals.length)risks.push({type:'stale_deals',severity:staleDeals.length>5?'high':'medium',count:staleDeals.length});
  if(overdueTasks.length)risks.push({type:'overdue_tasks',severity:overdueTasks.length>10?'high':'medium',count:overdueTasks.length});
  if(failedRuns.length)risks.push({type:'failed_workflows',severity:failedRuns.length>5?'high':'medium',count:failedRuns.length});
  if(openApprovals.length)risks.push({type:'pending_approvals',severity:'low',count:openApprovals.length});
  return {tenantId,generatedAt:new Date().toISOString(),healthScore:Math.max(0,100-risks.reduce((n,r)=>n+(r.severity==='high'?20:r.severity==='medium'?10:3),0)),metrics:{contacts:contacts.length,deals:deals.length,totalPipeline,weightedPipeline,overdueTasks:overdueTasks.length,failedWorkflowRuns:failedRuns.length,openApprovals:openApprovals.length,usageRows:usage.length},risks};
}
