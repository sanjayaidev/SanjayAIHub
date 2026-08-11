(function () {
  'use strict';
  const EXTENSION_ID = 'noapjcmepjdbbnhdddiflndjbodlamph';

  function sendToExt(message) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        reject(new Error('Chrome API not available. Please open via: chrome-extension://noapjcmepjdbbnhdddiflndjbodlamph/designer.html'));
        return;
      }
      try {
        const isInternal = !!chrome.runtime.id;
        const target = isInternal ? null : EXTENSION_ID;
        chrome.runtime.sendMessage(target, message, (response) => {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          if (!response) { reject(new Error('Empty response')); return; }
          if (!response.success) { reject(new Error(response.error || 'Unknown')); return; }
          resolve(response.result !== undefined ? response.result : response);
        });
      } catch (err) { reject(err); }
    });
  }

  // NOTE: these are served by Express as static files from
  // public/designer-presets/*.json (see server.js `express.static`).
  // They used to be pointed at 'presets/...' which only exists inside the
  // companion Chrome extension bundle (chrome-extension://EXTENSION_ID/presets/...),
  // so on the plain web page every fetch 404'd.
  const PRESET_FILES = {
    'carousel-first': 'designer-presets/carousel-first.json', 'carousel-content': 'designer-presets/carousel-content.json',
    'carousel-end': 'designer-presets/carousel-end.json', 'single-post': 'designer-presets/single-post.json',
    'product-showcase': 'designer-presets/product-showcase.json', 'educational': 'designer-presets/educational.json',
    'quote-card': 'designer-presets/quote-card.json', 'story': 'designer-presets/story.json', 'reel-cover': 'designer-presets/reel-cover.json'
  };

  // Safe check — `chrome` / `chrome.runtime` are only defined when this page is
  // actually running inside the companion extension (or on a site the extension
  // has allowlisted via externally_connectable). On the normal web app neither
  // exists, so accessing `chrome.runtime.id` directly used to throw
  // "Cannot read properties of undefined (reading 'id')".
  function isExtensionContext() {
    return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
  }

  let currentCategory = null;
  let loadedPresets = null;
  const catSelect = document.getElementById('presetCategory');
  const pSelect = document.getElementById('presetSelect');
  const applyBtn = document.getElementById('applyPresetBtn');
  const saveBtn = document.getElementById('savePresetBtn');

  if (!catSelect || !pSelect) { console.error('[Presets] Dropdown elements missing.'); return; }

  catSelect.addEventListener('change', async () => {
    const cat = catSelect.value;
    if (!cat) {
      pSelect.disabled = true; pSelect.innerHTML = '<option value="">— Pick a category first —</option>';
      currentCategory = null; loadedPresets = null; return;
    }
    currentCategory = cat;
    pSelect.disabled = true;
    pSelect.innerHTML = '<option value="">Loading from DB...</option>';
    
    try {
      if (!window.ContentDesignerAPI || typeof window.ContentDesignerAPI.loadPresetsFromURL !== 'function') {
        throw new Error('ContentDesignerAPI not ready. Refresh the page.');
      }
      // Inside the extension, pull the bundled copy; on the plain web page,
      // fetch the same JSON from this server's static /designer-presets/ folder.
      const url = isExtensionContext() ? chrome.runtime.getURL(PRESET_FILES[cat]) : '/' + PRESET_FILES[cat];

      const data = await window.ContentDesignerAPI.loadPresetsFromURL(url);
      const arr = (data && Array.isArray(data)) ? data : (data?.presets || []);
      loadedPresets = arr;
      
      if (!arr.length) { pSelect.innerHTML = '<option value="">(empty — save one first)</option>'; return; }
      pSelect.innerHTML = '<option value="">— Pick a preset —</option>' + arr.map((p, i) => `<option value="${i}">${p.name || ('Preset ' + (i+1))}</option>`).join('');
      pSelect.disabled = false;
    } catch (err) {
      console.error('[Presets] load failed:', err);
      pSelect.innerHTML = `<option value="">✗ Error: ${err.message.slice(0, 40)}...</option>`;
    }
  });

  applyBtn.addEventListener('click', async () => {
    const idx = pSelect.value;
    if (idx === '' || !loadedPresets) { alert('Pick a preset first.'); return; }
    const preset = loadedPresets[+idx];
    if (!preset) return;
    if (!confirm(`Apply "${preset.name}"?\nThis will reset the canvas.`)) return;
    try { await window.ContentDesignerAPI.applyPresetJSON(preset.spec || preset); } 
    catch (err) { alert('Preset apply failed: ' + err.message); }
  });

  saveBtn.addEventListener('click', async () => {
    if (!currentCategory) { alert('Pick a category first.'); return; }
    // Saving new presets to Postgres is currently only wired up through the
    // companion Chrome extension's background script (dbSavePreset/dbLoadPresets)
    // — this repo has no /api/designer preset-CRUD route or table for it yet.
    // Fail with a clear message here instead of a raw "Chrome API not available".
    if (!isExtensionContext()) {
      alert('Saving new presets isn\'t available in the web app yet — it currently requires the companion browser extension. You can still pick and apply the built-in presets above.');
      return;
    }
    const name = prompt('Preset name:', 'My Preset ' + new Date().toLocaleTimeString());
    if (!name) return;
    const spec = window.ContentDesignerAPI.saveCurrentAsSpec();
    try {
      await sendToExt({ action: 'dbSavePreset', category: currentCategory, name, spec });
      alert('✓ Saved to PostgreSQL database!');
      // Refresh
      const res = await sendToExt({ action: 'dbLoadPresets', category: currentCategory });
      loadedPresets = res.result || [];
      pSelect.innerHTML = '<option value="">— Pick a preset —</option>' + loadedPresets.map((p, j) => `<option value="${j}">${p.name || ('Preset '+(j+1))}</option>`).join('');
      pSelect.value = String(loadedPresets.length - 1);
    } catch (err) { alert('Save failed: ' + err.message); }
  });

  // Chat widget toggle logic
  const toggleBtn = document.getElementById('agentToggle');
  const panel = document.getElementById('agentPanel');
  const closeBtn = document.getElementById('agentClose');
  const input = document.getElementById('agentInput');
  const sendBtn = document.getElementById('agentSend');
  const messages = document.getElementById('agentMessages');
  const statusEl = document.getElementById('agentStatus');
  const subtitle = document.getElementById('agentSubtitle');
  const badge = document.getElementById('agentBadge');

  if (toggleBtn) toggleBtn.addEventListener('click', () => { panel.classList.toggle('open'); if (panel.classList.contains('open')) { badge.style.display = 'none'; input.focus(); } });
  if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.remove('open'));
  if (input) {
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); } });
  }

  window.DesignerAgentUI = {
    addMessage(role, html, actions) {
      const el = document.createElement('div'); el.className = 'agent-msg ' + role; el.innerHTML = html;
      if (actions) {
        const actDiv = document.createElement('div'); actDiv.className = 'agent-actions';
        actions.forEach(a => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = a.label; b.addEventListener('click', a.onClick); actDiv.appendChild(b); });
        el.appendChild(actDiv);
      }
      messages.appendChild(el); messages.scrollTop = messages.scrollHeight; return el;
    },
    addTyping() {
      const el = document.createElement('div'); el.className = 'agent-msg bot'; el.id = 'agentTyping';
      el.innerHTML = '<div class="agent-timing"><span></span><span></span><span></span></div>';
      messages.appendChild(el); messages.scrollTop = messages.scrollHeight; return el;
    },
    removeTyping() { const el = document.getElementById('agentTyping'); if (el) el.remove(); },
    setStatus(text) { if (statusEl) statusEl.textContent = text; if (subtitle) subtitle.textContent = text; },
    flashBadge() { if (!panel.classList.contains('open')) badge.style.display = 'block'; },
    getInput() { return input.value.trim(); },
    clearInput() { input.value = ''; input.style.height = 'auto'; },
    busy(on) { sendBtn.disabled = on; input.disabled = on; }
  };
})();