import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLAN_KEYS = Object.freeze(['starter', 'growth', 'scale']);
const BILLING_EVENTS = new Set(['subscription.created', 'subscription.updated', 'subscription.trialing', 'subscription.activated', 'subscription.past_due', 'subscription.canceled', 'subscription.paused', 'subscription.resumed']);
const STATUS_MAP = Object.freeze({ trialing: 'trialing', active: 'active', past_due: 'past_due', paused: 'paused', canceled: 'canceled' });

export function verifyPaddleSignature({ rawBody, signatureHeader, secret, now = Date.now(), toleranceSeconds = 5 } = {}) {
  if (!Buffer.isBuffer(rawBody) || rawBody.length > 1_000_000 || typeof signatureHeader !== 'string' || typeof secret !== 'string' || Buffer.byteLength(secret) < 24) return false;
  const parts = signatureHeader.split(';').map(part => part.trim()).filter(Boolean);
  const timestamps = parts.filter(part => part.startsWith('ts=')).map(part => part.slice(3));
  const hashes = parts.filter(part => part.startsWith('h1=')).map(part => part.slice(3));
  if (timestamps.length !== 1 || !/^\d{1,12}$/.test(timestamps[0]) || !hashes.length || hashes.length > 8) return false;
  const timestamp = Number(timestamps[0]);
  const nowSeconds = Math.floor(Number(now) / 1000);
  if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(nowSeconds) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamps[0]}:`).update(rawBody).digest();
  return hashes.some(hash => {
    if (!/^[a-f0-9]{64}$/i.test(hash)) return false;
    const candidate = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

export function paddlePlanCatalog(env = process.env) {
  return PLAN_KEYS.flatMap(key => {
    const priceId = env[`ATLAS_PADDLE_PRICE_${key.toUpperCase()}`];
    if (!priceId) return [];
    if (typeof priceId !== 'string' || !/^pri_[A-Za-z0-9]{8,120}$/.test(priceId)) throw new Error(`ATLAS_PADDLE_PRICE_${key.toUpperCase()} must be a Paddle price ID`);
    return [{ key, priceId }];
  });
}

function apiOrigin(env) {
  if (!['sandbox', 'live'].includes(env.ATLAS_PADDLE_ENVIRONMENT)) {
    throw Object.assign(new Error('Choose the Paddle sandbox or live environment explicitly.'), { code: 'billing_environment_required', status: 503 });
  }
  const sandbox = env.ATLAS_PADDLE_ENVIRONMENT === 'sandbox';
  if (env.ATLAS_PADDLE_API_ORIGIN) {
    let url;
    try { url = new URL(env.ATLAS_PADDLE_API_ORIGIN); } catch { throw new Error('Paddle API origin is invalid'); }
    const allowed = sandbox ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
    if (url.origin !== allowed || url.pathname !== '/' || url.search || url.hash) throw new Error('Paddle API origin must match the selected Paddle environment');
    return allowed;
  }
  return sandbox ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
}

export async function createPaddleCheckout({ tenantId, email, planKey, env = process.env, fetchImpl = fetch } = {}) {
  if (typeof tenantId !== 'string' || !TENANT_ID.test(tenantId)) throw new Error('A verified workspace is required');
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid billing email is required');
  if (!PLAN_KEYS.includes(planKey)) throw new Error('Choose a supported Atlas plan');
  if (!['sandbox', 'live'].includes(env.ATLAS_PADDLE_ENVIRONMENT)) throw Object.assign(new Error('Choose the Paddle sandbox or live environment explicitly.'), { code: 'billing_environment_required', status: 503 });
  const plan = paddlePlanCatalog(env).find(item => item.key === planKey);
  if (!plan) throw Object.assign(new Error('Paddle is not configured for this plan'), { code: 'billing_not_configured', status: 503 });
  if (typeof env.ATLAS_PADDLE_API_KEY !== 'string' || env.ATLAS_PADDLE_API_KEY.length < 20) throw Object.assign(new Error('Paddle billing is not configured'), { code: 'billing_not_configured', status: 503 });
  const response = await fetchImpl(`${apiOrigin(env)}/transactions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.ATLAS_PADDLE_API_KEY}`, 'content-type': 'application/json', accept: 'application/json', 'paddle-version': '1' },
    body: JSON.stringify({ items: [{ price_id: plan.priceId, quantity: 1 }], customer: { email: email.toLowerCase() }, custom_data: { tenant_id: tenantId, plan_key: plan.key, source: 'atlas_workspace_billing' } }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw Object.assign(new Error('Paddle could not create checkout. Try again later.'), { code: 'paddle_checkout_unavailable', status: 502 });
  const result = await response.json().catch(() => null);
  const transaction = result?.data;
  const checkoutUrl = transaction?.checkout?.url;
  let parsed;
  try { parsed = new URL(checkoutUrl); } catch { throw Object.assign(new Error('Paddle returned an invalid checkout link'), { code: 'paddle_checkout_unavailable', status: 502 }); }
  const allowedHost = env.ATLAS_PADDLE_ENVIRONMENT === 'sandbox' ? 'sandbox-checkout.paddle.com' : 'checkout.paddle.com';
  if (parsed.protocol !== 'https:' || parsed.hostname !== allowedHost || parsed.origin !== `https://${allowedHost}` || parsed.username || parsed.password || !/^txn_[A-Za-z0-9]{8,120}$/.test(String(transaction?.id || ''))) throw Object.assign(new Error('Paddle returned an unexpected checkout link'), { code: 'paddle_checkout_unavailable', status: 502 });
  return { transactionId: transaction.id, checkoutUrl: parsed.toString(), planKey: plan.key, priceId: plan.priceId };
}

