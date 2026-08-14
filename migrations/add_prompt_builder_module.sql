-- Registers the "Structured Prompt Builder" module so it can go through the
-- standard POST /api/modules/prompt-builder dispatch (auth, and — for the
-- Enhance button — the same shared NVIDIA free-tier key mechanism already
-- used by chatbot/message-writer/social-content).
INSERT INTO modules (module_key, name, description, category, is_public, access_level)
VALUES (
  'prompt-builder',
  'Structured Prompt Builder',
  'Pick a style, add product details, and use AI to enhance each product''s description and visual details',
  'prompt',
  true,
  'trial'
)
ON CONFLICT (module_key) DO NOTHING;
