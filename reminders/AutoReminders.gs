/**
 * Debt Tracker — plan-based automatic reminders + payment receipts (Gmail).
 *
 * The app syncs each debtor's PLAN (expected monthly payment, weekly/monthly cadence, and the
 * DUE DAY) plus the live remaining balance to this Web App. From that, Google's servers send:
 *
 *   • On the DUE DAY  → two reminders that day (8 AM and 2 PM).
 *       - Weekly plan : the due day is a weekday (e.g. every Friday). The amount is the expected
 *                       monthly split across that weekday's occurrences in the month (mid-month
 *                       start → split across the ones remaining).
 *       - Monthly plan: the due day is a day-of-month (e.g. the 15th) for the full monthly amount.
 *   • The NEXT DAY    → if no payment was recorded on the due day, one OVERDUE follow-up (8 AM + 2 PM).
 *   • On any payment  → an instant receipt (and a "fully paid ✓" email once the balance hits ₱0).
 *
 * Amounts are capped at the remaining balance; reminders stop automatically when it's cleared.
 * There is NO due-date column — the plan cadence + due day ARE the schedule.
 *
 * SETUP
 *   1. Paste this whole file into the sheet's Extensions → Apps Script, Save.
 *   2. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → copy the
 *      /exec URL into the app's PAYMENT_SYNC_URL (keep SECRET matching PAYMENT_SYNC_SECRET).
 *      (Re-deploying later: Manage deployments → edit ✏ → Version: New version → same URL.)
 *   3. Project Settings ⚙ → Time zone → your zone (e.g. Manila). Run createTriggers() once.
 *   A "Reminders" tab is created automatically to track each debtor's plan + balance.
 */

// ===================== CONFIG =====================
var SENDER_NAME = "Debt Tracker";
var CURRENCY = "₱";
var SECRET = "dt-pay-9oytk60";   // MUST match PAYMENT_SYNC_SECRET in the app (app.js)
var RUN_HOURS = [8, 14];         // send reminders at 8 AM and 2 PM (twice on the due day)
var SHEET_NAME = "Reminders";    // tracking tab (auto-created)
var OWNER_NOTIFY = "";           // your email to BCC on EVERY reminder/receipt (blank = off)
// =================================================

/* Web App endpoint. GET ?action=backup&token=… returns the latest full backup (for Restore). */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === "backup") {
    if (String(e.parameter.token || "") !== SECRET) return out_("bad token");
    return ContentService
      .createTextOutput(readBackup_())
      .setMimeType(ContentService.MimeType.JSON);
  }
  return out_("Debt Tracker reminder endpoint is live.");
}
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (String(body.token || "") !== SECRET) return out_("bad token");
    var d = body.data || {};
    if (body.type === "payment_added") {
      applyPayment_(d);        // update remaining + stamp LastPaid
      sendPaymentConfirm_(d);  // instant receipt (+ fully-paid email when settled)
      return out_("ok");
    }
    if (body.type === "debtor_upsert") {
      upsertDebtor_(d);        // enrol / update the plan
      return out_("ok");
    }
    if (body.type === "backup") {
      saveBackup_(d);          // full snapshot of all debtors + payments
      return out_("ok");
    }
    return out_("ignored");
  } catch (err) {
    return out_("error: " + err.message);
  }
}
function out_(s) { return ContentService.createTextOutput(s); }

/* ---- Full backup (debtors + payments) stored in a "Backup" tab, cell A1 ---- */
function backupSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Backup");
  if (!sh) {
    sh = ss.insertSheet("Backup");
    sh.getRange("A1").setValue("{}");
    sh.getRange("C1").setValue("← latest app backup (JSON). Do not edit.");
  }
  return sh;
}
function saveBackup_(data) {
  var sh = backupSheet_();
  sh.getRange("A1").setValue(JSON.stringify(data)); // cell holds up to 50,000 chars
  sh.getRange("B1").setValue(new Date());
}
function readBackup_() {
  var v = backupSheet_().getRange("A1").getValue();
  return v ? String(v) : "{}";
}

/* ------------------------------------------------------------------ *
 *  Reminders tracking sheet
 *  1 Email | 2 Name | 3 Freq | 4 Monthly | 5 DueDay | 6 Remaining |
 *  7 Enrolled | 8 Active | 9 LastPaid | 10 LastSent
 * ------------------------------------------------------------------ */
function remindersSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(["Email", "Name", "Freq", "Monthly", "DueDay", "Remaining", "Enrolled", "Active", "LastPaid", "LastSent", "CC"]);
  }
  return sh;
}
function findRowByEmail_(sh, email) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var vals = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || "").trim().toLowerCase() === email) return i + 2;
  }
  return 0;
}
function upsertDebtor_(d) {
  var email = normEmail_(d.email);
  if (!email) return;
  var sh = remindersSheet_();
  var row = findRowByEmail_(sh, email);
  var remaining = num_(d.remaining);
  var freq = d.planFreq === "weekly" ? "weekly" : "monthly";
  var active = remaining > 0 ? "yes" : "no";
  if (row) {
    sh.getRange(row, 2).setValue(d.name || "");
    sh.getRange(row, 3).setValue(freq);
    sh.getRange(row, 4).setValue(num_(d.monthly));
    sh.getRange(row, 5).setValue(num_(d.planDay));
    sh.getRange(row, 6).setValue(remaining);
    sh.getRange(row, 8).setValue(active);
    sh.getRange(row, 11).setValue(normEmail_(d.cc));
  } else {
    sh.appendRow([email, d.name || "", freq, num_(d.monthly), num_(d.planDay), remaining, todayStr_(), active, "", "", normEmail_(d.cc)]);
  }
}
function applyPayment_(d) {
  var email = normEmail_(d.email);
  if (!email) return;
  var sh = remindersSheet_();
  var row = findRowByEmail_(sh, email);
  var remaining = num_(d.remaining);
  var active = remaining > 0 ? "yes" : "no";
  if (row) {
    sh.getRange(row, 6).setValue(remaining);
    sh.getRange(row, 8).setValue(active);
    sh.getRange(row, 9).setValue(todayStr_()); // LastPaid
    if (d.cc) sh.getRange(row, 11).setValue(normEmail_(d.cc));
  } else {
    var freq = d.planFreq === "weekly" ? "weekly" : "monthly";
    sh.appendRow([email, d.name || "", freq, num_(d.monthly), num_(d.planDay), remaining, todayStr_(), active, todayStr_(), "", normEmail_(d.cc)]);
  }
}

/* ------------------------------------------------------------------ *
 *  Reminder job — runs at 8 AM and 2 PM. Due-day reminders + next-day overdue.
 * ------------------------------------------------------------------ */
function sendReminders() {
  var sh = remindersSheet_();
  var last = sh.getLastRow();
  if (last < 2) return;
  var data = sh.getRange(2, 1, last - 1, 11).getValues();
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var slot = now.getHours() < 12 ? "AM" : "PM";
  var stamp = Utilities.formatDate(now, tz, "yyyy-MM-dd") + " " + slot;
  var sent = 0;

  for (var i = 0; i < data.length; i++) {
    var row = i + 2;
    var email = String(data[i][0] || "").trim();
    if (!email) continue;
    var name = data[i][1] || "";
    var freq = String(data[i][2] || "monthly").toLowerCase();
    var monthly = num_(data[i][3]);
    var dueDay = num_(data[i][4]);
    var remaining = num_(data[i][5]);
    var enrolled = parseDate_(data[i][6]) || now;
    var active = String(data[i][7] || "").toLowerCase();
    var lastPaid = ymd_(data[i][8]);
    var lastSent = String(data[i][9] || "");
    var cc = normEmail_(data[i][10]);
    if (active !== "yes" || remaining <= 0 || monthly <= 0) continue;
    if (lastSent === stamp) continue; // already sent this slot

    var decision = dueToday_(freq, dueDay, monthly, enrolled, now, lastPaid, tz);
    if (!decision) continue;

    var amt = Math.min(decision.amount, remaining);
    if (amt <= 0) continue;
    sendReminderEmail_(email, name, decision.kind, amt, remaining, cc);
    sh.getRange(row, 10).setValue(stamp);
    sent++;
  }
  Logger.log("Reminders sent (" + slot + "): " + sent);
}

/** Decide whether today is this debtor's due day (send) or the day after an unpaid due day
 *  (overdue). Returns {kind, amount} or null. */
