-- Backs the "Rewrite Prompt" mode of the Structured Prompt Builder module
-- (modules/prompt-builder.js: listRewriteCategories / listRewriteTemplates /
-- getRewriteTemplateById). This file was referenced in code comments but
-- had never actually been committed, so the table has never existed —
-- GET /api/modules/prompt-builder/rewrite-categories and
-- /rewrite-templates were silently failing (500) on every environment and
-- the frontend was permanently falling back to its hardcoded mock
-- templates (see REWRITE_MOCK_TEMPLATES in public/prompt-builder.js).
--
-- Run this migration, then insert real reference-prompt rows (one per
-- category/style) to replace the mock data.

CREATE TABLE IF NOT EXISTS prompt_rewrite_templates (
  id          SERIAL PRIMARY KEY,
  category    VARCHAR(100) NOT NULL,
  name        VARCHAR(200) NOT NULL,
  duration    VARCHAR(50),
  prompt      TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_rewrite_templates_category
  ON prompt_rewrite_templates (category)
  WHERE is_active = true;
