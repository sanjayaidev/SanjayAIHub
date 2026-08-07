/**
 * routes/payment.js
 *
 * Subscription checkout for Basic / Premium ("pro") / Enterprise plans.
 * Ported from the payment setup in sanjayaidev/donationalert (Cashfree,
 * Razorpay, PayPal, Stripe) and adapted:
 *   - Supabase REST calls  -> plain Postgres via the shared `pg` pool (db/index.js)
 *   - "fire StreamElements" -> "upgrade users.subscription_tier"
 *   - Supabase cron function -> in-process sweep, started from server.js
 *
 * Flow (matches donationalert):
 *   1. POST /create-order  -> creates a `pending` row in `payments`,
 *      returns whatever the client-side SDK/redirect needs.
 *   2. Client completes checkout with the provider.
 *   3. POST /verify-order  -> polled by the client every ~3s. Checks status
 *      directly with the provider, and on first success marks the row paid
 *      and upgrades the user's subscription_tier (idempotent).
 *   4. sweepPendingPayments() (called on an interval from server.js) is a
 *      backstop for anyone who closes the tab before step 3 confirms, and
 *      expires anything left pending after 30 minutes.
 */

const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const isTestMode = process.env.PRODUCTION_MODE !== 'true';
const PENDING_EXPIRY_MS = 30 * 60 * 1000; // 30 min - checkout sessions/orders don't live much longer than this anyway

// ─── Plan pricing (server is the source of truth — never trust a client-sent amount) ───
// Matches the pricing shown in public/profile.html's Plan tab.
// INR-native gateways (Razorpay, Cashfree) charge the INR figure;
// USD-native gateways (PayPal, Stripe) charge the USD figure — same split
// donationalert uses (Cashfree/Razorpay = INR, PayPal/Stripe = USD).
const PLAN_PRICING = {
  basic:      { inr: 500,  usd: 55  },
  pro:        { inr: 1000, usd: 110 }, // "Premium" in the UI
  enterprise: { inr: 1500, usd: 165 },
};

const PLAN_NAMES = { basic: 'Basic', pro: 'Premium', enterprise: 'Enterprise' };

