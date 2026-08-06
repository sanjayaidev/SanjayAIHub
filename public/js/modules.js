// ──────────────────────────────────────────────
// MODULE ACCESS CONTROL
// ──────────────────────────────────────────────

const MODULES = {
  // Define all modules with their tier requirements
  // 'trial' = free for trial users, 'basic' = basic tier required, etc.
  definitions: {
    'chatbot': { tier: 'trial', icon: '💬', name: 'Simple Chatbots', free: true },
    'coding-agent': { tier: 'trial', icon: '💻', name: 'Coding Agent', free: false },
    'social-content': { tier: 'trial', icon: '✍️', name: 'Social Content & Resume', free: false },
    'message-writer': { tier: 'trial', icon: '🌍', name: 'Wish with Multilanguage', free: false },
    'prompt-library': { tier: 'trial', icon: '📚', name: 'Prompt Library', free: true },
    'text-to-image': { tier: 'trial', icon: '🖼️', name: 'Text to Image', free: false },
    'image-edit': { tier: 'basic', icon: '🎨', name: 'Image to Image', free: false },
    'voice-clone': { tier: 'basic', icon: '🗣️', name: 'Voice Cloning', free: false },
    'text-to-video': { tier: 'pro', icon: '🎬', name: 'Text to Video', free: false },
    'image-to-video': { tier: 'pro', icon: '📹', name: 'Image to Video', free: false },
    'video-to-video': { tier: 'enterprise', icon: '🎞️', name: 'Video to Video', free: false },
    'text-to-speech': { tier: 'trial', icon: '🔊', name: 'Text to Audio (TTS)', free: false },
    'text-to-music': { tier: 'pro', icon: '🎵', name: 'Text to Song', free: false },
    'design-studio': { tier: 'pro', icon: '🎯', name: 'Design Studio', free: false },
    'chatbot-maker': { tier: 'enterprise', icon: '🤖', name: 'Chatbot Maker', free: false },
    'mcp-integrator': { tier: 'enterprise', icon: '🔌', name: 'MCP & Extension Integrator', free: false }
  },
  
  // Tier hierarchy
  tierLevels: { trial: 0, basic: 1, pro: 2, enterprise: 3 },
  
  // Get user's tier
  getUserTier() {
    const user = AUTH.getUser();
    return user?.subscription_tier || 'trial';
  },
  
  // Check if user has access to a module
  hasAccess(moduleKey) {
    const userTier = this.getUserTier();
    const module = this.definitions[moduleKey];
    
    if (!module) return false;
    
    // Always free modules (chatbot + prompt-library)
    if (module.free) return true;
    
    // If not logged in, only free modules
    if (!AUTH.isLoggedIn()) return module.free;
    
    // Check tier
    const userLevel = this.tierLevels[userTier] || 0;
    const requiredLevel = this.tierLevels[module.tier] || 0;
    
    return userLevel >= requiredLevel;
  },
  
  // Get all modules with access status
  getAllModules() {
    const result = {};
    for (const [key, def] of Object.entries(this.definitions)) {
      result[key] = {
        ...def,
        hasAccess: this.hasAccess(key),
        isLoggedIn: AUTH.isLoggedIn()
      };
    }
    return result;
  },
  
  // Handle module click - show login if needed
  handleModuleClick(moduleKey, event) {
    const module = this.definitions[moduleKey];
    if (!module) return;
    
    // If module is free, allow access
    if (module.free) {
      this.navigateToModule(moduleKey);
      return;
    }
    
    // Check if user has access
    if (this.hasAccess(moduleKey)) {
      this.navigateToModule(moduleKey);
      return;
    }
    
    // No access - show login modal or redirect
    if (!AUTH.isLoggedIn()) {
      this.showLoginRequired(moduleKey);
    } else {
      this.showUpgradeRequired(moduleKey);
    }
  },
  
  // Real page for each module. Modules without a built page yet (still on
  // the roadmap) are omitted here and fall back to a "coming soon" notice.
  pages: {
    'chatbot': '/chatbot.html',
    'social-content': '/content.html',
    'message-writer': '/message.html',
    'prompt-library': '/prompts.html',
    'text-to-image': '/text-image.html',
    'image-edit': '/imageedit.html',
    'text-to-video': '/text-video.html',
    'image-to-video': '/image-video.html',
    'video-to-video': '/video-edit.html',
    'text-to-speech': '/tts.html',
    'text-to-music': '/ttmusic.html',
    'voice-clone': '/voiceclone.html'
    // 'coding-agent' is handled separately in navigateToModule() — it's a
    // standalone service, not a page in this app (see launchCodingAgent()).
    // 'design-studio', 'chatbot-maker', 'mcp-integrator': not built yet.
  },

  // Navigate to module page
  navigateToModule(moduleKey) {
    // Coding Agent isn't a page in this app — it's a standalone service
    // (modules/coding-agent) running on its own port/process. The main
    // server exposes its URL via /api/config so this stays configurable
    // per environment (e.g. a different host in production) instead of
    // being hardcoded here.
    if (moduleKey === 'coding-agent') {
      this.launchCodingAgent();
      return;
    }

    const page = this.pages[moduleKey];
    if (page) {
      window.location.href = page;
    } else {
      const moduleName = this.definitions[moduleKey]?.name || moduleKey;
      alert(`${moduleName} is coming soon.`);
    }
  },

  // Fetch the coding agent's URL from the main server and open it.
  // It's a separate app with its own login (GitHub OAuth), so this just
  // hands off to it rather than trying to share a session.
  async launchCodingAgent() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      if (!data.success || !data.codingAgentUrl) {
        throw new Error('Coding agent URL not configured');
      }

      // A plain window.open() navigation can't carry an Authorization
      // header, so the coding-agent server has no way to know which main
      // app user is opening it (and therefore can't associate a GitHub
      // connection with them in the DB). Pass the JWT once as a query
      // param instead; the server verifies it, stores the user id in the
      // session, then immediately redirects to strip it from the URL.
      const token = AUTH.getToken();
      const url = token
        ? `${data.codingAgentUrl}?token=${encodeURIComponent(token)}`
        : data.codingAgentUrl;
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      console.error('Failed to launch Coding Agent:', err);
      alert('Coding Agent is currently unavailable. Please try again shortly.');
    }
  },
  
  // Show login required modal
  showLoginRequired(moduleKey) {
    const moduleName = this.definitions[moduleKey]?.name || moduleKey;
    
    let modal = document.getElementById('loginModal');
    if (!modal) {
      // Modal is in HTML, but if not found, we could create it
      return;
    }
    
    const messageEl = document.getElementById('loginModalMessage');
    if (messageEl) {
      messageEl.innerHTML = `To access <strong>${moduleName}</strong>, please log in or create an account.`;
    }
    
    modal.classList.add('active');
  },
  
  // Show upgrade required modal
  showUpgradeRequired(moduleKey) {
    const module = this.definitions[moduleKey];
    const requiredTier = module.tier.charAt(0).toUpperCase() + module.tier.slice(1);
    const user = AUTH.getUser();
    const currentTier = user?.subscription_tier || 'Trial';
    
    let modal = document.getElementById('upgradeModal');
    if (!modal) return;
    
    const messageEl = document.getElementById('upgradeModalMessage');
    if (messageEl) {
      messageEl.innerHTML = `To access <strong>${module.name}</strong>, you need the <strong>${requiredTier}</strong> tier or higher.`;
    }
    
    const tierEl = document.getElementById('upgradeModalTier');
    if (tierEl) {
      tierEl.innerHTML = `Your current tier: <strong>${currentTier.charAt(0).toUpperCase() + currentTier.slice(1)}</strong>`;
    }
    
    modal.classList.add('active');
  }
};

// ──────────────────────────────────────────────
// EXPOSE TO GLOBAL SCOPE
// ──────────────────────────────────────────────
window.MODULES = MODULES;