-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. USERS TABLE
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    avatar_url TEXT,
    role VARCHAR(50) DEFAULT 'user', -- 'admin', 'user', 'trial'
    subscription_tier VARCHAR(50) DEFAULT 'trial', -- 'trial', 'basic', 'pro', 'enterprise'
    trial_ends_at TIMESTAMP,
    subscription_ends_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 2. MODULES TABLE (All 16 AI modules)
-- ============================================
CREATE TABLE modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_key VARCHAR(50) UNIQUE NOT NULL, -- 'chatbot', 'text-to-image', 'image-edit', etc.
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    category VARCHAR(50), -- 'chat', 'image', 'video', 'audio', 'writing', 'prompt'
    is_public BOOLEAN DEFAULT FALSE, -- visible to all users
    requires_auth BOOLEAN DEFAULT TRUE,
    access_level VARCHAR(20) DEFAULT 'trial', -- 'trial', 'basic', 'pro', 'enterprise'
    config JSONB DEFAULT '{}'::jsonb, -- module-specific config
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 3. MODULE ACCESS CONTROL (User-specific limits)
-- ============================================
CREATE TABLE user_module_access (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    is_allowed BOOLEAN DEFAULT TRUE,
    usage_limit INT DEFAULT 5, -- trial users get 5 uses
    used_count INT DEFAULT 0,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, module_id)
);

-- ============================================
-- 4. CHAT THREADS (for chatbot module)
-- ============================================
CREATE TABLE chat_threads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) DEFAULT 'New Conversation',
    model VARCHAR(100), -- e.g., 'qwen3.7-max'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 5. CHAT MESSAGES
-- ============================================
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL, -- 'user', 'assistant', 'system'
    content TEXT NOT NULL,
    attachments JSONB DEFAULT '[]'::jsonb, -- [{type: 'image'|'file', url: '...', name: '...'}]
    model_used VARCHAR(100),
    token_count INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 6. GENERATION HISTORY (for all image/video/audio modules)
-- ============================================
CREATE TABLE generation_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    module_key VARCHAR(50) NOT NULL,
    prompt TEXT NOT NULL,
    input_urls JSONB DEFAULT '[]'::jsonb, -- source files
    output_urls JSONB DEFAULT '[]'::jsonb, -- generated outputs
    parameters JSONB DEFAULT '{}'::jsonb, -- model params, settings
    model_used VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    request_id VARCHAR(100), -- for async jobs
    error_message TEXT,
    duration_ms INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- ============================================
-- 7. API KEYS (User's external API keys)
-- ============================================
CREATE TABLE user_api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- 'alibaba', 'cloudflare', 'nvidia', 'elevenlabs', 'pixazo'
    api_key TEXT NOT NULL, -- encrypted
    workspace_id VARCHAR(255), -- for Alibaba
    account_id VARCHAR(255), -- for Cloudflare
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, provider)
);

-- ============================================
-- 8. PROMPT LIBRARY (curated prompts)
-- ============================================
CREATE TABLE prompt_library (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_key VARCHAR(50) NOT NULL,
    headline VARCHAR(255) NOT NULL,
    description TEXT,
    full_prompt TEXT NOT NULL,
    sub_category VARCHAR(100),
    tags TEXT[] DEFAULT '{}',
    media_type VARCHAR(20), -- 'image', 'video'
    demo_url TEXT,
    img TEXT, -- thumbnail/preview image URL for the prompt
    max_images_allowed INT DEFAULT 4,
    views INT DEFAULT 0,
    popularity_score FLOAT DEFAULT 0,
    is_featured BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 9. USER PROMPT FAVORITES
-- ============================================
CREATE TABLE user_prompt_favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt_id UUID NOT NULL REFERENCES prompt_library(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, prompt_id)
);

-- ============================================
-- 10. USAGE STATISTICS (for analytics & limiting)
-- ============================================
CREATE TABLE usage_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE,
    count INT DEFAULT 1,
    total_tokens INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, module_id, date)
);

