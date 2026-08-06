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

## ⚡ Make it automatic (import on app open — no download)
Instead of downloading a CSV each time, let the app pull sign-ups itself:
1. Open the linked response **Google Sheet** → **File → Share → Publish to web**.
2. Under "Link", choose the **response sheet** and format **Comma-separated values (.csv)** →
   **Publish**. Copy the link (looks like `https://docs.google.com/…/pub?output=csv`).
3. In the app: **⚙️ Settings → Sign-up form auto-import** → paste the link → **Save link**.
4. Done. From now on, **every time you open the app** it fetches new sign-ups and adds them
   automatically (de-duped by name). You can also tap **Pull sign-ups now** any time.

Notes on the automatic mode:
- It updates **when you open the app** (or tap Pull) — not while the app is closed.
- Google's published CSV can lag a **few minutes** behind a brand-new submission.
- If Google ever blocks the fetch, the app tells you — just use the manual **Import CSV**
  step above instead.

## Good to know
- The Sheet has an extra **Timestamp** column — the app ignores it.
- **Total Debt** can be typed as `20000` or `₱20,000` — the app strips symbols/commas.
- Import **de-duplicates by name**, so re-importing the same file won't create doubles
  (pick "Replace" to update existing people).
- This is **semi-automatic**: the form collects entries by itself; you do the quick import.
  A fully hands-off version (entries appear with no import step) needs the central
  back-end — that's the deferred **Pro** feature.
