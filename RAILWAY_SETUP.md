# Railway Deployment Guide

## ✅ Fixed Issues

### 1. Homepage Route Fixed
- **Problem**: Catch-all route was intercepting API and agent routes
- **Solution**: Moved catch-all route inside `initCodingAgent()` promise and added guards to skip `/api/` and `/agent/` paths

### 2. Coding Agent Route Fixed  
- **Problem**: `/agent` path wasn't accessible
- **Solution**: 
  - Added `/api/config` endpoint that returns the coding agent URL dynamically
  - Fixed route ordering so agent routes are mounted before catch-all
  - Added proper path guards in catch-all middleware

### 3. Railway Compatibility
- Auto-pinger disabled for Railway (only needed for Render)
- Trust proxy enabled for reverse proxy support
- Dynamic URL detection via `req.protocol` and `req.get('host')`

## 🚀 Deployment URLs

Once deployed to Railway at `https://sanjayaihub.up.railway.app`:

| Service | URL |
|---------|-----|
| **Homepage** | `https://sanjayaihub.up.railway.app/` |
| **Coding Agent** | `https://sanjayaihub.up.railway.app/agent` |
| **API Health** | `https://sanjayaihub.up.railway.app/api/health` |
| **Config Endpoint** | `https://sanjayaihub.up.railway.app/api/config` |

## 🔧 Environment Variables (Railway Dashboard)

Go to: **Project → Settings → Variables**

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `JWT_SECRET` | ✅ | Secret for JWT tokens | `your-random-secret-key` |
| `DATABASE_URL` | ✅ | PostgreSQL connection string | `postgres://user:pass@host:5432/dbname` |
| `NODE_ENV` | ✅ | Set to production | `production` |
| `SESSION_SECRET` | ✅ | Session encryption secret | `openssl rand -hex 32` |
| `FRONTEND_URL` | Optional | Your domain (for CORS) | `https://sanjayaihub.up.railway.app` |
| `GITHUB_CLIENT_ID` | ⚠️ | For Coding Agent OAuth | Get from GitHub Developer Settings |
| `GITHUB_CLIENT_SECRET` | ⚠️ | For Coding Agent OAuth | Get from GitHub Developer Settings |
| `APP_BASE_URL` | Optional | Public URL used to build the GitHub OAuth callback link. If unset, it's derived automatically from the incoming request, so this is only needed if that ever gives the wrong host (e.g. behind a non-standard proxy). No trailing slash. | `https://sanjayaihub.up.railway.app` |

## 🔗 GitHub OAuth Setup (for Coding Agent)

1. Go to GitHub → Settings → Developer Settings → OAuth Apps
2. Create new OAuth App
3. **Authorization callback URL**: 
   ```
   https://sanjayaihub.up.railway.app/agent/api/auth/github/callback
   ```
4. Copy Client ID and Client Secret to Railway environment variables

## 📦 Deploy Steps

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Ready for Railway"
   git push origin main
   ```

2. **Create Railway Project**
   - Go to https://railway.app
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository

3. **Add Environment Variables**
   - Click on your project
   - Go to "Settings" tab
   - Scroll to "Variables"
   - Add all required variables from table above

4. **Add PostgreSQL Database**
   - In your project, click "New"
   - Select "Database" → "PostgreSQL"
   - Railway will auto-link it and provide `DATABASE_URL`

5. **Wait for Deployment**
   - Railway will automatically build and deploy
   - Check logs in "Deployments" tab
   - Once green, your app is live!

## ✅ Verification Checklist

After deployment, test these endpoints:

- [ ] `https://your-domain.up.railway.app/` → Shows homepage
- [ ] `https://your-domain.up.railway.app/agent` → Shows coding agent UI
- [ ] `https://your-domain.up.railway.app/api/health` → Returns JSON health status
- [ ] `https://your-domain.up.railway.app/api/config` → Returns config with coding agent URL
- [ ] Click "Coding Agent" card on homepage → Opens agent in new tab
- [ ] GitHub OAuth login works in coding agent

## 🐛 Troubleshooting

### Coding Agent not opening?
- Check Railway logs for "Coding Agent mounted at /agent" message
- Verify `/api/config` endpoint returns correct `codingAgentUrl`
- Check browser console for errors

### Database connection failed?
- Ensure PostgreSQL plugin is added in Railway
- Verify `DATABASE_URL` variable is set correctly
- Check Railway logs for connection details

### GitHub OAuth not working?
- Verify callback URL matches exactly in GitHub OAuth settings
- Check `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set
- Ensure HTTPS is used in callback URL (Railway provides SSL automatically)

## 📝 Notes

- Railway provides automatic HTTPS/SSL
- No need for auto-pinger (Railway doesn't spin down apps)
- Logs are available in Railway dashboard
- Automatic deploys on every git push to main branch
- Free tier includes $5/month usage credit
