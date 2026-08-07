-- ============================================
-- PAYMENTS TABLE (Razorpay / Cashfree / PayPal / Stripe)
-- ============================================
-- Mirrors the pending → paid/failed flow used in sanjayaidev/donationalert,
-- adapted from Supabase REST calls to plain Postgres (this app's `pg` pool).
-- One row per checkout attempt. `plan_tier` uses the same internal keys as
-- users.subscription_tier ('basic' | 'pro' | 'enterprise') — 'pro' is
-- displayed to users as "Premium" (see public/profile.html TIER_LABELS).

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(100) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(30) NOT NULL,           -- 'razorpay' | 'cashfree' | 'paypal' | 'stripe'
    provider_order_id VARCHAR(255),          -- provider's own order/session id, once known
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'paid' | 'failed'
    plan_tier VARCHAR(50) NOT NULL,          -- 'basic' | 'pro' | 'enterprise'
    amount NUMERIC(10,2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);