# 📧 Plan-based automatic reminders + receipts (Apps Script)

`AutoReminders.gs` runs on Google's servers and emails each debtor based on the **payment plan +
due day** you set in the app — **no due-date column needed, the plan IS the schedule**:

- **On the due day → two reminders (8 AM & 2 PM).**
  - **Weekly plan** → the due day is a **weekday** you pick (e.g. every Friday). The amount is the
    expected **monthly** split across that weekday's occurrences in the month (mid-month start →
    split across the ones remaining).
  - **Monthly plan** → the due day is a **day-of-month** you pick (e.g. the 15th) for the full
    monthly amount.
- **The next day → one OVERDUE follow-up (8 AM & 2 PM)** if no payment was recorded on the due day.
- **On every payment** → an instant **receipt**; once the balance hits ₱0 → a **"fully paid ✓"** email.
- Amounts are capped at the remaining balance; reminders **stop** when it's cleared.

The app syncs each debtor's plan + due day + live balance to this Web App (the same private
endpoint your payment receipts use). A **"Reminders"** tab is created automatically to track everyone.

### How the pieces fit (Forms → Sheet → App → Apps Script)
- **Google Form + its responses sheet** = the **sign-up inbox** only (Name, Total, Email, Phone,
  Code). The app imports new sign-ups from it. **Remove the form's old "Due Date" question — it's
  no longer used.** The lender sets the plan + due day in the app after import.
- **App** = the source of truth for each debtor's **plan** (monthly amount, weekly/monthly, due day)
  and payments. It syncs them to the Web App.
- **"Reminders" tab (auto-created)** = what the reminder engine reads. You don't edit it by hand.

---

## 1. Add / update the script
1. Open your response **Google Sheet → Extensions → Apps Script**.
2. Select all, paste the whole **`AutoReminders.gs`**, **Save**. Keep `var SECRET` matching
   `PAYMENT_SYNC_SECRET` in the app (`app.js`).

## 2. Deploy the Web App (once)
- **Deploy → New deployment → Web app** → **Execute as: Me**, **Who has access: Anyone** → **Deploy**
  → approve permissions → copy the **/exec** URL into the app's `PAYMENT_SYNC_URL`.
- Re-deploying later after an edit: **Deploy → Manage deployments → ✏ → Version: New version →
  Deploy** (keeps the same URL).

## 3. Schedule the daily job
- **Project Settings ⚙ → Time zone** → your zone (e.g. GMT+8 Manila).
- Function dropdown → **`sendTest`** → Run → approve → check your inbox for a sample reminder.
- Function dropdown → **`createTriggers`** → Run once. The job now runs daily at **8 AM & 2 PM**
  and sends whatever is due that day (plus next-day overdue follow-ups).

---

## How the amounts work
- Per debtor you set: **expected monthly payment** (e.g. ₱2,400), a **Weekly / Monthly** cadence,
  and a **due day** (a weekday for weekly, a day-of-month for monthly).
- **Monthly** → reminds ₱2,400 on your chosen day (e.g. the 15th), 8 AM & 2 PM.
- **Weekly** → reminds ₱2,400 ÷ (that weekday's occurrences that month) on your chosen weekday.
  Added mid-month with 3 of that weekday left → ₱800 each; the next full month → ₱2,400 ÷ 4 ≈ ₱600.
- Miss the due day → an **overdue** email the next day (8 AM & 2 PM).
- Every amount is **capped at the remaining balance**, so the last reminder is never more than owed.

## Good to know
- **Needs an email** on the debtor (no email = not enrolled). Gmail free limit ≈ 100 emails/day.
- **Dedupe:** the "Reminders" tab stores the last week/month sent so nobody is emailed twice.
- **Editing a plan** in the app re-syncs instantly; changing to a cleared balance stops reminders.
- **SMS** isn't part of this engine — texting stays tap-to-send in the app (free auto-SMS from a
  dedicated number doesn't exist).
