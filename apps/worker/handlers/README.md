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
