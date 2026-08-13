/* ============================================================
   app.js — Core logic & UI
   Depends on db.js (DebtorsDB, PaymentsDB)
   ============================================================ */

/* -------------------- Config (set in code, not in the app UI) -------------------- */
/* Debtor sign-up auto-import: paste your Google Form's PUBLISHED CSV link here.
   When set, the app silently pulls new sign-ups on every open. Leave "" to disable.
   Example: https://docs.google.com/spreadsheets/d/e/XXXX/pub?output=csv        */
const SIGNUP_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSUpcJAbyjSGqxjCFfLaAcNGUgOGkII1jWD1uQWqwG7TkZSS4hkXCx18IySlfz6gilGz1u_Rfelttp9/pub?gid=91289261&single=true&output=csv";

/* The Google Form debtors fill in. SIGNUP_FORM_URL = the plain public link (Form → Send → link).
   SIGNUP_FORM_PREFILL = OPTIONAL, for multi-lender routing: the form's pre-filled link up to and
   including the Code field, e.g. ".../viewform?usp=pp_url&entry.123456789=" — the app appends this
   device's auto-generated tag so each lender's sign-ups route back to their own device. */
const SIGNUP_FORM_URL = "https://forms.gle/g5ENoD8kL1yZ22hn7";
const SIGNUP_FORM_PREFILL =
  "https://docs.google.com/forms/d/e/1FAIpQLSeVrw7bMT0odS9AcfpJYqLQQAvWqiRym1m1DJfQP4h7dUEuJQ/viewform?usp=pp_url&entry.2093344895=";

/* Automatic payment-confirmation email (optional). Deploy the Apps Script as a Web App on your
   dedicated account, paste its /exec URL below, and keep PAYMENT_SYNC_SECRET matching the
   script's SECRET. Blank URL = off → the in-app tap-to-send receipt is used instead. */
const PAYMENT_SYNC_URL =
  "https://script.google.com/macros/s/AKfycbzg1K8qJXVB4_QQfBtGAk6V0A8lYA7EW57xLcvfVSOf4zFY2u4POT1w8qNJmyDz7K_M7w/exec";
const PAYMENT_SYNC_SECRET = "dt-pay-9oytk60";

/* -------------------- Helpers -------------------- */

