const express = require('express');
const router = express.Router();

// ──────────────────────────────────────────────
// Instagram reel/post embed proxy
// Ported from https://github.com/sanjayaidev/sanjaymeherAIReels
//
// Instagram blocks most server IPs (AWS/Vercel/etc.) from fetching the
// embed page directly, so we first try a couple of public CORS proxies
// and fall back to a direct mobile-UA request. The fetched HTML is
// re-served from our own origin with a permissive CSP so it can sit
// inside an <iframe> without redirecting the user off-site.
// ──────────────────────────────────────────────

const SHORTCODE_RE = /^[A-Za-z0-9_-]+$/;

function buildProxyUrls(targetUrl) {
  return [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
  ];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// GET /api/reels/proxy?shortcode=XXXX
router.get('/proxy', async (req, res) => {
  const { shortcode } = req.query;

  if (!shortcode || !SHORTCODE_RE.test(shortcode)) {
    return res.status(400).send('Missing or invalid shortcode');
  }

  const targetUrl = `https://www.instagram.com/p/${shortcode}/embed/`;
  let html = '';

  // 1. Try public CORS proxies first (bypasses IP blocks on our host)
  for (const proxyUrl of buildProxyUrls(targetUrl)) {
    try {
      const response = await fetchWithTimeout(proxyUrl);
      if (response.ok) {
        const text = await response.text();
        if (text.includes('instagram.com') && !text.includes('captcha')) {
          html = text;
          break;
        }
      }
    } catch (_) {
      continue;
    }
  }

  // 2. Fallback: direct request with a mobile UA
  if (!html) {
    try {
      const response = await fetchWithTimeout(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        },
      });
      if (response.ok) html = await response.text();
    } catch (error) {
      console.error('Reel proxy direct fetch failed:', error.message);
    }
  }

  if (!html) {
    return res.status(502).send(`
      <div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:300px;color:#fff;font-family:sans-serif;background:#111;">
        <div style="text-align:center;padding:16px;">
          <h3>⚠️ Player Blocked</h3>
          <p style="color:#999;font-size:13px;margin-top:6px;">Instagram blocked the proxy. Try again shortly.</p>
        </div>
      </div>
    `);
  }

  // Inject <base> so relative CSS/JS/image links resolve against Instagram
  html = html.replace('<head>', '<head><base href="https://www.instagram.com/">');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Overrides helmet's default CSP for this response only, so it can be framed.
  // Also allow Instagram domains for XHR/fetch requests made by the embedded content
  res.setHeader('Content-Security-Policy', "frame-ancestors *; script-src 'self' 'unsafe-inline' https://www.instagram.com https://instagram.com https://*.instagram.com; connect-src 'self' https://graph.instagram.com https://www.instagram.com https://instagram.com https://*.instagram.com");
  res.send(html);
});

// GET /api/reels/shortcode?url=https://www.instagram.com/reel/XXXX/
// Small helper so the frontend doesn't need to duplicate the regex.
router.get('/shortcode', (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ success: false, message: 'url is required' });
  }
  const match = url.match(/instagram\.com\/(?:reel|p|tv)\/([^/?]+)/);
  if (!match) {
    return res.status(400).json({ success: false, message: 'Could not extract shortcode from url' });
  }
  res.json({ success: true, shortcode: match[1] });
});

module.exports = router;
