/* ============================================================
   auth.js — App lock: PIN (Web Crypto) + biometric (WebAuthn)
   Fully offline. Gates access to the app UI.
   Note: this protects ACCESS, not the raw stored data.
   ============================================================ */

(function () {
  "use strict";

  const LS_PIN = "dt_pin"; // { salt, hash, iter }
  const LS_CRED = "dt_cred"; // base64 credential id for biometrics
  const LS_UID = "dt_uid"; // base64 WebAuthn user handle
  const LS_REC = "dt_rec"; // { salt, hash, iter } for the recovery code
  const RELOCK_MS = 30000; // re-lock if app was in background >= 30s

  let currentRecoveryCode = ""; // held only in memory while shown at setup

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
  let hiddenAt = 0;

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

  function unlockApp() {
    unlocked = true;
    hide($("lockScreen"));
    show($("settingsBtn"));
    // Clear any typed PIN from the DOM.
    ["pinNew", "pinConfirm", "pinEnter"].forEach((id) => {
      if ($(id)) $(id).value = "";
    });
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
    // Reuse the app's generic modal (from app.js).
    openModal(
      "Settings",
      `
      <div class="settings-section-title">Appearance</div>
      <div class="theme-seg">
        <button type="button" class="btn small" id="s_themeDark">🌙 Dark</button>
        <button type="button" class="btn small" id="s_themeLight">☀️ Light</button>
      </div>

      <div class="settings-section-title">Change PIN</div>
      <div class="field"><label>Current PIN</label>
        <input id="s_cur" type="password" inputmode="numeric" maxlength="8" autocomplete="off" /></div>
      <div class="field"><label>New PIN (4–8 digits)</label>
        <input id="s_new" type="password" inputmode="numeric" maxlength="8" autocomplete="off" /></div>
      <div class="field"><label>Confirm New PIN</label>
        <input id="s_conf" type="password" inputmode="numeric" maxlength="8" autocomplete="off" /></div>

      <div class="settings-section-title">Security</div>
      <div class="settings-bio">
        <span id="s_bioLabel" class="muted"></span>
        <button type="button" class="btn small hidden" id="s_bioBtn"></button>
      </div>
      <div class="settings-bio">
        <span id="s_recLabel" class="muted"></span>
        <button type="button" class="btn small" id="s_recBtn"></button>
      </div>
      <div id="s_recBox" class="recovery-code hidden"></div>

      <button type="button" class="btn" id="s_lockBtn" style="width:100%;margin-top:14px;">🔒 Lock app now</button>
      <p id="s_msg" class="lock-msg"></p>
      `,
      async () => {
        const cur = $("s_cur").value.trim();
        const nw = $("s_new").value.trim();
        const cf = $("s_conf").value.trim();

        // Nothing typed → they may have only toggled biometrics; just close.
        if (!cur && !nw && !cf) return closeModal();

        if (!(await verifyPin(cur)))
          return ($("s_msg").textContent = "Current PIN is incorrect.");
        if (!/^\d{4,8}$/.test(nw))
          return ($("s_msg").textContent = "New PIN must be 4–8 digits.");
        if (nw !== cf)
          return ($("s_msg").textContent = "New PINs don't match.");

        await setPin(nw);
        closeModal();
        if (window.toast) toast("PIN changed.");
      }
    );

    // Configure the biometric row based on device support + enrollment.
    const supported = await biometricSupported();
    const label = $("s_bioLabel");
    const btn = $("s_bioBtn");

    function refreshBioRow() {
      if (!supported) {
        label.textContent = "Biometrics not available on this device.";
        hide(btn);
        return;
      }
      if (biometricEnrolled()) {
        label.textContent = "Fingerprint / face unlock: On";
        btn.textContent = "Disable";
        btn.classList.add("danger");
      } else {
        label.textContent = "Fingerprint / face unlock: Off";
        btn.textContent = "Enable";
        btn.classList.remove("danger");
      }
      show(btn);
    }
    refreshBioRow();

    btn.addEventListener("click", async () => {
      if (biometricEnrolled()) {
        localStorage.removeItem(LS_CRED);
        if (window.toast) toast("Biometric unlock disabled.");
        refreshBioRow();
      } else {
        try {
          $("s_msg").textContent = "Follow your device's prompt…";
          await enrollBiometric();
          $("s_msg").textContent = "";
          if (window.toast) toast("Biometric unlock enabled.");
          refreshBioRow();
        } catch (err) {
          $("s_msg").textContent = "Couldn't enable biometrics.";
        }
      }
    });

    // --- Recovery-code row ---
    const recLabel = $("s_recLabel");
    const recBtn = $("s_recBtn");
    const recBox = $("s_recBox");

    function refreshRecRow() {
      if (hasRecovery()) {
        recLabel.textContent = "Recovery code: set";
        recBtn.textContent = "Regenerate";
      } else {
        recLabel.textContent = "Recovery code: not set";
        recBtn.textContent = "Create";
      }
    }
    refreshRecRow();

    recBtn.addEventListener("click", async () => {
      const code = genRecoveryCode();
      await setRecovery(code);
      recBox.textContent = code;
      show(recBox);
      refreshRecRow();
      $("s_msg").textContent = "New code shown above — save it. The old one no longer works.";
    });

    // --- Appearance (theme) ---
    const darkBtn = $("s_themeDark");
    const lightBtn = $("s_themeLight");
    function refreshTheme() {
      const cur = window.getTheme ? getTheme() : "dark";
      darkBtn.classList.toggle("active", cur === "dark");
      lightBtn.classList.toggle("active", cur === "light");
    }
    refreshTheme();
    darkBtn.addEventListener("click", () => {
      if (window.applyTheme) applyTheme("dark");
      refreshTheme();
    });
    lightBtn.addEventListener("click", () => {
      if (window.applyTheme) applyTheme("light");
      refreshTheme();
    });

    // --- Lock now ---
    $("s_lockBtn").addEventListener("click", () => {
      closeModal();
      lockNow();
    });
  }

  function lockNow() {
    unlocked = false;
    showUnlock();
    setTimeout(() => $("pinEnter") && $("pinEnter").focus(), 50);
  }

  /* ---------------- Wire up ---------------- */

  function wire() {
    // First run vs returning
    if (!hasPin()) {
      panel("lockSetup");
      show($("lockScreen"));
    } else {
      showUnlock();
    }

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
      if (!/^\d{4,8}$/.test(a))
        return msg($("lockSetupMsg"), "PIN must be 4–8 digits.");
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
    async function tryPin(silent) {
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
        } else if (!silent) {
          msg($("lockUnlockMsg"), "Wrong PIN. Try again.");
          $("pinEnter").value = "";
          shake();
        }
      } finally {
        pinChecking = false;
      }
    }
    $("pinUnlockBtn").addEventListener("click", () => tryPin(false));
    $("pinEnter").addEventListener("keydown", (e) => {
      if (e.key === "Enter") tryPin(false);
    });
    // Auto-unlock: check as soon as the PIN reaches its known length.
    $("pinEnter").addEventListener("input", () => {
      const len = pinLen();
      const val = $("pinEnter").value.trim();
      if (len && val.length === len) tryPin(true);
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

    // Auto re-lock after being in the background a while
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        hiddenAt = new Date().getTime();
      } else if (unlocked && hasPin() && hiddenAt) {
        if (new Date().getTime() - hiddenAt >= RELOCK_MS) lockNow();
      }
    });
  }

  // Boot as soon as the DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