/** Format a number as Philippine Peso, e.g. 1234.5 -> ₱1,234.50 */
function peso(n) {
  const value = Number(n) || 0;
  return (
    "₱" +
    value.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** "2026-07-07T..." -> "Jul 7, 2026" */
function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** "2026-07-07T..." -> { key: "2026-07", label: "Jul 2026" } */
function monthOf(iso) {
  const d = new Date(iso);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const label = d.toLocaleDateString("en-PH", {
    month: "short",
    year: "numeric",
  });
  return { key, label };
}

/** Escape user text before inserting as HTML. */
function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const $ = (id) => document.getElementById(id);

let toastTimer = null;
let toastHideTimer = null;
function toast(msg) {
  const t = $("toast");
  clearTimeout(toastTimer);
  clearTimeout(toastHideTimer);

  t.textContent = msg;
  t.classList.remove("hidden");
  void t.offsetWidth; // force reflow so the transition plays from the start
  t.classList.add("show");

  toastTimer = setTimeout(() => {
    t.classList.remove("show"); // fade out
    toastHideTimer = setTimeout(() => t.classList.add("hidden"), 260);
  }, 2200);
}

/* -------------------- Theme -------------------- */

function getTheme() {
  try {
    return localStorage.getItem("dt_theme") || "light";
  } catch (e) {
    return "light";
  }
}
function applyTheme(t) {
  const theme = t === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("dt_theme", theme);
  } catch (e) {}
  // Keep the mobile status-bar matched to the page background in both themes.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#eef2f7" : "#080d1a");
}
function toggleTheme() {
  const next = getTheme() === "light" ? "dark" : "light";
  applyTheme(next);
  return next;
}

/* -------------------- Privacy: hide amounts by default -------------------- */

/** Reflect the "Hide amounts by default" preference as a root class so CSS
 *  can blur every element tagged `.money` until it's tapped to reveal. */
function applyHideAmounts() {
  let on = false;
  try {
    on = localStorage.getItem("dt_hideAmounts") === "1";
  } catch (e) {}
  document.documentElement.classList.toggle("hide-amounts", on);
}

/* -------------------- Reminders sync (opt-in) -------------------- */
/* When PAYMENT_SYNC_URL is set, recording a payment POSTs it to the Google Apps Script
   Web App, which emails the debtor an instant receipt. With no URL, nothing is sent and
   the app stays fully offline/private (the in-app tap-to-send receipt is used instead). */

function getSyncConfig() {
  return {
    url: (typeof PAYMENT_SYNC_URL === "string" ? PAYMENT_SYNC_URL : "").trim(),
    token: (typeof PAYMENT_SYNC_SECRET === "string" ? PAYMENT_SYNC_SECRET : "").trim(),
  };
}

/** Fire-and-forget POST (no-cors: request is delivered, reply isn't readable). */
function postSync(type, data) {
  const cfg = getSyncConfig();
  if (!cfg.url) return;
  const payload = JSON.stringify({ token: cfg.token, type, data });
  fetch(cfg.url, { method: "POST", mode: "no-cors", body: payload }).catch(() =>
    queueSync(payload)
  );
}
function queueSync(payload) {
  try {
    const q = JSON.parse(localStorage.getItem("dt_syncQueue") || "[]");
    q.push(payload);
    localStorage.setItem("dt_syncQueue", JSON.stringify(q.slice(-100)));
  } catch (e) {}
}
/** Resend anything that was queued while offline. */
function flushSyncQueue() {
  const cfg = getSyncConfig();
  if (!cfg.url) return;
  let q = [];
  try {
    q = JSON.parse(localStorage.getItem("dt_syncQueue") || "[]");
  } catch (e) {}
  if (!q.length) return;
  try {
    localStorage.removeItem("dt_syncQueue");
  } catch (e) {}
  q.forEach((p) =>
    fetch(cfg.url, { method: "POST", mode: "no-cors", body: p }).catch(() => queueSync(p))
  );
}

/** Resolve the whole person from any of their loan ids. */
async function personFromRep(repId) {
  const rep = await DebtorsDB.get(repId);
  if (!rep) return null;
  const [debtors, pays] = await Promise.all([DebtorsDB.getAll(), PaymentsDB.getAll()]);
  return buildPersons(debtors, pays).find((p) => p.key === normName(rep.name)) || null;
}

/** Expected payment per period, honouring the debtor's chosen plan frequency
 *  (weekly or monthly). Weekly expected = monthly / 4. Returns null if no plan is set. */
function expectations(person) {
  const target = Number(person.monthlyTarget) || 0;
  if (!(target > 0)) return null;
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sumSince = (start) =>
    person.payments
      .filter((p) => new Date(p.date) >= start)
      .reduce((s, p) => s + Number(p.amount || 0), 0);
  const weekPaid = sumSince(weekStart);
  const monthPaid = sumSince(monthStart);
  const weekly = Math.round(target / 4);
  const freq = person.planFreq === "weekly" ? "weekly" : "monthly";
  // The active period drives the reminders.
  const period =
    freq === "weekly"
      ? { word: "weekly", label: "week", expected: weekly, paid: weekPaid, toGo: Math.max(0, weekly - weekPaid) }
      : { word: "monthly", label: "month", expected: target, paid: monthPaid, toGo: Math.max(0, target - monthPaid) };
  return {
    target,
    weekly,
    weekPaid,
    monthPaid,
    weekToGo: Math.max(0, weekly - weekPaid),
    monthToGo: Math.max(0, target - monthPaid),
    freq,
    period,
  };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Nominal weekly amount from a monthly expected (server splits it precisely per month's
 *  due-days; in-app we show the ÷4 estimate). */
function weeklyFromMonthly(monthly) {
  return Math.round((Number(monthly) || 0) / 4);
}

/** "1" -> "1st", "22" -> "22nd", etc. */
function ordinal(n) {
  n = Number(n) || 1;
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Human day-of-plan: weekday name (weekly) or "the Nth" (monthly). */
function planDayLabel(freq, planDay) {
  return freq === "weekly"
    ? WEEKDAYS[Number(planDay)] || "Saturday"
    : "the " + ordinal(planDay || 1);
}

/** Plain-language plan summary: rate, due day, and how long to clear. */
function planSummary(total, freq, monthly, planDay) {
  const M = Number(monthly) || 0;
  total = Number(total) || 0;
  if (!(M > 0)) return "";
  let dur = "";
  if (total > 0) {
    const months = Math.max(1, Math.ceil(total / M));
    dur = ` · clears in ~${months} month${months !== 1 ? "s" : ""}`;
  }
  return freq === "weekly"
    ? `≈ ${peso(weeklyFromMonthly(M))} every ${planDayLabel("weekly", planDay)} (${peso(M)}/mo split by week)${dur}`
    : `${peso(M)} on ${planDayLabel("monthly", planDay)} of each month${dur}`;
}

/** HTML for the Payment-plan fields: monthly expected (basis) + cadence toggle + due-day picker.
 *  `prefix` namespaces ids (e.g. "a_" / "m_"). `monthly` = expected monthly ₱. */
function planFieldsHtml(prefix, freq, monthly) {
  freq = freq === "weekly" ? "weekly" : "monthly";
  return `
    <div class="field"><label>Expected monthly payment (₱) <span class="muted">(plan basis)</span></label>
      <input id="${prefix}planAmt" type="number" inputmode="decimal" min="0" placeholder="e.g. 2400" value="${
        monthly ? esc(monthly) : ""
      }" /></div>
    <div class="field"><label>Send reminders</label>
      <div class="plan-seg" id="${prefix}planSeg">
        <button type="button" class="seg-btn ${freq === "weekly" ? "active" : ""}" data-freq="weekly">Weekly</button>
        <button type="button" class="seg-btn ${freq === "monthly" ? "active" : ""}" data-freq="monthly">Monthly</button>
      </div>
    </div>
    <div class="field"><label id="${prefix}dayLabel">Due day</label>
      <select id="${prefix}planDay"></select></div>
    <p class="plan-hint" id="${prefix}planHint"></p>`;
}

/** Wire the plan fields: cadence toggle, due-day picker (weekday vs day-of-month), live summary.
 *  Returns a reader for {planFreq, planAmount (monthly), planDay}. */
function wirePlanFields(prefix, totalInputId, initialDay) {
  const seg = $(prefix + "planSeg");
  const amtEl = $(prefix + "planAmt");
  const hintEl = $(prefix + "planHint");
  const dayEl = $(prefix + "planDay");
  const dayLabel = $(prefix + "dayLabel");
  const activeBtn = seg.querySelector(".seg-btn.active");
  const now = new Date();
  const state = {
    freq: activeBtn ? activeBtn.dataset.freq : "monthly",
    day: initialDay != null && initialDay !== "" ? Number(initialDay) : null,
  };
  function populateDays() {
    dayLabel.textContent = state.freq === "weekly" ? "Due day (each week)" : "Due day (each month)";
    let opts = "";
    if (state.freq === "weekly") {
      const def = state.day != null && state.day >= 0 && state.day <= 6 ? state.day : now.getDay();
      for (let d = 0; d < 7; d++)
        opts += `<option value="${d}" ${d === def ? "selected" : ""}>${WEEKDAYS[d]}</option>`;
    } else {
      const def = state.day != null && state.day >= 1 && state.day <= 28 ? state.day : Math.min(now.getDate(), 28);
      for (let d = 1; d <= 28; d++)
        opts += `<option value="${d}" ${d === def ? "selected" : ""}>${ordinal(d)}</option>`;
    }
    dayEl.innerHTML = opts;
    state.day = Number(dayEl.value);
  }
  function refresh() {
    const totalEl = $(totalInputId);
    const total = totalEl ? Number(totalEl.value) || 0 : 0;
    hintEl.textContent = planSummary(total, state.freq, amtEl.value, state.day) || "";
  }
  seg.querySelectorAll(".seg-btn").forEach((b) =>
    b.addEventListener("click", () => {
      state.freq = b.dataset.freq;
      state.day = null; // reset to a sensible default for the new cadence
      seg.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      populateDays();
      refresh();
    })
  );
  dayEl.addEventListener("change", () => {
    state.day = Number(dayEl.value);
    refresh();
  });
  amtEl.addEventListener("input", refresh);
  const totalEl = $(totalInputId);
  if (totalEl) totalEl.addEventListener("input", refresh);
  populateDays();
  refresh();
  return () => ({
    planFreq: state.freq,
    planAmount: Number(amtEl.value) || 0,
    planDay: Number(dayEl.value),
  });
}

/** The monthly-equivalent target the ledger/expectations use (planAmount is already monthly). */
function planMonthly(planFreq, planAmount) {
  return Number(planAmount) || 0;
}

/** Tap-to-send email: opens the phone's email app with a reminder pre-filled. */
async function emailReminder(repId) {
  const person = await personFromRep(repId);
  if (!person) return;
  if (person.remaining <= 0) return toast(`${person.name} has no outstanding balance.`);
  if (!person.email) return toast("Add an email for this debtor first (Edit).");

  const amt = peso(person.remaining);
  const subject = `Payment reminder — ${amt}`;
  let body = emailBrand("PAYMENT REMINDER") + `Hi ${person.name},\n\nFriendly reminder about your outstanding balance of ${amt}.\n`;
  const exp = expectations(person);
  if (exp) {
    const per = exp.period;
    body +=
      `\nYour ${per.word} payment plan\n` +
      `• This ${per.label}: ${peso(per.expected)} expected — ${peso(per.paid)} paid` +
      (per.toGo > 0 ? `, ${peso(per.toGo)} to go` : ` ✓`) +
      `\n`;
  }
  body += `\nThank you!` + EMAIL_SIGN;
  window.location.href =
    "mailto:" +
    encodeURIComponent(person.email) +
    "?subject=" +
    encodeURIComponent(subject) +
    "&body=" +
    encodeURIComponent(body);
}

/** Tap-to-send text: opens the phone's Messages app with a SHORT reminder pre-filled. */
async function smsReminder(repId) {
  const person = await personFromRep(repId);
  if (!person) return;
  if (person.remaining <= 0) return toast(`${person.name} has no outstanding balance.`);
  if (!person.phone) return toast("Add a phone number for this debtor first (Edit).");

  const amt = peso(person.remaining);
  let body = `Hi ${person.name}, reminder: ${amt} balance.`;
  const exp = expectations(person);
  if (exp) {
    const per = exp.period;
    body += ` ${per.word === "weekly" ? "Weekly" : "Monthly"} plan ${peso(per.expected)}`;
    body += per.toGo > 0 ? ` (${peso(per.toGo)} to go).` : ` (met ✓).`;
  }
  body += ` Thank you!`;
  const num = String(person.phone).replace(/[^\d+]/g, "");
  // iOS wants "&body="; Android wants "?body=".
  const sep = /iP(hone|od|ad)/.test(navigator.userAgent) ? "&" : "?";
  window.location.href = "sms:" + num + sep + "body=" + encodeURIComponent(body);
}

/** Branded plain-text header/footer for mailto emails (mailto can't do HTML/images). */
function emailBrand(title) {
  return "💰  DEBT TRACKER\n━━━━━━━━━━━━━━━━━━━━━━━━\n" + title + "\n\n";
}
const EMAIL_SIGN = "\n\n—\nSent with Debt Tracker";

/** Build a payment-receipt message: this payment + today/week/month/overall totals. */
function receiptText(person, paymentAmount) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); // Monday
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const sumSince = (start) =>
    person.payments
      .filter((p) => new Date(p.date) >= start)
      .reduce((s, p) => s + Number(p.amount || 0), 0);

  const today = sumSince(todayStart);
  const week = sumSince(weekStart);
  const month = sumSince(monthStart);
  const paid = person.paid;
  const total = person.totalDebt;
  const remaining = Math.max(0, person.remaining);
  const amt = peso(paymentAmount);
  const settled = remaining <= 0;

  const remainingLine = settled
    ? "*** FULLY PAID ✓ — no remaining balance. ***"
    : `*** REMAINING BALANCE TO PAY: ${peso(remaining)} ***`;

  const emailBody =
    emailBrand("PAYMENT RECEIPT") +
    `Hi ${person.name},\n\n` +
    `Payment received: ${amt} on ${fmtDate(now.toISOString())}.\n\n` +
    `${remainingLine}\n\n` +
    `Summary\n` +
    `• Today: ${peso(today)}\n` +
    `• This week: ${peso(week)}\n` +
    `• This month: ${peso(month)}\n` +
    `• Total paid: ${peso(paid)} of ${peso(total)}\n\n` +
    `Thank you!` +
    EMAIL_SIGN;

  const smsBody = settled
    ? `Hi ${person.name}, received ${amt}. FULLY PAID ✓ — no remaining balance. Thank you!`
    : `Hi ${person.name}, received ${amt}. REMAINING BALANCE TO PAY: ${peso(remaining)}. ` +
      `(Paid ${peso(paid)} of ${peso(total)}. Today ${peso(today)}, wk ${peso(week)}, mo ${peso(
        month
      )}.) Thank you!`;

  const summaryHtml = `
    <p class="muted" style="margin:0 0 12px;">Receipt for <b>${esc(
      person.name
    )}</b> — payment of <b>${amt}</b>.</p>
    <ul class="receipt-list">
      <li><span>Today</span><b>${peso(today)}</b></li>
      <li><span>This week</span><b>${peso(week)}</b></li>
      <li><span>This month</span><b>${peso(month)}</b></li>
      <li><span>Total paid</span><b>${peso(paid)} / ${peso(total)}</b></li>
      <li><span>Remaining</span><b class="${settled ? "" : ""}">${peso(remaining)}${
    settled ? " ✓" : ""
  }</b></li>
    </ul>`;

  return {
    email: { subject: `Payment received — ${amt}`, body: emailBody },
    sms: { body: smsBody },
    summaryHtml,
  };
}

/** After a payment: show a receipt card with tap-to-send Email / Text buttons. */
function showPaymentReceipt(person, paymentAmount) {
  const r = receiptText(person, paymentAmount);
  const emailBtn = person.email
    ? `<button class="btn primary" id="rc_email">✉️ Email receipt</button>`
    : "";
  const smsBtn = person.phone
    ? `<button class="btn" id="rc_sms">💬 Text receipt</button>`
    : "";

  openModal(
    "Payment recorded ✓",
    `${r.summaryHtml}<div class="choice-actions">${emailBtn}${smsBtn}</div>`,
    null
  );
  $("modalSave").style.display = "none";
  $("modalCancel").textContent = "Done";

  if (person.email) {
    $("rc_email").addEventListener("click", () => {
      window.location.href =
        "mailto:" +
        encodeURIComponent(person.email) +
        "?subject=" +
        encodeURIComponent(r.email.subject) +
        "&body=" +
        encodeURIComponent(r.email.body);
    });
  }
  if (person.phone) {
    $("rc_sms").addEventListener("click", () => {
      const num = String(person.phone).replace(/[^\d+]/g, "");
      const sep = /iP(hone|od|ad)/.test(navigator.userAgent) ? "&" : "?";
      window.location.href = "sms:" + num + sep + "body=" + encodeURIComponent(r.sms.body);
    });
  }
}

/** Push a person's current state to the sheet; pass amount to also confirm a payment. */
async function syncDebtorById(repId, paymentAmount) {
  const cfg = getSyncConfig();
  if (!cfg.url) return;
  try {
    const rep = await DebtorsDB.get(repId);
    if (!rep) return;
    const [debtors, pays] = await Promise.all([
      DebtorsDB.getAll(),
      PaymentsDB.getAll(),
    ]);
    const person = buildPersons(debtors, pays).find(
      (p) => p.key === normName(rep.name)
    );
    if (!person) return;
    const base = {
      key: person.key,
      name: person.name,
      email: person.email || "",
      total: person.totalDebt,
      paid: person.paid,
      remaining: Math.max(0, person.remaining),
      planFreq: person.planFreq === "weekly" ? "weekly" : "monthly",
      monthly: Number(person.planAmount) || Number(person.monthlyTarget) || 0,
      planDay: person.planDay != null ? Number(person.planDay) : person.planFreq === "weekly" ? 6 : 1,
    };
    if (paymentAmount)
      postSync("payment_added", { ...base, amount: Number(paymentAmount) });
    else postSync("debtor_upsert", base);
  } catch (e) {
    /* best-effort; never block the UI */
  }
}

/* -------------------- Sign-up form auto-import -------------------- */
/* Pulls new debtors from a published Google Sheet CSV (the form's responses).
   Only ADDS names that don't already exist — never overwrites your edits. */

/** The sign-up CSV link comes from the SIGNUP_CSV_URL config at the top of this file
 *  (backend-set, not shown in the app). */
function getSignupUrl() {
  return (typeof SIGNUP_CSV_URL === "string" ? SIGNUP_CSV_URL : "").trim();
}

/** This device's auto-generated tag — only sign-up rows carrying it import here. */
function getLenderCode() {
  try {
    return (localStorage.getItem("dt_lenderCode") || "").trim();
  } catch (e) {
    return "";
  }
}
function setLenderCode(c) {
  try {
    localStorage.setItem("dt_lenderCode", (c || "").trim());
  } catch (e) {}
}
/** Auto-generate this device's tag once (used only for multi-lender routing). */
function ensureLenderCode() {
  if (!getLenderCode()) setLenderCode("d" + Math.random().toString(36).slice(2, 8));
  return getLenderCode();
}
/** The link to give debtors: personalized (with this device's tag) if a pre-fill base is
 *  configured, otherwise the plain form link. */
function signupShareLink() {
  if (SIGNUP_FORM_PREFILL) return SIGNUP_FORM_PREFILL + encodeURIComponent(ensureLenderCode());
  return SIGNUP_FORM_URL || "";
}

/** Fetch the form's CSV and add any new sign-ups. `silent` = quiet on-open pull. */
async function pullSignups(silent) {
  const url = getSignupUrl();
  if (!url) {
    if (!silent) toast("Add your form's published CSV link first.");
    return;
  }
  let text;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    text = await res.text();
  } catch (e) {
    if (!silent) toast("Couldn't fetch the sheet — use ⬆ Import CSV instead.");
    return;
  }

  let rows;
  try {
    rows = parseCSV(text).filter((r) => r.some((c) => String(c).trim() !== ""));
  } catch (e) {
    rows = [];
  }
  if (rows.length < 2) {
    if (!silent) toast("No sign-ups found in that link.");
    return;
  }

  const header = rows[0].map(normLabel);
  const col = {};
  header.forEach((h, i) => {
    if (!(h in col)) col[h] = i;
  });
  const iName = col["debtor name"],
    iDebt = col["total debt"];
  if (iName == null || iDebt == null) {
    if (!silent) toast("Sheet needs 'Debtor Name' and 'Total Debt' columns.");
    return;
  }
  const iTarget = col["monthly target"],
    iRule = col["payment rule"],
    iDue = col["due date"],
    iNote = col["note"],
    iEmail = col["email"],
    iPhone = col["phone"] != null ? col["phone"] : col["phone number"],
    iCode = col["code"] != null ? col["code"] : col["lender"];

  // If the sheet has a Code column, route by this device's code. If it has none,
  // there's nothing to route by → single-lender mode (import everyone).
  const myCode = getLenderCode().toLowerCase();
  if (iCode != null && !myCode) {
    if (!silent) toast("Set your sign-up code first (Settings).");
    return;
  }

  const existing = await DebtorsDB.getAll();
  const have = new Set(existing.map((d) => normName(d.name)));
  // Enforce one email per debtor: skip sign-ups whose email is already taken.
  const usedEmails = new Set(
    existing.map((d) => String(d.email || "").trim().toLowerCase()).filter(Boolean)
  );

  let added = 0,
    skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (iCode != null) {
      const rowCode = String(row[iCode] || "").trim().toLowerCase();
      if (rowCode !== myCode) continue; // not for this device
    }
    const name = String(row[iName] || "").trim();
    if (!name) continue;
    const key = normName(name);
    if (have.has(key)) continue; // already in the app — never overwrite
    const totalDebt = parseNum(row[iDebt]);
    if (!(totalDebt > 0)) continue;

    const email = iEmail != null ? String(row[iEmail] || "").trim() : "";
    const emailKey = email.toLowerCase();
    if (emailKey && usedEmails.has(emailKey)) {
      skipped++; // that email already belongs to another debtor
      continue;
    }

    await DebtorsDB.add({
      name,
      totalDebt,
      monthlyTarget: iTarget != null ? parseNum(row[iTarget]) : 0,
      paymentRule: iRule != null ? String(row[iRule] || "").trim() : "",
      dueDate: iDue != null ? parseDateISO(row[iDue]) || "" : "",
      note: iNote != null ? String(row[iNote] || "").trim() : "",
      email,
      phone: iPhone != null ? String(row[iPhone] || "").trim() : "",
    });
    have.add(key);
    if (emailKey) usedEmails.add(emailKey);
    added++;
  }

  if (added > 0) {
    if (currentDetailKey == null) loadDebtors();
    else refreshCurrentView();
    toast(
      `Imported ${added} new sign-up${added !== 1 ? "s" : ""}.` +
        (skipped ? ` Skipped ${skipped} with a duplicate email.` : "")
    );
  } else if (skipped && !silent) {
    toast(`Skipped ${skipped} sign-up${skipped !== 1 ? "s" : ""} with a duplicate email.`);
  } else if (!silent) {
    toast("No new sign-ups.");
  }
}

