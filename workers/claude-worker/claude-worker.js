const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Secret",
};

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

    // Public endpoint: get APP_SECRET for frontend - validates origin only.
    // This is a deterrent against casual/automated abuse of the raw Worker
    // URL, not real auth: Origin/Referer are ordinary request headers that
    // any non-browser client (curl, a script) can set to whatever it likes,
    // so a determined caller can still obtain the secret directly. Exact
    // matching here only closes the suffix-bypass hole (an Origin such as
    // "https://solmasta.github.io.evil.com" used to pass the old
    // startsWith() check); it does not make this a security boundary.
    if (request.method === "GET" && url.pathname === "/secret") {
      const allowedOrigins = new Set([
        "https://solmasta.github.io",
        "http://localhost:8000",
        "http://localhost:3000",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:3000"
      ]);

      let origin = request.headers.get("Origin");
      if (!origin) {
        const referer = request.headers.get("Referer");
        try { origin = referer ? new URL(referer).origin : ""; } catch { origin = ""; }
      }

      if (!allowedOrigins.has(origin)) {
        return new Response(JSON.stringify({ error: "Origin not allowed" }), {
          status: 403, headers: { "Content-Type": "application/json", ...CORS }
        });
      }

      return new Response(JSON.stringify({ secret: env.APP_SECRET }), {
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    if (!checkAuth(request, env)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    // Live model list endpoint - proxies Anthropic's actual Models API so a
    // model pulled from the picker (e.g. deprecated/renamed) drops out here
    // too, the same way DeepInfra/OpenRouter's /models already do.
    if (request.method === "GET" && url.pathname === "/models") {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        }
      });
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    if (request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok" }), {
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

    // Convert OpenAI format to Claude format
    const claudeBody = {
      model: body.model,
      messages: [],
      stream: body.stream || false,
    };

    // Extract leading system messages - the frontend stacks several
    // separate role:"system" entries (model prompt, task instructions,
    // active project, memory, docs) at the front of the array rather than
    // sending just one, and Claude's API only accepts system content via
    // the top-level 'system' parameter, never as a message role.
    let systemPrompt = body.system;
    if (body.messages && body.messages.length > 0) {
      let splitAt = 0;
      const systemParts = [];
      while (splitAt < body.messages.length && body.messages[splitAt].role === "system") {
        systemParts.push(body.messages[splitAt].content);
        splitAt++;
      }
      if (systemParts.length > 0) {
        systemPrompt = systemParts.join("\n\n");
      }
      claudeBody.messages = body.messages.slice(splitAt);
    }

    if (systemPrompt) {
      claudeBody.system = systemPrompt;
    }

    // The frontend's message objects carry extra client-side-only fields
    // (e.g. apId, used for its own regen tracking) that Claude's API
    // rejects outright since it strictly validates message shape - strip
    // down to just what Claude actually accepts.
    claudeBody.messages = claudeBody.messages.map(m => ({ role: m.role, content: m.content }));

    // Add max_tokens - required by Claude API
    if (body.max_tokens) {
      claudeBody.max_tokens = body.max_tokens;
    } else {
      claudeBody.max_tokens = 4096;
    }

    // Add temperature if provided
    if (body.temperature !== undefined) {
      claudeBody.temperature = body.temperature;
    }

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(claudeBody),
    });

    if (body.stream) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...CORS }
      });
    }

    // For non-streaming, Claude returns a different format, so we need to convert it
    if (!body.stream) {
      const claudeResp = await upstream.json();

      // Surface upstream errors as-is instead of feeding them through the
      // success-shape conversion below, which would otherwise turn a missing
      // content array into a silent, misleadingly "successful" empty reply.
      if (!upstream.ok) {
        const message = (claudeResp.error && claudeResp.error.message) || `Claude API error (HTTP ${upstream.status})`;
        return new Response(JSON.stringify({ error: { message, type: claudeResp.error && claudeResp.error.type } }), {
          status: upstream.status,
          headers: { "Content-Type": "application/json", ...CORS }
        });
      }

      // Convert Claude response to OpenAI format for compatibility
      const openaiResp = {
        id: claudeResp.id || "claude-response",
        object: "text_completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: claudeResp.content && claudeResp.content[0] && claudeResp.content[0].text ? claudeResp.content[0].text : ""
          },
          finish_reason: claudeResp.stop_reason === "end_turn" ? "stop" : claudeResp.stop_reason || "stop"
        }],
        usage: claudeResp.usage || {}
      };

      return new Response(JSON.stringify(openaiResp), {
        status: upstream.status,
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  },
};
