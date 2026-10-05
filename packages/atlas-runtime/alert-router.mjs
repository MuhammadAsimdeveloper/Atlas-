import { createHmac, createHash } from 'node:crypto';

const HTTPS=/^https:\/\//i;
const ID=/^[A-Za-z0-9_.:-]{1,160}$/;
function bounded(value,label,max=160){
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\r\n\u0000]/.test(value)) throw new TypeError(label+' is invalid');
  return value.trim();
}
function sign(secret,body){return 'sha256='+createHmac('sha256',secret).update(body).digest('hex');}
function deliveryId(alertId,destinationId){return createHash('sha256').update(alertId+'|'+destinationId).digest('hex');}

export class WebhookAlertSender{
  constructor({fetchImpl=fetch,timeoutMs=5000}={}){this.fetchImpl=fetchImpl;this.timeoutMs=Math.max(1000,Math.min(15000,timeoutMs));}
  async send({endpoint,secret,alert}){
    if(typeof endpoint!=='string'||!HTTPS.test(endpoint)) throw Object.assign(new Error('Alert webhook endpoint must be HTTPS'),{code:'alert_endpoint_invalid'});
    const body=JSON.stringify({schema:1,alert});
    if(Buffer.byteLength(body)>8192) throw Object.assign(new Error('Alert payload too large'),{code:'alert_payload_too_large'});
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),this.timeoutMs); timer.unref?.();
    try{
      const response=await this.fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/json','x-atlas-alert-signature':sign(secret,body),'x-atlas-alert-id':alert.alertId},body,signal:controller.signal});
      if(!response.ok) throw Object.assign(new Error('alert_webhook_http_'+response.status),{code:'alert_webhook_http_'+response.status});
      return true;
    }catch(error){throw Object.assign(new Error('Alert delivery failed',{cause:error}),{code:error?.name==='AbortError'?'alert_delivery_timeout':error?.code||'alert_delivery_failed'});}
    finally{clearTimeout(timer);}
  }
}

export class EmailAlertSender{
  constructor({send,timeoutMs=5000}={}){if(typeof send!=='function')throw new TypeError('send function required');this.send=send;this.timeoutMs=Math.max(1000,Math.min(15000,timeoutMs));}
  async sendAlert({address,alert}){
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address||'')) throw Object.assign(new Error('Alert email destination is invalid'),{code:'alert_email_invalid'});
    await this.send({to:address,subject:'Atlas runtime '+alert.severity+' alert: '+alert.policyId,text:`Atlas runtime alert\\nPolicy: ${alert.policyId}\\nPool: ${alert.poolId}\\nSeverity: ${alert.severity}\\nThreshold: ${alert.threshold}\\nObserved: ${alert.currentValue ?? 'unavailable'}`});
    return true;
  }
}

export class OtlpAlertSender{
  constructor({fetchImpl=fetch,timeoutMs=3000}={}){this.fetchImpl=fetchImpl;this.timeoutMs=Math.max(1000,Math.min(10000,timeoutMs));}
  async send({endpoint,secret=null,alert}){
    if(typeof endpoint!=='string') throw Object.assign(new Error('OTLP alert endpoint is invalid'),{code:'alert_endpoint_invalid'});
    let url;try{url=new URL(endpoint);}catch{throw Object.assign(new Error('OTLP alert endpoint is invalid'),{code:'alert_endpoint_invalid'});}
    if(url.protocol!=='https:') throw Object.assign(new Error('OTLP alert endpoint must use HTTPS'),{code:'alert_endpoint_invalid'});
    const record={timeUnixNano:String(Date.now()*1_000_000),severityText:String(alert.severity||'warning').toUpperCase(),body:{kvlistValue:{values:[
      {key:'alert_id',value:{stringValue:String(alert.alertId).slice(0,160)}},
      {key:'policy_id',value:{stringValue:String(alert.policyId).slice(0,160)}},
      {key:'pool_id',value:{stringValue:String(alert.poolId).slice(0,120)}},
      {key:'severity',value:{stringValue:String(alert.severity).slice(0,32)}}
    ]}}};
    const body=JSON.stringify({resourceLogs:[{resource:{attributes:[{key:'service.name',value:{stringValue:'atlas-runtime'}}]},scopeLogs:[{logRecords:[record]}]}]});
    if(Buffer.byteLength(body,'utf8')>8192) throw Object.assign(new Error('OTLP alert payload too large'),{code:'alert_payload_too_large'});
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);timer.unref?.();
    try{
      const response=await this.fetchImpl(url.href,{method:'POST',headers:{accept:'application/json','content-type':'application/json',...(secret?{authorization:'Bearer '+secret}:{})},body,signal:controller.signal});
      if(!response.ok)throw Object.assign(new Error('otlp_alert_http_'+response.status),{code:'otlp_alert_http_'+response.status});
      return true;
    }catch(error){throw Object.assign(new Error('OTLP alert delivery failed',{cause:error}),{code:error?.name==='AbortError'?'otlp_alert_timeout':error?.code||'otlp_alert_failed'});}
    finally{clearTimeout(timer);}
  }
}