/* -------------------- Name / month helpers -------------------- */

/** Normalize a name for grouping (case-insensitive, trimmed, collapsed spaces). */
function normName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Current month key, e.g. "2026-07". */
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Group debtor records that share a name into "persons".
 * Each person aggregates debt, target and payments across all their entries.
 */
function buildPersons(debtors, allPayments) {
  const map = new Map();
  debtors.forEach((d) => {
    const key = normName(d.name);
    if (!map.has(key)) {
      map.set(key, {
        key,
        name: d.name.trim(),
        loans: [],
        loanIds: [],
        totalDebt: 0,
        monthlyTarget: 0,
      });
    }
    const p = map.get(key);
    p.loans.push(d);
    p.loanIds.push(d.id);
    p.totalDebt += Number(d.totalDebt || 0);
    p.monthlyTarget += Number(d.monthlyTarget || 0);
  });
  const persons = Array.from(map.values());
  persons.forEach((p) => {
    p.payments = allPayments.filter((pay) => p.loanIds.includes(pay.debtorId));
    p.paid = p.payments.reduce((s, x) => s + Number(x.amount || 0), 0);
    p.remaining = p.totalDebt - p.paid;
    // Payment attaches to the first loan record for this person.
    p.payToId = p.loans[0].id;
    // Earliest due date across this person's loans; notes joined.
    const dues = p.loans.map((l) => l.dueDate).filter(Boolean).sort();
    p.dueDate = dues[0] || "";
    p.note = p.loans.map((l) => l.note).filter(Boolean).join(" · ");
    // First email / phone found across this person's loan records.
    p.email = (p.loans.map((l) => l.email).find((e) => e && e.trim()) || "").trim();
    p.phone = (p.loans.map((l) => l.phone).find((x) => x && x.trim()) || "").trim();
    // Payment plan: first loan that carries one; fall back to a legacy monthlyTarget.
    const pl =
      p.loans.find((l) => Number(l.planAmount) > 0) ||
      p.loans.find((l) => Number(l.monthlyTarget) > 0);
    if (pl) {
      p.planFreq = pl.planFreq === "weekly" ? "weekly" : "monthly";
      // planAmount is the expected MONTHLY amount (falls back to a legacy monthlyTarget).
      p.planAmount =
        Number(pl.planAmount) > 0 ? Number(pl.planAmount) : Number(pl.monthlyTarget) || 0;
      p.planDay = pl.planDay != null ? Number(pl.planDay) : p.planFreq === "weekly" ? 6 : 1;
    } else {
      p.planFreq = "monthly";
      p.planAmount = 0;
      p.planDay = 1;
    }
  });
  // Sort: unsettled first, then by name.
  persons.sort((a, b) => {
    const au = a.remaining > 0 ? 0 : 1;
    const bu = b.remaining > 0 ? 0 : 1;
    if (au !== bu) return au - bu;
    return a.name.localeCompare(b.name);
  });
  return persons;
}