function priceFor(tier, provider) {
  const p = PLAN_PRICING[tier];
  if (!p) return null;
  const usesUsd = provider === 'paypal' || provider === 'stripe';
  return { amount: usesUsd ? p.usd : p.inr, currency: usesUsd ? 'USD' : 'INR' };
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function insertPending({ order_id, user_id, provider, amount, currency, plan_tier, name, email, provider_order_id }) {
  await pool.query(
    `INSERT INTO payments (order_id, user_id, provider, status, amount, currency, plan_tier, customer_name, customer_email, provider_order_id)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9)`,
    [order_id, user_id, provider, amount, currency, plan_tier, name || null, email || null, provider_order_id || null]
  );
}

async function getPaymentByOrderId(order_id) {
  const result = await pool.query('SELECT * FROM payments WHERE order_id = $1 LIMIT 1', [order_id]);
  return result.rows[0] || null;
}

async function markPaid(order_id, { provider_order_id, amount, currency }) {
  await pool.query(
    `UPDATE payments
     SET status = 'paid', provider_order_id = COALESCE($2, provider_order_id),
         amount = COALESCE($3, amount), currency = COALESCE($4, currency), updated_at = NOW()
     WHERE order_id = $1`,
    [order_id, provider_order_id || null, amount || null, currency || null]
  );
}

async function upgradeUserTier(user_id, plan_tier) {
  // Simple model: every successful payment sets a fresh 30-day subscription
  // window on the paid tier. (Stacking remaining time on renewal is a
  // reasonable follow-up but out of scope for the first cut.)
  await pool.query(
    `UPDATE users
     SET subscription_tier = $2, subscription_ends_at = NOW() + INTERVAL '30 days', updated_at = NOW()
     WHERE id = $1`,
    [user_id, plan_tier]
  );
}

// ─── Create Order ────────────────────────────────────────────────────────────

router.post('/create-order', authenticateToken, async (req, res) => {
  const { tier, provider } = req.body;
  const chosenProvider = provider || 'cashfree';

  if (!PLAN_PRICING[tier]) {
    return res.status(400).json({ success: false, message: 'Unknown plan tier', code: 'INVALID_TIER' });
  }
  if (!['cashfree', 'razorpay', 'paypal', 'stripe'].includes(chosenProvider)) {
    return res.status(400).json({ success: false, message: 'Unknown payment provider', code: 'INVALID_PROVIDER' });
  }

  const { amount, currency } = priceFor(tier, chosenProvider);
  const name = req.user.full_name || req.user.username || 'SanjayAIHub User';
  const email = req.user.email;
  const orderId = 'sub' + Date.now() + crypto.randomBytes(3).toString('hex'); // alphanumeric, required by Cashfree
  const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
  const modeInfo = { mode: isTestMode ? 'TEST' : 'PRODUCTION' };

  try {
    if (chosenProvider === 'razorpay') {
      return await handleRazorpay(res, { orderId, amount, currency, tier, name, email, userId: req.user.id, modeInfo });
    } else if (chosenProvider === 'paypal') {
      return await handlePaypal(res, { orderId, amount, currency, tier, name, email, userId: req.user.id, origin, modeInfo });
    } else if (chosenProvider === 'stripe') {
      return await handleStripe(res, { orderId, amount, currency, tier, name, email, userId: req.user.id, origin, modeInfo });
    } else {
      return await handleCashfree(res, { orderId, amount, currency, tier, name, email, userId: req.user.id, origin, modeInfo });
    }
  } catch (err) {
    console.error(`[payment/create-order] ${chosenProvider} exception:`, err);
    return res.status(500).json({ success: false, message: err.message, mode: modeInfo });
  }
});

// ─── Cashfree ────────────────────────────────────────────────────────────────
async function handleCashfree(res, { orderId, amount, currency, tier, name, email, userId, origin, modeInfo }) {
  const appId = isTestMode
    ? (process.env.CASHFREE_SANDBOX_APP_ID || process.env.CASHFREE_APP_ID)
    : process.env.CASHFREE_APP_ID;
  const secretKey = isTestMode
    ? (process.env.CASHFREE_SANDBOX_SECRET_KEY || process.env.CASHFREE_SECRET_KEY)
    : process.env.CASHFREE_SECRET_KEY;

  if (!appId || !secretKey) {
    return res.status(500).json({ success: false, message: `Cashfree credentials not set for ${modeInfo.mode} mode`, code: 'MISSING_CREDENTIAL' });
  }

  const cfBaseUrl = isTestMode ? 'https://sandbox.cashfree.com/pg' : 'https://api.cashfree.com/pg';

  const cfRes = await fetch(`${cfBaseUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': '2023-08-01',
      'x-client-id': appId,
      'x-client-secret': secretKey,
    },
    body: JSON.stringify({
      order_id: orderId,
      order_amount: parseFloat(amount.toFixed(2)),
      order_currency: currency,
      customer_details: {
        customer_id: 'user' + userId,
        customer_name: name,
        customer_email: email,
        customer_phone: '9999999999', // required by CF; not collected from our users
      },
      order_meta: {
        return_url: `${origin}/profile.html?payment_order_id={order_id}&provider=cashfree`,
      },
      order_tags: { plan_tier: tier },
    }),
  });

  const order = await cfRes.json();
  if (!cfRes.ok || !order.payment_session_id) {
    console.error('[Cashfree] create-order error', { status: cfRes.status, order });
    return res.status(502).json({ success: false, message: 'Cashfree order creation failed', cf_response: order, mode: modeInfo });
  }

  await insertPending({ order_id: orderId, user_id: userId, provider: 'cashfree', amount, currency, plan_tier: tier, name, email });

  return res.status(200).json({
    success: true, order_id: orderId, payment_session_id: order.payment_session_id, provider: 'cashfree', mode: modeInfo,
  });
}

// ─── Razorpay ────────────────────────────────────────────────────────────────
async function handleRazorpay(res, { orderId, amount, currency, tier, name, email, userId, modeInfo }) {
  const keyId = isTestMode
    ? (process.env.RAZORPAY_TEST_KEY_ID || process.env.RAZORPAY_KEY_ID)
    : process.env.RAZORPAY_KEY_ID;
  const keySecret = isTestMode
    ? (process.env.RAZORPAY_TEST_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET)
    : process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(500).json({ success: false, message: `Razorpay credentials not set for ${modeInfo.mode} mode`, code: 'MISSING_CREDENTIAL' });
  }

  const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
    },
    body: JSON.stringify({
      amount: Math.round(amount * 100), // paise
      currency,
      receipt: orderId,
      notes: { user_id: userId, plan_tier: tier, name, email },
    }),
  });

  const order = await rzpRes.json();
  if (!rzpRes.ok) {
    return res.status(502).json({ success: false, message: 'Razorpay order creation failed', rzp_response: order, mode: modeInfo });
  }

  await insertPending({ order_id: orderId, user_id: userId, provider: 'razorpay', amount, currency, plan_tier: tier, name, email, provider_order_id: order.id });

  return res.status(200).json({
    success: true, order_id: orderId, razorpay_order_id: order.id, razorpay_key_id: keyId, amount, currency, provider: 'razorpay', mode: modeInfo,
  });
}

// ─── PayPal ──────────────────────────────────────────────────────────────────
// v2 Orders API (create -> approve on PayPal's site -> capture). See
// donationalert's create-order.js for the note on why v2 (not the legacy v1
// Payments API, which never actually captured funds there).
async function handlePaypal(res, { orderId, amount, currency, tier, name, email, userId, origin, modeInfo }) {
  const clientId = isTestMode
    ? (process.env.PAYPAL_SANDBOX_CLIENT_ID || process.env.PAYPAL_CLIENT_ID)
    : process.env.PAYPAL_CLIENT_ID;
  const clientSecret = isTestMode
    ? (process.env.PAYPAL_SANDBOX_CLIENT_SECRET || process.env.PAYPAL_CLIENT_SECRET)
    : process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ success: false, message: `PayPal credentials not set for ${modeInfo.mode} mode`, code: 'MISSING_CREDENTIAL' });
  }

  const ppBase = isTestMode ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

  const tokenRes = await fetch(`${ppBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    return res.status(500).json({ success: false, message: 'PayPal token fetch failed', mode: modeInfo });
  }

  const ppRes = await fetch(`${ppBase}/v2/checkout/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenData.access_token}` },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: orderId,
        custom_id: orderId,
        description: `SanjayAIHub ${PLAN_NAMES[tier]} plan (1 month)`,
        amount: { currency_code: currency, value: amount.toFixed(2) },
      }],
      application_context: {
        return_url: `${origin}/profile.html?payment_order_id=${orderId}&provider=paypal`,
        cancel_url: `${origin}/profile.html`,
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
      },
    }),
  });

  const order = await ppRes.json();
  const approvalUrl = order.links?.find(l => l.rel === 'approve')?.href;
  if (!ppRes.ok || !approvalUrl) {
    console.error('[PayPal] create-order error', { status: ppRes.status, order });
    return res.status(502).json({ success: false, message: 'PayPal order creation failed', pp_response: order, mode: modeInfo });
  }

  await insertPending({ order_id: orderId, user_id: userId, provider: 'paypal', amount, currency, plan_tier: tier, name, email, provider_order_id: order.id });

  return res.status(200).json({ success: true, order_id: orderId, paypal_approval_url: approvalUrl, provider: 'paypal', mode: modeInfo });
}

