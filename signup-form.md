# 📝 Debtor sign-up form (self-service) — free setup

Let people **fill in their own details**, then pull them into your app in two taps. Uses a
free **Google Form → Google Sheet → CSV import** (your app already has an **Import** button).

## 1. Create the Google Form
1. Go to <https://forms.google.com> → **Blank form**. Title it e.g. "Borrow from me".
2. Add these questions. **The question title must be EXACTLY the name below** — the title
   becomes the spreadsheet column, and the app matches columns by that name. Put any units
   or instructions in the question's *description*, not the title.

   | Question title (exact) | Type | Required? |
   |---|---|---|
   | **Debtor Name** | Short answer | ✅ yes |
   | **Total Debt** | Short answer | ✅ yes — the amount they're borrowing (a plain number, e.g. `20000`) |
   | **Email** | Short answer | optional |
   | **Phone** | Short answer | optional |
   | **Due Date** | Date | optional |
   | **Note** | Paragraph | optional |
   | **Monthly Target** | Short answer | optional — expected payment per month |
   | **Code** | Short answer | for routing to the right lender (auto-filled — see "codes" below) |

3. **Responses** tab → **Link to Sheets** → *Create a new spreadsheet*. Every submission now
   lands in that Sheet automatically.

## 2. Share it
Send the Form's **share link** (or its QR code) to anyone who wants to borrow. They fill in
their **own** info — you don't type anything.

## 3. Pull sign-ups into your app
When you want to add the new people:
1. Open the linked **Google Sheet** → **File → Download → Comma-separated values (.csv)**.
2. In Debt Tracker: **⬆ Import CSV** → pick that file.
3. New debtors appear in your list. (If some already exist, choose **Keep both** or
   **Replace** when asked.)

That's it — their amount, email, phone, due date, and note all come in.

## ⚡ Fully automatic (configured in code — nothing shown in the app)
The app auto-imports sign-ups from a link you set **in the code**, so there's no setting to
touch and users see nothing.
1. Open the linked response **Google Sheet** → **File → Share → Publish to web**.
2. Choose the **response sheet**, format **Comma-separated values (.csv)** → **Publish**.
   Copy the link (looks like `https://docs.google.com/…/pub?output=csv`).
3. Paste it into **`app.js`** → the `SIGNUP_CSV_URL` constant near the top:
   ```js
   const SIGNUP_CSV_URL = "https://docs.google.com/…/pub?output=csv";
   ```
4. Rebuild + deploy (`build-zip.ps1` → Netlify). Done — **every time the app opens** it
   silently fetches new sign-ups and adds them (de-duped by name). No UI, no taps.

Notes:
- It updates **when the app is opened** — not while it's closed.
- Published CSV can lag a **few minutes** behind a fresh submission.
- Every install pulls from this **one** sheet (it's baked into the app).

## 🎯 Route sign-ups to the right lender (codes)
Your one sheet can serve many lenders — each device only shows **its own** debtors:
1. Keep the **Code** question in the form (short answer).
2. For each lender, make a **pre-filled link** so their borrowers are auto-tagged:
   Form → **⋮ (top-right) → Get pre-filled link** → type that lender's code (e.g. `JUAN123`)
   in the **Code** field → **Get link** → copy. Share *that* link with that lender's borrowers.
   (The borrower never types the code — it's already filled in.)
3. On each lender's phone, the app asks for their **code once** (or set it in
   **⚙️ Settings → Sign-up code**). That device then imports **only** rows whose Code matches.

Flow: borrower opens the lender's pre-filled link → fills their info → it lands in your one
sheet tagged with that lender's code → appears **only** on that lender's device.

## Good to know
- The Sheet has an extra **Timestamp** column — the app ignores it.
- **Total Debt** can be typed as `20000` or `₱20,000` — the app strips symbols/commas.
- Import **de-duplicates by name**, so re-importing the same file won't create doubles
  (pick "Replace" to update existing people).
- This is **semi-automatic**: the form collects entries by itself; you do the quick import.
  A fully hands-off version (entries appear with no import step) needs the central
  back-end — that's the deferred **Pro** feature.
