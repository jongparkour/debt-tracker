/**
 * Debt Tracker — automatic email reminders + payment confirmations (free, Apps Script).
 *
 * Two jobs:
 *   1) Web App (doPost): the Debt Tracker app POSTs here when you add a debtor or
 *      record a payment. Debtors are written to the sheet automatically; a payment
 *      also emails the debtor a confirmation.
 *   2) sendReminders(): time-triggered MORNING and AFTERNOON — emails whoever is due.
 *
 * Sheet columns (row 1 = headers, this exact order):
 *   A Name | B Email | C Amount(remaining) | D Due Date | E Log | F Total | G Paid
 *
 * See SETUP.md for the full walkthrough (deploy as Web App, paste the URL + secret
 * into the app's Settings, then run createTriggers()).
 */

// -------- Settings you can change --------
var SECRET = "changeme";              // MUST match the "Secret" in the app's Settings
var SENDER_NAME = "Debt Tracker";     // the "from" name recipients see
var REMIND_DAYS_BEFORE = [7, 3, 1];   // remind these many days before due
var REMIND_WHEN_OVERDUE = true;       // also remind while overdue
var MORNING_HOUR = 8;                 // morning reminder run (0-23)
var AFTERNOON_HOUR = 14;              // afternoon reminder run (0-23)
var CURRENCY = "₱";
// -----------------------------------------

/* ================= Web App endpoint ================= */

function doGet() {
  return textOut("Debt Tracker reminder endpoint is live.");
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (String(body.token || "") !== SECRET) return textOut("bad token");
    var d = body.data || {};
    if (body.type === "debtor_upsert") {
      upsertDebtor(d);
      return textOut("ok");
    }
    if (body.type === "payment_added") {
      upsertDebtor(d);
      sendPaymentConfirmation(d);
      return textOut("ok");
    }
    return textOut("ignored");
  } catch (err) {
    return textOut("error: " + err.message);
  }
}

/* ================= Sheet writes ================= */

function upsertDebtor(d) {
  var sheet = getSheet();
  var key = d.key || normName_(d.name);
  var row = findRowByKey_(sheet, key);
  if (row === -1) {
    sheet.appendRow([
      d.name || "", d.email || "", num_(d.remaining), d.dueDate || "", "",
      num_(d.total), num_(d.paid),
    ]);
  } else {
    sheet.getRange(row, 1).setValue(d.name || "");
    sheet.getRange(row, 2).setValue(d.email || "");
    sheet.getRange(row, 3).setValue(num_(d.remaining));
    sheet.getRange(row, 4).setValue(d.dueDate || "");
    sheet.getRange(row, 6).setValue(num_(d.total));
    sheet.getRange(row, 7).setValue(num_(d.paid));
  }
}

function sendPaymentConfirmation(d) {
  if (!d.email) return;
  var amt = peso_(d.amount);
  var rem = peso_(d.remaining);
  var settled = Number(d.remaining) <= 0;
  var subject = settled ? "Payment received — fully paid ✓" : "Payment received — " + amt;

  var inner =
    '<p style="margin:0 0 10px;">Hi ' + escapeHtml_(d.name) + ',</p>' +
    '<p style="margin:0 0 4px;">We’ve received your payment of <b>' + amt + '</b>.</p>' +
    balBox_(settled ? "FULLY PAID ✓ — no remaining balance"
                    : "REMAINING BALANCE TO PAY: " + rem, settled) +
    '<p style="margin:10px 0 0;">Thank you!</p>';

  var plain = "Hi " + d.name + ",\n\nWe've received your payment of " + amt + ".\n\n" +
    (settled ? "FULLY PAID — no remaining balance." : "REMAINING BALANCE TO PAY: " + rem) +
    "\n\nThank you!";

  MailApp.sendEmail({
    to: d.email, subject: subject, name: SENDER_NAME,
    htmlBody: htmlEmail_("Payment receipt", inner), body: plain,
  });
}

/* ================= Daily reminders (morning + afternoon) ================= */