/* -------------------- Debtor CRUD -------------------- */

/** Primary "Add debtor" action: show the sign-up QR/link so the debtor self-registers
 *  (→ lands in the sheet → gets automatic reminders). Falls back to the manual form if
 *  no sign-up link is configured. */
function openSignupQR() {
  const link = (window.signupShareLink ? signupShareLink() : "") || SIGNUP_FORM_URL || "";
  if (!link) return openAddDebtor(); // no form configured → manual add
  openModal(
    "Add debtor",
    `
    <p class="muted modal-intro">Have the debtor scan this (or open the link) to sign up.
      They'll appear here automatically and get payment reminders.</p>
    <div class="qr-box">
      <div class="qr-img" id="add_qr"></div>
      <p class="qr-cap">Scan to sign up as a debtor</p>
      <div class="qr-actions">
        <button type="button" class="btn small" id="add_copy">Copy link</button>
        <button type="button" class="btn small hidden" id="add_share">Share…</button>
      </div>
    </div>
    <button type="button" class="link-btn" id="add_manual">Or add manually (no reminders)</button>
  `,
    null
  );
  $("modalSave").style.display = "none";
  $("modalCancel").textContent = "Close";
  try {
    const qr = window.qrcode(0, "M");
    qr.addData(link);
    qr.make();
    $("add_qr").innerHTML = qr.createImgTag(5, 16, "Sign-up form");
  } catch (e) {}
  $("add_copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied.");
    } catch (e) {
      toast("Couldn't copy — long-press the link to copy it.");
    }
  });
  const sh = $("add_share");
  if (navigator.share) {
    sh.classList.remove("hidden");
    sh.addEventListener("click", () =>
      navigator
        .share({ title: "Sign up", text: "Add yourself as a debtor:", url: link })
        .catch(() => {})
    );
  }
  $("add_manual").addEventListener("click", openAddDebtor);
}

/** Name of another debtor already using this email (reminders are matched by email, so a shared
 *  email would conflict on the server). Returns null if it's free or belongs to `exceptKey`. */
async function emailOwner(email, exceptKey) {
  email = String(email || "").trim().toLowerCase();
  if (!email) return null;
  const debtors = await DebtorsDB.getAll();
  for (const d of debtors) {
    if (String(d.email || "").trim().toLowerCase() !== email) continue;
    if (normName(d.name) !== exceptKey) return d.name;
  }
  return null;
}

/** Open the Add-debtor modal: Name, Amount, Due date, Note + a weekly/monthly payment plan. */
function openAddDebtor() {
  let readPlan = () => ({ planFreq: "monthly", planAmount: 0, planDay: 1 });
  openModal(
    "Add debtor",
    `
    <p class="muted modal-intro">Record who owes you and how much.</p>
    <div class="field"><label>Name</label>
      <input id="a_name" placeholder="e.g. Juan Dela Cruz" /></div>
    <div class="field-row">
      <div class="field"><label>Email <span class="muted">(reminders)</span></label>
        <input id="a_email" type="email" inputmode="email" autocomplete="off" placeholder="juan@email.com" /></div>
      <div class="field"><label>Phone <span class="muted">(text)</span></label>
        <input id="a_phone" type="tel" inputmode="tel" autocomplete="off" placeholder="09xx xxx xxxx" /></div>
    </div>
    <div class="field"><label>Amount owed (₱)</label>
      <input id="a_debt" type="number" inputmode="decimal" min="0" placeholder="0.00" /></div>
    ${planFieldsHtml("a_", "monthly", "")}
    <div class="field"><label>Note</label>
      <input id="a_note" placeholder="optional" /></div>
  `,
    async () => {
      const name = $("a_name").value.trim();
      const totalDebt = Number($("a_debt").value);
      if (!name) return toast("Please enter a name.");
      if (!(totalDebt > 0)) return toast("Enter a valid amount owed.");

      const email = $("a_email").value.trim();
      const phone = $("a_phone").value.trim();
      const note = $("a_note").value.trim();
      const { planFreq, planAmount, planDay } = readPlan();
      const monthlyTarget = planMonthly(planFreq, planAmount);

      const dupe = await emailOwner(email, normName(name));
      if (dupe) {
        $("a_email").focus();
        return toast(`That email is already used by "${dupe}". Each debtor needs a unique email.`);
      }

      const id = await DebtorsDB.add({
        name, totalDebt, planFreq, planAmount, planDay, monthlyTarget, note, email, phone,
      });
      closeModal();
      toast("Debtor added.");
      syncDebtorById(id); // enrol in the plan-based reminder engine
      loadDebtors(true);
    }
  );
  $("modalSave").textContent = "+ Add debtor";
  readPlan = wirePlanFields("a_", "a_debt");
  setTimeout(() => $("a_name") && $("a_name").focus(), 60);
}

/** Delete a single debt entry (loan) and its payments. */
async function deleteLoan(id) {
  const d = await DebtorsDB.get(id);
  if (!d) return;
  if (!confirm(`Delete this ${peso(d.totalDebt)} debt entry and its payments?`))
    return;

  await PaymentsDB.deleteByDebtor(id);
  await DebtorsDB.delete(id);
  toast("Debt entry deleted.");
  refreshCurrentView();
}

/** Delete an entire person (all their debt entries + payments). */
async function deletePerson(repId) {
  const rep = await DebtorsDB.get(repId);
  if (!rep) return;
  const all = await DebtorsDB.getAll();
  const key = normName(rep.name);
  const loans = all.filter((d) => normName(d.name) === key);

  if (
    !confirm(
      `Delete "${rep.name.trim()}" — all ${loans.length} debt entr${
        loans.length > 1 ? "ies" : "y"
      } and every payment? This cannot be undone.`
    )
  )
    return;

  for (const loan of loans) {
    await PaymentsDB.deleteByDebtor(loan.id);
    await DebtorsDB.delete(loan.id);
  }
  toast("Person deleted.");
  if (currentDetailKey === key) showList();
  else loadDebtors();
}

/* -------------------- Payment CRUD -------------------- */

