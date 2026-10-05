# Atlas P126 inbox content boundary

P126 deliberately keeps customer message bodies, attachments and raw provider payloads out of PostgreSQL inbox rows and queue payloads. Deploy a reviewed module under `apps/inbox-content/` and set `ATLAS_INBOX_CONTENT_MODULE`.

The module must export:
- `putMessageContent({tenantId,messageId,channel,text,html,attachments,metadata})` -> an opaque `contentRef`.
- `getMessageContent({tenantId,messageId,contentRef})` -> bounded reader output.

The production implementation should use tenant-scoped encrypted object storage/KMS, retention rules and malware scanning for attachments. It must never log content or return credentials. The repository does not ship a fake content store.
