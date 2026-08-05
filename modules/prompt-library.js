const pool = require('../db');

// Extract an Instagram shortcode from any post/reel/tv URL (with or
// without a trailing /embed, and with or without a username segment).
// Returns null for non-Instagram demo_urls (e.g. picsum.photos images).
function extractInstagramShortcode(url) {
  if (!url) return null;
  const match = url.match(/instagram\.com\/(?:[^/?]+\/)?(?:reel|p|tv)\/([^/?]+)/);
  return match ? match[1] : null;
}

// ──────────────────────────────────────────────
// List prompts, with optional filters. Public — no auth required.
// filters: { moduleKey, subCategory, search, sort }
// ──────────────────────────────────────────────
async function listPrompts(filters = {}) {
  const { moduleKey, subCategory, search, sort } = filters;

  const conditions = ['is_active = true'];
  const params = [];

  if (moduleKey && moduleKey !== 'all') {
    params.push(moduleKey);
    conditions.push(`module_key = $${params.length}`);
  }
  if (subCategory) {
    params.push(subCategory);
    conditions.push(`sub_category = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(headline ILIKE $${params.length} OR description ILIKE $${params.length} OR full_prompt ILIKE $${params.length})`
    );
  }

  let orderBy = 'created_at DESC';
  if (sort === 'popular') orderBy = 'popularity_score DESC, views DESC';
  else if (sort === 'views') orderBy = 'views DESC';

  const query = `
    SELECT id, module_key, headline, description, full_prompt, sub_category, tags,
           media_type, demo_url, max_images_allowed, views, popularity_score,
           is_featured, created_at
    FROM prompt_library
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderBy}
  `;

  const result = await pool.query(query, params);
  return result.rows.map((row) => ({
    ...row,
    instagram_shortcode: extractInstagramShortcode(row.demo_url),
  }));
}

async function incrementView(promptId) {
  await pool.query('UPDATE prompt_library SET views = views + 1 WHERE id = $1', [promptId]);
}

async function getFavoriteIds(userId) {
  const result = await pool.query('SELECT prompt_id FROM user_prompt_favorites WHERE user_id = $1', [userId]);
  return result.rows.map((r) => r.prompt_id);
}

async function toggleFavorite(userId, promptId) {
  const existing = await pool.query(
    'SELECT id FROM user_prompt_favorites WHERE user_id = $1 AND prompt_id = $2',
    [userId, promptId]
  );

  if (existing.rows.length > 0) {
    await pool.query('DELETE FROM user_prompt_favorites WHERE user_id = $1 AND prompt_id = $2', [userId, promptId]);
    return { favorited: false };
  }

  await pool.query('INSERT INTO user_prompt_favorites (user_id, prompt_id) VALUES ($1, $2)', [userId, promptId]);
  return { favorited: true };
}

module.exports = {
  listPrompts,
  incrementView,
  getFavoriteIds,
  toggleFavorite,
  extractInstagramShortcode,
};
