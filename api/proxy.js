const axios = require('axios');

module.exports = async (req, res) => {
  const { shortcode } = req.query;
  if (!shortcode) return res.status(400).send('Missing shortcode');

  try {
    // 1. Instagram's official internal embed URL
    const targetUrl = `https://www.instagram.com/p/${shortcode}/embed/`;
    let html = '';

    // 2. Try fetching via public proxies to bypass AWS/Vercel IP blocks
    const proxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
      `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
    ];

    for (const proxy of proxies) {
      try {
        const response = await axios.get(proxy, { timeout: 10000 });
        if (response.data.includes('instagram.com') && !response.data.includes('captcha')) {
          html = response.data;
          break;
        }
      } catch (e) { continue; }
    }

    // 3. Fallback: Try direct request if proxies fail
    if (!html) {
      const directRes = await axios.get(targetUrl, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' 
        },
        timeout: 10000
      });
      html = directRes.data;
    }

    // 4. Inject <base href> so all relative CSS/JS links load from Instagram's servers
    html = html.replace('<head>', '<head><base href="https://www.instagram.com/" target="_blank">');

    // 5. Send HTML back with permissive framing headers
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "frame-ancestors *; script-src 'self' 'unsafe-inline' https://www.instagram.com https://instagram.com https://*.instagram.com; connect-src 'self' https://graph.instagram.com https://www.instagram.com https://instagram.com https://*.instagram.com");
    
    res.send(html);

  } catch (error) {
    console.error('Proxy Error:', error.message);
    res.status(500).send(`
      <div style="display:flex;align-items:center;justify-content:center;height:100%;color:white;font-family:sans-serif;">
        <div style="text-align:center;">
          <h3>⚠️ Player Blocked</h3>
          <p>Instagram blocked the proxy.</p>
        </div>
      </div>
    `);
  }
};