function sendReminders() {
  var sheet = getSheet();
  var rows = sheet.getDataRange().getValues();
  var tz = Session.getScriptTimeZone();

  var now = new Date();
  var slot = now.getHours() < 12 ? "AM" : "PM";
  var today = new Date(now);
  today.setHours(0, 0, 0, 0);
  var stamp = Utilities.formatDate(today, tz, "yyyy-MM-dd") + " " + slot;

  var sent = 0;
  for (var r = 1; r < rows.length; r++) {           // r=1 skips the header row
    var name = rows[r][0];
    var email = String(rows[r][1] || "").trim();
    var remaining = Number(rows[r][2] || 0);
    var due = parseDate_(rows[r][3]);
    if (!email || !due || remaining <= 0) continue;   // no email / no date / fully paid

    var daysLeft = Math.round((due - today) / 86400000);
    var when = null;
    if (daysLeft === 0) when = "due today";
    else if (daysLeft > 0 && REMIND_DAYS_BEFORE.indexOf(daysLeft) !== -1) when = "upcoming";
    else if (daysLeft < 0 && REMIND_WHEN_OVERDUE) when = "overdue";
    if (!when) continue;

    var logCell = sheet.getRange(r + 1, 5);
    var prevLog = String(logCell.getValue() || "");
    if (prevLog.indexOf(stamp) !== -1) continue;      // already sent this AM/PM slot

    var amt = peso_(remaining);
    var dueStr = Utilities.formatDate(due, tz, "MMM d, yyyy");
    var subject, lead, plainLead;
    if (when === "overdue") {
      subject = "Payment overdue — " + amt;
      lead = "Friendly reminder that your balance was due on " + dueStr + " and is now <b>overdue</b>. Please settle it when you can.";
      plainLead = "Friendly reminder that your balance of " + amt + " was due on " + dueStr + " and is now overdue.";
    } else if (when === "due today") {
      subject = "Payment due today — " + amt;
      lead = "Reminder: your balance is <b>due today</b> (" + dueStr + ").";
      plainLead = "Reminder: your balance of " + amt + " is due today (" + dueStr + ").";
    } else {
      subject = "Upcoming payment — " + amt;
      lead = "Friendly reminder: your balance is due on <b>" + dueStr + "</b>.";
      plainLead = "Friendly reminder: your balance of " + amt + " is due on " + dueStr + ".";
    }
    var inner = '<p style="margin:0 0 10px;">Hi ' + escapeHtml_(name) + ',</p>' +
      '<p style="margin:0 0 4px;">' + lead + '</p>' +
      balBox_("BALANCE DUE: " + amt, false) +
      '<p style="margin:10px 0 0;">Thank you!</p>';
    var plain = "Hi " + name + ",\n\n" + plainLead + "\n\nBALANCE DUE: " + amt + "\n\nThank you!";

    try {
      MailApp.sendEmail({ to: email, subject: subject, name: SENDER_NAME,
        htmlBody: htmlEmail_("Payment reminder", inner), body: plain });
      logCell.setValue((prevLog ? prevLog + "; " : "") + stamp + " (" + when + ")");
      sent++;
    } catch (e) {
      logCell.setValue("ERROR " + stamp + ": " + e.message);
    }
  }
  Logger.log("Reminders sent (" + slot + "): " + sent);
}

/* ================= One-time setup helpers ================= */

/** Run ONCE to schedule morning + afternoon reminder runs. */
function createTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendReminders") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendReminders").timeBased().everyDays(1).atHour(MORNING_HOUR).create();
  ScriptApp.newTrigger("sendReminders").timeBased().everyDays(1).atHour(AFTERNOON_HOUR).create();
  Logger.log("Triggers created for " + MORNING_HOUR + ":00 and " + AFTERNOON_HOUR + ":00.");
}

/** Optional: write the header row into a fresh sheet. */
function setupSheet() {
  var sheet = getSheet();
  sheet.getRange(1, 1, 1, 7).setValues([[
    "Name", "Email", "Amount", "Due Date", "Log", "Total", "Paid",
  ]]);
  sheet.getRange(1, 1, 1, 7).setFontWeight("bold");
}

/** Optional: email yourself to confirm sending works. */
function sendTestEmail() {
  var me = Session.getActiveUser().getEmail();
  MailApp.sendEmail({ to: me, name: SENDER_NAME,
    subject: "Debt Tracker — test", body: "If you got this, email works. ✓" });
  Logger.log("Test email sent to " + me);
}

/* ================= Small helpers ================= */

function getSheet() { return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]; }

/** Branded HTML email in the app's navy/teal skin. `inner` is the body HTML. */
function htmlEmail_(heading, inner) {
  return '' +
    '<div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:0 auto;' +
      'border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">' +
      '<div style="background:linear-gradient(135deg,#0f766e,#115e59);color:#ffffff;padding:22px 24px;">' +
        '<div style="font-size:22px;font-weight:800;">💰 Debt Tracker</div>' +
        '<div style="font-size:13px;opacity:0.85;margin-top:3px;">' + heading + '</div>' +
      '</div>' +
      '<div style="padding:22px 24px;background:#ffffff;color:#0f172a;font-size:15px;line-height:1.5;">' + inner + '</div>' +
      '<div style="padding:12px 24px;background:#f8fafc;color:#94a3b8;font-size:12px;">Sent with Debt Tracker</div>' +
    '</div>';
}
/** Emphasized balance pill: green when settled, red when a balance remains. */
function balBox_(text, ok) {
  var bg = ok ? '#ecfdf5' : '#fff1f2';
  var fg = ok ? '#047857' : '#be123c';
  return '<div style="margin:14px 0;padding:12px 14px;border-radius:10px;font-weight:700;' +
    'text-align:center;background:' + bg + ';color:' + fg + ';">' + text + '</div>';
}
function escapeHtml_(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function textOut(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT);
}
function normName_(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function findRowByKey_(sheet, key) {
  var vals = sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), 1).getValues();
  for (var r = 1; r < vals.length; r++) {
    if (normName_(vals[r][0]) === key) return r + 1; // 1-based row number
  }
  return -1;
}
function num_(n) { var x = Number(n); return isNaN(x) ? 0 : x; }
function peso_(n) {
  return CURRENCY + num_(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function parseDate_(v) {
  if (v instanceof Date) { var x = new Date(v); x.setHours(0, 0, 0, 0); return x; }
  var s = String(v || "").trim();
  if (!s) return null;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  var d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}