// ─── Stripe ──────────────────────────────────────────────────────────────────
// Hosted Checkout Session (redirect flow). Stripe's REST API takes
// x-www-form-urlencoded (with bracket notation), not JSON.
async function handleStripe(res, { orderId, amount, currency, tier, name, email, userId, origin, modeInfo }) {
  const secretKey = isTestMode
    ? (process.env.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_SECRET_KEY)
    : process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    return res.status(500).json({ success: false, message: `Stripe credentials not set for ${modeInfo.mode} mode`, code: 'MISSING_CREDENTIAL' });
  }

  const body = new URLSearchParams();
  body.append('mode', 'payment');
  body.append('success_url', `${origin}/profile.html?payment_order_id=${orderId}&provider=stripe&session_id={CHECKOUT_SESSION_ID}`);
  body.append('cancel_url', `${origin}/profile.html`);
  body.append('client_reference_id', orderId);
  body.append('customer_email', email);
  body.append('metadata[order_id]', orderId);
  body.append('metadata[user_id]', String(userId));
  body.append('metadata[plan_tier]', tier);
  body.append('line_items[0][quantity]', '1');
  body.append('line_items[0][price_data][currency]', currency.toLowerCase());
  body.append('line_items[0][price_data][unit_amount]', String(Math.round(amount * 100)));
  body.append('line_items[0][price_data][product_data][name]', `SanjayAIHub ${PLAN_NAMES[tier]} plan (1 month)`);

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Bearer ${secretKey}` },
    body: body.toString(),
  });

  const session = await stripeRes.json();
  if (!stripeRes.ok || !session.url) {
    console.error('[Stripe] create-session error', { status: stripeRes.status, session });
    return res.status(502).json({ success: false, message: 'Stripe checkout session creation failed', stripe_response: session, mode: modeInfo });
  }

  await insertPending({ order_id: orderId, user_id: userId, provider: 'stripe', amount, currency, plan_tier: tier, name, email, provider_order_id: session.id });

  return res.status(200).json({ success: true, order_id: orderId, stripe_checkout_url: session.url, provider: 'stripe', mode: modeInfo });
}

// ─── Provider status checkers (used by both verify-order and the sweep) ─────

async function checkCashfree(payment) {
  const appId = isTestMode ? (process.env.CASHFREE_SANDBOX_APP_ID || process.env.CASHFREE_APP_ID) : process.env.CASHFREE_APP_ID;
  const secretKey = isTestMode ? (process.env.CASHFREE_SANDBOX_SECRET_KEY || process.env.CASHFREE_SECRET_KEY) : process.env.CASHFREE_SECRET_KEY;
  if (!appId || !secretKey) throw new Error('Cashfree credentials missing');

  const cfBase = isTestMode ? 'https://sandbox.cashfree.com/pg' : 'https://api.cashfree.com/pg';
  const res = await fetch(`${cfBase}/orders/${payment.order_id}`, {
    headers: { 'x-api-version': '2023-08-01', 'x-client-id': appId, 'x-client-secret': secretKey },
  });
  const order = await res.json();
  if (!res.ok) throw new Error('Cashfree fetch error: ' + JSON.stringify(order));
  if (order.order_status !== 'PAID') return { paid: false, status: order.order_status };
  return { paid: true, provider_order_id: String(order.cf_order_id || '') };
}

async function checkRazorpay(payment) {
  const keyId = isTestMode ? (process.env.RAZORPAY_TEST_KEY_ID || process.env.RAZORPAY_KEY_ID) : process.env.RAZORPAY_KEY_ID;
  const keySecret = isTestMode ? (process.env.RAZORPAY_TEST_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET) : process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('Razorpay credentials missing');

  const res = await fetch(`https://api.razorpay.com/v1/orders?receipt=${encodeURIComponent(payment.order_id)}&count=1`, {
    headers: { 'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64') },
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Razorpay fetch error: ' + JSON.stringify(data));

  const order = data.items?.[0];
  if (!order || order.status !== 'paid') return { paid: false, status: order?.status || 'not_found' };
  return { paid: true, provider_order_id: order.id };
}

