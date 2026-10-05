import { createHash } from 'node:crypto';
import { nextScheduleOccurrence } from '../../packages/atlas-core/production-frontier.mjs';

function deterministicUuid(value) {
  const hex=createHash('sha256').update(value).digest('hex').slice(0,32).split('');
  hex[12]='4'; hex[16]=['8','9','a','b'][parseInt(hex[16],16)%4];
  return hex.slice(0,8).join('')+'-'+hex.slice(8,12).join('')+'-'+hex.slice(12,16).join('')+'-'+hex.slice(16,20).join('')+'-'+hex.slice(20).join('');
}

export async function runWorkflowScheduler({ runtimeStore, growthStore, executionStore, limit=50, now=new Date() }={}) {
  if(!runtimeStore||!growthStore||!executionStore) throw new TypeError('scheduler_dependencies_required');
  const claimed=await runtimeStore.claimWorkflowSchedules(limit);
  const results=[];
  for(const schedule of claimed){
    const fireRef='schedule:'+schedule.schedule_id+':'+new Date(schedule.due_at).toISOString();
    try{
      const workflow=await growthStore.getWorkflowVersionForScheduler({tenantId:schedule.tenant_id,workflowId:schedule.workflow_id,workflowVersion:schedule.workflow_version});
      if(workflow.state!=='published') throw Object.assign(new Error('Scheduled workflow is not published.'),{code:'scheduled_workflow_not_published'});
      const executionId=deterministicUuid(fireRef);
      let execution;
      try { execution=await executionStore.createScheduled({tenantId:schedule.tenant_id,workflow,triggerEventRef:fireRef,executionId,now:now.getTime()}); }
      catch(error) {
        if(error?.code==='workflow_execution_already_exists') execution={executionId,status:'already_exists'};
        else throw error;
      }
      const nextRunAt=schedule.schedule_kind==='calendar' ? new Date(schedule.due_at).toISOString() : nextScheduleOccurrence(schedule,new Date(schedule.due_at));
      await runtimeStore.finalizeWorkflowSchedule({tenantId:schedule.tenant_id,scheduleId:schedule.schedule_id,nextRunAt,state:schedule.schedule_kind==='calendar'?'completed':'active'});
      results.push({scheduleId:schedule.schedule_id,executionId,status:execution.status,nextRunAt});
    }catch(error){
      const retryAt=new Date(Date.now()+60_000).toISOString();
      await runtimeStore.finalizeWorkflowSchedule({tenantId:schedule.tenant_id,scheduleId:schedule.schedule_id,nextRunAt:retryAt,state:error?.code==='scheduled_workflow_not_published'?'paused':'active'}).catch(()=>{});
      results.push({scheduleId:schedule.schedule_id,status:'failed',errorCode:error?.code||'scheduler_failed'});
    }
  }
  return {claimed:claimed.length,results};
}
