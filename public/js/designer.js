// ============================================================
// designer.js — v4.2 (With Controller Integration)
// ============================================================
const state = {
bg: { type:'solid', color:'#0A0A14', c1:'#1a0533', c2:'#0d1f4a', c3:'#0a1a0a', angle:135, s1:0, s2:50, s3:100, radShape:'circle' },
imgBg: { src:'none', url:'', size:'cover', pos:'center', opacity:100, overlay:0 },
mainImg: { src:'none', url:'', w:80, h:70, x:50, y:50, rot:0, opacity:100, blend:'normal' },
icons: [],
brands: [],
textBlocks: [],
textPadX: 60, textPadY: 60, textVAlign: 'flex-start',
logo: { src:'none', url:'', w:200, h:0, anchor:'bl', mx:50, my:50, opacity:100 }
};
let iconCounter=0, brandCounter=0, textCounter=0;
let imgSrcType='url', imgBgSize='cover';
let mainImgSrcType='url';
let logoSrcType='url', logoAnchor='bl';
let apiModeActive = false;
let CW=1080, CH=1350;
const FONTS = ['DM Sans','Space Mono','Bebas Neue','Playfair Display','Oswald','Montserrat','Raleway','Syne'];
const processedRequests = new Map();
const REQUEST_DEDUP_TIMEOUT = 5000;
function toggleLayer(layerId) {
document.getElementById(layerId).classList.toggle('open');
}
let currentEditContext = null;
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
if (request.action === 'applyDesign') {
currentEditContext = { postId: request.postId, slideIndex: request.slideIndex };
applyDesign(request.designSpec).then(() => {
if (request.designSpec.slideMetadata) {
window.currentSlideMetadata = request.designSpec.slideMetadata;
}
sendResponse({ success: true });
});
return true;
}
if (request.action === 'saveEditedSlide') {
handleSaveEditedSlide().then(res => sendResponse(res)).catch(err => sendResponse({ success: false, error: err.message }));
return true;
}
if (request.action === 'exportPNG') {
exportPNG(request.filename).then(() => sendResponse({ success: true }));
return true;
}
});
}
async function handleSaveEditedSlide() {
if (!currentEditContext) return { success: false, error: 'No edit context' };
setApiStatus('active', 'Saving edit...');
try {
const newDesignSpec = saveCurrentAsSpec();
const oc = await renderToCanvas(2);
const newDataUrl = oc.toDataURL('image/png');
await chrome.runtime.sendMessage({
action: 'slideDesignUpdated',
postId: currentEditContext.postId,
slideIndex: currentEditContext.slideIndex,
newDesignSpec,
newDataUrl
});
setApiStatus('ready', 'Edit saved successfully');
return { success: true };
} catch (error) {
setApiStatus('idle', `Save failed: ${error.message}`);
return { success: false, error: error.message };
}
}
function resizeCanvas() {
CW = +document.getElementById('canvasW').value || 1080;
CH = +document.getElementById('canvasH').value || 1350;
const c = document.getElementById('canvas');
c.style.width = CW + 'px';
c.style.height = CH + 'px';
scaleCanvas();
}
function setPreset(w, h) {
document.getElementById('canvasW').value = w;
document.getElementById('canvasH').value = h;
resizeCanvas();
}
function scaleCanvas() {
const area = document.querySelector('.canvas-area');
const aw = area.clientWidth - 48;
const ah = area.clientHeight - 60;
const scale = Math.min(aw/CW, ah/CH, 1);
document.getElementById('canvas').style.transform = `scale(${scale})`;
document.getElementById('canvasWrap').style.width  = Math.round(CW * scale) + 'px';
document.getElementById('canvasWrap').style.height = Math.round(CH * scale) + 'px';
document.getElementById('canvasInfo').textContent = `Scale: ${Math.round(scale*100)}% · ${CW}×${CH}px`;
}
function setBgType(type) {
state.bg.type = type;
document.querySelectorAll('#bgTypeRow .radio-btn').forEach(btn => btn.classList.remove('active'));
document.querySelector(`#bgTypeRow .radio-btn[data-val="${type}"]`).classList.add('active');
document.getElementById('bgSolidFields').style.display  = type === 'solid'  ? 'flex' : 'none';
document.getElementById('bgGradFields').style.display   =  type !== 'solid'  ? 'flex' : 'none';
document.getElementById('angleField').style.display     = type === 'linear' ? 'flex' : 'none';
document.getElementById('radialShapeField').style.display = type === 'radial' ? 'flex' : 'none';
updateBG();
}
function setRadShape(shape) {
state.bg.radShape = shape;
document.querySelectorAll('#radShapeRow .radio-btn').forEach(btn => btn.classList.remove('active'));
document.querySelector(`#radShapeRow .radio-btn[data-shape="${shape}"]`).classList.add('active');
updateBG();
}
function updateBG() {
const s = state.bg;
s.color = document.getElementById('bgColor').value;
s.c1 = document.getElementById('bgC1').value; 
s.c2 = document.getElementById('bgC2').value;
s.c3 = document.getElementById('bgC3').value;
s.angle = document.getElementById('bgAngle').value;
s.s1 = document.getElementById('bgS1').value;
s.s2 = document.getElementById('bgS2').value;
s.s3 = document.getElementById('bgS3').value;
const bg = document.getElementById('layer-bg');
if (s.type === 'solid') bg.style.background = s.color;
else if (s.type === 'linear') bg.style.background = `linear-gradient(${s.angle}deg, ${s.c1} ${s.s1}%, ${s.c2} ${s.s2}%, ${s.c3} ${s.s3}%)`;
else bg.style.background = `radial-gradient(${s.radShape} at 50% 50%, ${s.c1} ${s.s1}%, ${s.c2} ${s.s2}%, ${s.c3} ${s.s3}%)`;
}
function setImgSrcType(type) {
imgSrcType = type;
document.querySelectorAll('#imgSrcTypeRow .radio-btn').forEach(btn => btn.classList.remove('active'));
document.querySelector(`#imgSrcTypeRow .radio-btn[data-src="${type}"]`).classList.add('active');
document.getElementById('imgUrlField').style.display  = type === 'url'  ? 'block' : 'none';
document.getElementById('imgFileField').style.display = type  === 'file' ? 'block' : 'none';
if (type === 'none') document.getElementById('layer-imgbg').style.backgroundImage = 'none';
}
function setImgSize(size) {
imgBgSize = size;
document.querySelectorAll('#imgSizeRow .radio-btn').forEach(btn => btn.classList.remove('active'));
document.querySelector(`#imgSizeRow .radio-btn[data-size="${size}"]`).classList.add('active');
updateImgBG();
}
function updateImgBG() {
const el = document.getElementById('layer-imgbg');
const url = document.getElementById('bgImgUrl').value.trim();
const pos = document.getElementById('bgImgPos').value;
const op  = document.getElementById('bgImgOpacity').value / 100;
const ov  = document.getElementById('bgImgOverlay').value  / 100;
if (imgSrcType === 'url' && url) {
el.style.backgroundImage = `url(${url})`;
el.style.backgroundSize = imgBgSize;
el.style.backgroundPosition = pos;
el.style.opacity = op;
}
document.getElementById('layer-imgbg-overlay').style.background = `rgba(0,0,0,${ov})`;
}
function loadImgFile(input) {
const file = input.files[0]; if (!file) return;
const reader = new FileReader();
reader.onload = e => {
const el = document.getElementById('layer-imgbg');
el.style.backgroundImage = `url(${e.target.result})`;
el.style.backgroundSize = imgBgSize;
el.style.backgroundPosition = document.getElementById('bgImgPos').value;
el.style.opacity = document.getElementById('bgImgOpacity').value / 100;
};
reader.readAsDataURL(file);
}
function setMainImgSrc(type) {
mainImgSrcType = type;
document.querySelectorAll('#mainImgSrcRow .radio-btn').forEach(btn => btn.classList.remove('active'));
document.querySelector(`#mainImgSrcRow .radio-btn[data-src="${type}"]`).classList.add('active');
document.getElementById('mainImgUrlField').style.display  = type === 'url'  ? 'block' : 'none';
document.getElementById('mainImgFileField').style.display   = type === 'file' ? 'block' : 'none';
if (type === 'none') document.getElementById('layer-main').innerHTML = '';
}
function updateMainImg() {
const url  = document.getElementById('mainImgUrl').value.trim();
const w    = document.getElementById('mainImgW').value;
const h    = document.getElementById('mainImgH').value;
const x    = document.getElementById('mainImgX').value;
const y    = document.getElementById('mainImgY').value;
const rot  = document.getElementById('mainImgRot').value;
const op   = document.getElementById('mainImgOpacity').value / 100;
const blend= document.getElementById('mainImgBlend').value;
if (!url && mainImgSrcType === 'url') return;
renderMainImg(url, w, h, x, y, rot, op, blend);
}
function renderMainImg(src, w, h, x, y, rot, op, blend) {
const layer = document.getElementById('layer-main');
layer.style.cssText = `position:absolute;top:${y}%;left:${x}%;transform:translate(-50%,-50%);`;
layer.innerHTML = '';
const img = document.createElement('img');
img.src = src;
img.crossOrigin = 'anonymous';
img.addEventListener('error', () => { img.style.display = 'none'; });
img.style.cssText = `width:${w}%;max-height:${h}%;object-fit:contain;transform:rotate(${rot}deg);opacity:${op};mix-blend-mode:${blend};display:block;`;
layer.appendChild(img);
}
function loadMainImgFile(input) {
const file = input.files[0]; if (!file) return;
const reader = new FileReader();
reader.onload = e => {
renderMainImg(e.target.result,
document.getElementById('mainImgW').value,
document.getElementById('mainImgH').value,
document.getElementById('mainImgX').value,
document.getElementById('mainImgY').value,
document.getElementById('mainImgRot').value,
document.getElementById('mainImgOpacity').value / 100,
document.getElementById('mainImgBlend').value);
};
reader.readAsDataURL(file);
}
function addIcon() {
const id = ++iconCounter;
state.icons.push({ id, src:'', x:50, y:50, size:150, rot:0, opacity:100 });
renderIconControls();
}
function removeIcon(id) {
state.icons = state.icons.filter(i => i.id !== id);
renderIconControls(); renderIcons();
}
function renderIconControls() {
const list = document.getElementById('iconList');
if (!state.icons.length) {
list.innerHTML = '<div class="hint" style="text-align:center;padding:8px;">No icons yet</div>';
return;
}
list.innerHTML = state.icons.map(icon => `<div class="item-card" data-icon-id="${icon.id}"> <button class="del" data-action="remove-icon" data-id="${icon.id}">✕</button> <div class="field"><label class="lbl">URL or File</label><input type="url" class="icon-url" data-id="${icon.id}" value="${icon.src}" placeholder="https://...png"></div> <div style="margin-top:4px;"><label class="lbl" style="display:block;margin-bottom:3px;">or Upload</label><input type="file" class="icon-file" data-id="${icon.id}" accept="image/*" style="color:var(--muted2);font-size:10px;"></div> <div class="field-row"> <div class="field"><label class="lbl">X %</label><input type="number" class="icon-x" data-id="${icon.id}" value="${icon.x}" min="0" max="100"></div> <div class="field"><label class="lbl">Y %</label><input type="number" class="icon-y" data-id="${icon.id}" value="${icon.y}" min="0" max="100"></div> </div> <div class="field"><label class="lbl">Size (px)</label><div class="range-row"><input type="range" class="icon-size" data-id="${icon.id}" min="20" max="600" value="${icon.size}"><span class="range-val">${icon.size}px</span></div></div> <div class="field"><label class="lbl">Rotation °</label><div class="range-row"><input type="range" class="icon-rot" data-id="${icon.id}" min="-180" max="180" value="${icon.rot}"><span class="range-val">${icon.rot}°</span></div></div> <div class="field"><label class="lbl">Opacity</label><div class="range-row"><input type="range" class="icon-op" data-id="${icon.id}" min="0" max="100" value="${icon.opacity}"><span class="range-val">${icon.opacity}%</span></div></div> </div>`).join('');
document.querySelectorAll('.icon-url').forEach(el => { el.removeEventListener('input', handleIconUrlInput); el.addEventListener('input', handleIconUrlInput); });
document.querySelectorAll('.icon-file').forEach(el => { el.removeEventListener('change', handleIconFileChange); el.addEventListener('change', handleIconFileChange); });
document.querySelectorAll('.icon-x, .icon-y, .icon-size, .icon-rot, .icon-op').forEach(el => { el.removeEventListener('input', handleIconChange); el.addEventListener('input', handleIconChange); });
document.querySelectorAll('.item-card .del[data-action="remove-icon"]').forEach(el => { el.removeEventListener('click', handleRemoveIcon); el.addEventListener('click', handleRemoveIcon); });
}
function handleIconUrlInput(e) {
const id = +e.target.dataset.id;
const icon = state.icons.find(i => i.id === id);
if (icon) icon.src = e.target.value;
renderIcons(); reassertLogo();
}
function handleIconFileChange(e) {
const id = +e.target.dataset.id;
const file = e.target.files[0]; if (!file) return;
const reader = new FileReader();
reader.onload = ev => {
const icon = state.icons.find(i => i.id === id);
if (icon) { icon.src = ev.target.result; renderIcons(); reassertLogo(); }
};
reader.readAsDataURL(file);
}
function handleIconChange(e) {
const id = +e.target.dataset.id;
const icon = state.icons.find(i => i.id === id); if (!icon) return;
if (e.target.classList.contains('icon-x')) icon.x = parseInt(e.target.value);
if (e.target.classList.contains('icon-y')) icon.y = parseInt(e.target.value);
if (e.target.classList.contains('icon-size')) icon.size = parseInt(e.target.value);
if (e.target.classList.contains('icon-rot')) icon.rot = parseInt(e.target.value);
if (e.target.classList.contains('icon-op')) icon.opacity = parseInt(e.target.value);
renderIcons(); reassertLogo();
const parent = e.target.closest('.range-row');
if (parent) {
const span = parent.querySelector('.range-val');
if (span) span.textContent = e.target.value + (e.target.classList.contains('icon-op') ? '%' : (e.target.classList.contains('icon-rot') ? '°' : 'px'));
}
}
function handleRemoveIcon(e) { removeIcon(+e.target.dataset.id); }
function renderIcons() {
const layer = document.getElementById('layer-icons');
layer.innerHTML = '';
state.icons.filter(i => i.src).forEach(icon => {
const img = document.createElement('img');
img.src = icon.src;
img.crossOrigin = 'anonymous';
img.addEventListener('error', () => { img.style.display = 'none'; });
img.setAttribute('data-designer-type', 'icon');
img.setAttribute('data-designer-id', icon.id);
img.style.cssText = `position:absolute;left:${icon.x}%;top:${icon.y}%;width:${icon.size}px;height:${icon.size}px;object-fit:contain;transform:translate(-50%,-50%) rotate(${icon.rot}deg);opacity:${icon.opacity/100};`;
layer.appendChild(img);
});
}
function addBrand() {
const id = ++brandCounter;
state.brands.push({ id, text:'Brand Name', x:50, y:95, size:32, color:'#ffffff', font:'DM Sans', weight:700, opacity:100, align:'center', letterSpacing:2, bgStyle:'' });
renderBrandControls();
}
function removeBrand(id) {
state.brands = state.brands.filter(b => b.id !== id);
renderBrandControls(); renderBrands();
}
function renderBrandControls() {
const list = document.getElementById('brandList');
if (!state.brands.length) {
list.innerHTML = '<div class="hint" style="text-align:center;padding:8px;">No brand elements yet</div>';
return;
}
list.innerHTML = state.brands.map(b => `<div class="item-card" data-brand-id="${b.id}"> <button class="del" data-action="remove-brand" data-id="${b.id}">✕</button> <div class="field"><label class="lbl">Text</label><input type="text" class="brand-text" data-id="${b.id}" value="${b.text}"></div> <div class="field-row"> <div class="field"><label class="lbl">X %</label><input type="number" class="brand-x" data-id="${b.id}" value="${b.x}" min="0" max="100"></div> <div class="field"><label class="lbl">Y %</label><input type="number" class="brand-y" data-id="${b.id}" value="${b.y}" min="0" max="100"></div> </div> <div class="field-row"> <div class="field"><label class="lbl">Size (px)</label><input type="number" class="brand-size" data-id="${b.id}" value="${b.size}" min="8" max="300"></div> <div class="field"><label class="lbl">Weight</label> <select class="brand-weight" data-id="${b.id}"> <option value="300" ${b.weight===300?'selected':''}>Light</option> <option value="400" ${b.weight===400?'selected':''}>Regular</option> <option value="600" ${b.weight===600?'selected':''}>Semi</option> <option value="700" ${b.weight===700?'selected':''}>Bold</option> <option value="900" ${b.weight===900?'selected':''}>Black</option> </select> </div> </div> <div class="field-row"> <div class="field"><label class="lbl">Color</label><input type="color" class="brand-color" data-id="${b.id}" value="${b.color}"></div> <div class="field"><label class="lbl">BG Color</label><input type="color" class="brand-bgcolor" data-id="${b.id}" value="#000000"></div> </div> <div class="field-row"> <div class="field"><label class="lbl">BG Alpha</label><input type="number" class="brand-bga" data-id="${b.id}" value="0" min="0" max="100"></div> <div class="field"><label class="lbl">Radius px</label><input type="number" class="brand-radius" data-id="${b.id}" value="0" min="0" max="100"></div> </div> <div class="field"><label class="lbl">Font</label> <select class="brand-font" data-id="${b.id}"> ${FONTS.map(f => `<option ${f===b.font?'selected':''}>${f}</option>`).join('')} </select> </div> <div class="field"><label class="lbl">Letter Spacing (px)</label><input type="number" class="brand-ls" data-id="${b.id}" value="${b.letterSpacing}" min="-5" max="30"></div> <div class="field"><label class="lbl">Align</label> <div class="radio-row brand-align-row" data-id="${b.id}"> <div class="radio-btn ${b.align==='left'?'active':''}" data-align="left">L</div> <div class="radio-btn ${b.align==='center'?'active':''}" data-align="center">C</div> <div class="radio-btn ${b.align==='right'?'active':''}" data-align="right">R</div> </div> </div> <div class="field"><label class="lbl">Opacity</label> <div class="range-row"><input type="range" class="brand-op" data-id="${b.id}" min="0" max="100" value="${b.opacity}"><span class="range-val">${b.opacity}%</span></div> </div> </div>`).join('');
document.querySelectorAll('.brand-text, .brand-x, .brand-y, .brand-size, .brand-weight, .brand-color, .brand-font, .brand-ls, .brand-op, .brand-bgcolor, .brand-bga, .brand-radius').forEach(el => {
el.removeEventListener('input', handleBrandChange); el.addEventListener('input', handleBrandChange);
el.removeEventListener('change', handleBrandChange); el.addEventListener('change', handleBrandChange);
});
document.querySelectorAll('.brand-align-row .radio-btn').forEach(el => { el.removeEventListener('click', handleBrandAlign); el.addEventListener('click', handleBrandAlign); });
document.querySelectorAll('.item-card .del[data-action="remove-brand"]').forEach(el => { el.removeEventListener('click', handleRemoveBrand); el.addEventListener('click', handleRemoveBrand); });
}
function handleBrandChange(e) {
const id = +e.target.dataset.id;
const b = state.brands.find(b => b.id === id); if (!b) return;
if (e.target.classList.contains('brand-text')) b.text = e.target.value;
if (e.target.classList.contains('brand-x')) b.x = parseInt(e.target.value);
if (e.target.classList.contains('brand-y')) b.y = parseInt(e.target.value);
if (e.target.classList.contains('brand-size')) b.size = parseInt(e.target.value);
if (e.target.classList.contains('brand-weight')) b.weight = parseInt(e.target.value);
if (e.target.classList.contains('brand-color')) b.color = e.target.value;
if (e.target.classList.contains('brand-font')) b.font = e.target.value;
if (e.target.classList.contains('brand-ls')) b.letterSpacing = parseInt(e.target.value);
if (e.target.classList.contains('brand-op')) b.opacity = parseInt(e.target.value);
if (e.target.classList.contains('brand-bgcolor') || e.target.classList.contains('brand-bga') || e.target.classList.contains('brand-radius')) {
const bgColor   = document.querySelector(`.brand-bgcolor[data-id="${id}"]`)?.value || '#000000';
const bgAlpha  = parseInt(document.querySelector(`.brand-bga[data-id="${id}"]`)?.value || 0) / 100;
const bgRadius = parseInt(document.querySelector(`.brand-radius[data-id="${id}"]`)?.value || 0);
const hex2rgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
const [r,g,bv] = hex2rgb(bgColor);
b.bgStyle = bgAlpha > 0 ? `background:rgba(${r},${g},${bv},${bgAlpha});border-radius:${bgRadius}px;padding:8px 16px;` : '';
}
renderBrands(); reassertLogo();
if (e.target.classList.contains('brand-op')) {
const parent = e.target.closest('.range-row');
if (parent) parent.querySelector('.range-val').textContent = e.target.value + '%';
}
}
function handleBrandAlign(e) {
const id = +e.target.closest('.brand-align-row').dataset.id;
const align = e.target.dataset.align;
const b = state.brands.find(b => b.id === id);
if (b) {
b.align = align;
e.target.closest('.radio-row').querySelectorAll('.radio-btn').forEach(btn => btn.classList.remove('active'));
e.target.classList.add('active');
renderBrands(); reassertLogo();
}
}
function handleRemoveBrand(e) { removeBrand(+e.target.dataset.id); }
function renderBrands() {
const layer = document.getElementById('layer-brand');
layer.innerHTML = state.brands.map(b => 
`<div data-designer-type="brand" data-designer-id="${b.id}" style="position:absolute;left:${b.x}%;top:${b.y}%;transform:translate(-50%,-50%); opacity:${b.opacity/100};${b.bgStyle||''}"> <span style="font-family:'${b.font}',sans-serif;font-size:${b.size}px;font-weight:${b.weight}; color:${b.color};letter-spacing:${b.letterSpacing}px;text-align:${b.align}; display:block;white-space:nowrap;">${b.text}</span> </div>`
).join('');
}
const BLOCK_DEFAULTS = {
headline: { text:'YOUR BIG HEADLINE', size:110, font:'Bebas Neue', weight:'700', color:'#ffffff', lineH:0.95, letterSpacing:3, mb:20, align:'center', opacity:100, textTransform:'uppercase', textShadow:'none', bgColor:'', bgAlpha:0, bgPad:0, bgRadius:0, underline:false, x:50, y:30, rot:0 },
title:    { text:'Your Title Here', size:72, font:'Montserrat', weight:'700', color:'#ffffff', lineH:1.1, letterSpacing:0, mb:16, align:'left', opacity:100, textTransform:'none', textShadow:'none', bgColor:'', bgAlpha:0, bgPad:0, bgRadius:0, underline:false, x:50, y:25, rot:0 },
subtitle: { text:'Your subtitle here', size:36, font:'DM Sans', weight:'400', color:'#cccccc', lineH:1.3, letterSpacing:1, mb:24, align:'center', opacity:100, textTransform:'none', textShadow:'none', bgColor:'', bgAlpha:0, bgPad:0, bgRadius:0, underline:false, x:50, y:55, rot:0 },
body:     { text:'Body text goes here.', size:28, font:'DM Sans', weight:'400', color:'#cccccc', lineH:1.6, letterSpacing:0, mb:20, align:'left', opacity:100, textTransform:'none', textShadow:'none', bgColor:'', bgAlpha:0, bgPad:0, bgRadius:0, underline:false, x:50, y:65, rot:0 },
bullet:   { text:'First bullet\nSecond bullet\nThird bullet', size:30, font:'DM Sans', weight:'500', color:'#ffffff', lineH:1.4, letterSpacing:0, mb:20, align:'left', opacity:100, bulletStyle:'symbol', bulletSymbol:'—', bulletEmoji:'', bulletImgUrl:'', bulletImgSize:28, bulletGap:20, bulletColor:'#4dffa0', bulletSize:28, textTransform:'none', textShadow:'none', bgColor:'', bgAlpha:0, bgPad:0, bgRadius:0, underline:false, x:50, y:65, rot:0 }
};
function nextDefaultY(type) {
const base = BLOCK_DEFAULTS[type]?.y ?? 50;
const existing = state.textBlocks.map(b => b.y).sort((a,b) => a-b);
let y = base;
for (const ey of existing) { if (Math.abs(ey - y) < 12) y = ey + 14; }
return Math.min(90, Math.round(y));
}
function addBlock(type) {
const id = ++textCounter;
const def = BLOCK_DEFAULTS[type] || BLOCK_DEFAULTS.body;
state.textBlocks.push({ id, type, ...JSON.parse(JSON.stringify(def)), x: 50, y: nextDefaultY(type), rot: 0 });
renderTextControls(); renderTextContent(); reassertLogo();
}
function removeTextBlock(id) {
state.textBlocks = state.textBlocks.filter(t => t.id !== id);
renderTextControls(); renderTextContent(); reassertLogo();
}
function moveBlock(id, dir) {
const i = state.textBlocks.findIndex(t => t.id === id);
const j = i + dir;
if (j < 0 || j >= state.textBlocks.length) return;
[state.textBlocks[i], state.textBlocks[j]] = [state.textBlocks[j], state.textBlocks[i]];
renderTextControls(); renderTextContent();
}
const TYPE_LABELS = { headline:'Headline', title:'Title', subtitle:'Subtitle', body:'Body Text', bullet:'Bullets' };
const TYPE_COLORS = { headline:'#ef4444', title:'#5b8def', subtitle:'#a78bfa', body:'#6b7a9e', bullet:'#34d399' };
function renderTextControls() {
const list = document.getElementById('textBlockList');
if (!state.textBlocks.length) {
list.innerHTML = '<div class="hint" style="text-align:center;padding:8px;">No text blocks yet</div>';
return;
}
list.innerHTML = state.textBlocks.map((t, idx) => {
const col = TYPE_COLORS[t.type] || '#888';
const isBullet = t.type === 'bullet';
return `<div class="item-card" data-text-id="${t.id}" style="border-left:2px solid ${col};"> <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;"> <span style="font-family:var(--mono);font-size:9px;font-weight:700;color:${col};background:${col}22;padding:2px 7px;border-radius:3px;">${TYPE_LABELS[t.type]||t.type}</span> <span style="font-family:var(--mono);font-size:9px;color:var(--muted2);">#${idx+1}</span> <button class="move-up" data-id="${t.id}" style="margin-left:auto;background:var(--s3);border:1px solid var(--border);color:var(--muted2);border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">↑</button> <button class="move-down" data-id="${t.id}" style="background:var(--s3);border:1px solid var(--border);color:var(--muted2);border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">↓</button> <button class="del-text" data-id="${t.id}" style="position:static;background:rgba(239,68,68,.1);border:none;color:#ef4444;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;">✕</button> </div> <div class="field-row" style="background:rgba(77,255,160,0.05);padding:6px;border-radius:4px;border:1px dashed rgba(77,255,160,0.2);margin-bottom:6px;"> <div class="field"><label class="lbl">X %</label><input type="number" class="tb-x" data-id="${t.id}" value="${t.x ?? 50}" min="0" max="100" step="0.1"></div> <div class="field"><label class="lbl">Y %</label><input type="number" class="tb-y" data-id="${t.id}" value="${t.y ?? 50}" min="0" max="100" step="0.1"></div> <div class="field"><label class="lbl">Rotation °</label><input type="number" class="tb-rot" data-id="${t.id}" value="${t.rot ?? 0}" min="-180" max="180" step="1"></div> </div> <div class="field"><label class="lbl">Content</label><textarea class="tb-text" data-id="${t.id}">${t.text}</textarea></div> <div class="field-row"> <div class="field"><label class="lbl">Size px</label><input type="number" class="tb-size" data-id="${t.id}" value="${t.size}" min="8" max="500"></div> <div class="field"><label class="lbl">Weight</label> <select class="tb-weight" data-id="${t.id}"> <option value="300" ${t.weight==='300'?'selected':''}>Light</option> <option value="400" ${t.weight==='400'?'selected':''}>Regular</option> <option value="600" ${t.weight==='600'?'selected':''}>Semi</option> <option value="700" ${t.weight==='700'?'selected':''}>Bold</option> <option value="900" ${t.weight==='900'?'selected':''}>Black</option> </select> </div> </div> <div class="field-row"> <div class="field"><label class="lbl">Color</label><input type="color" class="tb-color" data-id="${t.id}" value="${t.color}"></div> <div class="field"><label class="lbl">Line Height</label><input type="number" class="tb-lh" data-id="${t.id}" value="${t.lineH}" min="0.7" max="4" step="0.05"></div> </div> <div class="field"><label class="lbl">Font</label> <select class="tb-font" data-id="${t.id}"> ${FONTS.map(f => `<option ${f===t.font?'selected':''}>${f}</option>`).join('')} </select> </div> <div class="field"><label class="lbl">Align</label> <div class="radio-row tb-align-row" data-id="${t.id}"> <div class="radio-btn ${t.align==='left'?'active':''}" data-align="left">Left</div> <div class="radio-btn ${t.align==='center'?'active':''}" data-align="center">Center</div> <div class="radio-btn ${t.align==='right'?'active':''}" data-align="right">Right</div> </div> </div> <div class="field-row"> <div class="field"><label class="lbl">Letter Sp.</label><input type="number" class="tb-ls" data-id="${t.id}" value="${t.letterSpacing}" min="-5" max="40"></div> <div class="field"><label class="lbl">Margin B px</label><input type="number" class="tb-mb" data-id="${t.id}" value="${t.mb}" min="0" max="400"></div> </div> <div class="field"><label class="lbl">Transform</label> <div class="radio-row tb-transform-row" data-id="${t.id}"> <div class="radio-btn ${t.textTransform==='none'?'active':''}" data-transform="none">None</div> <div class="radio-btn ${t.textTransform==='uppercase'?'active':''}" data-transform="uppercase">UPPER</div> <div class="radio-btn ${t.textTransform==='lowercase'?'active':''}" data-transform="lowercase">lower</div> </div> </div> <div class="field"><label class="lbl">Text Shadow</label> <div class="radio-row tb-shadow-row" data-id="${t.id}"> <div class="radio-btn ${t.textShadow==='none'?'active':''}" data-shadow="none">None</div> <div class="radio-btn ${t.textShadow==='soft'?'active':''}" data-shadow="soft">Soft</div> <div class="radio-btn ${t.textShadow==='hard'?'active':''}" data-shadow="hard">Hard</div> <div class="radio-btn ${t.textShadow==='glow'?'active':''}" data-shadow="glow">Glow</div> </div> </div> <div class="field"><label class="lbl">Background Fill</label> <div class="field-row"> <div class="field"><label class="lbl">Color</label><input type="color" class="tb-bgc" data-id="${t.id}" value="${t.bgColor||'#000000'}"></div> <div class="field"><label class="lbl">Alpha %</label><input type="number" class="tb-bga" data-id="${t.id}" value="${t.bgAlpha||0}" min="0" max="100"></div> </div> <div class="field-row"> <div class="field"><label class="lbl">Padding px</label><input type="number" class="tb-bgp" data-id="${t.id}" value="${t.bgPad||0}" min="0" max="100"></div> <div class="field"><label class="lbl">Radius px</label><input type="number" class="tb-bgr" data-id="${t.id}" value="${t.bgRadius||0}" min="0" max="100"></div> </div> </div> <div class="field"><label class="lbl">Opacity</label> <div class="range-row"><input type="range" class="tb-op" data-id="${t.id}" min="0" max="100" value="${t.opacity}"><span class="range-val">${t.opacity}%</span></div> </div> ${isBullet ? `<div class="divider" style="margin:4px 0;"></div> <div class="field"> <label class="lbl">Bullet Style</label> <div class="radio-row tb-bullet-style-row" data-id="${t.id}"> <div class="radio-btn ${t.bulletStyle==='symbol'?'active':''}" data-bstyle="symbol">Symbol</div> <div class="radio-btn ${t.bulletStyle==='numbered'?'active':''}" data-bstyle="numbered">1 2 3</div> <div class="radio-btn ${t.bulletStyle==='emoji'?'active':''}" data-bstyle="emoji">Emoji</div> <div class="radio-btn ${t.bulletStyle==='image'?'active':''}" data-bstyle="image">Image</div> </div> </div> <div class="tb-bullet-symbol-field" style="display:${t.bulletStyle==='symbol'?'flex':'none'};flex-direction:column;gap:6px;"> <div class="field"> <label class="lbl">Symbol (any char)</label> <input type="text" class="tb-bsym" data-id="${t.id}" value="${t.bulletSymbol}" style="font-size:18px;"> </div> </div> <div class="tb-bullet-emoji-field" style="display:${t.bulletStyle==='emoji'?'flex':'none'};flex-direction:column;gap:6px;"> <div class="field"> <label class="lbl">Emoji</label> <input type="text" class="tb-bemoji" data-id="${t.id}" value="${t.bulletEmoji}" placeholder="🔥"> </div> </div> <div class="tb-bullet-image-field" style="display:${t.bulletStyle==='image'?'flex':'none'};flex-direction:column;gap:6px;"> <div class="field"> <label class="lbl">Bullet Image URL</label> <input type="url" class="tb-bimgurl" data-id="${t.id}" value="${t.bulletImgUrl}" placeholder="https://...png"> </div> <div class="field"> <label class="lbl">or Upload</label> <input type="file" class="tb-bimgfile" data-id="${t.id}" accept="image/*" style="color:var(--muted2);font-size:10px;"> </div> <div class="field"> <label class="lbl">Icon Size px</label> <input type="number" class="tb-bimgsz" data-id="${t.id}" value="${t.bulletImgSize}" min="8" max="120"> </div> </div> <div class="field-row"> <div class="field"> <label class="lbl">Bullet Color</label> <input type="color" class="tb-bcol" data-id="${t.id}" value="${t.bulletColor}"> </div> <div class="field"> <label class="lbl">Bullet Size px</label> <input type="number" class="tb-bsz" data-id="${t.id}" value="${t.bulletSize}" min="8" max="200"> </div> </div> <div class="field"> <label class="lbl">Bullet Gap px</label> <input type="number" class="tb-bgap" data-id="${t.id}" value="${t.bulletGap}" min="4" max="100"> </div> `: ''} </div>`;
}).join('');
document.querySelectorAll('.tb-text, .tb-size, .tb-weight, .tb-color, .tb-lh, .tb-font, .tb-ls, .tb-mb, .tb-op, .tb-bgc, .tb-bga, .tb-bgp, .tb-bgr, .tb-x, .tb-y, .tb-rot').forEach(el => {
el.removeEventListener('input', handleTextBlockChange); el.addEventListener('input', handleTextBlockChange);
el.removeEventListener('change', handleTextBlockChange); el.addEventListener('change', handleTextBlockChange);
});
document.querySelectorAll('.tb-align-row .radio-btn, .tb-transform-row .radio-btn, .tb-shadow-row .radio-btn, .tb-bullet-style-row .radio-btn').forEach(el => {
el.removeEventListener('click', handleTextBlockRadio); el.addEventListener('click', handleTextBlockRadio);
});
document.querySelectorAll('.tb-bsym, .tb-bemoji, .tb-bimgurl, .tb-bimgsz, .tb-bcol, .tb-bsz, .tb-bgap').forEach(el => {
el.removeEventListener('input', handleTextBlockChange); el.addEventListener('input', handleTextBlockChange);
});
document.querySelectorAll('.tb-bimgfile').forEach(el => { el.removeEventListener('change', handleBulletImgFile); el.addEventListener('change', handleBulletImgFile); });
document.querySelectorAll('.move-up').forEach(el => { el.removeEventListener('click', handleMoveUp); el.addEventListener('click', handleMoveUp); });
document.querySelectorAll('.move-down').forEach(el => { el.removeEventListener('click', handleMoveDown); el.addEventListener('click', handleMoveDown); });
document.querySelectorAll('.del-text').forEach(el => { el.removeEventListener('click', handleDeleteTextBlock); el.addEventListener('click', handleDeleteTextBlock); });
}
function handleTextBlockChange(e) {
const id = +e.target.dataset.id;
const t = state.textBlocks.find(t => t.id === id); if (!t) return;
if (e.target.classList.contains('tb-text')) t.text = e.target.value;
if (e.target.classList.contains('tb-size')) t.size = parseInt(e.target.value);
if (e.target.classList.contains('tb-weight')) t.weight = e.target.value;
if (e.target.classList.contains('tb-color')) t.color = e.target.value;
if (e.target.classList.contains('tb-lh')) t.lineH = parseFloat(e.target.value);
if (e.target.classList.contains('tb-font')) t.font = e.target.value;
if (e.target.classList.contains('tb-ls')) t.letterSpacing = parseInt(e.target.value);
if (e.target.classList.contains('tb-mb')) t.mb = parseInt(e.target.value);
if (e.target.classList.contains('tb-op')) t.opacity = parseInt(e.target.value);
if (e.target.classList.contains('tb-bgc')) t.bgColor = e.target.value;
if (e.target.classList.contains('tb-bga')) t.bgAlpha = parseInt(e.target.value);
if (e.target.classList.contains('tb-bgp')) t.bgPad = parseInt(e.target.value);
if (e.target.classList.contains('tb-bgr')) t.bgRadius = parseInt(e.target.value);
if (e.target.classList.contains('tb-bsym')) t.bulletSymbol = e.target.value;
if (e.target.classList.contains('tb-bemoji')) t.bulletEmoji = e.target.value;
if (e.target.classList.contains('tb-bimgurl')) t.bulletImgUrl = e.target.value;
if (e.target.classList.contains('tb-bimgsz')) t.bulletImgSize = parseInt(e.target.value);
if (e.target.classList.contains('tb-bcol')) t.bulletColor = e.target.value;
if (e.target.classList.contains('tb-bsz')) t.bulletSize = parseInt(e.target.value);
if (e.target.classList.contains('tb-bgap')) t.bulletGap = parseInt(e.target.value);
if (e.target.classList.contains('tb-x')) t.x = parseFloat(e.target.value);
if (e.target.classList.contains('tb-y')) t.y = parseFloat(e.target.value);
if (e.target.classList.contains('tb-rot')) t.rot = parseFloat(e.target.value);
renderTextContent(); reassertLogo();
if (e.target.classList.contains('tb-op')) {
const parent = e.target.closest('.range-row');
if (parent) parent.querySelector('.range-val').textContent = e.target.value + '%';
}
}
function handleTextBlockRadio(e) {
const id = +e.target.closest('[data-id]')?.dataset.id;
const t = state.textBlocks.find(t => t.id === id); if (!t) return;
const radioRow = e.target.closest('.radio-row');
radioRow.querySelectorAll('.radio-btn').forEach(btn => btn.classList.remove('active'));
e.target.classList.add('active');
if (radioRow.classList.contains('tb-align-row')) t.align = e.target.dataset.align;
else if (radioRow.classList.contains('tb-transform-row')) t.textTransform = e.target.dataset.transform;
else if (radioRow.classList.contains('tb-shadow-row')) t.textShadow = e.target.dataset.shadow;
else if (radioRow.classList.contains('tb-bullet-style-row')) {
t.bulletStyle = e.target.dataset.bstyle;
const container = e.target.closest('.item-card');
container.querySelector('.tb-bullet-symbol-field').style.display = t.bulletStyle === 'symbol' ? 'flex' : 'none';
container.querySelector('.tb-bullet-emoji-field').style.display = t.bulletStyle === 'emoji' ? 'flex' : 'none';
container.querySelector('.tb-bullet-image-field').style.display = t.bulletStyle === 'image' ? 'flex' : 'none';
}
renderTextContent(); reassertLogo();
}
function handleBulletImgFile(e) {
const id = +e.target.dataset.id;
const file = e.target.files[0]; if (!file) return;
const reader = new FileReader();
reader.onload = ev => {
const t = state.textBlocks.find(t => t.id === id);
if (t) { t.bulletImgUrl = ev.target.result; renderTextContent(); reassertLogo(); }
};
reader.readAsDataURL(file);
}
function handleMoveUp(e) { moveBlock(+e.target.dataset.id, -1); }
function handleMoveDown(e) { moveBlock(+e.target.dataset.id, 1); }
function handleDeleteTextBlock(e) { removeTextBlock(+e.target.dataset.id); }
function buildBgStyle(t) {
if (!t.bgAlpha || t.bgAlpha <= 0) return '';
const h = t.bgColor || '#000000';
const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
return `background:rgba(${r},${g},${b},${t.bgAlpha/100});border-radius:${t.bgRadius||0}px;padding:${t.bgPad||0}px;display:inline-block;`;
}
function buildShadow(t) {
const shadows = { none: 'none', soft: '2px 4px 16px rgba(0,0,0,0.5)', hard: '3px 3px 0px rgba(0,0,0,0.9)', glow: `0 0 20px ${t.color}, 0 0 40px ${t.color}88` };
return shadows[t.textShadow] || 'none';
}
function renderTextContent() {
const layer = document.getElementById('layer-text');
layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
const padPct = Math.max(2, Math.min(10, Math.round((state.textPadX || 60) / (CW || 1080) * 100)));
layer.innerHTML = state.textBlocks.map(t => {
const y = t.y ?? 50, rot = t.rot ?? 0;
const align = t.align || 'center';
const x = t.x ?? 50;
let wrapStyle;
if (Math.abs(x - 50) < 5) {
wrapStyle = `position:absolute; left:50%; top:${y}%; transform:translate(-50%,-50%) rotate(${rot}deg); width:calc(100% - ${padPct * 2}%); max-width:100%; pointer-events:auto; box-sizing:border-box; padding:0 ${padPct}%;`;
} else if (x < 50) {
wrapStyle = `position:absolute; left:${x}%; top:${y}%; transform:translateY(-50%) rotate(${rot}deg); width:calc(${100 - x}% - ${padPct}%); max-width:100%; pointer-events:auto; box-sizing:border-box; padding-right:${padPct}%;`;
} else {
wrapStyle = `position:absolute; right:${100 - x}%; top:${y}%; transform:translateY(-50%) rotate(${rot}deg); width:calc(${x}% - ${padPct}%); max-width:100%; pointer-events:auto; box-sizing:border-box; padding-left:${padPct}%;`;
}
const base = `font-family:'${t.font}',sans-serif; font-size:${t.size}px; font-weight:${t.weight}; color:${t.color}; line-height:${t.lineH}; text-align:${align}; letter-spacing:${t.letterSpacing}px; opacity:${t.opacity/100}; text-transform:${t.textTransform||'none'}; text-shadow:${buildShadow(t)}; white-space:normal; word-wrap:break-word; overflow-wrap:break-word;`;
const bgWrap = buildBgStyle(t);
const wrapper = bgWrap ? `<div style="${bgWrap}width:100%;box-sizing:border-box;">` : '';
const wrapEnd = bgWrap ? `</div>` : '';
if (t.type === 'bullet') {
const lines = t.text.split('\n').filter(l => l.trim());
const gap = t.bulletGap || 16;
const bSize = t.bulletSize || t.size;
const bGap = Math.round(bSize * 0.55);
const renderBulletMark = (l, i) => {
if (t.bulletStyle === 'numbered') return `<span style="font-size:${bSize}px;font-weight:700;color:${t.bulletColor};flex-shrink:0;min-width:${bSize}px;">${i+1}.</span>`;
if (t.bulletStyle === 'symbol') return `<span style="font-size:${bSize}px;color:${t.bulletColor};flex-shrink:0;">${t.bulletSymbol || '—'}</span>`;
if (t.bulletStyle === 'emoji') {
if (t.bulletEmoji) return `<span style="font-size:${bSize}px;flex-shrink:0;">${t.bulletEmoji}</span>`;
const m = l.match(/^(\S+)\s(.+)/);
return `<span style="font-size:${bSize}px;flex-shrink:0;">${m ? m[1] : '•'}</span>`;
}
if (t.bulletStyle === 'image' && t.bulletImgUrl) {
const bImg = document.createElement('img');
bImg.src = t.bulletImgUrl;
bImg.crossOrigin = 'anonymous';
bImg.addEventListener('error', () => { bImg.style.display = 'none'; });
bImg.style.cssText = `width:${t.bulletImgSize}px;height:${t.bulletImgSize}px;object-fit:contain;flex-shrink:0;margin-top:4px;`;
return bImg.outerHTML;
}
return `<span style="width:10px;height:10px;border-radius:50%;background:${t.bulletColor};flex-shrink:0;margin-top:${bSize*0.2}px;display:inline-block;"></span>`;
};
const renderLine = (l, i) => {
let displayText = l;
if (t.bulletStyle === 'emoji' && !t.bulletEmoji) { const m = l.match(/^\S+\s(.+)/); if (m) displayText = m[1]; }
return `<li style="display:flex;gap:${gap}px;align-items:flex-start;margin-bottom:${bGap}px;"><span>${renderBulletMark(l, i)}</span><span style="font-family:'${t.font}',sans-serif;font-size:${t.size}px;font-weight:${t.weight};color:${t.color};line-height:${t.lineH};flex:1;text-align:${align};word-wrap:break-word;overflow-wrap:break-word;">${displayText}</span></li>`;
};
return `<div data-designer-type="text" data-designer-id="${t.id}" style="${wrapStyle}">${wrapper}<ul style="list-style:none;padding:0;margin:0;text-align:${align};">${lines.map(renderLine).join('')}</ul>${wrapEnd}</div>`;
}
return `<div data-designer-type="text" data-designer-id="${t.id}" style="${wrapStyle}">${wrapper}<div style="${base}">${t.text}</div>${wrapEnd}</div>`;
}).join('');
}
function updateTextLayout() {
state.textPadX = +document.getElementById('textPadX').value;
state.textPadY = +document.getElementById('textPadY').value;
renderTextContent();
}
function setTextVAlign(valign) {
state.textVAlign = valign;
document.querySelectorAll('#textVAlignRow .radio-btn').forEach(btn => btn.classList.remove('active'));
document.querySelector(`#textVAlignRow .radio-btn[data-valign="${valign}"]`).classList.add('active');
renderTextContent();
}
function setLogoSrc(type) {
logoSrcType = type;
document.querySelectorAll('#logoSrcRow .radio-btn').forEach(btn => btn.classList.remove('active'));
document.querySelector(`#logoSrcRow .radio-btn[data-src="${type}"]`).classList.add('active');
document.getElementById('logoUrlField').style.display  = type === 'url'  ? 'block' : 'none';
document.getElementById('logoFileField').style.display = type === 'file' ? 'block' : 'none';
if (type === 'none') { document.getElementById('layer-logo').innerHTML = ''; state.logo.src = 'none'; }
}
function setLogoAnchor(anchor) {
logoAnchor = anchor;
document.querySelectorAll('#logoAnchorRow .radio-btn').forEach(btn => btn.classList.remove('active'));
document.querySelector(`#logoAnchorRow .radio-btn[data-anchor="${anchor}"]`).classList.add('active');
updateLogo();
}
function resolveLogoSrc() {
if (logoSrcType === 'url') {
const url = document.getElementById('logoUrl').value.trim();
if (url) { state.logo.src = url; state.logo.url = url; return url; }
}
if (state.logo.src && state.logo.src !== 'none') return state.logo.src;
const existing = document.querySelector('#layer-logo img');
if (existing) { const src = existing.getAttribute('src'); if (src) { state.logo.src = src; return src; } }
return '';
}
function updateLogo() {
const src = resolveLogoSrc();
if (!src) return;
const w = +document.getElementById('logoW').value;
const h = +document.getElementById('logoH').value;
const mx = +document.getElementById('logoMX').value;
const my = +document.getElementById('logoMY').value;
const op = +document.getElementById('logoOpacity').value / 100;
state.logo.w = w; state.logo.h = h; state.logo.mx = mx; state.logo.my = my; state.logo.opacity = op;
renderLogo(src, w, h, mx, my, op);
}
function renderLogo(src, w, h, mx, my, op) {
if (!src) return;
state.logo.src = src;
const layer = document.getElementById('layer-logo');
const posStyle = {
tl: `top:${my}px;left:${mx}px;`,
tr: `top:${my}px;right:${mx}px;`,
bl: `bottom:${my}px;left:${mx}px;`,
br: `bottom:${my}px;right:${mx}px;`
}[logoAnchor] || `bottom:${my}px;left:${mx}px;`;
let wrapper = layer.querySelector('.logo-wrapper');
const existingImg = wrapper ? wrapper.querySelector('img') : null;
const srcChanged = !existingImg || existingImg.getAttribute('src') !== src;
if (srcChanged) {
const img = document.createElement('img');
img.src = src;
img.crossOrigin = 'anonymous';
img.style.cssText = `width:${w}px;${h>0?'height:'+h+'px;':'height:auto;'}object-fit:contain;opacity:${op};display:block;`;
wrapper = document.createElement('div');
wrapper.className = 'logo-wrapper';
wrapper.setAttribute('data-designer-type', 'logo');
wrapper.setAttribute('data-designer-id', '0');
wrapper.style.cssText = `position:absolute;${posStyle}`;
wrapper.appendChild(img);
layer.innerHTML = '';
layer.appendChild(wrapper);
} else {
wrapper.style.cssText = `position:absolute;${posStyle}`;
existingImg.style.width = w + 'px';
existingImg.style.height = h > 0 ? h + 'px' : 'auto';
existingImg.style.opacity = op;
}
}
function reassertLogo() {
const layer = document.getElementById('layer-logo');
if (!layer) return;
const wrapper = layer.querySelector('.logo-wrapper');
if (!wrapper) return;
const mx = state.logo.mx || 50;
const my = state.logo.my || 50;
const posStyle = {
tl: `top:${my}px;left:${mx}px;`,
tr: `top:${my}px;right:${mx}px;`,
bl: `bottom:${my}px;left:${mx}px;`,
br: `bottom:${my}px;right:${mx}px;`
}[logoAnchor] || `bottom:${my}px;left:${mx}px;`;
wrapper.style.cssText = `position:absolute;${posStyle}`;
}
function loadLogoFile(input) {
const file = input.files[0]; if (!file) return;
const reader = new FileReader();
reader.onload = e => {
state.logo.src = e.target.result; state.logo.url = '';
const w = +document.getElementById('logoW').value;
const h = +document.getElementById('logoH').value;
const mx = +document.getElementById('logoMX').value;
const my = +document.getElementById('logoMY').value;
const op = +document.getElementById('logoOpacity').value / 100;
renderLogo(e.target.result, w, h, mx, my, op);
};
reader.readAsDataURL(file);
}
let _pendingCheckRunning = false;
async function checkForPendingDesign() {
if (!apiModeActive || _pendingCheckRunning) return;
const result = await chrome.storage.local.get(['cp_pending_design', 'cp_pending_filename']);
if (!result.cp_pending_design) return;
_pendingCheckRunning = true;
const design = result.cp_pending_design;
const filename = result.cp_pending_filename || 'design.png';
console.log('[Designer] Pending design found:', filename);
setApiStatus('active', `Rendering ${filename}...`);
await chrome.storage.local.remove(['cp_pending_design', 'cp_pending_filename']);
try {
await applyDesign(design);
await new Promise(r => setTimeout(r, 800));
const oc = await renderToCanvas(2);
const dataUrl = oc.toDataURL('image/png');
await chrome.storage.local.set({ cp_design_dataurl: dataUrl });
setApiStatus('ready', `Done: ${filename}`);
} catch (error) {
console.error('[Designer] Render error:', error);
setApiStatus('idle', `Error: ${error.message}`);
await chrome.storage.local.set({ cp_design_error: error.message });
} finally { _pendingCheckRunning = false; }
}
setInterval(checkForPendingDesign, 1500);
checkForPendingDesign();
async function exportPNG() {
const btn = document.querySelector('.btn-export');
const node = document.getElementById('canvas');
btn.textContent = '⏳ Rendering...'; btn.disabled = true;
try {
const originalTransform = node.style.transform;
const ow = document.getElementById('canvasWrap').style.width;
const oh = document.getElementById('canvasWrap').style.height;
node.style.transform = 'scale(1)';
document.getElementById('canvasWrap').style.width = CW + 'px';
document.getElementById('canvasWrap').style.height = CH + 'px';
const canvas = await html2canvas(node, { scale:2, width:CW, height:CH, backgroundColor:null, useCORS:true, logging:false, allowTaint:false, scrollX:0, scrollY:0 });
node.style.transform = originalTransform;
document.getElementById('canvasWrap').style.width = ow;
document.getElementById('canvasWrap').style.height = oh;
const filename = `design-${Date.now()}.png`;
const dataUrl = canvas.toDataURL('image/png');
const link = document.createElement('a');
link.download = filename;
link.href = dataUrl;
document.body.appendChild(link);
link.click();
document.body.removeChild(link);
if (apiModeActive) chrome.runtime.sendMessage({ action: 'designComplete', filename, success:true });
} catch (error) {
console.error('Export error:', error);
alert('Export failed: ' + error.message);
if (apiModeActive) chrome.runtime.sendMessage({ action:'designComplete', success:false, error:error.message });
} finally {
btn.textContent = '⬇ Export PNG'; btn.disabled = false;
scaleCanvas();
}
}
async function renderToCanvas(scale) {
const node = document.getElementById('canvas');
const originalTransform = node.style.transform;
const ow = document.getElementById('canvasWrap').style.width;
const oh = document.getElementById('canvasWrap').style.height;
node.style.transform = 'scale(1)';
document.getElementById('canvasWrap').style.width = CW + 'px';
document.getElementById('canvasWrap').style.height = CH + 'px';
try {
const canvas = await html2canvas(node, { scale: scale||2, width:CW, height:CH, backgroundColor:null, useCORS:true, logging:false, allowTaint:false, scrollX:0, scrollY:0 });
node.style.transform = originalTransform;
document.getElementById('canvasWrap').style.width = ow;
document.getElementById('canvasWrap').style.height = oh;
scaleCanvas();
return canvas;
} catch (error) {
node.style.transform = originalTransform;
document.getElementById('canvasWrap').style.width = ow;
document.getElementById('canvasWrap').style.height = oh;
scaleCanvas();
throw error;
}
}
function resetCanvas() {
if (!confirm('Reset all layers?')) return;
document.getElementById('layer-bg').style.background = '';
document.getElementById('layer-imgbg').style.backgroundImage = 'none';
document.getElementById('layer-main').innerHTML = '';
document.getElementById('layer-icons').innerHTML = '';
document.getElementById('layer-brand').innerHTML = '';
document.getElementById('layer-text').innerHTML = '';
document.getElementById('layer-logo').innerHTML = '';
state.icons = []; state.brands = []; state.textBlocks = [];
iconCounter = 0; brandCounter = 0; textCounter = 0;
renderIconControls(); renderBrandControls(); renderTextControls();
}
function checkApiMode() {
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('mode') === 'api') { apiModeActive = true; enableApiMode(); return true; }
return false;
}
function enableApiMode() {
apiModeActive = true;
const apiBar = document.getElementById('apiBar');
const testBtn = document.getElementById('testApiBtn');
if (apiBar) apiBar.style.display = 'block';
if (testBtn) testBtn.style.display = 'block';
if (!document.getElementById('saveEditBtn')) {
const saveBtn = document.createElement('button');
saveBtn.id = 'saveEditBtn';
saveBtn.textContent = '💾 Save Edit';
saveBtn.style.cssText = 'margin-left:10px;padding:6px 12px;background:#4DFFA0;color:#000;border:none;border-radius:4px;font-weight:700;cursor:pointer;font-family:var(--mono);font-size:10px;';
saveBtn.addEventListener('click', () => {
handleSaveEditedSlide().then(res => {
if (res.success) alert('Slide saved!');
else alert('Save failed: ' + res.error);
});
});
const topbar = document.querySelector('.topbar-row');
if (topbar) topbar.appendChild(saveBtn);
}
setApiStatus('ready', 'API Mode: Waiting for design');
}
function setApiStatus(stateVal, message) {
const dot = document.getElementById('apiDot');
const text = document.getElementById('apiStatusText');
if (!dot || !text) return;
dot.className = 'api-dot';
if (stateVal === 'idle') dot.classList.add('idle');
if (stateVal === 'active') dot.classList.add('active');
if (stateVal === 'ready') dot.classList.add('ready');
text.textContent = message;
}
function clearCanvasComplete() {
console.log('[Designer] Performing complete canvas clear for new slide');
const bgLayer = document.getElementById('layer-bg');
if (bgLayer) bgLayer.style.background = '';
const imgBgLayer = document.getElementById('layer-imgbg');
if (imgBgLayer) imgBgLayer.style.backgroundImage = 'none';
const overlayLayer = document.getElementById('layer-imgbg-overlay');
if (overlayLayer) overlayLayer.style.background = '';
const mainLayer = document.getElementById('layer-main');
if (mainLayer) mainLayer.innerHTML = '';
const iconsLayer = document.getElementById('layer-icons');
if (iconsLayer) iconsLayer.innerHTML = '';
const brandLayer = document.getElementById('layer-brand');
if (brandLayer) brandLayer.innerHTML = '';
const textLayer = document.getElementById('layer-text');
if (textLayer) textLayer.innerHTML = '';
const logoLayer = document.getElementById('layer-logo');
if (logoLayer) logoLayer.innerHTML = '';
state.icons = [];
state.brands = [];
state.textBlocks = [];
iconCounter = 0;
brandCounter = 0;
textCounter = 0;
state.bg = {
type: 'solid',
color: '#0A0A14',
c1: '#1a0533',
c2: '#0d1f4a',
c3: '#0a1a0a',
angle: 135,
s1: 0,
s2: 50,
s3: 100,
radShape: 'circle'
};
updateBG();
state.imgBg = { src: 'none', url: '', size: 'cover', pos: 'center', opacity: 100, overlay: 0 };
setImgSrcType('none');
state.mainImg = { src: 'none', url: '', w: 80, h: 70, x: 50, y: 50, rot: 0, opacity: 100, blend: 'normal' };
setMainImgSrc('none');
state.logo = { src: 'none', url: '', w: 200, h: 0, anchor: 'bl', mx: 50, my: 50, opacity: 100 };
setLogoSrc('none');
renderIconControls();
renderBrandControls();
renderTextControls();
console.log('[Designer] Canvas cleared, ready for new design');
}
function clearCanvas() {
document.getElementById('layer-bg').style.background = '';
document.getElementById('layer-imgbg').style.backgroundImage = 'none';
document.getElementById('layer-imgbg-overlay').style.background = '';
document.getElementById('layer-main').innerHTML = '';
document.getElementById('layer-icons').innerHTML = '';
document.getElementById('layer-brand').innerHTML = '';
document.getElementById('layer-text').innerHTML = '';
document.getElementById('layer-logo').innerHTML = '';
state.icons = [];
state.brands = [];
state.textBlocks = [];
iconCounter = 0;
brandCounter = 0;
textCounter = 0;
state.bg = {
type: 'solid',
color: '#0A0A14',
c1: '#1a0533',
c2: '#0d1f4a',
c3: '#0a1a0a',
angle: 135,
s1: 0,
s2: 50,
s3: 100,
radShape: 'circle'
};
updateBG();
state.imgBg = { src: 'none', url: '', size: 'cover', pos: 'center', opacity: 100, overlay: 0 };
setImgSrcType('none');
state.mainImg = { src: 'none', url: '', w: 80, h: 70, x: 50, y: 50, rot: 0, opacity: 100, blend: 'normal' };
setMainImgSrc('none');
state.logo = { src: 'none', url: '', w: 200, h: 0, anchor: 'bl', mx: 50, my: 50, opacity: 100 };
setLogoSrc('none');
renderIconControls();
renderBrandControls();
renderTextControls();
}
async function applyDesign(designSpec) {
if (!designSpec) return { success: false, error: 'No design spec' };
setApiStatus('active', 'Applying design...');
try {
clearCanvasComplete();
await new Promise(r => setTimeout(r, 150));
if (designSpec.bg) await applyBackground(designSpec.bg);
if (designSpec.imgBg) await applyImageBackground(designSpec.imgBg);
if (designSpec.mainImg) await applyMainImage(designSpec.mainImg);
if (designSpec.icons && Array.isArray(designSpec.icons)) await applyIcons(designSpec.icons);
if (designSpec.brands && Array.isArray(designSpec.brands)) await applyBrands(designSpec.brands);
if (designSpec.textBlocks && Array.isArray(designSpec.textBlocks)) await applyTextBlocks(designSpec.textBlocks);
if (designSpec.logo) await applyLogo(designSpec.logo);
if (designSpec.canvasW) { document.getElementById('canvasW').value = designSpec.canvasW; resizeCanvas(); }
if (designSpec.canvasH) { document.getElementById('canvasH').value = designSpec.canvasH; resizeCanvas(); }
await new Promise(r => setTimeout(r, 500));
reassertLogo();
setApiStatus('ready', 'Design applied successfully');
if (designSpec.autoExport) await autoExport(designSpec.filename || `design-${Date.now()}.png`);
return { success: true };
} catch (error) {
console.error('[API] Error:', error);
setApiStatus('idle', `Error: ${error.message}`);
return { success: false, error: error.message };
}
}
function applyBackground(bg) {
return new Promise(resolve => {
const bgType = bg.type || 'solid';
setBgType(bgType);
if (bgType === 'solid') { if (bg.color) document.getElementById('bgColor').value = bg.color; }
else {
if (bg.c1) document.getElementById('bgC1').value = bg.c1;
if (bg.c2) document.getElementById('bgC2').value = bg.c2;
if (bg.c3) document.getElementById('bgC3').value = bg.c3;
if (bg.angle) document.getElementById('bgAngle').value = bg.angle;
if (bg.s1) document.getElementById('bgS1').value = bg.s1;
if (bg.s2) document.getElementById('bgS2').value = bg.s2;
if (bg.s3) document.getElementById('bgS3').value = bg.s3;
if (bgType === 'radial' && bg.radShape) setRadShape(bg.radShape);
}
updateBG(); setTimeout(resolve, 50);
});
}
function applyImageBackground(imgBg) {
return new Promise(resolve => {
if (!imgBg.src || imgBg.src === 'none') { setImgSrcType('none'); resolve(); return; }
setImgSrcType('url');
if (imgBg.url) document.getElementById('bgImgUrl').value = imgBg.url;
if (imgBg.size) setImgSize(imgBg.size);
if (imgBg.pos) document.getElementById('bgImgPos').value = imgBg.pos;
if (imgBg.opacity !== undefined) document.getElementById('bgImgOpacity').value = imgBg.opacity;
if (imgBg.overlay !== undefined) document.getElementById('bgImgOverlay').value = imgBg.overlay;
updateImgBG(); setTimeout(resolve, 100);
});
}
function applyMainImage(mainImg) {
return new Promise(resolve => {
if (!mainImg.src || mainImg.src === 'none') { resolve(); return; }
setMainImgSrc('url');
if (mainImg.url) document.getElementById('mainImgUrl').value = mainImg.url;
if (mainImg.w) document.getElementById('mainImgW').value = mainImg.w;
if (mainImg.h) document.getElementById('mainImgH').value = mainImg.h;
if (mainImg.x !== undefined) document.getElementById('mainImgX').value = mainImg.x;
if (mainImg.y !== undefined) document.getElementById('mainImgY').value = mainImg.y;
if (mainImg.rot !== undefined) document.getElementById('mainImgRot').value = mainImg.rot;
if (mainImg.opacity !== undefined) document.getElementById('mainImgOpacity').value = mainImg.opacity;
if (mainImg.blend) document.getElementById('mainImgBlend').value = mainImg.blend;
updateMainImg(); setTimeout(resolve, 100);
});
}
function applyIcons(icons) {
return new Promise(resolve => {
iconCounter = 0; state.icons = [];
icons.forEach(icon => {
const id = ++iconCounter;
state.icons.push({ id, src:icon.src||'', x:icon.x||50, y:icon.y||50, size:icon.size||150, rot:icon.rot||0, opacity:icon.opacity||100 });
});
renderIconControls(); renderIcons(); reassertLogo(); setTimeout(resolve, 50);
});
}
function applyBrands(brands) {
return new Promise(resolve => {
brandCounter = 0; state.brands = [];
brands.forEach(b => {
const id = ++brandCounter;
state.brands.push({ id, text:b.text||'Brand', x:b.x||50, y:b.y||95, size:b.size||32, color:b.color||'#ffffff', font:b.font||'DM Sans', weight:b.weight||700, opacity:b.opacity||100, align:b.align||'center', letterSpacing:b.letterSpacing||2, bgStyle:'' });
});
renderBrandControls(); renderBrands(); reassertLogo(); setTimeout(resolve, 50);
});
}
function applyTextBlocks(blocks) {
return new Promise(resolve => {
textCounter = 0; state.textBlocks = [];
const needAutoPos = blocks.some(b => b.x === undefined || b.y === undefined);
const stepY = needAutoPos ? Math.max(8, Math.floor(70 / Math.max(1, blocks.length))) : 0;
let autoY = 20;
blocks.forEach(block => {
const id = ++textCounter;
let x = block.x, y = block.y;
if (x === undefined || y === undefined) {
const def = BLOCK_DEFAULTS[block.type || 'body'] || BLOCK_DEFAULTS.body;
if (x === undefined) x = def.x ?? 50;
if (y === undefined) { y = autoY; autoY += stepY; }
}
state.textBlocks.push({ id, type:block.type||'body', text:block.text||'', size:block.size||36, font:block.font||'DM Sans', weight:block.weight||'400', color:block.color||'#ffffff', lineH:block.lineH||1.5, letterSpacing:block.letterSpacing||0, mb:block.mb||20, align:block.align||'left', opacity:block.opacity||100, textTransform:block.textTransform||'none', textShadow:block.textShadow||'none', bgColor:block.bgColor||'', bgAlpha:block.bgAlpha||0, bgPad:block.bgPad||0, bgRadius:block.bgRadius||0, underline:block.underline||false, bulletStyle:block.bulletStyle||'symbol', bulletSymbol:block.bulletSymbol||'—', bulletEmoji:block.bulletEmoji||'', bulletImgUrl:block.bulletImgUrl||'', bulletImgSize:block.bulletImgSize||28, bulletGap:block.bulletGap||20, bulletColor:block.bulletColor||'#4dffa0', bulletSize:block.bulletSize||28, x: x, y: y, rot: block.rot || 0 });
});
renderTextControls(); renderTextContent(); reassertLogo(); setTimeout(resolve, 50);
});
}
function applyLogo(logo) {
return new Promise(resolve => {
if (!logo.src || logo.src === 'none') { document.getElementById('layer-logo').innerHTML = ''; resolve(); return; }
setLogoSrc('url');
if (logo.url) document.getElementById('logoUrl').value = logo.url;
if (logo.w) document.getElementById('logoW').value = logo.w;
if (logo.h !== undefined) document.getElementById('logoH').value = logo.h;
if (logo.mx !== undefined) document.getElementById('logoMX').value = logo.mx;
if (logo.my !== undefined) document.getElementById('logoMY').value = logo.my;
if (logo.opacity !== undefined) document.getElementById('logoOpacity').value = logo.opacity;
if (logo.anchor) setLogoAnchor(logo.anchor);
updateLogo(); setTimeout(resolve, 100);
});
}
async function autoExport(filename) {
setApiStatus('active', `Exporting ${filename}...`);
try {
const oc = await renderToCanvas(2);
const dataUrl = oc.toDataURL('image/png');
setApiStatus('ready', `Exported: ${filename}`);
return { success: true, filename, dataUrl };
} catch (error) {
setApiStatus('idle', `Export failed: ${error.message}`);
return { success: false, error: error.message };
}
}
function testApiDesign() {
const testDesign = {
bg: { type:'linear', c1:'#1a0533', c2:'#0d1f4a', c3:'#0a1a0a', angle:135, s1:0, s2:50, s3:100 },
textBlocks: [
{ type:'headline', text:'TOP 5 AI TOOLS', size:110, color:'#4DFFA0', align:'center', textTransform:'uppercase', font:'Bebas Neue', weight:'700', x:50, y:28, rot:0 },
{ type:'subtitle', text:'Save 10+ hours per week', size:42, color:'#ffffff', align:'center', font:'DM Sans', weight:'500', x:50, y:48, rot:0 },
{ type:'bullet', text:'ChatGPT - Content ideation\nMidjourney - Visual creation\nNotion AI - Organization\nPerplexity - Research', size:28, color:'#E2E8F8', align:'left', font:'DM Sans', weight:'500', bulletStyle:'symbol', bulletSymbol:'🚀', bulletColor:'#4DFFA0', bulletSize:32, bulletGap:20, x:15, y:60, rot:0 }
],
brands: [{ text:'CONTENT PLANNER', x:50, y:92, size:24, color:'#6A7A9A', font:'Space Mono', weight:'700', align:'center', letterSpacing:3 }]
};
applyDesign(testDesign);
}
function saveCurrentAsSpec() {
return {
canvasW: CW, canvasH: CH,
bg: { ...state.bg }, imgBg: { ...state.imgBg }, mainImg: { ...state.mainImg },
icons: state.icons.map(i => ({ src:i.src, x:i.x, y:i.y, size:i.size, rot:i.rot, opacity:i.opacity })),
brands: state.brands.map(b => ({ text:b.text, x:b.x, y:b.y, size:b.size, color:b.color, font:b.font, weight:b.weight, opacity:b.opacity, align:b.align, letterSpacing:b.letterSpacing })),
textBlocks: state.textBlocks.map(t => ({ type:t.type, text:t.text, size:t.size, font:t.font, weight:t.weight, color:t.color, lineH:t.lineH, letterSpacing:t.letterSpacing, mb:t.mb, align:t.align, opacity:t.opacity, textTransform:t.textTransform, textShadow:t.textShadow, bgColor:t.bgColor, bgAlpha:t.bgAlpha, bgPad:t.bgPad, bgRadius:t.bgRadius, bulletStyle:t.bulletStyle, bulletSymbol:t.bulletSymbol, bulletEmoji:t.bulletEmoji, bulletImgUrl:t.bulletImgUrl, bulletImgSize:t.bulletImgSize, bulletGap:t.bulletGap, bulletColor:t.bulletColor, bulletSize:t.bulletSize, x:t.x??50, y:t.y??50, rot:t.rot??0 })),
logo: { src: state.logo.src, url: state.logo.url, w: state.logo.w, h: state.logo.h, anchor: logoAnchor, mx: state.logo.mx, my: state.logo.my, opacity: state.logo.opacity }
};
}
async function applyPresetJSON(preset) {
document.getElementById('layer-bg').style.background = '';
document.getElementById('layer-imgbg').style.backgroundImage = 'none';
document.getElementById('layer-main').innerHTML = '';
document.getElementById('layer-icons').innerHTML = '';
document.getElementById('layer-brand').innerHTML = '';
document.getElementById('layer-text').innerHTML = '';
document.getElementById('layer-logo').innerHTML = '';
state.icons = []; state.brands = []; state.textBlocks = [];
iconCounter = 0; brandCounter = 0; textCounter = 0;
await applyDesign(preset.spec || preset);
}
async function loadPresetsFromURL(url) {
console.log('[Preset API] Fetching:', url);
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 5000);
try {
const res = await fetch(url, { method: 'GET', cache: 'no-cache', signal: controller.signal });
clearTimeout(timeoutId);
if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
return await res.json();
} catch (err) {
clearTimeout(timeoutId);
console.error('[Preset API] Fetch failed:', err);
throw new Error(`Failed to load: ${err.message}`);
}
}
function getCanvasState() {
return {
canvas: { width: CW, height: CH }, bg: state.bg,
mainImg: state.mainImg.src !== 'none' ? state.mainImg : null,
iconsCount: state.icons.length,
brands: state.brands.map(b => ({ text:b.text, x:b.x, y:b.y })),
textBlocks: state.textBlocks.map((t, i) => ({ idx:i, type:t.type, text:t.text.slice(0,80), x:t.x??50, y:t.y??50, rot:t.rot??0, size:t.size, color:t.color })),
hasLogo: state.logo.src !== 'none'
};
}
window.ContentDesignerAPI = {
applyDesign,
autoExport,
test: testApiDesign,
getState: () => state,
getCanvasState,
saveCurrentAsSpec,
applyPresetJSON,
loadPresetsFromURL,
reassertLogo,
updateLogo,
renderToCanvas,
renderTextContent,
renderIcons,
renderBrands,
removeTextBlock,
removeIcon,
removeBrand,
version: '1.0.0',
resetState: async function() {
console.log('[Designer] resetState called - clearing all layers');
const bgLayer = document.getElementById('layer-bg');
if (bgLayer) bgLayer.style.background = '';
const imgBgLayer = document.getElementById('layer-imgbg');
if (imgBgLayer) imgBgLayer.style.backgroundImage = 'none';
const overlayLayer = document.getElementById('layer-imgbg-overlay');
if (overlayLayer) overlayLayer.style.background = '';
const mainLayer = document.getElementById('layer-main');
if (mainLayer) mainLayer.innerHTML = '';
const iconsLayer = document.getElementById('layer-icons');
if (iconsLayer) iconsLayer.innerHTML = '';
const brandLayer = document.getElementById('layer-brand');
if (brandLayer) brandLayer.innerHTML = '';
const textLayer = document.getElementById('layer-text');
if (textLayer) textLayer.innerHTML = '';
const logoLayer = document.getElementById('layer-logo');
if (logoLayer) logoLayer.innerHTML = '';
state.icons = [];
state.brands = [];
state.textBlocks = [];
iconCounter = 0;
brandCounter = 0;
textCounter = 0;
state.bg = { 
type: 'solid', 
color: '#0A0A14', 
c1: '#1a0533', 
c2: '#0d1f4a', 
c3: '#0a1a0a', 
angle: 135, 
s1: 0, 
s2: 50, 
s3: 100, 
radShape: 'circle' 
};
updateBG();
state.imgBg = { src: 'none', url: '', size: 'cover', pos: 'center', opacity: 100, overlay: 0 };
setImgSrcType('none');
state.mainImg = { src: 'none', url: '', w: 80, h: 70, x: 50, y: 50, rot: 0, opacity: 100, blend: 'normal' };
setMainImgSrc('none');
state.logo = { src: 'none', url: '', w: 200, h: 0, anchor: 'bl', mx: 50, my: 50, opacity: 100 };
setLogoSrc('none');
renderIconControls();
renderBrandControls();
renderTextControls();
await new Promise(r => setTimeout(r, 100));
console.log('[Designer] resetState complete');
}
};
function sendToExt(message) {
return new Promise((resolve, reject) => {
if (typeof chrome === 'undefined' || !chrome.runtime) {
reject(new Error('Chrome API not available.'));
return;
}
try {
const isInternal = !!chrome.runtime.id;
const target = isInternal ? null : 'noapjcmepjdbbnhdddiflndjbodlamph';
chrome.runtime.sendMessage(target, message, (response) => {
if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
if (!response) { reject(new Error('Empty response')); return; }
if (!response.success) { reject(new Error(response.error || 'Unknown error from background')); return; }
resolve(response.result !== undefined ? response.result : response);
});
} catch (err) { reject(err); }
});
}
async function openPresetBrowser() {
try {
const res = await sendToExt({ action: 'dbLoadAllPresets' });
const allPresets = res || [];
if (!allPresets.length) {
alert('No saved presets found in database.');
return;
}
const byCategory = {};
allPresets.forEach(p => {
if (!byCategory[p.category]) byCategory[p.category] = [];
byCategory[p.category].push(p);
});
const modal = document.createElement('div');
modal.id = 'presetBrowserModal';
modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';
let html = `
<div style="background:#0D1018;border:1px solid #1C2438;border-radius:12px;max-width:900px;max-height:80vh;width:90%;overflow:hidden;display:flex;flex-direction:column;color:#DCE6F8;font-family:'DM Sans',sans-serif;">
<div style="padding:16px 20px;border-bottom:1px solid #1C2438;display:flex;align-items:center;justify-content:space-between;">
<h3 style="margin:0;font-family:'Space Mono',monospace;font-size:16px;color:#4DFFA0;">📚 Saved Presets from Database</h3>
<button id="closePresetBrowser" style="background:none;border:none;color:#6A7A9A;font-size:20px;cursor:pointer;">✕</button>
</div>
<div style="overflow-y:auto;flex:1;padding:20px;">`;
Object.keys(byCategory).sort().forEach(category => {
const presets = byCategory[category];
html += `<div style="margin-bottom:24px;">
<h4 style="margin:0 0 12px 0;font-family:'Space Mono',monospace;font-size:12px;color:#4D9FFF;text-transform:uppercase;letter-spacing:1px;">${category} (${presets.length})</h4>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;">`;
presets.forEach(preset => {
const spec = typeof preset.spec === 'string' ? JSON.parse(preset.spec) : preset.spec;
const created = new Date(preset.created_at).toLocaleDateString();
html += `<div class="preset-card" data-preset-id="${preset.id}" style="background:#07090F;border:1px solid #1C2438;border-radius:8px;padding:12px;cursor:pointer;transition:border-color .2s;">
<div style="font-weight:600;font-size:13px;margin-bottom:4px;">${preset.name}</div>
<div style="font-size:11px;color:#6A7A9A;margin-bottom:8px;">Created: ${created}</div>
<div style="font-size:10px;color:#6A7A9A;">${spec.textBlocks?.length || 0} text blocks · ${spec.icons?.length || 0} icons</div>
<div style="margin-top:8px;display:flex;gap:6px;">
<button class="load-preset-btn" data-id="${preset.id}" style="flex:1;padding:4px 8px;background:#4DFFA0;border:none;border-radius:4px;font-size:10px;cursor:pointer;color:#000;font-weight:700;">Load</button>
<button class="delete-preset-btn" data-id="${preset.id}" style="padding:4px 8px;background:rgba(239,68,68,0.2);border:1px solid #ef4444;border-radius:4px;font-size:10px;cursor:pointer;color:#ef4444;">Delete</button>
</div>
</div>`;
});
html += `</div></div>`;
});
html += `</div></div>`;
modal.innerHTML = html;
document.body.appendChild(modal);
document.getElementById('closePresetBrowser').addEventListener('click', () => modal.remove());
modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
modal.addEventListener('click', async (e) => {
if (e.target.classList.contains('load-preset-btn')) {
const id = e.target.dataset.id;
const preset = allPresets.find(p => p.id == id);
if (preset) {
const spec = typeof preset.spec === 'string' ? JSON.parse(preset.spec) : preset.spec;
await window.ContentDesignerAPI.applyPresetJSON({ spec, name: preset.name });
modal.remove();
}
}
if (e.target.classList.contains('delete-preset-btn')) {
const id = e.target.dataset.id;
if (confirm('Delete this preset permanently?')) {
await sendToExt({ action: 'dbDeletePreset', id });
openPresetBrowser();
}
}
});
} catch (err) {
console.error('[Preset Browser] Error:', err);
alert('Failed to load presets: ' + err.message);
}
}
document.addEventListener('DOMContentLoaded', () => {
const viewBtn = document.getElementById('viewSavedPresetsBtn');
if (viewBtn) {
viewBtn.addEventListener('click', openPresetBrowser);
}
});
document.addEventListener('DOMContentLoaded', () => {
document.getElementById('canvasW').addEventListener('input', resizeCanvas);
document.getElementById('canvasH').addEventListener('input', resizeCanvas);
document.getElementById('resetBtn').addEventListener('click', resetCanvas);
document.getElementById('exportBtn').addEventListener('click', exportPNG);
document.getElementById('testApiBtn').addEventListener('click', testApiDesign);
const presetContainer = document.getElementById('presetButtons');
const presets = [[1080, 1350, '3:4'], [1080, 1080, '1:1'], [1080, 1920, '9:16'], [1200, 628, 'OG'], [1920, 1080, '16:9']];
presets.forEach(([w, h, label]) => {
const btn = document.createElement('button');
btn.textContent = label;
btn.style.cssText = 'padding:3px 7px;border-radius:3px;font-family:var(--mono);font-size:9px;background:var(--s3);border:1px solid var(--border);color:var(--muted2);cursor:pointer;';
btn.addEventListener('click', () => setPreset(w, h));
presetContainer.appendChild(btn);
});
document.querySelectorAll('.layer-head').forEach(head => { head.addEventListener('click', () => { const id = head.dataset.layer; if (id) toggleLayer(id); }); });
document.querySelectorAll('#bgTypeRow .radio-btn').forEach(btn => btn.addEventListener('click', () => setBgType(btn.dataset.val)));
['bgColor','bgC1','bgC2','bgC3','bgAngle','bgS1','bgS2','bgS3'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('input', updateBG); });
document.querySelectorAll('#radShapeRow .radio-btn').forEach(btn => btn.addEventListener('click', () => setRadShape(btn.dataset.shape)));
document.querySelectorAll('#imgSrcTypeRow .radio-btn').forEach(btn => btn.addEventListener('click', () => setImgSrcType(btn.dataset.src)));
document.querySelectorAll('#imgSizeRow .radio-btn').forEach(btn => btn.addEventListener('click', () => setImgSize(btn.dataset.size)));
['bgImgUrl','bgImgPos','bgImgOpacity','bgImgOverlay'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener(id === 'bgImgPos' ? 'change' : 'input', updateImgBG); });
document.getElementById('bgImgFile').addEventListener('change', e => loadImgFile(e.target));
document.querySelectorAll('#mainImgSrcRow .radio-btn').forEach(btn => btn.addEventListener('click', () => setMainImgSrc(btn.dataset.src)));
['mainImgUrl','mainImgW','mainImgH','mainImgX','mainImgY','mainImgRot','mainImgOpacity','mainImgBlend'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('input', updateMainImg); });
document.getElementById('mainImgFile').addEventListener('change', e => loadMainImgFile(e.target));
document.getElementById('addIconBtn').addEventListener('click', addIcon);
document.getElementById('addBrandBtn').addEventListener('click', addBrand);
document.querySelectorAll('[data-block-type]').forEach(btn => btn.addEventListener('click', () => addBlock(btn.dataset.blockType)));
['textPadX','textPadY'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('input', updateTextLayout); });
document.querySelectorAll('#textVAlignRow .radio-btn').forEach(btn => btn.addEventListener('click', () => setTextVAlign(btn.dataset.valign)));
document.querySelectorAll('#logoSrcRow .radio-btn').forEach(btn => btn.addEventListener('click', () => setLogoSrc(btn.dataset.src)));
document.querySelectorAll('#logoAnchorRow .radio-btn').forEach(btn => btn.addEventListener('click', () => setLogoAnchor(btn.dataset.anchor)));
['logoUrl','logoW','logoH','logoMX','logoMY','logoOpacity'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('input', updateLogo); });
document.getElementById('logoFile').addEventListener('change', e => loadLogoFile(e.target));
updateBG(); scaleCanvas();
window.addEventListener('resize', scaleCanvas);
checkApiMode();
console.log('[Designer v4.2] Ready. API:', Object.keys(window.ContentDesignerAPI).join(', '));
});