-- ============================================
-- 11. AUDIT LOGS
-- ============================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    module_key VARCHAR(50),
    details JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_chat_threads_user_id ON chat_threads(user_id);
CREATE INDEX idx_chat_messages_thread_id ON chat_messages(thread_id);
CREATE INDEX idx_generation_history_user_id ON generation_history(user_id);
CREATE INDEX idx_generation_history_module_id ON generation_history(module_id);
CREATE INDEX idx_generation_history_status ON generation_history(status);
CREATE INDEX idx_user_module_access_user_id ON user_module_access(user_id);
CREATE INDEX idx_usage_stats_user_date ON usage_stats(user_id, date);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_prompt_library_module_key ON prompt_library(module_key);
CREATE INDEX idx_prompt_library_is_featured ON prompt_library(is_featured);
CREATE INDEX idx_user_api_keys_user_id ON user_api_keys(user_id);

-- ============================================
-- SEED DATA: Default Modules
-- ============================================
INSERT INTO modules (module_key, name, description, category, is_public, access_level) VALUES
-- Chat & Conversation
('chatbot', 'Simple Chatbots', 'Deploy lightweight conversational agents for FAQs and support', 'chat', true, 'trial'),
('coding-agent', 'Coding Agent', 'AI-powered code writing, debugging, and explanation', 'chat', true, 'trial'),

-- Writing & Content
('social-content', 'Social Content & Resume', 'Generate LinkedIn posts, resumes, and professional emails', 'writing', true, 'trial'),
('message-writer', 'Regional Message Writer', 'Wishes and greetings in 22+ languages', 'writing', true, 'trial'),

-- Image Generation
('text-to-image', 'Text to Image', 'Generate images from text prompts', 'image', true, 'trial'),
('image-edit', 'Image to Image', 'Edit, restyle, or enhance existing images', 'image', true, 'basic'),
('prompt-library', 'Prompt Library', 'Curated prompts with previews', 'prompt', true, 'trial'),

-- Video Generation
('text-to-video', 'Text to Video', 'Generate videos from text descriptions', 'video', true, 'pro'),
('image-to-video', 'Image to Video', 'Animate images into videos', 'video', true, 'pro'),
('video-to-video', 'Video to Video', 'Transform and stylize existing videos', 'video', true, 'enterprise'),

-- Audio
('text-to-speech', 'Text to Speech', 'Natural voice synthesis', 'audio', true, 'trial'),
('voice-clone', 'Voice Cloning', 'Clone voices from audio samples', 'audio', true, 'basic'),
('text-to-music', 'Text to Music', 'Generate music and songs from prompts', 'audio', true, 'pro'),

-- Extras
('design-studio', 'Design Studio', 'Creative toolkit for layout and assets', 'image', false, 'pro'),
('chatbot-maker', 'Chatbot Maker', 'Build chatbots for Insta, FB, WhatsApp', 'chat', false, 'enterprise'),
('mcp-integrator', 'MCP & Extension Integrator', 'Connect external tools and plugins', 'extend', false, 'enterprise');

