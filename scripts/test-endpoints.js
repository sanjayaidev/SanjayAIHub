#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────
// scripts/test-endpoints.js
//
// Live health-check for every AI provider/model this app talks to.
// Deliberately does NOT re-implement any HTTP call — it imports the same
// provider classes and model catalogs the app itself uses, so this can
// never drift out of sync with production code, and a passing/failing
// result here reflects reality exactly.
//
// This makes REAL, BILLED calls to whichever providers have credentials
// configured (see "Credentials" below) and reports pass/fail per model.
// Providers with no credentials configured are skipped, not failed.
//
// Usage:
//   node scripts/test-endpoints.js                       # everything configured
//   node scripts/test-endpoints.js --provider=alibaba     # one provider
//   node scripts/test-endpoints.js --provider=alibaba,nvidia
//   node scripts/test-endpoints.js --limit=5               # cap models/provider (smoke test)
//   node scripts/test-endpoints.js --wait-video             # poll async video/audio jobs to completion (slow)
//   node scripts/test-endpoints.js --json=report.json       # also write a JSON report
//
// Credentials (env vars — NOT the per-user keys stored in Postgres,
// since this is a standalone script with no DB/login context):
//   TEST_ALIBABA_API_KEY, TEST_ALIBABA_WORKSPACE_ID
//   TEST_NVIDIA_API_KEY
//   TEST_CLOUDFLARE_API_TOKEN, TEST_CLOUDFLARE_ACCOUNT_ID
//   TEST_ELEVENLABS_API_KEY
//   TEST_PIXAZO_API_KEY
// Put these in .env (or export them) — any provider missing its
// credentials is skipped, not counted as a failure.
// ──────────────────────────────────────────────────────────────

require('dotenv').config();

const AlibabaProvider = require('../providers/alibaba');
const NvidiaProvider = require('../providers/nvidia');
const CloudflareProvider = require('../providers/cloudflare');
const ElevenLabsProvider = require('../providers/elevenlabs');
const PixazoProvider = require('../providers/pixazo');
const { getChatModels, getModelsByCategory } = require('../providers/alibaba-models');
const { NVIDIA_TEXT_MODELS, NVIDIA_VISION_MODELS } = require('../modules/chatbot');

// ── CLI args ──
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);
const providerFilter = args.provider ? String(args.provider).split(',') : null;
const limit = args.limit ? parseInt(args.limit, 10) : null;
const waitVideo = !!args['wait-video'];
const jsonOut = args.json || null;

function wanted(providerKey) {
  return !providerFilter || providerFilter.includes(providerKey);
}
function capped(list) {
  return limit ? list.slice(0, limit) : list;
}

// ── tiny concurrency pool so we don't blast a provider with 90
//    simultaneous requests and get rate-limited into false failures ──
async function runPool(items, worker, concurrency = 4, delayMs = 150) {
  const results = [];
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx]);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return results;
}

async function timed(fn) {
  const start = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - start, value };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err.message || String(err) };
  }
}

function record(rows, entry) {
  rows.push(entry);
  const icon = entry.status === 'PASS' ? '✅' : entry.status === 'SUBMITTED' ? '📤' : entry.status === 'SKIPPED' ? '⏭️ ' : '❌';
  const ms = entry.ms !== undefined ? ` (${entry.ms}ms)` : '';
  console.log(`${icon} [${entry.provider}] ${entry.category}/${entry.model}${ms}${entry.error ? ` — ${entry.error}` : ''}`);
}

// ── Alibaba: classify a "vision" catalog entry as image vs video, since
//    imageGeneration()/videoGeneration() are different endpoints ──
function classifyAlibabaVisual(id) {
  if (/(?:^|-)(t2v|i2v|r2v)(?:-|$)/.test(id)) return 'video';
  if (id === 'wan2.6-image' || id === 'wan2.6-r2v' || id === 'wan2.6-r2v-flash') return 'video'; // r2v is video despite the name
  return 'image';
}

