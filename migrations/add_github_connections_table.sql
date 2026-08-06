-- ============================================
-- 12. GITHUB CONNECTIONS (Store GitHub OAuth tokens)
-- ============================================
CREATE TABLE IF NOT EXISTS user_github_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    github_user_id VARCHAR(50) UNIQUE NOT NULL,
    github_username VARCHAR(100) NOT NULL,
    github_email VARCHAR(255),
    github_name VARCHAR(255),
    github_avatar_url TEXT,
    access_token TEXT NOT NULL, -- encrypted in production
    token_type VARCHAR(50) DEFAULT 'bearer',
    scope VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    last_synced_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, github_user_id)
);

CREATE INDEX idx_user_github_connections_user_id ON user_github_connections(user_id);
CREATE INDEX idx_user_github_connections_github_user_id ON user_github_connections(github_user_id);
