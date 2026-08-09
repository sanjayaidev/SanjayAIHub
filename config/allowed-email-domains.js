// ──────────────────────────────────────────────────────────────
// Email domain gating for password-based ("normal") signup/login.
//
// Requirement: only accounts on well-known, verified consumer email
// providers may register/login with email+password. Google and GitHub
// OAuth sign-in are exempt from this list because the provider itself
// has already verified the identity (see routes/auth.js).
//
// This is an ALLOW-LIST (safer than a disposable-domain blocklist,
// which can never be complete). The DISPOSABLE_EMAIL_DOMAINS set below
// is kept only as defense-in-depth / for clearer error messaging if
// this allow-list is ever widened later.
// ──────────────────────────────────────────────────────────────

const ALLOWED_EMAIL_DOMAINS = new Set([
  // Gmail
  'gmail.com',
  'googlemail.com',
  // Yahoo
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.co.uk',
  'yahoo.in',
  'yahoo.ca',
  'yahoo.com.au',
  'ymail.com',
  'rocketmail.com',
  // Rediff
  'rediffmail.com',
  'rediff.com',
]);

// Common disposable/temp-mail domains. Not exhaustive — the allow-list
// above is what actually enforces the policy — but kept so a blocked
// signup gets a clear "that's a temp-mail domain" message instead of a
// generic "not on our list" one.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com', '10minutemail.net', 'guerrillamail.com', 'guerrillamail.info',
  'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz', 'sharklasers.com',
  'mailinator.com', 'mailinator.net', 'mailinator.org', 'tempmail.com', 'temp-mail.org',
  'temp-mail.io', 'tempail.com', 'throwawaymail.com', 'yopmail.com', 'yopmail.net',
  'yopmail.fr', 'trashmail.com', 'trashmail.net', 'getnada.com', 'dispostable.com',
  'mintemail.com', 'fakeinbox.com', 'maildrop.cc', 'mohmal.com', 'moakt.com',
  'emailondeck.com', 'mailnesia.com', '33mail.com', 'spamgourmet.com', 'mytemp.email',
  'discard.email', 'tempinbox.com', 'mailcatch.com', 'anonaddy.com', 'inboxbear.com',
  'crazymailing.com', 'harakirimail.com', 'burnermail.io', 'tmpmail.net', 'tmpmail.org',
  'tmail.ws', 'mail-temp.com', 'emailfake.com', 'fakemail.net', 'mailsac.com',
  'incognitomail.com', 'nowmymail.com', 'spambog.com', 'spamex.com', 'mailnull.com',
]);

function extractDomain(email) {
  const value = String(email || '').trim().toLowerCase();
  const atIndex = value.lastIndexOf('@');
  if (atIndex === -1 || atIndex === value.length - 1) return null;
  return value.slice(atIndex + 1);
}

/**
 * Validates that an email address belongs to a supported, verified
 * consumer email provider. Intended for password-based ("normal")
 * registration/login only — OAuth-provided emails (Google/GitHub) skip
 * this check because the provider already verified them.
 *
 * @returns {{ allowed: boolean, reason?: string }}
 */
function validateEmailDomain(email) {
  const domain = extractDomain(email);

  if (!domain) {
    return { allowed: false, reason: 'Please enter a valid email address.' };
  }

  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    return {
      allowed: false,
      reason: 'Temporary/disposable email addresses are not allowed. Please use a Gmail, Yahoo, or Rediffmail address.',
    };
  }

  if (!ALLOWED_EMAIL_DOMAINS.has(domain)) {
    return {
      allowed: false,
      reason: 'Only Gmail, Yahoo, or Rediffmail addresses are accepted for email sign-up. You can also continue with Google or GitHub.',
    };
  }

  return { allowed: true };
}

module.exports = {
  ALLOWED_EMAIL_DOMAINS,
  DISPOSABLE_EMAIL_DOMAINS,
  validateEmailDomain,
};
