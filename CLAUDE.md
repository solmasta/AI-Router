# AI-Router

(repo renamed from `openai-router` - the worker folder `workers/openai-router-chat/` keeps its old name since that's a separately-deployed Cloudflare Worker service, unaffected by the repo rename.)

Single-file PWA (`index.html`) - all frontend logic lives in two inline
`<script>` blocks. Backed by several Cloudflare Workers, each in its own
`workers/<name>/` folder alongside its own `wrangler.jsonc`/`.toml` config
(`workers/openai-router-chat/`, `workers/openrouter-worker/`,
`workers/drive-auth/`, `workers/github-ops-worker/`,
`workers/github-oauth-worker/`). Keep each Worker's config in its own folder -
if a Worker's Cloudflare project uses Git auto-deploy, its dashboard "Root
directory" build setting must point at that folder specifically, otherwise
two projects sharing one config file will fight over its `name` field on
every push (this happened before the split into `workers/`).

## Before committing any change to index.html

Run the regression suite and make sure it passes:

```
# one-time per session: serve the repo and have Playwright's Chromium available
NODE_PATH=/opt/node22/lib/node_modules npx http-server . -p 8899 --silent &

NODE_PATH=/opt/node22/lib/node_modules node tests/regression.js
```

It drives the real app in headless Chromium and checks the flows that have
actually broken before: a failed send keeping the message usable (Regen +
tab storage), vision model auto-switch/restore, tab isolation and
switch-back, memory add/delete, and profile isolation. Network calls to the
real workers fail in most sandboxes (no egress) - that's expected and
already filtered out of the error count; the assertions that matter check
app state, not whether a live model reply came back.

If you change one of the flows above, update `tests/regression.js` in the
same commit rather than letting it drift out of sync with what it claims to
cover.

## Bump the version number with every user-visible change

The version string (two spots: the header `.wm span`, and the Settings modal
title - `grep -n "v5\."` finds both) is how the user confirms a deploy
actually landed, especially on a PWA where the service worker can serve a
stale cached copy. Bump it in the same commit as any change they'd notice -
not just feature work, bug fixes too. Skipping a bump because a change
"felt small" is exactly what makes the version number useless as a signal.
