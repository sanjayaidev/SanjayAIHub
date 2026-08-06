# GitHub OAuth Connection Fix

## Problem
The redirect URL was working but GitHub was not connecting. This could be due to several issues:

1. **Redirect URI mismatch** - The redirect URI sent to GitHub must exactly match what's registered in your GitHub OAuth App settings
2. **Session state loss** - In-memory sessions are lost on server restart (common on Railway/Render)
3. **Missing environment variables** - GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET not properly configured
4. **Database not storing GitHub user info** - No columns in the users table for GitHub OAuth data

## Changes Made

### 1. Enhanced Logging (for debugging)
- Added detailed console logging in `/modules/coding-agent/server/routes/auth.js`
- Added detailed console logging in `/modules/coding-agent/server/lib/github.js`
- Logs now show:
  - OAuth flow start with session ID
  - Generated state token
  - Redirect URI being used
  - Callback parameters received
  - Token exchange request/response
  - User info fetch status

### 2. Database Migration
Created `/migrations/add_github_oauth_support.sql` to add GitHub-related columns to the users table:
- `github_login` - GitHub username
- `github_token` - GitHub OAuth access token (encrypted in production)
- `github_avatar_url` - User's GitHub avatar
- `github_email` - Email from GitHub
- `last_github_login_at` - Timestamp of last GitHub login

Run this migration:
```bash
psql $DATABASE_URL -f migrations/add_github_oauth_support.sql
```

### 3. Key Configuration Requirements

#### GitHub OAuth App Settings
In your GitHub Developer Settings → OAuth Apps:
- **Authorization callback URL**: Must be exactly `https://your-domain.com/agent/api/auth/github/callback`
- For local development: `http://localhost:3000/agent/api/auth/github/callback`

#### Environment Variables
Ensure these are set in your `.env` or platform environment:
```
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
SESSION_SECRET=a_long_random_secret_string
APP_BASE_URL=https://your-domain.com  # Optional but recommended for production
```

#### Common Issues & Solutions

1. **"Invalid OAuth state" error**
   - Cause: Session was lost between authorize and callback
   - Solution: Use a persistent session store (Redis/PostgreSQL) instead of in-memory
   
2. **"redirect_uri_mismatch" error**
   - Cause: Redirect URI doesn't exactly match GitHub's records
   - Solution: Check for trailing slashes, http vs https, exact path match

3. **Token exchange fails silently**
   - Cause: Missing GITHUB_CLIENT_SECRET
   - Solution: Verify all env vars are set correctly

4. **Works locally but not in production**
   - Cause: Different domains, missing APP_BASE_URL
   - Solution: Set APP_BASE_URL to your production domain

## Testing the Fix

1. Start the server
2. Navigate to `/agent/api/auth/github`
3. Check server logs for:
   ```
   [Auth] Starting OAuth flow
   [Auth] Generated state: <hex_string>
   [Auth] Session ID: <session_id>
   [Auth] getRedirectUri returning: https://your-domain.com/agent/api/auth/github/callback
   ```
4. Authorize on GitHub
5. On callback, check logs for:
   ```
   [Auth] Callback received
   [Auth] Code present: true
   [Auth] State from query: <state>
   [Auth] State from session: <state>
   [GitHub OAuth] Exchanging code for token...
   [GitHub OAuth] Response status: 200
   [GitHub OAuth] Token received, fetching user info
   [Auth] User info received: <username>
   ```

## Next Steps (Optional Improvements)

1. **Persistent Sessions**: Replace in-memory session store with PostgreSQL or Redis
2. **Token Encryption**: Encrypt GitHub tokens before storing in database
3. **Token Refresh**: Implement token refresh logic if needed
4. **User Linking**: Link GitHub accounts to existing user accounts by email
