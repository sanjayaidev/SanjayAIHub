-- The Structured Prompt Builder was replaced by a simpler "Prompt Rewriter"
-- flow (paste a reference prompt, pick a max duration, add products +
-- branding, regenerate). Same module_key ('prompt-builder'), so no dispatch
-- changes needed — this just updates the display copy for deployments where
-- the original migrations/add_prompt_builder_module.sql row already exists
-- (its ON CONFLICT DO NOTHING would otherwise leave the old copy in place).
UPDATE modules
SET
  name = 'Prompt Rewriter',
  description = 'Paste any AI video prompt, set a max duration, add your products and branding, and let AI rewrite the whole thing for you'
WHERE module_key = 'prompt-builder';
