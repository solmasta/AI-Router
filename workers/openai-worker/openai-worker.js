const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Secret",
  // Response headers are invisible to client-side fetch() on a cross-origin
  // response unless explicitly exposed here - Retry-After isn't on the
  // browser's CORS-safelisted response header list, so without this the
  // coding agent's 429-retry countdown (index.html) can never actually read
  // OpenAI's real Retry-After value no matter what upstream sends.
  "Access-Control-Expose-Headers": "Retry-After",
};

// Shared-secret check so a bare Worker URL (visible in the page source) can't
// be hit directly by scanners/bots to spend the OPENAI_KEY budget. Not a
// substitute for real auth - the secret ships in client JS - but it stops
// casual/automated abuse of the raw URL.
function checkAuth(request, env) {
  const provided = request.headers.get("X-App-Secret");
  return !!env.APP_SECRET && provided === env.APP_SECRET;
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

    // Live model list endpoint
    if (request.method === "GET" && url.pathname === "/models") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${env.OPENAI_KEY}` }
      });
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    if (request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", key_set: !!env.OPENAI_KEY }), {
        headers: { "Content-Type": "application/json", ...CORS }
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

    // OpenAI's own API is already the OpenAI chat-completions format, so
    // this is a straight passthrough - the request body from index.html
    // needs no conversion at all.
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_KEY}`,
      },
      body: JSON.stringify(body),
    });

    // Reconstructing a fresh Response below (rather than just returning
    // `upstream` as-is) otherwise silently drops every upstream header,
    // including Retry-After on a 429 - the coding agent's retry countdown
    // (index.html) has nothing real to read without this, and falls back to
    // a guessed default no matter what OpenAI actually sent.
    const retryAfter = upstream.headers.get("Retry-After");
    const retryAfterHeaders = retryAfter ? { "Retry-After": retryAfter } : {};

    if (body.stream) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...retryAfterHeaders, ...CORS }
      });
    }

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": "application/json", ...retryAfterHeaders, ...CORS }
    });
  },
};
