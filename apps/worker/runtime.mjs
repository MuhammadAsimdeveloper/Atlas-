const ERROR_CODE = /^[a-z][a-z0-9_.-]{0,79}$/;

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
  constructor({ store, workerId, jobHandlers, eventHandlers = {}, concurrency = 4, leaseSeconds = 60, pollMs = 1000, logger = console } = {}) {
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
    this.logger = logger;
    this.stopping = false;
    this.wake = null;
    this.preferEvents = false;
    this.active = new Set();
    this.counts = { jobsSucceeded: 0, jobsFailed: 0, eventsAcknowledged: 0, eventsFailed: 0, leaseLost: 0 };
  }

  async runOnce() {
    await this.store.reapJobs(100);
    if (this.jobHandlers.size) {
      await this.store.tickSchedules(100);
      if (this.jobHandlers.has('workflow.execute') && typeof this.store.tickWorkflowExecutions === 'function') await this.store.tickWorkflowExecutions(100);
    }
    if (this.eventHandlers.size) await this.store.reapOutbox(500);
    const jobsEnabled=this.jobHandlers.size>0, eventsEnabled=this.eventHandlers.size>0;
    let jobs=[],events=[];
    if (jobsEnabled && eventsEnabled) {
      const eventFirst=this.preferEvents;
      this.preferEvents=!this.preferEvents;
      if (eventFirst) {
        events=await this.store.claimOutbox(this.workerId,this.concurrency,this.leaseSeconds,[...this.eventHandlers.keys()]);
        const remaining=this.concurrency-events.length;
        if (remaining) jobs=await this.store.claimJobs(this.workerId,remaining,this.leaseSeconds,[...this.jobHandlers.keys()]);
      } else {
        jobs=await this.store.claimJobs(this.workerId,this.concurrency,this.leaseSeconds,[...this.jobHandlers.keys()]);
        const remaining=this.concurrency-jobs.length;
        if (remaining) events=await this.store.claimOutbox(this.workerId,remaining,this.leaseSeconds,[...this.eventHandlers.keys()]);
      }
    } else if (jobsEnabled) jobs=await this.store.claimJobs(this.workerId,this.concurrency,this.leaseSeconds,[...this.jobHandlers.keys()]);
    else if (eventsEnabled) events=await this.store.claimOutbox(this.workerId,this.concurrency,this.leaseSeconds,[...this.eventHandlers.keys()]);
    await Promise.all([
      ...jobs.map(job => this.#track(this.#process(job, this.jobHandlers.get(job.job_type), 'job'))),
      ...events.map(event => this.#track(this.#process(event, this.eventHandlers.get(event.event_type), 'event')))
    ]);
    return { jobsClaimed: jobs.length, eventsClaimed: events.length, ...this.counts };
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
    let leaseLost = false;
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
      if (typeof handler !== 'function') throw Object.assign(new Error('No handler is registered.'), { code: 'handler_unavailable' });
      const context = isJob
        ? { tenantId: item.tenant_id, jobId: id, jobType: item.job_type, idempotencyKey: item.idempotency_key, attempt: item.attempts, workerId: this.workerId, workerStore: this.store, signal: controller.signal }
        : { tenantId: item.tenant_id, eventId: id, eventType: item.event_type, attempt: item.attempts, workerId: this.workerId, signal: controller.signal };
      await handler(Object.freeze(item.payload_ref), Object.freeze(context));
      if (leaseLost) { this.counts.leaseLost++; return; }
      const acknowledged = isJob ? await this.store.completeJob(item, this.workerId) : await this.store.ackOutbox(item, this.workerId);
      if (acknowledged) this.counts[isJob ? 'jobsSucceeded' : 'eventsAcknowledged']++;
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
      clearInterval(timer);
    }
  }

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
