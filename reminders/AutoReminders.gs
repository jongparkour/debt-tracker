/**
 * Debt Tracker — automatic payment reminders by email (free, via Google Apps Script).
 *
 * Reads a Google Sheet of debtors and emails a friendly reminder before + on +
 * after each due date. Runs daily on Google's servers (no phone/app needed).
 *
 * Sheet columns (row 1 = headers, exactly this order):
 *   A: Name      B: Email      C: Amount      D: Due Date      E: Log (script writes here)
 *
 * Setup: paste this into Extensions -> Apps Script, then run createDailyTrigger()
 * once. See SETUP.md for the full walkthrough.
 */

// -------- Settings you can change --------
var SENDER_NAME = "Debt Tracker";   // the "from" name recipients see
var REMIND_DAYS_BEFORE = [7, 3, 1];  // send a reminder these many days before due
var REMIND_WHEN_OVERDUE = true;      // also remind once/day while overdue
var CURRENCY = "₱";             // ₱ (Philippine Peso)
var SEND_HOUR = 9;                   // hour of day (0-23) the daily job runs
// -----------------------------------------

/** Main job: called daily by the trigger. Emails whoever is due today. */
function sendReminders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var rows = sheet.getDataRange().getValues();
  var tz = Session.getScriptTimeZone();

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var stamp = Utilities.formatDate(today, tz, "yyyy-MM-dd");

  var sent = 0;
  for (var r = 1; r < rows.length; r++) {           // r=1 skips the header row
    var name = rows[r][0];
    var email = String(rows[r][1] || "").trim();
    var amount = rows[r][2];
    var due = rows[r][3];
    if (!email || !due) continue;

    var dueDate = new Date(due);
    if (isNaN(dueDate.getTime())) continue;
    dueDate.setHours(0, 0, 0, 0);

    var daysLeft = Math.round((dueDate - today) / 86400000);

    // Decide whether today is a reminder day for this person.
    var when = null;
    if (daysLeft === 0) when = "due today";
    else if (daysLeft > 0 && REMIND_DAYS_BEFORE.indexOf(daysLeft) !== -1) when = "upcoming";
    else if (daysLeft < 0 && REMIND_WHEN_OVERDUE) when = "overdue";
    if (!when) continue;

    // Don't send twice in one day: the Log cell (col E) records what was sent.
    var logCell = sheet.getRange(r + 1, 5);
    var prevLog = String(logCell.getValue() || "");
    if (prevLog.indexOf(stamp) !== -1) continue;

    var amt = CURRENCY + Number(amount || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
    var dueStr = Utilities.formatDate(dueDate, tz, "MMM d, yyyy");

    var subject, body;
    if (when === "overdue") {
      subject = "Payment overdue — " + amt;
      body = "Hi " + name + ",\n\nThis is a friendly reminder that your payment of "
        + amt + " was due on " + dueStr + " and is now overdue. "
        + "Please settle it whenever you can.\n\nThank you!";
    } else if (when === "due today") {
      subject = "Payment due today — " + amt;
      body = "Hi " + name + ",\n\nJust a reminder that your payment of "
        + amt + " is due today (" + dueStr + ").\n\nThank you!";
    } else {
      subject = "Upcoming payment — " + amt;
      body = "Hi " + name + ",\n\nFriendly reminder: your payment of "
        + amt + " is due on " + dueStr + ".\n\nThank you!";
    }

    try {
      MailApp.sendEmail({ to: email, subject: subject, body: body, name: SENDER_NAME });
      logCell.setValue((prevLog ? prevLog + "; " : "") + stamp + " (" + when + ")");
      sent++;
    } catch (e) {
      logCell.setValue("ERROR " + stamp + ": " + e.message);
    }
  }
  Logger.log("Reminders sent: " + sent);
}

/** Run this ONCE to schedule sendReminders() to run every day. */
function createDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendReminders") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendReminders")
    .timeBased().everyDays(1).atHour(SEND_HOUR).create();
  Logger.log("Daily trigger created for " + SEND_HOUR + ":00.");
}

/** Optional: send a test email to yourself to confirm it works. */
function sendTestEmail() {
  var me = Session.getActiveUser().getEmail();
  MailApp.sendEmail({
    to: me, name: SENDER_NAME,
    subject: "Debt Tracker reminder — test",
    body: "If you got this, your reminder script can send email. ✓"
  });
  Logger.log("Test email sent to " + me);
}
