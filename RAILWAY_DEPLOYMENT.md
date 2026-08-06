# Railway Deployment Guide for SanjayAIHub

## ✅ Files Added/Modified for Railway Compatibility

1. **Dockerfile** - Container configuration for Railway
2. **package.json** - Added `start` script and Node.js engine version
3. **server.js** - Updated comments for Railway compatibility
4. **.env.example** - Updated with Railway environment variables

## 🔧 Environment Variables to Add in Railway Dashboard

Go to your Railway project → Settings → Variables, and add these:

### Required Variables

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `JWT_SECRET` | Secret key for JWT token signing (use a long random string) | `your-super-secret-jwt-key-here` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:password@host:5432/dbname` |
| `NODE_ENV` | Environment mode | `production` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port (Railway sets this automatically) | `3000` |
| `CODING_AGENT_URL` | URL for coding-agent service | `http://localhost:4001` |

## 📝 Steps to Deploy on Railway

### Option 1: Deploy from GitHub (Recommended)

1. Push your code to a GitHub repository
2. Go to [railway.app](https://railway.app)
3. Click "New Project"
4. Select "Deploy from GitHub repo"
5. Choose your repository
6. Railway will automatically detect the Dockerfile and start building
7. Add the required environment variables (see above)
8. Deploy!

### Option 2: Deploy with Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize new project
railway init

# Link to your project
railway link

# Add environment variables
railway variables set JWT_SECRET=your-secret-key
railway variables set DATABASE_URL=postgres://...
railway variables set NODE_ENV=production

# Deploy
railway up
```

## 🗄️ Setting Up PostgreSQL Database

Railway offers managed PostgreSQL:

1. In your Railway project dashboard, click "New"
2. Select "Database" → "PostgreSQL"
3. Once created, Railway will provide a `DATABASE_URL` variable automatically
4. Copy this URL to your environment variables

Or use an external PostgreSQL provider like Neon:
- Go to [neon.tech](https://neon.tech)
- Create a free database
- Copy the connection string
- Add it as `DATABASE_URL` in Railway

## 🔒 Security Notes

- **Never commit `.env` files** to Git (already in .gitignore)
- Use a strong, random `JWT_SECRET` (at least 32 characters)
- Enable SSL for your PostgreSQL connection (already configured in `db/index.js`)
- Update CORS settings in `server.js` for your production domain

## 🚀 After Deployment

Once deployed, Railway will provide you with a public URL like:
```
https://your-app-name.up.railway.app
```

Your API endpoints will be available at:
- Health check: `https://your-app-name.up.railway.app/api/health`
- Auth: `https://your-app-name.up.railway.app/api/auth/*`
- Modules: `https://your-app-name.up.railway.app/api/modules/*`
- Chat: `https://your-app-name.up.railway.app/api/chat/*`

## ⚠️ Important Notes

- **Railway does NOT spin down apps** (unlike Render free tier), so no auto-pinger is needed
- Railway automatically sets `RAILWAY_STATIC_URL` and `RAILWAY_PUBLIC_DOMAIN` environment variables
- The app will listen on the port provided by Railway via the `PORT` environment variable
- Static files are served from the `/public` directory
- The coding-agent module is mounted at `/agent` path

## 🐛 Troubleshooting

If deployment fails:
1. Check Railway build logs for errors
2. Ensure all dependencies are listed in `package.json`
3. Verify `DATABASE_URL` is correct and accessible
4. Check that `JWT_SECRET` is set

If the app runs but routes fail:
1. Verify database connection in Railway logs
2. Check CORS settings if frontend is on a different domain
3. Ensure all environment variables are properly set
