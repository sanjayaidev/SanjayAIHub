const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const path = require('path');
const jwt = require('jsonwebtoken');
const { createServer } = require('http');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const moduleRoutes = require('./routes/modules');
const apiKeyRoutes = require('./routes/apikeys');
const chatRoutes = require('./routes/chat');
const reelsRoutes = require('./routes/reels');
const uploadRoutes = require('./routes/upload');
const imageProxyRoutes = require('./routes/image-proxy');
const paymentRoutes = require('./routes/payment');
const mcpRoutes = require('./routes/mcp');

// Import coding-agent as ESM module (dynamic import)
let createCodingAgentApp = null;
const initCodingAgent = async () => {
  try {
    const agentModule = await import('./modules/coding-agent/server/app.js');
    createCodingAgentApp = agentModule.createCodingAgentApp;
    console.log('✅ Coding Agent module loaded successfully');
  } catch (error) {
    console.error('⚠️ Failed to load Coding Agent module:', error.message);
    console.error('   Coding Agent features will be unavailable');
  }
};

const app = express();
const PORT = process.env.PORT || 3000;

// ── Auto Pinger for Render (Task 1) ──────────────────────────────────────
// Uses RENDER_EXTERNAL_URL environment variable to ping the server every 14 minutes
// This prevents Render free tier from spinning down due to inactivity
// Note: Railway does not spin down apps, so this is only needed for Render
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
  console.log('ℹ️ RENDER_EXTERNAL_URL not set - auto-pinger disabled (Railway does not need this)');
}

// ── Trust Proxy (required for rate-limiting behind Render/nginx) ──
app.set('trust proxy', 1);

// ── Security Middleware with relaxed CSP for development ──
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  referrerPolicy: { policy: ["no-referrer", "strict-origin-when-cross-origin"] },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "cdnjs.cloudflare.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "https://checkout.razorpay.com",
        "https://sdk.cashfree.com"
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "cdnjs.cloudflare.com",
        "fonts.googleapis.com"
      ],
      fontSrc: ["'self'", "cdnjs.cloudflare.com", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "picsum.photos", "https://picsum.photos", "i.postimg.cc", "https://i.postimg.cc", "*", "api.allorigins.win", "corsproxy.io"],
      connectSrc: [
        "'self'", 
        "http://localhost:3000",
        "https://graph.instagram.com",
        "https://www.instagram.com",
        "https://instagram.com",
        "https://*.instagram.com",
        "https://api.razorpay.com",
        "https://lumberjack.razorpay.com",
        "https://sdk.cashfree.com",
        "https://api.cashfree.com",
        "https://sandbox.cashfree.com"
      ],
      // Razorpay's checkout widget and Cashfree's drop-in SDK both open their
      // payment UI in an iframe on top of the current page rather than a
      // full redirect, so they need to be allowed as frame sources.
      frameSrc: [
        "'self'",
        "https://api.razorpay.com",
        "https://checkout.razorpay.com",
        "https://sdk.cashfree.com",
        "https://api.cashfree.com",
        "https://sandbox.cashfree.com"
      ],
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

// ── Session Middleware (for coding-agent OAuth) ──
app.use(session({
  name: 'sanjaihub.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// ── Routes ──
app.use('/api/auth', authRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/keys', apiKeyRoutes);
app.use('/api/chat', chatRoutes); // ← ADD THIS (replaces /api/modules/chat routes)
app.use('/api/reels', reelsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/image-proxy', imageProxyRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/mcp', mcpRoutes);

// ── Health Check ──
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'SanjayAIHub API is running',
    timestamp: new Date().toISOString()
  });
});

// ── Config Endpoint (for coding agent URL) ──
app.get('/api/config', (req, res) => {
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;
  
  res.json({
    success: true,
    codingAgentUrl: `${baseUrl}/agent`,
    frontendUrl: process.env.FRONTEND_URL || baseUrl,
    environment: process.env.NODE_ENV || 'development'
  });
});

