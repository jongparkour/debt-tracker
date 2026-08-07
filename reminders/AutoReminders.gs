/**
 * Debt Tracker — automatic reminders from your Google Form sheet (Gmail + SMS).
 *
 * Reads the form-response sheet (Debtor Name, Total Debt, Email, Phone number, Due Date, …)
 * and emails + texts each debtor before / on / after their due date, on a daily schedule.
 *
 *  • Email  → free, via your Gmail (MailApp), ~100/day.
 *  • SMS    → via a phone gateway (textbee.dev by default) that sends from YOUR SIM.
 *             Leave the textbee config blank to send email only.
 *
 * NOTE: this reminds using the sheet's "Total Debt" (the sign-up amount) — it does not know
 * payments made inside the app. See SETUP.md.
 *
 * Setup: paste into Extensions → Apps Script, fill config, run createTriggers() once.
 *
 * BONUS — instant payment receipts: this file also exposes a Web App (doPost). Deploy it
 * (Deploy → New deployment → Web app → Execute as Me, Anyone) and paste the /exec URL into
 * the app's PAYMENT_SYNC_URL. Then every payment recorded in the app emails the debtor a
 * "Payment received — remaining balance ₱X" receipt automatically. See bottom of file.
 */

// ===================== CONFIG =====================
var SENDER_NAME = "Debt Tracker";
var CURRENCY = "₱"; // ₱
var REMIND_DAYS_BEFORE = [7, 3, 1];  // remind this many days before due
var REMIND_WHEN_OVERDUE = true;      // keep reminding while overdue
var RUN_HOURS = [8, 14];             // daily run times (morning + afternoon)

// SMS gateway — your phone sends via its SIM. Fill ONE of the two (blank both = email only).
//  A) textbee.dev  — install the "textbee" app (Play Store), register the device → API key + Device ID.
var TEXTBEE_API_KEY = "";
var TEXTBEE_DEVICE_ID = "";
//  B) SMSGate (sms-gate.app) — install, switch to "Cloud Server" → username + password.
var SMSGATE_USER = "";
var SMSGATE_PASS = "";

// Payment-confirmation Web App: MUST match PAYMENT_SYNC_SECRET in the app (app.js).
var SECRET = "dt-pay-9oytk60";
// =================================================

/** Daily job (set two triggers via createTriggers). Emails + texts whoever is due. */
function sendReminders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return;

  var header = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var col = {};
  header.forEach(function (h, i) { if (!(h in col)) col[h] = i; });

  var iName = pick_(col, ["debtor name", "name"]);
  var iDebt = pick_(col, ["total debt", "amount", "total"]);
  var iEmail = pick_(col, ["email"]);
  var iPhone = pick_(col, ["phone number", "phone"]);
  var iDue = pick_(col, ["due date"]);
  if (iName == null || iDebt == null) { Logger.log("Need 'Debtor Name' + 'Total Debt' columns."); return; }
  if (iDue == null) { Logger.log("No 'Due Date' column — add it to the form so reminders can be scheduled."); return; }

  // Ensure a log column (dedupe) at the far right.
  var iLog = col["reminder log"];
  if (iLog == null) { iLog = header.length; sheet.getRange(1, iLog + 1).setValue("Reminder Log"); }

  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var slot = now.getHours() < 12 ? "AM" : "PM";
  var today = new Date(now); today.setHours(0, 0, 0, 0);
  var stamp = Utilities.formatDate(today, tz, "yyyy-MM-dd") + " " + slot;

  var sentCount = 0;
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var name = String(row[iName] || "").trim();
    var amount = num_(row[iDebt]);
    if (!name || amount <= 0) continue;
    var email = iEmail != null ? String(row[iEmail] || "").trim() : "";
    var phone = iPhone != null ? String(row[iPhone] || "").trim() : "";
    if (!email && !phone) continue;

    var due = parseDate_(row[iDue]);
    if (!due) continue;
    var daysLeft = Math.round((due - today) / 86400000);
    var when = null;
    if (daysLeft === 0) when = "due today";
    else if (daysLeft > 0 && REMIND_DAYS_BEFORE.indexOf(daysLeft) !== -1) when = "upcoming";
    else if (daysLeft < 0 && REMIND_WHEN_OVERDUE) when = "overdue";
    if (!when) continue;

    var logCell = sheet.getRange(r + 1, iLog + 1);
    var prev = String(logCell.getValue() || "");
    if (prev.indexOf(stamp) !== -1) continue; // already sent this AM/PM slot

    var amt = peso_(amount);
    var dueStr = Utilities.formatDate(due, tz, "MMM d, yyyy");
    var subject, lead;
    if (when === "overdue") {
      subject = "Payment overdue — " + amt;
      lead = "Your balance of " + amt + " was due on " + dueStr + " and is now overdue. Please settle it when you can.";
    } else if (when === "due today") {
      subject = "Payment due today — " + amt;
      lead = "Reminder: your balance of " + amt + " is due today (" + dueStr + ").";
    } else {
      subject = "Upcoming payment — " + amt;
      lead = "Friendly reminder: your balance of " + amt + " is due on " + dueStr + ".";
    }

    var done = [];
    if (email) {
      try {
        var inner = '<p style="margin:0 0 10px;">Hi ' + escapeHtml_(name) + ',</p>' +
          '<p style="margin:0 0 4px;">' + escapeHtml_(lead) + '</p>' +
          balBox_("BALANCE DUE: " + amt, false) +
          '<p style="margin:10px 0 0;">Thank you!</p>';
        MailApp.sendEmail({
          to: email, subject: subject, name: SENDER_NAME,
          htmlBody: htmlEmail_("Payment reminder", inner),
          body: "Hi " + name + ",\n\n" + lead + "\n\nBALANCE DUE: " + amt + "\n\nThank you!",
        });
        done.push("email");
      } catch (e) { done.push("email-ERR"); }
    }
    if (phone && smsConfigured_()) {
      try {
        sendSms_(phone, "Hi " + name + ", " + lead + " Thank you! - " + SENDER_NAME);
        done.push("sms");
      } catch (e) { done.push("sms-ERR:" + e.message); }
    }
    if (done.length) {
      logCell.setValue((prev ? prev + "; " : "") + stamp + " (" + when + ": " + done.join(",") + ")");
      sentCount++;
    }
  }
  Logger.log("Reminders processed (" + slot + "): " + sentCount);
}

