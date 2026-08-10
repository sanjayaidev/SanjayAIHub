// transform-controls.js
// DOM-based Transform Controllers for Image Designer
// v3: Minimal, robust, works with existing designer.js rendering

class TransformControls {
  constructor() {
    this.selectedElement = null;
    this.selectedType = null;
    this.selectedId = null;
    this.isDragging = false;
    this.isRotating = false;
    this.isResizing = false;
    this.resizeCorner = null;
    this.startX = 0;
    this.startY = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.createControlPanel();
    this.attachGlobalListeners();
  }

  createControlPanel() {
    this.container = document.createElement('div');
    this.container.id = 'transform-controls-container';
    this.container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 10000;
    `;

    this.boundingBox = document.createElement('div');
    this.boundingBox.id = 'transform-bounding-box';
    this.boundingBox.style.cssText = `
      position: absolute;
      border: 2px solid #4DFFA0;
      background: rgba(77, 255, 160, 0.05);
      box-sizing: border-box;
      pointer-events: none;
      display: none;
    `;
    this.container.appendChild(this.boundingBox);

    const corners = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    this.handles = {};
    const cursors = { nw:'nw-resize', n:'n-resize', ne:'ne-resize', e:'e-resize', se:'se-resize', s:'s-resize', sw:'sw-resize', w:'w-resize' };

    corners.forEach(corner => {
      const handle = document.createElement('div');
      handle.className = `resize-handle ${corner}`;
      handle.style.cssText = `
        position: absolute;
        width: 12px;
        height: 12px;
        background: #4DFFA0;
        border: 2px solid #0A0D14;
        border-radius: 50%;
        pointer-events: auto;
        cursor: ${cursors[corner]};
        display: none;
        z-index: 10001;
      `;
      handle.setAttribute('data-corner', corner);
      this.container.appendChild(handle);
      this.handles[corner] = handle;
    });

    this.rotateHandle = document.createElement('div');
    this.rotateHandle.id = 'transform-rotate-handle';
    this.rotateHandle.innerHTML = '↻';
    this.rotateHandle.style.cssText = `
      position: absolute;
      width: 20px;
      height: 20px;
      background: #4D9FFF;
      border: 2px solid #0A0D14;
      border-radius: 50%;
      pointer-events: auto;
      cursor: grab;
      z-index: 10001;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: bold;
    `;
    this.container.appendChild(this.rotateHandle);

    this.deleteBtn = document.createElement('div');
    this.deleteBtn.id = 'transform-delete-btn';
    this.deleteBtn.innerHTML = '✕';
    this.deleteBtn.style.cssText = `
      position: absolute;
      width: 24px;
      height: 24px;
      background: #ef4444;
      border: 2px solid #0A0D14;
      border-radius: 50%;
      pointer-events: auto;
      cursor: pointer;
      z-index: 10001;
      color: white;
      font-size: 14px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    this.container.appendChild(this.deleteBtn);

    this.infoTooltip = document.createElement('div');
    this.infoTooltip.id = 'transform-info';
    this.infoTooltip.style.cssText = `
      position: fixed;
      background: rgba(10, 13, 20, 0.9);
      border: 1px solid #4DFFA0;
      border-radius: 4px;
      padding: 4px 8px;
      font-family: 'Space Mono', monospace;
      font-size: 10px;
      color: #4DFFA0;
      pointer-events: none;
      display: none;
      z-index: 10002;
      white-space: nowrap;
    `;
    document.body.appendChild(this.infoTooltip);

    const canvasWrap = document.getElementById('canvasWrap');
    if (canvasWrap) canvasWrap.appendChild(this.container);
  }

  getRelativeRect(element) {
    const canvasWrap = document.getElementById('canvasWrap');
    if (!canvasWrap) return element.getBoundingClientRect();
    const wrapRect = canvasWrap.getBoundingClientRect();
    const elemRect = element.getBoundingClientRect();
    return {
      left: elemRect.left - wrapRect.left,
      top: elemRect.top - wrapRect.top,
      width: elemRect.width,
      height: elemRect.height
    };
  }

