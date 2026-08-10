/**
 * Debt Tracker — plan-based automatic reminders + payment receipts (Gmail).
 *
 * The app syncs each debtor's PLAN (expected monthly payment + weekly/monthly cadence) and
 * live remaining balance to this Web App. From that, Google's servers send:
 *
 *   • WEEKLY plan   → an email every WEEKEND (Saturday). The weekend amount is the expected
 *                     monthly split across that month's weekends — and if the debtor started
 *                     mid-month, it's split across the weekends REMAINING in that month.
 *   • MONTHLY plan  → an email on the 1st of each month for the expected monthly amount.
 *   • Payment made  → an instant receipt (and a "fully paid" email once the balance hits ₱0).
 *
 * Reminders stop automatically when the balance is cleared. There is no due date — the plan
 * cadence IS the schedule.
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
var WEEKEND_DAY = 6;             // 0=Sun … 6=Sat — the day weekly reminders go out
var RUN_HOUR = 9;               // hour of day the daily job runs
var SHEET_NAME = "Reminders";    // tracking tab (auto-created)
// =================================================

/* ------------------------------------------------------------------ *
 *  Web App endpoint — the app POSTs debtor_upsert + payment_added here
 * ------------------------------------------------------------------ */
function doGet() {
  return ContentService.createTextOutput("Debt Tracker reminder endpoint is live.");
}
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (String(body.token || "") !== SECRET) return out_("bad token");
    var d = body.data || {};
    if (body.type === "payment_added") {
      applyBalance_(d);        // update tracked remaining / active
      sendPaymentConfirm_(d);  // instant receipt (+ fully-paid email when settled)
      return out_("ok");
    }
    if (body.type === "debtor_upsert") {
      upsertDebtor_(d);        // enrol / update the plan
      return out_("ok");
    }
    return out_("ignored");
  } catch (err) {
    return out_("error: " + err.message);
  }
}
function out_(s) { return ContentService.createTextOutput(s); }

/* ------------------------------------------------------------------ *
 *  Reminders tracking sheet
 *  Columns: Email | Name | Freq | Monthly | Remaining | Enrolled | Active | LastWeekly | LastMonthly
 * ------------------------------------------------------------------ */
function remindersSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(["Email", "Name", "Freq", "Monthly", "Remaining", "Enrolled", "Active", "LastWeekly", "LastMonthly"]);
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
/** Create or update a debtor's plan row. */
function upsertDebtor_(d) {
  var email = normEmail_(d.email);
  if (!email) return; // no email → can't remind
  var sh = remindersSheet_();
  var row = findRowByEmail_(sh, email);
  var remaining = num_(d.remaining);
  var freq = d.planFreq === "weekly" ? "weekly" : "monthly";
  var active = remaining > 0 ? "yes" : "no";
  if (row) {
    sh.getRange(row, 2).setValue(d.name || "");
    sh.getRange(row, 3).setValue(freq);
    sh.getRange(row, 4).setValue(num_(d.monthly));
    sh.getRange(row, 5).setValue(remaining);
    sh.getRange(row, 7).setValue(active);
  } else {
    sh.appendRow([email, d.name || "", freq, num_(d.monthly), remaining, todayStr_(), active, "", ""]);
  }
}
/** Update just the tracked remaining balance + active flag after a payment. */
function applyBalance_(d) {
  var email = normEmail_(d.email);
  if (!email) return;
  var sh = remindersSheet_();
  var row = findRowByEmail_(sh, email);
  var remaining = num_(d.remaining);
  var active = remaining > 0 ? "yes" : "no";
  if (row) {
    sh.getRange(row, 5).setValue(remaining);
    sh.getRange(row, 7).setValue(active);
  } else {
    var freq = d.planFreq === "weekly" ? "weekly" : "monthly";
    sh.appendRow([email, d.name || "", freq, num_(d.monthly), remaining, todayStr_(), active, "", ""]);
  }
}

/* ------------------------------------------------------------------ *
 *  Daily job — send whatever plan reminders are due today
 * ------------------------------------------------------------------ */
