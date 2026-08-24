/* Regression smoke test for index.html - run before every commit that
   touches app logic. Requires a local static server on :8899 serving the
   repo root (e.g. `npx http-server . -p 8899`) and Playwright with a
   Chromium build available. Exits non-zero on any failed assertion.

   Covers the flows that have actually broken in this app before:
   - basic send
   - a send error keeping the message in history (Regen stays usable,
     tabs/storage don't silently lose the message)
   - a send that fails while the tab was hidden auto-retries once on its
     own the moment the tab becomes visible again, instead of leaving the
     user to notice the error and tap Regen themselves
   - vision model auto-switch on image attach, and auto-restore after
   - memory add/delete
   - tab creation, per-tab isolation, and switching back
   - closing a background tab only removes that one tab (never more) and
     confirms with a toast stating how many remain, including an explicit
     "1 tab left" when the tab bar itself disappears; closing the active
     tab mid-send is blocked with a clear toast instead of doing nothing
   - profile creation and data isolation
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
   - App-control tools (create_project/remember) execute immediately on a
     model tool_call, with real observable side effects
   - hardcoded app-structure knowledge only appears in the coding agent's
     own system prompt when GitHub is connected to this actual repo, not
     some other repo - checked under both the current repo name and the
     pre-rename one (openai-router -> AI-Router), so a connection saved
     before the rename doesn't silently lose it
   - the main chat model is never told it has repository tools - that
     system-prompt text lives only in the dedicated coding agent's prompt
   - repo tools are gated on actual repo/GitHub signal, not generic coding
     keywords - a message about an unrelated new app doesn't route to the
     coding agent just for sounding code-flavored
   - a model that comes back with a genuinely empty completion (e.g. it
     burned its turn on tool_calls and had nothing left once locked to
     tool_choice:"none") triggers exactly one automatic fallback retry on a
     different tool-capable model instead of just showing "(empty response)"
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
     when speaking
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
   - the main chat's reply label reads "Assistant", with the model that
     actually answered shown as a secondary indicator rather than the
     primary identity
   - the main chat also gets one automatic retry when the model writes
     fake tool-call syntax as plain text (e.g. an invented
     <function=some_tool>{...}</function>) instead of an actual answer -
     the same fix already covering the dedicated coding agent, now
     applied to the ordinary chat path too
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
   - the dedicated coding agent's own console is labeled "Assistant" too
     (with its fixed model as a secondary indicator), consistent with
     the main chat's labeling
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

  async function waitForSendDone() {
    // 25 * 300ms (7.5s) assumed the sandbox's proxy rejects the (expected
    // to fail) worker requests almost instantly. That rejection latency
    // varies and was creeping past 7.5s, so this returned early with the
    // send still genuinely in flight - every assertion checking "did it
    // finish" then read stale mid-request state and failed for a reason
    // that had nothing to do with app correctness. 400 * 300ms (2 min)
    // gives real slow-rejection cases ample room while still catching a
    // genuine hang eventually.
    //
    // Failing loudly here (instead of just returning) matters as much as
    // the budget itself: silently giving up left the app's `sending` flag
    // still true, which made createNewTab() and other `if(sending)return`
    // guards silently no-op in whatever test happened to run next -
    // surfacing as "tab count is 0" or similar assertions with no visible
    // connection to the real cause. Throwing here instead puts the failure
    // at its actual source, with a message that says what's actually wrong.
    for (let i = 0; i < 400; i++) {
      const t = await page.textContent('#sendBtn');
      if (t.indexOf('Send') >= 0) return;
      await page.waitForTimeout(300);
    }
    throw new Error('waitForSendDone: #sendBtn never returned to "Send" after 120s - a send is genuinely stuck (or the sandbox network proxy is unusually slow to reject the expected-to-fail worker request). Check the last message sent for what triggered it.');
  }
  async function sendMsg(text) {
    await page.fill('#prompt', text);
    await page.click('#sendBtn');
    await page.waitForTimeout(600);
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

  console.log('\n-- basic send --');
  await sendMsg('hi there, quick test');
  const chatTextAfterBasicSend = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(chatTextAfterBasicSend.indexOf('quick test') >= 0, 'the sent message actually renders in the chat');

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
  // App-control tools (create_project/remember) are always attached for a
  // tool-capable model now, regardless of relevance - only
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
  // A real transcript: the agent repeatedly wrote a sentence describing the
  // next step ("Let me check X") with no accompanying tool call, over and
  // over - the existing reminder only ever kicked in reactively, AFTER a
  // stall had already happened once in that tab. This instruction is
  // baked into every coding-agent system prompt from the start, not just
  // after the fact.
  assert(!!codingAgentSystemMsg && (codingAgentSystemMsg.content || '').indexOf("don't write a sentence describing what you're about to do and then stop without calling anything") >= 0, 'the coding agent is proactively told to call the tool in the same turn instead of just narrating the next step, from the very first round - not only after a stall has already happened once');
  // list_files used to require a path, so the model had no legitimate way
  // to ask for "the whole repo" - it had to guess a path or get an error
  // either way. Confirm the tool's own schema no longer forces one.
  const listFilesTool = (lastCodingAgentBody.tools || []).find((t) => t.function.name === 'list_files');
  assert(listFilesTool && !(listFilesTool.function.parameters.required || []).includes('path'), 'list_files no longer requires a path - omitting it can mean "list the repo root"');
  // A real report from a different connected repo: a rename (error ->
  // sendError) never got propagated to its callers, a class (AppError) was
  // imported but never actually created, and a build step assumed
  // frontend tooling that the deploy environment's root package.json never
  // installs - all three broke that repo's build permanently, not just the
  // one PR that introduced them. Baked into the system prompt now, for any
  // connected repo, not just this one.
  assert(!!codingAgentSystemMsg && (codingAgentSystemMsg.content || '').indexOf('every file that imports or calls it under the old name is found') >= 0, 'the coding agent is told to find and update every caller of a renamed/removed symbol, not just the definition');
  assert(!!codingAgentSystemMsg && (codingAgentSystemMsg.content || '').indexOf('confirm it actually exists somewhere in the repo') >= 0, 'the coding agent is told to verify a referenced symbol actually exists instead of assuming it does');
  assert(!!codingAgentSystemMsg && (codingAgentSystemMsg.content || '').indexOf('the actual build/deploy environment only installs dependencies where its own config points') >= 0, 'the coding agent is told to check which package.json/config the deploy environment actually uses before adding a build step or dependency');
  const chatTextAfterCodingAgent = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(chatTextAfterCodingAgent.indexOf('Assistant') >= 0, "repo work renders as a normal Assistant reply, labeled consistently with the main chat");
  assert(chatTextAfterCodingAgent.indexOf('README describes this project') >= 0, "the coding agent's final answer actually renders");

  console.log('\n-- 3+ rounds of "Continue with the next step" in a row still keep routing to the dedicated coding agent --');
  // A generic "Continue with the next step: X" message scores zero on
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

  console.log('\n-- read_file forwards an explicit branch, so a merge conflict can actually be resolved instead of just reported --');
  // A real report: merge_branch's conflict error had nowhere to send the
  // model - read_file always read the repo's default branch no matter
  // what, so there was no way to see the WORKING branch's version of a
  // conflicting file to reconcile it by hand. read_file now takes an
  // optional branch and forwards it straight through to the worker.
  let readFileBranchWorkerBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 'regtest_read_branch', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/App.js', branch: 'ai-changes' }) } }] } }] }),
        });
        return;
      }
      if (parsed && parsed.op === 'read_file') {
        readFileBranchWorkerBody = parsed;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, content: 'regtest branch-specific content', sha: 'regtestsha' }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please read src/App.js on the ai-changes branch to resolve a conflict');
  for (let i = 0; i < 40 && readFileBranchWorkerBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  assert(!!readFileBranchWorkerBody, 'a read_file call with an explicit branch actually reaches the GitHub ops worker');
  assert(readFileBranchWorkerBody.branch === 'ai-changes', `the requested branch is forwarded to the worker, not silently dropped (got: ${JSON.stringify(readFileBranchWorkerBody)})`);

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

  console.log('\n-- a fast double-tap on one tab\'s close button only removes that one tab, not two --');
  // A real user report: deleting a tab sometimes "takes out" more than the
  // one tab. renderTabBar() rebuilds the whole bar (and every pill's
  // screen position) synchronously inside closeTab - a second physical tap
  // that lands right after the first can land on whatever now occupies
  // that same spot once the bar has already reflowed, closing a second,
  // unintended tab. Two back-to-back clicks on the same X (no wait between
  // them, simulating a double-tap) should only ever close one tab.
  await page.click('#newTabBtn'); await page.waitForTimeout(400);
  await page.click('#newTabBtn'); await page.waitForTimeout(400);
  await page.click('#newTabBtn'); await page.waitForTimeout(400);
  const tabCountBeforeDoubleTap = await page.evaluate(() => document.querySelectorAll('#tabBar .tabpill').length);
  assert(tabCountBeforeDoubleTap === 4, `test setup: 4 tabs open before the double-tap check (got ${tabCountBeforeDoubleTap})`);
  const doubleTapTarget = page.locator('#tabBar .tabpill').nth(1).locator('.tpx');
  await Promise.all([doubleTapTarget.click().catch(() => {}), doubleTapTarget.click().catch(() => {})]);
  await page.waitForTimeout(400);
  const tabCountAfterDoubleTap = await page.evaluate(() => document.querySelectorAll('#tabBar .tabpill').length);
  assert(tabCountAfterDoubleTap === 3, `a fast double-tap on one X removes exactly one tab, not two (got ${tabCountAfterDoubleTap} remaining, expected 3)`);
  await page.waitForTimeout(600); // let the close-guard cooldown fully clear before the next test touches a tab X
  while ((await page.evaluate(() => document.querySelectorAll('#tabBar .tabpill').length)) > 1) {
    await page.locator('#tabBar .tabpill').first().locator('.tpx').click();
    await page.waitForTimeout(600);
  }

  console.log('\n-- a fresh, still-empty Coding tab keeps showing "Coding" instead of reverting to a generic "New chat" --');
  // A real user report: making a Coding tab, then doing anything else,
  // made it look like a plain tab had replaced it - tabTitleFor() derived
  // every empty tab's title as "New chat" regardless of codingMode, so the
  // very first autoSave/tab-switch after creation (well before any message
  // is sent) silently relabeled the pill from "💻 Coding" to "💻 New chat",
  // indistinguishable from an ordinary tab except for the icon.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  await page.click('#newTabBtn'); await page.waitForTimeout(400);
  const codingTabTitleAfterSwitch = await page.evaluate(() => Array.from(document.querySelectorAll('#tabBar .tabpill .tpt')).map((e) => e.textContent));
  assert(codingTabTitleAfterSwitch.indexOf('💻 Coding') >= 0, `an empty Coding tab keeps its distinct "Coding" label after switching away from it, not a generic "New chat" (got: ${JSON.stringify(codingTabTitleAfterSwitch)})`);
  while ((await page.evaluate(() => document.querySelectorAll('#tabBar .tabpill').length)) > 1) {
    await page.locator('#tabBar .tabpill').first().locator('.tpx').click();
    await page.waitForTimeout(600);
  }

  console.log('\n-- closing the active tab mid-send is blocked with a clear toast instead of silently doing nothing --');
  // sending only reflects the ACTIVE tab's own in-flight request - it used
  // to block closing ANY tab (even unrelated background ones) with zero
  // feedback, which is the other half of the "X just turns red, nothing
  // happens" report.
  await page.click('#newTabBtn'); await page.waitForTimeout(400);
  let releaseSlowSend = null;
  let slowSendCaptured = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === true) {
        slowSendCaptured = true;
        await new Promise((resolve) => { releaseSlowSend = resolve; });
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"regtest slow reply"}}]}\n\ndata: [DONE]\n\n' });
        return;
      }
    }
    await route.continue();
  });
  await page.fill('#prompt', 'regtest message that stays in flight');
  await page.click('#sendBtn');
  // Wait for the route handler to actually have captured this request
  // (slowSendCaptured/releaseSlowSend set) instead of a fixed delay - a
  // fixed wait here raced against the mocked fetch actually reaching
  // Playwright's route layer under real sandbox network/proxy jitter.
  // Losing that race left releaseSlowSend still null when this test called
  // it below, silently no-op'ing (`if (releaseSlowSend)` guard) - by the
  // time the real request DID arrive moments later, it set up its own
  // fresh unresolved promise nothing would ever call, hanging the send
  // forever (not just slowly) and cascading into every later test that
  // checks the app's `sending` flag (tab creation, the Coding-tab guard,
  // etc.) with failures that looked completely unrelated to the real cause.
  for (let i = 0; i < 50; i++) {
    if (slowSendCaptured) break;
    await page.waitForTimeout(100);
  }
  if (!slowSendCaptured) throw new Error('mid-send close-block test: the mocked stream:true request never reached the route handler within 5s - cannot safely proceed.');
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
  // run_tests/get_test_status are hardcoded to this app's own test.yml
  // workflow - offering them for an unrelated connected repo (regtest-repo-b
  // here) guarantees a 404 the moment the model tries them, since that
  // workflow doesn't exist there. A real report: the model called run_tests
  // on an unrelated connected repo and got a 404 - not a branch problem,
  // the workflow itself was never going to exist for that repo.
  const firstTurnToolNames = ((repoChangeRequestBodies[0] && repoChangeRequestBodies[0].tools) || []).map((t) => t.function.name);
  const secondTurnToolNames = ((repoChangeRequestBodies[1] && repoChangeRequestBodies[1].tools) || []).map((t) => t.function.name);
  assert(firstTurnToolNames.indexOf('run_tests') >= 0 && firstTurnToolNames.indexOf('get_test_status') >= 0, `run_tests/get_test_status are offered when connected to this app's own repo (got: ${JSON.stringify(firstTurnToolNames)})`);
  assert(secondTurnToolNames.indexOf('run_tests') < 0 && secondTurnToolNames.indexOf('get_test_status') < 0, `run_tests/get_test_status are withheld for an unrelated connected repo, since that workflow can't exist there (got: ${JSON.stringify(secondTurnToolNames)})`);

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
  // Settings was left open by the previous test - close it explicitly so
  // it doesn't intercept clicks meant for whatever modal the next test opens.
  await page.click('#closeSettingsModal'); await page.waitForTimeout(150);

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
  // block below (same connection, reused) depend on actually happening.
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
  // interacting.
  await page.waitForTimeout(500);

  console.log('\n-- run_tests defaults to the task\'s active branch instead of the repo default when the model omits one --');
  // The write_file step above already picked and approved "ai-changes" as
  // this task's working branch (codingAgentActiveBranch). A real failure:
  // run_tests used to forward whatever branch string the model typed (or
  // fall through to the repo default when omitted) with no link back to
  // that branch, so an omitted or misremembered branch silently dispatched
  // against the wrong ref. An omitted branch here must resolve to
  // "ai-changes", not the repo default.
  let capturedRunTestsBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.indexOf('github-ops-worker') >= 0 && req.method() === 'POST') {
      try { capturedRunTestsBody = JSON.parse(req.postData()); } catch (e) {}
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, run_id: 4242, html_url: 'https://github.com/solmasta/openai-router/actions/runs/4242' }),
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
                tool_calls: [{
                  id: 'regtest_run_tests_1',
                  type: 'function',
                  function: { name: 'run_tests', arguments: JSON.stringify({}) },
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
  // Deliberately avoids "now"/"current"/"latest" etc. - those trip the
  // app's own time-sensitive-message gate (see doSendRequest's
  // seemsTimeSensitive check) and fire a real, awaited web search before
  // the coding-agent call, which raced unpredictably against this test's
  // own timing in the sandbox's no-egress network.
  await page.fill('#prompt', 'please run the tests on this repo branch');
  await page.click('#sendBtn');
  await waitForSendDone();
  // waitForSendDone() flips back as soon as the Send button label resets,
  // but the round's tool-call/result handling (Terminal log entry, the
  // Continue button appearing) can still be settling a beat after that -
  // same reasoning as the merge_branch step above.
  await page.waitForTimeout(500);
  // Wait out any stray in-flight request (e.g. a background search fetch
  // this send may have kicked off) before unrouting - otherwise it can
  // still be pending when unroute() lifts the mock, escape to the real
  // network, and land during some LATER test's own route capture window
  // instead of failing harmlessly here.
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.unroute('**/*');
  assert(!!capturedRunTestsBody, 'a run_tests tool call actually reaches the GitHub ops worker');
  assert(capturedRunTestsBody && capturedRunTestsBody.op === 'trigger_workflow', `the worker request is tagged with the trigger_workflow op (got "${capturedRunTestsBody && capturedRunTestsBody.op}")`);
  assert(capturedRunTestsBody && capturedRunTestsBody.ref === 'ai-changes', `an omitted branch defaults to the task's active branch instead of the repo default (got ref "${capturedRunTestsBody && capturedRunTestsBody.ref}")`);
  await page.waitForTimeout(500);

  console.log('\n-- a run_tests failure names the task\'s real active branch as a correction hint when the model guessed a different one --');
  // The original bug report: the model dispatched run_tests against a
  // branch that was never actually pushed (a stale/hallucinated guess),
  // which 404s at GitHub's dispatch endpoint with an opaque error and no
  // way for the model to know the real branch. The app now appends that
  // branch to the error text itself so the model can self-correct on the
  // very next round instead of repeating the same bad dispatch.
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.indexOf('github-ops-worker') >= 0 && req.method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Failed to dispatch workflow: HTTP 404 Not Found' }),
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
                tool_calls: [{
                  id: 'regtest_run_tests_2',
                  type: 'function',
                  function: { name: 'run_tests', arguments: JSON.stringify({ branch: 'code-quality-improvements' }) },
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
  await page.fill('#prompt', 'run the repo tests on branch code-quality-improvements');
  await page.click('#sendBtn');
  await waitForSendDone();
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.unroute('**/*');
  const terminalLogTextAfterBadBranch = await page.evaluate(() => document.getElementById('terminalLog').textContent);
  assert(terminalLogTextAfterBadBranch.indexOf("actual working branch is 'ai-changes'") >= 0, `a run_tests failure on a mismatched branch names the task's real active branch as a correction hint (got tail: ${terminalLogTextAfterBadBranch.slice(-400)})`);
  await page.waitForTimeout(500);

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
  let fakeToolCallRetryToolChoice = null;
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
        fakeToolCallRetryToolChoice = parsed.tool_choice;
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
  // A wording nudge alone was not enough - a real user report showed the
  // retry itself sometimes narrating again instead of calling a tool.
  // tool_choice:"required" forces the API to reject a plain-text answer
  // for this one retry round, rather than just asking nicely.
  assert(fakeToolCallRetryToolChoice === 'required', `the retry round forces tool_choice:"required" so the model can't just narrate again (got ${JSON.stringify(fakeToolCallRetryToolChoice)})`);
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
  let capabilityDenialRetryToolChoice = null;
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
        capabilityDenialRetryToolChoice = parsed.tool_choice;
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
  assert(capabilityDenialRetryToolChoice === 'required', `the retry round forces tool_choice:"required" so the model can't just deny access again in plain text (got ${JSON.stringify(capabilityDenialRetryToolChoice)})`);
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
  let stallRetryToolChoice = null;
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
        stallRetryToolChoice = parsed.tool_choice;
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
  assert(stallRetryToolChoice === 'required', `the retry round forces tool_choice:"required" so the model can't just stall again in plain text (got ${JSON.stringify(stallRetryToolChoice)})`);
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

  console.log('\n-- a provider that rejects tool_choice:"required" falls back to a normal retry instead of dead-ending --');
  // Not every OpenAI-compatible provider necessarily accepts "required" -
  // if it comes back HTTP 400, the retry should fall back to a plain
  // "auto" round instead of showing a dead-end error and killing the
  // session over a parameter the provider just doesn't support.
  let requiredFallbackRoundCount = 0;
  let requiredFallbackSawRequired = false;
  let requiredFallbackToolChoiceOnRetry = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        requiredFallbackRoundCount++;
        if (requiredFallbackRoundCount === 1) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'tool_code\nprint(list_files())' } }] }) });
          return;
        }
        if (requiredFallbackRoundCount === 2) {
          requiredFallbackSawRequired = parsed.tool_choice === 'required';
          await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'tool_choice value "required" is not supported' }) });
          return;
        }
        requiredFallbackToolChoiceOnRetry = parsed.tool_choice;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest recovered after required rejected' } }] }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please check the repo one more time');
  let chatTextAfterRequiredFallback = '';
  for (let i = 0; i < 60; i++) {
    chatTextAfterRequiredFallback = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextAfterRequiredFallback.indexOf('regtest recovered after required rejected') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(requiredFallbackSawRequired, 'test setup: the retry round actually requested tool_choice:"required"');
  assert(requiredFallbackToolChoiceOnRetry !== 'required', `after a 400 rejecting "required", the fallback round drops back to "auto" instead of repeating the same rejected value (got ${JSON.stringify(requiredFallbackToolChoiceOnRetry)})`);
  assert(chatTextAfterRequiredFallback.indexOf('I hit an error and could not continue') === -1, 'a 400 rejecting tool_choice:"required" does not show the dead-end error message');
  assert(chatTextAfterRequiredFallback.indexOf('regtest recovered after required rejected') >= 0, 'the session recovers and renders the real answer once it falls back to "auto"');

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

  console.log('\n-- the repeat-cycle counter still climbs even when the failing retry comes back with completely different, non-matching wording --');
  // A real user report: as a long session dragged on, the model's
  // non-progress replies degraded into increasingly garbled/truncated
  // text ("I'm still working on reviewing and fixing the Pic", a stray
  // "<|im_start|>" token) that didn't match ANY of the four corrective-
  // retry regexes - the OLD counter only incremented when this round's
  // own wording matched the stalling pattern specifically, so it silently
  // stopped climbing (and the escalation note stopped appearing) the
  // moment the wording drifted, even though the underlying "still no tool
  // call" problem never went away. The counter must key off "a retry just
  // fired and we're still here", not "does this exact text match".
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  let garbledCycleRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        garbledCycleRoundCount++;
        // Round 1 (and round 3, after Continue) trip the stall detector so
        // the one-shot retry fires; round 2 (and round 4) - the retry's
        // own response - come back as unrelated garbled text that matches
        // none of the four regexes, simulating the reported degradation.
        const content = (garbledCycleRoundCount % 2 === 1)
          ? "I'll check the repo now. Let me verify the file first."
          : 'I\'m still working on reviewing and fixing the Pic';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please review the repo');
  let firstGarbledContinueBtn = null;
  for (let i = 0; i < 60; i++) {
    const btn = page.locator('#chat .msg.ma3 button:has-text("Continue")').last();
    if (await btn.count()) { firstGarbledContinueBtn = btn; break; }
    await page.waitForTimeout(200);
  }
  assert(!!firstGarbledContinueBtn, 'test setup: a Continue button appears after the first garbled-retry cycle');
  const chatTextAfterFirstGarbledCycle = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(chatTextAfterFirstGarbledCycle.indexOf('happened') === -1, 'no escalation note yet after only one garbled-retry cycle');
  await firstGarbledContinueBtn.click();
  for (let i = 0; i < 60 && garbledCycleRoundCount < 4; i++) await page.waitForTimeout(200);
  await page.waitForTimeout(500);
  await page.unroute('**/*');
  const chatTextAfterSecondGarbledCycle = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(chatTextAfterSecondGarbledCycle.indexOf('happened 2 times now in this conversation') >= 0, `the escalation note still appears on the second cycle even though neither retry's own response matched the stalling regex (chat tail: ${chatTextAfterSecondGarbledCycle.slice(-400)})`);

  console.log('\n-- the forced tool_choice:"required" escalation also applies when the user types a fresh message instead of tapping Continue --');
  // A real report: with the same tab already at codingAgentStallCycles>=2
  // (as it is right here, from the cycle just above), the user typed a new
  // follow-up message ("Ok", "Fix") instead of tapping the in-place
  // Continue button sitting right there. The Continue button's own onclick
  // already forces tool_choice:"required" once this count hits 2 - but
  // runCodingAgentTurn (every brand-new send) used to call
  // runCodingAgentRound() with no arguments at all, silently resetting back
  // to "auto" and letting the exact same narration-only stall recur. The
  // escalation needs to hold regardless of which path resumes the tab.
  // A successful tool_calls round in a Coding tab auto-continues into a
  // second round with normal "auto" (correct - round 1 proved the model
  // isn't stalling anymore) - only round 1 itself is the thing under test,
  // so a plain-text "stop" response ends the turn right there with nothing
  // to race against.
  let freshMessageAfterStallBody = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo' && freshMessageAfterStallBody === null) {
        freshMessageAfterStallBody = parsed;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest forced-required round answered directly' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('Ok');
  for (let i = 0; i < 40 && freshMessageAfterStallBody === null; i++) await page.waitForTimeout(200);
  await page.unroute('**/*');
  assert(freshMessageAfterStallBody && freshMessageAfterStallBody.tool_choice === 'required', `a brand-new typed message in an already-stalling tab (codingAgentStallCycles>=2) is sent with tool_choice:"required", the same escalation the Continue button already applies (got "${freshMessageAfterStallBody && freshMessageAfterStallBody.tool_choice}")`);
  await page.click('#newTabBtn'); await page.waitForTimeout(400);

  console.log('\n-- long coding-agent sessions trim old tool-result content instead of letting context grow forever --');
  // A real user report: a 100+-round session degraded into garbled,
  // truncated, glitchy replies (a stray "<|im_start|>" token leaking into
  // the output) as the accumulated tool-result content grew far past
  // anything the model could stay coherent over - msgs is mutated in
  // place across every round of one auto-continuing session with nothing
  // ever trimmed. 9 consecutive read_file rounds (each returning content
  // over the truncate threshold) should leave the OLDEST tool result
  // truncated once there are more than CODING_AGENT_KEEP_RECENT_TOOL_RESULTS
  // (8) of them, while the most recent ones stay untouched.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  let trimTestRoundCount = 0;
  let trimTestFinalBody = null;
  const trimTestBigContent = 'X'.repeat(500);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        trimTestRoundCount++;
        if (trimTestRoundCount <= 9) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_trim_' + trimTestRoundCount, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'file' + trimTestRoundCount + '.js' }) } }] } }] }),
          });
          return;
        }
        trimTestFinalBody = parsed;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest trim test final answer' } }] }) });
        return;
      }
      if (url.indexOf('github-ops-worker') >= 0 && parsed && parsed.op === 'read_file') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, content: trimTestBigContent }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please review every file in the repo one at a time');
  for (let i = 0; i < 90 && trimTestFinalBody === null; i++) await page.waitForTimeout(300);
  await page.unroute('**/*');
  assert(trimTestRoundCount === 10, `test setup: 9 tool-calling rounds plus a final answer round all auto-chained (got ${trimTestRoundCount} rounds)`);
  const trimTestToolMsgs = ((trimTestFinalBody && trimTestFinalBody.messages) || []).filter((m) => m.role === 'tool');
  assert(trimTestToolMsgs.length === 9, `test setup: 9 tool-result messages are present in the final round's request (got ${trimTestToolMsgs.length})`);
  const trimTestOldestToolMsg = trimTestToolMsgs[0];
  const trimTestNewestToolMsg = trimTestToolMsgs[trimTestToolMsgs.length - 1];
  assert(typeof trimTestOldestToolMsg.content === 'string' && trimTestOldestToolMsg.content.indexOf('truncated to keep context manageable') >= 0, `the oldest tool result gets its content truncated once the session has more tool results than the keep-recent budget (got: ${(trimTestOldestToolMsg.content || '').slice(0, 150)})`);
  assert(trimTestNewestToolMsg.content === trimTestBigContent, 'the most recent tool result keeps its full original content, not truncated');
  await page.click('#newTabBtn'); await page.waitForTimeout(400);

  console.log('\n-- a tool call that fails because auth actually broke mid-session stops the coding agent instead of narrate-looping forever --');
  // A real user report: an OAuth token expired partway through a long
  // session and github-ops-worker started returning a real "not
  // authenticated" error on every tool call, but nothing treated that
  // differently from any other tool failure (a missing file, say) - the
  // model was left to keep trying against a wall for many more rounds,
  // narrating without ever calling a tool, before the app's own guard
  // eventually caught up. No corrective retry can fix a credential
  // problem, so an auth-failure tool result should end the session
  // immediately with the reconnect guard text, on the very first round.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  let authFailRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        authFailRoundCount++;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_authfail_' + authFailRoundCount, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'package.json' }) } }] } }] }),
        });
        return;
      }
      if (url.indexOf('github-ops-worker') >= 0 && parsed && parsed.op === 'read_file') {
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Not authenticated - connect via GitHub OAuth in Settings, or set a write secret before reading, writing, or merging.' }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please review the repo');
  await page.waitForTimeout(1500);
  await page.unroute('**/*');
  assert(authFailRoundCount === 1, `the session stops after the very first tool call instead of continuing to retry against a broken credential (got ${authFailRoundCount} model round(s))`);
  const authFailChatText = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(authFailChatText.indexOf("repo access isn't authenticated yet") >= 0, `the reconnect guard text is shown once the auth failure is detected (chat tail: ${authFailChatText.slice(-300)})`);
  assert(authFailChatText.indexOf('This has happened') === -1, 'the stall-cycle escalation note (meant for narration loops, not credential failures) does not also show up here');
  const authFailContinueBtnCount = await page.locator('#chat .msg.ma3 button').count();
  assert(authFailContinueBtnCount === 0, `no Retry/Continue button is offered - reconnecting has to happen in Settings, not by tapping something in this dead session (got ${authFailContinueBtnCount} button(s))`);
  await page.click('#newTabBtn'); await page.waitForTimeout(400);

  console.log('\n-- a successful read whose file content happens to say "not authenticated" does not falsely trigger the reconnect guard --');
  // Real bug: the auth-failure check ran against toolResult unconditionally,
  // including a SUCCESSFUL read_file's own file content - a repo file that
  // legitimately contains the words "not authenticated" or "unauthorized"
  // (auth middleware code, an error string, docs) tripped the same guard as
  // a genuine expired-credential failure, even though the read itself had
  // just succeeded moments earlier. Must only fire on the tool call's own
  // error, never on successful content.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  let falseAuthRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        falseAuthRoundCount++;
        if (falseAuthRoundCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_falseauth_1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'middleware/auth.js' }) } }] } }] }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest read the auth middleware fine' } }] }),
        });
        return;
      }
      if (url.indexOf('github-ops-worker') >= 0 && parsed && parsed.op === 'read_file') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, content: 'if (!req.user) return res.status(401).send("Error: not authenticated");' }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please review the auth middleware');
  await page.waitForTimeout(1500);
  await page.unroute('**/*');
  assert(falseAuthRoundCount === 2, `the session continues past the successful read into a second round instead of stopping as if it had failed (got ${falseAuthRoundCount} model round(s))`);
  const falseAuthChatText = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(falseAuthChatText.indexOf("repo access isn't authenticated yet") === -1, `a successful read whose content merely mentions "not authenticated" does not show the reconnect guard (chat tail: ${falseAuthChatText.slice(-300)})`);
  assert(falseAuthChatText.indexOf('regtest read the auth middleware fine') >= 0, "the coding agent's real final answer renders instead of the session being cut short");
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

  console.log('\n-- a raw network failure ("Failed to fetch") from the coding agent offers a Retry instead of wiping the session --');
  // A real report: fetch() itself throwing (a network blip, not an HTTP
  // error status - none of the branches above ever see this, it lands in
  // the outer catch) used to kill codingAgentActive outright, the same as
  // a genuinely fatal error. Every read_file/list_files result so far
  // lives only in that session's msgs array - chatHistory only ever gets
  // the short "I checked X." summary line, never the actual file content -
  // so losing the session there didn't just lose one round, it made the
  // model amnesiac about everything it had already read, and the next
  // message started a brand-new session that re-read files from scratch
  // trying to reconstruct what was lost.
  let networkFailureRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        networkFailureRoundCount++;
        if (networkFailureRoundCount === 1) {
          await route.abort('failed');
          return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest recovered after network failure' } }] }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please check the repo status for a network blip');
  const networkFailureRetryBtn = page.locator('#chat .msg.ma3 button:has-text("Retry")').last();
  await networkFailureRetryBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const networkFailureRetryVisible = await networkFailureRetryBtn.isVisible().catch(() => false);
  assert(networkFailureRetryVisible, `a raw network failure offers a Retry button instead of a dead end (got: ${await page.evaluate(() => document.getElementById('chat').textContent).catch(() => '')})`.slice(0, 400));
  if (networkFailureRetryVisible) await networkFailureRetryBtn.click();
  let chatTextAfterNetworkFailureRetry = '';
  for (let i = 0; i < 40; i++) {
    chatTextAfterNetworkFailureRetry = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextAfterNetworkFailureRetry.indexOf('regtest recovered after network failure') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(chatTextAfterNetworkFailureRetry.indexOf('regtest recovered after network failure') >= 0, `tapping Retry after a raw network failure re-enters the SAME session (not a fresh one) and the real answer renders once it succeeds (got tail: ${chatTextAfterNetworkFailureRetry.slice(-400)})`);

  console.log('\n-- a 429 from the coding agent counts down, then retries itself automatically once the limit clears --');
  // Retry used to be tappable the instant a 429 rendered, so mashing it
  // right away almost always just landed on the same rate limit again -
  // a real report of this looking like a stuck loop. Retry-After: 2 here
  // should drive a ~2s disabled countdown before anything happens.
  // Access-Control-Expose-Headers is required here, matching the real fix
  // in workers/openai-router-chat/openai-router.js - Retry-After is not on
  // the browser's CORS-safelisted response header list, so a cross-origin
  // fetch() (this mock, like the real DI_URL call, is a different origin
  // than the page) can't read it at all without this being explicitly
  // exposed, no matter what the server actually sends.
  // A separate real report: DeepInfra's own Retry-After on this model is
  // often just 1-2s (a short per-second burst limit, not a real quota
  // outage), but the app used to always stop and wait for a manual tap
  // even once the countdown reached zero - on a busy session that meant
  // re-tapping Retry every few seconds, reading as "constantly rate-
  // limited" even though each individual limit clears almost immediately.
  // It should now retry itself the moment the countdown elapses, with no
  // tap required.
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
  const rateLimitRetryBtn = page.locator('#chat .msg.ma3 button').last();
  await rateLimitRetryBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const rateLimitRetryDisabledImmediately = await rateLimitRetryBtn.isDisabled().catch(() => false);
  assert(rateLimitRetryDisabledImmediately, 'the Retry button starts disabled with a countdown instead of being immediately tappable into the same limit');
  const rateLimitRetryInitialText = await rateLimitRetryBtn.textContent().catch(() => '');
  assert(/retry in 2s/i.test(rateLimitRetryInitialText || ''), `the countdown reads the mocked Retry-After: 2 header, not the 6s no-header fallback (got "${rateLimitRetryInitialText}")`);
  const rateLimitAutoRetryMsg = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(rateLimitAutoRetryMsg.indexOf('retrying automatically') >= 0, `the message makes clear this will retry on its own, not wait on a tap (chat tail: ${rateLimitAutoRetryMsg.slice(-300)})`);
  await page.waitForTimeout(1000);
  const rateLimitRetryStillDisabledAt1s = await rateLimitRetryBtn.isDisabled().catch(() => true);
  assert(rateLimitRetryStillDisabledAt1s, 'the countdown honors the Retry-After header (2s) instead of retrying immediately');
  let chatTextAfterRateLimitRetry = '';
  for (let i = 0; i < 40; i++) {
    chatTextAfterRateLimitRetry = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextAfterRateLimitRetry.indexOf('regtest recovered after 429') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(chatTextAfterRateLimitRetry.indexOf('regtest recovered after 429') >= 0, `the session retries itself once the Retry-After countdown elapses, with no tap needed, and the real answer renders once it succeeds (got round count ${rateLimitRoundCount})`);
  await page.click('#newTabBtn'); await page.waitForTimeout(400);

  console.log('\n-- a sustained run of 429s stops auto-retrying and falls back to a manual Retry --');
  // Auto-retrying forever without the user knowing would hide a genuinely
  // dead API key behind an endless silent retry loop - cap it, same as
  // every other corrective mechanism in this file, and hand control back
  // with a message that says plainly this isn't just a momentary burst.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  let sustainedRateLimitRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        sustainedRateLimitRoundCount++;
        await route.fulfill({ status: 429, headers: { 'content-type': 'text/plain', 'Retry-After': '1', 'Access-Control-Expose-Headers': 'Retry-After' }, body: 'rate limited' });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please check the repo status for sustained rate limiting');
  for (let i = 0; i < 60 && sustainedRateLimitRoundCount < 6; i++) await page.waitForTimeout(500);
  await page.waitForTimeout(1500);
  await page.unroute('**/*');
  assert(sustainedRateLimitRoundCount === 6, `it auto-retries exactly CODING_AGENT_MAX_AUTO_RATE_LIMIT_RETRIES (5) times before giving up automatically (got ${sustainedRateLimitRoundCount} rounds)`);
  const sustainedRateLimitText = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(sustainedRateLimitText.indexOf('Still rate-limited') >= 0, `a message distinguishes a sustained limit from a momentary burst (chat tail: ${sustainedRateLimitText.slice(-300)})`);
  const sustainedRateLimitBtn = page.locator('#chat .msg.ma3 button').last();
  await page.waitForTimeout(1200);
  const sustainedRateLimitBtnEnabled = !(await sustainedRateLimitBtn.isDisabled().catch(() => true));
  assert(sustainedRateLimitBtnEnabled, 'once the automatic retries are exhausted, the Retry button is left enabled for a manual tap instead of continuing to auto-fire');
  await page.click('#newTabBtn'); await page.waitForTimeout(400);

  console.log('\n-- reading many files with nothing written forces a mandatory stop-and-report checkpoint --');
  // A real report: on a broad "review the repo" ask in a Coding tab
  // (which auto-continues every round on its own), the model kept reading
  // file after file for dozens of rounds with nothing written and no
  // findings ever reported, ignoring the system prompt's own "stop after
  // ~10-15 reads" request repeatedly across multiple separate sends. Once
  // CODING_AGENT_MAX_EXPLORATION_READS (15) list_files calls have happened
  // with no successful write in between, the NEXT round must be sent with
  // tool_choice:"none" - an API-enforced constraint the model can't just
  // ignore the way it ignored the prompt text - forcing a plain-text
  // round instead of another tool call.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  let explorationRoundCount = 0;
  let toolChoiceOnCheckpointRound = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        explorationRoundCount++;
        if (explorationRoundCount <= 15) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              choices: [{
                finish_reason: 'tool_calls',
                message: { role: 'assistant', tool_calls: [{ id: 'regtest_explore_' + explorationRoundCount, type: 'function', function: { name: 'list_files', arguments: JSON.stringify({ path: 'dir' + explorationRoundCount }) } }] },
              }],
            }),
          });
          return;
        }
        // Round 16: this is the forced checkpoint round - record what
        // tool_choice it was actually sent with, then answer in plain text
        // (as tool_choice:"none" would require anyway).
        toolChoiceOnCheckpointRound = parsed.tool_choice;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest checkpoint findings after reading a lot' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please review the whole repo and suggest improvements');
  for (let i = 0; i < 60 && explorationRoundCount < 16; i++) await page.waitForTimeout(500);
  await page.waitForTimeout(1000);
  await page.unroute('**/*');
  assert(explorationRoundCount === 16, `exactly 15 exploration rounds happen before the forced checkpoint round (got ${explorationRoundCount} rounds)`);
  assert(toolChoiceOnCheckpointRound === 'none', `the checkpoint round is sent with tool_choice:"none", not "auto" - an API-enforced stop, not just a prompt request (got "${toolChoiceOnCheckpointRound}")`);
  const explorationCheckpointText = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(explorationCheckpointText.indexOf('regtest checkpoint findings after reading a lot') >= 0, `the forced plain-text checkpoint reply actually renders (chat tail: ${explorationCheckpointText.slice(-300)})`);
  await page.click('#newTabBtn'); await page.waitForTimeout(400);

  console.log('\n-- rewriting the same file over and over, each version contradicting the last, forces a stop-and-report checkpoint too --');
  // A real transcript: asked to fix one file, the model wrote it, then kept
  // rewriting the exact same path across several auto-continue rounds -
  // each version different from (and inconsistent with) the last, one even
  // swapping the whole module's exported function signatures - without ever
  // pausing to check its own earlier work. explorationReadCount can't catch
  // this (a write resets it, by design), so CODING_AGENT_MAX_SAME_FILE_REWRITES
  // tracks rewrites per path instead: crossing it forces the same
  // tool_choice:"none" checkpoint as the read-heavy case above.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  const rewriteGuardRepoConnected = await page.evaluate(() => !!(localStorage.getItem('gh_repo_owner') && localStorage.getItem('gh_repo_name')));
  if (!rewriteGuardRepoConnected) {
    await page.click('#settingsBtn'); await page.waitForTimeout(150);
    await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
    await page.fill('#ghOwnerInput', 'solmasta');
    await page.fill('#ghRepoInput', 'Test');
    await page.fill('#ghWriteSecretInput', 'regtest-write-secret');
    await page.click('#githubSaveBtn'); await page.waitForTimeout(300);
  }
  let rewriteRoundCount = 0;
  let toolChoiceOnRewriteCheckpointRound = null;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.indexOf('github-ops-worker') >= 0 && req.method() === 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, commit: 'regtestrewritesha' }) });
      return;
    }
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        rewriteRoundCount++;
        if (rewriteRoundCount <= 3) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              choices: [{
                finish_reason: 'tool_calls',
                message: { role: 'assistant', tool_calls: [{ id: 'regtest_rewrite_' + rewriteRoundCount, type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/rateLimit.js', content: 'regtest version ' + rewriteRoundCount, message: 'regtest rewrite ' + rewriteRoundCount, branch: 'ai-changes' }) } }] },
              }],
            }),
          });
          return;
        }
        // Round 4: the forced checkpoint round.
        toolChoiceOnRewriteCheckpointRound = parsed.tool_choice;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest rewrite checkpoint explanation' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  // Not sendMsg() - that helper awaits the send finishing before returning,
  // but the send can't finish until each round's approval dialog below is
  // actually clicked, which would deadlock waiting on itself.
  await page.fill('#prompt', 'please fix the rate limiter in src/rateLimit.js');
  await page.click('#sendBtn');
  for (let round = 1; round <= 3; round++) {
    let approvalShowed = false;
    for (let i = 0; i < 100; i++) {
      approvalShowed = await page.evaluate(() => !document.getElementById('githubWriteConfirmModal').classList.contains('hidden'));
      if (approvalShowed) break;
      await page.waitForTimeout(200);
    }
    assert(approvalShowed, `test setup: the approval dialog appears for rewrite round ${round}`);
    await page.click('#ghwApproveBtn');
    await page.waitForTimeout(300);
  }
  for (let i = 0; i < 60 && rewriteRoundCount < 4; i++) await page.waitForTimeout(200);
  await page.waitForTimeout(500);
  await waitForSendDone();
  await page.unroute('**/*');
  assert(rewriteRoundCount === 4, `exactly 3 rewrite rounds happen before the forced checkpoint round (got ${rewriteRoundCount} rounds)`);
  assert(toolChoiceOnRewriteCheckpointRound === 'none', `the same-file-rewrite checkpoint round is sent with tool_choice:"none" (got "${toolChoiceOnRewriteCheckpointRound}")`);
  const rewriteCheckpointText = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(rewriteCheckpointText.indexOf('regtest rewrite checkpoint explanation') >= 0, `the forced plain-text checkpoint reply actually renders (chat tail: ${rewriteCheckpointText.slice(-300)})`);
  await page.click('#newTabBtn'); await page.waitForTimeout(400);

  console.log('\n-- merging a branch a second time answers from memory instead of hitting the API again --');
  // A real transcript: right after a successful merge, the model called
  // merge_branch on the exact same branch again - GitHub correctly rejected
  // it (HTTP 422, nothing left to open a PR from), but the raw error read
  // like an unexplained failure instead of "this is already done", so the
  // model just started re-reading files as if nothing had happened.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  let mergeApiHitCount = 0;
  let secondMergeRoundToolContent = null;
  let alreadyMergedRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.indexOf('github-ops-worker') >= 0 && req.method() === 'POST') {
      mergeApiHitCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, prNumber: 97, prUrl: 'https://github.com/solmasta/Test/pull/97', merged: true, sha: 'regtestmerge2sha' }),
      });
      return;
    }
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        alreadyMergedRoundCount++;
        if (alreadyMergedRoundCount === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              choices: [{
                finish_reason: 'tool_calls',
                message: { role: 'assistant', tool_calls: [{ id: 'regtest_merge2_a', type: 'function', function: { name: 'merge_branch', arguments: JSON.stringify({ branch: 'ai-changes', title: 'regtest merge', message: 'regtest merge body' }) } }] },
              }],
            }),
          });
          return;
        }
        if (alreadyMergedRoundCount === 2) {
          // The model calls merge_branch again on the same branch - this
          // should be answered from mySession.mergedBranches, not a second
          // real request to github-ops-worker.
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              choices: [{
                finish_reason: 'tool_calls',
                message: { role: 'assistant', tool_calls: [{ id: 'regtest_merge2_b', type: 'function', function: { name: 'merge_branch', arguments: JSON.stringify({ branch: 'ai-changes', title: 'regtest merge again', message: 'regtest merge body again' }) } }] },
              }],
            }),
          });
          return;
        }
        // Round 3: capture what tool result the model was actually given
        // for that second merge_branch call, then end the turn.
        secondMergeRoundToolContent = (parsed.messages || []).filter((m) => m.role === 'tool').pop();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest already-merged handled' } }] }),
        });
        return;
      }
    }
    await route.continue();
  });
  // Not sendMsg() - it awaits the send finishing, which can't happen until
  // the approval dialog below is actually clicked.
  await page.fill('#prompt', 'please merge the ai-changes branch, then merge it again');
  await page.click('#sendBtn');
  let firstMergeApprovalShowed = false;
  for (let i = 0; i < 100; i++) {
    firstMergeApprovalShowed = await page.evaluate(() => !document.getElementById('githubMergeConfirmModal').classList.contains('hidden'));
    if (firstMergeApprovalShowed) break;
    await page.waitForTimeout(200);
  }
  assert(firstMergeApprovalShowed, 'test setup: the approval dialog appears for the first merge');
  await page.click('#ghmApproveBtn');
  for (let i = 0; i < 60 && alreadyMergedRoundCount < 3; i++) await page.waitForTimeout(200);
  await page.waitForTimeout(500);
  await waitForSendDone();
  await page.unroute('**/*');
  const secondMergeApprovalShowed = await page.evaluate(() => !document.getElementById('githubMergeConfirmModal').classList.contains('hidden'));
  assert(!secondMergeApprovalShowed, 'merging the same branch again does not surface a second approval dialog - there is nothing left to approve');
  assert(mergeApiHitCount === 1, `the GitHub ops worker is only actually called once, not once per merge_branch call (got ${mergeApiHitCount} calls)`);
  assert(!!secondMergeRoundToolContent && secondMergeRoundToolContent.content.indexOf('already merged') >= 0, `the model is told the branch was already merged instead of getting a raw API error (got: ${secondMergeRoundToolContent && secondMergeRoundToolContent.content})`);
  const alreadyMergedChatText = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(alreadyMergedChatText.indexOf('regtest already-merged handled') >= 0, `the model's reply after being told it was already merged actually renders (chat tail: ${alreadyMergedChatText.slice(-300)})`);
  await page.click('#newTabBtn'); await page.waitForTimeout(400);

  console.log('\n-- a sustained 429 that is actually an exhausted billing/quota balance says so, not "rate limit" --');
  // A real report: every OpenAI model (not just one) hit the exact same
  // sustained-429 wall - a per-model rate limit wouldn't do that uniformly
  // across different models sharing one key, but an exhausted account
  // balance would. OpenAI (and other providers) return HTTP 429 for
  // "insufficient_quota" too, which retrying never clears - once the
  // auto-retry budget is spent, the app should read the actual upstream
  // error body and say it's a billing/quota issue, not a rate limit.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  let quotaRoundCount = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        quotaRoundCount++;
        await route.fulfill({
          status: 429,
          headers: { 'content-type': 'application/json', 'Retry-After': '1', 'Access-Control-Expose-Headers': 'Retry-After' },
          body: JSON.stringify({ error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } }),
        });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('please check the repo status for quota exhaustion');
  for (let i = 0; i < 60 && quotaRoundCount < 6; i++) await page.waitForTimeout(500);
  await page.waitForTimeout(1500);
  await page.unroute('**/*');
  const quotaText = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(quotaText.indexOf('exhausted billing/quota balance') >= 0, `an insufficient_quota 429 is named as a billing/quota issue, not a generic rate limit (chat tail: ${quotaText.slice(-400)})`);
  assert(quotaText.indexOf('You exceeded your current quota') >= 0, `the actual upstream error message is surfaced, not just a canned string (chat tail: ${quotaText.slice(-400)})`);
  await page.click('#newTabBtn'); await page.waitForTimeout(400);

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

  console.log('\n-- OpenRouter\'s live catalog adds free models beyond the curated list, without duplicating one --');
  // A real request: "list them all" - the curated OpenRouter list only
  // ever hand-picks 4 "Free" entries, but openrouter-worker's own /models
  // endpoint (already there, unused by the frontend until now) proxies
  // OpenRouter's live catalog with real pricing. Anything with $0
  // prompt/completion cost gets added to the picker automatically, without
  // duplicating a curated entry that happens to reappear in the raw
  // catalog under the same id (a real risk: "openrouter/free" is both a
  // curated entry here AND a literal id OpenRouter's own catalog lists).
  let liveModelsWorkerHit = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    // Not asserting on the X-App-Secret header's value here - APP_SECRET
    // itself is only ever populated by a real (sandbox-blocked) fetch to
    // DI_URL's /secret endpoint, so it's legitimately empty throughout
    // this whole suite; the header still gets sent, just empty.
    if (req.method() === 'GET' && url.indexOf('/models') >= 0) {
      liveModelsWorkerHit = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'openrouter/free', name: 'Should not duplicate the curated entry', pricing: { prompt: '0', completion: '0' } },
            { id: 'regtest/brand-new-free-model', name: 'Regtest New Free Model', pricing: { prompt: '0', completion: '0' }, context_length: 32000 },
            { id: 'regtest/paid-model', name: 'Regtest Paid Model', pricing: { prompt: '0.000001', completion: '0.000002' } },
          ],
        }),
      });
      return;
    }
    await route.continue();
  });
  // loadBackend() only fires the live fetch on an actual backend switch -
  // already on OpenRouter from the test above, so bounce off DeepInfra and
  // back to trigger it fresh with this mock in place.
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.click('#deepinfraBtn'); await page.waitForTimeout(200);
  await page.click('#openrouterBtn'); await page.waitForTimeout(200);
  for (let i = 0; i < 30 && !liveModelsWorkerHit; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  await page.unroute('**/*');
  assert(liveModelsWorkerHit, 'switching to OpenRouter fetches the live model catalog from openrouter-worker\'s /models endpoint');
  const modelListTextWithLive = await page.evaluate(() => document.getElementById('modelList').textContent);
  assert(modelListTextWithLive.indexOf('Regtest New Free Model') >= 0, `a new free model from the live catalog appears in the picker (got: ${modelListTextWithLive.slice(0, 2000)})`);
  assert(modelListTextWithLive.indexOf('Regtest Paid Model') < 0, 'a non-free model from the live catalog is not added to the picker');
  const autoFreeRouterCardCount = await page.evaluate(() => Array.from(document.querySelectorAll('#modelList .mc')).filter((c) => c.textContent.indexOf('Auto Free Router') >= 0).length);
  assert(autoFreeRouterCardCount === 1, `the curated "Auto Free Router" (openrouter/free) card is not duplicated by the live catalog reusing its id (got ${autoFreeRouterCardCount} matching cards)`);
  await page.click('#closeModelModal'); await page.waitForTimeout(150);

  // Switch back to a DeepInfra model - later tests assume the model
  // picker is already showing the DeepInfra list, same baseline the
  // pre-coding-agent version of this test used to leave behind by
  // switching backends itself.
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.click('#deepinfraBtn'); await page.waitForTimeout(150);
  await page.locator('.mc:has-text("Mistral Small")').first().click();
  await page.waitForTimeout(150);

  console.log('\n-- the Coding tab\'s model picker labels each model\'s relative cost, without changing which models are offered --');
  // The user wants to see cost at a glance when picking a coding model
  // (repo work can burn a lot more tokens per turn than a normal chat
  // reply), but explicitly did NOT want the actual model pool or grouping
  // changed - just the existing per-model cost tier surfaced as a badge.
  const mainChatCardHasCostBadge = await page.evaluate(() => {
    const card = document.querySelector('#modelList .mc');
    return card ? !!card.querySelector('[class*="tier-"]') : null;
  });
  assert(mainChatCardHasCostBadge === false, 'the main chat\'s model cards do not show a cost badge (cost only matters for the heavier-usage Coding tab)');
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  const codingCardCostInfo = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#modelList .mc'));
    return {
      cardCount: cards.length,
      allHaveCostBadge: cards.length > 0 && cards.every((c) => !!c.querySelector('[class*="tier-"]')),
      firstBadgeText: cards[0] ? (cards[0].querySelector('[class*="tier-"]') || {}).textContent : null,
    };
  });
  assert(codingCardCostInfo.cardCount > 0, 'test setup: the Coding tab model picker actually lists cards');
  assert(codingCardCostInfo.allHaveCostBadge, `every model card in the Coding tab picker shows a cost badge (got: ${JSON.stringify(codingCardCostInfo)})`);
  assert(/^\${1,4}$/.test(codingCardCostInfo.firstBadgeText || ''), `the cost badge reads as a $ tier, not a raw number or category name (got "${codingCardCostInfo.firstBadgeText}")`);
  await page.click('#closeModelModal'); await page.waitForTimeout(150);
  await page.locator('#tabBar .tabpill.act .tpx').click(); await page.waitForTimeout(200);

  console.log('\n-- the Coding tab\'s model picker states plainly that every listed model actually works for coding --');
  // A real report: "is there a way to know what model can actually do
  // coding and what actually can't so I don't waste my time" - every card
  // in this list is already filtered down to TOOL_MODELS, so there's no
  // wrong pick possible here, but nothing on screen ever said so.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  const codingPickerNoteText = await page.evaluate(() => document.getElementById('modelList').textContent);
  assert(codingPickerNoteText.indexOf('verified to reliably use real repo tools') >= 0, `the Coding tab's model picker states that every listed model works for coding (got: ${codingPickerNoteText.slice(0, 300)})`);
  await page.click('#closeModelModal'); await page.waitForTimeout(150);
  await page.locator('#tabBar .tabpill.act .tpx').click(); await page.waitForTimeout(200);

  console.log('\n-- free OpenRouter models are pinned in the main chat\'s picker even while on DeepInfra, and picking one switches backend --');
  // A real report: "I don't see any free models" - true while browsing
  // DeepInfra, since none of its models are actually $0 (see DI_COST), but
  // the user had no way to know free options exist without already
  // knowing to flip to the OpenRouter tab first.
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.click('#deepinfraBtn'); await page.waitForTimeout(150);
  const deepInfraPickerText = await page.evaluate(() => document.getElementById('modelList').textContent);
  assert(deepInfraPickerText.indexOf('Free (OpenRouter)') >= 0, `a pinned Free section appears while browsing DeepInfra (got: ${deepInfraPickerText.slice(0, 300)})`);
  assert(deepInfraPickerText.indexOf('Auto Free Router') >= 0, `the pinned section actually lists a real free OpenRouter model (got: ${deepInfraPickerText.slice(0, 300)})`);
  await page.locator('.mc:has-text("Auto Free Router")').first().click();
  await page.waitForTimeout(300);
  const backendAfterPinnedFreePick = await page.evaluate(() => document.getElementById('openrouterBtn').classList.contains('act') ? 'openrouter' : 'other');
  assert(backendAfterPinnedFreePick === 'openrouter', `picking a pinned free model switches the main chat over to OpenRouter (got "${backendAfterPinnedFreePick}")`);
  const modelLabelAfterPinnedFreePick = await page.textContent('#modelBtnLabel');
  assert(modelLabelAfterPinnedFreePick === 'Auto Free Router', `the picked free model actually becomes the active model, not OpenRouter's own different default (got "${modelLabelAfterPinnedFreePick}")`);
  await page.click('#modelBtn'); await page.waitForTimeout(150);
  await page.click('#deepinfraBtn'); await page.waitForTimeout(150);
  await page.locator('.mc:has-text("Mistral Small")').first().click();
  await page.waitForTimeout(150);

  console.log('\n-- App-control tools (create_project/remember) actually execute, no confirm needed --');
  // Unlike write_file, these run immediately on a model-issued tool_call,
  // no approval dialog. Mock both in one tool_calls response and verify
  // each one's real, observable side effect: a project actually saved and
  // made active, and a memory actually stored.
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
                  ],
                },
              }],
            }),
          });
          return;
        }
        // The tool round loop keeps going until the model stops calling
        // tools - round 2 must say it's done, or these two tools would
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
  await sendMsg('please make this a project and remember something for me');
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

  console.log('\n-- the main chat labels replies "Assistant" with the actual model shown as a secondary indicator --');
  // The model name should still be visible, just as a secondary indicator
  // rather than the primary label.
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.stream === true) {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"regtest assistant-label reply"}}]}\n\ndata: [DONE]\n\n' });
        return;
      }
      if (parsed && parsed.stream === false) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '' } }] }) });
        return;
      }
    }
    await route.continue();
  });
  await sendMsg('regtest message to check the assistant label');
  await page.unroute('**/*');
  const replyLabelInfo = await page.evaluate(() => {
    const labels = document.querySelectorAll('#chat .msg.ma3 .ml');
    const last = labels[labels.length - 1];
    const primary = last ? last.querySelector('span:not(.av):not(.modelTag)').textContent : '';
    const modelTag = last ? last.querySelector('.modelTag') : null;
    return { primary, modelTagText: modelTag ? modelTag.textContent : null, currentModelLabel: document.getElementById('modelBtnLabel').textContent };
  });
  assert(replyLabelInfo.primary === 'Assistant', `the reply bubble's primary label reads "Assistant" (got "${replyLabelInfo.primary}")`);
  assert(!!replyLabelInfo.modelTagText, 'a secondary model-name indicator is present on the reply bubble');
  assert(replyLabelInfo.modelTagText === replyLabelInfo.currentModelLabel, `the model-name indicator matches the model that actually answered (got "${replyLabelInfo.modelTagText}" vs active "${replyLabelInfo.currentModelLabel}")`);

  console.log('\n-- a reply\'s model-name tag survives a later model switch + reload instead of getting relabeled with today\'s active model --');
  // appendMsg used to always paint currentModel.label onto every assistant
  // bubble, including on a full re-render from chatHistory (tab switch,
  // reload, regen) - so switching models later silently relabeled every
  // earlier reply as if the NEW model had answered them too. Each
  // chatHistory entry now carries its own modelLabel from when it was
  // actually created; re-rendering must use that instead of the live model.
  const modelBeforeSwitch = replyLabelInfo.currentModelLabel;
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

  console.log('\n-- an image attached IN a Coding tab is described by a vision model, then handed to the coding agent (not the plain vision chat) --');
  // A real request: the coding agent has no vision of its own, so a
  // screenshot attached in a Coding tab used to fall through to the same
  // vision-only chat as above, with zero repo access - the coding agent
  // never even knew an image existed. Scoped to codingModeActive
  // specifically (the test just above proves a PLAIN chat image is
  // untouched by this) - describeScreenshotForCoding runs the vision model
  // once up front, then the coding agent gets that description as plain
  // text standing in for the image itself.
  await page.click('#newCodeTabBtn'); await page.waitForTimeout(400);
  let visionBridgeSawCodingAgentBody = null;
  let visionBridgeSawVisionCall = false;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postData()) {
      let parsed = null;
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
      if (parsed && parsed.model === 'Qwen/Qwen3-VL-30B-A3B-Instruct' && parsed.stream === false) {
        visionBridgeSawVisionCall = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest screenshot shows a misaligned header button' } }] }) });
        return;
      }
      if (parsed && parsed.model === 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo') {
        visionBridgeSawCodingAgentBody = parsed;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'regtest fixed the header button alignment' } }] }) });
        return;
      }
    }
    await route.continue();
  });
  const fileInputCodingImg = await page.$('#fileInput');
  await fileInputCodingImg.setInputFiles(imgPath);
  await waitForAttachCount(1);
  await sendMsg('fix the header button alignment shown in this screenshot');
  await page.unroute('**/*');
  assert(visionBridgeSawVisionCall, 'the screenshot is sent to the vision model for a description first');
  assert(!!visionBridgeSawCodingAgentBody, 'the coding agent (with real repo tools) still gets this turn, not just the plain vision chat');
  const codingAgentLastMsg = visionBridgeSawCodingAgentBody && visionBridgeSawCodingAgentBody.messages && visionBridgeSawCodingAgentBody.messages[visionBridgeSawCodingAgentBody.messages.length - 1];
  const codingAgentSawNoRawImage = !!(codingAgentLastMsg && typeof codingAgentLastMsg.content === 'string');
  assert(codingAgentSawNoRawImage, `the coding agent's own request carries the vision description as plain text, not raw image_url content it can't read (got: ${JSON.stringify(codingAgentLastMsg)})`);
  assert(codingAgentLastMsg && codingAgentLastMsg.content.indexOf('regtest screenshot shows a misaligned header button') >= 0, `the vision model's actual description reaches the coding agent's message (got: ${codingAgentLastMsg && codingAgentLastMsg.content})`);
  assert(codingAgentLastMsg && codingAgentLastMsg.content.indexOf('fix the header button alignment shown in this screenshot') >= 0, `the user's own request text is preserved alongside the description (got: ${codingAgentLastMsg && codingAgentLastMsg.content})`);
  const chatTextAfterVisionBridge = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(chatTextAfterVisionBridge.indexOf('Looking at the screenshot') < 0, 'the transient "looking at the screenshot" status is removed once the real coding-agent reply lands, not left behind as a stray bubble');
  await page.click('#newTabBtn'); await page.waitForTimeout(400);

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

  console.log('\n-- the app proactively suggests saving a settled conversation as a Work Project, but only when the model itself flags it --');
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
