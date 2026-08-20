const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Authentication required' 
    });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        message: 'Invalid or expired token' 
      });
    }
    req.user = decoded;
    next();
  });
}

// Single source of truth for tier ordering — every route that needs to
// compare a user's tier against a required tier should import TIER_ORDER
// or getTierLevel from here rather than redeclaring this map locally.
const TIER_ORDER = { trial: 0, basic: 1, pro: 2, enterprise: 3 };

function getTierLevel(tier) {
  return TIER_ORDER[tier] || 0;
}

// Like authenticateToken, but never rejects the request. If a valid
// Bearer token is present, req.user is populated exactly as before; if
// it's missing, empty, or invalid, req.user is simply left undefined and
// the request continues as a guest. Routes that want to offer free/guest
// access (e.g. the chatbot and prompt-builder modules) use this instead of
// authenticateToken and then branch on `req.user` themselves.
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (!err) {
      req.user = decoded;
    }
    // Invalid/expired token from a guest session just falls back to
    // guest access rather than hard-failing the request.
    next();
  });
}

// Optional: check if user has required tier
function requireTier(minTier) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }
    
    const userTier = req.user.subscription_tier || 'trial';
    if (getTierLevel(userTier) < getTierLevel(minTier)) {
      return res.status(403).json({ 
        success: false, 
        message: `This feature requires ${minTier} tier or higher` 
      });
    }
    next();
  };
}

module.exports = { authenticateToken, optionalAuth, requireTier, TIER_ORDER, getTierLevel };