function dueToday_(freq, dueDay, monthly, enrolled, now, lastPaid, tz) {
  if (freq === "weekly") {
    var dow = now.getDay();
    var due = ((dueDay % 7) + 7) % 7;
    if (dow === due) {
      return { kind: "due", amount: weeklyAmount_(monthly, enrolled, now, due) };
    }
    if (dow === (due + 1) % 7) {
      var dueDate = new Date(now); dueDate.setDate(dueDate.getDate() - 1);
      var dueStr = Utilities.formatDate(dueDate, tz, "yyyy-MM-dd");
      if (lastPaid && lastPaid >= dueStr) return null; // paid on/after the due day
      return { kind: "overdue", amount: weeklyAmount_(monthly, enrolled, dueDate, due) };
    }
    return null;
  }
  // monthly
  var y = now.getFullYear(), mo = now.getMonth();
  var dim = new Date(y, mo + 1, 0).getDate();
  var dom = Math.max(1, Math.min(num_(dueDay) || 1, dim));
  var today = now.getDate();
  if (today === dom) return { kind: "due", amount: monthly };
  if (today === dom + 1) {
    var dStr = Utilities.formatDate(new Date(y, mo, dom), tz, "yyyy-MM-dd");
    if (lastPaid && lastPaid >= dStr) return null;
    return { kind: "overdue", amount: monthly };
  }
  return null;
}

/** Weekly amount = monthly split across this month's occurrences of the due weekday; if enrolled
 *  mid-month, split only across the occurrences on/after enrolment. */
function weeklyAmount_(monthly, enrolled, now, dueDow) {
  var y = now.getFullYear(), mo = now.getMonth();
  var last = new Date(y, mo + 1, 0).getDate();
  var days = [];
  for (var day = 1; day <= last; day++) {
    var dt = new Date(y, mo, day);
    if (dt.getDay() === dueDow) days.push(dt);
  }
  var enrolledThisMonth = enrolled.getFullYear() === y && enrolled.getMonth() === mo;
  var applicable = days;
  if (enrolledThisMonth) {
    var anchor = stripTime_(enrolled).getTime();
    applicable = days.filter(function (w) { return w.getTime() >= anchor; });
    if (!applicable.length) applicable = days.slice(-1);
  }
  var n = applicable.length || 4;
  return Math.round(monthly / n);
}

function sendReminderEmail_(email, name, kind, amt, remaining, cc) {
  var overdue = kind === "overdue";
  // Gentle, personal subject/body improve inbox placement (esp. Apple/iCloud). Avoid ALL-CAPS,
  // "OVERDUE", and money-in-subject urgency that spam filters key on.
  var subject = "A quick payment reminder from " + SENDER_NAME;
  var lead = overdue
    ? "Just following up — your scheduled payment of <b>" + peso_(amt) + "</b> was due yesterday."
    : "A friendly reminder that your scheduled payment of <b>" + peso_(amt) + "</b> is due today.";
  var inner =
    '<p style="margin:0 0 10px;">Hi ' + escapeHtml_(name) + ',</p>' +
    '<p style="margin:0 0 4px;">' + lead + '</p>' +
    balBox_("Amount due: " + peso_(amt), false) +
    '<p style="margin:10px 0 0;color:#475569;font-size:13px;">Remaining balance: <b>' +
    peso_(remaining) + '</b></p>' +
    '<p style="margin:12px 0 0;">Thanks so much,<br>' + escapeHtml_(SENDER_NAME) + '</p>' +
    '<p style="margin:14px 0 0;color:#94a3b8;font-size:12px;">You’re getting this because you have a ' +
    'payment arrangement with ' + escapeHtml_(SENDER_NAME) + '. Just reply to this email with any questions.</p>';
  var plain = "Hi " + name + ",\n\n" +
    (overdue
      ? "Just following up — your scheduled payment of " + peso_(amt) + " was due yesterday."
      : "A friendly reminder that your scheduled payment of " + peso_(amt) + " is due today.") +
    "\nRemaining balance: " + peso_(remaining) +
    "\n\nThanks so much,\n" + SENDER_NAME +
    "\n\nYou're getting this because you have a payment arrangement with " + SENDER_NAME +
    ". Just reply with any questions.";
  var opts = {
    to: email, subject: subject, name: SENDER_NAME,
    htmlBody: htmlEmail_("Payment reminder", inner), body: plain,
  };
  var rt = senderEmail_();
  if (rt) opts.replyTo = rt;
  applyCopies_(opts, cc);
  MailApp.sendEmail(opts);
}

