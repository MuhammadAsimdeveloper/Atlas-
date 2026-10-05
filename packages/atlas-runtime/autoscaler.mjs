import { createHash } from 'node:crypto';
import { computeScaleDecision } from './distributed-fabric.mjs';

const ID=/^[A-Za-z0-9_.:-]{1,160}$/;
const SHA=/^[a-f0-9]{64}$/;
const HTTPS=/^https:\/\//i;

function boundedText(value,label,max=160){
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\r\n\u0000]/.test(value)) throw new TypeError(label+' is invalid');
  return value.trim();
}
function boundedInt(value,label,min,max){
  if(!Number.isInteger(value)||value<min||value>max) throw new TypeError(label+' is invalid');
  return value;
}
function decisionId(input){
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export class HttpAutoscalerActuator {
  constructor({ endpoint, bearerToken=null, fetchImpl=fetch, timeoutMs=5000 }={}){
    if(typeof endpoint!=='string'||!HTTPS.test(endpoint)) throw new TypeError('Autoscaler actuator endpoint must be HTTPS');
    if(typeof bearerToken!=='string'&&bearerToken!==null) throw new TypeError('Autoscaler bearer token is invalid');
    this.endpoint=new URL(endpoint);
    this.bearerToken=bearerToken;
    this.fetchImpl=fetchImpl;
    this.timeoutMs=Math.max(1000,Math.min(15000,boundedInt(timeoutMs,'timeoutMs',1000,15000)));
  }
  async scaleTo({poolId,targetWorkers,decisionId,minWorkers,maxWorkers}={}){
    boundedText(poolId,'poolId',120);
    boundedInt(targetWorkers,'targetWorkers',minWorkers,maxWorkers);
    if(!SHA.test(decisionId||'')) throw new TypeError('decisionId is invalid');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),this.timeoutMs); timer.unref?.();
    try{
      const response=await this.fetchImpl(this.endpoint,{
        method:'POST',
        headers:{
          'content-type':'application/json',
          'x-atlas-decision-id':decisionId,
          ...(this.bearerToken?{authorization:`Bearer ${this.bearerToken}`}:{})
        },
        body:JSON.stringify({poolId,targetWorkers,decisionId}),
        signal:controller.signal
      });
      if(!response.ok) throw Object.assign(new Error('autoscaler_actuator_http_'+response.status),{code:'autoscaler_actuator_http_'+response.status});
      return {accepted:true,decisionId,targetWorkers};
    }catch(error){
      throw Object.assign(new Error('Autoscaler actuator request failed',{cause:error}),{code:error?.name==='AbortError'?'autoscaler_actuator_timeout':error?.code||'autoscaler_actuator_failed'});
    }finally{clearTimeout(timer);}
  }
}

export class AutoscalerController {
  constructor({store,actuator=null,logger=console,leaseSeconds=60}={}){
    if(!store||typeof store.getRuntimeScalingPolicy!=='function'||typeof store.acquireScalerLease!=='function'||typeof store.recordScalingDecision!=='function') throw new TypeError('Autoscaler store is incomplete');
    if(actuator!==null&&typeof actuator.scaleTo!=='function') throw new TypeError('Autoscaler actuator is invalid');
    this.store=store; this.actuator=actuator; this.logger=logger;
    this.leaseSeconds=boundedInt(leaseSeconds,'leaseSeconds',15,900);
  }

  async runOnce({poolId,workerId,queueDepth,activeWorkers,workerUtilization,sloErrorBudgetRemaining,now=Date.now(),lastScaleAt=0}={}){
    boundedText(poolId,'poolId',120); boundedText(workerId,'workerId',120);
    for(const [k,v] of Object.entries({queueDepth,activeWorkers,workerUtilization,sloErrorBudgetRemaining})){
      if(!Number.isFinite(v)) throw new TypeError(k+' must be finite');
    }
    const policy=await this.store.getRuntimeScalingPolicy(poolId);
    if(!policy||policy.enabled!==true) return {action:'hold',targetWorkers:Math.max(1,activeWorkers),reason:'disabled',status:'skipped'};
    const leader=await this.store.acquireScalerLease(poolId,workerId,this.leaseSeconds);
    if(!leader) return {action:'hold',targetWorkers:Math.max(policy.min_workers,Math.min(policy.max_workers,Math.round(activeWorkers||policy.min_workers))),reason:'not_scaler_leader',status:'skipped'};

    const decision=computeScaleDecision({
      queueDepth,activeWorkers,workerUtilization,sloErrorBudgetRemaining,
      minWorkers:policy.min_workers,maxWorkers:policy.max_workers,
      now,lastScaleAt,cooldownMs:Math.max(policy.scale_up_cooldown_seconds,policy.scale_down_cooldown_seconds)*1000
    });
    const dId=decisionId({poolId,action:decision.action,targetWorkers:decision.targetWorkers,queueDepth,activeWorkers,workerUtilization,sloErrorBudgetRemaining,reason:decision.reason});
    const base={decisionId:dId,poolId,workerId,action:decision.action,targetWorkers:decision.targetWorkers,queueDepth:Math.floor(queueDepth),activeWorkers:Math.floor(activeWorkers),workerUtilization,sloErrorBudgetRemaining,reason:decision.reason,status:decision.action==='hold'?'skipped':this.actuator?'proposed':'advisory'};
    await this.store.recordScalingDecision(base);
    if(decision.action==='hold'||!this.actuator) return {...decision,status:base.status,decisionId:dId};

    try{
      const result=await this.actuator.scaleTo({poolId,targetWorkers:decision.targetWorkers,decisionId:dId,minWorkers:policy.min_workers,maxWorkers:policy.max_workers});
      await this.store.updateScalingDecision({decisionId:dId,status:'actuated',actuatorRefHash:createHash('sha256').update(dId).digest('hex'),actuatedAt:new Date().toISOString()});
      await this.store.recordControlEvent?.({eventId:crypto.randomUUID?.()||dId,type:'autoscaler.actuated',severity:'info',poolId,workerId,decision:{decisionId:dId,targetWorkers:decision.targetWorkers}});
      return {...decision,status:'actuated',decisionId:dId,result};
    }catch(error){
      const code=boundedText(error?.code||'autoscaler_actuator_failed','errorCode',80);
      await this.store.updateScalingDecision({decisionId:dId,status:'failed',errorCode:code});
      this.logger.warn?.(`Atlas autoscaler actuator failed (${code}).`);
      return {...decision,status:'failed',decisionId:dId,errorCode:code};
    }
  }
}
