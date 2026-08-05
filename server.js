const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const moduleRoutes = require('./routes/modules');
const apiKeyRoutes = require('./routes/apikeys');
const chatRoutes = require('./routes/chat');
const reelsRoutes = require('./routes/reels');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Auto Pinger for Render (Task 1) ──────────────────────────────────────
// Uses RENDER_EXTERNAL_URL environment variable to ping the server every 14 minutes
// This prevents Render free tier from spinning down due to inactivity
if (process.env.RENDER_EXTERNAL_URL) {
  const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
  console.log(`🔄 Auto-pinger enabled for ${EXTERNAL_URL} (every 14 minutes)`);
  
  setInterval(() => {
    fetch(EXTERNAL_URL + '/api/health')
      .then(res => {
        if (res.ok) {
          console.log(`✅ Auto-ping successful at ${new Date().toISOString()}`);
        } else {
          console.warn(`⚠️ Auto-ping returned status ${res.status} at ${new Date().toISOString()}`);
        }
      })
      .catch(err => {
        console.error(`❌ Auto-ping failed: ${err.message} at ${new Date().toISOString()}`);
      });
  }, 14 * 60 * 1000); // 14 minutes in milliseconds
  
  // Initial ping after 5 seconds to verify setup
  setTimeout(() => {
    fetch(EXTERNAL_URL + '/api/health')
      .then(res => res.ok 
        ? console.log(`✅ Initial auto-ping successful`)
        : console.warn(`⚠️ Initial auto-ping returned status ${res.status}`)
      )
      .catch(err => console.error(`❌ Initial auto-ping failed: ${err.message}`));
  }, 5000);
} else {
  console.log('ℹ️ RENDER_EXTERNAL_URL not set - auto-pinger disabled');
}

// ── Security Middleware with relaxed CSP for development ──
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "cdnjs.cloudflare.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net"
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "cdnjs.cloudflare.com",
        "fonts.googleapis.com"
      ],
      fontSrc: ["'self'", "cdnjs.cloudflare.com", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "picsum.photos", "https://picsum.photos"],
      connectSrc: ["'self'", "http://localhost:3000"],
    },
  },
}));

// ── Rate Limiting ──
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    success: false,
    message: 'Too many requests, please try again later.'
  }
});
app.use('/api/', limiter);

// ── CORS ──
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://yourdomain.com']
    : ['http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'],
  credentials: true
}));

// ── Body Parser ──
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// ── Static Files ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ──
app.use('/api/auth', authRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/keys', apiKeyRoutes);
app.use('/api/chat', chatRoutes); // ← ADD THIS (replaces /api/modules/chat routes)
app.use('/api/reels', reelsRoutes);

// ── Health Check ──
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'SanjayAIHub API is running',
    timestamp: new Date().toISOString()
  });
});

// ── Catch-all for SPA ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// ── Error Handler ──
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// ── Start Server ──
app.listen(PORT, () => {
  console.log(`🚀 SanjayAIHub Server running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔐 JWT expiry: 7 days (remember me) or 1 day`);
});

module.exports = app;