function sendPlanReminders() {
  var sh = remindersSheet_();
  var last = sh.getLastRow();
  if (last < 2) return;
  var data = sh.getRange(2, 1, last - 1, 9).getValues();
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var dow = now.getDay();
  var dom = now.getDate();
  var isoWk = isoWeek_(now);
  var ym = Utilities.formatDate(now, tz, "yyyy-MM");
  var sent = 0;

  for (var i = 0; i < data.length; i++) {
    var row = i + 2;
    var email = String(data[i][0] || "").trim();
    if (!email) continue;
    var name = data[i][1] || "";
    var freq = String(data[i][2] || "monthly").toLowerCase();
    var monthly = num_(data[i][3]);
    var remaining = num_(data[i][4]);
    var enrolled = parseDate_(data[i][5]) || now;
    var active = String(data[i][6] || "").toLowerCase();
    var lastWk = String(data[i][7] || "");
    var lastMo = String(data[i][8] || "");
    if (active !== "yes" || remaining <= 0 || monthly <= 0) continue;

    if (freq === "weekly") {
      if (dow !== WEEKEND_DAY) continue;      // weekends only
      if (lastWk === isoWk) continue;          // already sent this week
      var amt = Math.min(weeklyAmount_(monthly, enrolled, now), remaining);
      if (amt <= 0) continue;
      sendReminderEmail_(email, name, "weekend", amt, remaining);
      sh.getRange(row, 8).setValue(isoWk);
      sent++;
    } else {
      if (dom !== 1) continue;                 // 1st of the month only
      if (lastMo === ym) continue;             // already sent this month
      var amtM = Math.min(monthly, remaining);
      if (amtM <= 0) continue;
      sendReminderEmail_(email, name, "month", amtM, remaining);
      sh.getRange(row, 9).setValue(ym);
      sent++;
    }
  }
  Logger.log("Plan reminders sent: " + sent);
}

/** Expected amount for THIS weekend = monthly split across the month's remaining weekends.
 *  If enrolled mid-month, only the weekends on/after enrolment count (so those weekends still
 *  collect the full monthly). Later months use all of that month's weekends. */
function weeklyAmount_(monthly, enrolled, now) {
  var y = now.getFullYear(), mo = now.getMonth();
  var last = new Date(y, mo + 1, 0).getDate();
  var weekends = [];
  for (var day = 1; day <= last; day++) {
    var dt = new Date(y, mo, day);
    if (dt.getDay() === WEEKEND_DAY) weekends.push(dt);
  }
  var enrolledThisMonth = enrolled.getFullYear() === y && enrolled.getMonth() === mo;
  var applicable = weekends;
  if (enrolledThisMonth) {
    var anchor = stripTime_(enrolled).getTime();
    applicable = weekends.filter(function (w) { return w.getTime() >= anchor; });
    if (!applicable.length) applicable = weekends.slice(-1);
  }
  var n = applicable.length || 4;
  return Math.round(monthly / n);
}

function sendReminderEmail_(email, name, period, amt, remaining) {
  var when = period === "weekend" ? "this weekend" : "this month";
  var label = period === "weekend" ? "PAY THIS WEEKEND" : "PAY THIS MONTH";
  var subject = "Payment due " + when + " — " + peso_(amt);
  var inner =
    '<p style="margin:0 0 10px;">Hi ' + escapeHtml_(name) + ',</p>' +
    '<p style="margin:0 0 4px;">Friendly reminder: your payment of <b>' + peso_(amt) +
    '</b> is due ' + when + '.</p>' +
    balBox_(label + ": " + peso_(amt), false) +
    '<p style="margin:10px 0 0;color:#475569;font-size:13px;">Remaining balance: <b>' +
    peso_(remaining) + '</b></p>' +
    '<p style="margin:10px 0 0;">Thank you!</p>';
  var plain = "Hi " + name + ",\n\nYour payment of " + peso_(amt) + " is due " + when +
    ".\nRemaining balance: " + peso_(remaining) + "\n\nThank you!";
  MailApp.sendEmail({
    to: email, subject: subject, name: SENDER_NAME,
    htmlBody: htmlEmail_("Payment reminder", inner), body: plain,
  });
}

/* ------------------------------------------------------------------ *
 *  Payment receipt (instant) — also the "fully paid" email when settled
 * ------------------------------------------------------------------ */
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
  MailApp.sendEmail({
    to: email, subject: subject, name: SENDER_NAME,
    htmlBody: htmlEmail_("Payment receipt", inner), body: plain,
  });
}

/* ------------------------------------------------------------------ *
 *  Triggers + test
 * ------------------------------------------------------------------ */
function createTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendPlanReminders") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendPlanReminders").timeBased().everyDays(1).atHour(RUN_HOUR).create();
  Logger.log("Daily plan-reminder trigger set for " + RUN_HOUR + ":00.");
}

/** Email yourself a sample reminder to confirm sending works. */
function sendTest() {
  var me = Session.getActiveUser().getEmail();
  sendReminderEmail_(me, "Test", "weekend", 600, 20000);
  Logger.log("Test reminder sent to " + me);
}

/* ---------------- helpers ---------------- */
function normEmail_(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
function num_(n) { var x = Number(String(n == null ? "" : n).replace(/[^0-9.\-]/g, "")); return isNaN(x) ? 0 : x; }
function peso_(n) { return CURRENCY + num_(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function stripTime_(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function todayStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"); }
function parseDate_(v) {
  if (v instanceof Date) return stripTime_(v);
  var s = String(v || "").trim(); if (!s) return null;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  var d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  if (isNaN(d.getTime())) return null;
  return stripTime_(d);
}
function isoWeek_(d) {
  var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  var firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  var week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return date.getUTCFullYear() + "-W" + (week < 10 ? "0" + week : week);
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