async function checkPaypal(payment) {
  const clientId = isTestMode ? (process.env.PAYPAL_SANDBOX_CLIENT_ID || process.env.PAYPAL_CLIENT_ID) : process.env.PAYPAL_CLIENT_ID;
  const clientSecret = isTestMode ? (process.env.PAYPAL_SANDBOX_CLIENT_SECRET || process.env.PAYPAL_CLIENT_SECRET) : process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('PayPal credentials missing');
  if (!payment.provider_order_id) throw new Error('No PayPal order id stored for this payment');

  const ppBase = isTestMode ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  const tokenRes = await fetch(`${ppBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64') },
    body: 'grant_type=client_credentials',
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) throw new Error('PayPal token fetch failed');

  const authHeader = { 'Authorization': `Bearer ${tokenData.access_token}` };
  const getRes = await fetch(`${ppBase}/v2/checkout/orders/${payment.provider_order_id}`, { headers: authHeader });
  let order = await getRes.json();
  if (!getRes.ok) throw new Error('PayPal order fetch failed: ' + JSON.stringify(order));

  if (order.status === 'APPROVED') {
    const captureRes = await fetch(`${ppBase}/v2/checkout/orders/${payment.provider_order_id}/capture`, {
      method: 'POST', headers: { ...authHeader, 'Content-Type': 'application/json' },
    });
    const captureData = await captureRes.json();
    if (!captureRes.ok) throw new Error('PayPal capture failed: ' + JSON.stringify(captureData));
    order = captureData;
  }

  if (order.status !== 'COMPLETED') return { paid: false, status: order.status || 'not_found' };
  return { paid: true, provider_order_id: order.id };
}

async function checkStripe(payment) {
  const secretKey = isTestMode ? (process.env.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_SECRET_KEY) : process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('Stripe credentials missing');
  if (!payment.provider_order_id) throw new Error('No Stripe session id stored for this payment');

  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${payment.provider_order_id}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  });
  const session = await res.json();
  if (!res.ok) throw new Error('Stripe fetch error: ' + JSON.stringify(session));

  if (session.payment_status !== 'paid') return { paid: false, status: session.payment_status || session.status || 'not_found' };
  return { paid: true, provider_order_id: session.id };
}

async function checkProvider(payment) {
  if (payment.provider === 'razorpay') return checkRazorpay(payment);
  if (payment.provider === 'paypal') return checkPaypal(payment);
  if (payment.provider === 'stripe') return checkStripe(payment);
  return checkCashfree(payment);
}

// ─── Verify Order ─────────────────────────────────────────────────────────────

router.post('/verify-order', authenticateToken, async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ success: false, message: 'Missing order_id' });

  try {
    const payment = await getPaymentByOrderId(order_id);
    if (!payment) return res.status(404).json({ success: false, message: 'Order not found' });
    if (payment.user_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not your order' });

    if (payment.status === 'paid') {
      return res.status(200).json({ success: true, paid: true, status: 'paid', provider: payment.provider, plan_tier: payment.plan_tier });
    }
    if (payment.status === 'failed') {
      return res.status(200).json({ success: true, paid: false, status: 'failed' });
    }

    let result;
    try {
      result = await checkProvider(payment);
    } catch (err) {
      console.error(`[payment/verify-order] provider check error (${payment.provider}):`, err.message);
      return res.status(200).json({ success: true, paid: false, status: 'pending', error: err.message });
    }

    if (!result.paid) {
      return res.status(200).json({ success: true, paid: false, status: result.status || 'pending' });
    }

    await markPaid(order_id, { provider_order_id: result.provider_order_id });
    await upgradeUserTier(payment.user_id, payment.plan_tier);

    console.log(`[payment/verify-order] ${order_id} PAID - user ${payment.user_id} upgraded to ${payment.plan_tier}`);

    return res.status(200).json({ success: true, paid: true, status: 'paid', provider: payment.provider, plan_tier: payment.plan_tier });
  } catch (err) {
    console.error('[payment/verify-order]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Plans endpoint (so the frontend doesn't have to hardcode prices twice) ──

router.get('/plans', (req, res) => {
  res.json({ success: true, plans: PLAN_PRICING, mode: { mode: isTestMode ? 'TEST' : 'PRODUCTION' } });
});

// ─── Sweep: backstop for pending payments, called on an interval from server.js ──
// Mirrors donationalert's Vercel Cron (api/poll-payments.js), but as an
// in-process interval since this app runs as a long-lived Railway service
// rather than serverless functions.

async function sweepPendingPayments() {
  const cutoff = new Date(Date.now() - PENDING_EXPIRY_MS).toISOString();
  const { rows: pending } = await pool.query(
    `SELECT * FROM payments WHERE status = 'pending' AND created_at >= $1`,
    [cutoff]
  );

  for (const payment of pending) {
    try {
      const result = await checkProvider(payment);
      if (result.paid) {
        await markPaid(payment.order_id, { provider_order_id: result.provider_order_id });
        await upgradeUserTier(payment.user_id, payment.plan_tier);
        console.log(`[payment/sweep] ${payment.order_id} PAID - user ${payment.user_id} upgraded to ${payment.plan_tier}`);
      }
    } catch (err) {
      console.error(`[payment/sweep] check failed for ${payment.order_id} (${payment.provider}):`, err.message);
    }
  }

  // Anything older than the expiry window and still pending -> failed
  await pool.query(
    `UPDATE payments SET status = 'failed', updated_at = NOW() WHERE status = 'pending' AND created_at < $1`,
    [cutoff]
  );
}

module.exports = router;
module.exports.sweepPendingPayments = sweepPendingPayments;