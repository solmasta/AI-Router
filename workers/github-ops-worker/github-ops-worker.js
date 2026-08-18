const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, X-App-Secret, X-Write-Secret, Authorization",
};

function checkAuth(request, env) {
  const provided = request.headers.get("X-App-Secret");
  return !!env.APP_SECRET && provided === env.APP_SECRET;
}

// Every op here - including read_file/list_files - needs either a valid
// per-user OAuth token or a second, separate secret on top of APP_SECRET.
// APP_SECRET is deliberately semi-public - the frontend bootstraps it from
// an unauthenticated-by-design endpoint on the openai-router-chat worker,
// so anyone who can reach that worker can obtain it. That's an acceptable
// bar for spending the chat/search API budget, but not for reading or
// writing repo contents: with ALLOWED_REPOS set to something like
// "owner/*", APP_SECRET alone would let anyone on the internet read (and
// previously, only for writes, commit to) every repo that owner's
// GITHUB_TOKEN can see, private ones included. A caller presenting a valid
// GitHub OAuth access_token clears this bar on its own - it's scoped to
// whatever that specific GitHub user can actually do, which is a stronger
// guarantee than a shared secret, and GitHub itself is the one validating
// it (an invalid/expired token 401s downstream in handleGitHubOp). Without
// one, WRITE_SECRET is still required - it's never served by any endpoint;
// it's entered once by hand in the app's Settings and stored only in the
// browser's localStorage, so holding APP_SECRET alone is no longer enough
// to reach any op here.
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

