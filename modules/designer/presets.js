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

  const PRESET_FILES = {
    'carousel-first': 'presets/carousel-first.json', 'carousel-content': 'presets/carousel-content.json',
    'carousel-end': 'presets/carousel-end.json', 'single-post': 'presets/single-post.json',
    'product-showcase': 'presets/product-showcase.json', 'educational': 'presets/educational.json',
    'quote-card': 'presets/quote-card.json', 'story': 'presets/story.json', 'reel-cover': 'presets/reel-cover.json'
  };

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
      // Use extension URL if internal, else fallback (though fallback won't work without chrome API)
      const isInternal = !!chrome.runtime.id;
      const url = isInternal ? chrome.runtime.getURL(PRESET_FILES[cat]) : PRESET_FILES[cat];
      
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