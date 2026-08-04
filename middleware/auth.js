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

// Optional: check if user has required tier
function requireTier(minTier) {
  const tierOrder = { trial: 0, basic: 1, pro: 2, enterprise: 3 };
  
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required' 
      });
    }
    
    const userTier = req.user.subscription_tier || 'trial';
    if (tierOrder[userTier] < tierOrder[minTier]) {
      return res.status(403).json({ 
        success: false, 
        message: `This feature requires ${minTier} tier or higher` 
      });
    }
    next();
  };
}

module.exports = { authenticateToken, requireTier };