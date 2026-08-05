# 📧 Automatic email reminders + payment confirmations — setup (free, ~15 min)

Once set up, the Debt Tracker app will **automatically**:
- **Add each debtor to a Google Sheet** the moment you save them in the app,
- **Email a confirmation** to a debtor when you record their payment,
- **Email reminders MORNING and AFTERNOON** to anyone whose payment is due
  (7/3/1 days before, on the due date, and while overdue).

All free, using your Gmail (~100 emails/day), running on Google's servers even when
your phone is off. Texts (SMS) can't be free — this is email-only.

> **Privacy note:** doing this means debtor **names, emails, amounts, and due dates
> get sent to your Google Sheet** as you use the app. Without setup (blank Sync URL),
> the app sends nothing and stays fully on your device.

---

## 1. Create the Sheet
1. Go to <https://sheets.google.com> → **Blank spreadsheet**. Name it e.g. "Debt Reminders".
2. In **row 1** type these headers (columns A–G):

   `Name | Email | Amount | Due Date | Log | Total | Paid`

   *(Or skip this and run `setupSheet` in step 2 to fill the headers for you.)*
   You don't type debtors here — the app fills them in. Leave **Log** empty (the script writes there).

---

## 2. Add the script + your secret
1. In the Sheet: **Extensions → Apps Script**.
2. Delete the sample code, paste **all** of `AutoReminders.gs` (in this folder), **Save**.
3. At the top, change `var SECRET = "changeme";` to a **word only you know**
   (e.g. `"juan-2026-secret"`). Remember it — you'll paste the same word into the app.
4. *(optional)* Run **`setupSheet`** once to write the header row.

---

## 3. Test email
1. Function dropdown → **`sendTestEmail`** → **Run**.
2. Approve the permission prompt: **Review permissions → your account → Advanced →
   "Go to (project) (unsafe)" → Allow**. (It's your own script sending email as you.)
3. Check your inbox for the test. ✓

---

## 4. Deploy as a Web App (this gives the app a URL to talk to)
1. Top-right **Deploy → New deployment**.
2. Gear ⚙️ next to "Select type" → **Web app**.
3. Set **Execute as: Me**, and **Who has access: Anyone**. → **Deploy** → Authorize.
4. Copy the **Web app URL** (ends in `/exec`).
   - You can paste it in a browser to check — it should say *"Debt Tracker reminder endpoint is live."*

> Re-deploying later (after editing the script): **Deploy → Manage deployments →
> edit ✏️ → Version: New version → Deploy**. The URL stays the same.

---

## 5. Connect the app
1. Open Debt Tracker → **⚙️ Settings → Auto reminders**.
2. **Sync URL** = the `/exec` URL from step 4.
3. **Secret** = the exact word you set in step 2.
4. **Save changes**.
5. Test it: **Add a debtor** (with an email) in the app → a row should appear in your
   Sheet within seconds. Record a payment → the debtor gets a confirmation email.

---

## 6. Turn on the twice-daily reminders
1. Back in Apps Script: function dropdown → **`createTriggers`** → **Run**.
2. Done — reminders now go out every **morning (8 AM)** and **afternoon (2 PM)**.
   Check the **⏰ Triggers** tab to confirm two entries.

---

## Customize (top of `AutoReminders.gs`)
- `REMIND_DAYS_BEFORE = [7, 3, 1]` — which days before due to remind.
- `REMIND_WHEN_OVERDUE = true` — keep reminding after the due date.
- `MORNING_HOUR = 8`, `AFTERNOON_HOUR = 14` — the two run times.
- `SENDER_NAME`, and the `subject`/`body` text — reword the emails.

## Good to know
- **Free limit:** ~100 emails/day (Gmail) / 1,500 (Workspace).
- **De-duplication:** the Log column stops repeat sends within the same AM/PM slot.
- **Fully paid** debtors are skipped automatically (remaining ≤ 0).
- **No app? Still works:** you can also just type debtors straight into the Sheet
  (Name, Email, Amount, Due Date) — the reminders will still send.
- **No SMS:** carriers charge the sender, so free auto-SMS isn't possible.
