import {executeWorkflowJob} from '../workflow-executor.mjs';

export const jobHandlers = Object.freeze({
  'workflow.execute': async (payloadRef, context) => {
    const store = context.workerStore;
    if (!store) throw Object.assign(new Error('Worker execution store is unavailable.'), { code: 'worker_store_unavailable' });
    return executeWorkflowJob({
      store,
      job: { tenant_id: context.tenantId, job_id: context.jobId },
      workerId: context.workerId,
      resolveAction: async ({ node }) => {
        if (node.requiresAdapter) {
          throw Object.assign(new Error('No verified provider adapter is registered for this node.'), { code: 'provider_adapter_unavailable' });
        }
        return { selectedPort: 'next' };
      },
      now: Date.now()
    });
  }
});

export const eventHandlers = Object.freeze({});
