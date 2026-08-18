const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Secret",
  // Response headers are invisible to client-side fetch() on a cross-origin
  // response unless explicitly exposed here - Retry-After isn't on the
  // browser's CORS-safelisted response header list, so without this the
  // coding agent's 429-retry countdown (index.html) can never actually read
  // DeepInfra's real Retry-After value no matter what upstream sends.
  "Access-Control-Expose-Headers": "Retry-After",
};

// Shared-secret check so a bare Worker URL (visible in the page source) can't
// be hit directly by scanners/bots to spend the DEEPINFRA_KEY budget. Not a
// substitute for real auth - the secret ships in client JS - but it stops
// casual/automated abuse of the raw URL.
function checkAuth(request, env) {
  const provided = request.headers.get("X-App-Secret");
  return !!env.APP_SECRET && provided === env.APP_SECRET;
}

// Shared timeout wrapper for the free structured-data lookups below, so a
// hung upstream (no response at all, as opposed to an HTTP error) can't
// stall the whole /search request up to the Worker's wall-clock limit.
async function fetchWithTimeout(url, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { signal: ac.signal }); }
  finally { clearTimeout(timer); }
}

async function handleSearch(query, env) {
  // Defense in depth: cap query length regardless of what the client sends,
  // so a stray large paste can never produce an oversized downstream request.
  query = (query || "").slice(0, 300);
  const results = [];

  // General web search via Tavily (if configured) - real any-topic web
  // results, useful for things like "what's the latest version of X" or
  // checking current library/API docs while coding.
  if (results.length === 0 && env.TAVILY_API_KEY) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      const tRes = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: env.TAVILY_API_KEY,
          query: query,
          max_results: 4,
          search_depth: 'basic'
        }),
        signal: ac.signal
      });
      clearTimeout(timer);
      const tData = await tRes.json();
      if (tData.answer) {
        results.push(`Answer: ${tData.answer}`);
      }
      if (tData.results && tData.results.length) {
        tData.results.slice(0, 4).forEach(r => {
          results.push(`${r.title}: ${(r.content || '').slice(0, 300)} (source: ${r.url})`);
        });
      }
    } catch(e) {}
  }

  // Fallback - DuckDuckGo Instant Answer API, free, zero setup, no key.
  // Used when Tavily isn't configured or didn't return anything useful.
  if (results.length === 0) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 4000);
      const dRes = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        { signal: ac.signal }
      );
      clearTimeout(timer);
      const dData = await dRes.json();

      if (dData.AbstractText) {
        results.push(`${dData.Heading || 'Summary'}: ${dData.AbstractText} (source: ${dData.AbstractSource || 'DuckDuckGo'})`);
      }
      if (dData.Answer) {
        results.push(`Answer: ${dData.Answer}`);
      }
      if (dData.Definition) {
        results.push(`Definition: ${dData.Definition} (source: ${dData.DefinitionSource || ''})`);
      }
      if (results.length === 0 && dData.RelatedTopics && dData.RelatedTopics.length > 0) {
        dData.RelatedTopics.slice(0, 3).forEach(t => {
          if (t.Text) results.push(t.Text);
        });
      }
    } catch(e) {}
  }

  return results;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Public endpoint: lets the frontend bootstrap APP_SECRET on page load
    // before it has the secret to authenticate with. Deliberately no
    // Origin/Referer gating here (an earlier version added one matching
    // claude-worker's, and it broke secret bootstrapping in production for
    // reasons that didn't reproduce from the request logs - Origin looked
    // correct on other calls from the same page/session, but this endpoint
    // still rejected it). Origin/Referer are ordinary request headers any
    // non-browser client can set to whatever it likes anyway, so that check
    // was only ever a deterrent, not a real boundary - and the operation it
    // was actually guarding (github-ops-worker's write_file/merge_branch)
    // now has its own separate WRITE_SECRET that this endpoint never serves,
    // so leaving this fully public no longer means "public secret -> repo
    // writes" the way it used to.
    if (request.method === "GET" && url.pathname === "/secret") {
      return new Response(JSON.stringify({ secret: env.APP_SECRET || null }), {
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    if (!checkAuth(request, env)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    if (request.method === "GET" && url.pathname === "/models") {
      const res = await fetch("https://api.deepinfra.com/v1/openai/models", {
        headers: { "Authorization": `Bearer ${env.DEEPINFRA_KEY}` }
      });
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    if (request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok", key_set: !!env.DEEPINFRA_KEY }), {
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    if (request.method === "POST" && url.pathname === "/search") {
      let body;
      try { body = await request.json(); } catch { return new Response(JSON.stringify({ results: [] }), { headers: { "Content-Type": "application/json", ...CORS } }); }
      const results = await handleSearch(body.query || '', env);
      return new Response(JSON.stringify({ results, timestamp: new Date().toISOString() }), {
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

    const upstream = await fetch("https://api.deepinfra.com/v1/openai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.DEEPINFRA_KEY}`,
      },
      body: JSON.stringify(body),
    });

    // Reconstructing a fresh Response below (rather than just returning
    // `upstream` as-is) otherwise silently drops every upstream header,
    // including Retry-After on a 429 - the coding agent's retry countdown
    // (index.html) has nothing real to read without this, and falls back to
    // a guessed default no matter what DeepInfra actually sent.
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
