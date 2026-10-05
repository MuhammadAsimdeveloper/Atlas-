import { createHash } from 'node:crypto';
import { createAuthError } from './auth-contracts.mjs';
import {
  createWorkflowExecution,
  approveWorkflowExecution,
  cancelWorkflowExecution,
  replayWorkflowExecution,
  verifyWorkflowExecution
} from '../../packages/atlas-target/workflow-execution-engine.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODE=/^[a-z][a-z0-9_.-]{0,79}$/;

function digest(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function rowToState(row){
  const state=typeof row.state==='string'?JSON.parse(row.state):row.state;
  if(!verifyWorkflowExecution(state) || state.tenantId!==row.tenant_id || state.executionId!==row.execution_id || state.version!==row.version || state.status!==row.status) throw createAuthError(500,'workflow_execution_integrity_failed');
  return state;
}
function boundedLimit(value, fallback=50){
  const limit=Number(value??fallback);
  if(!Number.isSafeInteger(limit)||limit<1||limit>100) throw createAuthError(400,'invalid_execution_limit');
  return limit;
}

export class PostgresWorkflowExecutionStore{
  constructor(pool){if(!pool) throw new TypeError('Workflow execution store requires a PostgreSQL pool.'); this.pool=pool;}

  async #scope(client,{actorId,tenantId},{write=false}={}){
    if(!UUID.test(actorId||'')||!UUID.test(tenantId||'')) throw createAuthError(409,'workspace_required');
    const membership=await client.query(`SELECT m.role_key,m.custom_role_id FROM atlas_organization_memberships m
      JOIN atlas_organizations o ON o.tenant_id=m.tenant_id
      WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND o.status='active'`,[tenantId,actorId]);
    if(!membership.rowCount) throw createAuthError(404,'organization_not_found');
    await client.query("SELECT set_config('app.actor_id',$1,true)",[actorId]);
    await client.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
    if(write && !['owner','admin'].includes(membership.rows[0].role_key)){
      const customRoleId=membership.rows[0].custom_role_id;
      const grants=customRoleId?await client.query('SELECT permissions FROM atlas_organization_roles WHERE tenant_id=$1 AND role_id=$2',[tenantId,customRoleId]):{rows:[]};
      if(!grants.rows[0]?.permissions?.includes('workflows.write')) throw createAuthError(403,'workflow_write_forbidden');
    }
    return membership.rows[0];
  }

  async #transaction(scope,work){
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const result=await work(client);
      await client.query('COMMIT');
      return result;
    }catch(error){
      try{await client.query('ROLLBACK');}catch{}
      throw error;
    }finally{client.release();}
  }

  async create({actorId,tenantId,workflow,triggerEventRef,executionId=null,now=Date.now()}){
    if(!workflow||workflow.tenantId!==tenantId||workflow.module!=='workflows') throw createAuthError(400,'workflow_scope_invalid');
    if(workflow.state!=='published') throw createAuthError(409,'workflow_not_published','Publish the workflow before starting a live execution.');
    if(typeof workflow.payload?.graph!=='object') throw createAuthError(400,'workflow_graph_unavailable');
    return this.#transaction(async client=>{
      await this.#scope(client,{actorId,tenantId},{write:true});
      const state=createWorkflowExecution({
        tenantId,
        executionId:executionId||undefined,
        workflow:workflow.payload.graph,
        triggerEventRef,
        createdByActorId:actorId,
        now
      });
      const jobId=state.executionId;
      const idempotencyKey=digest({tenantId,executionId:state.executionId,graphChecksum:state.graphChecksum});
      try{
        await client.query(`INSERT INTO atlas_workflow_executions
          (tenant_id,execution_id,workflow_id,workflow_version,graph_checksum,status,current_node_id,trigger_event_type,trigger_event_ref,state,state_checksum,created_by,version,started_at,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$14,$14)`,
          [tenantId,state.executionId,state.workflowId,state.workflowVersion,state.graphChecksum,state.status,state.currentNodeId,state.triggerEventType,state.triggerEventRef,JSON.stringify(state),state.checksum,actorId,state.version,state.startedAt]);
      }catch(error){
        if(error?.code==='23505') throw createAuthError(409,'workflow_execution_already_exists','That execution identity is already in use.');
        throw error;
      }
      await client.query('SELECT atlas_v115_enqueue_job($1,$2,$3,$4::jsonb,$5,$6,$7)',[
        tenantId,jobId,'workflow.execute',JSON.stringify({kind:'workflow_execution',id:jobId,version:1}),idempotencyKey,null,8
      ]);
      await this.#event(client,state,{actorId,eventType:'execution.created',status:state.status,nodeId:state.currentNodeId,detailsRef:{kind:'workflow_execution',id:state.executionId,version:1}});
      return state;
    });
  }

  async get({actorId,tenantId,workflowId,executionId}){
    if(!UUID.test(workflowId||'')||!UUID.test(executionId||'')) throw createAuthError(404,'workflow_execution_not_found');
    return this.#transaction(async client=>{
      await this.#scope(client,{actorId,tenantId});
      const result=await client.query('SELECT * FROM atlas_workflow_executions WHERE tenant_id=$1 AND execution_id=$2 AND workflow_id=$3',[tenantId,executionId,workflowId]);
      if(!result.rows[0]) throw createAuthError(404,'workflow_execution_not_found');
      return rowToState(result.rows[0]);
    });
  }

  async list({actorId,tenantId,workflowId,limit=50}){
    if(!UUID.test(workflowId||'')) throw createAuthError(400,'invalid_workflow_id');
    const safeLimit=boundedLimit(limit);
    return this.#transaction(async client=>{
      await this.#scope(client,{actorId,tenantId});
      const result=await client.query(`SELECT execution_id,workflow_id,workflow_version,graph_checksum,status,current_node_id,trigger_event_type,trigger_event_ref,version,retry_at,last_error_code,replay_of_execution_id,started_at,ended_at,created_at,updated_at
        FROM atlas_workflow_executions WHERE tenant_id=$1 AND workflow_id=$2 ORDER BY created_at DESC,execution_id DESC LIMIT $3`,[tenantId,workflowId,safeLimit]);
      return {items:result.rows.map(row=>({
        executionId:row.execution_id,workflowId:row.workflow_id,workflowVersion:row.workflow_version,graphChecksum:row.graph_checksum?.trim(),status:row.status,currentNodeId:row.current_node_id,triggerEventType:row.trigger_event_type,triggerEventRef:row.trigger_event_ref,version:row.version,retryAt:row.retry_at,lastErrorCode:row.last_error_code,replayOfExecutionId:row.replay_of_execution_id,startedAt:row.started_at,endedAt:row.ended_at,createdAt:row.created_at,updatedAt:row.updated_at
      }))};
    });
  }

  async cancel({actorId,tenantId,workflowId,executionId,expectedVersion=null,now=Date.now()}){
    return this.#mutate({actorId,tenantId,workflowId,executionId,expectedVersion,now,kind:'cancel',apply:state=>cancelWorkflowExecution({execution:state,requestedByActorId:actorId,now})});
  }

  async approve({actorId,tenantId,workflowId,executionId,expectedVersion=null,approvalId,evidenceRef=null,now=Date.now()}){
    return this.#mutate({actorId,tenantId,workflowId,executionId,expectedVersion,now,kind:'approve',apply:state=>approveWorkflowExecution({execution:state,approvalId,approvedByActorId:actorId,evidenceRef,now})});
  }

  async replay({actorId,tenantId,workflowId,executionId,replayExecutionId=null,expectedVersion=null,now=Date.now()}){
    return this.#transaction(async client=>{
      await this.#scope(client,{actorId,tenantId},{write:true});
      const result=await client.query('SELECT * FROM atlas_workflow_executions WHERE tenant_id=$1 AND execution_id=$2 AND workflow_id=$3 FOR UPDATE',[tenantId,executionId,workflowId]);
      if(!result.rows[0]) throw createAuthError(404,'workflow_execution_not_found');
      const current=rowToState(result.rows[0]);
      if(expectedVersion!==null && (!Number.isSafeInteger(expectedVersion) || expectedVersion!==current.version)) throw createAuthError(409,'workflow_execution_version_conflict','The execution changed. Refresh and try again.');
      if(!['failed','dead_letter','canceled'].includes(current.status)) throw createAuthError(409,'workflow_replay_not_allowed','Only failed, dead-lettered or canceled executions can be replayed.');
      const next=replayWorkflowExecution({execution:current,replayExecutionId:replayExecutionId||undefined,requestedByActorId:actorId,now});
      await client.query(`INSERT INTO atlas_workflow_executions
        (tenant_id,execution_id,workflow_id,workflow_version,graph_checksum,status,current_node_id,trigger_event_type,trigger_event_ref,state,state_checksum,created_by,replay_of_execution_id,version,started_at,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$15,$15)`,
        [tenantId,next.executionId,next.workflowId,next.workflowVersion,next.graphChecksum,next.status,next.currentNodeId,next.triggerEventType,next.triggerEventRef,JSON.stringify(next),next.checksum,actorId,current.executionId,next.version,next.startedAt]);
      const idempotencyKey=digest({tenantId,executionId:next.executionId,graphChecksum:next.graphChecksum});
      await client.query('SELECT atlas_v115_enqueue_job($1,$2,$3,$4::jsonb,$5,$6,$7)',[
        tenantId,next.executionId,'workflow.execute',JSON.stringify({kind:'workflow_execution',id:next.executionId,version:1}),idempotencyKey,null,8
      ]);
      await this.#event(client,next,{actorId,eventType:'execution.replayed',status:next.status,nodeId:next.currentNodeId,detailsRef:{kind:'workflow_execution',id:next.executionId,version:1}});
      return next;
    });
  }

  async #mutate({actorId,tenantId,workflowId,executionId,expectedVersion=null,now,kind,apply}){
    return this.#transaction(async client=>{
      await this.#scope(client,{actorId,tenantId},{write:true});
      const result=await client.query('SELECT * FROM atlas_workflow_executions WHERE tenant_id=$1 AND execution_id=$2 AND workflow_id=$3 FOR UPDATE',[tenantId,executionId,workflowId]);
      if(!result.rows[0]) throw createAuthError(404,'workflow_execution_not_found');
      const current=rowToState(result.rows[0]);
      if(expectedVersion!==null && (!Number.isSafeInteger(expectedVersion) || expectedVersion!==current.version)) throw createAuthError(409,'workflow_execution_version_conflict','The execution changed. Refresh and try again.');
      const next=apply(current);
      if(next===current) return current;
      if(next.version!==current.version+1) throw createAuthError(500,'workflow_execution_version_invalid');
      const updated=await client.query(`UPDATE atlas_workflow_executions SET status=$4,current_node_id=$5,state=$6::jsonb,state_checksum=$7,last_error_code=$8,retry_at=$9,version=$10,ended_at=$11,canceled_by=$12,updated_at=$13
        WHERE tenant_id=$1 AND execution_id=$2 AND workflow_id=$3 AND version=$14`,
        [tenantId,executionId,workflowId,next.status,next.currentNodeId,JSON.stringify(next),next.checksum,next.lastErrorCode,next.retryAt,next.version,next.endedAt,next.canceledByActorId||null,next.updatedAt,current.version]);
      if(!updated.rowCount) throw createAuthError(409,'workflow_execution_version_conflict','The execution changed. Refresh and try again.');
      await this.#event(client,next,{actorId,eventType:`execution.${kind}`,status:next.status,nodeId:next.currentNodeId,detailsRef:{kind:'workflow_execution',id:next.executionId,version:next.version}});
      return next;
    });
  }

  async #event(client,state,{actorId,eventType,status,nodeId,detailsRef}){
    const safeActor=UUID.test(actorId||'')?actorId:null;
    const detail=detailsRef&&typeof detailsRef==='object'?detailsRef:{};
    await client.query(`INSERT INTO atlas_workflow_execution_events
      (tenant_id,event_id,execution_id,actor_id,event_type,node_id,status,details_ref,created_at)
      VALUES ($1,gen_random_uuid(),$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [state.tenantId,state.executionId,safeActor,eventType,nodeId||null,status,JSON.stringify(detail),state.updatedAt||state.createdAt]);
  }
}
