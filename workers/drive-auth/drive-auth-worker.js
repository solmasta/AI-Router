const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Secret",
};

// Must match GOOGLE_CLIENT_ID in index.html - a Google OAuth client_id is
// meant to be public (it's already embedded in the frontend JS), unlike the
// client_secret below, so it's fine hardcoded here rather than configured
// as a Worker secret.
const GOOGLE_CLIENT_ID = "899534056653-eb854ngfhontj1v370l0luj6fd1s6hcj.apps.googleusercontent.com";

function checkAuth(request, env) {
  const provided = request.headers.get("X-App-Secret");
  return !!env.APP_SECRET && provided === env.APP_SECRET;
}

async function googleTokenRequest(params) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (!checkAuth(request, env)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    let body;
    try { body = await request.json(); }
    catch {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    // One-time exchange right after the Drive sign-in popup: trades the
    // authorization code for a first access_token + a long-lived
    // refresh_token. redirect_uri is literally the string "postmessage" -
    // that's what Google's Identity Services JS library uses internally for
    // its popup-based code flow (initCodeClient with ux_mode:"popup"), and
    // the token exchange has to echo it back exactly.
    if (url.pathname === "/exchange") {
      if (!body.code) {
        return new Response(JSON.stringify({ error: "Missing code" }), {
          status: 400, headers: { "Content-Type": "application/json", ...CORS }
        });
      }
      const { ok, data } = await googleTokenRequest({
        code: body.code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: "postmessage",
        grant_type: "authorization_code",
      });
      if (!ok || !data.access_token) {
        console.log("GOOGLE TOKEN ERROR:", JSON.stringify(data));
        return new Response(JSON.stringify({ error: data.error_description || data.error || "Exchange failed" }), {
          status: 400, headers: { "Content-Type": "application/json", ...CORS }
        });
      }
      return new Response(JSON.stringify({
        access_token: data.access_token,
        expires_in: data.expires_in,
        refresh_token: data.refresh_token || null,
      }), { headers: { "Content-Type": "application/json", ...CORS } });
    }

    // Silently mints a fresh access_token from a previously stored
    // refresh_token - no popup, no user interaction, safe to call on every
    // cold page load or whenever the current access_token has expired.
    if (url.pathname === "/refresh") {
      if (!body.refresh_token) {
        return new Response(JSON.stringify({ error: "Missing refresh_token" }), {
          status: 400, headers: { "Content-Type": "application/json", ...CORS }
        });
      }
      const { ok, data } = await googleTokenRequest({
        refresh_token: body.refresh_token,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
      });
      if (!ok || !data.access_token) {
        // invalid_grant means the refresh_token itself was revoked/expired
        // (e.g. the user removed access in their Google account) - the
        // client has to fall back to a real reconnect, not retry this.
        return new Response(JSON.stringify({
          error: data.error_description || data.error || "Refresh failed",
          revoked: data.error === "invalid_grant",
        }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
      }
      return new Response(JSON.stringify({
        access_token: data.access_token,
        expires_in: data.expires_in,
      }), { headers: { "Content-Type": "application/json", ...CORS } });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404, headers: { "Content-Type": "application/json", ...CORS }
    });
  },
};