// ══════════════════════════════════════════════════════════════
async function testAlibaba(rows) {
  const apiKey = process.env.TEST_ALIBABA_API_KEY;
  const workspaceId = process.env.TEST_ALIBABA_WORKSPACE_ID;
  if (!apiKey || !workspaceId) {
    record(rows, { provider: 'alibaba', category: '*', model: '*', status: 'SKIPPED', error: 'TEST_ALIBABA_API_KEY / TEST_ALIBABA_WORKSPACE_ID not set' });
    return;
  }
  const alibaba = new AlibabaProvider(apiKey, workspaceId);

  // Chat (llm + multimodal) — cheapest, most uniform, biggest catalog.
  const { text, vision } = getChatModels();
  const chatModels = capped([...text, ...vision]);
  await runPool(chatModels, async (model) => {
    const result = await timed(() =>
      alibaba.chatCompletion([{ role: 'user', content: 'Reply with exactly: OK' }], { model, max_tokens: 5 })
    );
    record(rows, {
      provider: 'alibaba', category: 'chat', model,
      status: result.ok ? 'PASS' : 'FAIL', ms: result.ms, error: result.error,
    });
  }, 4, 150);

  // Vision catalog — split into image (real minimal generation) vs video
  // (submit-only by default, since polling every model to completion
  // would take a very long time and cost a lot).
  const visualModels = capped(getModelsByCategory('vision'));
  await runPool(visualModels, async (model) => {
    const kind = classifyAlibabaVisual(model);
    if (kind === 'image' && AlibabaProvider.LEGACY_IMAGE_SYNTHESIS_MODELS.includes(model)) {
      // These models (wan2.1/2.2 t2i + wan2.5-t2i-preview) live on
      // DashScope's older async image-synthesis endpoint, not the sync
      // multimodal-generation one imageGeneration() uses — confirmed
      // 2026-08-10 after they failed with a misleading "url error" when
      // called through the wrong endpoint. '1024*1024' is one of their
      // documented valid sizes (unlike '512*512', which isn't).
      const submit = await timed(() => alibaba.imageSynthesisLegacy('a red circle on white background', { model, size: '1024*1024', prompt_extend: false }));
      if (!submit.ok) {
        record(rows, { provider: 'alibaba', category: 'image', model, status: 'FAIL', ms: submit.ms, error: submit.error });
        return;
      }
      const taskId = submit.value?.output?.task_id;
      if (!waitVideo || !taskId) {
        record(rows, { provider: 'alibaba', category: 'image', model, status: 'SUBMITTED', ms: submit.ms, error: taskId ? undefined : 'no task_id in response' });
        return;
      }
      const polled = await pollAlibabaVideo(alibaba, taskId);
      record(rows, { provider: 'alibaba', category: 'image', model, status: polled.ok ? 'PASS' : 'FAIL', ms: submit.ms + polled.ms, error: polled.error });
    } else if (kind === 'image') {
      // '1328*1328' is a documented valid size for every remaining sync
      // image model (legacy Qwen-Image models are restricted to a fixed
      // preset list that does NOT include '512*512', which is what this
      // used to send — confirmed 2026-08-10 via qwen-image/qwen-image-plus
      // both failing with "size does not match the allowed size").
      const result = await timed(() => alibaba.imageGeneration('a red circle on white background', { model, size: '1328*1328', prompt_extend: false }));
      record(rows, { provider: 'alibaba', category: 'image', model, status: result.ok ? 'PASS' : 'FAIL', ms: result.ms, error: result.error });
    } else {
      const submit = await timed(() => alibaba.videoGeneration('a red circle rotating', { model, resolution: '480P', ratio: '16:9' }));
      if (!submit.ok) {
        record(rows, { provider: 'alibaba', category: 'video', model, status: 'FAIL', ms: submit.ms, error: submit.error });
        return;
      }
      const taskId = submit.value?.output?.task_id;
      if (!waitVideo || !taskId) {
        record(rows, { provider: 'alibaba', category: 'video', model, status: 'SUBMITTED', ms: submit.ms, error: taskId ? undefined : 'no task_id in response' });
        return;
      }
      const polled = await pollAlibabaVideo(alibaba, taskId);
      record(rows, { provider: 'alibaba', category: 'video', model, status: polled.ok ? 'PASS' : 'FAIL', ms: submit.ms + polled.ms, error: polled.error });
    }
  }, 3, 300);

  // Embedding models: AlibabaProvider has no embeddings() method (this
  // app doesn't use embeddings anywhere yet) — nothing to call without
  // inventing a new endpoint, so report as not-covered rather than
  // silently pretending to test it.
  for (const model of capped(getModelsByCategory('embedding'))) {
    record(rows, { provider: 'alibaba', category: 'embedding', model, status: 'SKIPPED', error: 'no embeddings() method on AlibabaProvider — not covered' });
  }
}

