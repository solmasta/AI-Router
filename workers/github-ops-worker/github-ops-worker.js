const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Secret, X-Write-Secret, Authorization",
};

function checkAuth(request, env) {
  const provided = request.headers.get("X-App-Secret");
  return !!env.APP_SECRET && provided === env.APP_SECRET;
}

// write_file/merge_branch need a second, separate secret on top of
// APP_SECRET. APP_SECRET is deliberately semi-public - the frontend
// bootstraps it from an unauthenticated-by-design endpoint on the
// openai-router-chat worker, so anyone who can reach that worker can obtain
// it. That's an acceptable bar for read-only ops and for spending the
// chat/search API budget, but not for committing to or merging repos -
// WRITE_SECRET is never served by any endpoint; it's entered once by hand
// in the app's Settings and stored only in the browser's localStorage, so
// holding APP_SECRET alone is no longer enough to reach write_file or
// merge_branch.
function checkWriteAuth(request, env) {
  const provided = request.headers.get("X-Write-Secret");
  return !!env.WRITE_SECRET && provided === env.WRITE_SECRET;
}

// GitHub's error responses are normally {"message": "..."} JSON, but some
// failure modes (edge/proxy rejections, HTML error pages) return plain text
// instead - falling back to raw text keeps this diagnostic instead of
// silently collapsing to just a status code whenever the body isn't JSON.
async function describeError(res) {
  const text = await res.text();
  let message = "";
  try { message = JSON.parse(text).message || ""; } catch {}
  if (!message && text) message = text.slice(0, 200);
  return message ? `HTTP ${res.status} - ${message}` : `HTTP ${res.status}`;
}

// atob/btoa operate on Latin-1 bytes, not UTF-8 text - a plain atob()/btoa()
// mangles (or throws on) any file content with multi-byte UTF-8 characters
// (emoji, non-English text). Route through TextEncoder/TextDecoder so the
// byte<->string boundary is explicit UTF-8 either way.
function base64ToUtf8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function getDefaultBranch(owner, repo, headers) {
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (!repoRes.ok) throw new Error(`Failed to look up repo default branch: ${await describeError(repoRes)}`);
  return (await repoRes.json()).default_branch;
}

