# 📧📱 Automatic reminders from your sheet — Gmail + SMS (Apps Script)

`AutoReminders.gs` reads your **Google Form response sheet** and sends each debtor a reminder
**before / on / after their due date**, every morning & afternoon, on Google's servers.

- **Email** — free, from your Gmail (~100/day).
- **SMS** — optional, via a **phone gateway** (your phone texts from your own SIM). Leave the
  gateway config blank for **email only**.

> It reminds using the **Total Debt** from the sheet (the sign-up amount) + the **Due Date** —
> it doesn't know payments made inside the app. For live balances you'd sync the app to the
> sheet (a separate step). For simple "you have a payment due" nudges, this is enough.

Your sheet needs these columns (the form already makes them): **Debtor Name, Total Debt, Email,
Phone number, Due Date**. (Add a **Due Date** question to the form if it's missing — reminders
are scheduled off it.)

---

## 1. Add the script
1. Open your response **Google Sheet** → **Extensions → Apps Script**.
2. Delete the sample code, paste all of **`AutoReminders.gs`**, **Save**.

## 2. Email test
1. Function dropdown → **`sendTest`** → **Run** → approve permissions
   (**Review permissions → your account → Advanced → Go to project → Allow**).
2. Check your inbox for the test. ✓

## 3. Turn on SMS — free via your phone (SMSGate)
Apps Script can't send SMS itself, so your **phone** sends it (on your SIM — use an unli-text plan).
1. On your Android phone, install **SMS Gateway** (from **sms-gate.app** — Google Play or their APK).
2. Open it and switch the mode to **Cloud Server**. It shows a **username** and **password** —
   those are your API credentials.
3. In the script config (top), fill:
   ```js
   var SMSGATE_USER = "your-username";
   var SMSGATE_PASS = "your-password";
   ```
4. Keep the app running, phone **on with signal**, and **exclude it from battery optimization**
   (Settings → Battery → set the app to *Unrestricted*) so it stays connected.
5. Test: set `TEST_PHONE` to your own number, then run **`sendTest`**.

## 4. Schedule it
- Function dropdown → **`createTriggers`** → **Run** (once).
- Reminders now go out every **8 AM & 2 PM** to whoever is due. (Change `RUN_HOURS`,
  `REMIND_DAYS_BEFORE`, etc. at the top.)

## 5. Instant payment receipts (optional) — email on every payment
The reminder job above nudges people *before* a due date. This extra step emails a debtor a
**receipt the moment you record their payment** in the app (remaining balance included).

1. Same script — the `doPost` / `sendPaymentConfirm_` functions are already in `AutoReminders.gs`.
   Make sure `var SECRET` (top of the file) matches `PAYMENT_SYNC_SECRET` in the app's `app.js`.
2. **Deploy → New deployment** → gear ⚙ → type **Web app**.
   - **Description:** anything · **Execute as:** *Me* · **Who has access:** *Anyone* → **Deploy**.
   - Approve permissions if asked. Copy the **Web app URL** (ends in `/exec`).
3. Give that `/exec` URL to Claude → it goes into `PAYMENT_SYNC_URL` in `app.js`, then a rebuild +
   redeploy of the app. From then on, recording a payment auto-emails the debtor.

> Re-deploying the script later: **Deploy → Manage deployments → edit (✏) → Version: New version**
> keeps the **same** `/exec` URL (no app change needed).

---

## Good to know
- **Dedupe:** a "Reminder Log" column is added automatically so nobody is texted/emailed twice
  in the same AM/PM slot.
- **Free limits:** Gmail ~100/day; textbee free ~50 SMS/day (your SIM plan is the real SMS limit).
- **No due date = no reminder** (scheduling needs the date). Fully-paid tracking isn't here —
  it uses the sign-up amount.
- **SMS still isn't "cloud free"** — it rides your phone/SIM; the phone must be on and online.
