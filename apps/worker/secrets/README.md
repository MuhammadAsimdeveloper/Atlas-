# Atlas production secret resolver boundary

Production workers never read provider secret material from workflow definitions, queue payloads, provider metadata, or customer HTTP requests.

Set ATLAS_WORKER_SECRET_RESOLVER_MODULE to a deployment-reviewed .mjs file in this directory. It must export resolveSecret({ tenantId, connectionId, credentialRef }).

The resolver must use the deployment KMS/secret manager, enforce tenant and credential ownership, reject disabled or expired credentials, and fail closed.

Do not place secrets in Git, workflow JSON, provider connection metadata, queue payloads, logs, or this directory.