async function handleGitHubOp(body, env, oauthToken) {
  const { op, owner, repo, path, content, message, branch, title, merge_method } = body;
  // Prefer a user-supplied OAuth access_token (passed as Authorization: ****** from the frontend after GitHub OAuth) so the server-side GITHUB_TOKEN PAT
  // is no longer required for the app to work.  Fall back to GITHUB_TOKEN for
  // backwards compatibility when the frontend hasn't completed OAuth yet.
  const token = oauthToken || env.GITHUB_TOKEN;

  if (!token) return { error: "GitHub token not configured - connect via GitHub OAuth in Settings, or set GITHUB_TOKEN on the worker." };
  if (!owner || !repo) return { error: "Missing owner or repo" };

  // Restrict writes to a caller-supplied owner/repo to a fixed allowlist -
  // without this, anyone holding the shared secret (see openai-router.js's
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

      case "list_all_files": {
        // list_files only shows one directory at a time, which forces a
        // caller that doesn't already know the exact layout into a long
        // chain of list_files/read_file guesses (a real user report: the
        // coding agent hit repeated 404s trying plausible-looking paths
        // like PhotoUpload.js before finding the real PhotoUpload.jsx).
        // The Git Trees API returns the whole repo's file paths in one
        // call - recursive=1 walks every subdirectory server-side, so a
        // caller can search/filter locally instead of exploring
        // directory-by-directory.
        let treeBranch = branch;
        try {
          treeBranch = treeBranch || await getDefaultBranch(owner, repo, headers);
        } catch (e) {
          return { error: e.message };
        }
        const branchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(treeBranch)}`, { headers });
        if (!branchRes.ok) return { error: `Failed to look up branch ${treeBranch}: ${await describeError(branchRes)}` };
        const branchData = await branchRes.json();
        const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branchData.commit.sha}?recursive=1`, { headers });
        if (!treeRes.ok) return { error: `Failed to list repository tree: ${await describeError(treeRes)}` };
        const treeData = await treeRes.json();
        let allPaths = (treeData.tree || []).filter(e => e.type === "blob").map(e => e.path);
        if (path && path !== ".") {
          const prefix = path.replace(/\/$/, "") + "/";
          allPaths = allPaths.filter(p => p === path || p.startsWith(prefix));
        }
        const total = allPaths.length;
        const LIST_ALL_CAP = 500;
        const truncated = !!treeData.truncated || total > LIST_ALL_CAP;
        return { success: true, files: allPaths.slice(0, LIST_ALL_CAP), total, truncated };
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

      case "trigger_workflow": {
        const { workflow_id, ref: wfRef, inputs: wfInputs } = body;
        if (!workflow_id) return { error: "Missing workflow_id" };
        const wfRef2 = wfRef || await getDefaultBranch(owner, repo, headers);
        // Dispatch the workflow
        const dispatchRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow_id)}/dispatches`,
          { method: "POST", headers, body: JSON.stringify({ ref: wfRef2, inputs: wfInputs || {} }) }
        );
        if (!dispatchRes.ok) return { error: `Failed to dispatch workflow: ${await describeError(dispatchRes)}` };

        // GitHub's dispatch endpoint returns 204 with no body - poll for the
        // run that just appeared (the most recent one created after this dispatch).
        // Record the dispatch time first so pre-existing runs aren't matched.
        const dispatchedAt = new Date();
        let run = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise(r => setTimeout(r, 2000));
          const runsRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow_id)}/runs?branch=${encodeURIComponent(wfRef2)}&per_page=10`,
            { headers }
          );
          if (!runsRes.ok) return { error: `Workflow dispatched but could not look up run id: ${await describeError(runsRes)}` };
          const runsData = await runsRes.json();
          run = (runsData.workflow_runs || []).find(r => new Date(r.created_at) >= dispatchedAt);
          if (run) break;
        }
        if (!run) return { success: true, run_id: null, message: "Workflow dispatched - no run found yet; poll get_workflow_run shortly" };
        return { success: true, run_id: run.id, status: run.status, html_url: run.html_url };
      }

      case "get_workflow_run": {
        const { run_id } = body;
        if (!run_id) return { error: "Missing run_id" };
        const runRes = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run_id}`,
          { headers }
        );
        if (!runRes.ok) return { error: `Failed to get workflow run: ${await describeError(runRes)}` };
        const runData = await runRes.json();
        const result = {
          success: true,
          run_id: runData.id,
          status: runData.status,          // queued | in_progress | completed
          conclusion: runData.conclusion,  // success | failure | cancelled | null
          html_url: runData.html_url,
        };
        // If completed, also fetch a tail of the logs for the first failed
        // (or, if all passed, the last) job so the AI can report specifics.
        if (runData.status === "completed") {
          const jobsRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run_id}/jobs`,
            { headers }
          );
          if (jobsRes.ok) {
            const jobsData = await jobsRes.json();
            const jobs = jobsData.jobs || [];
            // Pick the first failed job, or the last job if all passed.
            const targetJob = jobs.find(j => j.conclusion === "failure") || jobs[jobs.length - 1];
            if (targetJob) {
              const logRes = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${targetJob.id}/logs`,
                { headers }
              );
              if (logRes.ok) {
                const logText = await logRes.text();
                // Return last 6000 chars - enough for most test output
                result.log_tail = logText.slice(-6000);
              }
            }
          }
        }
        return result;
      }

      case "get_workflow_logs": {
        const { run_id: logRunId } = body;
        if (!logRunId) return { error: "Missing run_id" };
        const jobsRes2 = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/runs/${logRunId}/jobs`,
          { headers }
        );
        if (!jobsRes2.ok) return { error: `Failed to fetch jobs: ${await describeError(jobsRes2)}` };
        const jobsData2 = await jobsRes2.json();
        const jobs2 = jobsData2.jobs || [];
        const logs = [];
        for (const job of jobs2) {
          const logRes2 = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${job.id}/logs`,
            { headers }
          );
          if (logRes2.ok) {
            const text = await logRes2.text();
            logs.push({ job: job.name, conclusion: job.conclusion, log: text.slice(-4000) });
          }
        }
        return { success: true, jobs: logs };
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

    // Extract a user OAuth token if the frontend sent one.
    // Authorization header format: "Bearer <token>"
    // This takes precedence over the server-side GITHUB_TOKEN PAT.
    const authHeader = request.headers.get("Authorization") || "";
    const oauthToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    // Gates every op, not just write_file/merge_branch - read_file and
    // list_files hand back repo contents, which APP_SECRET's semi-public
    // exposure (see checkWriteAuth's comment) isn't a safe enough bar for.
    // A caller-supplied OAuth token clears this on its own (see
    // checkWriteAuth's comment) - only fall back to requiring WRITE_SECRET
    // when there isn't one.
    if (!oauthToken && !checkWriteAuth(request, env)) {
      return new Response(JSON.stringify({ error: "Not authenticated - connect via GitHub OAuth in Settings, or set a write secret before reading, writing, or merging." }), {
        status: 401, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    const result = await handleGitHubOp(body, env, oauthToken);
    return new Response(JSON.stringify(result), {
      status: result.error ? 400 : 200,
      headers: { "Content-Type": "application/json", ...CORS }
    });
  },
};
