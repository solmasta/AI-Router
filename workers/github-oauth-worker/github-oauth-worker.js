// GitHub OAuth worker - mirrors the pattern of drive-auth-worker.js.
// Handles three endpoints:
//   GET  /authorize  - redirects the user's browser to GitHub's OAuth consent page
//   GET  /callback   - GitHub redirects here after consent; exchanges code for tokens
//                      and redirects back to the app with the result in the hash
//   POST /refresh    - exchanges a refresh_token for a fresh access_token
//                      (requires X-App-Secret; the refresh_token itself is
//                       the user-specific credential, so OAuth-only users
//                       can renew without also configuring WRITE_SECRET)
//
// Required Worker secrets (set in Cloudflare dashboard):
//   APP_SECRET          - shared app secret (same as the other workers)
//   GITHUB_CLIENT_ID    - OAuth app Client ID (also hardcoded in index.html)
//   GITHUB_CLIENT_SECRET - OAuth app Client Secret (never in frontend)
//
// Required Worker vars:
//   APP_ORIGIN          - the URL of the deployed index.html, e.g. https://your-app.pages.dev
//                         used to build the redirect_uri sent to GitHub and to set the
//                         final redirect destination after /callback.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Secret, X-Write-Secret",
};

function checkAuth(request, env) {
  const provided = request.headers.get("X-App-Secret");
  return !!env.APP_SECRET && provided === env.APP_SECRET;
}
// The redirect_uri registered on the GitHub OAuth app must exactly match
// what we send here.  We always use the worker's own /callback path so the
// app origin never has to handle an OAuth redirect itself (it can be a
// static CDN page with no server logic).
function callbackUri(env, workerUrl) {
  // Prefer an explicit CALLBACK_URI env var so operators can override without
  // redeploying; fall back to <this-worker-origin>/callback.
  if (env.CALLBACK_URI) return env.CALLBACK_URI;
  const u = new URL(workerUrl);
  return `${u.origin}/callback`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // /authorize - open this URL in a popup from the frontend.
    // No auth check here - this is a plain redirect the browser follows
    // (like Google's OAuth consent URL, which is also unauthenticated).
    if (url.pathname === "/authorize") {
      if (!env.GITHUB_CLIENT_ID) {
        return new Response("GITHUB_CLIENT_ID not configured", { status: 500 });
      }
      const state = crypto.randomUUID();
      const cb = callbackUri(env, request.url);
      const params = new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        redirect_uri: cb,
        scope: "repo",
        state,
      });
      return Response.redirect(
        `https://github.com/login/oauth/authorize?${params}`,
        302
      );
    }

    // /callback - GitHub redirects here with ?code=...&state=...
    // Exchange the code for tokens and post the result to the opener window,
    // then close the popup.  This works even for static-page apps that can't
    // receive the code themselves.
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error || !code) {
        const msg = error || "missing_code";
        return htmlPage(`
          <p style="color:#f87171">GitHub auth failed: ${escHtml(msg)}</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({type:"gh_oauth_error",error:${JSON.stringify(msg)}}, "*");
              window.close();
            }
          </script>`);
      }

      const cb = callbackUri(env, request.url);
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "openai-router-github-oauth-worker",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: cb,
        }),
      });
      const tokenData = await tokenRes.json().catch(() => ({}));

      if (!tokenData.access_token) {
        const msg = tokenData.error_description || tokenData.error || "token exchange failed";
        return htmlPage(`
          <p style="color:#f87171">Token exchange failed: ${escHtml(msg)}</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({type:"gh_oauth_error",error:${JSON.stringify(msg)}}, "*");
              window.close();
            }
          </script>`);
      }

      // GitHub's standard OAuth flow doesn't issue refresh tokens.
      // The access_token is long-lived (no expiry) until revoked.
      // We still send refresh_token if GitHub ever adds it (fine-grained PATs
      // do return expiring tokens + refresh tokens).
      const payload = {
        type: "gh_oauth_success",
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_in: tokenData.expires_in || null,
        token_type: tokenData.token_type || "bearer",
        scope: tokenData.scope || "",
      };

      return htmlPage(`
        <p style="color:#4ade80">Connected! Closing&#8230;</p>
        <script>
          if (window.opener) {
            window.opener.postMessage(${JSON.stringify(payload)}, "*");
            window.close();
          } else {
            document.body.innerHTML='<p>Connected. You can close this tab.</p>';
          }
        </script>`);
    }

    // /refresh - called by the frontend to get a fresh access_token when
    // the current one has expired (only relevant for fine-grained tokens).
    // Don't require WRITE_SECRET here: an OAuth-only setup would otherwise
    // work right up until the first expiry, then permanently strand repo
    // access even though the browser still holds the refresh_token needed
    // to renew it.
    if (url.pathname === "/refresh") {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405, headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      if (!checkAuth(request, env)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      let body;
      try { body = await request.json(); } catch {
        return new Response(JSON.stringify({ error: "Invalid request body" }), {
          status: 400, headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      if (!body.refresh_token) {
        return new Response(JSON.stringify({ error: "Missing refresh_token" }), {
          status: 400, headers: { "Content-Type": "application/json", ...CORS },
        });
      }

      const refreshRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": "openai-router-github-oauth-worker",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: body.refresh_token,
        }),
      });
      const refreshData = await refreshRes.json().catch(() => ({}));

      if (!refreshData.access_token) {
        return new Response(JSON.stringify({
          error: refreshData.error_description || refreshData.error || "Refresh failed",
          revoked: refreshData.error === "bad_refresh_token",
        }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
      }

      return new Response(JSON.stringify({
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token || null,
        expires_in: refreshData.expires_in || null,
      }), { headers: { "Content-Type": "application/json", ...CORS } });
    }

    if (request.method === "GET") {
      if (!checkAuth(request, env)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { "Content-Type": "application/json", ...CORS },
        });
      }
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404, headers: { "Content-Type": "application/json", ...CORS },
    });
  },
};

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlPage(body) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;background:#111;color:#e5e5e5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:15px}</style>
</head><body>${body}</body></html>`,
    { headers: { "Content-Type": "text/html;charset=utf-8" } }
  );
}