async function pollAlibabaVideo(alibaba, taskId, timeoutMs = 5 * 60 * 1000, intervalMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const data = await alibaba.checkVideoTask(taskId);
      const status = data?.output?.task_status;
      if (status === 'SUCCEEDED') return { ok: true, ms: Date.now() - start };
      if (status === 'FAILED') return { ok: false, ms: Date.now() - start, error: data?.output?.message || 'task failed' };
    } catch (err) {
      return { ok: false, ms: Date.now() - start, error: err.message };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, ms: Date.now() - start, error: 'timed out waiting for video task' };
}

// ══════════════════════════════════════════════════════════════
async function testNvidia(rows) {
  const apiKey = process.env.TEST_NVIDIA_API_KEY;
  if (!apiKey) {
    record(rows, { provider: 'nvidia', category: '*', model: '*', status: 'SKIPPED', error: 'TEST_NVIDIA_API_KEY not set' });
    return;
  }
  const nvidia = new NvidiaProvider(apiKey);
  const models = capped([...NVIDIA_TEXT_MODELS, ...NVIDIA_VISION_MODELS]);
  await runPool(models, async (model) => {
    const result = await timed(() =>
      nvidia.chatCompletion([{ role: 'user', content: 'Reply with exactly: OK' }], { model, max_tokens: 5 })
    );
    record(rows, { provider: 'nvidia', category: 'chat', model, status: result.ok ? 'PASS' : 'FAIL', ms: result.ms, error: result.error });
  }, 4, 150);
}

// ══════════════════════════════════════════════════════════════
async function testCloudflare(rows) {
  const apiToken = process.env.TEST_CLOUDFLARE_API_TOKEN;
  const accountId = process.env.TEST_CLOUDFLARE_ACCOUNT_ID;
  if (!apiToken || !accountId) {
    record(rows, { provider: 'cloudflare', category: '*', model: '*', status: 'SKIPPED', error: 'TEST_CLOUDFLARE_API_TOKEN / TEST_CLOUDFLARE_ACCOUNT_ID not set' });
    return;
  }
  const cf = new CloudflareProvider(apiToken, accountId);
  const models = CloudflareProvider.getFreeModels();

  const tts = await timed(() => cf.textToSpeech('connectivity test', { lang: 'en' }));
  record(rows, { provider: 'cloudflare', category: 'tts', model: models.tts[0], status: tts.ok ? 'PASS' : 'FAIL', ms: tts.ms, error: tts.error });

  const img = await timed(() => cf.textToImage({ prompt: 'a red circle', width: 256, height: 256, num_steps: 1 }));
  record(rows, { provider: 'cloudflare', category: 'image', model: models.image[0], status: img.ok ? 'PASS' : 'FAIL', ms: img.ms, error: img.error });
}

// ══════════════════════════════════════════════════════════════
async function testElevenLabs(rows) {
  const apiKey = process.env.TEST_ELEVENLABS_API_KEY;
  if (!apiKey) {
    record(rows, { provider: 'elevenlabs', category: '*', model: '*', status: 'SKIPPED', error: 'TEST_ELEVENLABS_API_KEY not set' });
    return;
  }
  const el = new ElevenLabsProvider(apiKey);

  const conn = await timed(() => el.testConnection());
  record(rows, { provider: 'elevenlabs', category: 'account', model: '(key check)', status: conn.ok ? 'PASS' : 'FAIL', ms: conn.ms, error: conn.error });
  if (!conn.ok) return; // no point burning credits on every model if the key itself is bad

  const { tts: models } = ElevenLabsProvider.getFreeModels();
  await runPool(capped(models), async (model) => {
    const result = await timed(() => el.textToSpeech('Hi', undefined, { model_id: model }));
    record(rows, { provider: 'elevenlabs', category: 'tts', model, status: result.ok ? 'PASS' : 'FAIL', ms: result.ms, error: result.error });
  }, 2, 300);
}