export function normalizePaddleBillingEvent(event, { env = process.env } = {}) {
  if (!event || typeof event !== 'object' || typeof event.event_id !== 'string' || !/^evt_[A-Za-z0-9]{8,120}$/.test(event.event_id) || typeof event.event_type !== 'string' || !/^[a-z][a-z0-9_.-]{1,100}$/.test(event.event_type) || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) throw new Error('Paddle event envelope is invalid');
  const occurredAt = new Date(event.occurred_at || '').getTime();
  if (!Number.isFinite(occurredAt)) throw new Error('Paddle event time is invalid');
  const tenantId = event.data.custom_data?.tenant_id;
  const planKey = event.data.custom_data?.plan_key;
  if (!TENANT_ID.test(String(tenantId || '')) || !PLAN_KEYS.includes(planKey)) return { disposition: 'ignored', eventId: event.event_id, eventType: event.event_type, occurredAt: new Date(occurredAt).toISOString(), tenantId: null, bodySha256: null };
  if (!BILLING_EVENTS.has(event.event_type)) return { disposition: 'ignored', eventId: event.event_id, eventType: event.event_type, occurredAt: new Date(occurredAt).toISOString(), tenantId: tenantId.toLowerCase(), bodySha256: null };
  const data = event.data;
  const subscriptionId = data.id;
  const priceId = data.items?.[0]?.price?.id;
  if (typeof subscriptionId !== 'string' || !/^sub_[A-Za-z0-9]{8,120}$/.test(subscriptionId) || typeof priceId !== 'string') throw new Error('Paddle subscription identifiers are invalid');
  const status = STATUS_MAP[data.status];
  if (!status) throw new Error('Paddle subscription status is unsupported');
  const plans = paddlePlanCatalog(env);
  const pricePlan = plans.find(item => item.priceId === priceId);
  if (!pricePlan || pricePlan.key !== planKey) throw new Error('Paddle subscription does not match a configured Atlas plan');
  const periodEnd = data.current_billing_period?.ends_at ? new Date(data.current_billing_period.ends_at) : null;
  if (periodEnd && !Number.isFinite(periodEnd.getTime())) throw new Error('Paddle billing period is invalid');
  const customerId = data.customer_id;
  if (customerId != null && (typeof customerId !== 'string' || !/^ctm_[A-Za-z0-9]{8,120}$/.test(customerId))) throw new Error('Paddle customer reference is invalid');
  return {
    disposition: 'apply', eventId: event.event_id, eventType: event.event_type,
    occurredAt: new Date(occurredAt).toISOString(), tenantId: tenantId.toLowerCase(),
    subscriptionId, customerId: customerId || null, priceId, planKey,
    status: event.event_type === 'subscription.canceled' ? 'canceled' : status,
    currentPeriodEndsAt: periodEnd?.toISOString() || null,
    cancelAtPeriodEnd: data.scheduled_change?.action === 'cancel'
  };
}

export function paddleBodySha256(rawBody) {
  if (!Buffer.isBuffer(rawBody)) throw new TypeError('Paddle body must be a Buffer');
  return createHash('sha256').update(rawBody).digest('hex');
}
