# Testing AI provider endpoints

`scripts/test-endpoints.js` makes real, billed calls against every AI
provider this app talks to, using the app's own provider classes and
model catalogs (`providers/*.js`, `providers/alibaba-models.js`,
`modules/chatbot.js`'s NVIDIA lists) — nothing is duplicated or
reimplemented, so a pass/fail here always reflects the real code path.

## Run it

```bash
npm run test:endpoints

# or with options:
node scripts/test-endpoints.js --provider=alibaba
node scripts/test-endpoints.js --provider=alibaba,nvidia
node scripts/test-endpoints.js --limit=5              # cap models/provider — cheap smoke test
node scripts/test-endpoints.js --wait-video            # poll async video/audio jobs to completion (slow, costs more)
node scripts/test-endpoints.js --json=report.json      # also write a JSON report
```

## Credentials

This is a standalone script — it has no login/DB context, so it does
**not** use the per-user keys stored in Postgres via Profile → API Keys.
Instead it reads its own env vars (put them in `.env` or export them):

```env
TEST_ALIBABA_API_KEY=
TEST_ALIBABA_WORKSPACE_ID=
TEST_NVIDIA_API_KEY=
TEST_CLOUDFLARE_API_TOKEN=
TEST_CLOUDFLARE_ACCOUNT_ID=
TEST_ELEVENLABS_API_KEY=
TEST_PIXAZO_API_KEY=
```

Any provider missing its credentials is reported as **SKIPPED**, not
FAILED — the summary only counts providers you've actually configured.

## What gets tested, and how

| Provider | Coverage | Notes |
|---|---|---|
| **Alibaba** | ~90 chat models (llm+multimodal), all vision-category models (image + video), split by name pattern | Chat: 5-token "say OK" prompt. Image: one 512×512 generation. Video (T2V/I2V/R2V): submitted and **not polled to completion by default** (`--wait-video` to poll) — there are ~20 video models and polling each to completion would take a long time and cost a lot. Embedding models (3): **skipped** — `AlibabaProvider` has no `embeddings()` method (this app doesn't use embeddings anywhere), so there's no real endpoint to call without inventing one. |
| **NVIDIA** | All 10 models from `NVIDIA_TEXT_MODELS` + `NVIDIA_VISION_MODELS` | Same 5-token chat prompt (vision models are only tested on their text-completion path, not actual image input). |
| **Cloudflare** | Both free models (MeloTTS, Flux 1 Schnell) | Tiny TTS phrase + a 256×256, 1-step image. |
| **ElevenLabs** | Account check first (`/v1/user`, free), then all 6 free-tier TTS models | If the account check fails, model tests are skipped rather than burning credits on a dead key. |
| **Pixazo** | Image (Flux 1 Schnell), audio (Ace Step), and all 3 video modes (LTX 2.3: text/image/video-to-video) | Image tested at 64×64/1-step (near-free). Audio/video are submitted and reported **SUBMITTED** unless `--wait-video` is passed. |

## Reading the output

- `✅ PASS` — real response came back successfully.
- `❌ FAIL` — the call errored; the message is the provider's own error
  text, so you can tell auth failures apart from model-specific
  validation issues (e.g. a model wanting a different image size).
- `📤 SUBMITTED` — an async video/audio job was accepted (got a task/request
  ID back) but not polled to completion. This still confirms auth + the
  endpoint are working; it just doesn't confirm the *model itself*
  produces good output.
- `⏭️  SKIPPED` — no credentials configured for that provider (or, for
  Alibaba's embedding models, no method exists yet to call them).

Exit code is `1` if anything failed, `0` otherwise — usable in a manual
pre-deploy check (**not** meant to run in CI on every push, since it
costs real money and can take several minutes with `--wait-video`).
