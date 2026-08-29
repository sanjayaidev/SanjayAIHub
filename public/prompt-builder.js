// ============================================
// STATE
// ============================================

const DURATION_OPTIONS = [4, 6, 8, 10]; // seconds — kept in sync with modules/prompt-builder.js ALLOWED_DURATIONS

const state = {
  selectedDuration: DURATION_OPTIONS[0],
  useTemporaryKey: false,
};

let productCount = 0;

// ============================================
// DURATION PICKER
// ============================================

function renderDurationOptions() {
  const container = document.getElementById('durationOptions');
  container.innerHTML = DURATION_OPTIONS.map(sec => `
    <div class="duration-option${sec === state.selectedDuration ? ' selected' : ''}" data-duration="${sec}">
      ${sec}s
    </div>
  `).join('');

  container.querySelectorAll('.duration-option').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedDuration = parseInt(el.dataset.duration, 10);
      container.querySelectorAll('.duration-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
    });
  });
}

// ============================================
// PRODUCTS
// ============================================

function addProduct() {
  if (productCount >= 10) return;
  productCount++;
  const id = productCount;

  const row = document.createElement('div');
  row.className = 'product-row';
  row.dataset.productId = id;
  row.innerHTML = `
    <div class="form-group">
      <label>Product Name</label>
      <input type="text" class="product-name" placeholder="e.g., Classic Poha 500g">
    </div>
    <div class="form-group">
      <label>Price <span style="color:#888;font-weight:400;">(optional)</span></label>
      <input type="text" class="product-price" placeholder="e.g., ₹120">
    </div>
    <button type="button" class="product-row-remove" title="Remove product">✖</button>
  `;

  row.querySelector('.product-row-remove').addEventListener('click', () => {
    row.remove();
    updateAddProductBtn();
  });

  document.getElementById('productsContainer').appendChild(row);
  updateAddProductBtn();
}

function updateAddProductBtn() {
  const rowCount = document.querySelectorAll('#productsContainer .product-row').length;
  const btn = document.getElementById('addProductBtn');
  btn.textContent = rowCount >= 10 ? '✖ Maximum 10 reached' : '+ Add Product';
  btn.disabled = rowCount >= 10;
}

function collectProducts() {
  const rows = document.querySelectorAll('#productsContainer .product-row');
  return Array.from(rows).map(row => ({
    name: row.querySelector('.product-name').value.trim(),
    price: row.querySelector('.product-price').value.trim(),
  }));
}

// ============================================
// VALIDATION
// ============================================

function validateForm({ silent = true } = {}) {
  const referencePrompt = document.getElementById('referencePromptBox').value.trim();
  const brandName = document.getElementById('brandName').value.trim();
  const products = collectProducts();
  const hasAtLeastOneNamedProduct = products.some(p => p.name);

  const ok = !!referencePrompt && !!brandName && !!state.selectedDuration && hasAtLeastOneNamedProduct;

  if (!silent) {
    document.getElementById('referencePromptBox').closest('.form-group').classList.toggle('invalid', !referencePrompt);
    document.getElementById('brandName').closest('.form-group').classList.toggle('invalid', !brandName);
  }

  return ok;
}

// ============================================
// SUBMIT / REGENERATE
// ============================================

async function regeneratePrompt() {
  const btn = document.getElementById('regenerateBtn');
  const errorEl = document.getElementById('formError');
  errorEl.classList.remove('visible');

  if (!validateForm({ silent: false })) {
    errorEl.textContent = 'Fill in the reference prompt, brand name, and at least one product before regenerating.';
    errorEl.classList.add('visible');
    return;
  }

  const payload = {
    referencePrompt: document.getElementById('referencePromptBox').value.trim(),
    duration: state.selectedDuration,
    products: collectProducts().filter(p => p.name),
    brandName: document.getElementById('brandName').value.trim(),
    tagline: document.getElementById('tagline').value.trim(),
    useTemporaryKey: state.useTemporaryKey,
  };

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Rewriting...';

  try {
    const response = await fetch('/api/modules/prompt-builder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(window.AUTH ? window.AUTH.getAuthHeader() : {}),
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (data.success && data.data?.prompt) {
      document.getElementById('finalPromptOutput').textContent = data.data.prompt;
      document.getElementById('outputContainer').style.display = 'grid';
      showToast('Prompt rewritten!');
      document.getElementById('outputContainer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (data.canUseTemporaryKey) {
      document.getElementById('tempKeyBanner').classList.add('visible');
      errorEl.textContent = 'No NVIDIA key configured — use the trial key banner above, or add your own in Profile.';
      errorEl.classList.add('visible');
    } else if (response.status === 429) {
      errorEl.textContent = data.message || 'Free guest usage limit reached for now. Log in for a higher limit.';
      errorEl.classList.add('visible');
    } else {
      errorEl.textContent = data.message || 'Rewrite failed. Please try again.';
      errorEl.classList.add('visible');
    }
  } catch (error) {
    errorEl.textContent = `Network error: ${error.message}`;
    errorEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ============================================
// TOAST
// ============================================

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2200);
}

// ============================================
// COPY
// ============================================

function copyFinalPrompt() {
  const text = document.getElementById('finalPromptOutput').textContent;
  if (!text) return;
  navigator.clipboard.writeText(text)
    .then(() => showToast('Copied to clipboard'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Copied to clipboard');
    });
}

// ============================================
// INIT
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  renderDurationOptions();
  addProduct(); // start with one product row

  document.getElementById('addProductBtn').addEventListener('click', addProduct);

  document.getElementById('referencePromptBox').addEventListener('input', () => {
    document.getElementById('referencePromptBox').closest('.form-group').classList.remove('invalid');
  });
  document.getElementById('brandName').addEventListener('input', () => {
    document.getElementById('brandName').closest('.form-group').classList.remove('invalid');
  });

  document.getElementById('useTempKeyBtn').addEventListener('click', () => {
    state.useTemporaryKey = true;
    document.getElementById('tempKeyBanner').classList.remove('visible');
  });

  document.getElementById('regenerateBtn').addEventListener('click', regeneratePrompt);
  document.getElementById('copyBtn').addEventListener('click', copyFinalPrompt);
});
