import { randomUUID } from 'node:crypto';
import { createAuthError, organizationSlug } from './auth-contracts.mjs';

function rowUser(row) {
  return row ? { id: row.user_id, email: row.email, displayName: row.display_name, emailVerified: Boolean(row.email_verified_at), status: row.disabled_at ? 'disabled' : 'active', createdAt: row.created_at } : null;
}

function safeInvite(row) {
  const status = row.consumed_at ? row.user_id ? 'accepted' : 'replaced' : new Date(row.expires_at) > new Date() ? 'pending' : 'expired';
  return { id: row.token_hash.slice(0, 16), email: row.invited_email, role: row.invited_role_key, status, expiresAt: row.expires_at, createdAt: row.created_at };
}

export class PostgresAuthStore {
  constructor(pool, { clock = () => new Date() } = {}) {
    this.pool = pool;
    this.clock = clock;
  }

  async #transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Keep the original error. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async #context(client, settings) {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== null && value !== undefined && value !== '') await client.query('SELECT set_config($1, $2, true)', [`app.${key}`, String(value)]);
    }
  }

  async #audit(client, { userId = null, tenantId = null, action, subjectRef = null, metadata = {} }) {
    await client.query(
      'INSERT INTO atlas_auth_audit_events(event_id, tenant_id, actor_id, action, subject_ref, metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
      [randomUUID(), tenantId, userId, action, subjectRef, JSON.stringify(metadata)]
    );
  }

  async consumeRateLimit({ key, now, windowSeconds, limit }) {
    return this.#transaction(async client => {
      await this.#context(client, { rate_key: key });
      const start = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
      const { rows } = await client.query(`
        INSERT INTO atlas_auth_rate_limits(rate_key, window_start, hit_count, expires_at)
        VALUES ($1,$2,1,$3)
        ON CONFLICT (rate_key, window_start) DO UPDATE SET hit_count = atlas_auth_rate_limits.hit_count + 1
        RETURNING hit_count`, [key, start, new Date(start.getTime() + windowSeconds * 2000)]);
      return rows[0].hit_count <= limit;
    });
  }

  async findUserForLogin(email) {
    return this.#transaction(async client => {
      await this.#context(client, { auth_email: email });
      const { rows } = await client.query('SELECT user_id, email, display_name, password_hash, email_verified_at, disabled_at, created_at FROM atlas_auth_users WHERE email=$1 LIMIT 1', [email]);
      return rows[0] ? { ...rowUser(rows[0]), passwordHash: rows[0].password_hash } : null;
    });
  }

  async createAccount({ email, displayName, passwordHash, organizationName, industryKey, timeZone, verificationTokenHash, expiresAt }) {
    try { return await this.#transaction(async client => {
      await this.#context(client, { auth_email: email });
      const existing = await client.query('SELECT user_id FROM atlas_auth_users WHERE email=$1 LIMIT 1', [email]);
      if (existing.rowCount) return { created: false };
      const userId = randomUUID();
      const tenantId = randomUUID();
      await client.query(
        'INSERT INTO atlas_auth_users(user_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4)',
        [userId, email, displayName, passwordHash]
      );
      await this.#context(client, { actor_id: userId });
      await client.query(
        'INSERT INTO atlas_organizations(tenant_id,name,slug,industry_key,time_zone,created_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [tenantId, organizationName, organizationSlug(organizationName, tenantId), industryKey, timeZone, userId]
      );
      await this.#context(client, { tenant_id: tenantId });
      await client.query(
        "INSERT INTO atlas_organization_memberships(tenant_id,user_id,role_key,status) VALUES ($1,$2,'owner','active')",
        [tenantId, userId]
      );
      await client.query(
        "INSERT INTO atlas_auth_tokens(token_hash,user_id,purpose,expires_at) VALUES ($1,$2,'verify_email',$3)",
        [verificationTokenHash, userId, expiresAt]
      );
      await this.#audit(client, { userId, tenantId: null, action: 'auth.account_created' });
      await this.#audit(client, { userId, tenantId, action: 'organization.created', subjectRef: tenantId });
      return { created: true, userId, tenantId };
    }); }
    catch (error) {
      if (error.code === '23505' && error.constraint === 'idx_atlas_auth_users_email') return { created: false };
      throw error;
    }
  }

  async issueEmailVerification({ email, tokenHash, expiresAt }) {
    return this.#transaction(async client => {
      await this.#context(client, { auth_email: email });
      const { rows } = await client.query('SELECT user_id,email_verified_at,disabled_at FROM atlas_auth_users WHERE email=$1 LIMIT 1', [email]);
      const user = rows[0];
      if (!user || user.email_verified_at || user.disabled_at) return false;
      await this.#context(client, { actor_id: user.user_id });
      await client.query("UPDATE atlas_auth_tokens SET consumed_at=$2 WHERE user_id=$1 AND purpose='verify_email' AND consumed_at IS NULL", [user.user_id, this.clock()]);
      await client.query("INSERT INTO atlas_auth_tokens(token_hash,user_id,purpose,expires_at) VALUES ($1,$2,'verify_email',$3)", [tokenHash, user.user_id, expiresAt]);
      return true;
    });
  }

  async verifyEmail({ tokenHash }) {
    return this.#transaction(async client => {
      await this.#context(client, { auth_token_hash: tokenHash });
      const { rows } = await client.query("SELECT user_id FROM atlas_auth_tokens WHERE token_hash=$1 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at > $2 LIMIT 1", [tokenHash, this.clock()]);
      if (!rows[0]) return null;
      const userId = rows[0].user_id;
      await this.#context(client, { actor_id: userId });
      const claim = await client.query("UPDATE atlas_auth_tokens SET consumed_at=$2 WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>$2 RETURNING token_hash", [tokenHash, this.clock()]);
      if (!claim.rowCount) return null;
      const { rows: users } = await client.query('UPDATE atlas_auth_users SET email_verified_at=COALESCE(email_verified_at,$2), updated_at=$2 WHERE user_id=$1 AND disabled_at IS NULL RETURNING user_id,email,display_name,email_verified_at,disabled_at,created_at', [userId, this.clock()]);
      if (!users[0]) return null;
      await this.#audit(client, { userId, action: 'auth.email_verified' });
      return rowUser(users[0]);
    });
  }

  async createSession({ userId, sessionHash, csrfHash, expiresAt, userAgent, ipHash }) {
    return this.#transaction(async client => {
      await this.#context(client, { actor_id: userId });
      const { rows } = await client.query('SELECT user_id,email_verified_at,disabled_at FROM atlas_auth_users WHERE user_id=$1 LIMIT 1', [userId]);
      const user = rows[0];
      if (!user || !user.email_verified_at || user.disabled_at) throw createAuthError(401, 'authentication_required');
      const { rows: memberships } = await client.query("SELECT tenant_id FROM atlas_organization_memberships WHERE user_id=$1 AND status='active' ORDER BY created_at ASC LIMIT 1", [userId]);
      const tenantId = memberships[0]?.tenant_id || null;
      if (tenantId) await this.#context(client, { tenant_id: tenantId });
      await client.query(
        'INSERT INTO atlas_auth_sessions(session_hash,user_id,tenant_id,csrf_hash,expires_at,user_agent,ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [sessionHash, userId, tenantId, csrfHash, expiresAt, userAgent?.slice(0,512) || null, ipHash]
      );
      await this.#audit(client, { userId, action: 'auth.session_created' });
      return { tenantId };
    });
  }

  async getSession({ sessionHash }) {
    return this.#transaction(async client => {
      await this.#context(client, { session_hash: sessionHash });
      const { rows } = await client.query('SELECT session_hash,user_id,tenant_id,csrf_hash,expires_at FROM atlas_auth_sessions WHERE session_hash=$1 AND expires_at > $2 LIMIT 1', [sessionHash, this.clock()]);
      const session = rows[0];
      if (!session) return null;
      await this.#context(client, { actor_id: session.user_id, tenant_id: session.tenant_id });
      const { rows: users } = await client.query('SELECT user_id,email,display_name,email_verified_at,disabled_at,created_at FROM atlas_auth_users WHERE user_id=$1 AND disabled_at IS NULL LIMIT 1', [session.user_id]);
      if (!users[0] || !users[0].email_verified_at) return null;
      const { rows: memberships } = await client.query("SELECT m.tenant_id,m.role_key,m.status,o.name AS organization_name FROM atlas_organization_memberships m JOIN atlas_organizations o ON o.tenant_id=m.tenant_id WHERE m.user_id=$1 AND m.status='active' ORDER BY m.created_at ASC", [session.user_id]);
      const current = memberships.find(item => String(item.tenant_id) === String(session.tenant_id)) || null;
      await client.query("UPDATE atlas_auth_sessions SET last_seen_at=$2 WHERE session_hash=$1 AND last_seen_at < now() - interval '2 minutes'", [sessionHash, this.clock()]);
      return { tokenHash: sessionHash, csrfHash: session.csrf_hash, expiresAt: session.expires_at, user: rowUser(users[0]), tenantId: current?.tenant_id || null, tenantRole: current?.role_key || null, organizationName: current?.organization_name || null, memberships };
    });
  }

  async revokeSession({ sessionHash }) {
    return this.#transaction(async client => {
      await this.#context(client, { session_hash: sessionHash });
      const { rows } = await client.query('DELETE FROM atlas_auth_sessions WHERE session_hash=$1 RETURNING user_id', [sessionHash]);
      if (rows[0]) {
        await this.#context(client, { actor_id: rows[0].user_id });
        await this.#audit(client, { userId: rows[0].user_id, action: 'auth.session_revoked' });
      }
      return Boolean(rows[0]);
    });
  }

  async listOrganizations({ userId }) {
    return this.#transaction(async client => {
      await this.#context(client, { actor_id: userId });
      const { rows } = await client.query(`
        SELECT o.tenant_id,o.name,o.slug,o.status,o.created_at,m.role_key,m.custom_role_id,r.display_name AS custom_role_name,r.permissions
        FROM atlas_organization_memberships m JOIN atlas_organizations o ON o.tenant_id=m.tenant_id
        LEFT JOIN atlas_organization_roles r ON r.tenant_id=m.tenant_id AND r.role_id=m.custom_role_id
        WHERE m.user_id=$1 AND m.status='active' AND o.status='active' ORDER BY m.created_at`, [userId]);
      return rows.map(row => ({ id: row.tenant_id, name: row.name, slug: row.slug, status: row.status, role: row.role_key, customRole: row.custom_role_name ? { name: row.custom_role_name, permissions: row.permissions } : null, createdAt: row.created_at }));
    });
  }

  async createOrganization({ userId, sessionHash, name }) {
    return this.#transaction(async client => {
      await this.#context(client, { actor_id: userId });
      const tenantId = randomUUID();
      await client.query('INSERT INTO atlas_organizations(tenant_id,name,slug,created_by) VALUES ($1,$2,$3,$4)', [tenantId, name, organizationSlug(name, tenantId), userId]);
      await this.#context(client, { tenant_id: tenantId });
      await client.query("INSERT INTO atlas_organization_memberships(tenant_id,user_id,role_key,status) VALUES ($1,$2,'owner','active')", [tenantId, userId]);
      await client.query('UPDATE atlas_auth_sessions SET tenant_id=$2,last_seen_at=$3 WHERE session_hash=$1 AND user_id=$4', [sessionHash, tenantId, this.clock(), userId]);
      await this.#audit(client, { userId, tenantId, action: 'organization.created', subjectRef: tenantId });
      return { id: tenantId, name, slug: organizationSlug(name, tenantId), role: 'owner', status: 'active' };
    });
  }

  async selectOrganization({ userId, sessionHash, tenantId }) {
    return this.#transaction(async client => {
      await this.#context(client, { actor_id: userId });
      const { rows } = await client.query("SELECT m.role_key,o.name FROM atlas_organization_memberships m JOIN atlas_organizations o ON o.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.status='active' AND o.status='active' LIMIT 1", [tenantId, userId]);
      if (!rows[0]) throw createAuthError(404, 'organization_not_found');
      await this.#context(client, { tenant_id: tenantId });
      await client.query('UPDATE atlas_auth_sessions SET tenant_id=$2,last_seen_at=$3 WHERE session_hash=$1 AND user_id=$4', [sessionHash, tenantId, this.clock(), userId]);
      await this.#audit(client, { userId, tenantId, action: 'organization.selected', subjectRef: tenantId });
      return { id: tenantId, name: rows[0].name, role: rows[0].role_key };
    });
  }

  async getDashboard({ userId, tenantId }) {
    return this.#transaction(async client => {
      await this.#context(client, { actor_id: userId });
      const { rows: membership } = await client.query("SELECT role_key FROM atlas_organization_memberships WHERE tenant_id=$1 AND user_id=$2 AND status='active' LIMIT 1", [tenantId,userId]);
      if (!membership[0]) throw createAuthError(404, 'organization_not_found');
      await this.#context(client, { tenant_id: tenantId });
      const { rows } = await client.query(`
        SELECT o.tenant_id,o.name,o.industry_key,o.time_zone,o.created_at,
          (SELECT count(*)::integer FROM atlas_organization_memberships m WHERE m.tenant_id=o.tenant_id AND m.status='active') AS active_members,
          (SELECT count(*)::integer FROM atlas_auth_tokens t WHERE t.tenant_id=o.tenant_id AND t.purpose='organization_invite' AND t.consumed_at IS NULL AND t.expires_at > $2) AS pending_invitations,
          (SELECT count(*)::integer FROM atlas_auth_audit_events e WHERE e.tenant_id=o.tenant_id AND e.created_at >= $2 - interval '7 days') AS events_last_7_days
        FROM atlas_organizations o WHERE o.tenant_id=$1 LIMIT 1`, [tenantId, this.clock()]);
      if (!rows[0]) throw createAuthError(404, 'organization_not_found');
      return { organization: { id: rows[0].tenant_id, name: rows[0].name, industry: rows[0].industry_key, timeZone: rows[0].time_zone, createdAt: rows[0].created_at }, actor: { role: membership[0].role_key }, metrics: { activeMembers: rows[0].active_members, pendingInvitations: rows[0].pending_invitations, auditEventsLast7Days: rows[0].events_last_7_days }, dataStatus: 'live_core_metrics', unconnectedModules: ['contacts','opportunities','messaging','automation','revenue'] };
    });
  }

  async listMembers({ userId, tenantId }) {
    return this.#transaction(async client => {
      await this.#context(client, { actor_id: userId });
      const { rows: actor } = await client.query("SELECT role_key FROM atlas_organization_memberships WHERE tenant_id=$1 AND user_id=$2 AND status='active'", [tenantId,userId]);
      if (!actor[0]) throw createAuthError(404, 'organization_not_found');
      if (!['owner','admin'].includes(actor[0].role_key)) throw createAuthError(403, 'tenant_admin_required');
      await this.#context(client, { tenant_id: tenantId });
      const { rows } = await client.query(`
        SELECT m.user_id,u.email,u.display_name,m.role_key,m.status,m.created_at,r.display_name AS custom_role_name
        FROM atlas_organization_memberships m JOIN atlas_auth_users u ON u.user_id=m.user_id
        LEFT JOIN atlas_organization_roles r ON r.tenant_id=m.tenant_id AND r.role_id=m.custom_role_id
        WHERE m.tenant_id=$1 ORDER BY m.created_at,m.user_id`, [tenantId]);
      return rows.map(row => ({ userId: row.user_id, email: row.email, displayName: row.display_name, role: row.role_key, customRoleName: row.custom_role_name || null, status: row.status, joinedAt: row.created_at }));
    });
  }

  async createInvitation({ userId, tenantId, email, roleKey, customRoleId, tokenHash, expiresAt }) {
    try { return await this.#transaction(async client => {
      await this.#context(client, { actor_id: userId });
      const { rows: actor } = await client.query("SELECT role_key FROM atlas_organization_memberships WHERE tenant_id=$1 AND user_id=$2 AND status='active'", [tenantId,userId]);
      if (!actor[0]) throw createAuthError(404, 'organization_not_found');
      if (!['owner','admin'].includes(actor[0].role_key)) throw createAuthError(403, 'tenant_admin_required');
      await this.#context(client, { tenant_id: tenantId, auth_email: email });
      if (customRoleId) {
        const role = await client.query('SELECT role_id FROM atlas_organization_roles WHERE tenant_id=$1 AND role_id=$2 AND role_key=$3', [tenantId,customRoleId,roleKey]);
        if (!role.rows[0]) throw createAuthError(404, 'custom_role_not_found');
      }
      const member = await client.query('SELECT user_id FROM atlas_organization_memberships WHERE tenant_id=$1 AND user_id IN (SELECT user_id FROM atlas_auth_users WHERE email=$2) AND status IN (\'active\',\'invited\')', [tenantId,email]);
      if (member.rowCount) throw createAuthError(409, 'member_already_exists');
      await client.query("UPDATE atlas_auth_tokens SET consumed_at=$3 WHERE tenant_id=$1 AND lower(invited_email)=lower($2) AND purpose='organization_invite' AND consumed_at IS NULL", [tenantId,email,this.clock()]);
      await client.query(`INSERT INTO atlas_auth_tokens(token_hash,user_id,purpose,tenant_id,invited_email,invited_role_key,invited_custom_role_id,created_by,expires_at)
        VALUES ($1,NULL,'organization_invite',$2,$3,$4,$5,$6,$7)`, [tokenHash,tenantId,email,roleKey,customRoleId,userId,expiresAt]);
      await this.#audit(client, { userId, tenantId, action: 'organization.invitation_created', subjectRef: email, metadata: { role: roleKey } });
      const { rows } = await client.query("SELECT o.name FROM atlas_organizations o WHERE o.tenant_id=$1", [tenantId]);
      return { organizationName: rows[0]?.name || 'Atlas workspace', role: roleKey };
    }); }
    catch (error) {
      if (error.code === '23505' && error.constraint === 'idx_atlas_auth_tokens_active_invitation') throw createAuthError(409, 'invitation_already_pending');
      throw error;
    }
  }

  async listInvitations({ userId, tenantId }) {
    return this.#transaction(async client => {
      await this.#context(client, { actor_id: userId });
      const { rows: actor } = await client.query("SELECT role_key FROM atlas_organization_memberships WHERE tenant_id=$1 AND user_id=$2 AND status='active'", [tenantId,userId]);
      if (!actor[0]) throw createAuthError(404, 'organization_not_found');
      if (!['owner','admin'].includes(actor[0].role_key)) throw createAuthError(403, 'tenant_admin_required');
      await this.#context(client, { tenant_id: tenantId });
      const { rows } = await client.query("SELECT token_hash,user_id,invited_email,invited_role_key,expires_at,consumed_at,created_at FROM atlas_auth_tokens WHERE tenant_id=$1 AND purpose='organization_invite' ORDER BY created_at DESC LIMIT 100", [tenantId]);
      return rows.map(safeInvite);
    });
  }

  async acceptInvitation({ userId, email, tokenHash }) {
    return this.#transaction(async client => {
      await this.#context(client, { auth_token_hash: tokenHash, auth_email: email });
      const { rows } = await client.query("SELECT tenant_id,invited_email,invited_role_key,invited_custom_role_id,created_by FROM atlas_auth_tokens WHERE token_hash=$1 AND purpose='organization_invite' AND lower(invited_email)=$2 AND consumed_at IS NULL AND expires_at>$3 LIMIT 1", [tokenHash,email,this.clock()]);
      const invite = rows[0];
      if (!invite) throw createAuthError(400, 'invalid_or_expired_invitation');
      await this.#context(client, { actor_id: userId, tenant_id: invite.tenant_id });
      const { rows: actor } = await client.query('SELECT email_verified_at,disabled_at FROM atlas_auth_users WHERE user_id=$1', [userId]);
      if (!actor[0]?.email_verified_at || actor[0].disabled_at) throw createAuthError(403, 'verified_account_required');
      const claim = await client.query("UPDATE atlas_auth_tokens SET user_id=$2,consumed_at=$3 WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>$3 RETURNING token_hash", [tokenHash,userId,this.clock()]);
      if (!claim.rowCount) throw createAuthError(400, 'invalid_or_expired_invitation');
      const duplicate = await client.query('SELECT user_id FROM atlas_organization_memberships WHERE tenant_id=$1 AND user_id=$2', [invite.tenant_id,userId]);
      if (duplicate.rowCount) throw createAuthError(409, 'member_already_exists');
      await client.query("INSERT INTO atlas_organization_memberships(tenant_id,user_id,role_key,custom_role_id,status,invited_by) VALUES ($1,$2,$3,$4,'active',$5)", [invite.tenant_id,userId,invite.invited_role_key,invite.invited_custom_role_id,invite.created_by]);
      await this.#audit(client, { userId, tenantId: invite.tenant_id, action: 'organization.invitation_accepted', subjectRef: email, metadata: { role: invite.invited_role_key } });
      const { rows: organizations } = await client.query('SELECT name FROM atlas_organizations WHERE tenant_id=$1', [invite.tenant_id]);
      return { id: invite.tenant_id, name: organizations[0]?.name, role: invite.invited_role_key };
    });
  }

  async createCustomRole({ userId, tenantId, roleId, role }) {
    return this.#transaction(async client => {
      await this.#context(client, { actor_id: userId });
      const { rows: actor } = await client.query("SELECT role_key FROM atlas_organization_memberships WHERE tenant_id=$1 AND user_id=$2 AND status='active'", [tenantId,userId]);
      if (!actor[0]) throw createAuthError(404, 'organization_not_found');
      if (!['owner','admin'].includes(actor[0].role_key)) throw createAuthError(403, 'tenant_admin_required');
      await this.#context(client, { tenant_id: tenantId });
      const { rows } = await client.query(`INSERT INTO atlas_organization_roles(tenant_id,role_id,role_key,display_name,permissions,created_by)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING role_id,role_key,display_name,permissions,created_at`,
      [tenantId,roleId,role.key,role.name,JSON.stringify(role.permissions),userId]);
      await this.#audit(client, { userId, tenantId, action: 'organization.role_created', subjectRef: role.key });
      return { id: rows[0].role_id, key: rows[0].role_key, name: rows[0].display_name, permissions: rows[0].permissions, createdAt: rows[0].created_at };
    });
  }

  async listCustomRoles({ userId, tenantId }) {
    return this.#transaction(async client => {
      await this.#context(client, { actor_id: userId });
      const member = await client.query("SELECT user_id FROM atlas_organization_memberships WHERE tenant_id=$1 AND user_id=$2 AND status='active'", [tenantId,userId]);
      if (!member.rowCount) throw createAuthError(404, 'organization_not_found');
      await this.#context(client, { tenant_id: tenantId });
      const { rows } = await client.query('SELECT role_id,role_key,display_name,permissions,created_at FROM atlas_organization_roles WHERE tenant_id=$1 ORDER BY display_name', [tenantId]);
      return rows.map(row => ({ id: row.role_id, key: row.role_key, name: row.display_name, permissions: row.permissions, createdAt: row.created_at }));
    });
  }

  async issuePasswordReset({ email, tokenHash, expiresAt }) {
    return this.#transaction(async client => {
      await this.#context(client, { auth_email: email });
      const { rows } = await client.query('SELECT user_id,email_verified_at,disabled_at FROM atlas_auth_users WHERE email=$1 LIMIT 1', [email]);
      const user = rows[0];
      if (!user?.email_verified_at || user.disabled_at) return false;
      await this.#context(client, { actor_id: user.user_id });
      await client.query("UPDATE atlas_auth_tokens SET consumed_at=$2 WHERE user_id=$1 AND purpose='password_reset' AND consumed_at IS NULL", [user.user_id,this.clock()]);
      await client.query("INSERT INTO atlas_auth_tokens(token_hash,user_id,purpose,expires_at) VALUES ($1,$2,'password_reset',$3)", [tokenHash,user.user_id,expiresAt]);
      return true;
    });
  }

  async resetPassword({ tokenHash, passwordHash }) {
    return this.#transaction(async client => {
      await this.#context(client, { auth_token_hash: tokenHash });
      const { rows } = await client.query("SELECT user_id FROM atlas_auth_tokens WHERE token_hash=$1 AND purpose='password_reset' AND consumed_at IS NULL AND expires_at>$2 LIMIT 1", [tokenHash,this.clock()]);
      if (!rows[0]) throw createAuthError(400, 'invalid_or_expired_reset_token');
      const userId = rows[0].user_id;
      await this.#context(client, { actor_id: userId });
      const claim = await client.query("UPDATE atlas_auth_tokens SET consumed_at=$2 WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>$2 RETURNING token_hash", [tokenHash,this.clock()]);
      if (!claim.rowCount) throw createAuthError(400, 'invalid_or_expired_reset_token');
      await client.query('UPDATE atlas_auth_users SET password_hash=$2,updated_at=$3 WHERE user_id=$1 AND disabled_at IS NULL', [userId,passwordHash,this.clock()]);
      await client.query("UPDATE atlas_auth_tokens SET consumed_at=$2 WHERE user_id=$1 AND purpose='password_reset' AND consumed_at IS NULL", [userId,this.clock()]);
      await client.query('DELETE FROM atlas_auth_sessions WHERE user_id=$1', [userId]);
      await this.#audit(client, { userId, action: 'auth.password_reset_completed' });
      return true;
    });
  }

  async updateProfile({ userId, displayName }) {
    return this.#transaction(async client => {
      await this.#context(client, { actor_id: userId });
      const { rows } = await client.query('UPDATE atlas_auth_users SET display_name=$2,updated_at=$3 WHERE user_id=$1 AND disabled_at IS NULL RETURNING user_id,email,display_name,email_verified_at,disabled_at,created_at', [userId,displayName,this.clock()]);
      if (!rows[0]) throw createAuthError(401, 'authentication_required');
      await this.#audit(client, { userId, action: 'auth.profile_updated' });
      return rowUser(rows[0]);
    });
  }

  async ping() {
    await this.pool.query('SELECT 1');
    const { rows } = await this.pool.query("SELECT to_regclass('public.atlas_auth_users') AS auth_schema");
    return Boolean(rows[0]?.auth_schema);
  }

  async close() { await this.pool.end(); }
}
