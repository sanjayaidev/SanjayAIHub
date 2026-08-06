# GitHub OAuth Connection - Database Storage Setup

## Overview
This implementation stores GitHub OAuth tokens in the database so that:
1. Users can see their connection status when they access the agent module
2. Tokens persist across server restarts
3. The connection is linked to the main app user account

## Changes Made

### 1. Database Migration
Run this SQL migration to create the `user_github_connections` table:

```bash
psql $DATABASE_URL < migrations/add_github_connections_table.sql
```

Or manually execute the SQL in `/workspace/migrations/add_github_connections_table.sql`

### 2. Server Changes (server.js)
- Added `express-session` middleware to share sessions between main app and coding-agent
- Added middleware to pass authenticated user's ID (`mainUserId`) to coding-agent session
- Sessions now persist for 7 days with secure cookies in production

### 3. Coding Agent Auth Changes (modules/coding-agent/server/routes/auth.js)
- **OAuth Callback**: Now stores GitHub token, username, email, avatar in `user_github_connections` table
- **GET /me endpoint**: Returns connection status from database, not just session
- **Logging**: Enhanced logging to track `mainUserId` flow

## How It Works

### OAuth Flow:
1. User logs into main app → JWT token stored client-side
2. User accesses `/agent` → Middleware extracts user ID from JWT and stores in session as `mainUserId`
3. User clicks "Connect GitHub" → OAuth flow starts, `mainUserId` preserved in session
4. GitHub callback → Token stored in DB linked to `mainUserId`
5. User refreshes page → `/api/auth/me` loads connection status from DB

### API Endpoints:

#### GET `/agent/api/auth/me`
Returns current GitHub connection status:
```json
{
  "user": {
    "login": "username",
    "name": "User Name",
    "avatarUrl": "https://...",
    "email": "user@example.com"
  },
  "connected": true,
  "connection": {
    "username": "username",
    "name": "User Name",
    "avatarUrl": "https://...",
    "scope": "repo read:user user:email",
    "lastSyncedAt": "2025-01-15T10:30:00.000Z"
  }
}
```

## Frontend Integration

To show connection status in the UI:

```javascript
// Fetch connection status when loading agent module
async function loadGitHubConnection() {
  const response = await fetch('/agent/api/auth/me', {
    credentials: 'include' // Important: send session cookie
  });
  
  if (response.ok) {
    const data = await response.json();
    
    if (data.connected) {
      // Show connected state
      document.getElementById('github-status').textContent = 
        `Connected as ${data.connection.username}`;
      document.getElementById('connect-btn').style.display = 'none';
      document.getElementById('disconnect-btn').style.display = 'block';
    } else {
      // Show connect button
      document.getElementById('github-status').textContent = 'Not connected';
      document.getElementById('connect-btn').style.display = 'block';
      document.getElementById('disconnect-btn').style.display = 'none';
    }
  }
}
```

## Environment Variables Required

Ensure these are set in your `.env` or Railway environment:

```env
# Session secret (generate a strong random string)
SESSION_SECRET=your-super-secret-session-key-change-me

# GitHub OAuth credentials
GITHUB_CLIENT_ID=Ov23lieIhYFjjF6DfU35
GITHUB_CLIENT_SECRET=your-github-client-secret

# App base URL (for OAuth redirect)
APP_BASE_URL=https://sanjayaihub.up.railway.app
```

## Troubleshooting

### "No mainUserId in session" warnings
- Ensure user is logged into main app before accessing agent module
- Check that session middleware is properly configured
- Verify cookies are being sent (check browser dev tools)

### OAuth state mismatch
- Sessions may be lost if server restarts (using in-memory store)
- For production, consider using Redis or PostgreSQL session store
- Ensure `SESSION_SECRET` is consistent across deployments

### Connection not showing
1. Check browser console for errors
2. Verify network tab shows successful `/agent/api/auth/me` request
3. Check server logs for DB storage confirmation
4. Query DB directly: `SELECT * FROM user_github_connections WHERE user_id = 'your-user-id'`