async function addPayment(debtorId, amount, dateISO) {
  const amt = Number(amount);
  if (!(amt > 0)) return toast("Enter a valid payment amount.");

  await PaymentsDB.add({
    debtorId: Number(debtorId),
    amount: amt,
    date: dateISO || new Date().toISOString(),
  });
  toast("Payment recorded.");
  syncDebtorById(debtorId, amt); // Pro: auto-confirmation email (if sync is set up)
  const person = await personFromRep(debtorId);
  refreshCurrentView();
  // Offer a tap-to-send receipt (email / text) with the running summary.
  if (person && (person.email || person.phone)) showPaymentReceipt(person, amt);
}

/** Popup to record a payment with a chosen amount + date. */
function openPaymentModal(payToId, name) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  openModal(
    "Record Payment",
    `
    <p class="muted" style="margin:0 0 14px;color:var(--brand);font-weight:600;">${esc(
      name || ""
    )}</p>
    <div class="field"><label>Payment Amount (₱)</label>
      <input id="pm_amount" type="number" inputmode="decimal" min="0" placeholder="0.00" /></div>
    <div class="field"><label>Payment Date</label>
      <input id="pm_date" type="date" value="${yyyy}-${mm}-${dd}" /></div>
    `,
    async () => {
      const amt = Number($("pm_amount").value);
      if (!(amt > 0)) return ($("pm_amount").focus());
      const dv = $("pm_date").value;
      const iso = dv ? new Date(dv + "T00:00:00").toISOString() : new Date().toISOString();
      closeModal();
      await addPayment(payToId, amt, iso);
    }
  );
  $("modalSave").textContent = "Submit Payment";
  setTimeout(() => $("pm_amount") && $("pm_amount").focus(), 60);
}

async function deletePayment(paymentId) {
  if (!confirm("Delete this payment?")) return;
  await PaymentsDB.delete(paymentId);
  toast("Payment deleted.");
  refreshCurrentView();
}

/* -------------------- Totals -------------------- */

function totals(debtor, payments) {
  const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const remaining = Number(debtor.totalDebt || 0) - paid;
  return { paid, remaining };
}

/* -------------------- List View -------------------- */

// Search / filter state
let searchTerm = "";
let statusFilter = "all"; // all | active | paid

async function loadDebtors(animateCards = false) {
  applyHideAmounts(); // re-sync the blur preference on every render
  const [debtors, allPayments] = await Promise.all([
    DebtorsDB.getAll(),
    PaymentsDB.getAll(),
  ]);

  const persons = buildPersons(debtors, allPayments);

  const list = $("list");
  list.innerHTML = "";

  $("empty").classList.toggle("hidden", persons.length > 0);

  // Apply search + status filter (on the grouped person).
  const term = searchTerm.trim().toLowerCase();
  const visible = persons.filter((p) => {
    if (term && !p.name.toLowerCase().includes(term)) return false;
    if (statusFilter === "active" && p.remaining <= 0) return false;
    if (statusFilter === "paid" && p.remaining > 0) return false;
    return true;
  });

  $("noMatch").classList.toggle(
    "hidden",
    !(persons.length > 0 && visible.length === 0)
  );

  // ----- Dashboard: hero (outstanding + % collected) + secondary stats -----
  let outstanding = 0,
    totalAll = 0,
    collected = 0,
    paidFull = 0;
  persons.forEach((p) => {
    totalAll += p.totalDebt;
    collected += p.paid;
    if (p.remaining > 0) outstanding += p.remaining;
    else paidFull++;
  });
  const collectedPct = totalAll > 0 ? Math.round((collected / totalAll) * 100) : 0;
  if ($("statOutstanding")) $("statOutstanding").textContent = peso(outstanding);
  if ($("heroBar")) $("heroBar").style.width = collectedPct + "%";
  if ($("statCollectedPct")) $("statCollectedPct").textContent = collectedPct + "%";
  if ($("statCollected")) $("statCollected").textContent = peso(collected);
  if ($("statDebtors")) $("statDebtors").textContent = persons.length;
  if ($("statPaidFull")) $("statPaidFull").textContent = paidFull;

  // Hide search/filter/export chrome entirely when there are no debtors at all.
  if ($("listControls"))
    $("listControls").classList.toggle("hidden", persons.length === 0);

  visible.forEach((p, i) => {
    const settled = p.remaining <= 0;
    const rules = p.loans.map((l) => l.paymentRule).filter(Boolean);
    const ruleText = rules.length ? rules.join(" · ") : "";
    const planChip =
      p.planAmount > 0
        ? p.planFreq === "weekly"
          ? "≈" + peso(weeklyFromMonthly(p.planAmount)) + "/wk"
          : peso(p.planAmount) + "/mo"
        : "";
    const progress = Math.round(pct(p.paid, p.totalDebt));
    const loanCount =
      p.loans.length > 1 ? ` <span class="muted">· ${p.loans.length} debts</span>` : "";

    // Meta chips (plan / rule) — only meaningful while a balance remains.
    const meta = [];
    if (!settled && planChip) meta.push(`<span class="dcard-rule">🗓️ ${esc(planChip)}</span>`);
    if (!settled && ruleText) meta.push(`<span class="dcard-rule">${esc(ruleText)}</span>`);
    // Flag debtors on a plan who can't get automatic reminders (no email on file).
    if (!settled && p.planAmount > 0 && !p.email)
      meta.push(`<span class="dcard-warn">⚠️ No email — reminders off</span>`);

    const card = document.createElement("div");
    card.className = "dcard" + (settled ? " is-paid" : "");
    card.dataset.act = "view";
    card.dataset.id = p.payToId;
    if (animateCards) {
      card.classList.add("enter");
      card.style.animationDelay = Math.min(i, 8) * 45 + "ms";
    }
    card.innerHTML = `
      <div class="dcard-top">
        <h3 class="dcard-name">${esc(p.name)}${loanCount}</h3>
        ${settled ? `<span class="badge-paid">Paid in full</span>` : ""}
      </div>
      ${
        settled
          ? ""
          : `<p class="dcard-amount"><span class="money">${peso(
              p.remaining
            )}</span><span class="dcard-amount-label">remaining</span></p>`
      }
      ${
        !settled && p.paid > 0
          ? `<div class="dcard-bar"><span style="width:${progress}%"></span></div>
             <p class="dcard-sub"><span class="money">${peso(p.paid)} paid of ${peso(p.totalDebt)}</span></p>`
          : ""
      }
      ${meta.length ? `<div class="dcard-meta">${meta.join("")}</div>` : ""}
      ${p.note ? `<p class="dcard-note">“${esc(p.note)}”</p>` : ""}
      <div class="dcard-actions">
        ${
          settled
            ? ""
            : `<button class="btn small primary" data-act="paymodal" data-id="${p.payToId}" data-name="${esc(
                p.name
              )}">+ Pay</button>`
        }
        ${
          !settled && p.email
            ? `<button class="btn small" data-act="remind" data-id="${p.payToId}" title="Email reminder">✉️</button>`
            : ""
        }
        ${
          !settled && p.phone
            ? `<button class="btn small" data-act="text" data-id="${p.payToId}" title="Text reminder">💬</button>`
            : ""
        }
        <button class="btn small ghost" data-act="delperson" data-id="${p.payToId}">Delete</button>
      </div>
    `;
    list.appendChild(card);
  });

  const shown = visible.length;
  const filtered = shown !== persons.length;
  $("summary").textContent = persons.length
    ? `${filtered ? shown + " of " + persons.length : persons.length} ${
        persons.length > 1 ? "people" : "person"
      } · ${peso(outstanding)} outstanding`
    : "";
}

function pct(paid, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (paid / total) * 100));
}

/* -------------------- Detail View (per person) -------------------- */

let currentDetailKey = null;

/** `repId` is any loan id belonging to the person; we resolve the whole person. */
async function showDetail(repId) {
  applyHideAmounts();
  const rep = await DebtorsDB.get(repId);
  if (!rep) return showList();

  const [debtors, allPayments] = await Promise.all([
    DebtorsDB.getAll(),
    PaymentsDB.getAll(),
  ]);
  const key = normName(rep.name);
  currentDetailKey = key;

  const person = buildPersons(debtors, allPayments).find((p) => p.key === key);
  if (!person) return showList();

  const payments = [...person.payments].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  // ----- Loans (debt entries) -----
  const loansHtml = person.loans
    .map((l) => {
      const bits = [];
      if (l.paymentRule) bits.push(esc(l.paymentRule));
      const lM = Number(l.planAmount) > 0 ? Number(l.planAmount) : Number(l.monthlyTarget) || 0;
      if (lM > 0)
        bits.push(
          l.planFreq === "weekly"
            ? "≈" + peso(weeklyFromMonthly(lM)) + "/wk"
            : peso(lM) + "/mo"
        );
      return `
        <div class="loan">
          <div class="loan-info">
            <b class="money">${peso(l.totalDebt)}</b>
            ${bits.length ? `<small>${bits.join(" · ")}</small>` : ""}
          </div>
          <div class="loan-actions">
            <button class="btn tiny" data-act="editloan" data-id="${l.id}">Edit</button>
            <button class="btn tiny danger" data-act="delloan" data-id="${l.id}">Delete</button>
          </div>
        </div>`;
    })
    .join("");

  // ----- Payments grouped by month, with expected-vs-paid -----
  const groups = {};
  payments.forEach((p) => {
    const { key: mk, label } = monthOf(p.date);
    if (!groups[mk]) groups[mk] = { label, total: 0, items: [] };
    groups[mk].total += Number(p.amount || 0);
    groups[mk].items.push(p);
  });
  const monthKeys = Object.keys(groups).sort().reverse();
  const target = Number(person.monthlyTarget) || 0;

  let monthsHtml;
  if (monthKeys.length === 0) {
    monthsHtml = `<p class="empty">No payments yet.</p>`;
  } else {
    monthsHtml = monthKeys
      .map((k) => {
        const g = groups[k];
        const rows = g.items
          .map(
            (p) => `
          <li class="pay-row">
            <div><b class="money">${peso(p.amount)}</b><span class="muted"> · ${fmtDate(
              p.date
            )}</span></div>
            <div class="pay-row-actions">
              <button class="btn tiny" data-act="editpay" data-id="${p.id}">Edit</button>
              <button class="btn tiny danger" data-act="delpay" data-id="${p.id}">Delete</button>
            </div>
          </li>`
          )
          .join("");

        // Expected-vs-paid indicator for this month.
        let statusHtml = "";
        let expectedHtml = "";
        let barHtml = "";
        if (target > 0) {
          const met = g.total >= target;
          const diff = g.total - target;
          statusHtml = `<span class="month-status ${met ? "met" : "short"}">${
            met
              ? diff > 0
                ? peso(diff) + " over"
                : "met"
              : peso(target - g.total) + " short"
          }</span>`;
          expectedHtml = `<div class="month-expected">Expected ${peso(
            target
          )} · ${met ? "target reached ✓" : "under target (okay)"}</div>`;
          const w = Math.max(0, Math.min(100, (g.total / target) * 100));
          barHtml = `<div class="month-bar"><span class="${
            met ? "over" : ""
          }" style="width:${w}%"></span></div>`;
        }

        return `
          <div class="month">
            <div class="month-head">
              <span>${esc(g.label)}</span>
              <span>${statusHtml} <b class="money">${peso(g.total)}</b></span>
            </div>
            ${expectedHtml}
            ${barHtml}
            <ul class="pay-list">${rows}</ul>
          </div>`;
      })
      .join("");
  }

  const planBasis = person.remaining > 0 ? person.remaining : person.totalDebt;
  const targetLine =
    person.planAmount > 0
      ? `<p class="rule">🗓️ Plan: <b>${planSummary(
          planBasis,
          person.planFreq,
          person.planAmount,
          person.planDay
        )}</b> <span class="muted">· basis for reminders</span></p>`
      : target > 0
      ? `<p class="rule">🎯 Expected monthly payment: <b>${peso(target)}</b></p>`
      : "";

  const detailMeta = [];
  if (person.note) detailMeta.push(`📝 ${esc(person.note)}`);
  const metaLine = detailMeta.length
    ? `<p class="rule">${detailMeta.join(" &nbsp;·&nbsp; ")}</p>`
    : "";
  // Warn when this debtor has a plan but no email → automatic reminders can't reach them.
  const noEmailNote =
    person.remaining > 0 && person.planAmount > 0 && !person.email
      ? `<p class="rule warn-note">⚠️ No email on file — automatic reminders are off for this debtor. Add an email in <b>Edit</b>.</p>`
      : "";

  $("detailContent").innerHTML = `
    <div class="card detail-card">
      <div class="card-head">
        <h2>${esc(person.name)}</h2>
        <span class="pill ${person.remaining <= 0 ? "paid" : ""}">
          ${
            person.remaining <= 0
              ? "Settled"
              : `<span class="money">${peso(person.remaining)} left</span>`
          }
        </span>
      </div>
      <div class="stats big">
        <div><span class="muted">Total</span><b class="money">${peso(person.totalDebt)}</b></div>
        <div><span class="muted">Paid</span><b class="money">${peso(person.paid)}</b></div>
      </div>
      ${metaLine}
      ${targetLine}
      ${noEmailNote}
      <div class="progress"><span style="width:${pct(
        person.paid,
        person.totalDebt
      )}%"></span></div>

      <div class="add-pay">
        <button class="btn primary" data-act="paymodal" data-id="${person.payToId}"
                data-name="${esc(person.name)}" style="width:100%;">+ Record Payment</button>
        ${
          person.remaining > 0
            ? `<button class="btn" data-act="remind" data-id="${person.payToId}"
                 style="width:100%;margin-top:8px;">✉️ Send email reminder</button>
               <button class="btn" data-act="text" data-id="${person.payToId}"
                 style="width:100%;margin-top:8px;">💬 Send text reminder</button>`
            : ""
        }
      </div>
    </div>

    <div class="loans">
      <div class="loans-head">
        <h3>Debt entries</h3>
        <button class="btn small" data-act="addloan" data-name="${esc(
          person.name
        )}">+ Add debt</button>
      </div>
      ${loansHtml}
    </div>

    <h3 class="months-title">Payments by month</h3>
    ${monthsHtml}
  `;

  showView("detailView");
}