// ══════════════════════════════════════════════════════════════
async function testPixazo(rows) {
  const apiKey = process.env.TEST_PIXAZO_API_KEY;
  if (!apiKey) {
    record(rows, { provider: 'pixazo', category: '*', model: '*', status: 'SKIPPED', error: 'TEST_PIXAZO_API_KEY not set' });
    return;
  }
  const pixazo = new PixazoProvider(apiKey);
  const free = PixazoProvider.getFreeModels();

  const img = await timed(() => pixazo.generateImage({ prompt: 'a red circle', width: 64, height: 64, num_steps: 1 }));
  record(rows, { provider: 'pixazo', category: 'image', model: free.image[0], status: img.ok ? 'PASS' : 'FAIL', ms: img.ms, error: img.error });

  const audio = await timed(() => pixazo.generateAudio({ prompt: 'a short chime sound' }));
  if (!audio.ok) {
    record(rows, { provider: 'pixazo', category: 'audio', model: free.audio[0], status: 'FAIL', ms: audio.ms, error: audio.error });
  } else {
    record(rows, { provider: 'pixazo', category: 'audio', model: free.audio[0], status: waitVideo ? await pollPixazo(pixazo, audio.value?.request_id) : 'SUBMITTED', ms: audio.ms });
  }

  for (const { mode, model } of free.video) {
    const params = { prompt: 'a red circle rotating', width: 512, height: 512, num_frames: 25 };
    if (mode === 'image-to-video') params.image_url = 'https://placehold.co/512x512.png';
    if (mode === 'video-to-video') params.video_url = 'https://raw.githubusercontent.com/w3c/web-platform-tests/master/media-source/mp4/test.mp4';
    const submit = await timed(() => pixazo.generateVideo(mode, params));
    if (!submit.ok) {
      record(rows, { provider: 'pixazo', category: 'video', model: `${model} (${mode})`, status: 'FAIL', ms: submit.ms, error: submit.error });
      continue;
    }
    const status = waitVideo ? await pollPixazo(pixazo, submit.value?.request_id) : 'SUBMITTED';
    record(rows, { provider: 'pixazo', category: 'video', model: `${model} (${mode})`, status, ms: submit.ms });
  }
}

async function pollPixazo(pixazo, requestId, timeoutMs = 5 * 60 * 1000, intervalMs = 5000) {
  if (!requestId) return 'FAIL';
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const data = await pixazo.checkStatus(requestId);
      if (data.status === 'COMPLETED') return 'PASS';
      if (data.status === 'FAILED' || data.status === 'ERROR') return 'FAIL';
    } catch {
      return 'FAIL';
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return 'FAIL';
}

// ══════════════════════════════════════════════════════════════
async function main() {
  const rows = [];
  console.log('Testing configured AI providers with real API calls...\n');

  const testers = [
    ['alibaba', testAlibaba],
    ['nvidia', testNvidia],
    ['cloudflare', testCloudflare],
    ['elevenlabs', testElevenLabs],
    ['pixazo', testPixazo],
  ];

  for (const [key, fn] of testers) {
    if (!wanted(key)) continue;
    await fn(rows);
  }

  // ── Summary ──
  const counts = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  console.log('\n─────────────────────────────');
  console.log('Summary:', JSON.stringify(counts));
  const failures = rows.filter((r) => r.status === 'FAIL');
  if (failures.length) {
    console.log('\nFailed:');
    for (const f of failures) console.log(`  [${f.provider}] ${f.category}/${f.model}: ${f.error}`);
  }

  if (jsonOut) {
    require('fs').writeFileSync(jsonOut, JSON.stringify({ generatedAt: new Date().toISOString(), counts, rows }, null, 2));
    console.log(`\nWrote JSON report to ${jsonOut}`);
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error running test-endpoints:', err);
  process.exit(2);
});