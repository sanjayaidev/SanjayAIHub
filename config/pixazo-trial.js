// config/pixazo-trial.js
// Shared config for the app-wide shared Pixazo trial key. Centralized here
// so routes/auth.js (which reports trial status to the client on
// login/verify/me) and routes/modules.js (which actually spends it) agree
// on the same limit and enabled/disabled state.
//
// Leave PIXAZO_FREE_TIER_API_KEY unset in .env to disable this feature
// entirely — trial-tier users then behave exactly as before (blocked by
// tier / missing-key errors on these modules).

const API_KEY = process.env.PIXAZO_FREE_TIER_API_KEY || '';
const ENABLED = !!API_KEY;
const LIMIT = parseInt(process.env.PIXAZO_TRIAL_LIMIT || '20', 10);

// Every module capable of running on Pixazo. Trial-tier users can reach
// these (even the pro/enterprise-gated ones) for the duration of the trial
// window using the shared key.
const MODULES = [
  'text-to-image',
  'text-to-video',
  'image-to-video',
  'video-to-video',
  'text-to-music',
];

module.exports = { API_KEY, ENABLED, LIMIT, MODULES };