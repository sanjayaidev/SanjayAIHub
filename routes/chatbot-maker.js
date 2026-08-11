const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const NvidiaProvider = require('../providers/nvidia');

// Fastest NVIDIA model - no auth gating for enterprise users
const CHATBOT_MAKER_MODEL = 'meta/llama-3.2-3b-instruct';

// GET all chatbot configurations for a user
router.get('/configs', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, system_prompt, business_name, business_color, welcome_message, placeholder_text, position, created_at, updated_at
       FROM chatbot_configs
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, configs: result.rows });
  } catch (error) {
    console.error('Get chatbot configs error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch chatbot configurations' });
  }
});

// GET single chatbot configuration
router.get('/configs/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, name, system_prompt, business_name, business_color, welcome_message, placeholder_text, position, created_at, updated_at
       FROM chatbot_configs
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chatbot configuration not found' });
    }
    
    res.json({ success: true, config: result.rows[0] });
  } catch (error) {
    console.error('Get chatbot config error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch chatbot configuration' });
  }
});

// CREATE new chatbot configuration
router.post('/configs', authenticateToken, async (req, res) => {
  try {
    const { name, system_prompt, business_name, business_color, welcome_message, placeholder_text, position } = req.body;

    if (!name || !system_prompt) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name and system prompt are required' 
      });
    }

    const result = await pool.query(
      `INSERT INTO chatbot_configs (user_id, name, system_prompt, business_name, business_color, welcome_message, placeholder_text, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, system_prompt, business_name, business_color, welcome_message, placeholder_text, position, created_at, updated_at`,
      [
        req.user.id,
        name,
        system_prompt,
        business_name || 'Business',
        business_color || '#00e8a2',
        welcome_message || 'Hello! How can I help you today?',
        placeholder_text || 'Type your message...',
        position || 'bottom-right'
      ]
    );

    res.json({ 
      success: true, 
      config: result.rows[0],
      message: 'Chatbot configuration created successfully'
    });
  } catch (error) {
    console.error('Create chatbot config error:', error);
    res.status(500).json({ success: false, message: 'Failed to create chatbot configuration' });
  }
});

// UPDATE chatbot configuration
router.put('/configs/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, system_prompt, business_name, business_color, welcome_message, placeholder_text, position } = req.body;

    // Check ownership
    const checkResult = await pool.query(
      'SELECT id FROM chatbot_configs WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chatbot configuration not found' });
    }

    const result = await pool.query(
      `UPDATE chatbot_configs
       SET name = COALESCE($1, name),
           system_prompt = COALESCE($2, system_prompt),
           business_name = COALESCE($3, business_name),
           business_color = COALESCE($4, business_color),
           welcome_message = COALESCE($5, welcome_message),
           placeholder_text = COALESCE($6, placeholder_text),
           position = COALESCE($7, position),
           updated_at = NOW()
       WHERE id = $8
       RETURNING id, name, system_prompt, business_name, business_color, welcome_message, placeholder_text, position, created_at, updated_at`,
      [
        name,
        system_prompt,
        business_name,
        business_color,
        welcome_message,
        placeholder_text,
        position,
        id
      ]
    );

    res.json({ 
      success: true, 
      config: result.rows[0],
      message: 'Chatbot configuration updated successfully'
    });
  } catch (error) {
    console.error('Update chatbot config error:', error);
    res.status(500).json({ success: false, message: 'Failed to update chatbot configuration' });
  }
});

// DELETE chatbot configuration
router.delete('/configs/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const checkResult = await pool.query(
      'SELECT id FROM chatbot_configs WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chatbot configuration not found' });
    }

    await pool.query('DELETE FROM chatbot_configs WHERE id = $1', [id]);

    res.json({ 
      success: true, 
      message: 'Chatbot configuration deleted successfully'
    });
  } catch (error) {
    console.error('Delete chatbot config error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete chatbot configuration' });
  }
});

