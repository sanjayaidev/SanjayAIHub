# Login Gating + Google/GitHub Sign-In

## What changed

1. **Email-provider gating for password signup/login**
   - `POST /api/auth/register` and `PUT /api/auth/me` now reject any email
     whose domain isn't Gmail, Yahoo, or Rediffmail (see the allow-list in
     `config/allowed-email-domains.js`), and give a specific error for
     known disposable/temp-mail domains.
   - This only applies to password-based signup. Google/GitHub sign-in
     are exempt because the provider has already verified that identity.

2. **Google Sign-In** — `GET /api/auth/google` → `GET /api/auth/google/callback`
3. **GitHub Sign-In** — `GET /api/auth/github` → `GET /api/auth/github/callback`
   - Separate from (and unrelated to) the coding-agent's existing
     "Connect GitHub" feature at `/agent/api/auth/github`, which links a
     GitHub account for repo access. This is for logging into
     SanjayAIHub itself, and reuses the same GitHub OAuth App/credentials.
4. `public/login.html`'s Google/GitHub buttons now trigger real
   sign-in instead of "coming soon" toasts.

## 1. Run the DB migration

```bash
psql $DATABASE_URL < migrations/add_oauth_login_columns.sql
```

This makes `password_hash` nullable (OAuth accounts don't have one) and
adds `auth_provider`, `google_id`, `github_id`, `email_verified`.

## 2. Environment variables

Add to `.env` / Railway variables (see updated `.env.example`):

```env
SESSION_SECRET=<long random string>
APP_BASE_URL=https://sanjayaihub.up.railway.app   # no trailing slash

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

GITHUB_CLIENT_ID=Ov23lieIhYFjjF6DfU35   # same OAuth App as the coding agent
GITHUB_CLIENT_SECRET=
```

### Google
1. https://console.cloud.google.com/apis/credentials → **Create Credentials
   → OAuth client ID → Web application**.
2. Authorized redirect URI: `{APP_BASE_URL}/api/auth/google/callback`
   (e.g. `https://sanjayaihub.up.railway.app/api/auth/google/callback`).
3. Copy the Client ID/Secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

### GitHub
The coding-agent module already uses a GitHub OAuth App
(`GITHUB_CLIENT_ID=Ov23lieIhYFjjF6DfU35`, per `GITHUB_CONNECTION_SETUP.md`).
This reuses the same app for the main login — you just need to register a
**second** callback URL on it:

1. https://github.com/settings/developers → your OAuth App.
2. Under **Authorization callback URL**, add
   `{APP_BASE_URL}/api/auth/github/callback` (GitHub OAuth Apps support
   multiple callback URLs — add this one alongside the existing
   `.../agent/api/auth/github/callback`).
3. Make sure `GITHUB_CLIENT_SECRET` is set (same one already used by the
   coding agent).

If you'd rather keep the two flows on fully separate OAuth Apps, just
create a second GitHub OAuth App and point `GITHUB_CLIENT_ID`/`SECRET` at
that one instead — the code doesn't assume they're shared.

## 3. How accounts link up

- First-time Google/GitHub sign-in with a brand-new email → creates a new
  account (auto-generated unique username, no password, 7-day trial +
  default free modules, same as normal registration).
- Signing in with Google/GitHub using an email that already has a
  password account → links the provider to that existing account (no
  duplicate accounts).
- Signing in again with the same provider → logs into the linked account.
- If someone who signed up via Google/GitHub tries the password login
  form, they get a clear message to use that provider instead (there's no
  password to check against).

## 4. Testing locally without real OAuth apps

You can still test the email-domain gating without touching Google/GitHub
at all — just try `POST /api/auth/register` with a `@mailinator.com` or
`@outlook.com` address and confirm you get a 400 with an explanatory
message, and with a `@gmail.com` / `@yahoo.com` / `@rediffmail.com`
address and confirm it succeeds.
