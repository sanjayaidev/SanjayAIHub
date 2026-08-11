-- Chatbot Maker Configuration Table
CREATE TABLE IF NOT EXISTS chatbot_configs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  system_prompt TEXT NOT NULL,
  business_name VARCHAR(255) DEFAULT 'Business',
  business_color VARCHAR(50) DEFAULT '#00e8a2',
  welcome_message TEXT DEFAULT 'Hello! How can I help you today?',
  placeholder_text VARCHAR(255) DEFAULT 'Type your message...',
  position VARCHAR(50) DEFAULT 'bottom-right',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_chatbot_configs_user_id ON chatbot_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_configs_is_active ON chatbot_configs(is_active);

COMMENT ON TABLE chatbot_configs IS 'Stores chatbot configurations for the Chatbot Maker module';
COMMENT ON COLUMN chatbot_configs.id IS 'Unique identifier for the chatbot configuration';
COMMENT ON COLUMN chatbot_configs.user_id IS 'Reference to the user who owns this configuration';
COMMENT ON COLUMN chatbot_configs.name IS 'Name of the chatbot configuration';
COMMENT ON COLUMN chatbot_configs.system_prompt IS 'System prompt that defines the chatbot behavior';
COMMENT ON COLUMN chatbot_configs.business_name IS 'Business name displayed in the chatbot header';
COMMENT ON COLUMN chatbot_configs.business_color IS 'Primary color for the chatbot UI (hex code)';
COMMENT ON COLUMN chatbot_configs.welcome_message IS 'Initial greeting message shown to visitors';
COMMENT ON COLUMN chatbot_configs.placeholder_text IS 'Placeholder text for the input field';
COMMENT ON COLUMN chatbot_configs.position IS 'Position of chatbot on page (bottom-right or bottom-left)';
COMMENT ON COLUMN chatbot_configs.is_active IS 'Whether this configuration is active';
