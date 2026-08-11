/* Regression smoke test for index.html - run before every commit that
   touches app logic. Requires a local static server on :8899 serving the
   repo root (e.g. `npx http-server . -p 8899`) and Playwright with a
   Chromium build available. Exits non-zero on any failed assertion.

   Covers the flows that have actually broken in this app before:
   - basic send + Overseer status bar
   - a send error keeping the message in history (Regen stays usable,
     tabs/storage don't silently lose the message)
   - a send that fails while the tab was hidden auto-retries once on its
     own the moment the tab becomes visible again, instead of leaving the
     user to notice the error and tap Regen themselves
   - a next-step suggestion prompt always appears after a send ends, no
     matter how - success, error, or an aborted stream - and regardless of
     the separate brainstorming-mode toggle
   - vision model auto-switch on image attach, and auto-restore after
   - memory add/delete
   - tab creation, per-tab isolation, and switching back
   - closing a background tab only removes that one tab (never more) and
     confirms with a toast stating how many remain, including an explicit
     "1 tab left" when the tab bar itself disappears; closing the active
     tab mid-send is blocked with a clear toast instead of doing nothing
   - profile creation and data isolation
   - Overseer chat: long-press opens it, sends reach the model with the
     Overseer's own dedicated system prompt (not the main chat one)
   - Overseer chat can also drive repo tool_calls (e.g. write_file) directly,
     through the same TOOL_MODELS gate and approval dialogs as the main
     chat, with its own tool-execution notices in the Overseer's chat log
   - the Overseer chat's own code-signal keywords are word-boundary matched
     (not substring - "react" inside "overreacted" doesn't count) and
     require more than one incidental hit before granting repo tools for
     a message that isn't actually about the connected repo
   - all repo/coding work (read_file/write_file/list_files/merge_branch)
     runs on one fixed dedicated coding agent model, independent of
     whatever the main chat is using - a repo-flavored message no longer
     needs to switch the main chat model at all
   - the coding agent runs one step (tool round) at a time and waits for
     an explicit Continue click before starting the next one - it never
     auto-chains multiple rounds in one burst
   - a coding-agent step abandoned without tapping Continue still leaves
     its findings in real conversation history, so a later unrelated
     message doesn't have the main chat model contradicting what the
     coding agent already found
   - auto-continue pauses (with an explanatory note, falling back to a
     manual Continue button) instead of repeating an identical failing
     tool call round after round all the way to the auto-round cap
   - each reply's model-name tag is stored with that specific message, not
     repainted with whatever model is active now - a canned guard message
     (no model involved) shows no tag at all, and switching models plus
     reloading doesn't relabel earlier replies as if the new model had
     answered them too
   - repo/coding work stays conversational in the transcript instead of
     dumping raw tool-status chatter into the main chat
   - a separate Terminal panel logs every actual repo read/write/list/run
     (the real tool call, its outcome, and written file content) as it
     happens, independent of the conversational summary in chat - always
     visible whenever it's relevant (a Coding tab, or activity already
     happened this session), no button/modal needed to see it
   - a branded splash screen shows on load and hides itself automatically
     once the app finishes booting, with no tap required
   - write_file tool never defaults to main/master; the approved branch is
     what actually reaches the GitHub ops worker
   - merge_branch tool requires its own dedicated approval dialog before
     anything happens, and the approved branch/op reach the GitHub ops
     worker correctly
   - list_files no longer requires a path - its schema allows omitting it
     to mean the repo root
   - Manual import's "Fetch from Drive" guards against an unconnected/
     expired Drive session instead of silently failing
   - "Open" deep-links straight to the Drive folder by id, falling back to
     a name search only when no id is known yet
   - App-control tools (create_project/remember/switch_model) execute
     immediately on a model tool_call, with real observable side effects
   - hardcoded app-structure knowledge only appears in the coding agent's
     own system prompt when GitHub is connected to this actual repo, not
     some other repo - checked under both the current repo name and the
     pre-rename one (openai-router -> AI-Router), so a connection saved
     before the rename doesn't silently lose it
   - the main chat model is never told it has repository tools - that
     system-prompt text lives only in the dedicated coding agent's prompt
   - repo tools are gated on actual repo/GitHub signal, not generic coding
     keywords - a message about an unrelated new app doesn't route to the
     coding agent just for sounding code-flavored, in both the main chat
     and the Overseer strategy chat
   - a model that comes back with a genuinely empty completion (e.g. it
     burned its turn on tool_calls and had nothing left once locked to
     tool_choice:"none") triggers exactly one automatic fallback retry on a
     different tool-capable model instead of just showing "(empty response)"
   - an unambiguous coding message always auto-routes to the same one
     pinned coding model instead of the general auto-router's usual
     shuffle-for-variety behavior rotating it between several
     similarly-scored coding models message to message
   - GitHub Settings: a one-tap Clear button disconnects the active repo
     without opening the Connect modal, previously-connected repos are
     offered as quick "recent" picks when reconnecting, and a repo saved
     without OAuth/write-secret auth gets an auth-specific Coding-tab guard
   - once OAuth is connected, "Browse your repos" lists the account's
     actual GitHub repos (fetched directly from GitHub's API with the
     OAuth token - only offered under OAuth, since the legacy write-secret
     path never hands the browser a token to call it with), supports a
     client-side filter, and picking one connects it immediately (no
     separate Save tap needed - unlike typing owner/name by hand, picking
     from an actual list already is the confirmation)
   - switching the connected repo mid-conversation in a Coding tab tells
     the model plainly that its own earlier claims in that thread describe
     the old repo now, and shows the user a visible notice too - instead
     of the model confidently repeating stale repo identity/structure
     claims from before the switch
   - a fresh deploy that only changes index.html (the common case, which
     never touches sw.js's own bytes) still applies itself automatically -
     no tap required - and defers cleanly instead of reloading mid-request
     if a send or coding-agent round is still in flight
   - the Overseer button visibly pulses while the auto-router is scoring
     which model fits the message just sent, and clears once it decides
   - every model, tool-capable or not, is explicitly told not to invent
     or call a tool/function that was never actually defined for the
     conversation (e.g. a fictional weather lookup)
   - the speak-replies-aloud toggle is off by default, actually calls
     speechSynthesis.speak once turned on, and stops again once turned off
   - voice-conversation mode: turning it on starts listening immediately,
     a finished utterance auto-sends with no Send tap, the reply is
     spoken even with the separate speak toggle off, and speaking's own
     end restarts listening for the next turn
   - voice-conversation mode's own silence timer auto-sends a finished
     utterance even if the browser never fires onend on its own - a real
     user report that continuous=false's "stops on a pause" behavior
     isn't reliable enough across real browsers/OSes to depend on alone
   - picking a voice persists it and is actually set on the utterance
     when speaking; Overseer personality text persists and shows up in
     the system prompt sent to the model
   - the compose bar's icon row wraps instead of pushing the Send button
     off-screen at a narrow phone viewport width
   - an image message never routes to the dedicated coding agent even
     with repo-flavored caption text - it still reaches a vision model
   - vision auto-restore's one-message grace period is per-tab - a new
     tab doesn't inherit a leftover grace-period count from a previous
     tab's image interaction
   - a settled, non-project conversation (8 messages) gets offered a
     one-time suggestion to save itself as a reusable Work Project, and
     accepting actually creates one from a model-generated name/summary
   - an explicit topic-change phrase in a message prompts before starting
     a new tab, rather than silently switching or staying put
   - a coding-agent reply that writes out a fake tool call as plain text
     (tool_code, print(read_file(...)), <tool_call>) instead of a real
     tool_calls entry triggers exactly one automatic retry with a
     corrective nudge, and never renders the pseudo-code as the final
     answer; if the retry also comes back fake, it's shown as-is rather
     than retrying forever (no fallback model exists for this agent)
   - a coding-agent reply that falsely claims it has no tool access (e.g.
     "I don't actually have the ability to...") triggers exactly one
     automatic retry with a corrective nudge, instead of showing the
     user a confident denial that contradicts real tool calls already
     visible earlier in the same conversation - reaching this code path
     at all already proves the tools are live, so the claim is always
     wrong, never legitimate
   - 3+ rounds of tapping the auto-generated "Continue with the next
     step: X" prompt in a row keep routing to the dedicated coding agent
     instead of falling back to the plain chat model once those generic
     continuation messages fill up the recent-turns lookback window
   - asking the coding agent to work "on your own" / "without doing one
     by one" auto-chains its tool-call rounds instead of requiring a
     manual Continue tap after every single file, offering a Stop
     control instead and still stopping once it gives a final answer
   - a model-capability error (e.g. "tool calling is not supported for
     model: X") also triggers the automatic fallback-to-a-different-model
     retry, instead of rendering the provider's raw error text as the
     final answer - narrow on purpose, a plain network/timeout error
     still shows as before instead of silently switching models on a
     transient hiccup
   - the main chat's single point of contact is "the Overseer" (the
     primary reply label), with the model that actually answered shown
     as a secondary indicator rather than the primary identity
   - the Overseer's quality/stuck tracking reacts to what the model's
     reply actually says (refusing, unsure, no access), not just its
     character length - a long, fluent refusal no longer scores
     "excellent" purely for being wordy
   - the persistent Overseer bar never claims to be "working on the
     next step" (amber dot, no visible reason why) unless there's an
     actual next step to continue - right after the first message, with
     nothing pending, it reads as a plain status instead of implying
     work is silently in progress
   - the persistent Overseer bar's next-step action is labeled "Use next
     step", fills the continuation prompt, and clears immediately so the
     same step is not offered over and over
   - the main chat (and the Overseer's own side-chat) also gets one
     automatic retry when the model writes fake tool-call syntax as
     plain text (e.g. an invented <function=some_tool>{...}</function>)
     instead of an actual answer - the same fix already covering the
     dedicated coding agent, now applied to the ordinary chat path too
   - a dedicated Coding tab routes every message straight to the coding
     agent regardless of keyword content, showing a clear guard message
     if no repo is connected yet instead of silently using the plain
     chat model; the Coding badge shows while it's active and clears
     when switching to a different tab
   - a coding-agent round that comes back genuinely empty (a real risk
     now that a Coding tab sends it plain conversational messages too)
     gets one automatic retry with a corrective nudge, instead of
     rendering "(no response)" as the final answer
   - the Coding indicator lives in the systemToggle status bar (with the
     active project/prompt name) rather than the header's icon row, so
     the version number stays fully visible instead of getting squeezed
   - the dedicated coding agent's own console is labeled "Overseer" too
     (with its fixed model as a secondary indicator), consistent with
     the main chat's relabeling instead of a leftover "Assistant"
   - an OAuth-only GitHub connection with an expired token can refresh and
     keep repo/coding access alive without also requiring the legacy write
     secret path
   - a transient HTTP error from the coding agent (429/500/502/503, and
     Cloudflare's own 504/522/523/524 gateway-timeout family) offers a
     Retry button that re-enters the same session, instead of a dead end
   - the GitHub OAuth callback's redirect fallback (#gh_oauth=... or
     #gh_oauth_error=... in the URL hash, used when window.opener isn't
     available - the common case on mobile/PWA) finishes or reports the
     connection on load and clears the hash, instead of leaving the app
     stuck "not connected" after the popup already said "Connected!"
     that kills the whole coding-agent session over what's often just a
     slow response

   Run: NODE_PATH=/opt/node22/lib/node_modules node tests/regression.js
*/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_URL = process.env.REGRESSION_BASE_URL || 'http://localhost:8899/index.html';
const CHROMIUM_PATH = process.env.REGRESSION_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  OK  ${label}`);
  } else {
    console.log(`FAIL  ${label}`);
    failures++;
  }
}

(async () => {
  const pngBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const imgPath = path.join(os.tmpdir(), 'regression_test.png');
  fs.writeFileSync(imgPath, pngBuf);

  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true });
  // Service workers now actually register successfully (sw.js registration
  // used to be a hardcoded absolute path that always 404s once the repo's
  // been renamed - now relative, so it correctly activates here too). Once
  // active, a service worker's own fetch handler intercepts same-origin
  // requests in its own context, which page.route() can't see through -
  // that silently broke this suite's index.html-mocking tests (checking
  // the "a fresh deploy applies itself automatically" flow) by letting the
  // real file through underneath the mock. Blocked here to keep tests
  // deterministic and focused on app logic, not service-worker semantics.
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  function isNoise(e) {
    return e.includes('sw.js') || e.includes('ERR_TUNNEL') || e.includes('ERR_CONNECTION_RESET') || e.includes('404');
  }
  function realErrors() { return errors.filter(e => !isNoise(e)); }

  async function dismissConfirmIfAny() {
    const v = await page.evaluate(() => !document.getElementById('agentConfirmModal').classList.contains('hidden'));
    if (v) { await page.click('#agentConfirmSendCurrent'); await page.waitForTimeout(300); }
    return v;
  }
  async function waitForSendDone() {
    // Check for the model-switch confirm modal on every iteration, not just
    // once right after the click - switchToBestModel's scoring can finish
    // later than a single fixed check under slower conditions, and a missed
    // modal sits open blocking every later test in the file, not just this one.
    // 25 * 300ms (7.5s) assumed the sandbox's proxy rejects the (expected
    // to fail) worker requests almost instantly. That rejection latency
    // varies and was creeping past 7.5s, so this returned early with the
    // send still genuinely in flight - every assertion checking "did it
    // finish" then read stale mid-request state and failed for a reason
    // that had nothing to do with app correctness. A dismissed switch-
    // model confirm still has to wait out the same slow rejection
    // afterward, compounding the delay - 150 * 300ms = 45s gives real
    // slow-rejection cases room to actually finish either way.
    for (let i = 0; i < 150; i++) {
      await dismissConfirmIfAny();
      const t = await page.textContent('#sendBtn');
      if (t.indexOf('Send') >= 0) return;
      await page.waitForTimeout(300);
    }
  }
  async function sendMsg(text) {
    await page.fill('#prompt', text);
    await page.click('#sendBtn');
    await page.waitForTimeout(600);
    await dismissConfirmIfAny();
    await waitForSendDone();
  }
  // Waits for the actual attach-list count to reach n instead of trusting a
  // fixed delay after setInputFiles - compressImg()'s async decode pipeline
  // competes with whatever else the page is doing (now more, per message,
  // since app-control tools add an extra request), so a flat timeout can
  // read attachedFiles as still-empty and send a message with no image at
  // all, which then falsely looks like the vision-switch itself failed.
  async function waitForAttachCount(n) {
    for (let i = 0; i < 20; i++) {
      const c = await page.evaluate(() => document.querySelectorAll('#attachItems .ai').length);
      if (c >= n) return;
      await page.waitForTimeout(150);
    }
  }

  // Headless Chromium exposes a real webkitSpeechRecognition constructor,
  // but calling .start() on it with no actual microphone/permission in
  // this sandbox can't be driven deterministically - it never fires
  // onresult with real transcript data. Replace it with a fully
  // controllable fake before the app's own init IIFE runs (it reads
  // window.SpeechRecognition once at load), so voice-conversation mode's
  // listen -> send -> speak -> listen loop can be exercised precisely.
  await page.addInitScript(() => {
    window.__recognitionStartCount = 0;
    function FakeSpeechRecognition() {
      this.onresult = null; this.onend = null; this.onerror = null;
      window.__fakeRecognition = this;
    }
    FakeSpeechRecognition.prototype.start = function () { window.__recognitionStartCount++; };
    FakeSpeechRecognition.prototype.stop = function () { if (this.onend) this.onend(); };
    window.SpeechRecognition = FakeSpeechRecognition;
    window.webkitSpeechRecognition = FakeSpeechRecognition;
  });

  // 'load' waits for every subresource to settle, including the external
  // Google/Workers scripts this sandbox's proxy is set up to reject - how
  // long that rejection takes varies, and it was creeping close enough to
  // the timeout to fail outright at random. domcontentloaded doesn't need
  // those external loads to resolve at all, and the app is interactive
  // well before they would anyway.
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);

  console.log('\n-- basic send + Overseer bar --');
  await sendMsg('hi there, quick test');
  const barText = await page.evaluate(() => {
    const el = document.getElementById('overseerBarText');
    return el ? el.textContent : null;
  });
  assert(!!barText && barText.length > 0, 'Overseer bar populated after first message');
  // Right after the very first message, no step has been marked complete
  // yet (currentStep is still 0) and there's nothing pending - a real user
  // report found the bar saying "Working on X" with an amber dot and no
  // Continue button in exactly this state, reading like something was
  // actively in progress when the app was fully idle.
  const barStateAfterFirstMsg = await page.evaluate(() => ({
    text: document.getElementById('overseerBarText').textContent,
    continueHidden: document.getElementById('overseerBarContinueBtn').classList.contains('hidden'),
  }));
  assert(barStateAfterFirstMsg.text.indexOf('Working on the next step') === -1, `the bar doesn't claim to be "working on the next step" when no step has actually advanced and there's nothing to continue (got "${barStateAfterFirstMsg.text}")`);
  assert(barStateAfterFirstMsg.continueHidden, 'the Continue control stays hidden when there is no real next step, matching the bar text');

  console.log('\n-- Overseer next-step bar uses a distinct label and clears after one use --');
  let progressReplyCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === true) {
        progressReplyCount++;
        const longReply = 'regtest progress reply ' + progressReplyCount + ' with enough detail to keep the Overseer from marking the conversation as stuck while step progress advances normally through the pending next-step state.';
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `data: {"choices":[{"delta":{"content":${JSON.stringify('')}}}]}\n\ndata: {"choices":[{"delta":{"content":${JSON.stringify(longReply)}}}]}\n\ndata: [DONE]\n\n`,
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('another quick test');
  await sendMsg('one more quick test');
  const nextStepBarState = await page.evaluate(() => ({
    text: document.getElementById('overseerBarText').textContent,
    label: document.getElementById('overseerBarContinueBtn').textContent,
    hidden: document.getElementById('overseerBarContinueBtn').classList.contains('hidden'),
  }));
  assert(!nextStepBarState.hidden, 'the next-step bar action appears once a real next step is pending');
  assert(nextStepBarState.text.indexOf('Next step ready') >= 0, `the bar reads as a ready next step instead of pretending work is already in flight (got "${nextStepBarState.text}")`);
  assert(nextStepBarState.label.indexOf('Use next step') >= 0, `the persistent bar action uses a distinct label instead of another generic Continue (got "${nextStepBarState.label}")`);
  await page.click('#overseerBarContinueBtn');
  const nextStepAfterUse = await page.evaluate(() => ({
    prompt: document.getElementById('prompt').value,
    hidden: document.getElementById('overseerBarContinueBtn').classList.contains('hidden'),
  }));
  await page.unroute('**/*');
  assert(nextStepAfterUse.prompt.indexOf('Continue with the next step: ') === 0, `using the next-step bar action fills the expected continuation prompt (got "${nextStepAfterUse.prompt}")`);
  assert(nextStepAfterUse.hidden, 'using the next-step bar action clears it so the same step is not offered repeatedly');

  console.log('\n-- Overseer suggestion buttons (inline onclick="insertPrompt(...)") actually work --');
  // displayGeneratedPrompts/displayBrainstormingSuggestions build raw HTML
  // strings with onclick="insertPrompt(...)" - inline handlers run in
  // global scope, so this only works if insertPrompt is reachable as
  // window.insertPrompt, not just a function local to the app's IIFE.
  // Build a button with the exact same inline-onclick shape those
  // functions produce, rather than waiting on live Overseer timers.
  await page.evaluate(() => {
    var btn = document.createElement('button');
    btn.id = 'regtestInsertPromptBtn';
    btn.setAttribute('onclick', "insertPrompt('regtest inserted suggestion')");
    document.body.appendChild(btn);
  });
  await page.click('#regtestInsertPromptBtn');
  const insertedPromptValue = await page.inputValue('#prompt');
  assert(insertedPromptValue === 'regtest inserted suggestion', 'tapping a suggestion button (inline onclick="insertPrompt(...)") fills the compose box');
  await page.evaluate(() => {
    document.getElementById('regtestInsertPromptBtn').remove();
    document.getElementById('prompt').value = '';
  });

  console.log('\n-- project detail\'s Edit button closes the detail modal underneath it --');
  // wprojEditor is earlier in the DOM than wprojDetail, and both share the
  // same z-index, so if wprojDetail is left open when the editor opens on
  // top of it, wprojDetail (later in DOM) paints over the editor instead -
  // the editor is technically open but invisible, sitting behind the
  // project page the user was already on.
  await page.click('#wprojBtn'); await page.waitForTimeout(150);
  await page.click('#newWprojBtn'); await page.waitForTimeout(150);
  await page.fill('#wprojNameInput', 'Regtest Edit Project');
  await page.fill('#wprojInstrInput', 'regtest instructions');
  await page.click('#saveWprojBtn'); await page.waitForTimeout(150);
  await page.click('#wprojBtn'); await page.waitForTimeout(150);
  await page.click('.pjc'); await page.waitForTimeout(150);
  await page.click('#editWprojBtn'); await page.waitForTimeout(150);
  const detailHiddenAfterEdit = await page.evaluate(() => document.getElementById('wprojDetail').classList.contains('hidden'));
  const editorVisibleAfterEdit = await page.evaluate(() => !document.getElementById('wprojEditor').classList.contains('hidden'));
  assert(detailHiddenAfterEdit, 'project detail modal closes when Edit is tapped (does not stack over the editor)');
  assert(editorVisibleAfterEdit, 'project editor is actually visible after tapping Edit');
  await page.click('#closeWprojEditor'); await page.waitForTimeout(150);

  console.log('\n-- send error keeps message usable (Regen + tab sync) --');
  // The sandboxed network always fails here (no egress to the worker URLs),
  // which exercises the same catch-block path a real timeout/rate-limit would.
  const chatHasMsg = await page.evaluate(() => document.getElementById('chat').textContent.indexOf('quick test') >= 0);
  assert(chatHasMsg, 'sent message still visible in chat after failed request');
  const regenCount = await page.locator('button:has-text("Regen")').count();
  assert(regenCount >= 1, 'Regen button present after a send error');
  const tabsRaw = await page.evaluate(() => localStorage.getItem('ai_tabs'));
  const tabsHasMsg = !!tabsRaw && tabsRaw.indexOf('quick test') >= 0;
  assert(tabsHasMsg, 'tab storage still contains the message after a send error (not silently dropped)');

  console.log('\n-- follow-up requests strip client-only message metadata before reaching the model --');
  let lastFollowupBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      try {
        const parsed = JSON.parse(req.postData());
        if (parsed.messages) lastFollowupBody = parsed;
      } catch (e) {}
    }
    await route.continue();
  });
  await sendMsg('follow up and keep going');
  for (let i = 0; i < 60 && lastFollowupBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const previousUserTurn = ((lastFollowupBody && lastFollowupBody.messages) || []).find((m) => m.role === 'user' && m.content === 'hi there, quick test');
  assert(!!previousUserTurn, 'the follow-up request still includes the earlier user turn in conversation history');
  assert(previousUserTurn && !Object.prototype.hasOwnProperty.call(previousUserTurn, 'apId'), 'the earlier user turn sent to the model no longer includes client-only apId metadata');

  console.log('\n-- a send that fails while the tab is hidden auto-retries once the tab is visible again --');
  // Mobile browsers throttle/drop network on a backgrounded PWA, so a send
  // dying mid-flight while the user is away is expected - the fix isn't
  // preventing that (not possible from JS), it's not making the user notice
  // the error and tap Regen themselves once they come back. The sandbox's
  // real rejection latency varies (sometimes near-instant, sometimes not -
  // see waitForSendDone's comment above), so racing a live request to catch
  // it still "in flight" is flaky. Instead hold the first matching POST open
  // with route (never calling continue/abort until the test says so), so
  // "hidden" is guaranteed to fire while sending is still genuinely true.
  let hiddenRetryPostCount = 0;
  let releaseFirstRequest;
  const firstRequestHeld = new Promise((resolve) => { releaseFirstRequest = resolve; });
  await page.route('**/*', async (route) => {
    const req = route.request();
    let isChatReq = false;
    if (req.method() === 'POST' && req.postData()) {
      try { isChatReq = !!JSON.parse(req.postData()).messages; } catch (e) {}
    }
    if (isChatReq) {
      hiddenRetryPostCount++;
      if (hiddenRetryPostCount === 1) await firstRequestHeld;
    }
    await route.abort();
  });
  await page.fill('#prompt', 'regtest hidden send');
  await page.click('#sendBtn');
  // Wait for the held request to actually land - at that point sending is
  // definitely true and won't flip back until releaseFirstRequest() lets
  // the route fail, so there's no race left simulating "hidden" next.
  for (let i = 0; i < 40 && hiddenRetryPostCount < 1; i++) await page.waitForTimeout(50);
  assert(hiddenRetryPostCount === 1, 'test setup: the first send is held in flight before simulating hidden');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  releaseFirstRequest();
  await waitForSendDone();
  const postCountAfterHiddenFailure = hiddenRetryPostCount;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // regenLast()/doSendRequest never set the `sending` flag the way send()
  // does (only send() itself does), so waitForSendDone's sendBtn-label poll
  // can't detect a regen in flight - it returns instantly since the label
  // never left "Send" for a fire-and-forget regenLast() call. Poll the
  // request counter itself instead.
  for (let i = 0; i < 40 && hiddenRetryPostCount <= postCountAfterHiddenFailure; i++) await page.waitForTimeout(50);
  await page.unroute('**/*');
  assert(hiddenRetryPostCount > postCountAfterHiddenFailure, 'coming back to the foreground after a hidden-tab send failure automatically retries once, with no tap needed');

  console.log('\n-- a next-step prompt always appears, even after a send error, even with brainstorming mode off --');
  // Used to only appear after a clean successful reply, gated behind the
  // brainstormMode toggle - an error, an empty completion, or the toggle
  // simply being off left the conversation just sitting there with no cue
  // for what to do next. Now unconditional: the previous message already
  // failed (no sandbox egress), which is exactly the case this covers.
  const nextStepPromptAfterError = await page.evaluate(() => !!document.getElementById('overseerPrompts'));
  assert(nextStepPromptAfterError, 'a next-step suggestion prompt appears even after a send error, not just after a successful reply');
  await page.evaluate(() => document.getElementById('overseerPrompts').remove());
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#brainstormToggleBtn'); await page.waitForTimeout(150);
  const brainstormOffLabel = await page.textContent('#brainstormToggleBtn');
  assert(brainstormOffLabel === 'OFF', `test setup: brainstorming mode is now off (got "${brainstormOffLabel}")`);
  await page.click('#closeSettingsModal'); await page.waitForTimeout(150);
  await sendMsg('another message that will also fail to send');
  const nextStepPromptWithBrainstormOff = await page.evaluate(() => !!document.getElementById('overseerPrompts'));
  assert(nextStepPromptWithBrainstormOff, 'the next-step prompt still appears with brainstorming mode off - only the separate exploratory idea grid is gated on that setting');
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#brainstormToggleBtn'); await page.waitForTimeout(150);
  await page.click('#closeSettingsModal'); await page.waitForTimeout(150);

  console.log('\n-- vision model auto-switch + auto-restore --');
  // "here's a photo" -> "what's wrong with it?" is an extremely common
  // pattern - the immediate next message has no NEW attachment but still
  // needs the image from chat history, so restoring on the very first
  // image-less follow-up sent that question to a model that can't read
  // the image at all. Only the SECOND consecutive image-less message
  // should trigger the restore.
  const modelBefore = await page.textContent('#modelBtnLabel');
  const fileInput = await page.$('#fileInput');
  await fileInput.setInputFiles(imgPath);
  await waitForAttachCount(1);
  await sendMsg('what is in this image');
  const modelDuring = await page.textContent('#modelBtnLabel');
  await sendMsg('thanks, tell me more');
  const modelAfterOneFollowup = await page.textContent('#modelBtnLabel');
  await sendMsg('ok, switching topics now');
  const modelAfterTwoFollowups = await page.textContent('#modelBtnLabel');
  assert(modelDuring !== modelBefore, `model switched for image attach (before="${modelBefore}" during="${modelDuring}")`);
  assert(modelAfterOneFollowup === modelDuring, `model stays on the vision model through one image-less follow-up, since it likely still needs the image in context (during="${modelDuring}" after one follow-up="${modelAfterOneFollowup}")`);
  assert(modelAfterTwoFollowups === modelBefore, `model restores once a second consecutive image-less message confirms the conversation moved on (before="${modelBefore}" after two follow-ups="${modelAfterTwoFollowups}")`);

  console.log('\n-- image attached with no caption still includes a text part --');
  let lastRequestBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      try {
        const parsed = JSON.parse(req.postData());
        if (parsed.messages) lastRequestBody = parsed;
      } catch (e) {}
    }
    await route.continue();
  });
  const fileInput2 = await page.$('#fileInput');
  await fileInput2.setInputFiles(imgPath);
  await waitForAttachCount(1);
  await page.fill('#prompt', '');
  await page.click('#sendBtn');
  await page.waitForTimeout(600);
  await dismissConfirmIfAny();
  await waitForSendDone();
  // Poll for the intercepted request body specifically, not just UI settle
  // time - unrouting before the request lands (a timing race, not an app
  // bug) reads lastRequestBody as null and misreports a failure. Same fix
  // already applied to the regen and repo-tools tests below.
  for (let i = 0; i < 60 && lastRequestBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const lastUserMsg = lastRequestBody && lastRequestBody.messages ? lastRequestBody.messages.filter(m => m.role === 'user').pop() : null;
  const contentParts = lastUserMsg && Array.isArray(lastUserMsg.content) ? lastUserMsg.content : [];
  const hasTextPart = contentParts.some(p => p.type === 'text');
  assert(hasTextPart, 'a caption-less image attachment still sends a text part alongside the image');

  console.log('\n-- an undecodable "image" file surfaces an error instead of hanging forever --');
  // compressImg() had no error handling on the FileReader or Image objects -
  // a file the browser's <img> can't decode (some HEIC variants are
  // inconsistently supported despite iOS's own photo picker previewing them
  // fine) left the promise never settling, so the attach handler's `await`
  // hung forever: the photo just silently never appeared, with nothing to
  // recover from short of a reload.
  const corruptImgPath = path.join(os.tmpdir(), 'regression_corrupt.png');
  fs.writeFileSync(corruptImgPath, Buffer.from('this is not a real png file, just garbage bytes'));
  const fileInputBad = await page.$('#fileInput');
  await fileInputBad.setInputFiles({ name: 'corrupt.png', mimeType: 'image/png', buffer: fs.readFileSync(corruptImgPath) });
  await page.waitForTimeout(1500);
  const corruptToastMsg = await page.textContent('#msgToastText');
  assert(!!corruptToastMsg && corruptToastMsg.indexOf('corrupt.png') >= 0, `an undecodable image triggers a clear error naming the file (got toast: ${JSON.stringify(corruptToastMsg)})`);
  const attachCountAfterBadFile = await page.evaluate(() => document.querySelectorAll('#attachItems .ai').length);
  assert(attachCountAfterBadFile === 0, 'the undecodable file itself is not added to the attachment list');
  // The app must still work normally afterward - one bad file shouldn't leave anything stuck.
  const fileInputRecover = await page.$('#fileInput');
  await fileInputRecover.setInputFiles(imgPath);
  await waitForAttachCount(1);
  const attachCountAfterGoodFile = await page.evaluate(() => document.querySelectorAll('#attachItems .ai').length);
  assert(attachCountAfterGoodFile === 1, 'a valid image still attaches normally right after a failed one');
  await page.evaluate(() => { document.querySelectorAll('#attachItems .ac2').forEach(function(b){b.click();}); });
  await page.waitForTimeout(200);

  console.log('\n-- regen reuses the prompt/project active at send time, not whatever is selected now --');
  // A message sent while "Prompt A" is the active system prompt, regenerated
  // after switching to "Prompt B", must still be regenerated under Prompt
  // A's instructions - Regen used to always read whatever's currently
  // selected via getAP(), so switching between send and Regen silently
  // changed which ruleset the model followed (this is what happened when a
  // WORQ project message got regenerated under "Research and Analysis").
  await page.click('#systemToggle'); await page.waitForTimeout(150);
  await page.click('#newPromptBtn'); await page.waitForTimeout(150);
  await page.fill('#promptNameInput', 'Regtest Prompt A');
  await page.fill('#promptContentInput', 'PROJ_A_MARKER instructions');
  await page.click('#savePromptBtn'); await page.waitForTimeout(150);
  await sendMsg('regen prompt-context test');
  await page.click('#systemToggle'); await page.waitForTimeout(150);
  await page.click('#newPromptBtn'); await page.waitForTimeout(150);
  await page.fill('#promptNameInput', 'Regtest Prompt B');
  await page.fill('#promptContentInput', 'PROJ_B_MARKER instructions');
  await page.click('#savePromptBtn'); await page.waitForTimeout(150);
  let lastRegenBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      try {
        const parsed = JSON.parse(req.postData());
        if (parsed.messages) lastRegenBody = parsed;
      } catch (e) {}
    }
    await route.continue();
  });
  await page.locator('button:has-text("Regen")').last().click();
  // Poll for the intercepted request body specifically, not just UI
  // settle time - unrouting before the request lands (a race, not an app
  // bug) reads lastRegenBody as null and misreports a failure.
  for (let i = 0; i < 60 && lastRegenBody === null; i++) await page.waitForTimeout(200);
  await dismissConfirmIfAny();
  await waitForSendDone();
  await page.unroute('**/*');
  const regenSysContent = (lastRegenBody && lastRegenBody.messages ? lastRegenBody.messages : [])
    .filter(m => m.role === 'system').map(m => m.content).join('\n');
  assert(regenSysContent.indexOf('PROJ_A_MARKER') >= 0, 'regen uses the prompt active at original send time (Prompt A)');
  assert(regenSysContent.indexOf('PROJ_B_MARKER') < 0, 'regen ignores the prompt switched to afterward (Prompt B)');

  console.log('\n-- github connect/disconnect + write-confirm gate --');
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.fill('#ghOwnerInput', 'solmasta');
  await page.fill('#ghRepoInput', 'openai-router');
  // github-ops-worker now requires this secret for every repo op, including
  // read_file/list_files, not just writes - without it the repo-tools gate
  // (executeRepoTool and the two "hasRepoTools" checks) stays closed even
  // once GitHub looks "connected", which the tool-offering assertions
  // further down (e.g. "a generic coding question gets repo tools...")
  // depend on.
  await page.fill('#ghWriteSecretInput', 'regtest-write-secret');
  await page.click('#githubSaveBtn'); await page.waitForTimeout(150);
  const ghStatusAfterConnect = await page.textContent('#githubStatus');
  assert(ghStatusAfterConnect === 'solmasta/openai-router', `GitHub status reflects connected repo (got "${ghStatusAfterConnect}")`);
  const ghPersisted = await page.evaluate(() => localStorage.getItem('gh_repo_owner') === 'solmasta' && localStorage.getItem('gh_repo_name') === 'openai-router');
  assert(ghPersisted, 'GitHub connection persisted to localStorage');

  console.log('\n-- quick Clear button disconnects without needing to open the Connect modal --');
  // Settings previously only exposed Disconnect buried inside the Connect
  // modal - a one-tap Clear right on the Settings row itself so switching
  // away from whatever repo happens to be connected (e.g. before starting
  // an unrelated new app) doesn't require digging for it.
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  const clearBtnVisibleWhileConnected = await page.evaluate(() => !document.getElementById('githubClearBtn').classList.contains('hidden'));
  assert(clearBtnVisibleWhileConnected, 'Clear button is visible in Settings while a repo is connected');
  await page.click('#githubClearBtn'); await page.waitForTimeout(150);
  const ghStatusAfterQuickClear = await page.textContent('#githubStatus');
  assert(ghStatusAfterQuickClear === 'Not connected', `the quick Clear button disconnects the repo directly from Settings (got "${ghStatusAfterQuickClear}")`);
  const clearBtnHiddenAfterClear = await page.evaluate(() => document.getElementById('githubClearBtn').classList.contains('hidden'));
  assert(clearBtnHiddenAfterClear, 'Clear button hides itself once there is nothing connected to clear');

  console.log('\n-- previously connected repos are offered as quick "recent" picks when reconnecting --');
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  const recentReposVisible = await page.evaluate(() => !document.getElementById('ghRecentRepos').classList.contains('hidden'));
  assert(recentReposVisible, 'the repo just cleared shows up as a recent-repo quick pick');
  const recentRepoLabel = await page.evaluate(() => document.getElementById('ghRecentReposList').textContent);
  assert(recentRepoLabel.indexOf('solmasta/openai-router') >= 0, `the recent-repo list includes the repo that was just disconnected (got "${recentRepoLabel}")`);
  // disconnectGithub (the Clear button above) used to also wipe the stored
  // write secret, forcing it to be retyped on every single reconnect - it's
  // a per-device credential, not tied to a given repo connection, so it
  // should still be sitting here without retyping it.
  const writeSecretPersistedAfterClear = await page.inputValue('#ghWriteSecretInput');
  assert(writeSecretPersistedAfterClear === 'regtest-write-secret', `the write secret survives Clear/reconnect instead of being wiped (got "${writeSecretPersistedAfterClear}")`);
  await page.click('#ghRecentReposList button:has-text("solmasta/openai-router")');
  const ownerFilledFromRecent = await page.inputValue('#ghOwnerInput');
  const repoFilledFromRecent = await page.inputValue('#ghRepoInput');
  assert(ownerFilledFromRecent === 'solmasta' && repoFilledFromRecent === 'openai-router', `tapping a recent-repo chip fills the owner/repo inputs (got "${ownerFilledFromRecent}/${repoFilledFromRecent}")`);
  await page.fill('#ghWriteSecretInput', '');
  await page.click('#githubSaveBtn'); await page.waitForTimeout(150);
  const ghStatusAfterRepoOnlyReconnect = await page.textContent('#githubStatus');
  assert(ghStatusAfterRepoOnlyReconnect === 'solmasta/openai-router (saved - add OAuth or write secret)', `saving just the repo (without auth) leaves an explicit saved-but-not-authenticated status (got "${ghStatusAfterRepoOnlyReconnect}")`);
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  const codingEmptyStateNeedsAuth = await page.evaluate(() => document.querySelector('#emptyState .es-sub').textContent);
  assert(codingEmptyStateNeedsAuth.indexOf('saved') >= 0 && codingEmptyStateNeedsAuth.indexOf('OAuth') >= 0, `an empty Coding tab explains that the repo is saved but auth is still missing (got "${codingEmptyStateNeedsAuth}")`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const codingEmptyStateNeedsAuthAfterReload = await page.evaluate(() => document.querySelector('#emptyState .es-sub').textContent);
  assert(codingEmptyStateNeedsAuthAfterReload.indexOf('saved') >= 0 && codingEmptyStateNeedsAuthAfterReload.indexOf('OAuth') >= 0, `reloading an empty Coding tab keeps the auth-specific guidance instead of falling back to "connect a repo" (got "${codingEmptyStateNeedsAuthAfterReload}")`);
  await sendMsg('hello there');
  const codingAuthGuardText = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(codingAuthGuardText.indexOf("isn't authenticated yet") >= 0, `sending in a Coding tab with a saved-but-unauthenticated repo shows an auth-specific guard (got: ${codingAuthGuardText.slice(-300)})`);
  assert(codingAuthGuardText.indexOf('needs a connected repo') < 0, 'the saved-but-unauthenticated Coding-tab guard no longer incorrectly claims that no repo is connected');
  // This guard text is a canned client-side string, not a model reply - it
  // must not carry a model-name tag (previously showed whatever the main
  // chat's currentModel happened to be, e.g. "Mistral Small 3.2 24B",
  // making it look like that model answered inside the Coding tab).
  const guardBubbleHasModelTag = await page.evaluate(() => {
    const bubbles = document.querySelectorAll('#chat .msg.ma3');
    const last = bubbles[bubbles.length - 1];
    return !!(last && last.querySelector('.modelTag'));
  });
  assert(!guardBubbleHasModelTag, 'the saved-but-unauthenticated Coding-tab guard message has no model-name tag, since no model actually produced it');
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.fill('#ghWriteSecretInput', 'regtest-write-secret');
  await page.click('#githubSaveBtn'); await page.waitForTimeout(150);
  const ghStatusAfterRecentReconnect = await page.textContent('#githubStatus');
  assert(ghStatusAfterRecentReconnect === 'solmasta/openai-router', `reconnecting via the recent-repo chip plus restored auth actually reconnects (got "${ghStatusAfterRecentReconnect}")`);
  await page.locator('#tabBar .tabpill.act .tpx').click();
  await page.waitForTimeout(400);

  console.log('\n-- vision model + image request omits repo tools even with GitHub connected --');
  // With GitHub connected, an image sent to a vision model (not in
  // TOOL_MODELS - not vetted for function-calling) must not receive
  // tools/tool_choice: a vision model handed tools could reply via a
  // tool_call instead of plain text, and the streaming reader only reads
  // delta.content, silently producing "(empty response)".
  let lastReqBodyWithTools = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      try {
        const parsed = JSON.parse(req.postData());
        if (parsed.messages) lastReqBodyWithTools = parsed;
      } catch (e) {}
    }
    await route.continue();
  });
  const fileInput3 = await page.$('#fileInput');
  await fileInput3.setInputFiles(imgPath);
  await waitForAttachCount(1);
  await sendMsg('what is in this image');
  await page.unroute('**/*');
  assert(lastReqBodyWithTools && !lastReqBodyWithTools.tools, 'vision model image request has no tools field with GitHub connected');

  console.log('\n-- repo tools are only offered when the message is actually code/github-relevant --');
  // GitHub connected + a tool-capable model must not get REPO_TOOLS for a
  // message unrelated to code or the repo - tools used to be offered
  // unconditionally whenever GitHub was connected, so an unrelated
  // question (e.g. about crypto/markets) could make a small model
  // hallucinate a git clone and go hunting for nonexistent repo files
  // instead of just answering.
  let lastUnrelatedBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      try {
        const parsed = JSON.parse(req.postData());
        if (parsed.messages) lastUnrelatedBody = parsed;
      } catch (e) {}
    }
    await route.continue();
  });
  await sendMsg('what is dtcc and how does it relate to xrp');
  // Poll for the intercepted body specifically - unrouting before the
  // request lands (a timing race, not an app bug) reads it as null and
  // misreports a failure. Same fix already applied to the regen test.
  for (let i = 0; i < 60 && lastUnrelatedBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  // App-control tools (create_project/switch_model/remember) are always
  // attached for a tool-capable model now, regardless of relevance - only
  // the repo tools (read_file/write_file/list_files) stay gated on
  // whether the message is actually code/github-relevant.
  const unrelatedToolNames = ((lastUnrelatedBody && lastUnrelatedBody.tools) || []).map((t) => t.function.name);
  assert(unrelatedToolNames.indexOf('read_file') < 0 && unrelatedToolNames.indexOf('write_file') < 0 && unrelatedToolNames.indexOf('list_files') < 0, `an unrelated (non-code/github) message gets no repo tools even with GitHub connected (got tools: ${JSON.stringify(unrelatedToolNames)})`);

  console.log('\n-- a generic coding question now defaults to the connected repo and reaches the dedicated coding agent --');
  // With a repo connected, coding/debugging questions should default to
  // that repo even if the user doesn't explicitly say "github" or "repo".
  // The dedicated coding agent should receive the request and keep repo
  // tools available, instead of leaving the message on the main chat path.
  let lastGenericCodeBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        lastGenericCodeBody = parsed;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Checked the connected repo.' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('why is this javascript function throwing an error');
  for (let i = 0; i < 60 && lastGenericCodeBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const genericCodeToolNames = ((lastGenericCodeBody && lastGenericCodeBody.tools) || []).map((t) => t.function.name);
  assert(!!lastGenericCodeBody, 'a generic coding question reaches the dedicated coding agent when GitHub is connected');
  assert(genericCodeToolNames.indexOf('read_file') >= 0 && genericCodeToolNames.indexOf('write_file') >= 0 && genericCodeToolNames.indexOf('list_files') >= 0 && genericCodeToolNames.indexOf('list_all_files') >= 0, `a generic coding question gets repo tools through the dedicated coding agent when GitHub is connected (got tools: ${JSON.stringify(genericCodeToolNames)})`);

  console.log('\n-- a genuinely code/github-relevant message routes to the dedicated coding agent, not the main chat model --');
  // Repo work (read_file/write_file/list_files/merge_branch) always runs
  // on one fixed model now, independent of whatever the main chat is
  // using - the main chat model never gets REPO_TOOLS attached at all
  // anymore, so an auto-router switch away from a tool-capable model can
  // no longer strand a later repo request.
  let lastCodingAgentBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        lastCodingAgentBody = parsed;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'The README describes this project.' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please read the README file from the github repo');
  for (let i = 0; i < 60 && lastCodingAgentBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  assert(!!lastCodingAgentBody, 'a repo-flavored message reaches the dedicated coding agent model');
  assert(Array.isArray(lastCodingAgentBody.tools) && lastCodingAgentBody.tools.length > 0, 'the coding agent request carries the repo tools');
  assert(lastCodingAgentBody.tool_choice === 'auto', `the coding agent gets tool_choice:"auto", free to call a tool or just answer (got "${lastCodingAgentBody.tool_choice}")`);
  // A real transcript: a write_file call for a several-KB file kept coming
  // back as incomplete tool-call-shaped text, cut off mid-property, because
  // max_tokens:1500 wasn't enough room for the JSON-escaped file content -
  // each auto-continue round then restarted the whole file from scratch
  // with no memory of the truncated attempt, which read as a stuck loop.
  assert(lastCodingAgentBody.max_tokens >= 8000, `the coding agent gets enough max_tokens for a real file write, not just a trivial one (got ${lastCodingAgentBody.max_tokens})`);
  // A real transcript: asked to "upgrade the graphics", the agent wrote a
  // whole parallel set of EnhancedHeader.css/EnhancedSidebar.css/etc. next
  // to the real Header.css/Sidebar.css the components actually import -
  // real commits, zero visible effect, since nothing pointed at the new
  // files. The system prompt must tell it to edit the file actually in use
  // instead of shadowing it with a differently-named duplicate.
  const codingAgentSystemMsg = (lastCodingAgentBody.messages || []).find((m) => m.role === 'system');
  assert(!!codingAgentSystemMsg && (codingAgentSystemMsg.content || '').indexOf('never create a differently-named parallel file') >= 0, 'the coding agent is told to edit the real in-use file instead of shadowing it with a parallel duplicate that nothing imports');
  // list_files used to require a path, so the model had no legitimate way
  // to ask for "the whole repo" - it had to guess a path or get an error
  // either way. Confirm the tool's own schema no longer forces one.
  const listFilesTool = (lastCodingAgentBody.tools || []).find((t) => t.function.name === 'list_files');
  assert(listFilesTool && !(listFilesTool.function.parameters.required || []).includes('path'), 'list_files no longer requires a path - omitting it can mean "list the repo root"');
  const chatTextAfterCodingAgent = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(chatTextAfterCodingAgent.indexOf('Overseer') >= 0, "repo work renders as a normal Overseer reply, labeled consistently with the main chat");
  assert(chatTextAfterCodingAgent.indexOf('README describes this project') >= 0, "the coding agent's final answer actually renders");

  console.log('\n-- 3+ rounds of "Continue with the next step" in a row still keep routing to the dedicated coding agent --');
  // Each auto-generated "Continue with the next step: X" message (from the
  // step-completed notice and the persistent Overseer bar) scores zero on
  // every analyzeTask keyword category on its own - a real bug had
  // recentTurnsWereRepoRelevant only looking at the last 3 prior user
  // turns, so after 3+ of these generic continuation messages in a row,
  // the original repo-establishing message fell out of that window and
  // the gate silently dropped back to the plain chat model, which has no
  // real repo tools and hallucinates fake tool-call syntax instead.
  let continuationRoundCodingAgentHits = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        continuationRoundCodingAgentHits++;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest continuation round ' + continuationRoundCodingAgentHits } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please check the repo and tell me what it does');
  assert(continuationRoundCodingAgentHits === 1, 'test setup: the seed repo message reaches the coding agent');
  await sendMsg('Continue with the next step: Verify results');
  await sendMsg('Continue with the next step: Verify results');
  await sendMsg('Continue with the next step: Verify results');
  await page.unroute('**/*');
  assert(continuationRoundCodingAgentHits === 4, `4 consecutive rounds (1 seed message + 3 "Continue with the next step" follow-ups) all reached the dedicated coding agent, not just the first couple (got ${continuationRoundCodingAgentHits})`);

  console.log('\n-- list_all_files lists the whole repo in one call instead of directory-by-directory guessing --');
  // A real user report: the coding agent hit repeated read_file 404s
  // guessing at plausible file paths/extensions (e.g. .js vs .jsx) before
  // finding the real one - list_all_files (Git Trees API, recursive) gives
  // it every path in the repo, or under a prefix, in a single call.
  let listAllFilesRoundCount = 0;
  let listAllFilesWorkerBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        listAllFilesRoundCount++;
        if (listAllFilesRoundCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 'regtest_list_all', type: 'function', function: { name: 'list_all_files', arguments: JSON.stringify({ path: 'frontend/src' }) } }] } }] }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest found it via list_all_files' } }] }),
        });
        return;
      }
      if (parsed && parsed.op === 'list_all_files') {
        listAllFilesWorkerBody = parsed;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, files: ['frontend/src/App.js', 'frontend/src/index.js'], total: 42, truncated: true }),
        });
        return;
      }
    }
    await route.continue();
  });
  // "on your own" matches looksLikeAutoContinueRequest so round 2 (the
  // final answer) chains automatically instead of stopping after round 1
  // for a manual Continue tap - this test is about list_all_files wiring,
  // not the separate auto-continue-detection behavior covered elsewhere.
  await sendMsg('please find the api config file in this repo on your own');
  let chatTextAfterListAllFiles = '';
  for (let i = 0; i < 40; i++) {
    chatTextAfterListAllFiles = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextAfterListAllFiles.indexOf('regtest found it via list_all_files') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(!!listAllFilesWorkerBody, 'the coding agent actually calls the list_all_files op against the repo worker, not just read_file/list_files');
  assert(listAllFilesWorkerBody.path === 'frontend/src', `list_all_files forwards the requested path prefix to the worker (got: ${JSON.stringify(listAllFilesWorkerBody)})`);
  assert(chatTextAfterListAllFiles.indexOf('regtest found it via list_all_files') >= 0, `the final answer renders after the list_all_files round completes (rounds seen: ${listAllFilesRoundCount}, tail: ${chatTextAfterListAllFiles.slice(-400)})`);
  assert(chatTextAfterListAllFiles.indexOf('mapped out the whole repo') >= 0, `the round summary reflects the list_all_files step, not a generic fallback (got tail: ${chatTextAfterListAllFiles.slice(-300)})`);

  await page.evaluate(() => {
    document.getElementById('ghwPath').textContent = 'test';
    document.getElementById('githubWriteConfirmModal').classList.remove('hidden');
  });
  await page.click('#ghwDenyBtn'); await page.waitForTimeout(150);
  const ghConfirmClosedAfterDeny = await page.evaluate(() => document.getElementById('githubWriteConfirmModal').classList.contains('hidden'));
  assert(ghConfirmClosedAfterDeny, 'write-confirm modal closes on deny (does not hang the tool loop)');
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.click('#githubDisconnectBtn'); await page.waitForTimeout(150);
  const ghStatusAfterDisconnect = await page.textContent('#githubStatus');
  assert(ghStatusAfterDisconnect === 'Not connected', `GitHub status reflects disconnect (got "${ghStatusAfterDisconnect}")`);

  console.log('\n-- an unambiguous coding message always converges on the same pinned coding model --');
  // The general auto-router's shuffle + recency-penalty scoring (added
  // specifically so it wouldn't camp on one model for variety's sake)
  // meant a coding conversation could rotate between several
  // similarly-scored coding models message to message (Qwen2.5-72B,
  // DeepSeek-V3.2, Qwen3-Coder, Kimi-K2, GLM-4.6, MiniMax-M2) - each with
  // different conventions and tool-calling behavior, which reads as
  // "random" for something that benefits from staying consistent. Force
  // the model onto something clearly non-coding first, then send an
  // unambiguous coding message and confirm it always lands on the one
  // pinned coding model - same one the dedicated repo coding agent uses.
  // Deliberately does NOT clear the chat first - #clearBtn wipes the
  // active tab's history, and this runs on Tab A before the later "tabs"
  // test switches away and back expecting Tab A's original content still
  // there. The router weighs the last 8 non-github-flavored user turns by
  // recency (latest counts in full, each one before it at half the weight
  // of the one after it - see analyzeConversationTasks), so an unambiguous
  // coding message with several matched keywords dominates that window
  // regardless of whatever unrelated messages came before it.
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.locator('.mc:has-text("Llama 3.1 8B Turbo")').first().click();
  await page.waitForTimeout(150);
  await sendMsg('why does this python function raise a TypeError when I pass it a list, can you fix and refactor the code');
  const modelAfterCodeMsg = await page.textContent('#modelBtnLabel');
  assert(modelAfterCodeMsg === 'Qwen3 Coder 480B', `an unambiguous coding message converges on the one pinned coding model instead of a rotating pick (got "${modelAfterCodeMsg}")`);
  await sendMsg('please debug this javascript error and implement a fix');
  const modelAfterSecondCodeMsg = await page.textContent('#modelBtnLabel');
  assert(modelAfterSecondCodeMsg === 'Qwen3 Coder 480B', `a second, differently-worded coding message stays on the same pinned model instead of rotating (got "${modelAfterSecondCodeMsg}")`);

  console.log('\n-- memory add/delete --');
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#memoryBtn'); await page.waitForTimeout(150);
  await page.fill('#newMemoryInput', 'regression test memory fact');
  await page.click('#addMemoryBtn'); await page.waitForTimeout(200);
  const memCountAfterAdd = await page.evaluate(() => document.querySelectorAll('#memoryList .pc').length);
  assert(memCountAfterAdd === 1, `memory count is 1 after add (got ${memCountAfterAdd})`);
  await page.click('#memoryList .cdb'); await page.waitForTimeout(200);
  const memCountAfterDelete = await page.evaluate(() => document.querySelectorAll('#memoryList .pc').length);
  assert(memCountAfterDelete === 0, `memory count is 0 after delete (got ${memCountAfterDelete})`);
  await page.click('#closeMemoryModal'); await page.waitForTimeout(150);

  console.log('\n-- tabs: create, isolate, switch back --');
  await page.click('#newTabBtn'); await page.waitForTimeout(400);
  const tabCount = await page.evaluate(() => document.querySelectorAll('#tabBar .tabpill').length);
  assert(tabCount === 2, `tab count is 2 after creating a new tab (got ${tabCount})`);
  const tabBEmpty = await page.evaluate(() => document.getElementById('chat').textContent.indexOf('quick test') < 0);
  assert(tabBEmpty, 'new tab starts empty, does not inherit prior tab content');
  await sendMsg('write a short poem');
  // A locator auto-waits for the element to actually be there; page.$$()
  // takes an instant snapshot and can catch the tab bar mid-re-render,
  // returning zero elements and crashing on pills[0].click().
  await page.locator('#tabBar .tabpill').first().click();
  await page.waitForTimeout(600);
  const backOnTabA = await page.evaluate(() => document.getElementById('chat').textContent.indexOf('quick test') >= 0);
  assert(backOnTabA, 'switching back to tab A shows its original content');

  console.log('\n-- closing a background tab only removes that one tab, and confirms with a toast --');
  // A real user report: closing a tab sometimes "just turns red" (a stuck
  // touch-hover state with no actual feedback) or "removes everything, all
  // the tabs" - neither of those should be possible from a single tap on
  // one tab's X. This checks closing a NON-active background tab in a
  // 3-tab set only removes that one tab and leaves the active tab's
  // content untouched.
  await page.click('#newTabBtn'); await page.waitForTimeout(400);
  await sendMsg('regtest tab C content');
  const tabCountBeforeBgClose = await page.evaluate(() => document.querySelectorAll('#tabBar .tabpill').length);
  assert(tabCountBeforeBgClose === 3, `test setup: 3 tabs open before closing a background one (got ${tabCountBeforeBgClose})`);
  // Tab B (index 1) is the middle pill - tab C (this test's own, active) is last.
  await page.locator('#tabBar .tabpill').nth(1).locator('.tpx').click();
  await page.waitForTimeout(300);
  const tabCountAfterBgClose = await page.evaluate(() => document.querySelectorAll('#tabBar .tabpill').length);
  assert(tabCountAfterBgClose === 2, `closing one background tab removes exactly that one, not all of them (got ${tabCountAfterBgClose} remaining)`);
  const stillOnTabCAfterBgClose = await page.evaluate(() => document.getElementById('chat').textContent.indexOf('regtest tab C content') >= 0);
  assert(stillOnTabCAfterBgClose, "closing a background tab doesn't disturb the active tab's own content");
  const bgCloseToast = await page.textContent('#msgToastText');
  assert(bgCloseToast.indexOf('tabs left') >= 0 || bgCloseToast.indexOf('tab left') >= 0, `closing a tab confirms with a toast stating how many remain, instead of leaving it ambiguous whether more than one was removed (got "${bgCloseToast}")`);

  console.log('\n-- closing down to the last tab confirms "1 tab left" instead of looking like everything vanished --');
  // Once only one tab remains, the tab bar itself disappears (by design -
  // no need for tab-switching UI with nothing to switch to). Without an
  // explicit toast, that abrupt disappearance is exactly what a user
  // described as "it removes everything, all the tabs."
  await page.locator('#tabBar .tabpill').first().locator('.tpx').click();
  await page.waitForTimeout(300);
  const tabBarHiddenAtOne = await page.evaluate(() => document.getElementById('tabBar').classList.contains('hidden'));
  assert(tabBarHiddenAtOne, 'test setup: the tab bar hides once only one tab remains');
  const lastTabStillHasContent = await page.evaluate(() => document.getElementById('chat').textContent.indexOf('regtest tab C content') >= 0);
  assert(lastTabStillHasContent, "the remaining tab's content is still intact - the bar hiding is cosmetic, not data loss");
  const oneTabLeftToast = await page.textContent('#msgToastText');
  assert(oneTabLeftToast.indexOf('1 tab left') >= 0, `closing down to the last tab explicitly confirms "1 tab left" rather than looking like a wipe (got "${oneTabLeftToast}")`);

  console.log('\n-- closing the active tab mid-send is blocked with a clear toast instead of silently doing nothing --');
  // sending only reflects the ACTIVE tab's own in-flight request - it used
  // to block closing ANY tab (even unrelated background ones) with zero
  // feedback, which is the other half of the "X just turns red, nothing
  // happens" report.
  await page.click('#newTabBtn'); await page.waitForTimeout(400);
  let releaseSlowSend = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === true) {
        await new Promise((resolve) => { releaseSlowSend = resolve; });
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"regtest slow reply"}}]}\n\ndata: [DONE]\n\n' });
        return;
      }
    }
    await route.continue();
  });
  await page.fill('#prompt', 'regtest message that stays in flight');
  await page.click('#sendBtn');
  await page.waitForTimeout(400);
  const tabCountBeforeBlockedClose = await page.evaluate(() => document.querySelectorAll('#tabBar .tabpill').length);
  await page.locator('#tabBar .tabpill.act .tpx').click();
  await page.waitForTimeout(200);
  const blockedCloseToast = await page.textContent('#msgToastText');
  assert(blockedCloseToast.indexOf('Finish or stop the current response') >= 0, `closing the active tab mid-send shows a clear toast explaining why, instead of silently doing nothing (got "${blockedCloseToast}")`);
  const tabCountAfterBlockedClose = await page.evaluate(() => document.querySelectorAll('#tabBar .tabpill').length);
  assert(tabCountAfterBlockedClose === tabCountBeforeBlockedClose, 'the active tab is not actually closed while its own send is still in flight');
  if (releaseSlowSend) releaseSlowSend();
  await waitForSendDone();
  await page.unroute('**/*');

  console.log('\n-- Coding tab always routes to the coding agent, with a clear guard when no repo is connected --');
  // A dedicated Coding tab exists so every message there goes straight to
  // the coding agent without needing to sound repo-flavored at all - the
  // whole point is to skip analyzeTask's keyword guessing entirely.
  const noRepoStateBeforeCodingGuard = await page.evaluate(() => !localStorage.getItem('gh_repo_owner') && !localStorage.getItem('gh_repo_name'));
  assert(noRepoStateBeforeCodingGuard, 'test setup: no repo is saved before checking the no-repo Coding-tab guard');
  const terminalPanelHiddenOutsideCoding = await page.evaluate(() => document.getElementById('terminalPanel').classList.contains('hidden'));
  assert(terminalPanelHiddenOutsideCoding, 'test setup: the Terminal panel stays out of the way outside a Coding tab with no repo activity yet');
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  const codingIndicatorVisibleNoRepo = await page.evaluate(() => document.getElementById('activePromptName').textContent.indexOf('Coding') >= 0);
  assert(codingIndicatorVisibleNoRepo, 'the system-status bar shows a Coding indicator once a Coding tab is active');
  const terminalPanelVisibleInCodingTab = await page.evaluate(() => !document.getElementById('terminalPanel').classList.contains('hidden'));
  assert(terminalPanelVisibleInCodingTab, 'the Terminal panel is already visible just from being in a Coding tab, before any repo activity has even happened');
  await sendMsg('hello there');
  const chatTextNoRepoGuard = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(chatTextNoRepoGuard.indexOf('needs a repo first') >= 0, `sending in a Coding tab with no repo connected shows a clear guard message instead of silently falling back to the plain chat model (got: ${chatTextNoRepoGuard.slice(-300)})`);

  console.log('\n-- Coding tab reaches the dedicated coding agent for a completely generic, keyword-free message once a repo is connected --');
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.fill('#ghOwnerInput', 'solmasta');
  await page.fill('#ghRepoInput', 'Test');
  await page.fill('#ghWriteSecretInput', 'regtest-write-secret');
  await page.click('#githubSaveBtn'); await page.waitForTimeout(300);
  let codingTabAgentHit = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        codingTabAgentHit = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest coding tab reply' } }] }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('good morning, how is it going');
  await page.unroute('**/*');
  assert(codingTabAgentHit, 'a completely generic message with zero repo/code keywords still reaches the dedicated coding agent inside a Coding tab');
  const chatTextInCodingTab = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(chatTextInCodingTab.indexOf('regtest coding tab reply') >= 0, "the coding agent's reply actually renders in the Coding tab");
  // A real user report: the "🤖 Agent switched to X" banner (a second,
  // separate instance of the same bug class as the "Switch to X" button
  // fixed below) kept appearing in a Coding tab before every send, even
  // though runCodingAgentTurn always uses the one fixed
  // CODING_AGENT_MODEL_ID regardless of what the per-message auto-router
  // picked. This send is not the tab's first message (chatHistory.length>1
  // by now from the guard exchange above), so switchToBestModel() would
  // have fired here pre-fix.
  assert(chatTextInCodingTab.indexOf('Agent switched to') === -1, 'the per-message auto-router never shows its "Agent switched to X" banner in a Coding tab');

  console.log('\n-- a model-switch recommendation never appears in a Coding tab, since the coding work always runs on the fixed agent model regardless --');
  // A real user report: "Switch to X... Switched" kept firing mid-task in
  // a Coding tab and got tapped along with everything else - pointless,
  // since runCodingAgentTurn always uses the one fixed
  // CODING_AGENT_MODEL_ID no matter what the main chat's currentModel is.
  // Reuses the same fake-tool-call content the stubborn-retry test below
  // uses - it's short AND trips detectAssistantConcern's looksLikeFakeToolCallText
  // check, a reliable way to make this conversation read as "stuck" and
  // fire makeBetterRecommendation() without depending on exact timing.
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'tool_code\nprint(list_files())' } }] }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('regtest another coding message that should look stuck');
  let switchButtonSeenInCodingTab = false;
  for (let i = 0; i < 20; i++) {
    switchButtonSeenInCodingTab = await page.evaluate(() => Array.from(document.querySelectorAll('#chat button')).some((b) => (b.textContent || '').indexOf('Switch to') >= 0));
    if (switchButtonSeenInCodingTab) break;
    await page.waitForTimeout(300);
  }
  await page.unroute('**/*');
  assert(!switchButtonSeenInCodingTab, 'no "Switch to X" model-switch recommendation ever appears in a Coding tab, since it would have zero effect on the coding agent actually doing the work');
  // A fresh plain tab, not clicking into whatever "first" tab happens to
  // exist this deep in the suite (that landed on an unpredictable tab with
  // its own accumulated history and broke a much later, unrelated test).
  // GitHub connection state (gh_repo_owner etc.) is global, not per-tab,
  // so later tests that still need repo access are unaffected.
  await page.click('#newTabBtn'); await page.waitForTimeout(400);

  console.log('\n-- OAuth-only GitHub refresh keeps Coding-tab repo access alive without a legacy write secret --');
  await page.evaluate(() => {
    localStorage.setItem('gh_repo_owner', 'solmasta');
    localStorage.setItem('gh_repo_name', 'openai-router');
    localStorage.removeItem('gh_write_secret');
    localStorage.setItem('gh_oauth_refresh_token', 'regtest-refresh-token');
    localStorage.setItem('gh_oauth_token', JSON.stringify({ token: 'expired-regtest-token', expiry: Date.now() - 60000 }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const codingStillActiveAfterReload = await page.evaluate(() => document.getElementById('activePromptName').textContent.indexOf('Coding') >= 0);
  if (!codingStillActiveAfterReload) {
    await page.click('#newCodeTabBtn');
    await page.waitForTimeout(400);
  }
  let oauthRefreshHit = false;
  let refreshWriteSecretHeader = '__unset__';
  let repoOpAuthHeader = '';
  let repoOpWriteSecretHeader = '__unset__';
  let oauthRepoOpHit = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.indexOf('github-oauth-worker') >= 0 && url.indexOf('/refresh') >= 0) {
      oauthRefreshHit = true;
      const headers = req.headers();
      refreshWriteSecretHeader = Object.prototype.hasOwnProperty.call(headers, 'x-write-secret') ? headers['x-write-secret'] : '__missing__';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: 'fresh-regtest-token', expires_in: 3600 })
      });
      return;
    }
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            choices: [{
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{
                  id: 'call_regtest_list',
                  type: 'function',
                  function: { name: 'list_files', arguments: '{}' }
                }]
              }
            }]
          })
        });
        return;
      }
      if (url.indexOf('github-ops-worker') >= 0 && parsed && parsed.op === 'list_files') {
        oauthRepoOpHit = true;
        const headers = req.headers();
        repoOpAuthHeader = headers.authorization || '';
        repoOpWriteSecretHeader = Object.prototype.hasOwnProperty.call(headers, 'x-write-secret') ? headers['x-write-secret'] : '__missing__';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, files: [{ name: 'index.html', type: 'file', path: 'index.html' }] })
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('good morning again');
  await page.unroute('**/*');
  assert(oauthRefreshHit, 'an expired OAuth-only repo connection refreshes its token before the Coding tab uses repo tools');
  assert(refreshWriteSecretHeader === '__missing__', `OAuth token refresh omits the legacy write-secret header when none is configured (got "${refreshWriteSecretHeader}")`);
  assert(oauthRepoOpHit, 'after refresh, the Coding tab still reaches the repo worker');
  assert(repoOpAuthHeader.indexOf('Bearer ') === 0, `repo ops use the freshly refreshed OAuth bearer token (got "${repoOpAuthHeader}")`);
  assert(repoOpWriteSecretHeader === '__missing__', `repo ops omit the legacy write-secret header when using OAuth-only auth (got "${repoOpWriteSecretHeader}")`);
  await page.locator('#tabBar .tabpill').first().click();
  await page.waitForTimeout(400);
  const codingIndicatorGoneAfterSwitch = await page.evaluate(() => document.getElementById('activePromptName').textContent.indexOf('Coding') === -1);
  assert(codingIndicatorGoneAfterSwitch, 'switching to a non-Coding tab clears the Coding indicator again');

  console.log('\n-- Browse your repos: pick a connected GitHub account\'s repo from a real list instead of typing owner/name --');
  // Real request: let the user pick from a dropdown of their own repos
  // instead of typing owner/name from memory. Only available once OAuth
  // is connected (already true at this point in the suite) - the legacy
  // write-secret path never hands the browser a usable token to call
  // GitHub's API with directly.
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  const browseBtnVisible = await page.evaluate(() => !document.getElementById('ghBrowseReposBtn').classList.contains('hidden'));
  assert(browseBtnVisible, '"Browse your repos" is offered once GitHub OAuth is connected');
  let repoListRequestAuth = '';
  await page.route('https://api.github.com/user/repos**', async (route) => {
    repoListRequestAuth = route.request().headers().authorization || '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { full_name: 'solmasta/AI-Router', owner: { login: 'solmasta' }, name: 'AI-Router', private: false },
        { full_name: 'solmasta/regtest-other-repo', owner: { login: 'solmasta' }, name: 'regtest-other-repo', private: true },
        { full_name: 'someorg/unrelated-thing', owner: { login: 'someorg' }, name: 'unrelated-thing', private: false },
      ]),
    });
  });
  await page.click('#ghBrowseReposBtn');
  let repoBrowserRows = [];
  for (let i = 0; i < 30; i++) {
    repoBrowserRows = await page.evaluate(() => Array.from(document.querySelectorAll('#ghRepoBrowserList button')).map((b) => b.textContent.trim()));
    if (repoBrowserRows.length) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('https://api.github.com/user/repos**');
  assert(repoListRequestAuth.indexOf('Bearer ') === 0, `the repo list request carries the OAuth bearer token (got "${repoListRequestAuth}")`);
  assert(repoBrowserRows.length === 3, `all 3 mocked repos render as rows (got ${repoBrowserRows.length}: ${JSON.stringify(repoBrowserRows)})`);
  assert(repoBrowserRows.some((r) => r.indexOf('solmasta/regtest-other-repo') >= 0), 'a private repo still renders (with a lock indicator, but not excluded)');
  await page.fill('#ghRepoBrowserSearch', 'regtest-other');
  await page.waitForTimeout(150);
  const filteredRows = await page.evaluate(() => Array.from(document.querySelectorAll('#ghRepoBrowserList button')).map((b) => b.textContent.trim()));
  assert(filteredRows.length === 1 && filteredRows[0].indexOf('regtest-other-repo') >= 0, `typing a filter narrows the list client-side without refetching (got ${JSON.stringify(filteredRows)})`);
  await page.locator('#ghRepoBrowserList button').first().click();
  await page.waitForTimeout(150);
  // Picking a repo from an actual list IS the confirmation - unlike manual
  // entry, this connects immediately with no separate Save tap needed
  // (a real user found "pick it, then also have to tap Save" confusing,
  // stacked on top of OAuth-connect already being a separate step from
  // choosing a repo).
  const ownerFilledFromBrowser = await page.inputValue('#ghOwnerInput');
  const repoFilledFromBrowser = await page.inputValue('#ghRepoInput');
  assert(ownerFilledFromBrowser === 'solmasta' && repoFilledFromBrowser === 'regtest-other-repo', `clicking a repo row fills the owner/repo inputs (got "${ownerFilledFromBrowser}/${repoFilledFromBrowser}")`);
  const browserCollapsedAfterPick = await page.evaluate(() => document.getElementById('ghRepoBrowser').classList.contains('hidden'));
  assert(browserCollapsedAfterPick, 'picking a repo collapses the browser panel instead of leaving it open');
  const statusAfterBrowserPick = await page.textContent('#githubStatus');
  assert(statusAfterBrowserPick.indexOf('solmasta/regtest-other-repo') >= 0, `picking a repo from the browser connects it right away - no separate Save tap needed (status shows "${statusAfterBrowserPick}")`);
  const pickToast = await page.textContent('#msgToastText');
  assert(pickToast.indexOf('Connected to solmasta/regtest-other-repo') >= 0, `a toast confirms the browser-picked repo actually connected (got "${pickToast}")`);
  const savedAfterBrowserPick = await page.evaluate(() => localStorage.getItem('gh_repo_owner') === 'solmasta' && localStorage.getItem('gh_repo_name') === 'regtest-other-repo');
  assert(savedAfterBrowserPick, 'the browser-picked repo is actually persisted to storage, not just shown in the inputs');
  // Restore the real repo connection for the rest of the suite.
  await page.fill('#ghOwnerInput', 'solmasta');
  await page.fill('#ghRepoInput', 'AI-Router');
  await page.click('#githubSaveBtn'); await page.waitForTimeout(150);

  console.log('\n-- a Coding tab warns the model (and the user) when the connected repo changes mid-conversation --');
  // A real user report: a long-running Coding tab kept confidently
  // describing an EARLIER-connected repo after switching to a different
  // one - chatHistory still holds every system prompt/tool result the
  // model saw before the switch, and the model has no way to know those
  // went stale just because the live connection changed later.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  let repoChangeRequestBodies = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        repoChangeRequestBodies.push(parsed);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest reply ' + repoChangeRequestBodies.length } }] }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('what repo are we working with');
  await page.waitForTimeout(300);
  const noticeAfterFirstTurn = await page.evaluate(() => document.getElementById('chat').textContent.indexOf('Repo connection changed') >= 0);
  assert(!noticeAfterFirstTurn, 'the very first coding turn in a fresh tab has nothing to compare against, so no false "repo changed" warning fires');
  const firstTurnSysContent = ((repoChangeRequestBodies[0] && repoChangeRequestBodies[0].messages) || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert(firstTurnSysContent.indexOf('REPO CONNECTION CHANGED') < 0, 'the first turn\'s request carries no stale-repo warning either');

  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.fill('#ghOwnerInput', 'solmasta');
  await page.fill('#ghRepoInput', 'regtest-repo-b');
  await page.click('#githubSaveBtn'); await page.waitForTimeout(150);

  await sendMsg('now what repo do you see');
  await page.waitForTimeout(300);
  const noticeAfterSwitch = await page.evaluate(() => document.getElementById('chat').textContent.indexOf('Repo connection changed to') >= 0 && document.getElementById('chat').textContent.indexOf('regtest-repo-b') >= 0);
  assert(noticeAfterSwitch, 'switching the connected repo mid-conversation shows a visible notice in chat, not just a silent behind-the-scenes change');
  const secondTurnSysContent = ((repoChangeRequestBodies[1] && repoChangeRequestBodies[1].messages) || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert(secondTurnSysContent.indexOf('REPO CONNECTION CHANGED MID-CONVERSATION') >= 0, 'the model itself is told the repo changed, not just the user');
  assert(secondTurnSysContent.indexOf('solmasta/AI-Router') >= 0 && secondTurnSysContent.indexOf('solmasta/regtest-repo-b') >= 0, `the warning names both the old and new repo so the model knows exactly what changed (got: ${secondTurnSysContent.slice(0, 400)})`);

  await sendMsg('and now');
  await page.waitForTimeout(300);
  const thirdTurnSysContent = ((repoChangeRequestBodies[2] && repoChangeRequestBodies[2].messages) || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert(thirdTurnSysContent.indexOf('REPO CONNECTION CHANGED') < 0, 'once the tab has caught up to the current repo, a later turn with no further change carries no repeat warning');
  await page.unroute('**/*');

  // Restore the real repo connection for the rest of the suite.
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.fill('#ghOwnerInput', 'solmasta');
  await page.fill('#ghRepoInput', 'AI-Router');
  await page.click('#githubSaveBtn'); await page.waitForTimeout(150);
  await page.locator('#tabBar .tabpill').first().click();
  await page.waitForTimeout(400);

  console.log('\n-- profile: create, isolate --');
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#profileBtn'); await page.waitForTimeout(150);
  await page.fill('#newProfileInput', 'RegressionTest');
  await Promise.all([page.waitForNavigation({ timeout: 8000 }).catch(() => {}), page.click('#addProfileBtn')]);
  await page.waitForTimeout(1200);
  const newProfileIsolated = await page.evaluate(() => document.getElementById('chat').textContent.indexOf('quick test') < 0);
  assert(newProfileIsolated, 'new profile does not see the default profile\'s chat data');
  const profileLabel = await page.textContent('#activeProfileLabel');
  assert(profileLabel.toLowerCase().indexOf('regressiontest') >= 0, `active profile label reflects the new profile (got "${profileLabel}")`);

  console.log('\n-- manual Drive-file import writes straight to localStorage, no API calls --');
  // Recovery path for when Drive itself is rate-limited/disconnected -
  // paste a file's raw content and it's written directly, matching
  // exactly what driveApplyRestoredData would have written from a real
  // Drive download, but with zero network involved.
  const importedProjects = [{ id: 'regtestImported', title: 'Imported Project', instructions: 'regtest imported instructions', createdAt: Date.now(), conversations: [] }];
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#driveManualImportBtn'); await page.waitForTimeout(150);
  await page.selectOption('#driveImportType', 'workprojects');
  await page.fill('#driveImportText', JSON.stringify(importedProjects));
  await Promise.all([page.waitForNavigation({ timeout: 8000 }).catch(() => {}), page.click('#driveManualImportApplyBtn')]);
  await page.waitForTimeout(2000);
  const importedRaw = await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((k) => k.indexOf('ai_workprojects') >= 0)));
  const importedParsed = importedRaw ? JSON.parse(importedRaw) : null;
  assert(importedParsed && importedParsed.length === 1 && importedParsed[0].id === 'regtestImported', `manually imported workprojects data is written to localStorage (got ${importedRaw})`);

  console.log('\n-- Manual import: "Fetch from Drive" guards against an unconnected/expired session --');
  // Fetch from Drive pulls the file straight from the connected folder
  // instead of making the user copy its content out of the Drive app by
  // hand - but this sandbox has no real Google OAuth, so the only
  // reachable path here is the guard: with no Drive connection at all,
  // it must show a toast and leave the textarea untouched rather than silently
  // failing or hanging.
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#driveManualImportBtn'); await page.waitForTimeout(150);
  await page.click('#driveFetchFromDriveBtn');
  await page.waitForTimeout(300);
  const fetchGuardToastMessage = await page.textContent('#msgToastText');
  assert(!!fetchGuardToastMessage && fetchGuardToastMessage.toLowerCase().indexOf('not connected') >= 0, `Fetch from Drive shows a toast when there's no Drive connection (got ${JSON.stringify(fetchGuardToastMessage)})`);
  const importTextAfterFailedFetch = await page.inputValue('#driveImportText');
  assert(importTextAfterFailedFetch === '', 'the textarea stays empty when the fetch is blocked by the connection guard');
  await page.click('#closeDriveManualImportModal'); await page.waitForTimeout(150);

  console.log('\n-- Drive folder can be manually locked by ID, bypassing name-based search --');
  // Name-based folder search is what created a duplicate "ai-router-backups"
  // folder in the first place - pinning an exact folder ID sidesteps that
  // entirely for any device that sets it.
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  page.once('dialog', (dialog) => dialog.accept('https://drive.google.com/drive/folders/regtestFolderId123'));
  await page.click('#driveFolderSetBtn');
  await page.waitForTimeout(200);
  const folderStatusAfterSet = await page.textContent('#driveFolderStatus');
  assert(folderStatusAfterSet.indexOf('regtestFolderId123') >= 0, `folder status reflects the locked-in folder id (got "${folderStatusAfterSet}")`);
  const lockedFolderId = await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((k) => k.indexOf('drive_folder_id') >= 0 && k.indexOf('locked') < 0)));
  assert(lockedFolderId === 'regtestFolderId123', `the extracted folder id (not the full URL) is what gets saved (got "${lockedFolderId}")`);

  console.log('\n-- "Open" jumps straight to the Drive folder instead of making you search for it --');
  // With a folder id already known (just locked in above), Open must deep-
  // link straight to that folder, not a name search - the whole point of
  // this button is skipping the "hunt through Drive for the right folder"
  // step entirely. This sandbox has no egress, so the popup's real
  // navigation to drive.google.com fails instantly and Chromium replaces
  // its url() with chrome-error://chromewebdata/ before we can read it -
  // fulfill the navigation at the context level (covers popups too, unlike
  // page-level routing) so it actually "loads" and keeps the real target URL.
  await page.context().route('https://drive.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>ok</body></html>' }));
  const [popupWithKnownId] = await Promise.all([
    page.waitForEvent('popup'),
    page.click('#driveFolderOpenBtn'),
  ]);
  await popupWithKnownId.waitForLoadState('domcontentloaded').catch(() => {});
  assert(popupWithKnownId.url().indexOf('regtestFolderId123') >= 0, `"Open" in Settings deep-links to the known folder id (got "${popupWithKnownId.url()}")`);
  await popupWithKnownId.close();
  await page.click('#driveManualImportBtn'); await page.waitForTimeout(150);
  const [popupFromImportModal] = await Promise.all([
    page.waitForEvent('popup'),
    page.click('#driveFolderOpenBtn2'),
  ]);
  await popupFromImportModal.waitForLoadState('domcontentloaded').catch(() => {});
  assert(popupFromImportModal.url().indexOf('regtestFolderId123') >= 0, `"Open the Drive folder itself" in Manual import deep-links to the same known folder id (got "${popupFromImportModal.url()}")`);
  await popupFromImportModal.close();
  await page.click('#closeDriveManualImportModal'); await page.waitForTimeout(150);
  // driveManualImportBtn hides Settings underneath before opening its own
  // modal (same pattern as githubConnectBtn), and closing it doesn't
  // reopen Settings - it has to be reopened explicitly to reach
  // driveFolderSetBtn next.
  await page.click('#settingsBtn'); await page.waitForTimeout(150);

  page.once('dialog', (dialog) => dialog.accept(''));
  await page.click('#driveFolderSetBtn');
  await page.waitForTimeout(200);
  const folderStatusAfterClear = await page.textContent('#driveFolderStatus');
  assert(folderStatusAfterClear.indexOf('Auto') >= 0, `clearing the input reverts to automatic folder detection (got "${folderStatusAfterClear}")`);

  const [popupWithNoId] = await Promise.all([
    page.waitForEvent('popup'),
    page.click('#driveFolderOpenBtn'),
  ]);
  await popupWithNoId.waitForLoadState('domcontentloaded').catch(() => {});
  assert(popupWithNoId.url().indexOf('ai-router-backups') >= 0, `with no folder id known, "Open" falls back to a name search instead of a dead link (got "${popupWithNoId.url()}")`);
  await popupWithNoId.close();
  await page.context().unroute('https://drive.google.com/**');

  console.log('\n-- Overseer chat: long-press opens it, a sent message renders and reaches the model with a dedicated system prompt --');
  // Settings was left open by the previous test - it shares the same
  // z-index as the new chat modal and sits later in the DOM, so leaving it
  // open would silently intercept clicks meant for the chat modal
  // underneath (the same class of bug fixed earlier for wprojDetail).
  await page.click('#closeSettingsModal'); await page.waitForTimeout(150);
  // Long-press (500ms hold) on the Overseer button opens the strategy chat,
  // distinct from the quick-tap ON/OFF toggle - dispatch the same
  // mousedown/mouseup timing the real handler listens for.
  await page.dispatchEvent('#overseerBtn', 'mousedown');
  await page.waitForTimeout(700);
  await page.dispatchEvent('#overseerBtn', 'mouseup');
  await page.waitForTimeout(200);
  const overseerChatOpen = await page.evaluate(() => !document.getElementById('overseerChatModal').classList.contains('hidden'));
  assert(overseerChatOpen, 'long-pressing the Overseer button opens the strategy chat modal');

  let lastOverseerChatBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      try {
        const parsed = JSON.parse(req.postData());
        if (parsed.messages && parsed.messages.some((m) => typeof m.content === 'string' && m.content.indexOf('strategic advisor') >= 0)) {
          lastOverseerChatBody = parsed;
        }
      } catch (e) {}
    }
    await route.continue();
  });
  await page.fill('#overseerChatInput', 'regtest strategy question, what should I try next');
  await page.click('#overseerChatSendBtn');
  for (let i = 0; i < 60 && lastOverseerChatBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const overseerChatUserBubbleShown = await page.evaluate(() => document.getElementById('overseerChatLog').textContent.indexOf('regtest strategy question') >= 0);
  assert(overseerChatUserBubbleShown, 'sent strategy question renders in the Overseer chat log');
  assert(!!lastOverseerChatBody, 'the strategy question reaches the model tagged with the Overseer\'s own dedicated system prompt, not the main chat one');
  await page.waitForTimeout(1500); // let the failed (no-egress) request settle into its error state
  await page.click('#closeOverseerChatModal'); await page.waitForTimeout(150);
  const overseerChatClosed = await page.evaluate(() => document.getElementById('overseerChatModal').classList.contains('hidden'));
  assert(overseerChatClosed, 'Overseer chat modal closes via its close button');

  console.log('\n-- Overseer chat gets the same generous max_tokens as the coding agent when repo tools are actually offered --');
  // Same truncation risk as runCodingAgentRound above - this side-panel can
  // also call write_file (overseerHasRepoTools), so a repo-relevant
  // question here must get the same headroom, not the smaller budget only
  // meant for the trivial app-control tool calls this loop also handles.
  // Explicit setup rather than assuming GH/model state survived from far
  // earlier tests - overseerHasRepoTools needs both a connected repo AND
  // a tool-capable current model (confirmed tool-capable elsewhere in this
  // file, e.g. the fallback-model test's app-control tool round).
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.fill('#ghOwnerInput', 'solmasta');
  await page.fill('#ghRepoInput', 'AI-Router');
  await page.fill('#ghWriteSecretInput', 'regtest-write-secret');
  await page.click('#githubSaveBtn'); await page.waitForTimeout(300);
  // Saving already closes the Settings modal (same as the earlier "Coding
  // tab reaches..." test, which doesn't click a separate close button
  // either) - a redundant closeSettingsModal click here just times out
  // waiting for a button that's already hidden.
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.locator('.mc:has-text("Mistral Small")').first().click();
  await page.waitForTimeout(150);
  await page.dispatchEvent('#overseerBtn', 'mousedown');
  await page.waitForTimeout(700);
  await page.dispatchEvent('#overseerBtn', 'mouseup');
  await page.waitForTimeout(200);
  let overseerChatRepoToolsBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.messages && parsed.messages.some((m) => typeof m.content === 'string' && m.content.indexOf('strategic advisor') >= 0)) {
        overseerChatRepoToolsBody = parsed;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest overseer repo answer' } }] }) });
        return;
      }
    }
    await route.continue();
  });
  await page.fill('#overseerChatInput', 'please read a file from the github repo for me');
  await page.click('#overseerChatSendBtn');
  for (let i = 0; i < 40 && overseerChatRepoToolsBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  assert(!!overseerChatRepoToolsBody, 'test setup: the repo-relevant Overseer chat question actually reached the tool round');
  const overseerChatToolNames = ((overseerChatRepoToolsBody && overseerChatRepoToolsBody.tools) || []).map((t) => t.function.name);
  assert(overseerChatToolNames.indexOf('write_file') >= 0, `test setup: repo tools (including write_file) were actually offered (got tools: ${JSON.stringify(overseerChatToolNames)})`);
  assert(overseerChatRepoToolsBody.max_tokens >= 8000, `the Overseer chat gets enough max_tokens for a real file write when repo tools are offered (got ${overseerChatRepoToolsBody.max_tokens})`);
  await page.click('#closeOverseerChatModal'); await page.waitForTimeout(150);

  console.log('\n-- write_file tool never defaults to main/master, and the approved branch is what actually reaches the worker --');
  // write_file used to have no branch parameter at all - the ops worker
  // defaulted every write straight onto the repo's default branch, and
  // nothing in the approval dialog said so. This mocks the coding agent's
  // tool_call for write_file with no branch specified and checks the whole
  // path: the approval dialog must default to a non-main working branch,
  // and that same branch (not "main") must be what's actually POSTed to
  // the GitHub ops worker once approved.
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.fill('#ghOwnerInput', 'solmasta');
  await page.fill('#ghRepoInput', 'openai-router');
  // write_file/merge_branch now also require a separate write secret
  // (never auto-fetched, entered here the same way a real user would) -
  // without it executeRepoTool short-circuits before ever reaching the
  // GitHub ops worker, which the rest of this block and the merge_branch
  // and Overseer-chat write_file blocks below (same connection, reused)
  // depend on actually happening.
  await page.fill('#ghWriteSecretInput', 'regtest-write-secret');
  await page.click('#githubSaveBtn'); await page.waitForTimeout(150);
  // githubConnectBtn hides Settings underneath before opening its own
  // modal (see its click handler) and Save & Connect only closes that
  // sub-modal, so Settings is already out of the way here - nothing left
  // to close.

  let capturedWriteBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.indexOf('github-ops-worker') >= 0 && req.method() === 'POST') {
      try { capturedWriteBody = JSON.parse(req.postData()); } catch (e) {}
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, commit: 'regtestcommitsha', branch: capturedWriteBody && capturedWriteBody.branch }),
      });
      return;
    }
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        // Fake a coding-agent response that calls write_file with NO
        // branch specified, the exact case that used to silently land on
        // the default branch.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            choices: [{
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                tool_calls: [{
                  id: 'regtest_call_1',
                  type: 'function',
                  function: { name: 'write_file', arguments: JSON.stringify({ path: 'regtest.txt', content: 'hello world', message: 'regtest commit' }) },
                }],
              },
            }],
          }),
        });
        return;
      }
    }
    await route.continue();
  });
  await page.fill('#prompt', 'please create a new file in the github repo, hello world content');
  await page.click('#sendBtn');
  let confirmShowed = false;
  for (let i = 0; i < 100; i++) {
    await dismissConfirmIfAny();
    confirmShowed = await page.evaluate(() => !document.getElementById('githubWriteConfirmModal').classList.contains('hidden'));
    if (confirmShowed) break;
    await page.waitForTimeout(200);
  }
  assert(confirmShowed, 'a model-issued write_file tool call surfaces the approval dialog');
  const branchDefaultForNoBranch = await page.inputValue('#ghwBranch');
  assert(branchDefaultForNoBranch === 'ai-changes', `a write_file call with no branch specified defaults the approval dialog to a non-main working branch (got "${branchDefaultForNoBranch}")`);
  await page.click('#ghwApproveBtn');
  await waitForSendDone();
  await page.unroute('**/*');
  assert(!!capturedWriteBody, 'approving the write actually reaches the GitHub ops worker');
  assert(capturedWriteBody && capturedWriteBody.branch === 'ai-changes', `the approved branch (not "main") is what's actually sent to the worker (got "${capturedWriteBody && capturedWriteBody.branch}")`);
  const continueBtnAfterWrite = await page.evaluate(() => {
    const bodies = document.querySelectorAll('#chat .msg.ma3 .body');
    const last = bodies[bodies.length - 1];
    return last ? !!last.parentElement.querySelector('button') : false;
  });
  assert(continueBtnAfterWrite, 'a Continue button appears after the step instead of automatically starting another round');

  console.log('\n-- the Terminal panel logs the actual write_file call, result, and content separately from the chat, with no button to open it --');
  // A real user asked for a live view of what's actually being read/
  // written, distinct from the conversational summary in chat bubbles -
  // and then asked for it to just always be there instead of gated behind
  // a button/modal. The panel should already be visible (no click needed)
  // once repo activity has happened, and its log (a completely separate
  // DOM tree from #chat) should show the tool call, its outcome, and the
  // real file content.
  const terminalPanelVisibleAfterWrite = await page.evaluate(() => !document.getElementById('terminalPanel').classList.contains('hidden'));
  assert(terminalPanelVisibleAfterWrite, 'the Terminal panel is already visible once a repo write has actually happened - no button/click needed');
  const terminalLogText = await page.evaluate(() => document.getElementById('terminalLog').textContent);
  assert(terminalLogText.indexOf('write_file regtest.txt') >= 0, `the terminal log shows the actual write_file call (got: ${terminalLogText.slice(0, 300)})`);
  assert(terminalLogText.indexOf('committed regtest') >= 0, `the terminal log shows the commit result (got: ${terminalLogText.slice(0, 300)})`);
  assert(terminalLogText.indexOf('hello world') >= 0, 'the terminal log shows the actual file content that was written, not just a summary');
  const chatTextHasNoTerminalMarkup = await page.evaluate(() => document.getElementById('chat').textContent.indexOf('$ write_file') < 0);
  assert(chatTextHasNoTerminalMarkup, 'the terminal-style log lives in its own panel, not dumped into the chat transcript');

  console.log('\n-- merge_branch tool requires its own approval dialog, and the approved branch/op reach the worker --');
  // merge_branch touches the repo's actual default branch - a materially
  // higher-stakes action than write_file - so it gets its own dedicated
  // confirm modal (githubMergeConfirmModal) instead of reusing
  // githubWriteConfirmModal. Verify the coding agent's tool_call surfaces
  // that dialog, and that approving it sends the right op/branch to the
  // GitHub ops worker.
  let capturedMergeBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.indexOf('github-ops-worker') >= 0 && req.method() === 'POST') {
      try { capturedMergeBody = JSON.parse(req.postData()); } catch (e) {}
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, prNumber: 42, prUrl: 'https://github.com/solmasta/openai-router/pull/42', merged: true, sha: 'regtestmergesha' }),
      });
      return;
    }
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        // Fake a coding-agent response that calls merge_branch for a
        // fixed branch name.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            choices: [{
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                tool_calls: [{
                  id: 'regtest_call_2',
                  type: 'function',
                  function: { name: 'merge_branch', arguments: JSON.stringify({ branch: 'ai-changes', title: 'regtest merge', message: 'regtest merge body' }) },
                }],
              },
            }],
          }),
        });
        return;
      }
    }
    await route.continue();
  });
  await page.fill('#prompt', 'please merge the ai-changes branch into main now');
  await page.click('#sendBtn');
  let mergeConfirmShowed = false;
  for (let i = 0; i < 100; i++) {
    await dismissConfirmIfAny();
    mergeConfirmShowed = await page.evaluate(() => !document.getElementById('githubMergeConfirmModal').classList.contains('hidden'));
    if (mergeConfirmShowed) break;
    await page.waitForTimeout(200);
  }
  assert(mergeConfirmShowed, 'a model-issued merge_branch tool call surfaces its own dedicated approval dialog');
  const mergeBranchShown = await page.evaluate(() => document.getElementById('ghmBranch').textContent);
  assert(mergeBranchShown.indexOf('ai-changes') >= 0, `the confirm dialog shows the branch being merged (got "${mergeBranchShown}")`);
  await page.click('#ghmApproveBtn');
  await waitForSendDone();
  await page.unroute('**/*');
  assert(!!capturedMergeBody, 'approving the merge actually reaches the GitHub ops worker');
  assert(capturedMergeBody && capturedMergeBody.op === 'merge_branch', `the worker request is tagged with the merge_branch op (got "${capturedMergeBody && capturedMergeBody.op}")`);
  assert(capturedMergeBody && capturedMergeBody.branch === 'ai-changes', `the branch sent to the worker matches what was requested (got "${capturedMergeBody && capturedMergeBody.branch}")`);
  // waitForSendDone() above returns as soon as the Send button label flips
  // back, but autosave/tab-sync work triggered by the merge response can
  // still be settling - give it a beat before the next test starts
  // interacting, same as the settle wait already used after the Overseer
  // chat's failed (no-egress) request above.
  await page.waitForTimeout(500);

  console.log('\n-- Overseer chat can also call repo tools directly, same TOOL_MODELS/approval gates as the main chat --');
  // The Overseer's own side-channel chat used to have zero tool access at
  // all - pure advice text. This checks it can now actually drive a
  // write_file tool_call end to end: the same approval dialog still shows
  // (no bypass just because the request came from the Overseer instead of
  // the main chat), the write still reaches the GitHub ops worker once
  // approved, and the tool-execution notice lands in the Overseer's own
  // chat log (overseerChatLog), not the main chat log.
  // The Overseer chat's own tool access is still gated on the main chat's
  // currentModel being in TOOL_MODELS (unlike the main chat's repo work,
  // this side-channel wasn't moved onto the dedicated coding agent) -
  // force a known tool-capable model explicitly rather than relying on
  // whatever an earlier test happened to leave selected - the auto-router
  // could have drifted to any backend by this point, and the model modal
  // opens showing whichever backend tab is already active, not
  // necessarily DeepInfra's.
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.click('#deepinfraBtn'); await page.waitForTimeout(150);
  await page.locator('.mc:has-text("Mistral Small")').first().click();
  await page.waitForTimeout(150);
  await page.dispatchEvent('#overseerBtn', 'mousedown');
  await page.waitForTimeout(700);
  await page.dispatchEvent('#overseerBtn', 'mouseup');
  await page.waitForTimeout(200);

  let capturedOverseerWriteBody = null;
  let overseerToolRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.indexOf('github-ops-worker') >= 0 && req.method() === 'POST') {
      try { capturedOverseerWriteBody = JSON.parse(req.postData()); } catch (e) {}
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, commit: 'regtestoverseersha', branch: capturedOverseerWriteBody && capturedOverseerWriteBody.branch }),
      });
      return;
    }
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === false) {
        overseerToolRoundCount++;
        if (overseerToolRoundCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              choices: [{
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  tool_calls: [{
                    id: 'regtest_overseer_call_1',
                    type: 'function',
                    function: { name: 'write_file', arguments: JSON.stringify({ path: 'regtest-overseer-file.txt', content: 'hello from overseer', message: 'regtest overseer commit' }) },
                  }],
                },
              }],
            }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest overseer done' } }] }),
        });
        return;
      }
      if (parsed && parsed.stream === true) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n',
        });
        return;
      }
    }
    await route.continue();
  });
  await page.fill('#overseerChatInput', 'please write a small file to the repo for me');
  await page.click('#overseerChatSendBtn');
  let overseerWriteConfirmShowed = false;
  for (let i = 0; i < 100; i++) {
    overseerWriteConfirmShowed = await page.evaluate(() => !document.getElementById('githubWriteConfirmModal').classList.contains('hidden'));
    if (overseerWriteConfirmShowed) break;
    await page.waitForTimeout(200);
  }
  assert(overseerWriteConfirmShowed, 'a write_file tool_call from the Overseer chat surfaces the same approval dialog as the main chat');
  await page.click('#ghwApproveBtn');
  for (let i = 0; i < 100 && capturedOverseerWriteBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  assert(!!capturedOverseerWriteBody, 'approving it actually reaches the GitHub ops worker, same as a main-chat-issued write_file');
  assert(capturedOverseerWriteBody && capturedOverseerWriteBody.path === 'regtest-overseer-file.txt', `the file path requested by the Overseer is what's actually sent to the worker (got "${capturedOverseerWriteBody && capturedOverseerWriteBody.path}")`);
  await page.waitForTimeout(300);
  const overseerLogHasToolNotice = await page.evaluate(() => document.getElementById('overseerChatLog').textContent.indexOf('regtest-overseer-file.txt') >= 0);
  assert(overseerLogHasToolNotice, 'the tool-execution notice renders in the Overseer\'s own chat log, not just the main chat log');
  await page.waitForTimeout(500);
  await page.click('#closeOverseerChatModal'); await page.waitForTimeout(150);

  console.log('\n-- Overseer chat withholds repo tools for a strategy question with no actual repo/GitHub signal --');
  // Same relevance gate as the main chat: GitHub being connected must not
  // be enough on its own to hand the Overseer read_file/write_file/
  // merge_branch for a question that has nothing to do with the connected
  // repo (e.g. talking through a brand new, unrelated app idea).
  await page.dispatchEvent('#overseerBtn', 'mousedown');
  await page.waitForTimeout(700);
  await page.dispatchEvent('#overseerBtn', 'mouseup');
  await page.waitForTimeout(200);
  let lastOverseerUnrelatedBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      try {
        const parsed = JSON.parse(req.postData());
        if (parsed.messages) lastOverseerUnrelatedBody = parsed;
      } catch (e) {}
    }
    await route.continue();
  });
  await page.fill('#overseerChatInput', 'I want to start a brand new app idea, any thoughts on the concept?');
  await page.click('#overseerChatSendBtn');
  for (let i = 0; i < 60 && lastOverseerUnrelatedBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const overseerUnrelatedToolNames = ((lastOverseerUnrelatedBody && lastOverseerUnrelatedBody.tools) || []).map((t) => t.function.name);
  assert(overseerUnrelatedToolNames.indexOf('read_file') < 0 && overseerUnrelatedToolNames.indexOf('write_file') < 0 && overseerUnrelatedToolNames.indexOf('list_files') < 0 && overseerUnrelatedToolNames.indexOf('merge_branch') < 0, `an Overseer strategy question with no repo/GitHub signal gets no repo tools even with GitHub connected (got tools: ${JSON.stringify(overseerUnrelatedToolNames)})`);
  await page.waitForTimeout(300);
  await page.click('#closeOverseerChatModal'); await page.waitForTimeout(150);

  console.log('\n-- Overseer chat\'s code-signal keywords are word-boundary matched, not substring - an unrelated word containing one doesn\'t grant repo tools --');
  // analyzeTask's code-keyword list used to match with a plain indexOf,
  // so "react" matched inside "overreacted", "code" matched inside "zip
  // code"/"decode" - completely unrelated messages could still light up
  // tasks.code and get read_file/write_file/merge_branch offered. This
  // message hits exactly that old substring trap ("react" inside
  // "overreacted") and nothing else - it must not qualify for repo tools.
  await page.dispatchEvent('#overseerBtn', 'mousedown');
  await page.waitForTimeout(700);
  await page.dispatchEvent('#overseerBtn', 'mouseup');
  await page.waitForTimeout(200);
  let lastOverseerSubstringBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      try {
        const parsed = JSON.parse(req.postData());
        if (parsed.messages) lastOverseerSubstringBody = parsed;
      } catch (e) {}
    }
    await route.continue();
  });
  await page.fill('#overseerChatInput', 'I overreacted about something today, any advice?');
  await page.click('#overseerChatSendBtn');
  for (let i = 0; i < 60 && lastOverseerSubstringBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const overseerSubstringToolNames = ((lastOverseerSubstringBody && lastOverseerSubstringBody.tools) || []).map((t) => t.function.name);
  assert(overseerSubstringToolNames.indexOf('read_file') < 0 && overseerSubstringToolNames.indexOf('write_file') < 0 && overseerSubstringToolNames.indexOf('list_files') < 0 && overseerSubstringToolNames.indexOf('merge_branch') < 0, `"react" appearing inside "overreacted" must not be treated as a code signal (got tools: ${JSON.stringify(overseerSubstringToolNames)})`);
  await page.waitForTimeout(300);
  await page.click('#closeOverseerChatModal'); await page.waitForTimeout(150);

  console.log('\n-- Overseer chat requires more than one incidental code-keyword hit before granting repo tools --');
  // Unlike a real github keyword (worth +2 on its own), each code keyword
  // is only worth +1 - a single one showing up once in an otherwise
  // unrelated message ("bug" in a non-coding complaint) shouldn't be
  // enough by itself to hand out repo write access. Requires >= 2 hits.
  await page.dispatchEvent('#overseerBtn', 'mousedown');
  await page.waitForTimeout(700);
  await page.dispatchEvent('#overseerBtn', 'mouseup');
  await page.waitForTimeout(200);
  let lastOverseerSingleHitBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      try {
        const parsed = JSON.parse(req.postData());
        if (parsed.messages) lastOverseerSingleHitBody = parsed;
      } catch (e) {}
    }
    await route.continue();
  });
  await page.fill('#overseerChatInput', 'there is a bug I keep running into with my sleep schedule');
  await page.click('#overseerChatSendBtn');
  for (let i = 0; i < 60 && lastOverseerSingleHitBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const overseerSingleHitToolNames = ((lastOverseerSingleHitBody && lastOverseerSingleHitBody.tools) || []).map((t) => t.function.name);
  assert(overseerSingleHitToolNames.indexOf('read_file') < 0 && overseerSingleHitToolNames.indexOf('write_file') < 0 && overseerSingleHitToolNames.indexOf('list_files') < 0 && overseerSingleHitToolNames.indexOf('merge_branch') < 0, `a single incidental code-keyword hit ("bug") with no other signal must not be enough on its own to grant repo tools (got tools: ${JSON.stringify(overseerSingleHitToolNames)})`);
  await page.waitForTimeout(300);
  await page.click('#closeOverseerChatModal'); await page.waitForTimeout(150);

  console.log('\n-- coding agent runs one step at a time, waiting for Continue before the next tool call --');
  // The coding agent never auto-chains multiple tool rounds in one burst -
  // each round stops after executing whatever tool_calls came back and
  // shows a Continue button; the NEXT round (e.g. read_file right after
  // list_files) only fires once the user actually taps it. Mock round 1
  // (list_files), confirm read_file has NOT fired yet, click Continue,
  // confirm round 2 (read_file) then fires, click Continue again, confirm
  // the final text round completes and renders.
  let codingRoundCount = 0;
  let sawListFilesCall = false;
  let sawReadFileCall = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.indexOf('github-ops-worker') >= 0 && req.method() === 'POST') {
      let opBody = null;
      try { opBody = JSON.parse(req.postData()); } catch (e) {}
      if (opBody && opBody.op === 'list_files') sawListFilesCall = true;
      if (opBody && opBody.op === 'read_file') sawReadFileCall = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, files: [{ name: 'index.html', type: 'file', path: 'index.html' }], content: 'regtest file content' }),
      });
      return;
    }
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        codingRoundCount++;
        if (codingRoundCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 'regtest_round1', type: 'function', function: { name: 'list_files', arguments: JSON.stringify({}) } }] } }] }),
          });
          return;
        }
        if (codingRoundCount === 2) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 'regtest_round2', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'index.html' }) } }] } }] }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest coding agent done' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please read the readme after listing the repo');
  assert(sawListFilesCall, 'round 1 calls list_files');
  assert(!sawReadFileCall, 'read_file has NOT been called yet - the agent stopped after round 1 instead of auto-chaining to the next tool call');
  // Continue clicks don't touch #sendBtn (that only reflects the main
  // send() flow) - poll the actual expected side effect of each round
  // instead of waitForSendDone(), which would return immediately here.
  const continueBtnAfterRound1 = await page.locator('#chat .msg.ma3 button:has-text("Continue")').last();
  await continueBtnAfterRound1.click();
  for (let i = 0; i < 60 && !sawReadFileCall; i++) await page.waitForTimeout(200);
  assert(sawReadFileCall, 'clicking Continue actually triggers round 2, which calls read_file');
  const continueBtnAfterRound2 = await page.locator('#chat .msg.ma3 button:has-text("Continue")').last();
  await continueBtnAfterRound2.click();
  // codingRoundCount ticks up as soon as the mocked request lands, but
  // rendering the final text happens after that response is parsed - wait
  // for the actual rendered text, not just the request having fired.
  let chatTextAfterCodingRounds = '';
  for (let i = 0; i < 60; i++) {
    chatTextAfterCodingRounds = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextAfterCodingRounds.indexOf('regtest coding agent done') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(codingRoundCount === 3, `exactly 3 coding-agent rounds ran, one per Continue click plus the initial send (got ${codingRoundCount})`);
  assert(chatTextAfterCodingRounds.indexOf('regtest coding agent done') >= 0, "the final round's plain-text answer renders once the agent stops calling tools");

  console.log('\n-- asking the coding agent to go "on your own" auto-chains rounds instead of requiring a Continue click each time --');
  // A real user report: the agent kept asking for a manual Continue tap
  // between every single file even after being told "check everything on
  // your own without doing one by one" - the model has no way to honor
  // that itself since the app was the one forcing a click between rounds.
  // looksLikeAutoContinueRequest should catch this phrasing on the
  // message that starts the coding-agent turn and auto-chain the
  // tool-call rounds with no clicks needed, stopping once the agent
  // returns a final plain-text answer.
  let autoContinueRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        autoContinueRoundCount++;
        if (autoContinueRoundCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 'regtest_auto1', type: 'function', function: { name: 'list_files', arguments: JSON.stringify({}) } }] } }] }),
          });
          return;
        }
        if (autoContinueRoundCount === 2) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 'regtest_auto2', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'index.html' }) } }] } }] }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest auto-continue done' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  // Deliberately not using the sendMsg() helper here (fill+click+wait for
  // "Send" to reappear) - the whole point of this check is to look at
  // Send's state WHILE the chain is still mid-flight, between round 1 and
  // round 2. The recursive round-2/round-3 calls used to be fire-and-forget
  // (no return/await), so the promise driving doSendRequest's own
  // `finally{sending=false...}` resolved after just round 1, and Send
  // silently flipped back to its idle label while the agent kept working
  // in the background - nothing then stopped a second message from being
  // sent mid-chain, doubling up concurrent requests against the same API
  // (traced back from a real report of the coding agent getting stuck in a
  // repeating "Rate-limited... tap Retry" loop). Send must stay in its
  // busy state for the whole chain now, not just the first round.
  await page.fill('#prompt', 'please go through every file in the repo on your own without doing one by one, and let me know when you are done');
  await page.click('#sendBtn');
  // Polls for the busy label instead of snapshotting at one fixed delay -
  // sending=true is set synchronously on click, well before round 1 even
  // starts, so this should resolve almost immediately under normal
  // conditions; polling (rather than a single 300ms snapshot) absorbs
  // occasional scheduling jitter this deep into a long-running suite
  // without weakening what's actually being checked - it still exits the
  // instant busy state is observed, long before round 2 could plausibly
  // have completed and gone idle again.
  let sendBtnTextMidChain = '';
  let sawBusyState = false;
  for (let i = 0; i < 10; i++) {
    sendBtnTextMidChain = await page.textContent('#sendBtn');
    if (sendBtnTextMidChain.indexOf('Send') === -1) { sawBusyState = true; break; }
    await page.waitForTimeout(50);
  }
  assert(sawBusyState, `Send stays in its busy state mid-chain (after round 1, before round 2 has fired) instead of falsely reporting idle (got "${sendBtnTextMidChain}" after ~500ms, rounds so far: ${autoContinueRoundCount})`);
  let chatTextAfterAutoContinue = '';
  for (let i = 0; i < 60; i++) {
    chatTextAfterAutoContinue = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextAfterAutoContinue.indexOf('regtest auto-continue done') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  await waitForSendDone();
  const sendBtnTextAfterChainDone = await page.textContent('#sendBtn');
  assert(sendBtnTextAfterChainDone.indexOf('Send') >= 0, `Send returns to idle only once the whole auto-continue chain actually finishes (got "${sendBtnTextAfterChainDone}")`);
  assert(autoContinueRoundCount === 3, `all 3 rounds fired automatically with no Continue click (got ${autoContinueRoundCount} rounds)`);
  assert(chatTextAfterAutoContinue.indexOf('regtest auto-continue done') >= 0, "the final round's plain-text answer renders once the agent stops calling tools on its own");
  assert(chatTextAfterAutoContinue.indexOf('Stop') >= 0, 'a Stop control is offered while auto-continuing, in case the user wants to interrupt it');

  console.log('\n-- auto-continue pauses instead of repeating a stuck round forever --');
  // A real user report: a tool call that keeps failing the same way
  // produced a wall of near-identical "I couldn't inspect the repository
  // files." bubbles instead of stopping - auto-continue used to just keep
  // chaining up to CODING_AGENT_MAX_AUTO_ROUNDS with no check that a round
  // actually made progress. Two consecutive rounds with the same tool call
  // and the same (failing) outcome must pause auto-continue and fall back
  // to a manual Continue button instead of repeating a third time.
  let stuckRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        stuckRoundCount++;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 'regtest_stuck_' + stuckRoundCount, type: 'function', function: { name: 'list_files', arguments: JSON.stringify({}) } }] } }] }),
        });
        return;
      }
      if (req.url().indexOf('github-ops-worker') >= 0) {
        // Same failure every round (deterministic, unlike this sandbox's
        // real network failures) so the round's outcome text is identical
        // each time - exactly the "stuck" case this test is checking for.
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'regtest simulated repo failure' }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please go through the whole repo on your own without doing one by one');
  let chatTextWhileStuck = '';
  for (let i = 0; i < 60; i++) {
    chatTextWhileStuck = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextWhileStuck.indexOf('paused instead of repeating it automatically') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(stuckRoundCount <= 3, `a round repeating the exact same failing tool call pauses auto-continue within a couple of rounds instead of chaining all the way to the auto-round cap (got ${stuckRoundCount} rounds)`);
  assert(chatTextWhileStuck.indexOf('paused instead of repeating it automatically') >= 0, `a note explains why auto-continue paused instead of just silently offering Continue (got: ${chatTextWhileStuck.slice(-300)})`);
  const stuckContinueVisible = await page.evaluate(() => !!document.querySelector('#chat .msg.ma3 button.cta'));
  assert(stuckContinueVisible, 'a manual Continue button is still offered after pausing, so the user can push through if they want to');

  console.log('\n-- a coding-agent round that comes back genuinely empty gets one automatic retry too --');
  // The dedicated coding agent now sees plain conversational messages too
  // (via a Coding tab, which routes everything there regardless of repo
  // signal) - a model this heavily framed as a repo-focused agent can
  // come back with truly empty content for something like "good
  // morning" instead of just answering it. Round 1 returns empty;
  // confirm a round 2 fires automatically with a corrective nudge, and
  // round 2's real answer renders instead of "(no response)".
  let emptyCodingRoundCount = 0;
  let emptyRoundSawCorrectiveNudge = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        emptyCodingRoundCount++;
        if (emptyCodingRoundCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }] }),
          });
          return;
        }
        emptyRoundSawCorrectiveNudge = (parsed.messages || []).some(m => m.role === 'user' && typeof m.content === 'string' && m.content.indexOf('came back empty') >= 0);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest real answer after empty retry' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please check the repo and tell me what it does');
  let chatTextAfterEmptyRetry = '';
  for (let i = 0; i < 60; i++) {
    chatTextAfterEmptyRetry = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextAfterEmptyRetry.indexOf('regtest real answer after empty retry') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(emptyCodingRoundCount === 2, `a genuinely empty round triggers exactly one automatic retry round (got ${emptyCodingRoundCount} rounds)`);
  assert(emptyRoundSawCorrectiveNudge, 'the retry round includes a corrective nudge telling the model it came back empty');
  assert(chatTextAfterEmptyRetry.indexOf('(no response)') === -1, 'the empty round never renders as "(no response)" once the retry succeeds');
  assert(chatTextAfterEmptyRetry.indexOf('regtest real answer after empty retry') >= 0, 'the real answer from the retry round renders once it comes back');

  console.log('\n-- after a no-response round, tapping Continue starts a fresh round that can auto-retry empty output again --');
  // A real failure mode: one round exhausts its single empty retry, renders
  // "(no response)", and the user taps Continue. That next round used to
  // inherit emptyRetried=true, so it would never auto-retry empties again and
  // could get stuck repeatedly returning "(no response)". Confirm Continue
  // starts a fresh round where the empty corrective nudge can fire again.
  let continueEmptyRoundCount = 0;
  let continueRoundSawSecondCorrectiveNudge = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        continueEmptyRoundCount++;
        if (continueEmptyRoundCount <= 3) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }] }),
          });
          return;
        }
        continueRoundSawSecondCorrectiveNudge = (parsed.messages || []).some(m => m.role === 'user' && typeof m.content === 'string' && m.content.indexOf('came back empty') >= 0);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest continue recovered after second empty retry' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please check the repo one step at a time');
  for (let i = 0; i < 60; i++) {
    const noResponseContinueBtn = await page.locator('#chat .msg.ma3 button:has-text("Continue")').last();
    if (await noResponseContinueBtn.count()) {
      await noResponseContinueBtn.click();
      break;
    }
    await page.waitForTimeout(200);
  }
  let chatTextAfterContinueEmptyRecovery = '';
  for (let i = 0; i < 60; i++) {
    chatTextAfterContinueEmptyRecovery = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextAfterContinueEmptyRecovery.indexOf('regtest continue recovered after second empty retry') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(continueEmptyRoundCount === 4, `empty output still gets one retry after tapping Continue on a prior no-response round (got ${continueEmptyRoundCount} rounds)`);
  assert(continueRoundSawSecondCorrectiveNudge, 'the post-Continue retry round includes the same empty-output corrective nudge');
  assert(chatTextAfterContinueEmptyRecovery.indexOf('regtest continue recovered after second empty retry') >= 0, 'the post-Continue retry eventually renders the recovered answer');

  console.log('\n-- a coding-agent reply that writes out a fake tool call as plain text gets one automatic retry instead of being shown as-is --');
  // The dedicated coding agent model sometimes comes back with
  // finish_reason "stop" and content that's pseudo-code narrating a tool
  // call (tool_code / print(read_file(...)) / <tool_call>) instead of a
  // real tool_calls entry - nothing actually ran, so showing that text as
  // the final answer is how "I only have read-only access" reports happen
  // even though the tool would have worked. Round 1 returns fake
  // pseudo-code; confirm it does NOT render as the final answer and a
  // round 2 fires automatically with a corrective nudge in its messages;
  // round 2 returns a real answer, which should render normally.
  let fakeToolCallRoundCount = 0;
  let secondRoundSawCorrectiveNudge = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        fakeToolCallRoundCount++;
        if (fakeToolCallRoundCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'tool_code\nprint(read_file(path="README.md"))' } }] }),
          });
          return;
        }
        secondRoundSawCorrectiveNudge = (parsed.messages || []).some(m => m.role === 'user' && typeof m.content === 'string' && m.content.indexOf("wasn't a real tool call") >= 0);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest real answer after retry' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please check the repo and tell me what it does');
  let chatTextAfterFakeToolCallRetry = '';
  for (let i = 0; i < 60; i++) {
    chatTextAfterFakeToolCallRetry = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextAfterFakeToolCallRetry.indexOf('regtest real answer after retry') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(fakeToolCallRoundCount === 2, `fake pseudo-code triggers exactly one automatic retry round (got ${fakeToolCallRoundCount} rounds)`);
  assert(secondRoundSawCorrectiveNudge, 'the retry round includes a corrective nudge telling the model to make a real tool call instead of writing it as text');
  assert(chatTextAfterFakeToolCallRetry.indexOf('tool_code') === -1, 'the fake pseudo-code from round 1 never renders as the final answer');
  assert(chatTextAfterFakeToolCallRetry.indexOf('regtest real answer after retry') >= 0, 'the real answer from the retry round renders once it comes back');

  console.log('\n-- a coding-agent reply that keeps writing fake tool calls even after the retry nudge is shown as-is instead of retrying forever --');
  // Capped at exactly one retry per round - no fallback model exists for
  // the coding agent to switch to, so a model that just won't emit a real
  // tool call for this input should degrade to showing its text rather
  // than looping.
  let stubbornFakeToolCallRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        stubbornFakeToolCallRoundCount++;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'tool_code\nprint(list_files())' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please check the repo again');
  let chatTextAfterStubbornFakeToolCall = '';
  for (let i = 0; i < 60; i++) {
    chatTextAfterStubbornFakeToolCall = await page.evaluate(() => document.getElementById('chat').textContent);
    if (stubbornFakeToolCallRoundCount >= 2 && chatTextAfterStubbornFakeToolCall.indexOf('tool_code') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(stubbornFakeToolCallRoundCount === 2, `still capped at exactly one retry even when the retry also comes back fake (got ${stubbornFakeToolCallRoundCount} rounds)`);
  assert(chatTextAfterStubbornFakeToolCall.indexOf('tool_code') >= 0, 'after the single retry is exhausted, the fake text is shown as-is instead of retrying again');

  console.log('\n-- once a fake tool-call has happened, later rounds carry a persistent reminder, not just a one-shot in-round retry --');
  // A real user report: the model dumped <tool_call><function=write_file>
  // syntax as literal chat text across several SEPARATE sends in the same
  // Coding tab (each one silently failing to actually write the file it
  // claimed to) - the one-shot in-round retry above only corrects the
  // model for that round; a brand new message rebuilds the system prompt
  // from scratch and forgets it. codingAgentFakeToolSeen should now be
  // true from the test just above, so a fresh message's system prompt
  // must carry the persistent reminder.
  let persistentFakeToolReminderBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        persistentFakeToolReminderBody = parsed;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest fresh session answer' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  // Needs an explicit repo/github keyword (analyzeTask's githubKeywords) to
  // route to the coding agent here - unlike "please check the repo again"
  // in the test above, plain "check one more file" matches neither that
  // nor looksLikeContinuationRequest's narrower phrase list, so it never
  // even reached the coding agent (a test-wording bug, not an app one).
  await sendMsg('please check another file in the repo');
  for (let i = 0; i < 40 && persistentFakeToolReminderBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const persistentFakeToolReminderSeen = !!(persistentFakeToolReminderBody && persistentFakeToolReminderBody.messages && persistentFakeToolReminderBody.messages.some((m) => m.role === 'system' && typeof m.content === 'string' && m.content.indexOf('wrote out tool-call syntax as literal text') >= 0));
  assert(persistentFakeToolReminderSeen, `a fresh message in the same tab carries a persistent reminder not to repeat the fake-tool-call mistake, not just a one-shot in-round retry (got system messages: ${JSON.stringify((persistentFakeToolReminderBody && persistentFakeToolReminderBody.messages || []).filter((m) => m.role === 'system').map((m) => (m.content || '').slice(0, 80)))})`);

  console.log('\n-- a coding-agent reply that falsely claims it has no tool access gets one automatic retry instead of being shown as fact --');
  // A real transcript: after an earlier hiccup, the model flatly claimed
  // "I don't actually have the ability to check the repository contents"
  // and "I haven't actually performed any of those file operations" -
  // directly contradicting real read_file/write_file calls already
  // visible earlier in the SAME conversation. Reaching this code path at
  // all already proves repo tools are live and authenticated, so this is
  // always a hallucination, never a legitimate claim - it must not be
  // shown to the user as if it were an accurate status report.
  let capabilityDenialRoundCount = 0;
  let capabilityDenialCorrectiveNudgeSeen = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        capabilityDenialRoundCount++;
        if (capabilityDenialRoundCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: "I don't actually have the ability to check the repository contents. I haven't actually performed any of those file operations." } }] }),
          });
          return;
        }
        capabilityDenialCorrectiveNudgeSeen = (parsed.messages || []).some((m) => m.role === 'user' && typeof m.content === 'string' && m.content.indexOf('DO have real, working') >= 0);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest real answer after capability-denial retry' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('can you check the repo files');
  let chatTextAfterCapabilityDenialRetry = '';
  for (let i = 0; i < 60; i++) {
    chatTextAfterCapabilityDenialRetry = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextAfterCapabilityDenialRetry.indexOf('regtest real answer after capability-denial retry') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(capabilityDenialRoundCount === 2, `a false "I don't have access" claim triggers exactly one automatic retry round (got ${capabilityDenialRoundCount} rounds)`);
  assert(capabilityDenialCorrectiveNudgeSeen, 'the retry round includes a corrective nudge telling the model it does have real tool access');
  assert(chatTextAfterCapabilityDenialRetry.indexOf("don't actually have the ability") === -1, 'the false denial from round 1 never renders as the final answer');
  assert(chatTextAfterCapabilityDenialRetry.indexOf('regtest real answer after capability-denial retry') >= 0, 'the real answer from the retry round renders once it comes back');

  console.log('\n-- a coding-agent reply that only narrates intent, with no tool call, gets one automatic retry instead of being shown as-is --');
  // A real user report: the model kept replying with pure statements of
  // intent ("I'll make sure all the UI enhancements are properly
  // committed to the repository. Let me check the current state and redo
  // everything...") and no tool_calls entry at all - not fake tool-call
  // syntax, not a capability denial, just talk, over and over ("Let me
  // try that again") with the Terminal panel staying completely empty the
  // whole time.
  let stallRoundCount = 0;
  let stallCorrectiveNudgeSeen = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        stallRoundCount++;
        if (stallRoundCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: "I'll make sure all the UI enhancements are properly committed. Let me check the current state and redo everything." } }] }),
          });
          return;
        }
        stallCorrectiveNudgeSeen = (parsed.messages || []).some((m) => m.role === 'user' && typeof m.content === 'string' && m.content.indexOf("didn't call a tool this round") >= 0);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest real answer after stall retry' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please commit the UI enhancements to the repo');
  let chatTextAfterStallRetry = '';
  for (let i = 0; i < 60; i++) {
    chatTextAfterStallRetry = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextAfterStallRetry.indexOf('regtest real answer after stall retry') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(stallRoundCount === 2, `a stalling, tool-call-free reply triggers exactly one automatic retry round (got ${stallRoundCount} rounds)`);
  assert(stallCorrectiveNudgeSeen, 'the retry round includes a corrective nudge telling the model to call a tool instead of narrating the plan');
  assert(chatTextAfterStallRetry.indexOf('redo everything') === -1, 'the stalling reply from round 1 never renders as the final answer');
  assert(chatTextAfterStallRetry.indexOf('regtest real answer after stall retry') >= 0, 'the real answer from the retry round renders once it comes back');

  console.log('\n-- once a stalling reply has happened, later rounds carry a persistent reminder, not just a one-shot in-round retry --');
  let persistentStallReminderBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        persistentStallReminderBody = parsed;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest fresh session answer after stall' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please check yet another file in the repo');
  for (let i = 0; i < 40 && persistentStallReminderBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const persistentStallReminderSeen = !!(persistentStallReminderBody && persistentStallReminderBody.messages && persistentStallReminderBody.messages.some((m) => m.role === 'system' && typeof m.content === 'string' && m.content.indexOf('described what you were about to do instead of actually doing it') >= 0));
  assert(persistentStallReminderSeen, `a fresh message in the same tab carries a persistent reminder not to repeat the stalling mistake, not just a one-shot in-round retry (got system messages: ${JSON.stringify((persistentStallReminderBody && persistentStallReminderBody.messages || []).filter((m) => m.role === 'system').map((m) => (m.content || '').slice(0, 80)))})`);

  console.log('\n-- tapping Continue after a stall refreshes the system prompt with the persistent reminder, not the stale pre-stall one --');
  // The persistent-reminder test above only proves a brand NEW outer
  // message picks up the reminder - but Continue re-enters the SAME
  // long tool-calling chain by reusing the existing msgs array, whose
  // system prompt (msgs[0]) was built back when the chain started,
  // before any stall had happened. A real user report showed the
  // stalling pattern recurring several Continues later in one long
  // session despite the one-shot retry having already fired once -
  // the correction never reached later rounds because msgs[0] was
  // never refreshed. A fresh Coding tab resets codingAgentStallSeen to
  // false, guaranteeing this send's system prompt starts with no
  // reminder, so any reminder seen in round 3 can only have come from
  // the Continue-time refresh.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  let continueRefreshRoundCount = 0;
  let continueRefreshFinalBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        continueRefreshRoundCount++;
        if (continueRefreshRoundCount <= 2) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: "I'll make sure to check the repo. Let me verify the current state first." } }] }) });
          return;
        }
        continueRefreshFinalBody = parsed;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest answer after continue refresh' } }] }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please check the repo status');
  let continueRefreshBtn = null;
  for (let i = 0; i < 60; i++) {
    const btn = page.locator('#chat .msg.ma3 button:has-text("Continue")').last();
    if (await btn.count()) { continueRefreshBtn = btn; break; }
    await page.waitForTimeout(200);
  }
  assert(!!continueRefreshBtn, 'test setup: a Continue button appears after the one-shot stall retry is exhausted');
  await continueRefreshBtn.click();
  for (let i = 0; i < 60 && continueRefreshFinalBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const continueRefreshReminderSeen = !!(continueRefreshFinalBody && continueRefreshFinalBody.messages && continueRefreshFinalBody.messages.some((m) => m.role === 'system' && typeof m.content === 'string' && m.content.indexOf('described what you were about to do instead of actually doing it') >= 0));
  assert(continueRefreshReminderSeen, `tapping Continue after a stall refreshes the system prompt to include the persistent stalling reminder, not the stale pre-stall one (got system messages: ${JSON.stringify((continueRefreshFinalBody && continueRefreshFinalBody.messages || []).filter((m) => m.role === 'system').map((m) => (m.content || '').slice(0, 80)))})`);

  console.log('\n-- a second exhausted stall-retry cycle in the same tab surfaces a clear note instead of another silent Continue button --');
  // A real user report: the same "Let me try that again." -> stalls again
  // -> Continue -> "Let me try that again." cycle repeated 5-6+ times in a
  // row in one long session - each Continue tap grants its own one-shot
  // retry (by design, so a single bad round doesn't poison the rest of the
  // conversation), but nothing told the USER that repeatedly tapping
  // Continue wasn't actually going anywhere. This continues from the
  // Continue button rendered by the test just above (round 3's real
  // answer), forcing a second full stall-and-exhausted-retry cycle.
  let secondStallCycleRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        secondStallCycleRoundCount++;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: "I'll check the repo now. Let me verify the file first." } }] }) });
        return;
      }
    }
    await route.continue();
  });
  let secondCycleContinueBtn = null;
  for (let i = 0; i < 60; i++) {
    const btn = page.locator('#chat .msg.ma3 button:has-text("Continue")').last();
    if (await btn.count()) { secondCycleContinueBtn = btn; break; }
    await page.waitForTimeout(200);
  }
  assert(!!secondCycleContinueBtn, 'test setup: the earlier Continue button from the first cycle is still there to tap');
  await secondCycleContinueBtn.click();
  for (let i = 0; i < 60 && secondStallCycleRoundCount < 2; i++) await page.waitForTimeout(200);
  await page.waitForTimeout(500);
  await page.unroute('**/*');
  const chatTextAfterSecondStallCycle = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(chatTextAfterSecondStallCycle.indexOf('happened 2 times now in this conversation') >= 0, `a clear note appears once the exhausted-retry stall cycle has happened a second time in the same tab, instead of just another silent Continue button (chat tail: ${chatTextAfterSecondStallCycle.slice(-400)})`);
  await page.click('#newTabBtn'); await page.waitForTimeout(400);

  console.log('\n-- transient HTTP errors from the coding agent offer a Retry button instead of a dead end --');
  // 429/500/502/503 already got a Retry button that re-enters the same
  // session without starting a new chatHistory turn. A real user report
  // hit an HTTP 524 (Cloudflare's own gateway-timeout family - a slow
  // coding-agent call is exactly the kind of request that trips it) and
  // got the generic dead-end message instead, with the session killed
  // (codingAgentActive set to null) and no way to pick back up except
  // starting over. Check one from each family: an already-covered status
  // (503) and a newly-covered one (524).
  for (const statusToTest of [503, 524]) {
    let transientErrorRoundCount = 0;
    await page.route('**/*', async (route) => {
      const req = route.request();
      if (req.method() === 'POST' && req.postData()) {
        let parsed = null;
        try { parsed = JSON.parse(req.postData()); } catch (e) {}
        if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
          transientErrorRoundCount++;
          if (transientErrorRoundCount === 1) {
            await route.fulfill({ status: statusToTest, contentType: 'text/plain', body: 'gateway error' });
            return;
          }
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest recovered after HTTP ' + statusToTest } }] }) });
          return;
        }
      }
      await route.continue();
    });
    await sendMsg('please check the repo status ' + statusToTest);
    const retryBtn = page.locator('#chat .msg.ma3 button:has-text("Retry")').last();
    await retryBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const retryVisible = await retryBtn.isVisible().catch(() => false);
    assert(retryVisible, `HTTP ${statusToTest} offers a Retry button instead of a dead end (got: ${await page.evaluate(() => document.getElementById('chat').textContent).catch(() => '')})`.slice(0, 400));
    if (retryVisible) await retryBtn.click();
    let chatTextAfterTransientRetry = '';
    for (let i = 0; i < 40; i++) {
      chatTextAfterTransientRetry = await page.evaluate(() => document.getElementById('chat').textContent);
      if (chatTextAfterTransientRetry.indexOf('regtest recovered after HTTP ' + statusToTest) >= 0) break;
      await page.waitForTimeout(200);
    }
    await page.unroute('**/*');
    assert(chatTextAfterTransientRetry.indexOf('regtest recovered after HTTP ' + statusToTest) >= 0, `tapping Retry after HTTP ${statusToTest} re-enters the same session and the real answer renders once it succeeds`);
  }

  console.log('\n-- a 429 from the coding agent counts down before Retry is tappable, honoring Retry-After --');
  // Retry used to be tappable the instant a 429 rendered, so mashing it
  // right away almost always just landed on the same rate limit again -
  // a real report of this looking like a stuck loop. Retry-After: 2 here
  // should drive a ~2s disabled countdown before it becomes clickable.
  // Access-Control-Expose-Headers is required here, matching the real fix
  // in workers/openai-router-chat/openai-router.js - Retry-After is not on
  // the browser's CORS-safelisted response header list, so a cross-origin
  // fetch() (this mock, like the real DI_URL call, is a different origin
  // than the page) can't read it at all without this being explicitly
  // exposed, no matter what the server actually sends.
  let rateLimitRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        rateLimitRoundCount++;
        if (rateLimitRoundCount === 1) {
          await route.fulfill({ status: 429, headers: { 'content-type': 'text/plain', 'Retry-After': '2', 'Access-Control-Expose-Headers': 'Retry-After' }, body: 'rate limited' });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest recovered after 429' } }] }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please check the repo status for rate limiting');
  const rateLimitRetryBtn = page.locator('#chat .msg.ma3 button:has-text("Retry")').last();
  await rateLimitRetryBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const rateLimitRetryDisabledImmediately = await rateLimitRetryBtn.isDisabled().catch(() => false);
  assert(rateLimitRetryDisabledImmediately, 'the Retry button starts disabled with a countdown instead of being immediately tappable into the same limit');
  const rateLimitRetryInitialText = await rateLimitRetryBtn.textContent().catch(() => '');
  assert(/retry in 2s/i.test(rateLimitRetryInitialText || ''), `the countdown reads the mocked Retry-After: 2 header, not the 6s no-header fallback (got "${rateLimitRetryInitialText}")`);
  await page.waitForTimeout(1000);
  const rateLimitRetryStillDisabledAt1s = await rateLimitRetryBtn.isDisabled().catch(() => true);
  assert(rateLimitRetryStillDisabledAt1s, 'the countdown honors the Retry-After header (2s) instead of enabling immediately');
  let rateLimitRetryEnabledAfterCountdown = true;
  for (let i = 0; i < 40; i++) {
    rateLimitRetryEnabledAfterCountdown = await rateLimitRetryBtn.isDisabled().catch(() => true);
    if (!rateLimitRetryEnabledAfterCountdown) break;
    await page.waitForTimeout(200);
  }
  assert(!rateLimitRetryEnabledAfterCountdown, 'Retry becomes tappable once the Retry-After countdown actually elapses');
  await rateLimitRetryBtn.click();
  let chatTextAfterRateLimitRetry = '';
  for (let i = 0; i < 40; i++) {
    chatTextAfterRateLimitRetry = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextAfterRateLimitRetry.indexOf('regtest recovered after 429') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(chatTextAfterRateLimitRetry.indexOf('regtest recovered after 429') >= 0, 'tapping Retry after the countdown re-enters the same session and the real answer renders once it succeeds');

  console.log('\n-- a GitHub OAuth redirect fallback (#gh_oauth=... in the URL hash) finishes the connection on load --');
  // On mobile/PWA, window.open() for the OAuth popup often doesn't produce
  // a real window.opener, so the worker's postMessage path silently fails
  // even though the token exchange succeeded server-side - the user saw
  // "Connected!" in the OAuth tab but the app never got the token and stayed
  // disconnected. The worker's fallback redirects back here with the result
  // in the hash instead; processGithubOauthRedirect() must pick that up on
  // load, save the token, and clear the hash.
  // Profile-scoped keys are prefixed (prof_<name>__gh_oauth_token) once a
  // non-default profile is active (the "profile: create, isolate" step
  // above switches to one and never switches back) - look up the actual
  // key by suffix instead of assuming the unprefixed name, same pattern
  // used elsewhere in this file (e.g. ai_workprojects/drive_folder_id).
  const oauthRedirectPayload = encodeURIComponent(JSON.stringify({
    type: 'gh_oauth_success', access_token: 'regtest-redirect-token', refresh_token: 'regtest-redirect-refresh', expires_in: 3600,
  }));
  await page.evaluate((h) => {
    Object.keys(localStorage).filter((k) => k.indexOf('gh_oauth_token') >= 0 || k.indexOf('gh_oauth_refresh_token') >= 0).forEach((k) => localStorage.removeItem(k));
    location.hash = h;
  }, 'gh_oauth=' + oauthRedirectPayload);
  // A same-document fragment-only URL change (via goto or setting
  // location.hash) doesn't rerun the page's load-time init code - a real
  // OAuth redirect lands as a fresh navigation, so force one here with
  // reload() to actually exercise processGithubOauthRedirect() on load.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const savedOauthToken = await page.evaluate(() => { try { const k = Object.keys(localStorage).find((k) => k.indexOf('gh_oauth_token') >= 0); return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } });
  assert(savedOauthToken && savedOauthToken.token === 'regtest-redirect-token', `a #gh_oauth redirect payload on load saves the access token via ghSaveOauthToken (got ${JSON.stringify(savedOauthToken)})`);
  const savedOauthRefresh = await page.evaluate(() => { const k = Object.keys(localStorage).find((k) => k.indexOf('gh_oauth_refresh_token') >= 0); return k ? localStorage.getItem(k) : null; });
  assert(savedOauthRefresh === 'regtest-redirect-refresh', `the redirect fallback also saves the refresh token, not just the access token (got "${savedOauthRefresh}")`);
  const hashClearedAfterOauthRedirect = await page.evaluate(() => location.hash);
  assert(hashClearedAfterOauthRedirect === '', 'the gh_oauth hash is cleared from the URL after being consumed, so a reload does not re-process it');
  const toastAfterOauthRedirect = await page.evaluate(() => document.getElementById('msgToastText').textContent);
  assert(toastAfterOauthRedirect.indexOf('GitHub OAuth connected') >= 0, 'a toast confirms the redirect-fallback connection the same way the popup path does');

  console.log('\n-- a GitHub OAuth redirect error (#gh_oauth_error=... in the URL hash) surfaces a toast instead of silently doing nothing --');
  await page.evaluate((h) => {
    Object.keys(localStorage).filter((k) => k.indexOf('gh_oauth_token') >= 0 || k.indexOf('gh_oauth_refresh_token') >= 0).forEach((k) => localStorage.removeItem(k));
    location.hash = h;
  }, 'gh_oauth_error=' + encodeURIComponent('access_denied'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const toastAfterOauthRedirectError = await page.evaluate(() => document.getElementById('msgToastText').textContent);
  assert(toastAfterOauthRedirectError.indexOf('access_denied') >= 0, `a #gh_oauth_error redirect payload surfaces the underlying error in a toast (got "${toastAfterOauthRedirectError}")`);
  const hashClearedAfterOauthError = await page.evaluate(() => location.hash);
  assert(hashClearedAfterOauthError === '', 'the gh_oauth_error hash is also cleared after being consumed');
  const noTokenSavedAfterOauthError = await page.evaluate(() => { const k = Object.keys(localStorage).find((k) => k.indexOf('gh_oauth_token') >= 0); return k ? localStorage.getItem(k) : null; });
  assert(!noTokenSavedAfterOauthError, `an error payload never saves a token (got "${noTokenSavedAfterOauthError}")`);

  console.log('\n-- an abandoned coding-agent step (no Continue click) still leaves its findings in real conversation history --');
  // Without this, moving on to an unrelated message after a pending
  // coding-agent step (never tapped Continue) left the main chat model
  // with zero awareness the repo was even looked at - it would flatly
  // contradict what the coding agent just found (e.g. claiming it can't
  // see the repo at all right after the agent listed its files).
  let sawPendingListFiles = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        sawPendingListFiles = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 'regtest_abandoned', type: 'function', function: { name: 'list_files', arguments: JSON.stringify({}) } }] } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('can you see the repo files');
  await page.unroute('**/*');
  assert(sawPendingListFiles, 'test setup: the coding agent step actually ran');
  const pendingContinueVisible = await page.evaluate(() => !!document.querySelector('#chat .msg.ma3 button'));
  assert(pendingContinueVisible, 'test setup: the step left a Continue button pending (not yet clicked)');
  let lastUnrelatedAfterAbandonedStep = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === true) {
        lastUnrelatedAfterAbandonedStep = parsed;
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"regtest unrelated reply"}}]}\n\ndata: [DONE]\n\n' });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('what is the capital of France');
  await page.unroute('**/*');
  const historyAfterAbandonedStep = ((lastUnrelatedAfterAbandonedStep && lastUnrelatedAfterAbandonedStep.messages) || []).map((m) => m.content).join('\n');
  assert(historyAfterAbandonedStep.indexOf('I looked through the repository files.') >= 0, `an abandoned coding-agent step's findings still reach a later, unrelated message's conversation history (got: ${historyAfterAbandonedStep.slice(-400)})`);

  console.log('\n-- an empty completion auto-switches to a fallback model and retries instead of just showing "(empty response)" --');
  // A model can burn its whole turn on tool_calls and have nothing left to
  // say once the final render call locks it to tool_choice:"none" - that
  // used to just render "(empty response)" and stop there. Mock the final
  // streaming call as genuinely empty and confirm the app switches to a
  // different tool-capable model and retries once, rendering that model's
  // actual reply instead.
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.locator('.mc:has-text("Mistral Small")').first().click();
  await page.waitForTimeout(150);
  let emptyRespToolRoundSeen = false;
  let emptyRespStreamModels = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === false) {
        emptyRespToolRoundSeen = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }] }),
        });
        return;
      }
      if (parsed && parsed.stream === true) {
        emptyRespStreamModels.push(parsed.model);
        if (emptyRespStreamModels.length === 1) {
          await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: [DONE]\n\n' });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'data: {"choices":[{"delta":{"content":"regtest fallback reply"}}]}\n\ndata: [DONE]\n\n',
          });
        }
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please help me get organized');
  await page.unroute('**/*');
  assert(emptyRespToolRoundSeen, 'test setup: the app-control tool round actually ran for this message');
  assert(emptyRespStreamModels.length === 2, `an empty first completion triggers exactly one fallback retry (got ${emptyRespStreamModels.length} streaming calls: ${JSON.stringify(emptyRespStreamModels)})`);
  assert(emptyRespStreamModels[0] !== emptyRespStreamModels[1], `the retry actually uses a different model than the one that just returned empty (got "${emptyRespStreamModels[0]}" then "${emptyRespStreamModels[1]}")`);
  const modelLabelAfterFallback = await page.textContent('#modelBtnLabel');
  assert(modelLabelAfterFallback === 'Llama 3.1 8B Turbo', `the app switches to the fallback model in the model picker (got "${modelLabelAfterFallback}")`);
  const chatTextAfterFallback = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(chatTextAfterFallback.indexOf('regtest fallback reply') >= 0, `the fallback model's actual reply is what ends up rendered, not "(empty response)" (chat text: ${chatTextAfterFallback.slice(-300)})`);
  assert(chatTextAfterFallback.indexOf('switched to') >= 0, 'a notice explaining the automatic model switch is shown in the chat');
  const replyBubbleLabel = await page.evaluate(() => {
    const bubbles = document.querySelectorAll('#chat .msg.ma3 .ml');
    return bubbles.length ? bubbles[bubbles.length - 1].textContent : '';
  });
  assert(replyBubbleLabel.indexOf('Llama 3.1 8B Turbo') >= 0, `the reply bubble's own model label updates to the fallback model instead of staying on the original failed model (got "${replyBubbleLabel}")`);

  console.log('\n-- a hard error from the model also auto-switches to a fallback model and retries, not just an empty response --');
  // The empty-response fallback above only covers a request that came back
  // 200 with nothing in it. A genuine error (rate limit, a provider
  // rejecting something about the request) used to skip straight to a raw
  // "Error: ..." bubble with no retry at all - a real user report showed
  // "Error: Tool calling is not supported for model: ..." rendered
  // directly as the answer to an ordinary question. Mock the final
  // streaming call as a hard HTTP error and confirm the app switches to a
  // different tool-capable model and retries once, same as the empty-
  // response case.
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.locator('.mc:has-text("Mistral Small")').first().click();
  await page.waitForTimeout(150);
  let errorFallbackStreamModels = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === false) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }] }),
        });
        return;
      }
      if (parsed && parsed.stream === true) {
        errorFallbackStreamModels.push(parsed.model);
        if (errorFallbackStreamModels.length === 1) {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'Tool calling is not supported for model: ' + parsed.model } }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'data: {"choices":[{"delta":{"content":"regtest error-fallback reply"}}]}\n\ndata: [DONE]\n\n',
          });
        }
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please give me some tips for staying focused today');
  await page.unroute('**/*');
  assert(errorFallbackStreamModels.length === 2, `a hard error on the first streaming call triggers exactly one fallback retry (got ${errorFallbackStreamModels.length} streaming calls: ${JSON.stringify(errorFallbackStreamModels)})`);
  assert(errorFallbackStreamModels[0] !== errorFallbackStreamModels[1], `the retry actually uses a different model than the one that just errored (got "${errorFallbackStreamModels[0]}" then "${errorFallbackStreamModels[1]}")`);
  const chatTextAfterErrorFallback = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(chatTextAfterErrorFallback.indexOf('regtest error-fallback reply') >= 0, `the fallback model's actual reply is what ends up rendered, not the raw error text (chat text: ${chatTextAfterErrorFallback.slice(-300)})`);
  assert(chatTextAfterErrorFallback.indexOf('Tool calling is not supported') === -1, 'the raw provider error text never renders as the final answer once the fallback retry succeeds');
  assert(chatTextAfterErrorFallback.indexOf('hit an error') >= 0, 'a notice explaining the automatic error-triggered model switch is shown in the chat');

  console.log('\n-- the main chat also retries once when the model writes fake tool-call syntax as plain text --');
  // The final render call is locked to tool_choice:"none" specifically so
  // the model answers in plain text, but a real user report showed a
  // model ignoring that and writing an invented tool call out as the text
  // itself (<function=identify_patterns>{...}</function>) instead of an
  // actual answer - the same failure mode already fixed for the dedicated
  // coding agent, but this is the ordinary main chat path.
  let mainChatFakeToolCallStreamCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === false) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }] }) });
        return;
      }
      if (parsed && parsed.stream === true) {
        mainChatFakeToolCallStreamCount++;
        if (mainChatFakeToolCallStreamCount === 1) {
          await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"<function=identify_patterns>{\\"repo_name\\": \\"solmasta/Test\\"}</function>"}}]}\n\ndata: [DONE]\n\n' });
        } else {
          await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"regtest real main-chat answer after retry"}}]}\n\ndata: [DONE]\n\n' });
        }
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please give me a quick summary of my day');
  await page.unroute('**/*');
  assert(mainChatFakeToolCallStreamCount === 2, `fake tool-call text triggers exactly one automatic retry in the main chat too (got ${mainChatFakeToolCallStreamCount} streaming calls)`);
  const chatTextAfterMainChatFakeToolCall = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(chatTextAfterMainChatFakeToolCall.indexOf('<function=') === -1, 'the fake tool-call text never renders as the final answer in the main chat');
  assert(chatTextAfterMainChatFakeToolCall.indexOf('regtest real main-chat answer after retry') >= 0, 'the real answer from the retry renders once it comes back');

  console.log('\n-- a repo-flavored message no longer needs to switch the main chat model at all --');
  // Repo work now always runs on the dedicated coding agent, independent
  // of whatever the main chat is using - the auto-router used to have to
  // bias toward a tool-capable DeepInfra model for a repo-flavored message
  // just so the CURRENT model could use the tools directly, which meant
  // switching away from whatever the user was actually chatting with
  // (e.g. OpenRouter) for reasons that had nothing to do with the
  // conversation itself. Start on OpenRouter, send an unambiguously
  // repo-flavored message, and confirm the main chat backend is left
  // alone while the coding agent still does the actual work.
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.click('#openrouterBtn'); await page.waitForTimeout(300);
  await page.click('#closeModelModal'); await page.waitForTimeout(150);
  const backendBeforeGithubMsg = await page.evaluate(() => document.getElementById('openrouterBtn').classList.contains('act') ? 'openrouter' : 'other');
  assert(backendBeforeGithubMsg === 'openrouter', 'test setup: starts on the OpenRouter backend');
  let sawCodingAgentCallForBranchMsg = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        sawCodingAgentCallForBranchMsg = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest branch check done' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please check the current branch and commit history in the repo');
  await page.unroute('**/*');
  const backendAfterGithubMsg = await page.evaluate(() => document.getElementById('openrouterBtn').classList.contains('act') ? 'openrouter' : 'other');
  assert(backendAfterGithubMsg === 'openrouter', `the main chat backend stays on OpenRouter - the coding agent handles repo work independently instead of forcing a model switch (backend after send: "${backendAfterGithubMsg}")`);
  assert(sawCodingAgentCallForBranchMsg, 'the dedicated coding agent still actually engaged for the repo-flavored message');
  // Switch back to a DeepInfra model - later tests assume the model
  // picker is already showing the DeepInfra list, same baseline the
  // pre-coding-agent version of this test used to leave behind by
  // switching backends itself.
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.click('#deepinfraBtn'); await page.waitForTimeout(150);
  await page.locator('.mc:has-text("Mistral Small")').first().click();
  await page.waitForTimeout(150);

  console.log('\n-- App-control tools (create_project/remember/switch_model) actually execute, no confirm needed --');
  // These are the Overseer's new "full autonomy" tools - unlike write_file
  // they run immediately on a model-issued tool_call, no approval dialog.
  // Mock all three in one tool_calls response and verify each one's real,
  // observable side effect: a project actually saved and made active, a
  // memory actually stored, and the model actually switched.
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.locator('.mc:has-text("Mistral Small")').first().click();
  await page.waitForTimeout(150);
  let appControlRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === false) {
        appControlRoundCount++;
        if (appControlRoundCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              choices: [{
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  tool_calls: [
                    { id: 'regtest_call_a', type: 'function', function: { name: 'create_project', arguments: JSON.stringify({ name: 'Regtest Tool Project', instructions: 'Regtest project instructions' }) } },
                    { id: 'regtest_call_b', type: 'function', function: { name: 'remember', arguments: JSON.stringify({ fact: 'Regtest remembered fact' }) } },
                    { id: 'regtest_call_c', type: 'function', function: { name: 'switch_model', arguments: JSON.stringify({ model_id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' }) } },
                  ],
                },
              }],
            }),
          });
          return;
        }
        // The tool round loop keeps going until the model stops calling
        // tools - round 2 must say it's done, or these three tools would
        // re-run every round up to MAX_TOOL_ROUNDS for no reason.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest done' } }] }),
        });
        return;
      }
      if (parsed && parsed.stream === true) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n',
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please make this a project, remember something, and switch models for me');
  await page.unroute('**/*');

  const projectCreated = await page.evaluate(() => {
    const raw = localStorage.getItem(Object.keys(localStorage).find((k) => k.indexOf('ai_workprojects') >= 0));
    const parsed = raw ? JSON.parse(raw) : [];
    return parsed.some((p) => p.title === 'Regtest Tool Project' && p.instructions === 'Regtest project instructions');
  });
  assert(projectCreated, 'create_project tool call actually saves a new Work Project');
  const projectBadge = await page.textContent('#activePromptName');
  assert(projectBadge.indexOf('Regtest Tool Project') >= 0, `create_project sets the new project active (got badge "${projectBadge}")`);

  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#memoryBtn'); await page.waitForTimeout(150);
  const memoryRemembered = await page.evaluate(() => document.getElementById('memoryList').textContent.indexOf('Regtest remembered fact') >= 0);
  assert(memoryRemembered, 'remember tool call actually saves a memory');
  await page.click('#closeMemoryModal'); await page.waitForTimeout(150);

  const modelLabelAfterToolSwitch = await page.textContent('#modelBtnLabel');
  assert(modelLabelAfterToolSwitch === 'Llama 3.3 70B Turbo', `switch_model tool call actually switches the active model (got "${modelLabelAfterToolSwitch}")`);

  console.log('\n-- hardcoded app-structure knowledge only appears when the connected repo actually IS this app --');
  // Without this, the coding agent asked to do "a checkup" or "add a
  // feature" on the app has to guess its own architecture from scratch
  // every time. It must only apply to solmasta/AI-Router specifically
  // (the repo was renamed from openai-router - still matching the old
  // name too, checked further below, so a connection saved before the
  // rename doesn't silently lose this) - injecting it for some other repo
  // the user points GitHub at would just be wrong. This knowledge lives
  // in the dedicated coding agent's own system prompt now
  // (codingAgentSystemPrompt), not the main chat model's - repo work
  // never touches the main chat model at all.
  // The previous test's create_project call left a Work Project active -
  // getModelSystemPrompt takes a completely different branch whenever a
  // project is active, which would skip repo routing entirely regardless
  // of GitHub state. Clear does this too, but also matches how a real
  // user would move on for a new topic in this app.
  await page.click('#clearBtn'); await page.waitForTimeout(200);
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.fill('#ghOwnerInput', 'solmasta');
  await page.fill('#ghRepoInput', 'AI-Router');
  await page.click('#githubSaveBtn'); await page.waitForTimeout(150);
  let lastCheckupBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        lastCheckupBody = parsed;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest checkup done' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('can you do a maintenance checkup on the app');
  for (let i = 0; i < 60 && lastCheckupBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const checkupSysContent = ((lastCheckupBody && lastCheckupBody.messages) || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert(checkupSysContent.indexOf("THIS REPO IS THE APP YOU'RE RUNNING IN") >= 0, 'a maintenance/checkup request on the connected AI-Router repo gets the coding agent the hardcoded app-structure knowledge');

  console.log('\n-- the old pre-rename repo name (openai-router) still gets the same hardcoded app-structure knowledge --');
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.fill('#ghOwnerInput', 'solmasta');
  await page.fill('#ghRepoInput', 'openai-router');
  await page.click('#githubSaveBtn'); await page.waitForTimeout(150);
  let lastOldNameBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        lastOldNameBody = parsed;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest checkup done' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('can you do a maintenance checkup on the app');
  for (let i = 0; i < 60 && lastOldNameBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const oldNameSysContent = ((lastOldNameBody && lastOldNameBody.messages) || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert(oldNameSysContent.indexOf("THIS REPO IS THE APP YOU'RE RUNNING IN") >= 0, 'a connection saved under the pre-rename repo name still gets the hardcoded app-structure knowledge, not silently dropped');

  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.fill('#ghOwnerInput', 'someoneelse');
  await page.fill('#ghRepoInput', 'unrelated-project');
  await page.click('#githubSaveBtn'); await page.waitForTimeout(150);
  let lastOtherRepoBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        lastOtherRepoBody = parsed;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest checkup done' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('can you do a maintenance checkup on the app');
  for (let i = 0; i < 60 && lastOtherRepoBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const otherRepoSysContent = ((lastOtherRepoBody && lastOtherRepoBody.messages) || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert(otherRepoSysContent.indexOf("THIS REPO IS THE APP YOU'RE RUNNING IN") < 0, 'the same request against a different connected repo does NOT get AI-Router-specific knowledge');

  // Leave GitHub pointed back at the real repo, matching actual usage.
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.fill('#ghOwnerInput', 'solmasta');
  await page.fill('#ghRepoInput', 'AI-Router');
  await page.click('#githubSaveBtn'); await page.waitForTimeout(150);

  console.log('\n-- the main chat model is never told it has repository tools - only the dedicated coding agent ever gets that --');
  // Real user-reported bug (predates the dedicated coding agent): the
  // system prompt used to claim "you have read_file/write_file tools, use
  // them immediately" for ANY model whenever GitHub was connected,
  // regardless of whether that model was actually offered those tools. A
  // model told it had tools it didn't get tried to call one anyway and,
  // with no structured tool-calling mechanism available, dumped the
  // attempt as literal text (e.g. "<tool_call><function=read_file>...")
  // straight into its reply. Now this text lives only in the coding
  // agent's own separate system prompt - confirm the regular chat model's
  // prompt never contains it at all, for a message with no repo/github
  // signal (so this stays on the normal chat path, not the coding agent).
  let lastNonToolModelBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      try {
        const parsed = JSON.parse(req.postData());
        if (parsed.messages) lastNonToolModelBody = parsed;
      } catch (e) {}
    }
    await route.continue();
  });
  // Deliberately avoids any substring of analyzeTask's github keyword list
  // (e.g. "approach" contains "pr" and would silently route to the coding
  // agent instead) - a plain, unambiguous non-repo message.
  await sendMsg('give me a summary of quantum computing');
  for (let i = 0; i < 60 && lastNonToolModelBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const nonToolSysContent = ((lastNonToolModelBody && lastNonToolModelBody.messages) || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert(nonToolSysContent.indexOf('REPOSITORY ACCESS ENABLED') < 0, 'the main chat model is never told it has repository tools it was never actually given');
  assert(nonToolSysContent.indexOf('read_file(path)') < 0, 'the main chat model does not get the read_file/write_file usage instructions either');
  // Real user report, different flavor: a model invented an entirely
  // fictional tool ("get_weather_by_coordinates") that was never one of
  // this app's tools at all, regardless of whether real tools were
  // offered - so this instruction is unconditional, not just for
  // non-tool-capable models. Confirming it here since this test already
  // has a captured system prompt handy.
  assert(nonToolSysContent.indexOf('never invent or attempt to call a tool/function that wasn\'t given to you') >= 0, 'the system prompt explicitly forbids inventing tools that were never defined');

  // Switch back to a TOOL_MODELS model, matching the baseline the
  // remaining tests expect.
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.click('#deepinfraBtn'); await page.waitForTimeout(300);
  await page.locator('.mc:has-text("Mistral Small")').first().click();
  await page.waitForTimeout(150);
  // Guard against any stray leftover text in the compose box carrying
  // into a later test's transcript simulation (voice-conversation mode
  // captures whatever's already in #prompt as its dataset.base and
  // prepends it to the next transcribed result).
  await page.fill('#prompt', '');

  console.log('\n-- speak-replies-aloud toggle actually speaks completed responses, off by default --');
  // Off by default (speakEnabled starts false) - a completed response must
  // not call speechSynthesis.speak until the user explicitly turns the
  // toggle on, and must stop calling it again once turned back off.
  await page.evaluate(() => {
    window.__speakCalls = [];
    window.__speakVoiceCalls = [];
    // Mimics real speechSynthesis by actually firing the utterance's own
    // onstart/onend - later code (voice-conversation mode's auto-relisten,
    // the speak button's "speaking" pulse) hangs off those callbacks, and
    // a spy that only records the call without firing them would silently
    // break that for every test running after this one.
    window.speechSynthesis.speak = (utter) => {
      window.__speakCalls.push(utter.text);
      window.__speakVoiceCalls.push(utter.voice && utter.voice.name);
      if (utter.onstart) utter.onstart();
      if (utter.onend) utter.onend();
    };
  });
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === true) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"choices":[{"delta":{"content":"regtest spoken reply"}}]}\n\ndata: [DONE]\n\n',
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('regtest message before enabling speak');
  const speakCallsBeforeToggle = await page.evaluate(() => window.__speakCalls.length);
  assert(speakCallsBeforeToggle === 0, 'speak-aloud is off by default - a completed response does not call speechSynthesis.speak');

  const speakBtnOffState = await page.evaluate(() => document.getElementById('speakBtn').classList.contains('on'));
  assert(!speakBtnOffState, 'speak button does not show as "on" before being toggled');
  await page.click('#speakBtn');
  const speakBtnOnState = await page.evaluate(() => document.getElementById('speakBtn').classList.contains('on'));
  assert(speakBtnOnState, 'clicking the speak button turns it on');

  await sendMsg('regtest message after enabling speak');
  const spokenTexts = await page.evaluate(() => window.__speakCalls);
  assert(spokenTexts.indexOf('regtest spoken reply') >= 0, `once enabled, a completed response is actually spoken (got calls: ${JSON.stringify(spokenTexts)})`);

  await page.click('#speakBtn');
  const speakBtnOffAgain = await page.evaluate(() => document.getElementById('speakBtn').classList.contains('on'));
  assert(!speakBtnOffAgain, 'clicking the speak button again turns it back off');
  await sendMsg('regtest message after disabling speak');
  const spokenCountAfterDisable = await page.evaluate(() => window.__speakCalls.length);
  assert(spokenCountAfterDisable === spokenTexts.length, 'once disabled again, a completed response does not call speechSynthesis.speak');
  await page.unroute('**/*');

  console.log('\n-- voice-conversation mode: listens, auto-sends on silence, speaks the reply, then listens again --');
  // The whole point of this mode is not having to touch mic or Send for
  // every turn - toggling it on starts listening immediately, a finished
  // utterance (recognition.onend firing with real text) auto-sends,
  // completing the reply speaks it aloud, and the utterance's own onend
  // restarts listening for the next turn - a continuous loop instead of
  // tap mic, wait, tap Send, repeat.
  // Pin a known model first, same as every other send-driving test in this
  // file - without it, send()'s own switchToBestModel call inherits
  // whatever model/backend a prior test happened to leave active, and can
  // switch again mid-flow for a low-signal message, changing workerUrl out
  // from under this test's route mock and turning the real (blocked in
  // this sandbox) network fetch into an unhandled "Failed to fetch".
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.locator('.mc:has-text("Mistral Small")').first().click();
  await page.waitForTimeout(150);
  const startCountBeforeToggle = await page.evaluate(() => window.__recognitionStartCount || 0);
  await page.click('#voiceModeBtn'); await page.waitForTimeout(150);
  const voiceModeOnState = await page.evaluate(() => document.getElementById('voiceModeBtn').classList.contains('on'));
  assert(voiceModeOnState, 'toggling voice-conversation mode on shows it as active');
  const micOnAfterToggle = await page.evaluate(() => document.getElementById('micBtn').classList.contains('on'));
  assert(micOnAfterToggle, 'turning voice-conversation mode on immediately starts listening (mic shows on)');
  const startCountAfterToggle = await page.evaluate(() => window.__recognitionStartCount);
  assert(startCountAfterToggle === startCountBeforeToggle + 1, 'turning voice-conversation mode on actually calls recognition.start() once');

  // Playwright's page.route() reliably intercepts requests fired from a
  // real click in every other test in this file, but the fetch this test
  // triggers - several async hops downstream of a synthetic
  // recognition.onend() call rather than a DOM event - was consistently
  // rejecting with "Failed to fetch" before the route handler's very first
  // line ever ran, across many repeated runs. Patching window.fetch itself
  // sidesteps whatever CDP-level timing quirk that is: it's the app's own
  // JS calling this function directly, no network/route layer involved.
  await page.evaluate(() => {
    window.__origFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.indexOf('/secret') >= 0) {
        return new Response(JSON.stringify({ secret: 'regtest-secret' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (opts && opts.method === 'POST' && opts.body) {
        let parsed = null;
        try { parsed = JSON.parse(opts.body); } catch (e) {}
        if (parsed && parsed.stream === false) {
          // Whatever model/GitHub state carried over from earlier tests,
          // this test only cares about the voice loop, not tool behavior -
          // tell it there's nothing to call so it falls straight through
          // to the final streaming reply below.
          return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest done' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (parsed && parsed.stream === true) {
          return new Response('data: {"choices":[{"delta":{"content":"regtest voice reply"}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
      }
      return window.__origFetch(url, opts);
    };
  });
  // Simulate the browser reporting a finished, transcribed utterance -
  // shaped exactly like the real SpeechRecognition onresult event the
  // app's own handler expects (resultIndex + results[i][0].transcript +
  // results[i].isFinal).
  await page.evaluate(() => {
    window.__fakeRecognition.onresult({
      resultIndex: 0,
      results: { length: 1, 0: { length: 1, isFinal: true, 0: { transcript: 'regtest voice message' } } },
    });
  });
  const promptAfterResult = await page.inputValue('#prompt');
  assert(promptAfterResult === 'regtest voice message', `a transcribed result fills the compose box (got "${promptAfterResult}")`);

  // The real API fires onend on its own as soon as it detects the user
  // stopped talking - simulate that natural pause here.
  await page.evaluate(() => { window.__fakeRecognition.onend(); });
  await waitForSendDone();
  await page.evaluate(() => { window.fetch = window.__origFetch; delete window.__origFetch; });

  const promptClearedAfterAutoSend = await page.inputValue('#prompt');
  assert(promptClearedAfterAutoSend === '', 'the finished utterance auto-sent on its own - no Send tap required (compose box cleared)');
  // waitForSendDone() only guarantees the sendBtn label flipped back - poll
  // briefly for the actual speak/relisten side effects too, same reasoning
  // as the "poll for the intercepted body" fix used elsewhere in this file
  // for requests that can land a beat after the button state settles.
  let spokenAfterVoiceReply = null;
  for (let i = 0; i < 20; i++) {
    spokenAfterVoiceReply = await page.evaluate(() => window.__speakCalls[window.__speakCalls.length - 1]);
    if (spokenAfterVoiceReply === 'regtest voice reply') break;
    await page.waitForTimeout(200);
  }
  assert(spokenAfterVoiceReply === 'regtest voice reply', `the reply is spoken aloud even though the separate speak toggle is off (got "${spokenAfterVoiceReply}")`);
  let startCountAfterReply = null;
  for (let i = 0; i < 20; i++) {
    startCountAfterReply = await page.evaluate(() => window.__recognitionStartCount);
    if (startCountAfterReply === startCountAfterToggle + 1) break;
    await page.waitForTimeout(200);
  }
  assert(startCountAfterReply === startCountAfterToggle + 1, `once the reply finishes speaking, listening restarts on its own for the next turn (got start count ${startCountAfterReply}, expected ${startCountAfterToggle + 1})`);

  await page.click('#voiceModeBtn'); await page.waitForTimeout(150);
  const voiceModeOffState = await page.evaluate(() => document.getElementById('voiceModeBtn').classList.contains('on'));
  assert(!voiceModeOffState, 'toggling voice-conversation mode off turns it back off');
  const micOffAfterDisable = await page.evaluate(() => document.getElementById('micBtn').classList.contains('on'));
  assert(!micOffAfterDisable, 'turning voice-conversation mode off stops listening (mic shows off)');

  console.log('\n-- voice-conversation mode auto-sends via its own silence timer, even if the browser never fires onend on its own --');
  // Real-world report: text landed in the compose box but never actually
  // sent - continuous=false's "stops itself on a pause" behavior varies a
  // lot across real browsers/OSes and isn't reliable enough to depend on
  // alone. Simulate a transcript arriving and then NEVER call the fake
  // recognition's onend directly (unlike the test above) - only the app's
  // own resetVoiceSilenceTimer backstop should end listening and trigger
  // the send, proving that mechanism works independent of the browser's
  // own onend behavior.
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.locator('.mc:has-text("Mistral Small")').first().click();
  await page.waitForTimeout(150);
  const startCountBeforeTimerTest = await page.evaluate(() => window.__recognitionStartCount || 0);
  await page.click('#voiceModeBtn'); await page.waitForTimeout(150);
  await page.evaluate(() => {
    window.__origFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.indexOf('/secret') >= 0) {
        return new Response(JSON.stringify({ secret: 'regtest-secret' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (opts && opts.method === 'POST' && opts.body) {
        let parsed = null;
        try { parsed = JSON.parse(opts.body); } catch (e) {}
        if (parsed && parsed.stream === false) {
          return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest done' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (parsed && parsed.stream === true) {
          return new Response('data: {"choices":[{"delta":{"content":"regtest timer-triggered reply"}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
      }
      return window.__origFetch(url, opts);
    };
  });
  await page.evaluate(() => {
    window.__fakeRecognition.onresult({
      resultIndex: 0,
      results: { length: 1, 0: { length: 1, isFinal: true, 0: { transcript: 'regtest silence-timer message' } } },
    });
  });
  // The app's own timer is 1800ms after the last result - give it real
  // room past that instead of racing it exactly.
  await page.waitForTimeout(2500);
  await waitForSendDone();
  await page.evaluate(() => { window.fetch = window.__origFetch; delete window.__origFetch; });
  const promptClearedByTimer = await page.inputValue('#prompt');
  assert(promptClearedByTimer === '', 'the silence timer alone (no manual/browser onend) still auto-sends the finished utterance');
  const startCountAfterTimerTest = await page.evaluate(() => window.__recognitionStartCount);
  assert(startCountAfterTimerTest > startCountBeforeTimerTest, 'listening actually stopped and restarted via the timer path, not left hanging');
  await page.click('#voiceModeBtn'); await page.waitForTimeout(150);
  await page.fill('#prompt', '');

  console.log('\n-- picking a voice persists it and actually gets used when speaking --');
  // getVoices() returns nothing in this headless sandbox (no system TTS
  // voices installed), and SpeechSynthesisVoice has no public constructor,
  // so there's no way to hand the native utterance.voice setter something
  // it will actually accept - it silently no-ops for a plain object.
  // Replace that property with a permissive one so what the app *tries*
  // to assign is actually observable, independent of what a real browser
  // would ultimately accept.
  await page.evaluate(() => {
    Object.defineProperty(SpeechSynthesisUtterance.prototype, 'voice', {
      configurable: true,
      get() { return this.__testVoice; },
      set(v) { this.__testVoice = v; },
    });
    window.speechSynthesis.getVoices = () => [{ name: 'regtest-voice', lang: 'en-US' }];
    const sel = document.getElementById('voiceSelect');
    const opt = document.createElement('option');
    opt.value = 'regtest-voice'; opt.textContent = 'regtest-voice (en-US)';
    sel.appendChild(opt);
    sel.value = 'regtest-voice';
    sel.dispatchEvent(new Event('change'));
  });
  const persistedVoiceName = await page.evaluate(() => localStorage.getItem('ai_voice_name'));
  assert(persistedVoiceName === 'regtest-voice', `picking a voice persists its name (got "${persistedVoiceName}")`);

  await page.click('#speakBtn'); await page.waitForTimeout(150);
  const speakBtnOnForVoiceTest = await page.evaluate(() => document.getElementById('speakBtn').classList.contains('on'));
  assert(speakBtnOnForVoiceTest, 'test setup: speak-aloud is on for this check');
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === true) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: {"choices":[{"delta":{"content":"regtest voice-picker reply"}}]}\n\ndata: [DONE]\n\n',
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('regtest message to check the picked voice is used');
  await page.unroute('**/*');
  const usedVoiceName = await page.evaluate(() => window.__speakVoiceCalls[window.__speakVoiceCalls.length - 1]);
  assert(usedVoiceName === 'regtest-voice', `the picked voice is actually set on the utterance (got "${usedVoiceName}")`);
  await page.click('#speakBtn'); await page.waitForTimeout(150);

  console.log('\n-- the main chat labels replies "Overseer" with the actual model shown as a secondary indicator --');
  // The main chat's single point of contact is the Overseer, not whichever
  // model happens to answer - the model name should still be visible, just
  // as a secondary indicator rather than the primary label.
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === true) {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"regtest overseer-label reply"}}]}\n\ndata: [DONE]\n\n' });
        return;
      }
      if (parsed && parsed.stream === false) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }] }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('regtest message to check the overseer label');
  await page.unroute('**/*');
  const overseerLabelInfo = await page.evaluate(() => {
    const labels = document.querySelectorAll('#chat .msg.ma3 .ml');
    const last = labels[labels.length - 1];
    const primary = last ? last.querySelector('span:not(.av):not(.modelTag)').textContent : '';
    const modelTag = last ? last.querySelector('.modelTag') : null;
    return { primary, modelTagText: modelTag ? modelTag.textContent : null, currentModelLabel: document.getElementById('modelBtnLabel').textContent };
  });
  assert(overseerLabelInfo.primary === 'Overseer', `the reply bubble's primary label reads "Overseer" (got "${overseerLabelInfo.primary}")`);
  assert(!!overseerLabelInfo.modelTagText, 'a secondary model-name indicator is present on the reply bubble');
  assert(overseerLabelInfo.modelTagText === overseerLabelInfo.currentModelLabel, `the model-name indicator matches the model that actually answered (got "${overseerLabelInfo.modelTagText}" vs active "${overseerLabelInfo.currentModelLabel}")`);

  console.log('\n-- a reply\'s model-name tag survives a later model switch + reload instead of getting relabeled with today\'s active model --');
  // appendMsg used to always paint currentModel.label onto every assistant
  // bubble, including on a full re-render from chatHistory (tab switch,
  // reload, regen) - so switching models later silently relabeled every
  // earlier reply as if the NEW model had answered them too. Each
  // chatHistory entry now carries its own modelLabel from when it was
  // actually created; re-rendering must use that instead of the live model.
  const modelBeforeSwitch = overseerLabelInfo.currentModelLabel;
  await page.click('#modelBtn'); await page.waitForTimeout(300);
  const otherModelIndex = await page.evaluate((exclude) => {
    const cards = Array.from(document.querySelectorAll('#modelList .mc'));
    return cards.findIndex((c) => (c.querySelector('.mcl') || {}).textContent !== exclude);
  }, modelBeforeSwitch);
  assert(otherModelIndex >= 0, 'test setup: found a different model to switch to in the picker');
  const otherModelCard = page.locator('#modelList .mc').nth(otherModelIndex);
  const modelAfterSwitch = (await otherModelCard.locator('.mcl').textContent()).trim();
  await otherModelCard.click();
  await page.waitForTimeout(300);
  const modelBtnLabelAfterSwitch = await page.textContent('#modelBtnLabel');
  assert(modelBtnLabelAfterSwitch === modelAfterSwitch, `test setup: the model picker actually switched the active model (got "${modelBtnLabelAfterSwitch}", expected "${modelAfterSwitch}")`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const modelTagsAfterReload = await page.evaluate(() => Array.from(document.querySelectorAll('#chat .msg.ma3 .modelTag')).map((el) => el.textContent));
  assert(modelTagsAfterReload.indexOf(modelBeforeSwitch) >= 0, `the earlier reply's model-name tag still reads "${modelBeforeSwitch}" after reload, not relabeled with the now-active "${modelAfterSwitch}" (got tags: ${JSON.stringify(modelTagsAfterReload)})`);

  console.log('\n-- the Overseer\'s quality/stuck tracking reacts to what the model actually said, not just reply length --');
  // A long, fluent refusal used to score "excellent" purely for being
  // wordy, since quality was based only on character count. The Overseer
  // should notice when the model's own words say it's stuck or refusing,
  // regardless of length.
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === true) {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"I don\'t have access to that repository, so I am not able to check it directly, and honestly I am not sure what else to try here since nothing seems to be working out for this particular request no matter how I approach it."}}]}\n\ndata: [DONE]\n\n' });
        return;
      }
      if (parsed && parsed.stream === false) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }] }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('regtest message that gets a long-but-stuck reply');
  await page.unroute('**/*');
  let overseerStatusTextAfterConcern = '';
  for (let i = 0; i < 20; i++) {
    overseerStatusTextAfterConcern = await page.evaluate(() => { const el = document.getElementById('overseerStatus'); return el ? el.textContent : ''; });
    if (overseerStatusTextAfterConcern.indexOf('Stuck') >= 0) break;
    await page.waitForTimeout(300);
  }
  const qualityMatch = overseerStatusTextAfterConcern.match(/Quality:\s*(\d+)%/);
  const qualityPct = qualityMatch ? parseInt(qualityMatch[1], 10) : -1;
  // A 220-char reply on length alone would score 85% ("excellent") - the
  // concern cap (<=40) only kicks in because of what the text actually
  // says. Exact value depends on the averaging window (shared chat
  // history across the whole suite), so assert the cap held, not a
  // precise number.
  assert(qualityPct >= 0 && qualityPct <= 40, `a reply that actually says it's stuck/refusing is capped at 40% quality or lower instead of scoring high purely for length (got Quality: ${qualityPct}%, full status: ${overseerStatusTextAfterConcern})`);
  assert(overseerStatusTextAfterConcern.indexOf('Stuck') >= 0, `the stuck indicator reacts to the reply's actual content, not just its length (got: ${overseerStatusTextAfterConcern})`);

  console.log('\n-- Overseer personality is persisted and shapes the system prompt --');
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.fill('#personalityInput', 'regtest warm and playful');
  await page.evaluate(() => document.getElementById('personalityInput').dispatchEvent(new Event('input')));
  const persistedPersonality = await page.evaluate(() => localStorage.getItem('ai_overseer_personality'));
  assert(persistedPersonality === 'regtest warm and playful', `personality text persists (got "${persistedPersonality}")`);
  await page.click('#closeSettingsModal'); await page.waitForTimeout(150);

  let lastPersonalityBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      try {
        const parsed = JSON.parse(req.postData());
        if (parsed.messages) lastPersonalityBody = parsed;
      } catch (e) {}
    }
    await route.continue();
  });
  await sendMsg('regtest message to check personality shows up in the system prompt');
  for (let i = 0; i < 60 && lastPersonalityBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  const personalitySysContent = ((lastPersonalityBody && lastPersonalityBody.messages) || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  assert(personalitySysContent.indexOf('regtest warm and playful') >= 0, 'the persisted personality text is included in the system prompt sent to the model');
  // Clear it so it doesn't leak into other tests' system-prompt assertions.
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.fill('#personalityInput', '');
  await page.evaluate(() => document.getElementById('personalityInput').dispatchEvent(new Event('input')));
  await page.click('#closeSettingsModal'); await page.waitForTimeout(150);

  console.log('\n-- compose bar icon row wraps instead of pushing Send off-screen on a narrow phone --');
  // Adding speak/voice-mode icons to the compose bar this session grew it
  // past what fits in one row on an actual phone width - .ia had no
  // flex-wrap, so Send silently overflowed past the right edge instead of
  // wrapping to a second line.
  const defaultViewport = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(150);
  const sendBoxNarrow = await page.locator('#sendBtn').boundingBox();
  assert(sendBoxNarrow && (sendBoxNarrow.x + sendBoxNarrow.width) <= 375, `Send stays fully on-screen at a 375px phone width instead of overflowing (right edge at ${sendBoxNarrow ? (sendBoxNarrow.x + sendBoxNarrow.width).toFixed(0) : 'N/A'}px)`);
  if (defaultViewport) await page.setViewportSize(defaultViewport);
  await page.waitForTimeout(150);

  console.log('\n-- the Coding indicator lives in the status bar, not the cramped header row, so the version number stays fully visible --');
  // A real user report showed the version number getting covered up once
  // a Coding badge was added to the same header row as "ai-router vX.X".
  // Rather than keep shrinking things to fight for space there, the
  // indicator now lives in the systemToggle status bar below the header,
  // which already exists for this kind of contextual text.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(300);
  const narrowViewportForCoding = page.viewportSize();
  // 375px, matching this suite's own established "narrow phone" baseline
  // (see the compose-bar test above) - an even narrower width like 320px
  // truncates the version number regardless of the Coding indicator, so
  // it isn't a meaningful width to assert full visibility at.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(150);
  const versionNotTruncated = await page.evaluate(() => {
    var el = document.querySelector('.wm');
    return el.scrollWidth <= el.clientWidth + 1;
  });
  assert(versionNotTruncated, 'the version number renders in full instead of being truncated, now that the Coding indicator no longer competes for header space');
  const codingIndicatorInStatusBar = await page.evaluate(() => document.getElementById('activePromptName').textContent.indexOf('Coding') >= 0);
  assert(codingIndicatorInStatusBar, 'the Coding indicator shows in the status bar below the header instead');
  if (narrowViewportForCoding) await page.setViewportSize(narrowViewportForCoding);
  await page.waitForTimeout(150);
  // Switch away from the Coding tab this test created - leaving it active
  // would route every later test's message straight to the coding agent
  // instead of the plain chat flow those tests actually mean to exercise.
  await page.locator('#tabBar .tabpill').first().click();
  await page.waitForTimeout(400);

  console.log('\n-- a splash screen shows on load with the app\'s own branding, then gets out of the way on its own --');
  // A real request: replace the generic app icon/branding with the app's
  // actual logo, shown as a proper splash screen while the app boots -
  // not gated behind anything, and not something the user has to dismiss.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const splashExistsOnLoad = await page.evaluate(() => !!document.getElementById('splashScreen'));
  assert(splashExistsOnLoad, 'the splash screen element is present as soon as the page loads');
  let splashGone = false;
  for (let i = 0; i < 30; i++) {
    splashGone = await page.evaluate(() => {
      const el = document.getElementById('splashScreen');
      return !el || el.classList.contains('hide');
    });
    if (splashGone) break;
    await page.waitForTimeout(200);
  }
  assert(splashGone, 'the splash screen hides itself automatically once the app finishes loading, with no tap required');
  const appUsableAfterSplash = await page.evaluate(() => !!document.getElementById('prompt') && !document.getElementById('sendBtn').disabled);
  assert(appUsableAfterSplash, 'the app underneath is fully interactive once the splash clears');

  console.log('\n-- a fresh deploy applies itself automatically instead of waiting for a tap --');
  // Field techs on iPhone struggle even with clearing a cache, so the app
  // no longer shows a "refresh to update" button - checkForFreshVersion
  // (the safety net for a plain index.html-only deploy, which never
  // touches sw.js's own bytes so the service worker's own update path
  // never fires) now reloads on its own once it detects a version
  // mismatch. Stub the app's own reload indirection (performUpdateReload)
  // rather than window.location.reload directly - Location's methods
  // aren't a plain writable data property in every engine, so overriding
  // it in-place can silently fail to stick and let a real navigation
  // through, tearing down the page mid-suite.
  await page.evaluate(() => { window.__reloadCalls = 0; window.performUpdateReload = () => { window.__reloadCalls++; }; });
  await page.route('**/index.html', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<span class="wm">ai-router <span>v9.99</span></span>',
    });
  });
  await page.evaluate(() => window.checkForFreshVersion());
  await page.waitForTimeout(300);
  await page.unroute('**/index.html');
  const reloadedWhenIdle = await page.evaluate(() => window.__reloadCalls);
  assert(reloadedWhenIdle === 1, `a fresh version detected while idle reloads automatically with no tap required (reload calls: ${reloadedWhenIdle})`);
  const noticeFlagSet = await page.evaluate(() => localStorage.getItem('ai_router_updated_notice') === '1');
  assert(noticeFlagSet, 'a notice flag is persisted across the reload so the next load can confirm the update happened');
  await page.evaluate(() => localStorage.removeItem('ai_router_updated_notice'));

  console.log('\n-- an update detected mid-request is deferred, then applied automatically once things go idle --');
  // Yanking the page out from under an in-flight send/coding-agent round
  // would be worse than a stale version string, so the reload has to wait
  // for isAppBusyForUpdate() to clear - simulate "busy" through that same
  // seam rather than reaching into sending/codingAgentActive directly.
  await page.evaluate(() => {
    window.__reloadCalls = 0;
    window.__realIsAppBusyForUpdate = window.isAppBusyForUpdate;
    window.isAppBusyForUpdate = () => true;
  });
  await page.route('**/index.html', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<span class="wm">ai-router <span>v9.99</span></span>',
    });
  });
  await page.evaluate(() => window.checkForFreshVersion());
  await page.waitForTimeout(300);
  await page.unroute('**/index.html');
  const deferredNotReloaded = await page.evaluate(() => window.__reloadCalls === 0);
  assert(deferredNotReloaded, 'the update is not applied while the app reports itself busy');
  await page.evaluate(() => { window.isAppBusyForUpdate = window.__realIsAppBusyForUpdate; });
  await page.waitForTimeout(2300); // the queued-update poller rechecks every 2s
  const appliedOnceIdle = await page.evaluate(() => window.__reloadCalls === 1);
  assert(appliedOnceIdle, 'the deferred update applies itself automatically once the app goes idle, with no further action needed');
  await page.evaluate(() => localStorage.removeItem('ai_router_updated_notice'));

  console.log('\n-- Overseer button pulses while the router evaluates which model fits the message just sent --');
  // The actual scoring is synchronous and near-instant, which made the
  // routing decision invisible - a message that kept the same model looked
  // identical to the router not running at all. A floor on how long the
  // pulse shows (not on the scoring itself) makes every decision briefly
  // visible on the Overseer button, and clears once the decision lands.
  await page.fill('#prompt', 'regtest message to check the thinking pulse');
  await page.click('#sendBtn');
  let sawThinkingClass = false;
  for (let i = 0; i < 40; i++) {
    const hasThinking = await page.evaluate(() => document.getElementById('overseerBtn').classList.contains('thinking'));
    if (hasThinking) { sawThinkingClass = true; break; }
    await page.waitForTimeout(20);
  }
  assert(sawThinkingClass, 'the Overseer button gets a "thinking" pulse class while the router evaluates the message');
  await dismissConfirmIfAny();
  await waitForSendDone();
  const thinkingClassClearedAfter = await page.evaluate(() => document.getElementById('overseerBtn').classList.contains('thinking'));
  assert(!thinkingClassClearedAfter, 'the "thinking" pulse clears once the routing decision is made');

  console.log('\n-- renderMd escapes markdown-link URLs instead of letting them break out of the href attribute --');
  // esc() only neutralizes &, <, > - a model reply (which can carry
  // attacker-controlled text echoed back from a web search result) could
  // previously put an unescaped " in the URL capture and inject arbitrary
  // HTML attributes/event handlers. Drive it through the real send pipeline
  // (renderMd itself isn't window-exposed - both script blocks are IIFEs)
  // and inspect the rendered bubble.
  const maliciousReply = '[click](" onmouseover="alert(1)" x="https://evil.example) [js](javascript:alert(1)) [safe](https://example.com/path?a=1&b=2)';
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === false) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }] }) });
        return;
      }
      if (parsed && parsed.stream === true) {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'data: ' + JSON.stringify({ choices: [{ delta: { content: maliciousReply } }] }) + '\n\ndata: [DONE]\n\n',
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('regtest xss link check');
  await page.unroute('**/*');
  const xssReplyHtml = await page.evaluate(() => {
    const bubbles = document.querySelectorAll('#chat .msg.ma3 .body');
    return bubbles.length ? bubbles[bubbles.length - 1].innerHTML : '';
  });
  assert(xssReplyHtml.indexOf('onmouseover=') < 0, `a crafted markdown link cannot inject an HTML attribute like onmouseover (got: ${xssReplyHtml})`);
  assert(!/<a[^>]*javascript:/i.test(xssReplyHtml), `a javascript: URL is not rendered as a clickable link (got: ${xssReplyHtml})`);
  assert(xssReplyHtml.indexOf('<a href="https://example.com/path?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">safe</a>') >= 0, `a normal https link still renders as a clickable anchor (got: ${xssReplyHtml})`);

  console.log('\n-- an image with repo-flavored text still goes to a vision model, not the coding agent --');
  // The coding-agent routing check used to fire regardless of whether the
  // message had an image attached - a photo with "does this match the
  // repo's style" would silently skip vision entirely and the image
  // would never actually get analyzed.
  let sawCodingAgentForImageMsg = false;
  let sawVisionModelRequest = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        sawCodingAgentForImageMsg = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest should not happen' } }] }) });
        return;
      }
      if (parsed && parsed.model === 'Qwen/Qwen3-VL-30B-A3B-Instruct' && parsed.stream === true) {
        sawVisionModelRequest = true;
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"regtest image analysis"}}]}\n\ndata: [DONE]\n\n' });
        return;
      }
    }
    await route.continue();
  });
  const fileInputRepoImg = await page.$('#fileInput');
  await fileInputRepoImg.setInputFiles(imgPath);
  await waitForAttachCount(1);
  await sendMsg('does this match the repo style guide');
  await page.unroute('**/*');
  assert(!sawCodingAgentForImageMsg, 'an image message never routes to the coding agent even with repo-flavored text');
  assert(sawVisionModelRequest, 'the image still gets sent to a vision model');

  console.log('\n-- vision grace-period state does not leak across a new tab --');
  // preVisionModel is reset on new-tab creation but msgsSinceLastImage
  // wasn't, so a residual count from a previous tab's image interaction
  // could cut the new tab's own one-message grace period short.
  const fileInputLeakA = await page.$('#fileInput');
  await fileInputLeakA.setInputFiles(imgPath);
  await waitForAttachCount(1);
  await sendMsg('what is in this image');
  await sendMsg('thanks, tell me more');
  await page.click('#newTabBtn'); await page.waitForTimeout(400);
  const fileInputLeakB = await page.$('#fileInput');
  await fileInputLeakB.setInputFiles(imgPath);
  await waitForAttachCount(1);
  await sendMsg('what is in this image');
  const modelDuringTabB = await page.textContent('#modelBtnLabel');
  await sendMsg('thanks, tell me more');
  const modelAfterOneFollowupTabB = await page.textContent('#modelBtnLabel');
  assert(modelAfterOneFollowupTabB === modelDuringTabB, `a new tab gets its own full one-message vision grace period, not a leftover count from a previous tab (during="${modelDuringTabB}" after one follow-up="${modelAfterOneFollowupTabB}")`);

  console.log('\n-- Recent Chats: an individual entry can be removed instead of only ever auto-evicted by the FIFO cap --');
  // There used to be no way to remove a single Recent Chats entry on
  // purpose - it only ever changed when a 6th save evicted the oldest one.
  await page.click('#newTabBtn'); await page.waitForTimeout(300);
  await sendMsg('regtest recent-delete unique message');
  await page.click('#clearBtn'); await page.waitForTimeout(200);
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#recentChatsBtn'); await page.waitForTimeout(200);
  const recentEntryPresent = await page.evaluate(() => document.getElementById('recentList').textContent.indexOf('regtest recent-delete unique message') >= 0);
  assert(recentEntryPresent, 'the just-cleared chat shows up in the Recent Chats list');
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#recentList .ri'));
    const row = rows.find((r) => r.textContent.indexOf('regtest recent-delete unique message') >= 0);
    row.querySelector('.cdb').click();
  });
  await page.waitForTimeout(200);
  const recentEntryRemovedFromDom = await page.evaluate(() => document.getElementById('recentList').textContent.indexOf('regtest recent-delete unique message') < 0);
  assert(recentEntryRemovedFromDom, 'deleting a Recent Chats entry removes it from the list immediately');
  await page.click('#closeRecentModal'); await page.waitForTimeout(150);
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#recentChatsBtn'); await page.waitForTimeout(200);
  const recentEntryStaysGoneAfterReopen = await page.evaluate(() => document.getElementById('recentList').textContent.indexOf('regtest recent-delete unique message') < 0);
  assert(recentEntryStaysGoneAfterReopen, 'the deletion actually persisted to storage, not just the in-memory render');
  await page.click('#closeRecentModal'); await page.waitForTimeout(150);

  console.log('\n-- Overseer proactively suggests saving a settled conversation as a Work Project, but only when the model itself flags it --');
  // Message count alone used to trigger this (8 messages in) even for
  // ordinary small talk; now it's gated on the model's own <project_suggest/>
  // self-flag (see getModelSystemPrompt), same pattern as <memory>. A long
  // but unflagged conversation should NOT get the banner - only once a reply
  // actually includes the tag should it appear; accepting it then generates
  // a name/instructions from the conversation and actually creates it.
  await page.click('#newTabBtn'); await page.waitForTimeout(400);
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.click('#openrouterBtn'); await page.waitForTimeout(300);
  await page.click('#closeModelModal'); await page.waitForTimeout(150);
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === true) {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"regtest settle reply"}}]}\n\ndata: [DONE]\n\n' });
        return;
      }
    }
    await route.continue();
  });
  for (let i = 0; i < 4; i++) {
    await sendMsg(`regtest settle message ${i}`);
  }
  await page.unroute('**/*');
  const noProjectSuggestionFromCountAlone = await page.evaluate(() => document.getElementById('chat').textContent.indexOf('Save this conversation as a reusable project') < 0);
  assert(noProjectSuggestionFromCountAlone, 'a long but unflagged conversation (8 messages, no <project_suggest/>) does NOT get offered as a project on message count alone');
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === true) {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"regtest settled reply <project_suggest/>"}}]}\n\ndata: [DONE]\n\n' });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('regtest settle message flagged');
  await page.unroute('**/*');
  const projectSuggestionVisible = await page.evaluate(() => document.getElementById('chat').textContent.indexOf('Save this conversation as a reusable project') >= 0);
  assert(projectSuggestionVisible, 'a suggestion to save the conversation as a project appears once the model actually self-flags it with <project_suggest/>');
  const tagNotLeakedIntoReply = await page.evaluate(() => document.getElementById('chat').textContent.indexOf('project_suggest') < 0);
  assert(tagNotLeakedIntoReply, 'the <project_suggest/> tag itself is stripped from the rendered reply, not shown as raw text');
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.messages && parsed.messages.some((m) => typeof m.content === 'string' && m.content.indexOf('invent a short project name') >= 0)) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"name":"Regtest Auto Project","instructions":"Regtest auto instructions"}' } }] }) });
        return;
      }
    }
    await route.continue();
  });
  await page.click('#chat button:has-text("Save as Project")');
  await page.waitForTimeout(500);
  await page.unroute('**/*');
  const autoProjectCreated = await page.evaluate(() => {
    const raw = localStorage.getItem(Object.keys(localStorage).find((k) => k.indexOf('ai_workprojects') >= 0));
    const parsed = raw ? JSON.parse(raw) : [];
    return parsed.some((p) => p.title === 'Regtest Auto Project' && p.instructions === 'Regtest auto instructions');
  });
  assert(autoProjectCreated, 'accepting the suggestion creates the Work Project with the model-generated name/instructions');

  console.log('\n-- an explicit topic-change phrase prompts before starting a new tab --');
  const tabCountBeforeTopicChange = await page.evaluate(() => document.querySelectorAll('#tabBar .tabpill').length);
  page.once('dialog', async (dialog) => { await dialog.accept(); });
  await page.fill('#prompt', 'ok, new topic - what is the capital of France');
  await page.click('#sendBtn');
  await page.waitForTimeout(600);
  await dismissConfirmIfAny();
  await waitForSendDone();
  const tabCountAfterTopicChange = await page.evaluate(() => document.querySelectorAll('#tabBar .tabpill').length);
  assert(tabCountAfterTopicChange === tabCountBeforeTopicChange + 1, `an explicit topic-change phrase prompts to start a new tab, and accepting creates one (before=${tabCountBeforeTopicChange}, after=${tabCountAfterTopicChange})`);

  console.log(`\n-- page errors: ${realErrors().length} real (excluding expected sandbox network noise) --`);
  if (realErrors().length) console.log(realErrors());
  failures += realErrors().length;

  await browser.close();

  console.log(`\n=== ${failures === 0 ? 'PASS' : 'FAIL'}: ${failures} failure(s) ===`);
  process.exit(failures === 0 ? 0 : 1);
})();
