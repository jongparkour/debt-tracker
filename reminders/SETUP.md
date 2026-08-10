# 📧 Plan-based automatic reminders + receipts (Apps Script)

`AutoReminders.gs` runs on Google's servers and emails each debtor based on the **payment plan**
you set in the app — **no due date needed, the plan cadence IS the schedule**:

- **Weekly plan** → an email **every weekend (Saturday)**. The weekend amount is the expected
  **monthly** payment split across that month's weekends. Start a debtor mid-month and the split
  covers only the **remaining** weekends, so that month still totals the monthly expected.
- **Monthly plan** → an email on the **1st** of each month for the expected monthly amount.
- **On every payment** → an instant **receipt**; once the balance hits ₱0 → a **"fully paid"** email.
- Reminders **stop automatically** when the balance is cleared.

The app syncs each debtor's plan + live balance to this Web App (the same private endpoint your
payment receipts use). A **"Reminders"** tab is created automatically to track everyone.

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
- Function dropdown → **`createTriggers`** → Run once. The job now runs daily at 9:00 and sends
  whatever is due (weekend reminders on Saturdays, monthly on the 1st).

---

## How the amounts work
- You enter one number per debtor: the **expected monthly payment** (e.g. ₱2,400), plus a
  **Weekly / Monthly** reminder cadence.
- **Monthly** → reminds ₱2,400 on the 1st.
- **Weekly** → reminds ₱2,400 ÷ (weekends that month) each Saturday. Added in the 2nd week with
  3 weekends left → ₱800 each of those 3 weekends; the next full month → ₱2,400 ÷ 4 ≈ ₱600.
- Every amount is **capped at the remaining balance**, so the last reminder is never more than owed.

## Good to know
- **Needs an email** on the debtor (no email = not enrolled). Gmail free limit ≈ 100 emails/day.
- **Dedupe:** the "Reminders" tab stores the last week/month sent so nobody is emailed twice.
- **Editing a plan** in the app re-syncs instantly; changing to a cleared balance stops reminders.
- **SMS** isn't part of this engine — texting stays tap-to-send in the app (free auto-SMS from a
  dedicated number doesn't exist).
