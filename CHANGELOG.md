## 126.0.0 — Unified communications and production inbox
- Added durable unified conversation/message APIs for filtered inbox queues, message timelines, optimistic read state and human handoff.
- Added atomic outbound message creation plus `communication.message.send` queue jobs backed by the V125 production provider runtime.
- Added tenant-bound reference-only content storage for encrypted message bodies and attachments; queue/database rows never carry customer message content or provider secrets.
- Added provider-native webhook normalization for Postmark inbound/delivery events, Twilio messaging callbacks and WhatsApp Cloud events, with tenant endpoint resolution and replay-safe event identity.
- Added provider delivery receipts and durable sent/delivered/read/failed state reconciliation.
- Added lease-bound worker RPCs and fail-closed content/secret resolver boundaries.
- Postmark webhook security follows its documented Basic Auth/allowlisting model because Postmark does not provide HMAC signatures; Twilio signature validation follows its signed-request model.

{
  "name": "atlas-business-os",
  "private": true,
  "version": "126.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test --test-concurrency=1",
    "check": "node scripts/check.mjs",
    "doctor": "node scripts/doctor.mjs",
    "security:check": "node scripts/doctor.mjs",
    "mirofish:check": "node scripts/mirofish-check.mjs",
    "docs:check": "node scripts/docs-check.mjs",
    "smoke:e2e": "node scripts/smoke-http.mjs && node scripts/smoke-api-http.mjs",
    "preview": "node scripts/preview.mjs",
    "build:site": "node scripts/build-site.mjs",
    "seo:check": "node scripts/seo-check.mjs",
    "launch:check": "node scripts/launch-check.mjs",
    "start:api": "node apps/api/server.mjs",
    "start:worker": "node apps/worker/main.mjs",
    "production:check": "node scripts/production-check.mjs",
    "production:activation-check": "node scripts/production-activation-check.mjs",
    "db:migrate": "node scripts/migrate.mjs",
    "capabilities:check": "node scripts/capabilities-check.mjs",
    "service:check": "node --test packages/atlas-core/service-operations.test.mjs packages/atlas-core/oauth.test.mjs apps/worker/integration-runtime.test.mjs"
  },
  "engines": {"node": ">=20"},
  "dependencies": {"pg": "8.23.1"},
  "devDependencies": {"@electric-sql/pglite": "0.5.8"}
}