/* -------------------- Edit modals -------------------- */

let modalSaveHandler = null;

function openModal(title, bodyHtml, onSave) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = bodyHtml;
  modalSaveHandler = onSave;
  // Reset the footer buttons — a prior dialog (e.g. the sign-up QR) may have hidden/renamed them.
  $("modalSave").style.display = "";
  $("modalSave").textContent = "Save";
  $("modalCancel").textContent = "Cancel";
  $("modalOverlay").classList.remove("hidden");
  // Lock the background so it can't scroll while the panel is open.
  document.body.classList.add("modal-open");
}

function closeModal() {
  $("modalOverlay").classList.add("hidden");
  document.body.classList.remove("modal-open");
  $("modalBody").innerHTML = "";
  // Restore the footer buttons to their defaults (dialogs above may hide/rename them).
  $("modalSave").style.display = "";
  $("modalSave").textContent = "Save";
  $("modalCancel").textContent = "Cancel";
  modalSaveHandler = null;
}

async function editDebtor(id) {
  const d = await DebtorsDB.get(id);
  if (!d) return;

  const initFreq = d.planFreq === "weekly" ? "weekly" : "monthly";
  const initAmt = Number(d.planAmount) > 0 ? d.planAmount : d.monthlyTarget || "";
  const initDay = d.planDay != null ? d.planDay : "";
  let readPlan = () => ({ planFreq: initFreq, planAmount: Number(initAmt) || 0, planDay: Number(initDay) || 1 });

  openModal(
    "Edit Debt Entry",
    `
    <div class="field"><label>Name</label>
      <input id="m_name" value="${esc(d.name)}" /></div>
    <div class="field-row">
      <div class="field"><label>Email <span class="muted">(reminders)</span></label>
        <input id="m_email" type="email" value="${esc(d.email || "")}" placeholder="juan@email.com" /></div>
      <div class="field"><label>Phone <span class="muted">(text)</span></label>
        <input id="m_phone" type="tel" value="${esc(d.phone || "")}" placeholder="09xx xxx xxxx" /></div>
    </div>
    <div class="field"><label>Total Debt (₱)</label>
      <input id="m_debt" type="number" min="0" value="${esc(d.totalDebt)}" /></div>
    ${planFieldsHtml("m_", initFreq, initAmt)}
    <div class="field"><label>Note</label>
      <input id="m_note" value="${esc(d.note || "")}" placeholder="optional" /></div>
    <p class="rec-small muted">Tip: same name = grouped with this person.</p>
  `,
    async () => {
      const name = $("m_name").value.trim();
      const totalDebt = Number($("m_debt").value);
      const { planFreq, planAmount, planDay } = readPlan();
      const monthlyTarget = planMonthly(planFreq, planAmount);
      const note = $("m_note").value.trim();
      const email = $("m_email").value.trim();
      const phone = $("m_phone").value.trim();
      if (!name) return toast("Name is required.");
      if (!(totalDebt > 0)) return toast("Enter a valid total debt.");

      const dupe = await emailOwner(email, normName(name));
      if (dupe) {
        $("m_email").focus();
        return toast(`That email is already used by "${dupe}". Each debtor needs a unique email.`);
      }

      await DebtorsDB.put({ ...d, name, totalDebt, planFreq, planAmount, planDay, monthlyTarget, note, email, phone });
      closeModal();
      toast("Updated.");
      currentDetailKey = normName(name); // follow a possible rename
      syncDebtorById(id); // re-sync the plan to the reminder engine
      refreshCurrentView();
    }
  );
  readPlan = wirePlanFields("m_", "m_debt", initDay);
}

