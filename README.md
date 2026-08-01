# AI Router

A single-file PWA chat client (`index.html`) that talks to three Cloudflare Workers:

- **DeepInfra** — open-source models (Llama, Qwen, DeepSeek, Mistral, Gemma).
- **OpenRouter** — uncensored/roleplay models plus a few free ones.
- **Claude** — Anthropic's Claude models (Opus, Sonnet, Haiku) with your API credits.

Everything the browser needs — markup, CSS, and JS — lives inline in `index.html`. There's no build step and no separate `config.json`/`script.js`/`style.css` to keep in sync; model lists, worker URLs, and system-prompt defaults are all defined directly inside `index.html`'s `<script>` block (`BACKENDS`, `DEFAULT_PROMPTS`).

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire app — UI, styles, and logic |
| `manifest.json` | PWA manifest (install to home screen) |
| `sw.js` | Service worker — offline caching |
| `icon-32.png` / `icon-192.png` / `icon-512.png` | App icons |
| `workers/openai-router-chat/openai-router.js` + `wrangler.jsonc` | Cloudflare Worker — proxies DeepInfra + a free web-search endpoint |
| `workers/openrouter-worker/openrouter-worker.js` + `wrangler.toml` | Cloudflare Worker — proxies OpenRouter |
| `workers/claude-worker/claude-worker.js` + `wrangler.jsonc` | Cloudflare Worker — proxies Claude API, converts OpenAI format to Claude format |
| `workers/drive-auth/drive-auth-worker.js` + `wrangler.jsonc` | Cloudflare Worker — holds the Google OAuth client secret; exchanges/refreshes Drive access tokens so the app never needs to re-prompt sign-in |
| `workers/github-ops-worker/github-ops-worker.js` + `wrangler.jsonc` | Cloudflare Worker — proxies GitHub API operations (read/write/list files, merge branches) used by the app's repo tools |

Each Worker lives in its own `workers/<name>/` folder with its script and `wrangler.jsonc`/`.toml` side by side. This isn't just tidiness — if you connect Cloudflare's Git integration (auto-deploy on push) for more than one of these Workers to this repo, **each project's "Root directory" build setting must point at that Worker's own subfolder**, not the repo root. Two projects both watching the repo root previously fought over a single shared `wrangler.jsonc`, each auto-committing the `name` field back to match itself on every push. One config file per folder means each Cloudflare project only ever sees its own file.
| `import-prompts.html` | Standalone page to bulk-import the default system prompts into `localStorage`. Optional — `index.html` already has an "Import Defaults" button that does the same thing from within the app. |

## Setup

### 1. Pick a shared secret

