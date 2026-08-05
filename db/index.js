const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Neon
  }
});

// Test connection on startup. This is diagnostic only — we log and keep
// the server running rather than process.exit(1), because a transient DB
// hiccup (or DB not being up yet) shouldn't take down routes that don't
// need it (static assets, /api/health, /api/upload, /api/config). Routes
// that do need the DB will surface their own errors per-query as usual.
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('   Server will keep running, but DB-backed routes (auth, modules, etc.) will fail until this is resolved.');
    return;
  }
  console.log('✅ Connected to Neon PostgreSQL');
  release();
});

pool.on('error', (err) => {
  // Catches errors on idle clients in the pool (e.g. connection dropped)
  // so a background pool error can't crash the whole process either.
  console.error('❌ Unexpected PostgreSQL pool error:', err.message);
});

module.exports = pool;