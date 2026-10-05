# Atlas worker handler modules

The worker process only imports a deployment-reviewed `.mjs` file from this directory. Set `ATLAS_WORKER_HANDLERS_MODULE` to its filename and do not accept handler module paths from tenant data or HTTP requests.

A module must export one or both maps:

```js
export const jobHandlers = {
  'workflow.execute': async (payloadRef, context) => {
    // Resolve tenant-owned records using a separately reviewed, least-privilege adapter.
    // Use context.idempotencyKey for any external side effect.
  }
};

export const eventHandlers = {
  'contact.created': async (payloadRef, context) => {
    // Outbox delivery is at-least-once. Deduplicate using context.eventId.
  }
};
```

The sample above documents the contract; it is not an executable provider integration. Atlas V115 ships no default business handlers, so the worker refuses to start without an operator-supplied module. Handler functions receive resource references, a stable idempotency key or event ID, and an abort signal. They do not receive raw customer data from the queue.


## V120 workflow execution security boundary

V120 removes direct SELECT/INSERT/UPDATE privileges on `atlas_workflow_executions` and `atlas_workflow_execution_events` from `atlas_worker`.

A `workflow.execute` handler must use the worker execution adapter exposed by `apps/api/runtime-store.mjs`:

- `getWorkflowExecutionForJob(job, workerId)`
- `updateWorkflowExecutionForJob(job, workerId, update)`
- `appendWorkflowExecutionEventForJob(job, workerId, event)`

Those methods call lease-bound V120 PostgreSQL RPCs. Do not connect a handler directly to the workflow execution tables and do not add broader table grants to `atlas_worker`.

The adapter returns no execution when the queue lease is missing, expired or owned by a different worker. This is intentional fail-closed behavior.

## V119 workflow execution handler boundary

V119 introduces the canonical job type `workflow.execute`.

A reviewed deployment handler may register that job type and use the queue payload reference:

```json
{ "kind": "workflow_execution", "id": "<execution-id>", "version": 1 }
```

The handler must load the durable execution through an approved execution adapter, verify the stored graph checksum/version and current execution version before advancing a step, then use the supplied job idempotency key for any external side effect.

The handler must not read CRM/auth/customer tables using the `atlas_worker` connection. Provider/API access belongs in separately reviewed least-privilege adapters. Atlas V119 does not ship a default `workflow.execute` handler, so production execution remains explicitly disabled until a reviewed module is mounted.
