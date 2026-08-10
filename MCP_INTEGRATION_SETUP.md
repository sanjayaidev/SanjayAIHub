# MCP Integration (Higgsfield)

Adds a generic MCP (Model Context Protocol) client to the backend, plus a
dedicated **Higgsfield** module page (`/higgsfield.html`) — a manual
prompt → image/video generator, not wired into the chatbot's own model
picker. More MCP servers can be added later by editing one file.

## How it works

Higgsfield's MCP server (`https://mcp.higgsfield.ai/mcp`) doesn't use
static API keys — each person signs in with their own Higgsfield account,
the same shape as the existing "Connect GitHub" flow, but using the
[MCP Authorization spec](https://modelcontextprotocol.io/specification/draft/basic/authorization)
(OAuth 2.1 + PKCE + Dynamic Client Registration) instead of GitHub's OAuth.

- **`services/mcp/registry.js`** — the list of configured MCP servers.
  Right now just `higgsfield`; add more servers here later, nothing else
  needs to change.
- **`services/mcp/oauth-provider.js`** — implements the official
  `@modelcontextprotocol/sdk`'s `OAuthClientProvider` interface, backed by
  Postgres (durable: DCR client registration + per-user tokens) and
  `req.session` (short-lived: PKCE verifier + state for the redirect round
  trip).
- **`services/mcp/client.js`** — thin wrapper around the SDK's `Client` +
  `StreamableHTTPClientTransport`. Token refresh is handled by the SDK
  transport itself (tries the stored token, refreshes on 401, retries) —
  we don't track expiry ourselves.
- **`routes/mcp.js`** — generic REST endpoints, all under `/api/mcp/:serverKey/…`:
  - `GET /servers` — list configured servers
  - `GET /:serverKey/connect` — start the OAuth flow (one-time `?token=`
    JWT bridge, same pattern as the `/agent` GitHub-connect middleware in
    `server.js`, since this is a plain browser navigation and can't carry
    an `Authorization` header)
  - `GET /:serverKey/callback` — OAuth redirect target
  - `GET /:serverKey/status` — is the current user connected?
  - `POST /:serverKey/disconnect`
  - `GET /:serverKey/tools` — live tool list + JSON-schema, from the server
    itself (nothing hardcoded — Higgsfield's tool catalog can change
    without a code update here)
  - `POST /:serverKey/call` — `{ tool, arguments }` → runs it, stores the
    result in `mcp_generations` for history
  - `GET /:serverKey/history` — past generations for this user
- **`public/higgsfield.html`** — connect button, then a form built
  dynamically from whatever `tools/list` returns (prompt/model/aspect
  ratio/etc. fields, inferred from each tool's JSON schema), a result
  panel, and a history list. Linked from the homepage module grid.

## 1. Install the new dependency

```bash
npm install
```
(adds `@modelcontextprotocol/sdk`, already in `package.json`/`package-lock.json`)

## 2. Run the DB migration

```bash
psql $DATABASE_URL < migrations/add_mcp_integration.sql
```

Adds three tables: `mcp_client_registrations` (our app's DCR identity per
server, shared across users), `user_mcp_connections` (per-user tokens),
`mcp_generations` (history).

## 3. Env vars

None required specifically for Higgsfield — no API key, no client ID to
register by hand. It reuses `SESSION_SECRET` and `APP_BASE_URL` you
already set up for the Google/GitHub login work. The very first person to
click "Connect Higgsfield" triggers Dynamic Client Registration
automatically; the resulting `client_id`/`client_secret` are stored in
`mcp_client_registrations` and reused for every user after that.

## 4. Try it

1. Log in, go to **Higgsfield** on the homepage (or `/higgsfield.html`).
2. Click **Connect Higgsfield** → redirected to Higgsfield to sign in →
   redirected back, connected.
3. Pick a tool (e.g. an image-generation one), fill in the prompt, hit
   **Generate**.

## Notes / things to know

- **Per-user, not shared.** Each SanjayAIHub user connects their *own*
  Higgsfield account and spends their *own* Higgsfield credits — there's
  no shared pool.
- **Tool names/fields aren't hardcoded.** The form is generated from
  whatever `tools/list` returns, so if Higgsfield adds/renames tools or
  fields on their end, the page picks it up automatically — no guarantee
  the auto-built form is as polished as a hand-built one per tool, but it
  won't break.
- **Adding another MCP server later:** add an entry to
  `services/mcp/registry.js`, then either reuse `higgsfield.html` as a
  template for a new page, or point a new page at
  `/api/mcp/<your-server-key>/…` — the backend needs zero other changes.
- **Wiring into the chatbot instead/also:** the chatbot's NVIDIA/Alibaba
  models would need a tool-calling loop added (expose `tools/list` results
  as OpenAI-style `tools` on the chat completion call, execute
  `tools/call` when the model asks, feed the result back) — `services/mcp/client.js`'s
  `withClient()` already returns a plain SDK `Client` so `listTools()`/
  `callTool()` are ready to use for that if you want it later.
