const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Simple in-memory cache for image metadata (not the actual binary data)
// For production, use Redis or a proper caching layer
const imageCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Clean up expired cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of imageCache.entries()) {
    if (now - value.timestamp > CACHE_TTL_MS) {
      imageCache.delete(key);
    }
  }
}, 60 * 1000); // Run every minute

async function fetchImage(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SanjayAIHub/1.0)',
      },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || 'image/jpeg';
        resolve({ buffer, contentType });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// GET /api/image-proxy?url=<encoded_url>&size=<width>x<height>
// Proxies and optionally resizes images from external sources
router.get('/', async (req, res) => {
  const { url: imageUrl, width, height, quality } = req.query;

  if (!imageUrl) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    // Validate URL
    new URL(imageUrl);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  // Create cache key based on URL and requested dimensions
  const cacheKey = `${imageUrl}:${width || 'auto'}:${height || 'auto'}`;
  
  // Check if we have recent fetch metadata (not storing binary in memory)
  // For actual image caching, we'd need file system or Redis
  // Here we just pass through with better error handling
  
  try {
    const { buffer, contentType } = await fetchImage(imageUrl);
    
    // Set caching headers for browser
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes browser cache
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    
    // Note: Actual resizing would require sharp/jimp library
    // For now, we proxy as-is but with proper error handling and timeouts
    res.send(buffer);
  } catch (error) {
    console.error('Image proxy error:', error.message);
    
    // Return a placeholder or error response
    res.status(502).json({ 
      error: 'Failed to fetch image', 
      message: error.message 
    });
  }
});

// GET /api/image-proxy/health - Check if proxy is working
router.get('/health', (req, res) => {
  res.json({ status: 'ok', cached: imageCache.size });
});

module.exports = router;
