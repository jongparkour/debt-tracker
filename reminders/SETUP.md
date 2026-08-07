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

## 3. (Optional) Turn on SMS — free via your phone
Apps Script can't send SMS itself, so your **phone** sends it (on your SIM — use an unli-text
plan). Easiest gateway: **textbee.dev** (free 50 SMS/day).
1. On your Android phone, install **textbee** (textbee.dev) and follow its app to **register the
   device** → you get an **API key** and a **Device ID**.
2. In the script config (top), fill:
   ```js
   var TEXTBEE_API_KEY  = "your-api-key";
   var TEXTBEE_DEVICE_ID = "your-device-id";
   ```
3. (Test SMS: set `TEST_PHONE` to your number and run `sendTest`.)
> Prefer fully-open-source? **SMSGate (sms-gate.app)** works too — just swap the URL/auth in the
> `sendSms_` function. Keep the phone on with signal; exclude the gateway app from battery saving.

## 4. Schedule it
- Function dropdown → **`createTriggers`** → **Run** (once).
- Reminders now go out every **8 AM & 2 PM** to whoever is due. (Change `RUN_HOURS`,
  `REMIND_DAYS_BEFORE`, etc. at the top.)

---

## Good to know
- **Dedupe:** a "Reminder Log" column is added automatically so nobody is texted/emailed twice
  in the same AM/PM slot.
- **Free limits:** Gmail ~100/day; textbee free ~50 SMS/day (your SIM plan is the real SMS limit).
- **No due date = no reminder** (scheduling needs the date). Fully-paid tracking isn't here —
  it uses the sign-up amount.
- **SMS still isn't "cloud free"** — it rides your phone/SIM; the phone must be on and online.
