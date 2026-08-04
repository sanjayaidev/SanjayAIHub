const pool = require('../db');

async function checkModuleAccess(userId, moduleKey) {
  const result = await pool.query(
    `SELECT 
       m.id,
       m.module_key,
       m.access_level AS required_tier,
       uma.is_allowed,
       uma.usage_limit,
       uma.used_count
     FROM modules m
     LEFT JOIN user_module_access uma 
       ON uma.module_id = m.id AND uma.user_id = $1
     WHERE m.module_key = $2`,
    [userId, moduleKey]
  );

  if (result.rows.length === 0) {
    return { hasAccess: false, message: 'Module not found' };
  }

  const module = result.rows[0];
  const tierOrder = { trial: 0, basic: 1, pro: 2, enterprise: 3 };
  
  // For demo: chatbot and prompt-library are always free
  const isFree = moduleKey === 'chatbot' || moduleKey === 'prompt-library';
  
  // Get user tier from session (passed through)
  // This would be checked in the route handler
  return {
    hasAccess: true,
    module,
    isFree
  };
}

async function trackUsage(userId, moduleId) {
  await pool.query(
    `UPDATE user_module_access 
     SET used_count = used_count + 1, 
         last_used_at = NOW()
     WHERE user_id = $1 AND module_id = $2`,
    [userId, moduleId]
  );
}

module.exports = { checkModuleAccess, trackUsage };