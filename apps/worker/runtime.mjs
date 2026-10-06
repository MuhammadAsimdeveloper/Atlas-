import { randomUUID } from 'node:crypto';
import { buildControlEvent, createOtlpHttpExporter } from '../../packages/atlas-runtime/control-plane.mjs';
const ERROR_CODE = /^[a-z][a-z0-9_.-]{0,79}$/;
const SLO_TARGETS = Object.freeze({ job_duration_ms: 30_000, error_rate: 0.01, success_rate: 0.995 });

function errorCode(error) {
  return typeof error?.code === 'string' && ERROR_CODE.test(error.code) ? error.code : 'handler_failed';
}

function handlerMap(value, label) {
  const map = value instanceof Map ? new Map(value) : new Map(Object.entries(value || {}));
  for (const [key, handler] of map) {
    if (typeof key !== 'string' || !/^[a-z][a-z0-9_.-]{1,79}$/.test(key) || typeof handler !== 'function') throw new TypeError(`${label} must map bounded event/job types to functions.`);
  }
  return map;
}

export class AtlasQueueWorker {
  constructor({ store, workerId, jobHandlers, eventHandlers = {}, concurrency = 4, leaseSeconds = 60, pollMs = 1000, runtimePoolId = null, sloEvaluationIntervalMs = 30_000, logger = console } = {}) {
    if (!store || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(workerId || '')) throw new TypeError('A queue store and bounded worker ID are required.');
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new TypeError('Worker concurrency must be between 1 and 32.');
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 15 || leaseSeconds > 900) throw new TypeError('Worker lease must be between 15 and 900 seconds.');
    if (!Number.isInteger(pollMs) || pollMs < 100 || pollMs > 60_000) throw new TypeError('Worker poll interval must be between 100 and 60000 milliseconds.');
    this.store = store;
    this.workerId = workerId;
    this.jobHandlers = handlerMap(jobHandlers, 'jobHandlers');
    this.eventHandlers = handlerMap(eventHandlers, 'eventHandlers');
    this.concurrency = concurrency;
    this.leaseSeconds = leaseSeconds;
    this.pollMs = pollMs;
    this.runtimePoolId = runtimePoolId;
    if (!Number.isInteger(sloEvaluationIntervalMs) || sloEvaluationIntervalMs < 5_000 || sloEvaluationIntervalMs > 300_000) throw new TypeError('SLO evaluation interval must be between 5000 and 300000 milliseconds.');
    this.sloEvaluationIntervalMs = sloEvaluationIntervalMs;
    this.lastSloEvaluationAt = 0;
    this.logger = logger;
    this.stopping = false;
    this.wake = null;
    this.preferEvents = false;
    this.active = new Set();
    this.counts = { jobsSucceeded: 0, jobsFailed: 0, eventsAcknowledged: 0, eventsFailed: 0, leaseLost: 0 };
    this.controlEventsEnabled = process.env.ATLAS_RUNTIME_CONTROL_EVENTS_ENABLED === 'true';
    this.otlpExporter = createOtlpHttpExporter({ endpoint: process.env.ATLAS_OTLP_ENDPOINT || '', authSecret: process.env.ATLAS_OTLP_AUTH_SECRET_REF || null, timeoutMs: Number(process.env.ATLAS_OTLP_TIMEOUT_MS || 3000), logger });
  }

  async runOnce() {
    if (this.runtimePoolId && typeof this.store.recordRuntimeHeartbeat === 'function') {
      try { await this.store.recordRuntimeHeartbeat({ poolId:this.runtimePoolId, workerId:this.workerId, queueDepth:Number((await this.store.counts())?.queued_jobs || 0), activeJobs:this.active.size }); } catch (error) { this.logger.warn?.(`Atlas runtime heartbeat failed (${error?.message || 'unknown'}).`); }
    }
    await this.store.reapJobs(100);
    if (this.jobHandlers.size) {
      await this.store.tickSchedules(100);
      if (this.jobHandlers.has('workflow.execute') && typeof this.store.tickWorkflowExecutions === 'function') await this.store.tickWorkflowExecutions(100);
    }
    if (this.eventHandlers.size) await this.store.reapOutbox(500);
    const jobsEnabled=this.jobHandlers.size>0, eventsEnabled=this.eventHandlers.size>0;
    let jobs=[],events=[];
    let capacityGranted = jobsEnabled && this.runtimePoolId && typeof this.store.acquireRuntimeCapacity === 'function'
      ? await this.store.acquireRuntimeCapacity(this.runtimePoolId, this.workerId, this.concurrency, this.leaseSeconds)
      : (jobsEnabled ? this.concurrency : 0);
    if (jobsEnabled && eventsEnabled) {
      const eventFirst=this.preferEvents;
      this.preferEvents=!this.preferEvents;
      if (eventFirst) {
        events=await this.store.claimOutbox(this.workerId,this.concurrency,this.leaseSeconds,[...this.eventHandlers.keys()]);
        const remaining=Math.min(capacityGranted, this.concurrency-events.length);
        if (remaining) jobs=await this.store.claimJobs(this.workerId,remaining,this.leaseSeconds,[...this.jobHandlers.keys()]);
      } else {
        jobs=await this.store.claimJobs(this.workerId,capacityGranted,this.leaseSeconds,[...this.jobHandlers.keys()]);
        const remaining=this.concurrency-jobs.length;
        if (remaining) events=await this.store.claimOutbox(this.workerId,remaining,this.leaseSeconds,[...this.eventHandlers.keys()]);
      }
    } else if (jobsEnabled) jobs=await this.store.claimJobs(this.workerId,capacityGranted,this.leaseSeconds,[...this.jobHandlers.keys()]);
    else if (eventsEnabled) events=await this.store.claimOutbox(this.workerId,this.concurrency,this.leaseSeconds,[...this.eventHandlers.keys()]);
    if (jobsEnabled && this.runtimePoolId && capacityGranted > jobs.length && typeof this.store.releaseRuntimeCapacity === 'function') {
      try { await this.store.releaseRuntimeCapacity(this.runtimePoolId, this.workerId, capacityGranted-jobs.length); capacityGranted=jobs.length; } catch {}
    }
    await Promise.all([
      ...jobs.map(job => this.#track(this.#process(job, this.jobHandlers.get(job.job_type), 'job'))),
      ...events.map(event => this.#track(this.#process(event, this.eventHandlers.get(event.event_type), 'event')))
    ]);
    if (this.runtimePoolId && typeof this.store.listRuntimeSloPolicies === 'function' && Date.now() - this.lastSloEvaluationAt >= this.sloEvaluationIntervalMs) {
      this.lastSloEvaluationAt = Date.now();
      try {
        const policies = await this.store.listRuntimeSloPolicies();
        for (const policy of policies) await this.store.evaluateRuntimeSlo({ poolId:this.runtimePoolId, policyId:policy.policy_id });
      } catch (error) {
        this.logger.warn?.(`Atlas runtime SLO evaluation failed (${error?.message || 'unknown'}).`);
      }
    }
    return { jobsClaimed: jobs.length, capacityGranted, eventsClaimed: events.length, ...this.counts };
  }

  async #track(promise) {
    this.active.add(promise);
    try { await promise; } finally { this.active.delete(promise); }
  }

  async #process(item, handler, kind) {
    const isJob = kind === 'job';
    const id = isJob ? item.job_id : item.event_id;
    const renew = isJob
      ? () => this.store.heartbeatJob(item, this.workerId, this.leaseSeconds)
      : () => this.store.heartbeatOutbox(item, this.workerId, this.leaseSeconds);
    const controller = new AbortController();
    const startedAt = Date.now();
    let leaseLost = false;
    let succeeded = false;
    let renewalBusy = false;
    const timer = setInterval(() => {
      if (renewalBusy) return;
      renewalBusy = true;
      Promise.resolve(renew()).then(renewed => {
        if (!renewed) { leaseLost = true; controller.abort(); }
      }).catch(() => { leaseLost = true; controller.abort(); }).finally(() => { renewalBusy = false; });
    }, Math.max(5_000, Math.floor(this.leaseSeconds * 1000 / 3)));
    timer.unref?.();
    try {
      if (isJob && typeof this.store.recordDispatchState === 'function') { try { await this.store.recordDispatchState({ tenantId:item.tenant_id,jobId:item.job_id,jobType:item.job_type,attempt:item.attempts,status:'published' }); } catch (error) { this.logger.warn?.(`Atlas dispatch ledger update failed (${error?.message || 'unknown'}).`); } }
      const spanStart=Date.now()*1_000_000;
      if (typeof handler !== 'function') throw Object.assign(new Error('No handler is registered.'), { code: 'handler_unavailable' });
      const context = isJob
        ? { tenantId: item.tenant_id, jobId: id, jobType: item.job_type, idempotencyKey: item.idempotency_key, attempt: item.attempts, workerId: this.workerId, workerStore: this.store, signal: controller.signal }
        : { tenantId: item.tenant_id, eventId: id, eventType: item.event_type, attempt: item.attempts, workerId: this.workerId, signal: controller.signal };
      await handler(Object.freeze(item.payload_ref), Object.freeze(context));
      if (leaseLost) { this.counts.leaseLost++; return; }
      const acknowledged = isJob ? await this.store.completeJob(item, this.workerId) : await this.store.ackOutbox(item, this.workerId);
      if (acknowledged) { succeeded = true; this.counts[isJob ? 'jobsSucceeded' : 'eventsAcknowledged']++; }
      else { this.counts.leaseLost++; controller.abort(); }
    } catch (error) {
      if (leaseLost) { this.counts.leaseLost++; return; }
      const code = errorCode(error);
      try {
        if (isJob) await this.store.failJob(item, this.workerId, code);
        else await this.store.failOutbox(item, this.workerId, code);
      } catch {
        this.counts.leaseLost++;
      }
      this.counts[isJob ? 'jobsFailed' : 'eventsFailed']++;
      this.logger.warn?.(`Atlas worker ${kind} ${id} failed (${code}).`);
    } finally {
      if (isJob && this.controlEventsEnabled && typeof this.store.recordControlEvent === 'function') { try { await this.store.recordControlEvent(buildControlEvent({type:succeeded?'runtime.job.completed':(leaseLost?'runtime.job.lease_lost':'runtime.job.failed'),severity:succeeded?'info':'warning',poolId:this.runtimePoolId,workerId:this.workerId,decision:{jobType:item.job_type,attempt:item.attempts,status:succeeded?'published':(leaseLost?'lease_lost':'failed')}})); } catch (error) { this.logger.warn?.(`Atlas control event persistence failed (${error?.message || 'unknown'}).`); } }
      if (isJob && this.otlpExporter.enabled) void this.otlpExporter.exportSpan({traceId:randomUUID().replaceAll('-',''),spanId:randomUUID().replaceAll('-','').slice(0,16),name:'atlas.worker.job',startTimeUnixNano:spanStart,endTimeUnixNano:Date.now()*1_000_000,attributes:{jobType:item.job_type,status:succeeded?'succeeded':(leaseLost?'lease_lost':'failed')}});
      clearInterval(timer);
      if (isJob && this.runtimePoolId && typeof this.store.releaseRuntimeCapacity === 'function') {
        try { await this.store.releaseRuntimeCapacity(this.runtimePoolId, this.workerId, 1); } catch (error) { this.logger.warn?.(`Atlas runtime capacity release failed (${error?.message || 'unknown'}).`); }
      }
      if (isJob && this.runtimePoolId && typeof this.store.recordRuntimeSlo === 'function') {
        const duration = Math.max(0, Date.now() - startedAt);
        try {
          await this.store.recordRuntimeSlo({ poolId:this.runtimePoolId, metric:'job_duration_ms', value:duration, target:SLO_TARGETS.job_duration_ms });
          await this.store.recordRuntimeSlo({ poolId:this.runtimePoolId, metric:'success_rate', value:succeeded ? 1 : 0, target:SLO_TARGETS.success_rate });
          await this.store.recordRuntimeSlo({ poolId:this.runtimePoolId, metric:'error_rate', value:succeeded ? 0 : 1, target:SLO_TARGETS.error_rate });
        } catch (error) {
          this.logger.warn?.(`Atlas runtime SLO sample failed (${error?.message || 'unknown'}).`);
        }
      }
    }
  }

  wakeNow() { this.wake?.(); }

  async run() {
    if (!this.jobHandlers.size && !this.eventHandlers.size) throw new Error('No Atlas execution or outbox handlers are registered; worker refuses to claim work.');
    while (!this.stopping) {
      try { await this.runOnce(); }
      catch (error) { this.logger.error?.(`Atlas worker cycle failed (${errorCode(error)}).`); }
      if (!this.stopping) await new Promise(resolve => {
        let timer;
        const finish = () => { clearTimeout(timer); this.wake = null; resolve(); };
        this.wake = finish;
        timer = setTimeout(finish, this.pollMs);
        timer.unref?.();
      });
    }
    await Promise.allSettled([...this.active]);
    return { ...this.counts };
  }

  async stop() {
    this.stopping = true;
    this.wake?.();
    await Promise.allSettled([...this.active]);
  }
}
