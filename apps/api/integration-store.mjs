import { createHash, randomBytes } from 'node:crypto';
import { createAuthError } from './auth-contracts.mjs';
import { getProvider } from '../../packages/atlas-integrations/index.mjs';
import { buildJobberAuthorizeUrl } from '../../packages/atlas-integrations/jobber.mjs';
import { hashSecret } from '../../packages/atlas-integrations/secrets.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const OPERATION = /^[a-z][a-z0-9_.-]{1,119}$/;

function invalid(code, message = code) { throw createAuthError(400, code, message); }
function assertUuid(value, field) { if (!UUID.test(value || '')) invalid('invalid_identifier', `${field} must be a UUID`); return value; }
function object(value, field) { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('invalid_payload', `${field} must be an object`); return value; }
function safeUrl(value, field) {
  let url;
  try { url = new URL(value); } catch { invalid('invalid_url', `${field} must be a valid URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search.length > 2048) invalid('invalid_url', `${field} must be an HTTPS URL without credentials`);
  return url;
}

export class PostgresIntegrationStore {
  constructor(pool, { cipher, env = process.env } = {}) {
    if (!pool || !cipher) throw new TypeError('Integration store requires a Postgres pool and encryption cipher.');
    this.pool = pool;
    this.cipher = cipher;
    this.env = env;
  }

  async #tenantContext(client, { actorId, tenantId }, { manage = false } = {}) {
    assertUuid(actorId, 'actorId'); assertUuid(tenantId, 'tenantId');
    await client.query("SELECT set_config('app.actor_id',$1,true)", [actorId]);
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
    const { rows } = await client.query(`
      SELECT m.role_key,r.permissions,o.status AS organization_status
      FROM atlas_organization_memberships m
      JOIN atlas_organizations o ON o.tenant_id=m.tenant_id
      LEFT JOIN atlas_organization_roles r ON r.tenant_id=m.tenant_id AND r.role_id=m.custom_role_id
      WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND o.status='active'
      LIMIT 1`, [tenantId, actorId]);
    const membership = rows[0];
    if (!membership) throw createAuthError(404, 'organization_not_found');
    const permissions = Array.isArray(membership.permissions) ? membership.permissions : [];
    if (manage && !['owner','admin'].includes(membership.role_key) && !permissions.includes('integrations.manage')) {
      throw createAuthError(403, 'integrations_manage_forbidden');
    }
    return { role: membership.role_key, permissions };
  }

  async #transaction(scope, work, options) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.#tenantContext(client, scope, options);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve root error. */ }
      throw error;
    } finally { client.release(); }
  }

  async listConnections({ actorId, tenantId }) {
    return this.#transaction({ actorId, tenantId }, async client => {
      const { rows } = await client.query(`
        SELECT connection_id,provider_id,auth_mode,status,display_name,external_account_id,external_account_name,
               scopes,last_health_status,last_health_at,last_error_code,created_at,updated_at
        FROM atlas_integration_connections
        WHERE tenant_id=$1
        ORDER BY provider_id,display_name,connection_id`, [tenantId]);
      return rows.map(row => ({
        id: row.connection_id, providerId: row.provider_id, authMode: row.auth_mode, status: row.status,
        displayName: row.display_name, externalAccountId: row.external_account_id, externalAccountName: row.external_account_name,
        scopes: row.scopes || [], lastHealthStatus: row.last_health_status, lastHealthAt: row.last_health_at,
        lastErrorCode: row.last_error_code, createdAt: row.created_at, updatedAt: row.updated_at
      }));
    });
  }

  async getConnection({ actorId, tenantId, connectionId }) {
    assertUuid(connectionId, 'connectionId');
    return this.#transaction({ actorId, tenantId }, async client => {
      const { rows } = await client.query(`
        SELECT * FROM atlas_integration_connections WHERE tenant_id=$1 AND connection_id=$2 LIMIT 1`, [tenantId, connectionId]);
      if (!rows[0]) throw createAuthError(404, 'integration_connection_not_found');
      return rows[0];
    });
  }

  async createJobberOAuthStart({ actorId, tenantId }) {
    const provider = getProvider('jobber');
    const clientId = this.env.ATLAS_JOBBER_CLIENT_ID;
    if (!clientId) throw createAuthError(503, 'jobber_not_configured', 'Jobber OAuth is not configured on this Atlas deployment.');
    const origin = this.env.ATLAS_PUBLIC_ORIGIN;
    if (!origin) throw createAuthError(503, 'public_origin_not_configured');
    const base = safeUrl(origin, 'ATLAS_PUBLIC_ORIGIN');
    const redirectUri = new URL('/api/v1/integrations/oauth/jobber/callback', base).toString();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const encryptedVerifier = this.cipher.encrypt({ verifier });
    await this.#transaction({ actorId, tenantId }, async client => {
      await client.query(
        `INSERT INTO atlas_integration_oauth_states(state_hash,tenant_id,actor_id,provider_id,redirect_uri,code_verifier_ciphertext,expires_at)
         VALUES($1,$2,$3,'jobber',$4,$5,now()+interval '10 minutes')`,
        [hashSecret(state), tenantId, actorId, redirectUri, encryptedVerifier]
      );
    }, { manage: true });
    return {
      provider: provider.name,
      state,
      authorizeUrl: buildJobberAuthorizeUrl({
        clientId, redirectUri, state, codeChallenge: challenge, scope: provider.scopes
      }),
      redirectUri
    };
  }

  async consumeOAuthState(state) {
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{32,512}$/.test(state)) throw createAuthError(400, 'oauth_state_invalid');
    const { rows } = await this.pool.query(
      'SELECT * FROM atlas_v118_consume_oauth_state($1::char(64))', [hashSecret(state)]
    );
    if (!rows[0]) throw createAuthError(400, 'oauth_state_invalid');
    return rows[0];
  }

  async saveJobberConnection({ actorId, tenantId, account, tokens, graphqlVersion }) {
    object(account, 'account'); object(tokens, 'tokens');
    if (typeof account.id !== 'string' || !account.id || typeof account.name !== 'string' || !account.name.trim()) invalid('jobber_account_invalid');
    const expiresIn = Number(tokens.expiresIn);
    const expiresAt = new Date(Date.now() + Math.max(60, Math.min(86_400, Number.isFinite(expiresIn) ? expiresIn : 3600)) * 1000).toISOString();
    const secretCiphertext = this.cipher.encrypt({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType || 'Bearer',
      accessTokenExpiresAt: expiresAt
    });
    return this.#transaction({ actorId, tenantId }, async client => {
      const scopes = Array.isArray(tokens.scope) && tokens.scope.length ? tokens.scope : getProvider('jobber').scopes;
      const config = { graphqlVersion: graphqlVersion || this.env.ATLAS_JOBBER_GRAPHQL_VERSION || null };
      if (!config.graphqlVersion) throw createAuthError(503, 'jobber_graphql_version_missing', 'ATLAS_JOBBER_GRAPHQL_VERSION is required.');
      const { rows } = await client.query(`
        INSERT INTO atlas_integration_connections(
          tenant_id,connection_id,provider_id,auth_mode,status,display_name,external_account_id,external_account_name,
          scopes,secret_ciphertext,config,last_health_status,last_error_code,created_by
        ) VALUES($1,gen_random_uuid(),'jobber','oauth2','connected',$2,$3,$4,$5,$6,$7::jsonb,'unknown',NULL,$8)
        ON CONFLICT(tenant_id,provider_id,external_account_id) DO UPDATE SET
          auth_mode='oauth2',status='connected',display_name=EXCLUDED.display_name,external_account_name=EXCLUDED.external_account_name,
          scopes=EXCLUDED.scopes,secret_ciphertext=EXCLUDED.secret_ciphertext,config=EXCLUDED.config,last_health_status='unknown',
          last_error_code=NULL,created_by=EXCLUDED.created_by,updated_at=now()
        RETURNING connection_id,provider_id,status,display_name,external_account_id,external_account_name,scopes,created_at,updated_at
      `, [
        tenantId, account.name.trim().slice(0,160), account.id.slice(0,512), account.name.trim().slice(0,240),
        scopes, secretCiphertext, JSON.stringify(config), actorId
      ]);
      return rows[0];
    }, { manage: true });
  }

  async workerGetConnection({ tenantId, connectionId }) {
    assertUuid(tenantId, 'tenantId'); assertUuid(connectionId, 'connectionId');
    const { rows } = await this.pool.query(
      'SELECT * FROM atlas_integration_connections WHERE tenant_id=$1 AND connection_id=$2 LIMIT 1', [tenantId, connectionId]
    );
    if (!rows[0]) throw createAuthError(404, 'integration_connection_not_found');
    return rows[0];
  }

  decryptSecret(connection) {
    if (!connection?.secret_ciphertext) throw createAuthError(401, 'integration_secret_missing');
    return this.cipher.decrypt(connection.secret_ciphertext);
  }

  async workerSaveTokens({ tenantId, connectionId, tokens }) {
    const expiresIn = Number(tokens.expiresIn);
    const expiresAt = new Date(Date.now() + Math.max(60, Math.min(86_400, Number.isFinite(expiresIn) ? expiresIn : 3600)) * 1000).toISOString();
    const connection = await this.workerGetConnection({ tenantId, connectionId });
    const current = this.decryptSecret(connection);
    const encrypted = this.cipher.encrypt({
      ...current,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType || current.tokenType || 'Bearer',
      accessTokenExpiresAt: expiresAt,
      refreshTokenUpdatedAt: new Date().toISOString()
    });
    await this.pool.query(
      `UPDATE atlas_integration_connections SET secret_ciphertext=$3,last_error_code=NULL,status='connected',updated_at=now()
       WHERE tenant_id=$1 AND connection_id=$2`, [tenantId, connectionId, encrypted]
    );
    return expiresAt;
  }

  async workerMarkHealth({ tenantId, connectionId, healthy, errorCode = null }) {
    await this.pool.query(
      `UPDATE atlas_integration_connections
       SET last_health_status=$3,last_health_at=now(),last_error_code=$4,status=CASE WHEN $3='healthy' THEN 'connected' ELSE CASE WHEN $4='jobber_reauth_required' THEN 'needs_reauth' ELSE 'error' END END,updated_at=now()
       WHERE tenant_id=$1 AND connection_id=$2`, [tenantId, connectionId, healthy ? 'healthy' : 'unhealthy', errorCode]
    );
  }

  async disconnect({ actorId, tenantId, connectionId }) {
    assertUuid(connectionId, 'connectionId');
    return this.#transaction({ actorId, tenantId }, async client => {
      const { rows } = await client.query(
        `UPDATE atlas_integration_connections
         SET status='disconnected',secret_ciphertext=NULL,last_health_status='unhealthy',last_health_at=now(),last_error_code='user_disconnected',updated_at=now()
         WHERE tenant_id=$1 AND connection_id=$2 RETURNING connection_id,provider_id,status`, [tenantId, connectionId]
      );
      if (!rows[0]) throw createAuthError(404, 'integration_connection_not_found');
      return rows[0];
    }, { manage: true });
  }

  async createTask({ actorId, tenantId, connectionId, operation, request = {}, idempotencyKey }) {
    assertUuid(connectionId, 'connectionId');
    if (!OPERATION.test(operation || '')) invalid('integration_operation_invalid');
    object(request, 'request');
    if (!SHA256.test(idempotencyKey || '')) idempotencyKey = createHash('sha256').update(JSON.stringify({ tenantId, connectionId, operation, request })).digest('hex');
    return this.#transaction({ actorId, tenantId }, async client => {
      const connection = await client.query(
        'SELECT connection_id,status FROM atlas_integration_connections WHERE tenant_id=$1 AND connection_id=$2 LIMIT 1',
        [tenantId, connectionId]
      );
      if (!connection.rows[0]) throw createAuthError(404, 'integration_connection_not_found');
      if (['disconnected'].includes(connection.rows[0].status)) throw createAuthError(409, 'integration_connection_disconnected');
      const taskId = randomBytes(16).toString('hex');
      const { rows } = await client.query(`
        INSERT INTO atlas_integration_tasks(tenant_id,task_id,connection_id,operation,request,status,idempotency_key,created_by)
        VALUES($1,$2::uuid,$3,$4,$5::jsonb,'queued',$6,$7)
        ON CONFLICT(tenant_id,idempotency_key) DO NOTHING
        RETURNING task_id,operation,status,created_at
      `, [tenantId, taskId, connectionId, operation, JSON.stringify(request), idempotencyKey, actorId]);
      let task;
      if (rows[0]) task = rows[0];
      else {
        const existing = await client.query(
          'SELECT task_id,operation,status,created_at FROM atlas_integration_tasks WHERE tenant_id=$1 AND idempotency_key=$2 LIMIT 1',
          [tenantId, idempotencyKey]
        );
        if (!existing.rows[0]) throw new Error('Integration task disappeared after idempotency conflict.');
        task = existing.rows[0];
      }
      await client.query(
        `SELECT atlas_v115_enqueue_job($1,$2::uuid,'integration.execute',$3::jsonb,$4,$5,8)`,
        [tenantId, task.task_id, JSON.stringify({ kind:'integration_task', id:String(task.task_id), version:1 }), idempotencyKey, new Date()]
      );
      return { id: task.task_id, operation: task.operation, status: task.status, createdAt: task.created_at, idempotencyKey };
    });
  }

  async workerGetTask({ tenantId, taskId }) {
    assertUuid(tenantId, 'tenantId'); assertUuid(taskId, 'taskId');
    const { rows } = await this.pool.query(`
      SELECT t.*,c.provider_id,c.auth_mode,c.status AS connection_status,c.external_account_id,c.external_account_name,c.scopes,c.secret_ciphertext,c.config,c.created_by AS connection_created_by
      FROM atlas_integration_tasks t JOIN atlas_integration_connections c
      ON c.tenant_id=t.tenant_id AND c.connection_id=t.connection_id
      WHERE t.tenant_id=$1 AND t.task_id=$2 LIMIT 1`, [tenantId, taskId]);
    if (!rows[0]) throw createAuthError(404, 'integration_task_not_found');
    return rows[0];
  }

  async workerMarkTask(task, status, result = null, errorCode = null) {
    const allowed = new Set(['processing','succeeded','retryable','dead_letter','canceled']);
    if (!allowed.has(status)) throw new TypeError('Invalid integration task status.');
    await this.pool.query(
      `UPDATE atlas_integration_tasks SET status=$3,result=$4::jsonb,last_error_code=$5,updated_at=now()
       WHERE tenant_id=$1 AND task_id=$2`, [
        task.tenant_id, task.task_id, status, result === null ? null : JSON.stringify(result), errorCode
      ]
    );
  }

  async workerGetMappedContact({ tenantId, connectionId, externalId }) {
    const { rows } = await this.pool.query(
      'SELECT * FROM atlas_v118_get_integration_contact($1,$2,$3)', [tenantId, connectionId, externalId]
    );
    return rows[0] || null;
  }

  async workerUpsertContact({ tenantId, connectionId, externalId, sourceUpdatedAt, record }) {
    const { rows } = await this.pool.query(
      'SELECT * FROM atlas_v118_upsert_integration_contact($1,$2,$3,$4,$5::jsonb)', [
        tenantId, connectionId, externalId, sourceUpdatedAt ? new Date(sourceUpdatedAt) : null, JSON.stringify(record)
      ]
    );
    return rows[0];
  }

  async workerMarkWebhookProcessed({ tenantId, webhookEventId, status = 'applied', errorCode = null }) {
    await this.pool.query(
      `UPDATE atlas_integration_webhook_events SET process_status=$3,processed_at=CASE WHEN $3 IN ('applied','ignored') THEN now() ELSE processed_at END,
       attempts=attempts+1,last_error_code=$4 WHERE tenant_id=$1 AND webhook_event_id=$2`,
      [tenantId, webhookEventId, status, errorCode]
    );
  }
}