/* Payment receipt (instant) — also the "fully paid" email when settled. */
function sendPaymentConfirm_(d) {
  var email = normEmail_(d.email);
  if (!email) return;
  var name = String(d.name || "there").trim();
  var amt = peso_(d.amount);
  var remaining = num_(d.remaining);
  var settled = remaining <= 0;
  var subject = settled ? "Payment received — fully paid ✓" : "Payment received — " + amt;
  var lead = "We've recorded your payment of " + amt + ".";
  var box = settled
    ? balBox_("FULLY PAID ✓ — thank you!", true)
    : balBox_("REMAINING BALANCE: " + peso_(remaining), false);
  var inner =
    '<p style="margin:0 0 10px;">Hi ' + escapeHtml_(name) + ',</p>' +
    '<p style="margin:0 0 4px;">' + escapeHtml_(lead) + '</p>' + box +
    '<p style="margin:10px 0 0;">Thank you!</p>';
  var plain = "Hi " + name + ",\n\n" + lead + "\n\n" +
    (settled ? "Fully paid — thank you!" : "Remaining balance: " + peso_(remaining)) +
    "\n\nThank you!";
  var opts = {
    to: email, subject: subject, name: SENDER_NAME,
    htmlBody: htmlEmail_("Payment receipt", inner), body: plain,
  };
  var rt = senderEmail_();
  if (rt) opts.replyTo = rt;
  applyCopies_(opts, d.cc);
  MailApp.sendEmail(opts);
}

/** Add the lender's CC copy + the owner's BCC notification to an email's options. */
function applyCopies_(opts, cc) {
  cc = normEmail_(cc);
  if (cc && cc !== normEmail_(opts.to)) opts.cc = cc;
  var owner = normEmail_(OWNER_NOTIFY);
  if (owner) opts.bcc = owner;
}

/* Triggers + test. */
function createTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendReminders") ScriptApp.deleteTrigger(t);
  });
  RUN_HOURS.forEach(function (h) {
    ScriptApp.newTrigger("sendReminders").timeBased().everyDays(1).atHour(h).create();
  });
  Logger.log("Reminder triggers set for hours: " + RUN_HOURS.join(", "));
}
function sendTest() {
  var me = Session.getActiveUser().getEmail();
  sendReminderEmail_(me, "Test", "due", 600, 20000);
  Logger.log("Test reminder sent to " + me);
}

/* ---------------- helpers ---------------- */
function senderEmail_() { try { return Session.getActiveUser().getEmail() || ""; } catch (e) { return ""; } }
function normEmail_(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
function num_(n) { var x = Number(String(n == null ? "" : n).replace(/[^0-9.\-]/g, "")); return isNaN(x) ? 0 : x; }
function peso_(n) { return CURRENCY + num_(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function stripTime_(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function todayStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"); }
function ymd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  return String(v || "").trim().slice(0, 10);
}
function parseDate_(v) {
  if (v instanceof Date) return stripTime_(v);
  var s = String(v || "").trim(); if (!s) return null;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  var d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  if (isNaN(d.getTime())) return null;
  return stripTime_(d);
}
function escapeHtml_(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function htmlEmail_(heading, inner) {
  return '<div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">' +
    '<div style="background:linear-gradient(135deg,#0f766e,#115e59);color:#fff;padding:22px 24px;">' +
    '<div style="font-size:22px;font-weight:800;">💰 Debt Tracker</div>' +
    '<div style="font-size:13px;opacity:.85;margin-top:3px;">' + heading + '</div></div>' +
    '<div style="padding:22px 24px;background:#fff;color:#0f172a;font-size:15px;line-height:1.5;">' + inner + '</div>' +
    '<div style="padding:12px 24px;background:#f8fafc;color:#94a3b8;font-size:12px;">Sent with Debt Tracker</div></div>';
}
function balBox_(text, ok) {
  var bg = ok ? "#ecfdf5" : "#fff1f2", fg = ok ? "#047857" : "#be123c";
  return '<div style="margin:14px 0;padding:12px 14px;border-radius:10px;font-weight:700;text-align:center;background:' + bg + ';color:' + fg + ';">' + text + '</div>';
}