// Every write lands on an explicit branch, never straight onto the repo's
// default branch just because a caller omitted one - creates the branch
// from the repo's default branch if it doesn't already exist yet, so a
// fresh working-branch name just works with no separate "create branch"
// step needed from the client. knownDefaultBranch lets a caller that
// already looked it up (write_file's own guard below) skip a second,
// identical lookup.
async function ensureBranchExists(owner, repo, branch, headers, knownDefaultBranch) {
  const refUrl = `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`;
  const refRes = await fetch(refUrl, { headers });
  if (refRes.ok) return;

  const defaultBranch = knownDefaultBranch || await getDefaultBranch(owner, repo, headers);

  const baseRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`, { headers });
  if (!baseRefRes.ok) throw new Error(`Failed to read base branch ${defaultBranch}: ${await describeError(baseRefRes)}`);
  const baseSha = (await baseRefRes.json()).object.sha;

  const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });
  if (!createRes.ok) throw new Error(`Failed to create branch ${branch}: ${await describeError(createRes)}`);
}

async function handleGitHubOp(body, env) {
  const { op, owner, repo, path, content, message, branch, title, merge_method } = body;
  const token = env.GITHUB_TOKEN;

  if (!token) return { error: "GitHub token not configured" };
  if (!owner || !repo) return { error: "Missing owner or repo" };

  // Restrict writes to a caller-supplied owner/repo to a fixed allowlist -
  // without this, anyone holding the shared secret (see claude-worker's
  // /secret comment) could point this worker at any repo the GITHUB_TOKEN
  // can reach, not just the one this project intends to operate on.
  // Supported ALLOWED_REPOS entries:
  // - owner/repo (exact)
  // - owner/* (all repos for that owner)
  // - * (all repos reachable by the token)
  const allowedRepos = (env.ALLOWED_REPOS || "")
    .split(",").map(r => r.trim().toLowerCase()).filter(Boolean);
  const requestedOwner = owner.toLowerCase();
  const requestedRepo = repo.toLowerCase();
  const requested = `${requestedOwner}/${requestedRepo}`;
  const allowed = allowedRepos.some(entry => {
    if (entry === "*") return true;
    if (entry.endsWith("/*")) return requestedOwner === entry.slice(0, -2);
    return entry === requested;
  });
  if (allowedRepos.length === 0 || !allowed) {
    return { error: `Repo ${owner}/${repo} is not in the allowlist` };
  }

  const headers = {
    "Authorization": `token ${token}`,
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    // GitHub's API rejects any request with no User-Agent header (403,
    // "Request forbidden by administrative rules") - browsers and most
    // HTTP clients set one automatically, but Cloudflare Workers' fetch()
    // does not, so it has to be set explicitly here.
    "User-Agent": "openai-router-github-ops-worker",
  };

  try {
    switch (op) {
      case "read_file":
        if (!path) return { error: "Missing path" };
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return { error: `Failed to read ${path}: ${await describeError(res)}`, status: res.status };
        const data = await res.json();
        const fileContent = base64ToUtf8(data.content);
        return { success: true, content: fileContent, sha: data.sha };

      case "write_file":
        if (!path || content === undefined) return { error: "Missing path or content" };

        // Same non-default-branch fallback as the client's own confirm
        // dialog, kept here too as defense in depth - this worker must
        // never land a write on the repo's real default branch just
        // because a caller (this client or any other) omitted a branch or
        // forgot to guard for it. A regex on the literal names
        // "main"/"master" only protects repos that happen to use one of
        // those - a connected repo whose default branch is named anything
        // else (develop, trunk, ...) had no protection here at all. Look
        // up the actual default branch and check the requested branch
        // against that, not just the two common names.
        let repoDefaultBranch;
        try {
          repoDefaultBranch = await getDefaultBranch(owner, repo, headers);
        } catch (e) {
          return { error: e.message };
        }
        const requestedIsDefault = branch && (branch === repoDefaultBranch || /^(main|master)$/i.test(branch));
        const targetBranch = (branch && !requestedIsDefault) ? branch : "ai-changes";
        try {
          await ensureBranchExists(owner, repo, targetBranch, headers, repoDefaultBranch);
        } catch (e) {
          return { error: e.message };
        }

        const writeUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

        // First, get the current SHA if the file already exists on this branch
        let sha = null;
        const checkRes = await fetch(`${writeUrl}?ref=${encodeURIComponent(targetBranch)}`, { headers });
        if (checkRes.ok) {
          const existing = await checkRes.json();
          sha = existing.sha;
        }

        const payload = {
          message: message || `Update ${path}`,
          content: utf8ToBase64(content),
          branch: targetBranch,
        };
        if (sha) payload.sha = sha;

        const writeRes = await fetch(writeUrl, {
          method: "PUT",
          headers,
          body: JSON.stringify(payload),
        });
        if (!writeRes.ok) return { error: `Failed to write ${path}: ${await describeError(writeRes)}`, status: writeRes.status };
        const writeData = await writeRes.json();
        return { success: true, commit: writeData.commit.sha, branch: targetBranch };

      case "list_files": {
        // No path (or "."/"") means the repo root - GitHub's Contents API
        // lists it at /repos/{owner}/{repo}/contents with no trailing
        // path segment, so build the URL without one instead of requiring
        // a path the caller may have no reason to know.
        const listSubpath = (path && path !== ".") ? path : "";
        const listUrl = `https://api.github.com/repos/${owner}/${repo}/contents${listSubpath ? "/" + listSubpath : ""}`;
        const listRes = await fetch(listUrl, { headers });
        if (!listRes.ok) return { error: `Failed to list ${listSubpath || "(root)"}: ${await describeError(listRes)}`, status: listRes.status };
        const listData = await listRes.json();
        const files = Array.isArray(listData)
          ? listData.map(f => ({ name: f.name, type: f.type, path: f.path }))
          : { error: "Not a directory" };
        return { success: true, files };
      }

      case "merge_branch": {
        if (!branch) return { error: "Missing branch" };

        const branchRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, { headers });
        if (!branchRefRes.ok) return { error: `Branch '${branch}' does not exist: ${await describeError(branchRefRes)}` };

        const mergeRepoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
        if (!mergeRepoRes.ok) return { error: `Failed to look up repo default branch: ${await describeError(mergeRepoRes)}` };
        const defaultBranch = (await mergeRepoRes.json()).default_branch;
        if (branch === defaultBranch) return { error: `'${branch}' is already the default branch` };

        // Reuse an existing open PR for this branch instead of creating a
        // duplicate every time the model is asked to merge the same branch
        // more than once.
        const searchUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(owner + ":" + branch)}&base=${encodeURIComponent(defaultBranch)}&state=open`;
        const searchRes = await fetch(searchUrl, { headers });
        if (!searchRes.ok) return { error: `Failed to look up existing pull requests: ${await describeError(searchRes)}` };
        const existingPRs = await searchRes.json();

        let pr = Array.isArray(existingPRs) && existingPRs.length ? existingPRs[0] : null;
        if (!pr) {
          const createPrRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              title: title || `Merge ${branch} into ${defaultBranch}`,
              head: branch,
              base: defaultBranch,
              body: message || "",
            }),
          });
          if (!createPrRes.ok) return { error: `Failed to create pull request: ${await describeError(createPrRes)}` };
          pr = await createPrRes.json();
        }

        const mergeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}/merge`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            merge_method: merge_method || "merge",
            commit_title: title || undefined,
            commit_message: message || undefined,
          }),
        });
        if (!mergeRes.ok) return { error: `Failed to merge PR #${pr.number}: ${await describeError(mergeRes)}` };
        const mergeData = await mergeRes.json();
        return { success: true, prNumber: pr.number, prUrl: pr.html_url, merged: true, sha: mergeData.sha };
      }

      case "create_commit":
        // Not implemented: a real commit needs a tree + commit object built
        // from the caller's changes, which this op never did - it used to
        // return {success:true} without writing anything, which told
        // callers a commit had happened when it hadn't. Fail loudly instead;
        // use write_file, which does perform a real commit per file.
        return { error: "create_commit is not implemented - use write_file instead" };

      default:
        return { error: "Unknown operation" };
    }
  } catch (e) {
    return { error: e.message };
  }
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

    if ((body.op === "write_file" || body.op === "merge_branch") && !checkWriteAuth(request, env)) {
      return new Response(JSON.stringify({ error: "Write secret missing or incorrect - set it under Settings > GitHub repository before writing or merging." }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    const result = await handleGitHubOp(body, env);
    return new Response(JSON.stringify(result), {
      status: result.error ? 400 : 200,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  },
};
