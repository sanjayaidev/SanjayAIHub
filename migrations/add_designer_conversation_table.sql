-- Design Studio (designer module) chat history.
--
-- routes/designer.js already SELECTs / INSERTs into `designer_conversation`
-- on every /api/designer/generate call and on GET/DELETE
-- /api/designer/conversations — but the table was never added to
-- Tables.sql or any prior migration, so those queries currently fail with
-- "relation \"designer_conversation\" does not exist" as soon as a request
-- carries a conversationId.
--
-- One row per chat turn (user message or assistant reply) in a Design
-- Studio conversation. `conversation_id` is a client-generated string (see
-- public/js/designer-agent.js), not a UUID FK, so it's just indexed rather
-- than referencing another table.

CREATE TABLE IF NOT EXISTS designer_conversation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id VARCHAR(128) NOT NULL,
  role VARCHAR(20) NOT NULL, -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Powers the ORDER BY created_at lookups in POST /generate (fetching the
-- last 10 turns for a conversation) and the DISTINCT conversation_id /
-- MAX(created_at) listing in GET /conversations.
CREATE INDEX IF NOT EXISTS idx_designer_conversation_user_conv
  ON designer_conversation(user_id, conversation_id, created_at);
