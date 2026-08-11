// agent.js — Design Agent v3.5 (enhanced image loading + error handling)
(function () {
  'use strict';

  const EXTENSION_ID = 'noapjcmepjdbbnhdddiflndjbodlamph';

  function sendToExt(message) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        reject(new Error('Chrome API not available'));
        return;
      }
      try {
        const isInternal = !!chrome.runtime.id;
        const target = isInternal ? null : EXTENSION_ID;
        chrome.runtime.sendMessage(target, message, (response) => {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
          if (!response) { reject(new Error('Empty response')); return; }
          if (!response.success) { reject(new Error(response.error || 'Unknown error from background')); return; }
          resolve(response.result !== undefined ? response.result : response);
        });
      } catch (err) { reject(err); }
    });
  }

  const conversationStore = new Map();
  const MAX_HISTORY = 10;
  const RESET_KEYWORD = '[COMPLETE RESET]';

  const _agentProcessedRequests = new Map();
  const _AGENT_DEDUP_TIMEOUT = 5000;

  let _processingLock = false;
  const _processingQueue = [];

  function acquireLock() {
    if (!_processingLock) {
      _processingLock = true;
      return Promise.resolve();
    }
    return new Promise(resolve => _processingQueue.push(resolve));
  }

  function releaseLock() {
    if (_processingQueue.length > 0) {
      const next = _processingQueue.shift();
      next();
    } else {
      _processingLock = false;
    }
  }

  // [SYSTEM_PROMPT remains exactly the same as your original file]
  const SYSTEM_PROMPT = `You are DESIGN AGENT — a professional design executor that creates complete, production-ready Instagram/social media designs. Output ONLY a valid JSON design spec. No markdown, no commentary, no code fences.
═══════════════════════════════════════════════════════════════
ABSOLUTE RULES (NON-NEGOTIABLE):
═══════════════════════════════════════════════════════════════
Output ONLY a single valid JSON object — nothing else.
Spec must be COMPLETE and immediately applicable to canvas.
Preserve ALL elements user didn't ask to change (check CANVAS STATE).
Text blocks MUST include: x (0-100% horizontal position), y (0-100% vertical position), rot (degrees), align (left|center|right).
Use ONLY these fonts: DM Sans, Space Mono, Bebas Neue, Playfair Display, Oswald, Montserrat, Raleway, Syne.
CREATIVE FREEDOM: Use your designer's eye — add imgBg, mainImg, icons, logos, text bg fills to maximize visual impact as you think will be right for the image.
CONTENT MUST FIT: All elements must stay within canvas bounds with proper spacing.
MINIMUM REQUIREMENTS:
Background:If using imgBg make sure to always use imgBg with a verified Unsplash URL (opacity 20-40, overlay 65-80). A solid/plain background is NOT acceptable — always layer an image behind the gradient.
Icons: include 3-5 icons using icons8 URLs. Use generic icons if topic-specific ones are uncertain must not overalp with text
Brand: Always include brand signature at bottom
Text blocks: Use appropriate hierarchy (headline → subtitle → body/bullets)if the texts are realted keep verital Y gap to MINIMUM
You must use the demo references for all design type as provided for clean details on design and object placement rules.
🚨 CRITICAL OUTPUT RULE: You MUST output EXACTLY ONE valid JSON object representing a SINGLE design spec.
DO NOT output an array of designs. DO NOT generate multiple days.
The output must be a single { ... } object matching the COMPLETE JSON SCHEMA below.
═══════════════════════════════════════════════════════════════
VERTICAL PLACEMENT & OVERLAP PREVENTION (CRITICAL):
═══════════════════════════════════════════════════════════════
To prevent text blocks from overlapping, calculate each block's RENDERED HEIGHT before placing the next one.

CANVAS HEIGHT: 1350px (portrait) or 1080px (square) or 1920px (story)
Convert y% to actual pixels: y_px = (y% / 100) * canvasH

RENDERED BLOCK HEIGHT FORMULA:
  single-line block: height_px = font_size × lineH
  multi-line block:  height_px = font_size × lineH × line_count
  bullet block:      height_px = (font_size × lineH + bulletGap) × line_count

SAFE NEXT Y RULE (use this formula for EVERY consecutive pair of blocks):
  next_y_px = prev_y_px + (prev_height_px / 2) + gap_px + (next_height_px / 2)
  Convert back: next_y% = (next_y_px / canvasH) × 100

GAP RULES — you wrote the content, so you already know which blocks belong together:

TIGHT gap_px = 16-24px  → you intentionally wrote these as a PAIR (one completes the other)
  You will know this because YOU wrote them together as a unit.
  e.g. you wrote "TOP 10 FREE AI TOOLS" then "for Digital Marketers" — these are one idea, use TIGHT.

MEDIUM gap_px = 50-70px  → separate section starts below
  e.g. subtitle ends, bullet list begins — different content type, use MEDIUM.

LARGE gap_px = 90-120px  → content ends, closing element follows
  e.g. last bullet → brand signature, list → CTA — use LARGE.

WORKED EXAMPLE (1080×1350, headline 120px + subtitle 40px + 10-line bullet 30px):
  Headline:  y=28% → y_px=378, height=114, bottom=435
  Subtitle:  TIGHT (you wrote it as headline's pair) gap=20 → y_px=435+20+26=481 → y%=36%
  Bullets:   MEDIUM (new section you introduced) gap=60, height=620 → y_px=481+26+60+310=877 → y%=65%

ALWAYS ENSURE:
- Compute prev block's BOTTOM EDGE = prev_y_px + (prev_height_px / 2)
- Next block's TOP EDGE = next_y_px - (next_height_px / 2)
- next TOP EDGE > prev BOTTOM EDGE + gap_px (MANDATORY)
- All elements stay within canvas bounds (y between 5% and 95%)
- Brand signature at bottom (y:90-95) does NOT overlap last text block
- For long bullet lists (6+ items), start them higher (y:50-55%) to avoid overflow

═══════════════════════════════════════════════════════════════
RESOURCE SOURCES (APPROVED):
═══════════════════════════════════════════════════════════════
ICONS (use icons8 PNG URLs — these are CORS-safe and render reliably in the extension):
Format: https://img.icons8.com/fluency/96/[name].png   ← color/fluency style
        https://img.icons8.com/ios-filled/96/HEXCOLOR/[name].png  ← monochrome, replace HEXCOLOR with hex (no #)

EXACT working icon names for icons8 (copy these precisely):
- AI / tech tools: chatgpt, artificial-intelligence, robot-2, machine-learning, brain, neural-network
- Platforms:       instagram, youtube, tiktok, linkedin, twitter, facebook, pinterest, reddit, discord, telegram, whatsapp
- Dev tools:       github, vscode, docker, react, python, javascript, html-5, css3, nodejs, git
- Productivity:    notion, figma, google-drive, slack, zoom, trello, asana, airtable
- Business:        analytics, bar-chart, money, e-commerce, shopping-cart, seo, email, megaphone
- Media:           video-editing, microphone, camera, podcast, music, play-button
- Generic:         checkmark, star, lightning-bolt, rocket, target, trophy, idea, settings, lock, chart

Examples:
- "https://img.icons8.com/fluency/96/chatgpt.png"
- "https://img.icons8.com/fluency/96/instagram-new.png"
- "https://img.icons8.com/ios-filled/96/4DFFA0/checkmark.png"

RULE: If you are unsure of the exact icon name, use a GENERIC icon (robot-2, artificial-intelligence, bar-chart, star, rocket) — a generic icon that loads is ALWAYS better than a specific one that breaks.

BACKGROUNDS — copy the FULL URL exactly as written, do NOT modify or combine these:

Technology/AI:
  https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=1080&auto=format&fit=crop
  https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=1080&auto=format&fit=crop
  https://images.unsplash.com/photo-1518770660439-4636190af475?w=1080&auto=format&fit=crop

Business/Marketing:
  https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1080&auto=format&fit=crop
  https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=1080&auto=format&fit=crop
  https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=1080&auto=format&fit=crop

Social Media/Content:
  https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=1080&auto=format&fit=crop
  https://images.unsplash.com/photo-1563986768494-4dee2763ff3f?w=1080&auto=format&fit=crop

Dark/Abstract:
  https://images.unsplash.com/photo-1614854262318-831574f15f1f?w=1080&auto=format&fit=crop
  https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=1080&auto=format&fit=crop
  https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=1080&auto=format&fit=crop

Finance/Money:
  https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1080&auto=format&fit=crop
  https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=1080&auto=format&fit=crop

Health/Wellness:
  https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=1080&auto=format&fit=crop
  https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1080&auto=format&fit=crop

RULE: Pick the most topically relevant URL from the list above. Copy it CHARACTER FOR CHARACTER. Never construct or modify a URL — paste only.

ALWAYS pair imgBg with overlay ≥65 so text remains readable.
Image Placement Rule Make sure it is not overlapping with text if it a icon and if it is a big image position it so it do not overlap with text and if too big adjust the visibility to 20 or 30

═══════════════════════════════════════════════════════════════
SPACING & LAYOUT RULES:
═══════════════════════════════════════════════════════════════
CANVAS BOUNDS:
- Square: 1080×1080
- Portrait: 1080×1350 (default for carousels)
- Story/Reel: 1080×1920

Safe zone: Keep all content within 60px padding from edges
Element gaps: Minimum 40px between any two elements
Icon spacing: 40px gap from text blocks
Logo placement: Maintain 40px gap from text

OVERLAY REQUIREMENTS:
- If imgBg used: overlay MUST be ≥60% for text readability
- If mainImg overlaps text: reduce text opacity or add bg fill
- Never place logos directly on readable text

═══════════════════════════════════════════════════════════════
TEXT BLOCK POSITIONING RULES:
═══════════════════════════════════════════════════════════════
Text blocks use BOTH x and y for positioning:
- x: 0-100% (0 = far left edge, 50 = centered, 100 = far right edge)
- y: 0-100% (0 = top edge, 50 = middle, 100 = bottom edge)
- rot: rotation in degrees (-180 to 180)

The renderer positions blocks differently depending on x:
- x ≈ 50 (within 5%): block is full-width, centered horizontally. Use align to control text inside.
- x < 45: the block's LEFT EDGE starts at x% from the canvas left. Use align:"left" for these.
- x > 55: the block's RIGHT EDGE ends at x% from the canvas left. Use align:"right" for these.
- For ALL cases: y% is the VERTICAL CENTER of the block (translate(-50%) applied).

Alignment (align field) controls text INSIDE the block:
- align: "left" → text starts at left edge of the positioned block
- align: "center" → text centered within the positioned block
- align: "right" → text ends at right edge of the positioned block

Typical x placements:
- Centered content: x = 50  (block is horizontally centered)
- Left-aligned reading content: x = 5-8  (x is the LEFT EDGE of the block from canvas left)
- Right-aligned accent: x = 92-95  (x is the RIGHT EDGE of the block from canvas left)

═══════════════════════════════════════════════════════════════
COLOR CONTRAST (WCAG 2.1 AA):
═══════════════════════════════════════════════════════════════
- Text must have ≥4.5:1 contrast ratio against background
- Dark backgrounds → Light text (#ffffff, #f0f0f0, #4DFFA0, #4D9FFF)
- Light backgrounds → Dark text (#0a0a0a, #1a1a2e, #2d3748)

═══════════════════════════════════════════════════════════════
COMPLETE JSON SCHEMA:
═══════════════════════════════════════════════════════════════
{
  "canvasW": 1080,
  "canvasH": 1350,
  
  "bg": {
    "type": "solid|linear|radial",
    "color": "#hex",
    "c1": "#hex",
    "c2": "#hex",
    "c3": "#hex",
    "angle": 135,
    "s1": 0,
    "s2": 50,
    "s3": 100,
    "radShape": "circle|ellipse"
  },
  
  "imgBg": {
    "src": "url|none",
    "url": "https://images.unsplash.com/photo-...?w=1080&auto=format&fit=crop",
    "size": "cover|contain|stretch",
    "pos": "center",
    "opacity": 30,
    "overlay": 70
  },
  
  "mainImg": {
    "src": "url|none",
    "url": "https://images.unsplash.com/photo-...?w=800&auto=format",
    "w": 80,
    "h": 70,
    "x": 50,
    "y": 50,
    "rot": 0,
    "opacity": 100,
    "blend": "normal"
  },
  
  "icons": [
    {
      "src": "https://img.icons8.com/fluency/96/artificial-intelligence.png",
      "x": 50,
      "y": 15,
      "size": 120,
      "rot": 0,
      "opacity": 90
    }
  ],
  
  "brands": [
    {
      "text": "@YOURBRAND",
      "x": 50,
      "y": 94,
      "size": 22,
      "color": "#4DFFA0",
      "font": "Space Mono",
      "weight": 700,
      "align": "center",
      "letterSpacing": 3,
      "opacity": 70
    }
  ],
  
  "textBlocks": [
    {
      "type": "headline|title|subtitle|body|bullet",
      "text": "Your text content here",
      "x": 50,
      "y": 30,
      "rot": 0,
      "size": 96,
      "font": "Bebas Neue",
      "weight": "700",
      "color": "#ffffff",
      "align": "center",
      "lineH": 0.95,
      "letterSpacing": 2,
      "opacity": 100,
      "textTransform": "uppercase",
      "textShadow": "soft",
      "bgColor": "#000000",
      "bgAlpha": 0,
      "bgPad": 0,
      "bgRadius": 0,
      "bulletStyle": "symbol",
      "bulletColor": "#4DFFA0",
      "bulletSize": 28,
      "bulletGap": 20,
      "bulletSymbol": "→",
      "bulletEmoji": "🔥",
      "bulletImgUrl": "",
      "bulletImgSize": 28
    }
  ],
  
  "logo": {
    "src": "url|none",
    "url": "https://img.icons8.com/fluency/96/star.png",
    "w": 150,
    "h": 0,
    "anchor": "bl",
    "mx": 50,
    "my": 50,
    "opacity": 100
  }
}

═══════════════════════════════════════════════════════════════
DESIGN PATTERNS BY TYPE (with proper vertical spacing):
═══════════════════════════════════════════════════════════════

CAROUSEL COVER (1080×1350):
- Icon at x:50, y:12, size:80
- Headline (120-160px) at x:50, y:32
- Subtitle (28-36px) at x:50, y:52
- "SWIPE →" indicator at x:50, y:85
- Brand at x:50, y:94

CAROUSEL CONTENT (1080×1350):
- Slide counter at x:5, y:8, size:20
- Title (60-78px) at x:5, y:22
- Body/Bullets (28-34px) at x:5, y:45
- Brand at x:50, y:94

CAROUSEL END (1080×1350):
- "SAVE THIS" headline at x:50, y:38
- CTA subtitle at x:50, y:60
- "← BACK TO START" at x:50, y:78
- Brand at x:50, y:93

SINGLE POST (1080×1080):
- Headline at x:50, y:35
- Subtitle at x:50, y:55
- Bullets at x:5, y:70
- Brand at x:50, y:92

STORY (1080×1920):
- Tag at x:50, y:10
- Headline at x:50, y:32
- Hook at x:50, y:58
- Brand at x:50, y:92

REEL COVER (1080×1920):
- "▶ REEL" tag at x:50, y:10
- Headline at x:50, y:35
- Subtitle at x:50, y:65
- Brand at x:50, y:90

═══════════════════════════════════════════════════════════════
QUALITY CHECKLIST (VERIFY BEFORE OUTPUT):
═══════════════════════════════════════════════════════════════
✓ Icons use icons8 PNG URLs: https://img.icons8.com/fluency/96/[name].png — use generic names if unsure
✓ imgBg overlay ≥60% if used
✓ Text contrast ≥4.5:1 against background
✓ 40px minimum gap between text and images/logos
✓ All elements within canvas bounds (y between 5-95%)
✓ No text blocks overlap — verify using SAFE NEXT Y RULE: each block's top edge > prev block's bottom edge + gap_px
✓ 3-5 relevant icons included
✓ Brand signature at bottom (y:90-95)
✓ Text blocks have x, y, rot, align fields
✓ Valid JSON syntax (no trailing commas)
✓ Font from approved list

═══════════════════════════════════════════════════════════════
CANVAS STATE (preserve what user didn't change):
═══════════════════════════════════════════════════════════════
{{CANVAS_STATE}}

CONVERSATION HISTORY:
{{HISTORY}}

USER REQUEST:
{{USER_MESSAGE}}

Output ONLY the complete JSON design spec now. Remember:
- ALWAYS add imgBg with a verified Unsplash ID — never leave background as plain solid color
- ALWAYS add 3-5 icons using icons8 PNG URLs — use generic names when unsure of exact name
- ALWAYS include brand signature at bottom
- NEVER let text blocks overlap — space them vertically with proper gaps
- ALL elements must stay inside canvas bounds
- Use real Unsplash URLs for images (not local paths)
- Output valid JSON only — no markdown, no commentary.`;

  const PROVIDER = 'deepseek';

  // Calls this app's own backend (routes/designer.js -> POST /api/designer/generate),
  // which runs the same DESIGN AGENT system prompt server-side against the
  // DeepSeek (or NVIDIA) API using the signed-in user's saved API key.
  // Requires the user to be logged in (Bearer token in localStorage) and on
  // the 'pro' tier or higher — same gating the backend already enforces.
  async function callDesignBackend(userMessage, conversationId, canvasState) {
    const token = localStorage.getItem('session_token');
    if (!token) throw new Error('Please log in to use the Design Agent.');

    const res = await fetch('/api/designer/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        prompt: userMessage,
        conversationId,
        canvasState,
        model: PROVIDER
      })
    });

    let data;
    try { data = await res.json(); } catch (e) { throw new Error(`Server returned an invalid response (${res.status})`); }

    if (!res.ok || !data.success) {
      const err = new Error(data.message || `Request failed (${res.status})`);
      // Carry the raw AI text along so the UI can show it for debugging,
      // even though the request itself failed.
      err.rawResponse = data.rawResponse;
      throw err;
    }

    return data; // { success, spec, conversationId, rawResponse }
  }

  // ✅ FIX: Completely rewritten to correctly escape actual newline characters inside JSON strings
  function repairJSON(s) {
    if (!s) return s;
    // Remove trailing commas
    let result = s.replace(/,\s*([]}])/g, '$1');
    
    // Fix unescaped newlines, carriage returns, and tabs inside strings
    // This regex matches valid JSON strings (handling escaped quotes inside them)
    result = result.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, p1) => {
      // Replace actual newline characters with the literal string \n so JSON.parse succeeds
      return '"' + p1.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
    });
    
    // Fix single quotes for keys/values (basic repair)
    result = result.replace(/'\s*:/g, '":');
    result = result.replace(/:\s*'/g, ':"');

    // Strip stray backslashes before [ or ]. Some models over-eagerly
    // markdown-escape square brackets — e.g. "opacity": \[35\] instead of
    // "opacity": 35. \[ and \] are never legal JSON escapes, so this is
    // always safe.
    result = result.replace(/\\([[\]])/g, '$1');

    // Add the leading 0 to bare decimals like ": .80" — JSON doesn't allow
    // a number to start with just ".", but DeepSeek sometimes emits it.
    result = result.replace(/([:[,]\s*)(-?)\.(\d)/g, '$1$20.$3');

    // GENERIC catch-all: some models occasionally wrap a bare numeric value
    // in decorator characters instead of emitting the plain number, e.g.
    // "opacity": &35, "opacity": II35II, "opacity": **90**, "opacity":五个35.
    // Rather than patching each new decorator one-by-one as models invent
    // new ones (including non-Latin scripts), strip ANY run of characters
    // that directly wraps a number in a value position (right after ':',
    // '[', or ',' and right before the next ',', ']', or '}'), keeping only
    // the number — as long as those characters aren't valid JSON syntax
    // themselves. This only fires when the value doesn't already start with
    // a valid JSON value opener ('"', '{', '[', a digit, or '-'), so it can
    // never touch legitimate strings (including URLs with '&' in them),
    // objects, arrays, or already-valid numbers.
    result = result.replace(
      /([:,[]\s*)([^\s":,[\]{}\d.-][^\s":,[\]{}]*?)?(-?\d+(?:\.\d+)?)([^\s":,[\]{}]*?)(?=\s*[,\]}])/g,
      (m, delim, _pre, num) => delim + num
    );

    return result;
  }

  function resetCanvasState() {
    const resetId = `reset_${Date.now()}`;
    return {
      canvas: { width: 1080, height: 1350 },
      bg: { type: 'solid', color: '#0A0A14' },
      textBlocks: [],
      icons: [],
      brands: [],
      hasLogo: false
    };
  }

  // ✅ FIX: Fixed backslash handling so it doesn't break when encountering \ outside of strings
  function extractJSON(s) {
    if (!s) return null;
    let cleaned = s.replace(/```json\s*([\s\S]*?)```/gi, '$1').replace(/```\s*([\s\S]*?)```/gi, '$1').trim();
    const start = cleaned.indexOf('{');
    if (start === -1) return null;
    
    let depth = 0, inStr = false, escape = false, end = -1;
    for (let i = start; i < cleaned.length; i++) {
      const c = cleaned[i];
      if (escape) { escape = false; continue; }
      
      // ✅ FIX: Only treat backslash as an escape character if we are INSIDE a string
      if (c === '\\') { 
        if (inStr) escape = true; 
        continue; 
      }
      
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      
      if (c === '{') depth++;
      if (c === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    
    let candidate = end !== -1 ? cleaned.slice(start, end + 1) : cleaned.slice(start);
    
    try { return JSON.parse(candidate); } catch (e) {}
    
    const repaired = repairJSON(candidate);
    try { return JSON.parse(repaired); } catch (e) {}
    
    try { return JSON.parse(repairJSON(cleaned)); } catch (e) {}
    
    return null;
  }

  function getConversation(conversationId) {
    if (!conversationStore.has(conversationId)) {
      conversationStore.set(conversationId, []);
    }
    return conversationStore.get(conversationId);
  }

  function addToConversation(conversationId, role, content) {
    const conv = getConversation(conversationId);
    conv.push({ role, content });
    while (conv.length > MAX_HISTORY * 2) conv.shift();
    conversationStore.set(conversationId, conv);
  }

  function buildPrompt(userMessage, conversationId, canvasState = null) {
    const conversation = getConversation(conversationId);
    const historyText = conversation.length
      ? conversation.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
      : '(first message in this conversation)';
    const stateText = canvasState ? JSON.stringify(canvasState, null, 2) : '{}';
    
    return SYSTEM_PROMPT
      .replace('{{CANVAS_STATE}}', stateText)
      .replace('{{HISTORY}}', historyText)
      .replace('{{USER_MESSAGE}}', userMessage);
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ NEW: Enhanced image loading with progress logging
  // ═══════════════════════════════════════════════════════════════
  async function waitForImagesToLoad(timeoutMs = 20000) {
    const canvas = document.getElementById('canvas');
    if (!canvas) return;
    
    const deadline = Date.now() + timeoutMs;
    let lastLog = 0;
    
    while (Date.now() < deadline) {
      const imgs = canvas.querySelectorAll('img');
      const total = imgs.length;
      const loaded = Array.from(imgs).filter(img => img.complete && img.naturalWidth > 0).length;
      const failed = Array.from(imgs).filter(img => img.complete && img.naturalWidth === 0).length;
      
      // Log progress every 3 seconds
      if (Date.now() - lastLog > 3000) {
        console.log(`[Agent] Images: ${loaded}/${total} loaded, ${failed} failed`);
        lastLog = Date.now();
      }
      
      if (loaded === total && total > 0) {
        console.log(`[Agent] All ${total} images loaded successfully`);
        return;
      }
      
      await new Promise(r => setTimeout(r, 300));
    }
    
    const remaining = canvas.querySelectorAll('img:not([complete])');
    console.warn(`[Agent] waitForImagesToLoad: timeout reached. ${remaining.length} images still loading. Proceeding with export.`);
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ NEW: Image error handling with placeholder fallback
  // ═══════════════════════════════════════════════════════════════
  function setupImageErrorHandling() {
    const canvas = document.getElementById('canvas');
    if (!canvas) return;
    
    // Add error handler to all existing images
    canvas.querySelectorAll('img').forEach(img => {
      if (!img.dataset.errorHandler) {
        img.addEventListener('error', () => {
          console.warn('[Agent] Image failed to load:', img.src);
          // Replace with a solid color placeholder
          img.style.display = 'none';
          const placeholder = document.createElement('div');
          placeholder.style.cssText = `
            position: absolute;
            width: ${img.width || 100}px;
            height: ${img.height || 100}px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 2px dashed #4D9FFF;
            border-radius: 8px;
          `;
          if (img.parentNode) {
            img.parentNode.replaceChild(placeholder, img);
          }
        });
        img.dataset.errorHandler = 'true';
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ NEW: Preload images before rendering
  // ═══════════════════════════════════════════════════════════════
  async function preloadImages(urls) {
    if (!urls || urls.length === 0) return;
    
    const promises = urls.map(url => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { 
          console.log('[Agent] Preloaded:', url); 
          resolve(true); 
        };
        img.onerror = () => { 
          console.warn('[Agent] Failed to preload:', url); 
          resolve(false); 
        };
        img.src = url;
        // Timeout after 5 seconds
        setTimeout(() => resolve(false), 5000);
      });
    });
    
    const results = await Promise.all(promises);
    const successCount = results.filter(r => r).length;
    console.log(`[Agent] Preload complete: ${successCount}/${urls.length} successful`);
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ NEW: Extract all image URLs from design spec
  // ═══════════════════════════════════════════════════════════════
  function extractImageUrls(designSpec) {
    const urls = [];
    
    // Background image
    if (designSpec.imgBg?.url && designSpec.imgBg.src !== 'none') {
      urls.push(designSpec.imgBg.url);
    }
    
    // Main image
    if (designSpec.mainImg?.url && designSpec.mainImg.src !== 'none') {
      urls.push(designSpec.mainImg.url);
    }
    
    // Icons
    if (designSpec.icons && Array.isArray(designSpec.icons)) {
      designSpec.icons.forEach(icon => {
        if (icon.src && icon.src.startsWith('http')) {
          urls.push(icon.src);
        }
      });
    }
    
    // Logo
    if (designSpec.logo?.url && designSpec.logo.src !== 'none') {
      urls.push(designSpec.logo.url);
    }
    
    // Bullet images
    if (designSpec.textBlocks && Array.isArray(designSpec.textBlocks)) {
      designSpec.textBlocks.forEach(block => {
        if (block.bulletImgUrl && block.bulletImgUrl.startsWith('http')) {
          urls.push(block.bulletImgUrl);
        }
      });
    }
    
    return urls;
  }

  async function waitForBgImage(timeoutMs = 8000) {
    const bgEl = document.getElementById('layer-imgbg');
    if (!bgEl) return;
    const url = bgEl.style.backgroundImage.replace(/url\(["']?(.+?)["']?\)/, '$1');
    if (!url || url === 'none') return;
    return new Promise(resolve => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = resolve;
      img.src = url;
      setTimeout(resolve, timeoutMs);
    });
  }

  async function processPrompt(options) {
    const { prompt, conversationId, canvasState = null, autoApply = true, autoExport = false, returnDataUrl = false, clearCanvasFirst = false } = options;
    if (!prompt) throw new Error('Prompt is required');
    
    let actualPrompt = prompt;
    let forceReset = false;
    const trimmedPrompt = prompt.trim();
    
    if (trimmedPrompt.startsWith(RESET_KEYWORD)) {
      forceReset = true;
      actualPrompt = trimmedPrompt.slice(RESET_KEYWORD.length).trim();
      console.log('[Agent] Force reset triggered, clearing conversation');
    }
    
    let convId;
    if (forceReset) {
      convId = `reset_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
      console.log('[Agent] New conversation ID for reset:', convId);
    } else {
      convId = conversationId || `default_${Date.now()}`;
    }
    
    const startTime = Date.now();
    await acquireLock();
    
    try {
      if (forceReset) {
        conversationStore.delete(convId);
      }
      
      const effectiveCanvasState = forceReset ? { reset: true, timestamp: Date.now() } : canvasState;
      const fullPrompt = buildPrompt(actualPrompt, convId, effectiveCanvasState);
      
      console.log('[Agent] Sending to DeepSeek via /api/designer/generate, reset mode:', forceReset);
      // Note: the backend (routes/designer.js) builds its own SYSTEM_PROMPT +
      // conversation history from the `designer_conversation` table server-side,
      // so we send the raw user message + canvas state rather than the
      // client-built `fullPrompt` (kept above only for the local conversation
      // log / potential future direct-API fallback).
      const backendResult = await callDesignBackend(actualPrompt, convId, effectiveCanvasState);
      const raw = backendResult.rawResponse;

      addToConversation(convId, 'user', prompt);
      addToConversation(convId, 'assistant', raw);

      // Backend already extracts + validates the JSON spec server-side; fall
      // back to the client-side extractor only if that's ever missing.
      let spec = backendResult.spec || extractJSON(raw);
      let lastRaw = raw;

      if (!spec) {
        console.warn('[Agent API] First parse failed, sending fix prompt...');
        try {
          const fixPrompt = `Your previous response was not valid JSON. Output ONLY the corrected JSON object — no markdown, no commentary, no code fences. Previous response:\n\n${(raw || '').slice(0, 4000)}`;
          const retryResult = await callDesignBackend(fixPrompt, convId, effectiveCanvasState);
          addToConversation(convId, 'assistant', retryResult.rawResponse);
          spec = retryResult.spec || extractJSON(retryResult.rawResponse);
          lastRaw = retryResult.rawResponse || lastRaw;
        } catch (retryErr) {
          lastRaw = retryErr.rawResponse || lastRaw;
        }
      }
      
      if (!spec) {
        const err = new Error('JSON parse failed after retry');
        err.rawResponse = lastRaw;
        throw err;
      }
      
      let result = { success: true, spec, conversationId: convId };
      
      if (autoApply && window.ContentDesignerAPI) {
        const shouldClearFirst = clearCanvasFirst || forceReset;
        if (shouldClearFirst && window.ContentDesignerAPI.resetState) {
          console.log('[Agent] Clearing canvas before applying new design...');
          await window.ContentDesignerAPI.resetState();
          await new Promise(r => setTimeout(r, 200));
        }
        
        // ✅ NEW: Preload images before applying design
        const imageUrls = extractImageUrls(spec);
        if (imageUrls.length > 0) {
          console.log(`[Agent] Preloading ${imageUrls.length} images...`);
          await preloadImages(imageUrls);
        }
        
        await window.ContentDesignerAPI.applyDesign(spec);
        result.applied = true;
        
        // ✅ NEW: Setup error handling for images
        setupImageErrorHandling();
        
        await waitForBgImage(8000);
        await waitForImagesToLoad(20000); // ✅ Increased from 12000 to 20000
        await new Promise(r => setTimeout(r, 500));
        
        if (autoExport && window.ContentDesignerAPI.autoExport) {
          const filename = `design-${convId}-${Date.now()}.png`;
          const exportResult = await window.ContentDesignerAPI.autoExport(filename);
          result.exported = true;
          result.filename = exportResult.filename;
          if (returnDataUrl && exportResult.dataUrl) result.dataUrl = exportResult.dataUrl;
        } else if (returnDataUrl) {
          const canvas = await window.ContentDesignerAPI.renderToCanvas(2);
          if (canvas) result.dataUrl = canvas.toDataURL('image/png');
        }
      }
      
      result.duration = Date.now() - startTime;
      return result;
    } catch (err) {
      console.error('[Agent API] Error:', err);
      throw err;
    } finally {
      releaseLock();
    }
  }

  function clearConversation(conversationId) {
    if (conversationId) conversationStore.delete(conversationId);
    else conversationStore.clear();
    console.log(`[Agent API] Cleared conversation: ${conversationId || 'all'}`);
  }

  function getConversationHistory(conversationId) {
    return getConversation(conversationId);
  }

  async function handleSend() {
    const userMsg = window.DesignerAgentUI?.getInput();
    if (!userMsg) return;
    
    window.DesignerAgentUI?.clearInput();
    window.DesignerAgentUI?.addMessage('user', escapeHTML(userMsg));
    window.DesignerAgentUI?.busy(true);
    window.DesignerAgentUI?.setStatus(`thinking · DeepSeek`);
    window.DesignerAgentUI?.addTyping();
    
    try {
      const result = await processPrompt({
        prompt: userMsg,
        conversationId: 'ui_chat',
        autoApply: true,
        autoExport: false,
        returnDataUrl: false
      });
      
      window.DesignerAgentUI?.removeTyping();
      window.DesignerAgentUI?.addMessage('bot', '<span class="applied-badge ok">✓ applied</span>', [
        { label: '💾 Save JSON', onClick: () => downloadJSON(result.spec) },
        { label: '🖼 Export PNG', onClick: () => { const btn = document.querySelector('.btn-export'); if (btn) btn.click(); } }
      ]);
      window.DesignerAgentUI?.setStatus(`ready · DeepSeek`);
    } catch (err) {
      console.error('[Agent UI] error:', err);
      window.DesignerAgentUI?.removeTyping();
      const rawBlock = err.rawResponse
        ? `<details class="agent-raw"><summary>Show raw AI response (${err.rawResponse.length} chars)</summary><pre>${escapeHTML(err.rawResponse)}</pre></details>`
        : '';
      window.DesignerAgentUI?.addMessage('bot', `<span class="applied-badge err">✗ ${escapeHTML(err.message)}</span>${rawBlock}`);
      window.DesignerAgentUI?.setStatus(`error · DeepSeek`);
    } finally {
      window.DesignerAgentUI?.busy(false);
    }
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function downloadJSON(spec) {
    const json = JSON.stringify(spec, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    // Plain browser download — no extension messaging needed. `sendToExt`
    // (chrome.downloads under the hood) only works inside the companion
    // extension; a normal <a download> click works everywhere.
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-design-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Guard: `chrome`/`chrome.runtime` only exist when this page runs inside the
  // companion extension. On the plain web app they're undefined, and this
  // listener registration used to throw uncaught at the top level of the file —
  // which aborted the whole script before it reached `sendBtn.addEventListener`
  // further down, so the chat Send button silently did nothing.
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'agentProcessPrompt') {
      const requestKey = `${request.prompt}_${request.options?.conversationId || request.conversationId || ''}`;
      const now = Date.now();
      
      if (_agentProcessedRequests.has(requestKey)) {
        const lastRequest = _agentProcessedRequests.get(requestKey);
        if (now - lastRequest < _AGENT_DEDUP_TIMEOUT) {
          console.warn('[Agent] Duplicate request ignored:', requestKey);
          sendResponse({ success: false, error: 'Duplicate request ignored' });
          return true;
        }
      }
      
      _agentProcessedRequests.set(requestKey, now);
      
      // Clean up old entries
      for (const [key, timestamp] of _agentProcessedRequests.entries()) {
        if (now - timestamp > _AGENT_DEDUP_TIMEOUT) {
          _agentProcessedRequests.delete(key);
        }
      }
      
      processPrompt(request.options || {
        prompt: request.prompt,
        conversationId: request.conversationId,
        canvasState: request.canvasState,
        autoApply: request.autoApply !== false,
        autoExport: request.autoExport || false,
        returnDataUrl: request.returnDataUrl || false,
        clearCanvasFirst: request.clearCanvasFirst || false
      })
        .then(result => {
          sendResponse({ success: true, result });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });
      
      return true;
    }
    
    if (request.action === 'agentClearConversation') {
      clearConversation(request.conversationId);
      sendResponse({ success: true });
      return true;
    }
    
    if (request.action === 'agentGetHistory') {
      const history = getConversationHistory(request.conversationId);
      sendResponse({ success: true, history });
      return true;
    }
  });
  }

  window.DesignerAgentAPI = {
    processPrompt,
    clearConversation,
    getConversationHistory,
    version: '3.5.0'
  };

  const sendBtn = document.getElementById('agentSend');
  if (sendBtn) sendBtn.addEventListener('click', handleSend);

  const subtitle = document.getElementById('agentSubtitle');
  if (subtitle) subtitle.textContent = 'Ready · DeepSeek API · CDN icons · Auto-spacing';

  console.log('[Agent API] v3.5 Ready. Enhanced image loading + error handling.');
})();