Generate a random string (e.g. `openssl rand -hex 32`) — this is `APP_SECRET`. All Workers check it on every request so the raw Worker URL (visible in `index.html`'s source) can't be hit directly by bots/scanners to spend your API credits. It's not real auth — the same string ships in the client JS, so anyone who reads the repo can read it too — but it does stop casual/automated abuse of the bare URL.

### 2. Deploy the DeepInfra Worker

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and create a new Worker.
2. Paste the contents of `workers/openai-router-chat/openai-router.js`.
3. Add a secret named `DEEPINFRA_KEY` with your [DeepInfra API key](https://deepinfra.com).
4. Add a secret named `APP_SECRET` with the string from step 1.
5. Deploy and copy the Worker URL.

### 3. Deploy the OpenRouter Worker

1. Create a second Worker.
2. Paste the contents of `workers/openrouter-worker/openrouter-worker.js`.
3. Add a secret named `OPENROUTER_KEY` with your [OpenRouter API key](https://openrouter.ai).
4. Add a secret named `APP_SECRET` with the **same** string from step 1.
5. Deploy and copy the Worker URL.

### 4. Deploy the Claude Worker

1. Create a third Worker.
2. Paste the contents of `workers/claude-worker/claude-worker.js`.
3. Add a secret named `ANTHROPIC_API_KEY` with your [Anthropic API key](https://console.anthropic.com/api/keys).
4. Add a secret named `APP_SECRET` with the **same** string from step 1.
5. Deploy and copy the Worker URL.

### 5. Deploy the Drive Auth Worker (optional — only needed for Google Drive backup)

Google Drive backup uses an OAuth flow that needs a client secret, which can't live in frontend JS - this Worker holds it and mints/renews Drive access tokens on the app's behalf so you don't have to reconnect Drive every time a token expires (~1hr). This deploys onto the existing **`ai-router-drive`** Worker (its `workers/drive-auth/wrangler.jsonc` config already targets that name) - no new Worker project needed.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), open the OAuth 2.0 Client ID already used by `GOOGLE_CLIENT_ID` in `index.html` (a "Web application" type client). Copy its **Client Secret**. If it doesn't have one yet (older client types don't), you may need to create a new Web application OAuth client and update `GOOGLE_CLIENT_ID` in both `index.html` and `workers/drive-auth/drive-auth-worker.js` to match.
2. Open the `ai-router-drive` Worker in the Cloudflare dashboard and replace its code with the contents of `workers/drive-auth/drive-auth-worker.js` (Edit Code / Quick Edit, then Deploy) - or run `npx wrangler deploy --config workers/drive-auth/wrangler.jsonc` from this repo, which targets that same Worker name. If you use Cloudflare's Git integration instead of manual `wrangler deploy`, set this project's **Root directory** (Settings → Build) to `workers/drive-auth` so it never touches another Worker's config.
3. Add a secret named `GOOGLE_CLIENT_SECRET` with the value from step 1.
4. Add a secret named `APP_SECRET` with the **same** string from step 1 of Setup (check it's actually present - it's easy to add `GOOGLE_CLIENT_SECRET` first and forget this one).
5. Confirm its URL under Settings → Domains (the default is `https://ai-router-drive.<your-subdomain>.workers.dev`) and use that for `DRIVE_AUTH_URL` in the next step.

### 6. Deploy the GitHub Ops Worker (optional — needed for repo-aware coding/file edits)

This Worker is what lets the app read files, write commits, list directories, and merge branches in a connected repository. The browser only stores which repo to point at; the real GitHub token stays server-side as a Cloudflare secret.

1. Create another Worker and deploy `workers/github-ops-worker/github-ops-worker.js` to it - or run `npx wrangler deploy --config workers/github-ops-worker/wrangler.jsonc` from this repo. If you use Cloudflare's Git integration instead of manual `wrangler deploy`, set that project's **Root directory** to `workers/github-ops-worker`.
2. Add a secret named `GITHUB_TOKEN` containing a GitHub personal access token with the repo permissions you want this app to use.
3. Add a secret named `APP_SECRET` with the **same** string from step 1 of Setup.
4. In `workers/github-ops-worker/wrangler.jsonc`, set `ALLOWED_REPOS` to a comma-separated list of the exact `owner/repo` pairs this Worker is allowed to touch. The default is just `solmasta/openai-router`.
5. Deploy and copy the Worker URL.

### 7. Point the frontend at your Workers

In `index.html`, find these lines near the top of the `<script>` block:

```js
var DI_URL="https://openai-router-chat.lukedorsett.workers.dev";
var OR_URL="https://openrouter-worker.lukedorsett.workers.dev";
var CLAUDE_URL="https://claude-worker.lukedorsett.workers.dev";
var DRIVE_AUTH_URL="https://ai-router-drive.lukedorsett.workers.dev";
var GH_OPS_URL="https://github-ops-worker.lukedorsett.workers.dev";
var APP_SECRET="CHANGE_ME_APP_SECRET";
```

Replace `DI_URL`, `OR_URL`, `CLAUDE_URL`, `DRIVE_AUTH_URL`, and `GH_OPS_URL` with your own Worker URLs from steps 2–6, and `APP_SECRET` with the exact string you set as the `APP_SECRET` secret on all Workers.

### 8. Deploy to GitHub Pages

1. Push `index.html`, `manifest.json`, `sw.js`, and the icon files to the root of a repo.
2. Enable GitHub Pages: **Settings → Pages → Deploy from branch → main → / (root)**.
3. If the repo is a *project* page (`username.github.io/reponame`), the service worker registration in `index.html` (`navigator.serviceWorker.register('/reponame/sw.js')`) must match your repo name — update the path if you rename the repo.

## Adding models

Edit the `BACKENDS` object inside `index.html`'s `<script>` block — each backend (`deepinfra`, `openrouter`, `claude`) has a `models` array. Any model your provider serves works — use its exact model ID:

```js
{ id:"meta-llama/Meta-Llama-3-8B-Instruct", label:"Llama 3 8B", cat:"Everyday", desc:"..." }
```

Claude model IDs: `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`.

## Security note

All Workers check the `X-App-Secret` header against an `APP_SECRET` secret (set up above) before doing anything else, so a bare Worker URL discovered by a scanner or bot can't spend your API credits without also knowing that string. That said, this repo is public and `APP_SECRET` is embedded in `index.html`'s client-side JS — anyone who actually reads the source (here or via view-source on the live page) can read it too. This raises the bar against casual/automated abuse of the raw URL; it isn't a substitute for real per-user auth. If that's not enough for your usage, consider adding Cloudflare rate limiting on top.

**Claude API key in particular:** Store your Anthropic API key as a Cloudflare secret. Never commit it to the repo or hard-code it in the frontend. The same applies to DeepInfra and OpenRouter keys.
