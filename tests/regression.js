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
   - profile creation and data isolation
   - Overseer chat: long-press opens it, sends reach the model with the
     Overseer's own dedicated system prompt (not the main chat one)
   - Overseer chat can also drive repo tool_calls (e.g. write_file) directly,
     through the same TOOL_MODELS gate and approval dialogs as the main
     chat, with its own tool-execution notices in the Overseer's chat log
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
   - repo/coding work stays conversational in the transcript instead of
     dumping raw tool-status chatter into the main chat
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
     some other repo
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
     without opening the Connect modal, and previously-connected repos are
     offered as quick "recent" picks when reconnecting
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
   - 3+ rounds of tapping the auto-generated "Continue with the next
     step: X" prompt in a row keep routing to the dedicated coding agent
     instead of falling back to the plain chat model once those generic
     continuation messages fill up the recent-turns lookback window
   - asking the coding agent to work "on your own" / "without doing one
     by one" auto-chains its tool-call rounds instead of requiring a
     manual Continue tap after every single file, offering a Stop
     control instead and still stopping once it gives a final answer

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
  const page = await browser.newPage();
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
  await page.click('#githubSaveBtn'); await page.waitForTimeout(150);
  const ghStatusAfterRecentReconnect = await page.textContent('#githubStatus');
  assert(ghStatusAfterRecentReconnect === 'solmasta/openai-router', `reconnecting via the recent-repo chip actually reconnects (got "${ghStatusAfterRecentReconnect}")`);

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
      try { parsed = JSON.parse(req.postData()); } catch (e) {}
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
  assert(genericCodeToolNames.indexOf('read_file') >= 0 && genericCodeToolNames.indexOf('write_file') >= 0 && genericCodeToolNames.indexOf('list_files') >= 0, `a generic coding question gets repo tools through the dedicated coding agent when GitHub is connected (got tools: ${JSON.stringify(genericCodeToolNames)})`);

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
  // list_files used to require a path, so the model had no legitimate way
  // to ask for "the whole repo" - it had to guess a path or get an error
  // either way. Confirm the tool's own schema no longer forces one.
  const listFilesTool = (lastCodingAgentBody.tools || []).find((t) => t.function.name === 'list_files');
  assert(listFilesTool && !(listFilesTool.function.parameters.required || []).includes('path'), 'list_files no longer requires a path - omitting it can mean "list the repo root"');
  const chatTextAfterCodingAgent = await page.evaluate(() => document.getElementById('chat').textContent);
  assert(chatTextAfterCodingAgent.indexOf('Assistant') >= 0, "repo work renders as a normal assistant reply");
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
  await sendMsg('please go through every file in the repo on your own without doing one by one, and let me know when you are done');
  let chatTextAfterAutoContinue = '';
  for (let i = 0; i < 60; i++) {
    chatTextAfterAutoContinue = await page.evaluate(() => document.getElementById('chat').textContent);
    if (chatTextAfterAutoContinue.indexOf('regtest auto-continue done') >= 0) break;
    await page.waitForTimeout(200);
  }
  await page.unroute('**/*');
  assert(autoContinueRoundCount === 3, `all 3 rounds fired automatically with no Continue click (got ${autoContinueRoundCount} rounds)`);
  assert(chatTextAfterAutoContinue.indexOf('regtest auto-continue done') >= 0, "the final round's plain-text answer renders once the agent stops calling tools on its own");
  assert(chatTextAfterAutoContinue.indexOf('Stop') >= 0, 'a Stop control is offered while auto-continuing, in case the user wants to interrupt it');

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
  // every time. It must only apply to solmasta/openai-router specifically
  // - injecting it for some other repo the user points GitHub at would
  // just be wrong. This knowledge lives in the dedicated coding agent's
  // own system prompt now (codingAgentSystemPrompt), not the main chat
  // model's - repo work never touches the main chat model at all.
  // The previous test's create_project call left a Work Project active -
  // getModelSystemPrompt takes a completely different branch whenever a
  // project is active, which would skip repo routing entirely regardless
  // of GitHub state. Clear does this too, but also matches how a real
  // user would move on for a new topic in this app.
  await page.click('#clearBtn'); await page.waitForTimeout(200);
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.fill('#ghOwnerInput', 'solmasta');
  await page.fill('#ghRepoInput', 'openai-router');
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
  assert(checkupSysContent.indexOf("THIS REPO IS THE APP YOU'RE RUNNING IN") >= 0, 'a maintenance/checkup request on the connected openai-router repo gets the coding agent the hardcoded app-structure knowledge');

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
  assert(otherRepoSysContent.indexOf("THIS REPO IS THE APP YOU'RE RUNNING IN") < 0, 'the same request against a different connected repo does NOT get openai-router-specific knowledge');

  // Leave GitHub pointed back at the real repo, matching actual usage.
  await page.click('#settingsBtn'); await page.waitForTimeout(150);
  await page.click('#githubConnectBtn'); await page.waitForTimeout(150);
  await page.fill('#ghOwnerInput', 'solmasta');
  await page.fill('#ghRepoInput', 'openai-router');
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

  console.log('\n-- Overseer proactively suggests saving a settled conversation as a Work Project --');
  // A fresh, non-project conversation that reaches 8 messages should
  // offer to save itself as a reusable project; accepting generates a
  // name/instructions from the conversation and actually creates it.
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
  const projectSuggestionVisible = await page.evaluate(() => document.getElementById('chat').textContent.indexOf('Save this conversation as a reusable project') >= 0);
  assert(projectSuggestionVisible, 'a suggestion to save the conversation as a project appears once it settles (8 messages)');
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