-- ============================================
-- SEED DATA: Sample Prompts
-- ============================================
INSERT INTO prompt_library (module_key, headline, description, full_prompt, sub_category, tags, media_type, demo_url, is_featured) VALUES
('text-to-image', 'Cyberpunk City at Night', 'A futuristic cityscape with neon lights and flying cars', 'Cyberpunk city at night, neon lights, flying cars, rain, holographic billboards, futuristic architecture, 8k, photorealistic, cinematic lighting, purple and blue color scheme', 'Urban', ARRAY['cyberpunk', 'city', 'neon', 'futuristic'], 'image', 'https://picsum.photos/seed/cyberpunk/800/600', true),
('text-to-image', 'Fantasy Dragon in Mountains', 'A majestic dragon soaring over misty mountain peaks', 'Epic fantasy dragon, soaring over misty mountain peaks, storm clouds, lightning, dramatic lighting, highly detailed, digital art, concept art', 'Fantasy', ARRAY['dragon', 'fantasy', 'mountains', 'epic'], 'image', 'https://picsum.photos/seed/dragon/800/600', true),
('text-to-video', 'Ocean Waves at Sunset', 'Calm ocean waves crashing on a sandy beach at golden hour', 'Ocean waves crashing on beach, sunset, golden hour, warm colors, smooth motion, cinematic, 4k, slow motion, peaceful', 'Nature', ARRAY['ocean', 'waves', 'sunset', 'beach'], 'video', 'https://www.instagram.com/reel/Cx4V_5uP8XU/embed', true),
('image-edit', 'Turn Sketch to Realistic', 'Convert a simple sketch into a photorealistic image', 'Convert this sketch into a photorealistic image, detailed, cinematic lighting, high resolution, 8k, with shadows and reflections', 'Style Transfer', ARRAY['sketch', 'realistic', 'convert', 'style'], 'image', 'https://picsum.photos/seed/sketch/800/600', false),
('image-to-video', 'Animate a Portrait', 'Bring a still portrait to life with subtle animation', 'Animate this portrait: subtle head turn, eye blink, hair movement, natural expressions, smooth animation, 4k, cinematic', 'Portrait', ARRAY['portrait', 'animate', 'face', 'expression'], 'video', 'https://www.instagram.com/reel/Cx4XZ_5P8XU/embed', false),
('video-to-video', 'Stylize Dance Video', 'Transform a dance video into animated style', 'Convert this dance video to anime style, cel-shaded animation, smooth motion, vibrant colors, dynamic camera, 4k', 'Style Transfer', ARRAY['dance', 'anime', 'style', 'transfer'], 'video', 'https://www.instagram.com/reel/Cx4Zr_5P8XU/embed', true);

-- ============================================
-- SEED DATA: Default Admin User (password: admin123)
-- ============================================
-- Note: In production, use a proper password hash
-- INSERT INTO users (id, email, username, password_hash, full_name, role, subscription_tier) 
-- VALUES (uuid_generate_v4(), 'admin@sanjayaihub.com', 'admin', '$2b$10$YourHashedPasswordHere', 'Admin', 'admin', 'enterprise');

-- ============================================
-- VIEWS FOR COMMON QUERIES
-- ============================================

-- View: User module access with limits
CREATE VIEW user_module_access_view AS
SELECT 
    uma.user_id,
    u.username,
    m.module_key,
    m.name AS module_name,
    uma.is_allowed,
    uma.usage_limit,
    uma.used_count,
    (uma.usage_limit - uma.used_count) AS remaining,
    m.access_level AS required_tier,
    u.subscription_tier,
    CASE 
        WHEN u.subscription_tier = 'enterprise' THEN TRUE
        WHEN u.subscription_tier = 'pro' AND m.access_level IN ('trial', 'basic', 'pro') THEN TRUE
        WHEN u.subscription_tier = 'basic' AND m.access_level IN ('trial', 'basic') THEN TRUE
        WHEN u.subscription_tier = 'trial' AND m.access_level = 'trial' AND u.trial_ends_at > NOW() THEN TRUE
        ELSE FALSE
    END AS has_access
FROM user_module_access uma
JOIN users u ON u.id = uma.user_id
JOIN modules m ON m.id = uma.module_id;

-- View: Module usage summary
CREATE VIEW module_usage_summary AS
SELECT 
    u.id AS user_id,
    u.username,
    m.module_key,
    COUNT(gh.id) AS total_generations,
    COUNT(CASE WHEN gh.status = 'completed' THEN 1 END) AS completed,
    COUNT(CASE WHEN gh.status = 'failed' THEN 1 END) AS failed,
    MAX(gh.created_at) AS last_used
FROM users u
CROSS JOIN modules m
LEFT JOIN generation_history gh ON gh.user_id = u.id AND gh.module_id = m.id
WHERE m.is_active = true
GROUP BY u.id, u.username, m.module_key;