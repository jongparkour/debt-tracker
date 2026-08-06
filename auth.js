/* ============================================================
   auth.js — App lock: PIN (Web Crypto) + biometric (WebAuthn)
   Fully offline. Gates access to the app UI.
   Note: this protects ACCESS, not the raw stored data.
   ============================================================ */

(function () {
  "use strict";

  const LS_PIN = "dt_pin"; // { salt, hash, iter, len }
  const LS_CRED = "dt_cred"; // base64 credential id for biometrics
  const LS_UID = "dt_uid"; // base64 WebAuthn user handle
  const LS_REC = "dt_rec"; // { salt, hash, iter } for the recovery code
  const INACTIVITY_MS = 5 * 60 * 1000; // lock 5 min after last use
  const LS_ACTIVITY = "dt_active"; // last-activity timestamp (persists reloads)
  const LS_LOCK_CLOSE = "dt_lockOnClose"; // "1" (default) = require PIN on every reopen
  const LS_HIDE_AMT = "dt_hideAmounts"; // "1" = blur balances until tapped
  const FEEDBACK_EMAIL = "libosadajosephy@gmail.com";

  /* Privacy preferences (with sensible defaults). */
  function getLockOnClose() {
    const v = localStorage.getItem(LS_LOCK_CLOSE);
    return v === null ? true : v === "1"; // default ON
  }
  function setLockOnClose(on) {
    try { localStorage.setItem(LS_LOCK_CLOSE, on ? "1" : "0"); } catch (e) {}
  }
  function getHideAmounts() {
    return localStorage.getItem(LS_HIDE_AMT) === "1"; // default OFF
  }
  function setHideAmounts(on) {
    try { localStorage.setItem(LS_HIDE_AMT, on ? "1" : "0"); } catch (e) {}
  }

  let currentRecoveryCode = ""; // held only in memory while shown at setup
  let lastActivity = 0; // timestamp of last user interaction
  let lastWrite = 0;
  let inactivityInterval = null;

  function now() {
    return new Date().getTime();
  }

  /** Record activity; persist (throttled) so back/close/reload can remember it. */
  function bumpActivity() {
    lastActivity = now();
    if (lastActivity - lastWrite > 3000) {
      lastWrite = lastActivity;
      persistActivity();
    }
  }
  function persistActivity() {
    try {
      localStorage.setItem(LS_ACTIVITY, String(lastActivity));
    } catch (e) {}
  }
  function clearActivity() {
    try {
      localStorage.removeItem(LS_ACTIVITY);
    } catch (e) {}
  }
  /** True if last use (even before a reload) is within the 5-min window.
   *  When "Lock when app closes" is on, there is no grace — the PIN is always
   *  required on reopen. */
  function withinGrace() {
    if (getLockOnClose()) return false;
    const stored = Number(localStorage.getItem(LS_ACTIVITY) || 0);
    return stored > 0 && now() - stored < INACTIVITY_MS;
  }

  /** Start the inactivity watchdog (also resets & persists the clock). */
  function startInactivity() {
    lastActivity = now();
    persistActivity();
    stopInactivity();
    inactivityInterval = setInterval(() => {
      if (unlocked && now() - lastActivity >= INACTIVITY_MS) lockNow();
    }, 5000);
  }
  function stopInactivity() {
    if (inactivityInterval) {
      clearInterval(inactivityInterval);
      inactivityInterval = null;
    }
  }

  const $ = (id) => document.getElementById(id);

  /* ---------------- Encoding helpers ---------------- */

  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToBuf(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function randBytes(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return a;
  }

  /* ---------------- PIN (PBKDF2 via Web Crypto) ---------------- */

  async function derive(pin, saltBuf, iter) {
    const enc = new TextEncoder();
    const keyMat = await crypto.subtle.importKey(
      "raw",
      enc.encode(pin),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: saltBuf, iterations: iter, hash: "SHA-256" },
      keyMat,
      256
    );
    return bufToB64(bits);
  }

  function hasPin() {
    return !!localStorage.getItem(LS_PIN);
  }

  async function setPin(pin) {
    const salt = randBytes(16);
    const iter = 150000;
    const hash = await derive(pin, salt, iter);
    // Store the length so we know when a typed PIN is "complete" (auto-unlock).
    localStorage.setItem(
      LS_PIN,
      JSON.stringify({ salt: bufToB64(salt), hash, iter, len: pin.length })
    );
  }

  /** Stored PIN length, or null if unknown (older installs). */
  function pinLen() {
    const rec = JSON.parse(localStorage.getItem(LS_PIN) || "null");
    return rec && typeof rec.len === "number" ? rec.len : null;
  }

  async function verifyPin(pin) {
    const rec = JSON.parse(localStorage.getItem(LS_PIN) || "null");
    if (!rec) return false;
    const hash = await derive(pin, b64ToBuf(rec.salt), rec.iter);
    return hash === rec.hash;
  }

  /* ---------------- Recovery code ---------------- */

  // Normalize typed codes: strip anything that isn't A–Z / 0–9, uppercase.
  function normCode(code) {
    return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function genRecoveryCode() {
    // Ambiguous characters (0/O, 1/I) removed for easy hand-copying.
    const alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = randBytes(16);
    let s = "";
    for (let i = 0; i < 16; i++) {
      s += alpha[bytes[i] % alpha.length];
      if (i % 4 === 3 && i < 15) s += "-";
    }
    return s; // e.g. A1B2-C3D4-E5F6-G7H8
  }

  function hasRecovery() {
    return !!localStorage.getItem(LS_REC);
  }

  async function setRecovery(code) {
    const salt = randBytes(16);
    const iter = 150000;
    const hash = await derive(normCode(code), salt, iter);
    localStorage.setItem(
      LS_REC,
      JSON.stringify({ salt: bufToB64(salt), hash, iter })
    );
  }

  async function verifyRecovery(code) {
    const rec = JSON.parse(localStorage.getItem(LS_REC) || "null");
    if (!rec) return false;
    const hash = await derive(normCode(code), b64ToBuf(rec.salt), rec.iter);
    return hash === rec.hash;
  }

  // Nuclear option: wipe credentials AND all app data.
  function resetApp() {
    [LS_PIN, LS_CRED, LS_UID, LS_REC].forEach((k) => localStorage.removeItem(k));
    try {
      indexedDB.deleteDatabase("debtDB");
    } catch (_) {}
    location.reload();
  }

  /* ---------------- Biometrics (WebAuthn) ---------------- */

  async function biometricSupported() {
    if (!window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (_) {
      return false;
    }
  }

  function biometricEnrolled() {
    return !!localStorage.getItem(LS_CRED);
  }

  async function enrollBiometric() {
    let uid = localStorage.getItem(LS_UID);
    let uidBuf;
    if (uid) {
      uidBuf = new Uint8Array(b64ToBuf(uid));
    } else {
      uidBuf = randBytes(16);
      localStorage.setItem(LS_UID, bufToB64(uidBuf));
    }

    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: randBytes(32),
        rp: { name: "Debt Tracker", id: location.hostname },
        user: { id: uidBuf, name: "owner", displayName: "Owner" },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60000,
        attestation: "none",
      },
    });
    localStorage.setItem(LS_CRED, bufToB64(cred.rawId));
    return true;
  }

  async function unlockWithBiometric() {
    const id = localStorage.getItem(LS_CRED);
    if (!id) throw new Error("no-credential");
    // A successful assertion means the platform verified the user (finger/face).
    await navigator.credentials.get({
      publicKey: {
        challenge: randBytes(32),
        allowCredentials: [{ type: "public-key", id: b64ToBuf(id) }],
        userVerification: "required",
        timeout: 60000,
        rpId: location.hostname,
      },
    });
    return true;
  }

  /* ---------------- UI control ---------------- */

  let unlocked = false;

  function show(el) {
    el.classList.remove("hidden");
  }
  function hide(el) {
    el.classList.add("hidden");
  }
  function panel(name) {
    ["lockSetup", "lockRecovery", "lockEnroll", "lockUnlock", "lockForgot"].forEach(
      (p) => $(p).classList.toggle("hidden", p !== name)
    );
  }
  function msg(el, text, ok) {
    el.textContent = text || "";
    el.classList.toggle("ok", !!ok);
  }
  function shake() {
    const box = document.querySelector(".lock-box");
    box.classList.remove("shake");
    void box.offsetWidth;
    box.classList.add("shake");
  }

  /** Turn a text/number input into a segmented N-box PIN display.
   *  The real input is kept (transparent overlay) so all existing logic that
   *  reads its .value keeps working; boxes just visualize the digits. */
  function makePinField(input, digits, compact) {
    if (!input || input.dataset.pinified) return;
    input.dataset.pinified = "1";
    input.maxLength = digits;
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "off");

    const wrap = document.createElement("div");
    wrap.className = "pin-field" + (compact ? " compact" : "");
    input.parentNode.insertBefore(wrap, input);

    const boxes = document.createElement("div");
    boxes.className = "pin-boxes";
    for (let i = 0; i < digits; i++) {
      const b = document.createElement("div");
      b.className = "pin-box";
      boxes.appendChild(b);
    }
    wrap.appendChild(boxes);
    wrap.appendChild(input); // overlays the boxes (absolute, transparent)

    const render = () => {
      const v = input.value.replace(/\D/g, "").slice(0, digits);
      if (v !== input.value) input.value = v;
      const focused = document.activeElement === input;
      for (let i = 0; i < boxes.children.length; i++) {
        const cell = boxes.children[i];
        const filled = i < v.length;
        cell.textContent = filled ? "•" : "";
        cell.classList.toggle("filled", filled);
        cell.classList.toggle("active", focused && i === v.length);
      }
    };
    input.addEventListener("input", render);
    input.addEventListener("focus", render);
    input.addEventListener("blur", render);
    wrap.addEventListener("click", () => input.focus());
    render();
  }

  function unlockApp() {
    unlocked = true;
    hide($("lockScreen"));
    show($("settingsBtn"));
    startInactivity();
    // Clear any typed PIN from the DOM.
    ["pinNew", "pinConfirm", "pinEnter"].forEach((id) => {
      if ($(id)) $(id).value = "";
    });
    // Always reveal the dashboard after unlocking — never a stale Settings/detail view.
    if (window.showList) showList();
  }

  async function showUnlock() {
    panel("lockUnlock");
    show($("lockScreen"));
    hide($("settingsBtn"));
    const bioBtn = $("bioUnlockBtn");
    if (biometricEnrolled() && (await biometricSupported())) {
      show(bioBtn);
    } else {
      hide(bioBtn);
    }
    msg($("lockUnlockMsg"), "");
  }

  /* ---------------- Settings (Change PIN + biometrics) ---------------- */

  async function openSettings() {
    const startTheme = window.getTheme ? getTheme() : "light";
    let pendingTheme = startTheme;
    const bioSupported = await biometricSupported();

    $("settingsBody").innerHTML = `
      <section class="settings-card">
        <div class="settings-card-head">
          <div class="settings-card-icon">☀️</div>
          <div class="settings-card-title"><h2>Appearance</h2>
            <p>Choose how Debt Tracker looks on this device.</p></div>
        </div>
        <div class="theme-seg" id="s_themeSeg">
          <button type="button" class="seg-btn" data-theme="light">☀️ Light</button>
          <button type="button" class="seg-btn" data-theme="dark">🌙 Dark</button>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">
          <div class="settings-card-icon">🛡️</div>
          <div class="settings-card-title"><h2>Security</h2>
            <p>Protect your balances with a PIN and privacy options.</p></div>
        </div>
        <div class="field-row">
          <div class="field"><label>New PIN</label>
            <input id="s_new" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••" /></div>
          <div class="field"><label>Confirm PIN</label>
            <input id="s_conf" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••" /></div>
        </div>
        <p class="pin-help" id="s_pinHelp">Use 4 digits. Leave blank to keep your current PIN.</p>

        <div class="setting-row">
          <div class="setting-row-text">
            <span class="setting-row-label">Lock when app closes</span>
            <span class="setting-row-cap">Require the PIN every time you reopen.</span>
          </div>
          <label class="switch"><input type="checkbox" id="s_lockClose" /><span class="switch-track"><span class="switch-thumb"></span></span></label>
        </div>
        <div class="setting-row">
          <div class="setting-row-text">
            <span class="setting-row-label">Hide amounts by default</span>
            <span class="setting-row-cap">Blur balances until you tap to reveal.</span>
          </div>
          <label class="switch"><input type="checkbox" id="s_hideAmt" /><span class="switch-track"><span class="switch-thumb"></span></span></label>
        </div>
        <div class="setting-row" id="s_bioRow">
          <div class="setting-row-text">
            <span class="setting-row-label">Fingerprint / face unlock</span>
            <span class="setting-row-cap" id="s_bioCap"></span>
          </div>
          <button type="button" class="btn small hidden" id="s_bioBtn"></button>
        </div>
        <div class="setting-row">
          <div class="setting-row-text">
            <span class="setting-row-label">Recovery code</span>
            <span class="setting-row-cap" id="s_recCap"></span>
          </div>
          <button type="button" class="btn small" id="s_recBtn"></button>
        </div>
        <div id="s_recBox" class="recovery-code hidden"></div>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">
          <div class="settings-card-icon">🔗</div>
          <div class="settings-card-title"><h2>Share the app</h2>
            <p>Let others scan a QR code to install it.</p></div>
        </div>
        <button type="button" class="btn primary" id="s_qrBtn" style="width:100%;">📱 Show install QR code</button>
        <div id="s_qrWrap" class="qr-box hidden">
          <div id="s_qrImg" class="qr-img"></div>
          <p class="qr-cap">Scan with a phone camera to download the Android app.</p>
          <div class="qr-actions">
            <button type="button" class="btn small" id="s_qrCopy">Copy link</button>
            <button type="button" class="btn small hidden" id="s_qrShare">Share…</button>
          </div>
        </div>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">
          <div class="settings-card-icon">📧</div>
          <div class="settings-card-title"><h2>Auto reminders <span class="pro-badge">PRO</span></h2>
            <p>Free: tap <b>✉️</b> / <b>💬</b> on any debtor to send a reminder in one tap.
               <b>Pro</b> would send them <b>fully automatically</b> — reminders + payment
               confirmations, even when your phone is off.</p></div>
        </div>
        <button type="button" class="btn primary" id="s_proBtn" style="width:100%;">⚡ Upgrade to Pro</button>
        <p class="pin-help">Pro will be a small paid add-on (price still being set). Tapping this just sends a request — no charge yet. We'll enable it and set fair pricing once enough people ask.</p>
      </section>

      <section class="settings-card">
        <div class="settings-card-head">
          <div class="settings-card-icon">💬</div>
          <div class="settings-card-title"><h2>Feedback</h2>
            <p>Tell us what's working and what isn't.</p></div>
        </div>
        <div class="field">
          <textarea id="s_feedback" rows="4" maxlength="1000" placeholder="Share an idea or report a problem…"></textarea>
          <div class="char-count"><span id="s_fbCount">0</span>/1000</div>
          <p class="field-error hidden" id="s_fbErr">Please type your feedback first.</p>
        </div>
        <button type="button" class="btn" id="s_feedbackBtn" style="width:100%;">✉️ Send feedback</button>
      </section>

      <section class="settings-card danger-card">
        <div class="setting-row-text">
          <span class="setting-row-label">Lock app now</span>
          <span class="setting-row-cap">Immediately hide everything behind your PIN.</span>
        </div>
        <button type="button" class="btn danger-btn" id="s_lockBtn">🔒 Lock now</button>
      </section>

      <p id="s_msg" class="settings-msg"></p>
    `;

    showView("settingsView");

    const save = $("settingsSave");
    const setMsg = (t, ok) => {
      const m = $("s_msg");
      m.textContent = t || "";
      m.classList.toggle("ok", !!ok);
    };
    function markDirty() {
      save.disabled = false;
    }

    // ----- Appearance: segmented toggle (preview live, persist on Save) -----
    const seg = $("s_themeSeg");
    function paintSeg() {
      seg.querySelectorAll(".seg-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.theme === pendingTheme)
      );
    }
    function previewTheme(t) {
      document.documentElement.setAttribute("data-theme", t === "light" ? "light" : "dark");
      const mm = document.querySelector('meta[name="theme-color"]');
      if (mm) mm.setAttribute("content", t === "light" ? "#eef2f7" : "#080d1a");
    }
    paintSeg();
    seg.querySelectorAll(".seg-btn").forEach((b) =>
      b.addEventListener("click", () => {
        pendingTheme = b.dataset.theme;
        previewTheme(pendingTheme);
        paintSeg();
        markDirty();
      })
    );

    // ----- Security: PIN with inline validation -----
    const sNew = $("s_new"),
      sConf = $("s_conf"),
      pinHelp = $("s_pinHelp");
    function validatePin() {
      const a = sNew.value.trim(),
        b = sConf.value.trim();
      if (!a && !b) {
        pinHelp.textContent = "Use 4 digits. Leave blank to keep your current PIN.";
        pinHelp.className = "pin-help";
        return { ok: true, change: false };
      }
      if (!/^\d{4}$/.test(a)) {
        pinHelp.textContent = "New PIN must be exactly 4 digits.";
        pinHelp.className = "pin-help bad";
        return { ok: false };
      }
      if (a !== b) {
        pinHelp.textContent = "PINs don't match yet.";
        pinHelp.className = "pin-help bad";
        return { ok: false };
      }
      pinHelp.textContent = "Looks good — press Save to update your PIN.";
      pinHelp.className = "pin-help good";
      return { ok: true, change: true, pin: a };
    }
    [sNew, sConf].forEach((el) =>
      el.addEventListener("input", () => {
        validatePin();
        markDirty();
      })
    );

    // ----- Privacy toggles -----
    const lockClose = $("s_lockClose"),
      hideAmt = $("s_hideAmt");
    lockClose.checked = getLockOnClose();
    hideAmt.checked = getHideAmounts();
    lockClose.addEventListener("change", markDirty);
    hideAmt.addEventListener("change", markDirty);

    // ----- Upgrade to Pro (request full automation) -----
    const proBtn = $("s_proBtn");
    const proDone = () => {
      proBtn.textContent = "✓ Pro requested";
    };
    if (localStorage.getItem("dt_proRequested") === "1") proDone();
    proBtn.addEventListener("click", () => {
      if (localStorage.getItem("dt_proRequested") === "1") {
        if (window.toast) toast("You've already requested Pro — thank you!");
        return;
      }
      // Register the request as a counted pageview (Cloudflare), staying in the app.
      const w = window.open("./pro-request.html", "_blank");
      if (!w) {
        const ifr = document.createElement("iframe");
        ifr.style.display = "none";
        ifr.src = "./pro-request.html";
        document.body.appendChild(ifr);
        setTimeout(() => {
          try { ifr.remove(); } catch (e) {}
        }, 5000);
      }
      try { localStorage.setItem("dt_proRequested", "1"); } catch (e) {}
      proDone();
      if (window.toast) toast("Thanks! Your request for full automation was recorded.");
    });

    // ----- Biometrics (applied immediately) -----
    const bioBtn = $("s_bioBtn"),
      bioCap = $("s_bioCap");
    function refreshBio() {
      if (!bioSupported) {
        bioCap.textContent = "Not available on this device.";
        hide(bioBtn);
        return;
      }
      if (biometricEnrolled()) {
        bioCap.textContent = "On — quick unlock enabled.";
        bioBtn.textContent = "Disable";
        bioBtn.classList.add("danger");
      } else {
        bioCap.textContent = "Use your fingerprint or face to unlock.";
        bioBtn.textContent = "Enable";
        bioBtn.classList.remove("danger");
      }
      show(bioBtn);
    }
    refreshBio();
    bioBtn.addEventListener("click", async () => {
      if (biometricEnrolled()) {
        localStorage.removeItem(LS_CRED);
        if (window.toast) toast("Biometric unlock disabled.");
        refreshBio();
      } else {
        try {
          setMsg("Follow your device's prompt…");
          await enrollBiometric();
          setMsg("");
          if (window.toast) toast("Biometric unlock enabled.");
          refreshBio();
        } catch (err) {
          setMsg("Couldn't enable biometrics.");
        }
      }
    });

    // ----- Recovery code (applied immediately) -----
    const recBtn = $("s_recBtn"),
      recCap = $("s_recCap"),
      recBox = $("s_recBox");
    function refreshRec() {
      if (hasRecovery()) {
        recCap.textContent = "Set — regenerate to get a new one.";
        recBtn.textContent = "Regenerate";
      } else {
        recCap.textContent = "Not set — create a backup code.";
        recBtn.textContent = "Create";
      }
    }
    refreshRec();
    recBtn.addEventListener("click", async () => {
      const code = genRecoveryCode();
      await setRecovery(code);
      recBox.textContent = code;
      show(recBox);
      refreshRec();
      setMsg("New code shown above — save it. The old one no longer works.", true);
    });

    // ----- Share: QR code to install the APK (generated offline) -----
    const SHARE_URL =
      "https://iridescent-mooncake-68869c.netlify.app/get-app.html";
    const qrBtn = $("s_qrBtn");
    const qrWrap = $("s_qrWrap");
    let qrBuilt = false;
    qrBtn.addEventListener("click", () => {
      const showing = !qrWrap.classList.contains("hidden");
      if (showing) {
        qrWrap.classList.add("hidden");
        qrBtn.textContent = "📱 Show install QR code";
        return;
      }
      if (!qrBuilt) {
        try {
          const qr = window.qrcode(0, "M");
          qr.addData(SHARE_URL);
          qr.make();
          $("s_qrImg").innerHTML = qr.createImgTag(5, 16, "Install Debt Tracker");
          qrBuilt = true;
        } catch (e) {
          $("s_qrImg").innerHTML =
            '<p class="muted" style="padding:20px;">Couldn\'t generate the QR code.</p>';
        }
      }
      qrWrap.classList.remove("hidden");
      qrBtn.textContent = "Hide QR code";
    });
    $("s_qrCopy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(SHARE_URL);
        if (window.toast) toast("Install link copied.");
      } catch (e) {
        setMsg("Couldn't copy — long-press the QR's link instead.");
      }
    });
    const qrShare = $("s_qrShare");
    if (navigator.share) {
      show(qrShare);
      qrShare.addEventListener("click", () => {
        navigator
          .share({ title: "Debt Tracker", text: "Install Debt Tracker:", url: SHARE_URL })
          .catch(() => {});
      });
    }

    // ----- Feedback (opens the email app) -----
    const fb = $("s_feedback"),
      fbCount = $("s_fbCount"),
      fbErr = $("s_fbErr");
    fb.addEventListener("input", () => {
      fbCount.textContent = fb.value.length;
      fb.classList.remove("input-error");
      fbErr.classList.add("hidden");
    });
    $("s_feedbackBtn").addEventListener("click", () => {
      const text = fb.value.trim();
      if (!text) {
        fb.classList.add("input-error");
        fbErr.classList.remove("hidden");
        fb.focus();
        return;
      }
      const subject = "Debt Tracker feedback (v" + (window.APP_VERSION || "1") + ")";
      window.location.href =
        "mailto:" +
        FEEDBACK_EMAIL +
        "?subject=" +
        encodeURIComponent(subject) +
        "&body=" +
        encodeURIComponent(text);
      fb.value = "";
      fbCount.textContent = "0";
      setMsg("Opening your email app…", true);
    });

    // ----- Lock now (immediate) -----
    $("s_lockBtn").addEventListener("click", () => {
      previewTheme(window.getTheme ? getTheme() : "light"); // drop any unsaved theme preview
      lockNow();
    });

    // ----- Sticky Save / Discard bar (static elements → assign, don't stack) -----
    save.disabled = true;
    save.textContent = "Save changes";
    save.onclick = async () => {
      const v = validatePin();
      if (!v.ok) return setMsg("Fix the PIN fields before saving.");
      if (v.change) await setPin(v.pin);
      if (window.applyTheme) applyTheme(pendingTheme); // persist theme
      setLockOnClose(lockClose.checked);
      setHideAmounts(hideAmt.checked);
      sNew.value = "";
      sConf.value = "";
      validatePin();
      save.disabled = true;
      save.textContent = "Saved ✓";
      setMsg("Settings saved.", true);
      setTimeout(() => {
        save.textContent = "Save changes";
      }, 1600);
      if (window.loadDebtors) loadDebtors();
    };
    $("settingsDiscard").onclick = () => {
      pendingTheme = startTheme;
      previewTheme(startTheme);
      paintSeg();
      sNew.value = "";
      sConf.value = "";
      validatePin();
      lockClose.checked = getLockOnClose();
      hideAmt.checked = getHideAmounts();
      save.disabled = true;
      setMsg("Changes discarded.");
    };
    $("settingsBackBtn").onclick = () => {
      previewTheme(window.getTheme ? getTheme() : "light"); // revert unsaved preview
      if (window.showList) showList();
    };
  }

  function lockNow() {
    unlocked = false;
    stopInactivity();
    clearActivity(); // a deliberate/idle lock must survive a reload
    showUnlock();
    setTimeout(() => $("pinEnter") && $("pinEnter").focus(), 50);
  }

  /* ---------------- Wire up ---------------- */

  function wire() {
    // On a fresh load (first run, refresh, or reopen after back/swipe closed
    // the app): unlock automatically if you used it within the last 5 min,
    // otherwise require the PIN.
    if (!hasPin()) {
      panel("lockSetup");
      show($("lockScreen"));
    } else if (withinGrace()) {
      unlockApp();
    } else {
      showUnlock();
    }

    // Render PIN inputs as 4 boxes (unlock uses the stored length for older PINs).
    makePinField($("pinNew"), 4);
    makePinField($("pinConfirm"), 4);
    makePinField($("pinEnter"), pinLen() || 4);

    // Shared: after a PIN is (re)set, offer biometrics then open the app.
    async function afterPinSet() {
      if ((await biometricSupported()) && !biometricEnrolled()) {
        panel("lockEnroll");
        msg($("lockEnrollMsg"), "");
      } else {
        unlockApp();
      }
    }

    // --- Setup panel ---
    $("pinSetBtn").addEventListener("click", async () => {
      const a = $("pinNew").value.trim();
      const b = $("pinConfirm").value.trim();
      if (!/^\d{4}$/.test(a))
        return msg($("lockSetupMsg"), "PIN must be exactly 4 digits.");
      if (a !== b) return msg($("lockSetupMsg"), "PINs don't match.");

      await setPin(a);

      // Generate a fresh recovery code (this invalidates any previous one).
      currentRecoveryCode = genRecoveryCode();
      await setRecovery(currentRecoveryCode);
      $("recCode").textContent = currentRecoveryCode;
      $("recAck").checked = false;
      msg($("recMsg"), "");
      panel("lockRecovery");
    });

    // --- Recovery-code panel (setup) ---
    $("recCopyBtn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(currentRecoveryCode);
        msg($("recMsg"), "Copied. Now store it somewhere safe.", true);
      } catch (_) {
        msg($("recMsg"), "Copy failed — please write it down manually.");
      }
    });
    $("recContinueBtn").addEventListener("click", async () => {
      if (!$("recAck").checked)
        return msg($("recMsg"), "Please confirm you've saved the code.");
      currentRecoveryCode = ""; // drop it from memory
      await afterPinSet();
    });

    // --- Forgot-PIN flow ---
    $("forgotPinBtn").addEventListener("click", () => {
      $("recInput").value = "";
      msg($("forgotMsg"), "");
      // If no recovery code was ever set, guide them to the erase option.
      if (!hasRecovery()) {
        msg(
          $("forgotMsg"),
          "No recovery code on this device. Use biometrics, or erase below."
        );
      }
      panel("lockForgot");
    });
    $("forgotBackBtn").addEventListener("click", showUnlock);
    $("recVerifyBtn").addEventListener("click", async () => {
      const code = $("recInput").value;
      if (!code.trim()) return;
      if (await verifyRecovery(code)) {
        // Valid code → let them set a brand-new PIN (which mints a new code).
        $("pinNew").value = "";
        $("pinConfirm").value = "";
        msg($("lockSetupMsg"), "Recovery accepted. Set a new PIN.");
        panel("lockSetup");
      } else {
        msg($("forgotMsg"), "Incorrect recovery code.");
      }
    });
    $("resetAppBtn").addEventListener("click", () => {
      if (
        confirm(
          "Erase ALL debtors, payments, and your PIN? This cannot be undone."
        )
      ) {
        resetApp();
      }
    });

    // --- Enroll panel ---
    $("bioEnableBtn").addEventListener("click", async () => {
      msg($("lockEnrollMsg"), "Follow your device's prompt…");
      try {
        await enrollBiometric();
        unlockApp();
      } catch (err) {
        msg(
          $("lockEnrollMsg"),
          "Couldn't enable biometrics. Your PIN still works."
        );
        // Let them continue anyway after a moment.
        setTimeout(unlockApp, 1200);
      }
    });
    $("bioSkipBtn").addEventListener("click", unlockApp);

    // --- Unlock panel ---
    let pinChecking = false;
    async function tryPin() {
      if (pinChecking) return;
      const pin = $("pinEnter").value.trim();
      if (!pin) return;
      pinChecking = true;
      try {
        if (await verifyPin(pin)) {
          // Migrate older installs so auto-unlock works next time.
          const rec = JSON.parse(localStorage.getItem(LS_PIN) || "null");
          if (rec && typeof rec.len !== "number") {
            rec.len = pin.length;
            localStorage.setItem(LS_PIN, JSON.stringify(rec));
          }
          unlockApp();
        } else {
          wrongPin();
        }
      } finally {
        pinChecking = false;
      }
    }

    // Flash the boxes red, then empty them so the user can retry immediately.
    function wrongPin() {
      const el = $("pinEnter");
      const wrap = el.closest(".pin-field");
      msg($("lockUnlockMsg"), "Wrong PIN. Try again.");
      if (wrap) wrap.classList.add("error");
      shake();
      setTimeout(() => {
        el.value = "";
        el.dispatchEvent(new Event("input")); // re-render the boxes empty
        if (wrap) wrap.classList.remove("error");
        el.focus();
      }, 600);
    }

    // No unlock button: the PIN auto-submits at full length (below). Enter also works.
    $("pinEnter").addEventListener("keydown", (e) => {
      if (e.key === "Enter") tryPin();
    });
    // Auto-check the moment the PIN reaches its known length.
    $("pinEnter").addEventListener("input", () => {
      const len = pinLen();
      const val = $("pinEnter").value.trim();
      if (len && val.length === len) tryPin();
    });

    $("bioUnlockBtn").addEventListener("click", async () => {
      msg($("lockUnlockMsg"), "Follow your device's prompt…");
      try {
        await unlockWithBiometric();
        unlockApp();
      } catch (err) {
        msg($("lockUnlockMsg"), "Biometric unlock failed. Use your PIN.");
      }
    });

    // Settings (single button: theme, PIN, biometrics, recovery, lock)
    $("settingsBtn").addEventListener("click", openSettings);

    // Track interaction so we can lock after 5 min since last use.
    ["pointerdown", "keydown", "click", "scroll", "touchstart"].forEach((ev) =>
      document.addEventListener(
        ev,
        () => {
          if (unlocked) bumpActivity();
        },
        { passive: true }
      )
    );

    // Home/switch/back/close all just record the moment you left. On return
    // (or a fresh load, via wire) we lock only if 5 min has elapsed.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (unlocked) persistActivity();
        stopInactivity();
      } else if (unlocked && hasPin()) {
        if (now() - lastActivity >= INACTIVITY_MS) {
          lockNow();
        } else {
          startInactivity();
        }
      }
    });
    window.addEventListener("pagehide", () => {
      if (unlocked) persistActivity();
    });
  }

  // Boot as soon as the DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