  attachGlobalListeners() {
    this.rotateHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.startRotate(e);
    });
    this.deleteBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.deleteSelected();
    });
    Object.values(this.handles).forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.startResize(e);
      });
    });
    window.addEventListener('mouseup', () => {
      this.stopDrag();
      this.stopRotate();
      this.stopResize();
    });
  }

  selectElement(element, type, id) {
    this.selectedElement = element;
    this.selectedType = type;
    this.selectedId = id;
    this.updateBoundingBox();
    this.showControls(true);
  }

  updateBoundingBox() {
    if (!this.selectedElement) return;
    const rect = this.getRelativeRect(this.selectedElement);
    const left = rect.left, top = rect.top, width = rect.width, height = rect.height;

    this.boundingBox.style.left = left + 'px';
    this.boundingBox.style.top = top + 'px';
    this.boundingBox.style.width = width + 'px';
    this.boundingBox.style.height = height + 'px';

    const h = 6;
    this.handles.nw.style.left = (left - h) + 'px'; this.handles.nw.style.top = (top - h) + 'px';
    this.handles.n.style.left = (left + width/2 - h) + 'px'; this.handles.n.style.top = (top - h) + 'px';
    this.handles.ne.style.left = (left + width - h) + 'px'; this.handles.ne.style.top = (top - h) + 'px';
    this.handles.e.style.left = (left + width - h) + 'px'; this.handles.e.style.top = (top + height/2 - h) + 'px';
    this.handles.se.style.left = (left + width - h) + 'px'; this.handles.se.style.top = (top + height - h) + 'px';
    this.handles.s.style.left = (left + width/2 - h) + 'px'; this.handles.s.style.top = (top + height - h) + 'px';
    this.handles.sw.style.left = (left - h) + 'px'; this.handles.sw.style.top = (top + height - h) + 'px';
    this.handles.w.style.left = (left - h) + 'px'; this.handles.w.style.top = (top + height/2 - h) + 'px';

    this.rotateHandle.style.left = (left + width/2 - 10) + 'px';
    this.rotateHandle.style.top = (top - 30) + 'px';
    this.deleteBtn.style.left = (left + width + 15) + 'px';
    this.deleteBtn.style.top = (top - 15) + 'px';
  }

  showControls(show) {
    const d = show ? 'block' : 'none';
    const df = show ? 'flex' : 'none';
    this.boundingBox.style.display = d;
    Object.values(this.handles).forEach(h => h.style.display = df);
    this.rotateHandle.style.display = df;
    this.deleteBtn.style.display = df;
  }

  // ─── DRAG ───
  startDrag(e) {
    if (this.isResizing || this.isRotating) return;
    this.isDragging = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.showInfo(e.clientX, e.clientY, 'Moving...');
    e.preventDefault();
  }

  onDrag(e) {
    if (!this.isDragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    const canvas = document.getElementById('canvas');
    const scale = parseFloat(canvas?.style?.transform?.match(/scale\(([^)]+)\)/)?.[1] || 1);
    const dXPct = (dx / (CW * scale)) * 100;
    const dYPct = (dy / (CH * scale)) * 100;

    if (this.selectedType === 'icon') {
      const icon = state.icons.find(i => i.id === this.selectedId);
      if (icon) {
        icon.x = Math.min(100, Math.max(0, icon.x + dXPct));
        icon.y = Math.min(100, Math.max(0, icon.y + dYPct));
        const xIn = document.querySelector(`.icon-x[data-id="${this.selectedId}"]`);
        const yIn = document.querySelector(`.icon-y[data-id="${this.selectedId}"]`);
        if (xIn) xIn.value = Math.round(icon.x);
        if (yIn) yIn.value = Math.round(icon.y);
        renderIcons();
        this.refreshSelection('icon');
      }
    } else if (this.selectedType === 'text') {
      const text = state.textBlocks.find(t => t.id === this.selectedId);
      if (text) {
        text.x = Math.min(100, Math.max(0, text.x + dXPct));
        text.y = Math.min(100, Math.max(0, text.y + dYPct));
        const xIn = document.querySelector(`.tb-x[data-id="${this.selectedId}"]`);
        const yIn = document.querySelector(`.tb-y[data-id="${this.selectedId}"]`);
        if (xIn) xIn.value = Math.round(text.x * 10) / 10;
        if (yIn) yIn.value = Math.round(text.y * 10) / 10;
        renderTextContent();
        this.refreshSelection('text');
      }
    } else if (this.selectedType === 'mainImg') {
      const xIn = document.getElementById('mainImgX');
      const yIn = document.getElementById('mainImgY');
      if (xIn && yIn) {
        let nx = parseFloat(xIn.value) + dXPct;
        let ny = parseFloat(yIn.value) + dYPct;
        xIn.value = Math.min(100, Math.max(0, Math.round(nx * 10) / 10));
        yIn.value = Math.min(100, Math.max(0, Math.round(ny * 10) / 10));
        updateMainImg();
        this.refreshSelection('mainImg');
      }
    }
    this.showInfo(e.clientX, e.clientY, `dX:${Math.round(dXPct*10)/10} dY:${Math.round(dYPct*10)/10}`);
  }

  // Find and re-select element after render (without calling selectElement to avoid loop)
  refreshSelection(type) {
    requestAnimationFrame(() => {
      let el = null;
      if (type === 'icon') {
        el = document.querySelector(`#layer-icons img[data-id="${this.selectedId}"]`);
      } else if (type === 'text') {
        el = document.querySelector(`#layer-text > div[data-id="${this.selectedId}"]`);
      } else if (type === 'mainImg') {
        el = document.querySelector('#layer-main img');
      }
      if (el) {
        this.selectedElement = el;
        this.updateBoundingBox();
      }
    });
  }

  stopDrag() {
    if (this.isDragging) { this.isDragging = false; this.hideInfo(); }
  }

  // ─── ROTATE ───
  startRotate(e) {
    this.isRotating = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.rotateHandle.style.cursor = 'grabbing';
    this.showInfo(e.clientX, e.clientY, 'Rotating...');
    e.preventDefault();
  }

  onRotate(e) {
    if (!this.isRotating) return;
    const dx = e.clientX - this.lastX;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    const deltaRot = dx * 0.5;

    if (this.selectedType === 'icon') {
      const icon = state.icons.find(i => i.id === this.selectedId);
      if (icon) {
        icon.rot = (icon.rot || 0) + deltaRot;
        const rotIn = document.querySelector(`.icon-rot[data-id="${this.selectedId}"]`);
        if (rotIn) {
          rotIn.value = Math.round(icon.rot);
          const span = rotIn.closest('.range-row')?.querySelector('.range-val');
          if (span) span.textContent = Math.round(icon.rot) + '°';
        }
        renderIcons();
        this.refreshSelection('icon');
      }
    } else if (this.selectedType === 'text') {
      const text = state.textBlocks.find(t => t.id === this.selectedId);
      if (text) {
        text.rot = (text.rot || 0) + deltaRot;
        const rotIn = document.querySelector(`.tb-rot[data-id="${this.selectedId}"]`);
        if (rotIn) rotIn.value = Math.round(text.rot);
        renderTextContent();
        this.refreshSelection('text');
      }
    } else if (this.selectedType === 'mainImg') {
      const rotIn = document.getElementById('mainImgRot');
      if (rotIn) {
        rotIn.value = Math.round(parseFloat(rotIn.value) + deltaRot);
        updateMainImg();
        this.refreshSelection('mainImg');
      }
    }
    this.showInfo(e.clientX, e.clientY, `Rot: ${Math.round(deltaRot)}°`);
  }

  stopRotate() {
    if (this.isRotating) { this.isRotating = false; this.rotateHandle.style.cursor = 'grab'; this.hideInfo(); }
  }

  // ─── RESIZE ───
  startResize(e) {
    this.isResizing = true;
    this.resizeCorner = e.target.getAttribute('data-corner');
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.showInfo(e.clientX, e.clientY, 'Resizing...');
    e.preventDefault();
  }

  onResize(e) {
    if (!this.isResizing) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    const canvas = document.getElementById('canvas');
    const scale = parseFloat(canvas?.style?.transform?.match(/scale\(([^)]+)\)/)?.[1] || 1);

    if (this.selectedType === 'icon') {
      const icon = state.icons.find(i => i.id === this.selectedId);
      if (icon) {
        const delta = ((Math.abs(dx) + Math.abs(dy)) / scale) * 0.5;
        const sign = (dx + dy) >= 0 ? 1 : -1;
        icon.size = Math.min(600, Math.max(20, Math.round((icon.size || 150) + delta * sign)));
        const sizeIn = document.querySelector(`.icon-size[data-id="${this.selectedId}"]`);
        if (sizeIn) {
          sizeIn.value = icon.size;
          const span = sizeIn.closest('.range-row')?.querySelector('.range-val');
          if (span) span.textContent = icon.size + 'px';
        }
        renderIcons();
        this.refreshSelection('icon');
        this.showInfo(e.clientX, e.clientY, `Size: ${icon.size}px`);
      }
    } else if (this.selectedType === 'text') {
      const text = state.textBlocks.find(t => t.id === this.selectedId);
      if (text) {
        const delta = ((Math.abs(dx) + Math.abs(dy)) / scale) * 0.3;
        const sign = (dx + dy) >= 0 ? 1 : -1;
        text.size = Math.min(200, Math.max(8, Math.round((text.size || 16) + delta * sign)));
        const sizeIn = document.querySelector(`.tb-size[data-id="${this.selectedId}"]`);
        if (sizeIn) {
          sizeIn.value = text.size;
          const span = sizeIn.closest('.range-row')?.querySelector('.range-val');
          if (span) span.textContent = text.size + 'px';
        }
        renderTextContent();
        this.refreshSelection('text');
        this.showInfo(e.clientX, e.clientY, `Size: ${text.size}px`);
      }
    } else if (this.selectedType === 'mainImg') {
      const wIn = document.getElementById('mainImgW');
      const hIn = document.getElementById('mainImgH');
      if (wIn && hIn) {
        const dXPct = (dx / (CW * scale)) * 100;
        const dYPct = (dy / (CH * scale)) * 100;
        let nw = Math.min(200, Math.max(10, Math.round(parseFloat(wIn.value) + dXPct)));
        let nh = Math.min(200, Math.max(10, Math.round(parseFloat(hIn.value) + dYPct)));
        wIn.value = nw;
        hIn.value = nh;
        updateMainImg();
        this.refreshSelection('mainImg');
        this.showInfo(e.clientX, e.clientY, `W:${nw}% H:${nh}%`);
      }
    }
  }

  stopResize() {
    if (this.isResizing) { this.isResizing = false; this.resizeCorner = null; this.hideInfo(); }
  }

  deleteSelected() {
    if (!this.selectedId) return;
    if (this.selectedType === 'icon') { if (confirm('Delete this icon?')) removeIcon(this.selectedId); }
    else if (this.selectedType === 'text') { if (confirm('Delete this text block?')) removeTextBlock(this.selectedId); }
    this.clearSelection();
  }

  clearSelection() {
    this.selectedElement = null;
    this.selectedType = null;
    this.selectedId = null;
    this.showControls(false);
  }

  showInfo(x, y, text) {
    this.infoTooltip.style.left = (x + 15) + 'px';
    this.infoTooltip.style.top = (y + 15) + 'px';
    this.infoTooltip.style.display = 'block';
    this.infoTooltip.innerHTML = text;
  }
  hideInfo() { this.infoTooltip.style.display = 'none'; }

  handleGlobalMouseMove(e) {
    if (this.isDragging) this.onDrag(e);
    if (this.isRotating) this.onRotate(e);
    if (this.isResizing) this.onResize(e);
  }
}

