function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

export function createMailer(env = process.env, { fetchImpl = fetch, logger = console } = {}) {
  const provider = env.ATLAS_EMAIL_PROVIDER || (env.NODE_ENV === 'production' ? 'postmark' : 'console');
  const send = async ({ to, subject, text, html }) => {
    if (provider === 'console' && env.NODE_ENV !== 'production') {
      logger.info?.(`[Atlas dev mail] ${JSON.stringify({ to, subject, text })}`);
      return { delivered: true, provider: 'console-dev' };
    }
    if (provider !== 'postmark') throw new Error('Transactional email provider is unavailable.');
    if (!env.ATLAS_EMAIL_PROVIDER_TOKEN || !env.ATLAS_EMAIL_FROM) throw new Error('Transactional email provider is not configured.');
    const response = await fetchImpl('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-postmark-server-token': env.ATLAS_EMAIL_PROVIDER_TOKEN, accept: 'application/json' },
      body: JSON.stringify({ From: env.ATLAS_EMAIL_FROM, To: to, Subject: subject, TextBody: text, HtmlBody: html, MessageStream: env.ATLAS_EMAIL_MESSAGE_STREAM || 'outbound' }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      logger.error?.(`Atlas email delivery failed (${response.status}).`);
      throw new Error('Transactional email delivery failed.');
    }
    const result = await response.json().catch(() => ({}));
    return { delivered: true, provider: 'postmark', messageId: typeof result.MessageID === 'string' ? result.MessageID.slice(0, 80) : null };
  };

  const appOrigin = () => {
    const origin = env.ATLAS_PUBLIC_ORIGIN || `http://localhost:${env.PORT || 8080}`;
    return new URL(origin).origin;
  };

  return Object.freeze({
    async sendVerification({ email, token }) {
      const link = new URL(`/verify-email?token=${encodeURIComponent(token)}`, appOrigin()).toString();
      return send({ to: email, subject: 'Verify your Atlas account', text: `Verify your Atlas account: ${link}\n\nThis link expires in 30 minutes. If you did not request this, ignore this email.`, html: `<p>Verify your Atlas account:</p><p><a href="${escapeHtml(link)}">Verify email address</a></p><p>This link expires in 30 minutes. If you did not request this, ignore this email.</p>` });
    },
    async sendPasswordReset({ email, token }) {
      const link = new URL(`/reset-password?token=${encodeURIComponent(token)}`, appOrigin()).toString();
      return send({ to: email, subject: 'Reset your Atlas password', text: `Reset your Atlas password: ${link}\n\nThis link expires in 30 minutes. If you did not request this, ignore this email.`, html: `<p>Reset your Atlas password:</p><p><a href="${escapeHtml(link)}">Choose a new password</a></p><p>This link expires in 30 minutes. If you did not request this, ignore this email.</p>` });
    },
    async sendInvitation({ email, token, organizationName, role }) {
      const link = new URL(`/accept-invitation?token=${encodeURIComponent(token)}`, appOrigin()).toString();
      return send({ to: email, subject: `Invitation to ${organizationName} on Atlas`, text: `You have been invited to ${organizationName} as ${role}. Sign in with ${email} and accept: ${link}\n\nThis invitation expires in 7 days.`, html: `<p>You have been invited to <strong>${escapeHtml(organizationName)}</strong> as ${escapeHtml(role)}.</p><p>Sign in with ${escapeHtml(email)} and <a href="${escapeHtml(link)}">accept the invitation</a>.</p><p>This invitation expires in 7 days.</p>` });
    }
  });
}
