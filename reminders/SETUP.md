# 📧 Automatic email reminders — setup (free, ~10 min)

This sends your debtors a friendly **email reminder** before, on, and after their due
date — **automatically, every day**, running on Google's servers (your phone/app can be
off). It's **free** using your Gmail (about **100 emails/day** on a normal account).

You'll set up two things: a **Google Sheet** (your debtor list) and a small **Apps
Script** (`AutoReminders.gs`, in this folder) that emails from it.

---

## 1. Make the Google Sheet
1. Go to <https://sheets.google.com> → **Blank spreadsheet**.
2. In **row 1**, type these exact headers, one per column:

   | A | B | C | D | E |
   |---|---|---|---|---|
   | **Name** | **Email** | **Amount** | **Due Date** | **Log** |

3. From **row 2** down, add one row per debtor, e.g.:

   | Name | Email | Amount | Due Date | Log |
   |------|-------|--------|----------|-----|
   | Juan Dela Cruz | juan@email.com | 500 | 2026-08-15 | *(leave blank)* |

   - **Due Date** must be a real date (type `2026-08-15` and it turns into a date).
   - Leave **Log** empty — the script writes there so it never emails twice a day.

---

## 2. Add the script
1. In the Sheet: **Extensions → Apps Script**.
2. Delete the sample `function myFunction() {}`.
3. Open **`AutoReminders.gs`** (in this folder), copy **all** of it, paste into the editor.
4. Click **💾 Save**.

---

## 3. Test it
1. In the toolbar function dropdown, pick **`sendTestEmail`** → **Run**.
2. First run asks for permission → **Review permissions → choose your account →
   Advanced → "Go to (project) (unsafe)" → Allow**. (It's "unsafe" only because it's
   your own unpublished script — it just sends email as you.)
3. Check your inbox for the test email. ✓
4. Now pick **`sendReminders`** → **Run** to email anyone actually due today.

---

## 4. Turn on the daily automation
1. Pick **`createDailyTrigger`** → **Run** (once).
2. Done — from now on it runs **every day at 9 AM** and emails whoever is due.
   (Check **⏰ Triggers** in the left sidebar to confirm.)

---

## Customize (top of `AutoReminders.gs`)
- `REMIND_DAYS_BEFORE = [7, 3, 1]` — remind 7, 3, and 1 day before due.
- `REMIND_WHEN_OVERDUE = true` — keep reminding (once/day) after the due date.
- `SEND_HOUR = 9` — change the time of day it runs.
- `SENDER_NAME` — the "from" name recipients see.
- Edit the `subject` / `body` text to reword the messages.

## Good to know
- **Free limit:** ~100 emails/day (consumer Gmail) / 1,500 (Google Workspace). Fine for
  personal use.
- **Where data lives:** the debtor **names, emails, amounts, and due dates live in this
  Google Sheet** (not on your phone). That's the trade-off for hands-off automation.
- **Keeping it in sync with the app:** the Debt Tracker app doesn't store emails yet, so
  you maintain this Sheet by hand. Ask Claude to *"add an email field + export"* to the
  app if you'd rather type contacts there and paste them in.
- **No SMS:** texts can't be sent for free (carriers charge the sender). This is
  email-only by design.