/** Add another debt entry under an existing person (same name). */
function addLoan(name) {
  let readPlan = () => ({ planFreq: "monthly", planAmount: 0, planDay: 1 });
  openModal(
    "Add debt for " + name,
    `
    <div class="field"><label>Total Debt (₱)</label>
      <input id="m_debt" type="number" min="0" placeholder="0.00" /></div>
    ${planFieldsHtml("m_", "monthly", "")}
    <div class="field"><label>Note</label>
      <input id="m_note" placeholder="optional" /></div>
  `,
    async () => {
      const totalDebt = Number($("m_debt").value);
      const { planFreq, planAmount, planDay } = readPlan();
      const monthlyTarget = planMonthly(planFreq, planAmount);
      const note = $("m_note").value.trim();
      if (!(totalDebt > 0)) return toast("Enter a valid total debt.");

      const nid = await DebtorsDB.add({ name, totalDebt, planFreq, planAmount, planDay, monthlyTarget, note });
      closeModal();
      toast("Debt entry added.");
      syncDebtorById(nid); // re-sync the plan to the reminder engine
      refreshCurrentView();
    }
  );
  readPlan = wirePlanFields("m_", "m_debt");
}

async function editPayment(id) {
  const p = await PaymentsDB.get(id);
  if (!p) return;

  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
  const dt = new Date(p.date);
  const localValue = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  openModal(
    "Edit Payment",
    `
    <div class="field"><label>Amount (₱)</label>
      <input id="m_amt" type="number" min="0" value="${esc(p.amount)}" /></div>
    <div class="field"><label>Date</label>
      <input id="m_date" type="datetime-local" value="${localValue}" /></div>
  `,
    async () => {
      const amount = Number($("m_amt").value);
      const dateVal = $("m_date").value;
      if (!(amount > 0)) return toast("Enter a valid amount.");

      const iso = dateVal ? new Date(dateVal).toISOString() : p.date;
      await PaymentsDB.put({ ...p, amount, date: iso });
      closeModal();
      toast("Payment updated.");
      refreshCurrentView();
    }
  );
}

/* -------------------- View switching -------------------- */

function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(id).classList.remove("hidden");
  window.scrollTo(0, 0);
}

function showList() {
  currentDetailKey = null;
  showView("listView");
  loadDebtors(true);
}

async function refreshCurrentView() {
  if (currentDetailKey != null) {
    const all = await DebtorsDB.getAll();
    const rep = all.find((d) => normName(d.name) === currentDetailKey);
    if (rep) return showDetail(rep.id);
    return showList();
  }
  loadDebtors();
}

/* -------------------- CSV export -------------------- */

