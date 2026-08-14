// State
let state = {
  selectedStyle: null,
  useTemporaryKey: false,
};

// DOM Elements
const DOM = {
  styleSelect: document.getElementById('styleSelect'),
  styleHint: document.getElementById('styleHint'),
  step1: document.getElementById('step1'),
  step2: document.getElementById('step2'),
  step3: document.getElementById('step3'),
  step4: document.getElementById('step4'),
  productContainer: document.getElementById('productContainer'),
  reviewContainer: document.getElementById('reviewContainer'),
  stepper: document.getElementById('stepper'),
  selectedStyleChip: document.getElementById('selectedStyleChip'),
  selectedStyleChipStep3: document.getElementById('selectedStyleChipStep3'),
  tempKeyBanner: document.getElementById('tempKeyBanner'),
  useTempKeyBtn: document.getElementById('useTempKeyBtn'),
  finalPromptOutput: document.getElementById('finalPromptOutput'),
  sceneBreakdown: document.getElementById('sceneBreakdown'),
  toStep2Btn: null, // set after DOM ready
  toStep3Btn: null, // set after DOM ready
};

let stylesCache = [];

// ============================================
// FETCH STYLES (public, no auth)
// ============================================

async function fetchStyles() {
  try {
    const response = await fetch('/api/modules/prompt-builder/styles');
    const data = await response.json();

    if (data.success) {
      stylesCache = data.styles;
      renderStyleSelect(data.styles);
    }
  } catch (error) {
    console.error('Error fetching styles:', error);
    showError('Failed to load styles. Please refresh the page.');
  }
}

function renderStyleSelect(styles) {
  DOM.styleSelect.innerHTML = '<option value="">Select a style…</option>' +
    styles.map(s => `<option value="${s.id}">${s.icon} ${s.name}</option>`).join('');

  DOM.styleSelect.addEventListener('change', () => {
    state.selectedStyle = DOM.styleSelect.value;
    const style = stylesCache.find(s => s.id === state.selectedStyle);
    DOM.styleHint.textContent = style ? style.description : '';
    if (DOM.selectedStyleChip) {
      DOM.selectedStyleChip.innerHTML = style
        ? `${style.icon} ${style.name} <span style="color:#888;">(change)</span>`
        : '';
      DOM.selectedStyleChip.onclick = () => showStep(1);
      DOM.selectedStyleChip.style.cursor = 'pointer';
    }
  });
}

// ============================================
// NAVIGATION
// ============================================

let maxStepReached = 1;