// GET embed script for a chatbot (public endpoint - no auth required)
router.get('/embed/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `SELECT id, name, system_prompt, business_name, business_color, welcome_message, placeholder_text, position
       FROM chatbot_configs
       WHERE id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chatbot not found' });
    }

    const config = result.rows[0];

    // Escape a value for safe interpolation into a single-quoted JS string
    // literal inside the generated embed script. Order matters: backslashes
    // must be escaped BEFORE quotes, otherwise a value ending in '\' (e.g.
    // a business name like 'Acme Corp \') swallows the closing quote and
    // breaks the whole script with a syntax error. Newlines are escaped
    // too since these fields can end up multi-line from copy/paste even
    // though the UI only exposes single-line inputs. '</script' is escaped
    // so a value containing it can't prematurely close the embed <script>
    // tag and break (or hijack) the host page's markup.
    const esc = (v) => String(v ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/<\/script/gi, '<\\/script');

    // Generate the embed script
    const embedScript = `
<!-- SanjayAIHub Chatbot -->
<script>
(function() {
  const CHATBOT_CONFIG = {
    id: '${config.id}',
    name: '${esc(config.name)}',
    businessName: '${esc(config.business_name)}',
    businessColor: '${config.business_color}',
    welcomeMessage: '${esc(config.welcome_message)}',
    placeholderText: '${esc(config.placeholder_text) || 'Type your message...'}',
    position: '${config.position || 'bottom-right'}',
    apiEndpoint: '${process.env.API_URL || window.location.origin}/api/chatbot-maker/chat'
  };

  // Create chatbot container
  const chatbotContainer = document.createElement('div');
  chatbotContainer.id = 'sanjai-chatbot-container';
  chatbotContainer.style.cssText = \`
    position: fixed;
    z-index: 999999;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
  \`;

  // Position
  if (CHATBOT_CONFIG.position === 'bottom-left') {
    chatbotContainer.style.bottom = '20px';
    chatbotContainer.style.left = '20px';
  } else {
    chatbotContainer.style.bottom = '20px';
    chatbotContainer.style.right = '20px';
  }

  // Chat button
  const chatButton = document.createElement('button');
  chatButton.id = 'sanjai-chat-button';
  chatButton.innerHTML = '💬';
  chatButton.style.cssText = \`
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: \${CHATBOT_CONFIG.businessColor};
    border: none;
    cursor: pointer;
    font-size: 28px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    transition: transform 0.2s, box-shadow 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  \`;
  chatButton.onmouseover = () => {
    chatButton.style.transform = 'scale(1.1)';
    chatButton.style.boxShadow = '0 6px 24px rgba(0,0,0,0.4)';
  };
  chatButton.onmouseout = () => {
    chatButton.style.transform = 'scale(1)';
    chatButton.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
  };

  // Chat window
  const chatWindow = document.createElement('div');
  chatWindow.id = 'sanjai-chat-window';
  chatWindow.style.cssText = \`
    display: none;
    width: 350px;
    height: 500px;
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.4);
    flex-direction: column;
    overflow: hidden;
    margin-bottom: 10px;
  \`;

  // Header
  const header = document.createElement('div');
  header.style.cssText = \`
    background: \${CHATBOT_CONFIG.businessColor};
    color: white;
    padding: 16px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  \`;
  header.innerHTML = \`
    <div style="display: flex; align-items: center; gap: 10px;">
      <span style="font-size: 20px;">🤖</span>
      <div>
        <div style="font-weight: 600; font-size: 14px;">\${CHATBOT_CONFIG.businessName}</div>
        <div style="font-size: 11px; opacity: 0.9;">Online</div>
      </div>
    </div>
    <button id="sanjai-close-btn" style="background: none; border: none; color: white; font-size: 20px; cursor: pointer; padding: 4px;">✕</button>
  \`;

  // Messages area
  const messagesArea = document.createElement('div');
  messagesArea.id = 'sanjai-messages';
  messagesArea.style.cssText = \`
    flex: 1;
    padding: 16px;
    overflow-y: auto;
    background: #f5f7fa;
    display: flex;
    flex-direction: column;
    gap: 12px;
  \`;

  // Welcome message
  const welcomeMsg = document.createElement('div');
  welcomeMsg.style.cssText = \`
    background: #e9ecef;
    padding: 12px 16px;
    border-radius: 12px;
    max-width: 80%;
    align-self: flex-start;
    font-size: 13px;
    line-height: 1.5;
    color: #333;
  \`;
  welcomeMsg.textContent = CHATBOT_CONFIG.welcomeMessage;
  messagesArea.appendChild(welcomeMsg);

  // Input area
  const inputArea = document.createElement('div');
  inputArea.style.cssText = \`
    padding: 12px 16px;
    background: white;
    border-top: 1px solid #e9ecef;
    display: flex;
    gap: 8px;
  \`;

  const inputField = document.createElement('input');
  inputField.id = 'sanjai-input';
  inputField.type = 'text';
  inputField.placeholder = CHATBOT_CONFIG.placeholderText;
  inputField.style.cssText = \`
    flex: 1;
    padding: 10px 14px;
    border: 1px solid #e9ecef;
    border-radius: 20px;
    font-size: 13px;
    outline: none;
  \`;
  inputField.onfocus = () => inputField.style.borderColor = CHATBOT_CONFIG.businessColor;
  inputField.onblur = () => inputField.style.borderColor = '#e9ecef';

  const sendButton = document.createElement('button');
  sendButton.id = 'sanjai-send-btn';
  sendButton.innerHTML = '➤';
  sendButton.style.cssText = \`
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: \${CHATBOT_CONFIG.businessColor};
    border: none;
    color: white;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s;
  \`;
  sendButton.onmouseover = () => sendButton.style.transform = 'scale(1.1)';
  sendButton.onmouseout = () => sendButton.style.transform = 'scale(1)';

  inputArea.appendChild(inputField);
  inputArea.appendChild(sendButton);
  chatWindow.appendChild(header);
  chatWindow.appendChild(messagesArea);
  chatWindow.appendChild(inputArea);
  chatbotContainer.appendChild(chatWindow);
  chatbotContainer.appendChild(chatButton);
  document.body.appendChild(chatbotContainer);

  // Toggle chat window
  let isOpen = false;
  chatButton.onclick = () => {
    isOpen = !isOpen;
    chatWindow.style.display = isOpen ? 'flex' : 'none';
    if (isOpen) {
      setTimeout(() => inputField.focus(), 100);
    }
  };

  document.getElementById('sanjai-close-btn').onclick = () => {
    isOpen = false;
    chatWindow.style.display = 'none';
  };

  // Send message
  async function sendMessage() {
    const message = inputField.value.trim();
    if (!message) return;

    // Add user message
    const userMsg = document.createElement('div');
    userMsg.style.cssText = \`
      background: \${CHATBOT_CONFIG.businessColor};
      color: white;
      padding: 12px 16px;
      border-radius: 12px;
      max-width: 80%;
      align-self: flex-end;
      font-size: 13px;
      line-height: 1.5;
    \`;
    userMsg.textContent = message;
    messagesArea.appendChild(userMsg);
    
    inputField.value = '';
    messagesArea.scrollTop = messagesArea.scrollHeight;

    // Show typing indicator
    const typingIndicator = document.createElement('div');
    typingIndicator.id = 'sanjai-typing';
    typingIndicator.style.cssText = \`
      background: #e9ecef;
      padding: 12px 16px;
      border-radius: 12px;
      max-width: 80%;
      align-self: flex-start;
      font-size: 13px;
      color: #666;
    \`;
    typingIndicator.textContent = 'Typing...';
    messagesArea.appendChild(typingIndicator);
    messagesArea.scrollTop = messagesArea.scrollHeight;

    try {
      const response = await fetch(CHATBOT_CONFIG.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configId: CHATBOT_CONFIG.id,
          message: message
        })
      });

      const data = await response.json();
      
      // Remove typing indicator
      typingIndicator.remove();

      // Add bot response
      const botMsg = document.createElement('div');
      botMsg.style.cssText = \`
        background: #e9ecef;
        padding: 12px 16px;
        border-radius: 12px;
        max-width: 80%;
        align-self: flex-start;
        font-size: 13px;
        line-height: 1.5;
        color: #333;
      \`;
      botMsg.textContent = data.reply || 'Sorry, I encountered an error.';
      messagesArea.appendChild(botMsg);
      messagesArea.scrollTop = messagesArea.scrollHeight;
    } catch (error) {
      typingIndicator.remove();
      const errorMsg = document.createElement('div');
      errorMsg.style.cssText = \`
        background: #ffebee;
        color: #c62828;
        padding: 12px 16px;
        border-radius: 12px;
        max-width: 80%;
        align-self: flex-start;
        font-size: 13px;
      \`;
      errorMsg.textContent = 'Sorry, something went wrong. Please try again.';
      messagesArea.appendChild(errorMsg);
    }
  }

  sendButton.onclick = sendMessage;
  inputField.onkeypress = (e) => {
    if (e.key === 'Enter') sendMessage();
  };
})();
<\/script>
<!-- End SanjayAIHub Chatbot -->
    `.trim();

    res.setHeader('Content-Type', 'application/javascript');
    res.send(embedScript);
  } catch (error) {
    console.error('Get embed script error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate embed script' });
  }
});

// POST chat message (public endpoint with config ID validation)
router.post('/chat', async (req, res) => {
  try {
    const { configId, message } = req.body;

    if (!configId || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Configuration ID and message are required' 
      });
    }

    // Get chatbot configuration
    const configResult = await pool.query(
      `SELECT system_prompt, business_name
       FROM chatbot_configs
       WHERE id = $1`,
      [configId]
    );

    if (configResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chatbot configuration not found' });
    }

    const config = configResult.rows[0];

    // Call NVIDIA API with fastest model
    const nvidia = new NvidiaProvider(process.env.NVIDIA_API_KEY);
    
    const messages = [
      { role: 'system', content: config.system_prompt },
      { role: 'user', content: message }
    ];

    const data = await nvidia.chatCompletion(messages, { 
      model: CHATBOT_MAKER_MODEL, 
      temperature: 0.7, 
      max_tokens: 512 
    });

    const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not process your request.';

    res.json({ 
      success: true, 
      reply: reply,
      configId: configId
    });
  } catch (error) {
    console.error('Chatbot Maker chat error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to process chat request' 
    });
  }
});

module.exports = router;