let transformControls;

// ─── Make elements selectable ───
function makeElementsSelectable() {
  if (!transformControls) return;

  const iconLayer = document.getElementById('layer-icons');
  if (iconLayer) {
    iconLayer.querySelectorAll('img').forEach((img) => {
      const idAttr = img.getAttribute('data-id');
      const icon = idAttr
        ? state.icons.find(i => i.id === parseInt(idAttr))
        : state.icons.find(i => !iconLayer.querySelector(`img[data-id="${i.id}"]`));
      if (icon && !idAttr) img.setAttribute('data-id', icon.id);
      if (!img.hasAttribute('data-selectable')) {
        img.setAttribute('data-selectable', 'true');
        img.style.cursor = 'move';
        img.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          const id = parseInt(img.getAttribute('data-id'));
          if (id) { transformControls.selectElement(img, 'icon', id); transformControls.startDrag(e); }
        });
      }
    });
  }

  const textLayer = document.getElementById('layer-text');
  if (textLayer) {
    textLayer.querySelectorAll(':scope > div').forEach((div) => {
      const idAttr = div.getAttribute('data-id');
      const text = idAttr
        ? state.textBlocks.find(t => t.id === parseInt(idAttr))
        : state.textBlocks.find(t => !textLayer.querySelector(`div[data-id="${t.id}"]`));
      if (text && !idAttr) div.setAttribute('data-id', text.id);
      if (!div.hasAttribute('data-selectable')) {
        div.setAttribute('data-selectable', 'true');
        div.style.cursor = 'move';
        div.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          const id = parseInt(div.getAttribute('data-id'));
          if (id) { transformControls.selectElement(div, 'text', id); transformControls.startDrag(e); }
        });
      }
    });
  }

  const mainLayer = document.getElementById('layer-main');
  if (mainLayer) {
    const mainImg = mainLayer.querySelector('img');
    if (mainImg && !mainImg.hasAttribute('data-selectable')) {
      mainImg.setAttribute('data-selectable', 'true');
      mainImg.style.cursor = 'move';
      mainImg.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        transformControls.selectElement(mainImg, 'mainImg', 'main');
        transformControls.startDrag(e);
      });
    }
  }
}

