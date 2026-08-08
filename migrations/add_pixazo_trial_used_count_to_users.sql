-- ============================================
-- ADD pixazo_trial_used_count TO USERS
-- ============================================
-- Backs the shared Pixazo free-trial feature (config/pixazo-trial.js).
-- routes/auth.js and routes/modules.js already SELECT / UPDATE / RETURN
-- this column on registration, login, /me, module listing, and module
-- execution — but it was never added to the users table in Tables.sql or
-- any prior migration, so every one of those queries fails with
-- "column \"pixazo_trial_used_count\" does not exist" until this runs.
--
-- Tracks total Pixazo-backed generations (text-to-image, text-to-video,
-- image-to-video, video-to-video, text-to-music) a trial-tier user has
-- made using the app's shared PIXAZO_FREE_TIER_API_KEY, capped by
-- PIXAZO_TRIAL_LIMIT (see config/pixazo-trial.js). Safe to run multiple
-- times.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS pixazo_trial_used_count INT DEFAULT 0;