export class AlertRouter{
  constructor({store,secretResolver=null,webhookSender=new WebhookAlertSender(),emailSender=null,otlpSender=new OtlpAlertSender(),logger=console,maxPerCycle=50}={}){
    if(!store||typeof store.listRuntimeAlerts!=='function'||typeof store.listObservabilityDestinations!=='function'||typeof store.claimAlertDelivery!=='function') throw new TypeError('Alert router store is incomplete');
    this.store=store; this.secretResolver=secretResolver; this.webhookSender=webhookSender; this.emailSender=emailSender; this.otlpSender=otlpSender; this.logger=logger; this.maxPerCycle=Math.max(1,Math.min(200,maxPerCycle));
  }
  async runOnce(){
    const alerts=await this.store.listRuntimeAlerts({status:'open',limit:this.maxPerCycle});
    const destinations=await this.store.listObservabilityDestinations({enabled:true,limit:100});
    let delivered=0,failed=0,skipped=0;
    for(const alert of alerts){
      for(const destination of destinations){
        const claim=await this.store.claimAlertDelivery({alertId:alert.alert_id,destinationId:destination.destination_id,leaseOwner:'alert-router'});
        if(!claim){skipped++;continue;}
        const safeAlert=Object.freeze({alertId:alert.alert_id,policyId:alert.policy_id,poolId:alert.pool_id,severity:alert.severity,currentValue:alert.current_value,threshold:alert.threshold});
        try{
          const secret=destination.secret_ref&&this.secretResolver?await this.secretResolver({secretRef:destination.secret_ref}):null;
          if(destination.kind==='webhook'){
            if(typeof secret!=='string'||secret.length<16) throw Object.assign(new Error('Alert webhook secret unavailable'),{code:'alert_secret_unavailable'});
            await this.webhookSender.send({endpoint:destination.endpoint_ref,secret,alert:safeAlert});
          }else if(destination.kind==='email'){
            if(!this.emailSender) throw Object.assign(new Error('Email alert sender is unavailable'),{code:'alert_email_sender_unavailable'});
            await this.emailSender.sendAlert({address:destination.endpoint_ref,alert:safeAlert});
          }else if(destination.kind==='otlp'){
            const token=destination.secret_ref&&this.secretResolver?await this.secretResolver({secretRef:destination.secret_ref}):null;
            await this.otlpSender.send({endpoint:destination.endpoint_ref,secret:token,alert:safeAlert});
          }else{
            throw Object.assign(new Error('Unsupported alert destination'),{code:'alert_destination_unsupported'});
          }
          await this.store.completeAlertDelivery({alertId:alert.alert_id,destinationId:destination.destination_id,leaseOwner:'alert-router'});
          delivered++;
        }catch(error){
          await this.store.failAlertDelivery({alertId:alert.alert_id,destinationId:destination.destination_id,leaseOwner:'alert-router',errorCode:bounded(error?.code||'alert_delivery_failed','errorCode',80)}).catch(()=>{});
          this.logger.warn?.(`Atlas alert delivery failed (${error?.code||'unknown'}).`);
          failed++;
        }
      }
    }
    return {alerts:alerts.length,delivered,failed,skipped};
  }
}