function smsConfigured_() {
  return (TEXTBEE_API_KEY && TEXTBEE_DEVICE_ID) || (SMSGATE_USER && SMSGATE_PASS);
}
/** Send one SMS through whichever gateway is configured (your phone → your SIM). */
function sendSms_(phone, text) {
  var res, code;
  if (TEXTBEE_API_KEY && TEXTBEE_DEVICE_ID) {
    res = UrlFetchApp.fetch("https://api.textbee.dev/api/v1/gateway/devices/" + TEXTBEE_DEVICE_ID + "/send-sms", {
      method: "post", contentType: "application/json",
      headers: { "x-api-key": TEXTBEE_API_KEY },
      payload: JSON.stringify({ recipients: [phone], message: text }), muteHttpExceptions: true,
    });
  } else if (SMSGATE_USER && SMSGATE_PASS) {
    res = UrlFetchApp.fetch("https://api.sms-gate.app/3rdparty/v1/message", {
      method: "post", contentType: "application/json",
      headers: { Authorization: "Basic " + Utilities.base64Encode(SMSGATE_USER + ":" + SMSGATE_PASS) },
      payload: JSON.stringify({ message: text, phoneNumbers: [phone] }), muteHttpExceptions: true,
    });
  } else {
    throw new Error("No SMS gateway configured");
  }
  code = res.getResponseCode();
  if (code >= 300) throw new Error("HTTP " + code + " " + res.getContentText().slice(0, 120));
}

/** Run ONCE to schedule the morning + afternoon runs. */
function createTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendReminders") ScriptApp.deleteTrigger(t);
  });
  RUN_HOURS.forEach(function (h) {
    ScriptApp.newTrigger("sendReminders").timeBased().everyDays(1).atHour(h).create();
  });
  Logger.log("Triggers set for hours: " + RUN_HOURS.join(", "));
}

/** Optional: test email + SMS to yourself (set TEST_PHONE to try SMS). */
var TEST_PHONE = "";
function sendTest() {
  var me = Session.getActiveUser().getEmail();
  MailApp.sendEmail({ to: me, name: SENDER_NAME, subject: "Debt Tracker — test",
    htmlBody: htmlEmail_("Test", '<p>If you got this, email works. ✓</p>'), body: "Email works." });
  if (smsConfigured_() && TEST_PHONE) sendSms_(TEST_PHONE, "Debt Tracker test SMS ✓");
  Logger.log("Test sent.");
}

/* ============ Payment confirmations (Web App) ============
 * Deploy: Apps Script → Deploy → New deployment → type "Web app" →
 *   Execute as: Me   |   Who has access: Anyone → Deploy → copy the /exec URL.
 * Paste that URL into the app's PAYMENT_SYNC_URL. The app POSTs each recorded
 * payment here and this emails the debtor an instant receipt. */
function doGet() {
  return ContentService.createTextOutput("Debt Tracker payment endpoint is live.");
}
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (String(body.token || "") !== SECRET) return ContentService.createTextOutput("bad token");
    if (body.type !== "payment_added") return ContentService.createTextOutput("ignored");
    sendPaymentConfirm_(body.data || {});
    return ContentService.createTextOutput("ok");
  } catch (err) {
    return ContentService.createTextOutput("error: " + err.message);
  }
}
function sendPaymentConfirm_(d) {
  var email = String(d.email || "").trim();
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
  var inner = '<p style="margin:0 0 10px;">Hi ' + escapeHtml_(name) + ',</p>' +
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

/* ---------------- helpers ---------------- */
function pick_(col, names) { for (var i = 0; i < names.length; i++) if (col[names[i]] != null) return col[names[i]]; return null; }
function num_(n) { var x = Number(String(n == null ? "" : n).replace(/[^0-9.\-]/g, "")); return isNaN(x) ? 0 : x; }
function peso_(n) { return CURRENCY + num_(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function parseDate_(v) {
  if (v instanceof Date) { var x = new Date(v); x.setHours(0, 0, 0, 0); return x; }
  var s = String(v || "").trim(); if (!s) return null;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  var d;
  if (!m) d = new Date(s);
  else if (m[1].length === 4) d = new Date(+m[1], +m[2] - 1, +m[3]);
  else { var y = m[3].length === 2 ? "20" + m[3] : m[3]; d = new Date(+y, +m[1] - 1, +m[2]); }
  if (isNaN(d.getTime())) return null; d.setHours(0, 0, 0, 0); return d;
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