function showStep(step) {
  if (step > maxStepReached + 1) return;
  if (step === 2 && !validateStep1()) return;
  if (step === 3 && !validateStep2()) return;

  maxStepReached = Math.max(maxStepReached, step);

  DOM.step1.style.display = step === 1 ? 'block' : 'none';
  DOM.step2.style.display = step === 2 ? 'block' : 'none';
  DOM.step3.style.display = step === 3 ? 'block' : 'none';
  DOM.step4.style.display = step === 4 ? 'block' : 'none';

  if (step === 3) {
    renderReview();
  }

  updateStepper(step);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStepper(currentStep) {
  const nodes = DOM.stepper.querySelectorAll('.step-node');
  const lines = DOM.stepper.querySelectorAll('.step-line');

  nodes.forEach(node => {
    const n = parseInt(node.dataset.step, 10);
    node.classList.toggle('active', n === currentStep);
    node.classList.toggle('completed', n < currentStep);
    node.disabled = n > maxStepReached;
  });

  lines.forEach((line, i) => {
    line.classList.toggle('completed', i + 1 < currentStep);
  });
}

function validateStep1() {
  const brandInput = document.getElementById('brandName');
  const group = brandInput.closest('.form-group');
  const brandOk = brandInput.value.trim().length > 0;
  group.classList.toggle('invalid', !brandOk);

  const styleOk = !!state.selectedStyle;
  DOM.styleSelect.closest('.form-group').classList.toggle('invalid', !styleOk);

  if (!styleOk) {
    DOM.styleSelect.focus();
    return false;
  }
  if (!brandOk) {
    brandInput.focus();
    return false;
  }
  return true;
}

function validateStep2() {
  const cards = DOM.productContainer.querySelectorAll('.product-card');
  if (cards.length === 0) {
    alert('Please add at least one product.');
    return false;
  }

  let valid = true;
  cards.forEach(card => {
    const nameInput = card.querySelector('.product-name');
    const descInput = card.querySelector('.product-description');
    if (!nameInput || !nameInput.value.trim()) {
      nameInput?.closest('.form-group')?.classList.add('invalid');
      valid = false;
    }
    if (!descInput || !descInput.value.trim()) {
      descInput?.closest('.form-group')?.classList.add('invalid');
      valid = false;
    }
  });

  if (!valid) {
    alert('Please fill in product names and descriptions for all products.');
  }
  return valid;
}

// ============================================
// REVIEW (STEP 3)
// ============================================

function renderReview() {
  const brandName = document.getElementById('brandName').value.trim();
  const category = document.getElementById('category').value;
  const tagline = document.getElementById('tagline').value.trim();
  const style = stylesCache.find(s => s.id === state.selectedStyle);

  if (DOM.selectedStyleChipStep3 && style) {
    DOM.selectedStyleChipStep3.innerHTML = `${style.icon} ${style.name}`;
  }

  const cards = DOM.productContainer.querySelectorAll('.product-card');
  let html = '';

  cards.forEach((card, index) => {
    const name = card.querySelector('.product-name')?.value.trim() || 'Unnamed';
    const price = card.querySelector('.product-price')?.value.trim() || '-';
    const description = card.querySelector('.product-description')?.value.trim() || 'No description';
    const visual = card.querySelector('.product-visual')?.value.trim() || 'No visual details';

    html += `
      <div class="review-card">
        <h4><span class="product-badge">${index + 1}</span> ${escapeHtml(name)}</h4>
        <div class="review-item">
          <span class="review-label">Price</span>
          <span class="review-value">${escapeHtml(price)}</span>
        </div>
        <div class="review-item">
          <span class="review-label">Description</span>
          <span class="review-value" style="text-align:left;max-width:70%">${escapeHtml(description)}</span>
        </div>
        <div class="review-item">
          <span class="review-label">Visual Details</span>
          <span class="review-value" style="text-align:left;max-width:70%">${escapeHtml(visual)}</span>
        </div>
      </div>
    `;
  });

  DOM.reviewContainer.innerHTML = html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// GENERATE FINAL PROMPT (STEP 4)
// ============================================

async function generateFinalPrompt() {
  const btn = document.getElementById('generatePromptBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Generating...';

  try {
    const brandName = document.getElementById('brandName').value.trim();
    const category = document.getElementById('category').value;
    const tagline = document.getElementById('tagline').value.trim();
    const style = stylesCache.find(s => s.id === state.selectedStyle);

    const products = [];
    DOM.productContainer.querySelectorAll('.product-card').forEach(card => {
      products.push({
        name: card.querySelector('.product-name')?.value.trim() || '',
        price: card.querySelector('.product-price')?.value.trim() || '',
        description: card.querySelector('.product-description')?.value.trim() || '',
        visualDetails: card.querySelector('.product-visual')?.value.trim() || '',
      });
    });

    const payload = {
      action: 'generate_full_prompt',
      brandName,
      category,
      tagline,
      styleId: state.selectedStyle,
      styleName: style?.name || '',
      styleDescription: style?.description || '',
      products,
      useTemporaryKey: state.useTemporaryKey,
    };

    const response = await fetch('/api/modules/prompt-builder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...AUTH.getAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.success && data.data?.prompt) {
      // Display the final prompt
      DOM.finalPromptOutput.textContent = data.data.prompt;

      // Display scene breakdown
      if (data.data.scenes && Array.isArray(data.data.scenes)) {
        let scenesHtml = '';
        data.data.scenes.forEach((scene, index) => {
          scenesHtml += `
            <div class="scene-item">
              <h5>Scene ${index + 1}: ${escapeHtml(scene.title || 'Product Shot')}</h5>
              <p>${escapeHtml(scene.description || '')}</p>
            </div>
          `;
        });
        DOM.sceneBreakdown.innerHTML = scenesHtml;
      }

      showStep(4);
      showToast('Prompt generated successfully!');
    } else if (data.canUseTemporaryKey) {
      DOM.tempKeyBanner.classList.add('visible');
      alert('No NVIDIA key configured — use the trial key banner in Step 2, or add your own in Profile.');
    } else {
      alert(data.message || 'Failed to generate prompt. Please try again.');
    }
  } catch (error) {
    console.error('Error generating prompt:', error);
    alert('Network error: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function copyFinalPrompt() {
  const promptText = DOM.finalPromptOutput?.textContent;
  if (!promptText) return;

  navigator.clipboard.writeText(promptText)
    .then(() => showToast('Prompt copied to clipboard!'))
    .catch(() => {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = promptText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('Prompt copied to clipboard!');
    });
}

function startOver() {
  if (confirm('Start a new project? All current data will be lost.')) {
    // Reset form fields
    document.getElementById('brandName').value = '';
    document.getElementById('tagline').value = '';
    document.getElementById('category').selectedIndex = 0;
    DOM.styleSelect.selectedIndex = 0;
    DOM.styleHint.textContent = '';
    state.selectedStyle = null;

    // Clear products
    DOM.productContainer.innerHTML = '';
    productCount = 0;
    updateProductCount();

    // Reset stepper
    maxStepReached = 1;
    showStep(1);

    showToast('Ready for a new project!');
  }
}

// ============================================
// PRODUCT MANAGEMENT
// ============================================

let productCount = 0;

function addProduct() {
  if (productCount >= 5) {
    alert('Maximum 5 products allowed');
    return;
  }

  productCount++;
  const div = document.createElement('div');
  div.className = 'product-card';
  div.dataset.index = productCount;

  div.innerHTML = `
    <h4><span class="product-badge">${productCount}</span> Product #${productCount}</h4>
    <div class="form-group">
      <label>Product Name *</label>
      <input type="text" class="product-name" placeholder="e.g., VADA PAVA" required>
    </div>
    <div class="form-group">
      <label>Price</label>
      <input type="text" class="product-price" placeholder="e.g., ₹ 45/-">
    </div>
    <div class="form-group field-with-enhance">
      <label>Description</label>
      <textarea class="product-description" placeholder="Brief product description..." rows="2"></textarea>
      <div class="enhance-row">
        <button type="button" class="btn-enhance" data-field="description">✨ Enhance</button>
        <button type="button" class="btn-icon btn-undo" data-field="description" title="Undo last enhance" disabled>↺</button>
        <button type="button" class="btn-icon btn-copy" data-field="description" title="Copy">📋</button>
      </div>
      <small class="field-enhanced-flag">✓ Enhanced</small>
      <small class="enhance-error"></small>
    </div>
    <div class="form-group field-with-enhance">
      <label>Visual Details</label>
      <textarea class="product-visual" placeholder="Textures, condition, supporting elements..." rows="2"></textarea>
      <div class="enhance-row">
        <button type="button" class="btn-enhance" data-field="visualDetails">✨ Enhance</button>
        <button type="button" class="btn-icon btn-undo" data-field="visualDetails" title="Undo last enhance" disabled>↺</button>
        <button type="button" class="btn-icon btn-copy" data-field="visualDetails" title="Copy">📋</button>
      </div>
      <small class="field-enhanced-flag">✓ Enhanced</small>
      <small class="enhance-error"></small>
    </div>
    <button class="remove-product" onclick="removeProduct(this)">🗑️ Remove</button>
  `;

  DOM.productContainer.appendChild(div);

  div.querySelectorAll('.btn-enhance').forEach(btn => {
    btn.addEventListener('click', () => enhanceField(btn));
  });
  div.querySelectorAll('.btn-undo').forEach(btn => {
    btn.addEventListener('click', () => undoField(btn));
  });
  div.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => copyField(btn));
  });

  updateProductCount();
}

function removeProduct(btn) {
  const card = btn.closest('.product-card');
  card.remove();
  productCount--;
  updateProductCount();
  reindexProducts();
}

function updateProductCount() {
  const btn = document.getElementById('addProductBtn');
  btn.textContent = productCount >= 5 ? '✖ Maximum 5 reached' : '+ Add Product';
  btn.disabled = productCount >= 5;
}

function reindexProducts() {
  const cards = DOM.productContainer.querySelectorAll('.product-card');
  cards.forEach((card, index) => {
    card.dataset.index = index + 1;
    card.querySelector('h4').innerHTML = `<span class="product-badge">${index + 1}</span> Product #${index + 1}`;
  });
}

// ============================================
// ENHANCE (AI) — per field, per product
// ============================================

async function enhanceField(btn, opts = {}) {
  const { silent = false } = opts;
  const field = btn.dataset.field; // 'description' | 'visualDetails'
  const card = btn.closest('.product-card');
  const group = btn.closest('.form-group');
  const textarea = field === 'description'
    ? card.querySelector('.product-description')
    : card.querySelector('.product-visual');
  const errorEl = group.querySelector('.enhance-error');
  const undoBtn = group.querySelector('.btn-undo');
  const enhancedFlag = group.querySelector('.field-enhanced-flag');

  errorEl.classList.remove('visible');
  errorEl.textContent = '';

  if (!AUTH.isLoggedIn()) {
    if (!silent) {
      errorEl.textContent = 'Please log in to use Enhance.';
      errorEl.classList.add('visible');
    }
    return false;
  }
  if (!state.selectedStyle) {
    if (!silent) {
      errorEl.textContent = 'Pick a catalog style in Step 1 first.';
      errorEl.classList.add('visible');
    }
    return false;
  }
  if (!textarea.value.trim()) {
    if (!silent) {
      errorEl.textContent = `Type a rough ${field === 'description' ? 'description' : 'set of visual details'} first.`;
      errorEl.classList.add('visible');
    }
    return false;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.classList.add('enhancing');
  btn.textContent = '⏳';

  const previousText = textarea.value;

  const payload = {
    field,
    text: previousText.trim(),
    styleId: state.selectedStyle,
    brandName: document.getElementById('brandName').value.trim(),
    category: document.getElementById('category').value,
    tagline: document.getElementById('tagline').value.trim(),
    productName: card.querySelector('.product-name').value.trim(),
    price: card.querySelector('.product-price').value.trim(),
    useTemporaryKey: state.useTemporaryKey,
  };

  let success = false;

  try {
    const response = await fetch('/api/modules/prompt-builder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...AUTH.getAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.success && data.data?.enhanced) {
      textarea.dataset.previousValue = previousText;
      textarea.value = data.data.enhanced;
      textarea.dispatchEvent(new Event('input'));
      undoBtn.disabled = false;
      enhancedFlag.classList.add('visible');
      success = true;
    } else if (data.canUseTemporaryKey) {
      DOM.tempKeyBanner.classList.add('visible');
      if (!silent) {
        errorEl.textContent = 'No NVIDIA key configured — use the trial key banner above, or add your own in Profile.';
        errorEl.classList.add('visible');
      }
    } else {
      if (!silent) {
        errorEl.textContent = data.message || 'Enhance failed. Please try again.';
        errorEl.classList.add('visible');
      }
    }
  } catch (error) {
    if (!silent) {
      errorEl.textContent = `Network error: ${error.message}`;
      errorEl.classList.add('visible');
    }
  } finally {
    btn.disabled = false;
    btn.classList.remove('enhancing');
    btn.textContent = originalLabel;
  }

  return success;
}

function undoField(btn) {
  const field = btn.dataset.field;
  const card = btn.closest('.product-card');
  const textarea = field === 'description'
    ? card.querySelector('.product-description')
    : card.querySelector('.product-visual');

  if (textarea.dataset.previousValue === undefined) return;

  textarea.value = textarea.dataset.previousValue;
  delete textarea.dataset.previousValue;
  textarea.dispatchEvent(new Event('input'));
  btn.disabled = true;

  const group = btn.closest('.form-group');
  group.querySelector('.field-enhanced-flag').classList.remove('visible');
  showToast('Reverted to your original text');
}

function copyField(btn) {
  const field = btn.dataset.field;
  const card = btn.closest('.product-card');
  const textarea = field === 'description'
    ? card.querySelector('.product-description')
    : card.querySelector('.product-visual');

  if (!textarea.value.trim()) return;

  navigator.clipboard.writeText(textarea.value)
    .then(() => showToast('Copied to clipboard'))
    .catch(() => {
      textarea.select();
      document.execCommand('copy');
      showToast('Copied to clipboard');
    });
}

// ============================================
// ENHANCE ALL — catalog-wide, both fields, every product
// ============================================

async function enhanceAllProducts() {
  const btn = document.getElementById('enhanceAllBtn');
  const statusEl = document.getElementById('enhanceAllStatus');

  if (!AUTH.isLoggedIn()) {
    statusEl.textContent = 'Please log in to use Enhance.';
    return;
  }
  if (!state.selectedStyle) {
    statusEl.textContent = 'Pick a catalog style in Step 1 first.';
    return;
  }

  const buttons = [];
  DOM.productContainer.querySelectorAll('.product-card').forEach(card => {
    card.querySelectorAll('.btn-enhance').forEach(b => {
      const field = b.dataset.field;
      const textarea = field === 'description'
        ? card.querySelector('.product-description')
        : card.querySelector('.product-visual');
      if (textarea.value.trim()) buttons.push(b);
    });
  });

  if (buttons.length === 0) {
    statusEl.textContent = 'Nothing to enhance yet — fill in some fields first.';
    return;
  }

  btn.disabled = true;
  let done = 0;
  let failed = 0;

  for (const b of buttons) {
    statusEl.textContent = `Enhancing ${done + 1} of ${buttons.length}…`;
    // eslint-disable-next-line no-await-in-loop
    const ok = await enhanceField(b, { silent: true });
    if (ok) done++; else failed++;
  }

  btn.disabled = false;
  statusEl.textContent = failed > 0
    ? `Enhanced ${done} of ${buttons.length} (${failed} failed — check field errors)`
    : `✅ Enhanced all ${done} fields`;
  showToast(failed > 0 ? `Enhanced ${done}/${buttons.length}, ${failed} failed` : 'All fields enhanced');
}

// ============================================
// TOAST
// ============================================

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2500);
}

// ============================================
// UTILITY
// ============================================

function showError(msg) {
  alert(msg);
}

// ============================================
// INIT
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize button references
  DOM.toStep2Btn = document.getElementById('toStep2Btn');
  DOM.toStep3Btn = document.getElementById('toStep3Btn');

  fetchStyles();
  showStep(1);

  document.getElementById('addProductBtn').addEventListener('click', addProduct);

  DOM.toStep2Btn?.addEventListener('click', () => {
    if (validateStep1()) {
      showStep(2);
      if (productCount === 0) addProduct();
    }
  });

  document.getElementById('brandName').addEventListener('input', () => {
    document.getElementById('brandName').closest('.form-group').classList.remove('invalid');
  });

  // Step 2 -> Step 3 navigation
  DOM.toStep3Btn?.addEventListener('click', () => {
    if (validateStep2()) {
      showStep(3);
    }
  });

  DOM.useTempKeyBtn.addEventListener('click', () => {
    state.useTemporaryKey = true;
    DOM.tempKeyBanner.classList.remove('visible');
  });

  document.getElementById('enhanceAllBtn').addEventListener('click', enhanceAllProducts);

  // Step 3: Review -> Generate Prompt
  document.getElementById('generatePromptBtn')?.addEventListener('click', generateFinalPrompt);

  // Step 4: Copy prompt button
  document.getElementById('copyPromptBtn')?.addEventListener('click', copyFinalPrompt);

  // Step 4: Regenerate button
  document.getElementById('regenerateBtn')?.addEventListener('click', () => {
    showStep(3);
  });

  // Step 4: Start over button
  document.getElementById('startOverBtn')?.addEventListener('click', startOver);

  DOM.stepper.querySelectorAll('.step-node').forEach(node => {
    node.addEventListener('click', () => {
      const target = parseInt(node.dataset.step, 10);
      if (target <= maxStepReached) showStep(target);
    });
  });
});