// ─── Hook into render functions AFTER designer.js loads ───
// Use a MutationObserver to watch for DOM changes instead of overriding
function setupRenderHooks() {
  const observer = new MutationObserver((mutations) => {
    let needsReattach = false;
    for (const m of mutations) {
      if (m.type === 'childList' && (m.target.id === 'layer-icons' || m.target.id === 'layer-text' || m.target.id === 'layer-main')) {
        needsReattach = true;
      }
    }
    if (needsReattach) {
      makeElementsSelectable();
      // If we had a selection, try to refresh it
      if (transformControls && transformControls.selectedId) {
        transformControls.refreshSelection(transformControls.selectedType);
      }
    }
  });

  const canvas = document.getElementById('canvas');
  if (canvas) {
    observer.observe(canvas, { childList: true, subtree: true });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  transformControls = new TransformControls();

  window.addEventListener('mousemove', (e) => {
    if (transformControls) transformControls.handleGlobalMouseMove(e);
  });

  const canvas = document.getElementById('canvas');
  if (canvas) {
    canvas.addEventListener('mousedown', (e) => {
      if (e.target === canvas || e.target.classList.contains('canvas-layer')) {
        transformControls.clearSelection();
      }
    });
  }

  // Initial setup
  setTimeout(() => {
    makeElementsSelectable();
    setupRenderHooks();
  }, 500);
});
