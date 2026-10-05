import { createHash } from 'node:crypto';

const KEY=/^[a-z][a-z0-9_.-]{1,159}$/;
const REF=/^[A-Za-z0-9_.:/-]{8,240}$/;

function text(value,label,max=240){
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\r\n\u0000]/.test(value))throw new TypeError(label+' is invalid');
  return value.trim();
}
function ambiguous(error){
  return ['provider_timeout','network_error','fetch_failed','ECONNRESET','ECONNABORTED','ETIMEDOUT'].includes(error?.code)||error?.name==='AbortError';
}

export class ProviderReconciler{
  constructor({store,logger=console}={}){
    if(!store||typeof store.startProviderAction!=='function'||typeof store.recordProviderOutcome!=='function')throw new TypeError('Provider reconciliation store is incomplete');
    this.store=store;this.logger=logger;
  }
  async start({tenantId,jobId,providerKey,connectionId,actionKey,idempotencyKey}={}){
    for(const [v,l,m] of [[tenantId,'tenantId',240],[jobId,'jobId',240],[connectionId,'connectionId',240],[idempotencyKey,'idempotencyKey',240]])text(v,l,m);
    text(providerKey,'providerKey',80);text(actionKey,'actionKey',160);
    return this.store.startProviderAction({tenantId,jobId,providerKey,connectionId,actionKey,idempotencyKey});
  }
  async recordSent(input){
    return this.store.recordProviderOutcome({...input,state:'sent'});
  }
  async recordReconciled(input){
    return this.store.recordProviderOutcome({...input,state:'reconciled'});
  }
  async recordFailed(input){return this.store.recordProviderOutcome({...input,state:'failed'});}
  async recordAmbiguous(input){return this.store.recordProviderOutcome({...input,state:'ambiguous',errorCode:input.errorCode||'provider_ambiguous'});}
  async handleExisting({record,adapter,request,signal,job,context}={}){
    if(record?.state==='sent'||record?.state==='reconciled')return {status:'sent',providerRef:record.provider_ref||context.idempotencyKey,reconciled:record.state==='reconciled'};
    if(record?.state!=='ambiguous'&&record?.state!=='reconciliation_required')return null;
    if(typeof adapter?.lookup!=='function'){
      throw Object.assign(new Error('Provider outcome requires reconciliation before another send.'),{code:'provider_reconciliation_required'});
    }
    const found=await adapter.lookup({request,idempotencyKey:context.idempotencyKey,providerRef:record.provider_ref||null,signal});
    if(found?.status==='sent'||found?.status==='delivered'){
      await this.recordReconciled({tenantId:job.tenant_id,jobId:job.job_id,idempotencyKey:context.idempotencyKey,providerRef:found.providerRef||record.provider_ref,resolutionCode:'provider_lookup_confirmed'});
      return {status:'sent',providerRef:found.providerRef||record.provider_ref,reconciled:true};
    }
    if(found?.status==='not_found'){
      throw Object.assign(new Error('Provider lookup returned no matching side effect; manual reconciliation is required.'),{code:'provider_manual_reconciliation_required'});
    }
    throw Object.assign(new Error('Provider lookup returned an ambiguous outcome.'),{code:'provider_reconciliation_ambiguous'});
  }
  static isAmbiguousError=ambiguous;
  static stableActionId({tenantId,idempotencyKey}={}){return createHash('sha256').update(text(tenantId,'tenantId',240)+'|'+text(idempotencyKey,'idempotencyKey',240)).digest('hex');}
}
