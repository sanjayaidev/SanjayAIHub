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
    'text-to-image': { tier: 'trial', icon: '🖼️', name: 'Text to Image', free: false, pixazoTrial: true },
    'image-edit': { tier: 'basic', icon: '🎨', name: 'Image to Image', free: false },
    'voice-clone': { tier: 'basic', icon: '🗣️', name: 'Voice Cloning', free: false },
    'text-to-video': { tier: 'pro', icon: '🎬', name: 'Text to Video', free: false, pixazoTrial: true },
    'image-to-video': { tier: 'pro', icon: '📹', name: 'Image to Video', free: false, pixazoTrial: true },
    'video-to-video': { tier: 'enterprise', icon: '🎞️', name: 'Video to Video', free: false, pixazoTrial: true },
    'text-to-speech': { tier: 'trial', icon: '🔊', name: 'Text to Audio (TTS)', free: false },
    'text-to-music': { tier: 'pro', icon: '🎵', name: 'Text to Song', free: false, pixazoTrial: true },
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

  // Whether the shared Pixazo trial window is still open for this user —
  // mirrors the server-side check in routes/modules.js's
  // getPixazoTrialStatus(), using the fields the backend now attaches to
  // the user object on login/register/verify/me (pixazo_trial_enabled,
  // pixazo_trial_limit, pixazo_trial_used_count, trial_ends_at).
  pixazoTrialActive() {
    const user = AUTH.getUser();
    if (!user || !user.pixazo_trial_enabled) return false;
    const used = user.pixazo_trial_used_count || 0;
    const limit = user.pixazo_trial_limit ?? 20;
    if (used >= limit) return false;
    if (!user.trial_ends_at) return false;
    return new Date(user.trial_ends_at) > new Date();
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

    if (userLevel >= requiredLevel) return true;

    // Trial-tier users can unlock Pixazo-powered modules early using the
    // app's shared trial key (7 days from signup, 20 generations total
    // across all Pixazo modules) — see routes/modules.js.
    if (module.pixazoTrial && userTier === 'trial' && this.pixazoTrialActive()) return true;

    return false;
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
    'voice-clone': '/voiceclone.html',
    'mcp-integrator': '/higgsfield.html',
    'coding-agent': '/agent',
    'design-studio': '/designer.html'
  },

  // Navigate to module page
  navigateToModule(moduleKey) {
    // The coding agent is a separate mounted app (see server.js) and
    // needs the user's JWT passed as a one-time ?token= param so its
    // session middleware can link the GitHub OAuth flow back to this
    // account (see server.js's /agent middleware). Every other module
    // is a plain static page and doesn't need this.
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

  // Navigate to the coding agent, carrying the JWT as a one-time query
  // param so server.js can stash mainUserId in the session before the
  // token is stripped from the URL.
  launchCodingAgent() {
    const basePage = this.pages['coding-agent'] || '/agent';
    const token = AUTH.getToken();
    window.location.href = token
      ? `${basePage}?token=${encodeURIComponent(token)}`
      : basePage;
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