/** Wrap a value for CSV: escape quotes, quote if it contains , " or newline. */
function csvCell(val) {
  const s = String(val == null ? "" : val);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCSV(headers, rows) {
  const lines = [headers.map(csvCell).join(",")];
  rows.forEach((r) => lines.push(r.map(csvCell).join(",")));
  // BOM so Excel reads UTF-8 (₱) correctly.
  return "﻿" + lines.join("\r\n");
}

function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// YYYYMMDD stamp for export filenames.
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// One combined sheet: debtor info repeats on each of its payment rows, so a
// debtor and its payments stay linked in a single spreadsheet.
const DATA_HEADERS = [
  "Debtor Name",
  "Total Debt",
  "Monthly Target",
  "Payment Rule",
  "Payment Date",
  "Payment Amount",
  "Due Date",
  "Note",
  "Email",
  "Phone",
];

/** ISO timestamp -> "YYYY-MM-DD" using local date parts. */
function isoDay(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

async function exportDataCSV() {
  const [debtors, payments] = await Promise.all([
    DebtorsDB.getAll(),
    PaymentsDB.getAll(),
  ]);
  if (!debtors.length) return toast("No data to export.");

  // Group by name (same way the app displays people) so it round-trips.
  const persons = buildPersons(debtors, payments);
  const rows = [];
  persons.forEach((p) => {
    const rule = (p.loans.map((l) => l.paymentRule).find((r) => r && r.trim()) || "").trim();
    const due = p.dueDate ? isoDay(p.dueDate) : "";
    const note = p.note || "";
    const email = p.email || "";
    const phone = p.phone || "";
    const pays = [...p.payments].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (pays.length) {
      pays.forEach((pay) =>
        rows.push([p.name, p.totalDebt, p.monthlyTarget, rule, isoDay(pay.date), pay.amount, due, note, email, phone])
      );
    } else {
      rows.push([p.name, p.totalDebt, p.monthlyTarget, rule, "", "", due, note, email, phone]);
    }
  });

  downloadCSV(`debt-tracker-${stamp()}.csv`, toCSV(DATA_HEADERS, rows));
  toast("Data exported.");
}

/* -------------------- CSV import -------------------- */

/** Normalize a header label for matching: trim, lowercase, collapse spaces. */
function normLabel(s) {
  return String(s || "").replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Parse a number from a cell, ignoring ₱, commas and spaces. */
function parseNum(v) {
  const n = Number(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}

/** Parse a date cell to an ISO string, or null if unreadable. */
function parseDateISO(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  let d = new Date(s);
  if (!isNaN(d)) return d.toISOString();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = "20" + y;
    d = new Date(`${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);
    if (!isNaN(d)) return d.toISOString();
  }
  return null;
}

/** Minimal RFC-4180 CSV parser (handles quotes, commas and newlines in cells). */
function parseCSV(text) {
  const rows = [];
  let row = [],
    field = "",
    i = 0,
    q = false;
  const s = String(text).replace(/^﻿/, "");
  while (i < s.length) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        q = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      q = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    field += c;
    i++;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

/** Promise-based choice dialog (reuses the shared modal). Resolves the chosen
 *  value, or null if cancelled. */
function askChoice(title, bodyHtml, buttons) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      $("modalCancel").removeEventListener("click", onCancel);
      $("modalOverlay").removeEventListener("click", onOverlay);
      closeModal();
      resolve(val);
    };
    const onCancel = () => finish(null);
    const onOverlay = (e) => {
      if (e.target.id === "modalOverlay") finish(null);
    };
    const btns = buttons
      .map(
        (b) =>
          `<button class="btn ${b.cls || ""}" data-choice="${esc(b.value)}">${esc(
            b.label
          )}</button>`
      )
      .join("");
    openModal(title, `${bodyHtml}<div class="choice-actions">${btns}</div>`, null);
    $("modalSave").style.display = "none";
    $("modalBody")
      .querySelectorAll("[data-choice]")
      .forEach((el) => el.addEventListener("click", () => finish(el.dataset.choice)));
    $("modalCancel").addEventListener("click", onCancel);
    $("modalOverlay").addEventListener("click", onOverlay);
  });
}

/** Explain the required format when a file can't be read. */
function showImportHelp(missing) {
  const need = DATA_HEADERS.map((h) => `<li>${esc(h)}</li>`).join("");
  openModal(
    "Can't read this file",
    `
    <p class="muted">The file is missing required column${missing.length > 1 ? "s" : ""}:
      <b>${missing.map(esc).join(", ")}</b>.</p>
    <p class="muted" style="margin-top:10px;">The first row of your spreadsheet must include
      these exact column labels:</p>
    <ul class="dup-list">${need}</ul>
    <p class="muted" style="margin-top:10px;">Tip: tap <b>⬇ Export data</b> first to get a
      correctly-formatted file, edit that, then re-upload it.</p>
    `,
    () => closeModal()
  );
  $("modalSave").textContent = "Got it";
}

async function importDataCSV(file) {
  let text;
  try {
    text = await file.text();
  } catch (e) {
    return toast("Could not read that file.");
  }
  const raw = parseCSV(text).filter((r) => r.some((c) => String(c).trim() !== ""));
  if (raw.length < 2) return showImportHelp(DATA_HEADERS);

  const header = raw[0].map(normLabel);
  const col = {};
  header.forEach((h, i) => {
    if (!(h in col)) col[h] = i;
  });
  // Only name + amount are required — a debtor-only CSV (e.g. a sign-up form
  // export, no payments yet) imports fine; payment columns are optional.
  const required = ["debtor name", "total debt"];
  const missing = required
    .filter((r) => !(r in col))
    .map((r) => DATA_HEADERS.find((h) => normLabel(h) === r) || r);
  if (missing.length) return showImportHelp(missing);

  const iName = col["debtor name"],
    iDebt = col["total debt"],
    iTarget = col["monthly target"],
    iRule = col["payment rule"],
    iPd = col["payment date"],
    iPa = col["payment amount"],
    iDue = col["due date"],
    iNote = col["note"],
    iEmail = col["email"],
    iPhone = col["phone"];

  const persons = new Map();
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r];
    const name = String(row[iName] || "").trim();
    if (!name) continue;
    const key = normName(name);
    if (!persons.has(key)) {
      persons.set(key, {
        name,
        totalDebt: parseNum(row[iDebt]),
        monthlyTarget: iTarget != null ? parseNum(row[iTarget]) : 0,
        paymentRule: iRule != null ? String(row[iRule] || "").trim() : "",
        dueDate: iDue != null ? parseDateISO(row[iDue]) || "" : "",
        note: iNote != null ? String(row[iNote] || "").trim() : "",
        email: iEmail != null ? String(row[iEmail] || "").trim() : "",
        phone: iPhone != null ? String(row[iPhone] || "").trim() : "",
        payments: [],
      });
    }
    const pd = iPd != null ? row[iPd] : "";
    const pa = iPa != null ? row[iPa] : "";
    if (String(pd || "").trim() !== "" && String(pa || "").trim() !== "") {
      const amt = parseNum(pa);
      const iso = parseDateISO(pd);
      if (amt > 0 && iso) persons.get(key).payments.push({ amount: amt, date: iso });
    }
  }

  const imported = Array.from(persons.values());
  if (!imported.length) return toast("No debtor rows found in the file.");

  const existing = await DebtorsDB.getAll();
  const existingByName = new Map();
  existing.forEach((d) => {
    const k = normName(d.name);
    if (!existingByName.has(k)) existingByName.set(k, []);
    existingByName.get(k).push(d);
  });
  const dups = imported.filter((p) => existingByName.has(normName(p.name)));

  let mode = "add";
  if (dups.length) {
    const names = dups.map((p) => p.name);
    const shown = names.slice(0, 8).map((n) => `<li>${esc(n)}</li>`).join("");
    const more = names.length > 8 ? `<li>…and ${names.length - 8} more</li>` : "";
    const choice = await askChoice(
      "Duplicate debtors found",
      `
      <p class="muted">${names.length} name${names.length !== 1 ? "s" : ""} in this file already
        exist in the app:</p>
      <ul class="dup-list">${shown}${more}</ul>
      <p class="muted" style="margin-top:10px;">Keep both copies, or replace the existing ones with
        the imported data?</p>
      `,
      [
        { value: "keepboth", label: "Keep both" },
        { value: "replace", label: "Replace existing", cls: "danger" },
      ]
    );
    if (choice === null) return toast("Import cancelled.");
    mode = choice;
  }

  let dCount = 0,
    pCount = 0;
  for (const p of imported) {
    const key = normName(p.name);
    if (mode === "replace" && existingByName.has(key)) {
      for (const ex of existingByName.get(key)) {
        await PaymentsDB.deleteByDebtor(ex.id);
        await DebtorsDB.delete(ex.id);
      }
    }
    const newId = await DebtorsDB.add({
      name: p.name,
      totalDebt: p.totalDebt,
      paymentRule: p.paymentRule,
      monthlyTarget: p.monthlyTarget,
      dueDate: p.dueDate || "",
      note: p.note || "",
      email: p.email || "",
      phone: p.phone || "",
    });
    dCount++;
    for (const pay of p.payments) {
      await PaymentsDB.add({ debtorId: Number(newId), amount: pay.amount, date: pay.date });
      pCount++;
    }
  }

  await loadDebtors();
  toast(
    `Imported ${dCount} debtor${dCount !== 1 ? "s" : ""}, ${pCount} payment${
      pCount !== 1 ? "s" : ""
    }.`
  );
}

/* -------------------- Event wiring -------------------- */

// Add-debtor buttons (header + empty state) open the modal
$("addDebtorBtn").addEventListener("click", openSignupQR);
$("emptyAddBtn").addEventListener("click", openSignupQR);

// Search + filter
$("search").addEventListener("input", (e) => {
  searchTerm = e.target.value;
  loadDebtors();
});
$("filter").addEventListener("change", (e) => {
  statusFilter = e.target.value;
  loadDebtors();
});

// CSV export / import
$("exportBtn").addEventListener("click", exportDataCSV);
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) importDataCSV(f);
  e.target.value = ""; // allow re-selecting the same file
});

// Back button
$("backBtn").addEventListener("click", showList);

// Modal buttons
$("modalCancel").addEventListener("click", closeModal);
$("modalSave").addEventListener("click", () => {
  if (modalSaveHandler) modalSaveHandler();
});
/** True if the open modal has a saveable form with anything typed in. */
function modalHasInput() {
  const body = $("modalBody");
  if (!body) return false;
  return Array.from(body.querySelectorAll("input, textarea")).some((el) => {
    const t = (el.type || "").toLowerCase();
    if (t === "button" || t === "submit") return false;
    return String(el.value || "").trim() !== "";
  });
}
// Tapping the backdrop closes info dialogs freely, but on a half-filled form it confirms first
// so an accidental tap never wipes what was entered.
$("modalOverlay").addEventListener("click", (e) => {
  if (e.target.id !== "modalOverlay") return;
  if (
    modalSaveHandler &&
    modalHasInput() &&
    !confirm("Discard this entry? Your details will be lost.")
  )
    return;
  closeModal();
});

// Tap a hidden amount to toggle it: first tap reveals, next tap blurs again.
// Capture phase so it runs before the card's view handler and swallows the tap.
document.addEventListener(
  "click",
  (e) => {
    if (!document.documentElement.classList.contains("hide-amounts")) return;
    const m = e.target.closest(".money");
    if (m) {
      m.classList.toggle("revealed");
      e.stopPropagation(); // toggling only — never opens the debtor
    }
  },
  true
);

// Delegated clicks for all data-act buttons (list + detail)
document.body.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;

  switch (act) {
    case "paymodal":
      openPaymentModal(id, btn.dataset.name || "");
      break;
    case "remind":
      emailReminder(id);
      break;
    case "text":
      smsReminder(id);
      break;
    case "view":
      showDetail(id);
      break;
    case "delperson":
      deletePerson(id);
      break;
    case "editloan":
      editDebtor(id);
      break;
    case "delloan":
      deleteLoan(id);
      break;
    case "addloan":
      addLoan(btn.dataset.name || "");
      break;
    case "editpay":
      editPayment(id);
      break;
    case "delpay":
      deletePayment(id);
      break;
  }
});

/* -------------------- Offline indicator -------------------- */

function updateOnlineStatus() {
  $("offlineBadge").classList.toggle("hidden", navigator.onLine);
}
window.addEventListener("online", () => {
  updateOnlineStatus();
  flushSyncQueue();
});
window.addEventListener("offline", updateOnlineStatus);

/* -------------------- Service worker -------------------- */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch((err) => console.warn("SW registration failed:", err));
  });
}

/* -------------------- Maker's mark -------------------- */

const APP_VERSION = "3.30";
window.APP_VERSION = APP_VERSION;

// Console signature — a little relic for anyone who opens DevTools.
console.log(
  "%c💰 Debt Tracker %cv" + APP_VERSION,
  "font-size:16px;font-weight:700;color:#0f766e;",
  "font-size:16px;color:#94a3b8;"
);
console.log(
  "%cCrafted by Jongparkour",
  "font-size:12px;color:#94a3b8;font-style:italic;"
);

/* -------------------- Install promo -------------------- */

/** True when the app is running as an installed app (PWA/TWA), not a browser tab. */
function isInstalledApp() {
  const mm = window.matchMedia;
  const standalone =
    mm &&
    (mm("(display-mode: standalone)").matches ||
      mm("(display-mode: fullscreen)").matches);
  return (
    standalone ||
    window.navigator.standalone === true || // iOS "Add to Home Screen"
    (document.referrer || "").startsWith("android-app://") // Android TWA
  );
}

/** Hide the "Download the app" footer promo when they already have the app. */
function updateApkPromo() {
  const promo = $("apkPromo");
  if (promo) promo.classList.toggle("hidden", isInstalledApp());
}

/* -------------------- Boot -------------------- */

applyTheme(getTheme());
updateOnlineStatus();
updateApkPromo();
loadDebtors(true);
flushSyncQueue(); // resend any events queued while offline
if (getSignupUrl()) {
  if (SIGNUP_FORM_PREFILL) ensureLenderCode(); // routed multi-lender mode → this device needs a tag
  pullSignups(true); // auto-import new form sign-ups on open
}