// ── Start Server & Initialize Coding Agent ──
const httpServer = createServer(app);

// Middleware to pass main app user info to coding-agent
//
// The coding-agent is opened via window.open() as a plain browser
// navigation (see public/js/modules.js -> launchCodingAgent), not a
// fetch/XHR call. That means it can NEVER carry an `Authorization: Bearer`
// header, so `authenticateToken` (and therefore req.user) is never
// populated here — this middleware's old `req.user` check was always
// false, which is why mainUserId never made it into the session and the
// GitHub OAuth callback always logged "No mainUserId in session - skipping
// DB storage".
//
// Fix: launchCodingAgent() now appends the user's JWT as a one-time
// `?token=` query param on the coding-agent URL. We verify it here, stash
// the resulting mainUserId in the (cookie-backed) session, and then
// redirect to the same URL with the token stripped so it doesn't linger
// in the browser's history/URL bar. Once mainUserId is in the session,
// every later request in this tab (including the GitHub OAuth flow) picks
// it up automatically because the session cookie persists.
app.use('/agent', (req, res, next) => {
  if (req.query.token) {
    try {
      const decoded = jwt.verify(req.query.token, process.env.JWT_SECRET);
      req.session.mainUserId = decoded.id;
      console.log('[Middleware] Set mainUserId for coding-agent:', decoded.id);

      // Strip the token from the URL before continuing so it isn't left
      // sitting in the address bar/history. Save the session first so the
      // redirected request is guaranteed to see mainUserId.
      const cleanUrl = req.originalUrl.replace(/([?&])token=[^&]*&?/, '$1').replace(/[?&]$/, '');
      return req.session.save((err) => {
        if (err) console.error('[Middleware] Session save failed:', err);
        res.redirect(cleanUrl);
      });
    } catch (err) {
      console.warn('[Middleware] Invalid or expired token on /agent:', err.message);
      // Fall through without mainUserId rather than blocking access —
      // the coding agent still works standalone, it just won't persist
      // the GitHub connection to the DB for this session.
    }
  } else if (req.user && req.user.id && !req.session.mainUserId) {
    // Kept for any caller that does manage to hit this behind
    // authenticateToken (e.g. a future API-based integration).
    req.session.mainUserId = req.user.id;
    console.log('[Middleware] Set mainUserId for coding-agent:', req.user.id);
  }
  next();
});

// Initialize coding agent and mount it under /agent path
initCodingAgent().then(() => {
  if (createCodingAgentApp) {
    // Mount the coding-agent app under /agent prefix
    const codingAgentApp = createCodingAgentApp(httpServer);
    app.use('/agent', codingAgentApp);
    console.log('🤖 Coding Agent mounted at /agent');
  }
  
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SanjayAIHub Server running on http://localhost:${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔐 JWT expiry: 7 days (remember me) or 1 day`);
    if (createCodingAgentApp) {
      console.log(`👥 Coding Agent available at http://localhost:${PORT}/agent`);
    }
  });

  // ── Payment sweep (backstop for anyone who closes the tab mid-checkout) ──
  const PAYMENT_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
  setInterval(() => {
    paymentRoutes.sweepPendingPayments().catch(err => {
      console.error('[payment/sweep] sweep run failed:', err.message);
    });
  }, PAYMENT_SWEEP_INTERVAL_MS);

  // Add catch-all for SPA routes (must be after all other routes)
  app.get('*', (req, res, next) => {
    // Don't intercept API routes
    if (req.path.startsWith('/api/')) {
      return next();
    }
    // Don't intercept agent routes (handled by coding-agent app)
    if (req.path.startsWith('/agent/')) {
      return next();
    }
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
  });

  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  });
}).catch(err => {
  console.error('❌ Failed to initialize server:', err);
  process.exit(1);
});

module.exports = app;