# Redis worker wakeup key fix

Date: 2026-10-10

## Finding

The worker passed already-qualified Redis keys (`<namespace>:wake:<queue>`) into `createRedisWakeupTransport.receive()`. The transport owns key construction and adds the namespace and `wake:` prefix itself. This produced keys such as `atlas:wake:atlas:wake:workflow.execute`, which do not match the keys written by `publish()`.

## Change

The worker now passes raw registered queue names to `receive(queues, 5)`. The transport remains the single owner of Redis key formatting. PostgreSQL remains the durable source of truth; Redis is only a wakeup/acceleration path.

## Regression coverage

`apps/worker/main.test.mjs` asserts that the worker passes raw queue names and does not pre-prefix the receive list.

## Verification and limits

The regression test is included in the repository's `node --test` discovery. This change has been committed to the `fix/redis-worker-wakeup` branch. A test run and live Redis integration check have **not** been executed from this remote repository-editing session; CI and deployment evidence are still required. This source fix does not establish that Redis is configured or available in production.
