# Debt Tracker — project guide for Claude Code

Offline-first debt & payment tracker (₱ Philippine Peso). **Vanilla HTML/CSS/JS, no build step, no frameworks, no backend.** Data lives in IndexedDB on the device. Everything must keep working fully offline (service worker) and from a `file://`-agnostic relative path.

## Files
- `index.html` — markup + all views (lock screen, dashboard/list, detail, settings) + the shared modal
- `style.css` — all styling; theme-aware via `:root` (dark) and `:root[data-theme="light"]` (light is the default)
- `db.js` — IndexedDB wrapper (`DebtorsDB`, `PaymentsDB`)
- `app.js` — CRUD, dashboard render, CSV import/export, ₱ formatting, hide-amounts, boot
- `auth.js` — PIN (PBKDF2) + biometric (WebAuthn) lock, recovery code, Settings screen
- `service-worker.js` — offline cache (bump `CACHE` on every release)
- `manifest.json`, icons, `serve.ps1` (local server), `netlify.toml`, `.well-known/assetlinks.json`
- `debt-tracker.apk` — the installable Android app (see APK section)

## Run locally
```
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```
Opens http://localhost:8080/ (service workers + biometrics need HTTP, not `file://`).

## Deploy flow — IMPORTANT
- **GitHub = source only.** `git push` does NOT update the live app. Repo: `github.com/jongparkour/debt-tracker` (public).
- **Netlify = live app:** https://iridescent-mooncake-68869c.netlify.app — updated ONLY by dragging the ZIP onto the Netlify **Deploys** tab. There is no GitHub→Netlify auto-deploy.
- Build the ZIP with: `powershell -ExecutionPolicy Bypass -File .\build-zip.ps1` (outputs to `~/Downloads/debt-tracker-deploy.zip`).
- Installed apps (TWA/PWA) pick up changes after the service-worker cache bump, on the next reopen.

## When the user says "continue the project" / "prepare to deploy"
Proactively run `build-zip.ps1` so a fresh `~/Downloads/debt-tracker-deploy.zip` is ready, then tell the user to drag it onto the Netlify **Deploys** tab. Claude can *build* the ZIP but **cannot upload to Netlify** — that drag-and-drop is the user's manual step.

## Release checklist (do all three, every release)
1. `APP_VERSION` in `app.js`
2. footer version string in `index.html`
3. `CACHE` name (`debt-tracker-vN`) in `service-worker.js`

Then: `build-zip.ps1` → `git add -A && git commit && git push` → drag ZIP to Netlify.

## Editing gotcha — UTF-8
The code contains `₱`, em-dashes, and emoji. When editing files via PowerShell, use
`[System.IO.File]::WriteAllText(path, text, (New-Object System.Text.UTF8Encoding($false)))`.
Do NOT use `Set-Content` / `Out-File` for these files — they have corrupted ₱/em-dash/emoji into mojibake (e.g. `â‚±`). The Edit/Write tools are safe. Guard by grepping for mojibake before committing.

## APK / no-address-bar
- `debt-tracker.apk` is committed at repo root but **force-added past `.gitignore`** (which ignores `*.apk`). To update it: `git add -f debt-tracker.apk`.
- It's a TWA signed with cert fingerprint `98:52:BE:FB:96:...` which **matches** `.well-known/assetlinks.json` (package `app.netlify.iridescent_mooncake_68869c.twa`) → the app opens fullscreen with **no browser address bar**.
- The signing **keystore is NOT in the repo** (keys must never be public). It's only needed to rebuild/re-sign the APK, not to edit the web app.
- Download links: site footer `./debt-tracker.apk`; GitHub `raw/main/debt-tracker.apk`. The footer promo auto-hides when running as an installed PWA/TWA (`isInstalledApp()` in app.js).
- The Android "unknown sources" + browser "harmful file" warnings are inherent to sideloading; only the Play Store removes them.

## Analytics (Cloudflare Web Analytics — cookieless)
- Beacon (token `6e128fc0e8d84f66aa7cfa9da3234949`) is in `index.html` and `get-app.html`. Only anonymous pageviews are sent; no debtor data ever leaves the device.
- **App usage** = pageviews of `/`. **APK downloads** = pageviews of `/get-app.html` (Cloudflare's free tier has no click events, so `get-app.html` is a landing page that auto-starts the download; the download button + Settings QR + README all funnel through it).
- View stats at Cloudflare dashboard → Web Analytics → hostname `iridescent-mooncake-68869c.netlify.app`.

## Payment plans (v3.22+) — the basis of all reminders
Each debtor has a **plan**, set in Add/Edit: an **expected monthly payment** (`monthlyTarget`, also
stored as `planAmount`) + cadence `planFreq` = `"weekly"|"monthly"` + a **due day** `planDay`
(weekday 0–6 for weekly, day-of-month 1–28 for monthly). **No due-date field — the plan + due day
ARE the schedule.** Helpers in `app.js`: `planFieldsHtml`/`wirePlanFields` (monthly amount +
cadence toggle + due-day `<select>` that swaps weekday⇄day-of-month + live `planSummary`),
`weeklyFromMonthly` (÷4 estimate), `WEEKDAYS`/`ordinal`/`planDayLabel`, `expectations()`
(period-aware). `buildPersons` carries `planFreq`/`planAmount`/`planDay`; legacy debtors → monthly
with their old `monthlyTarget`, `planDay` default (weekly 6 / monthly 1).

## Reminders — plan-based, automatic (wired, live)
**In-app tap-to-send (free, offline):** tap **✉️/💬** on a debtor → `mailto:`/`sms:` reminder that
emphasises the chosen plan period. Recording a payment shows a **receipt** modal.

**Server-side automatic (Gmail via Apps Script Web App):**
- The app **syncs each debtor's plan + due day + live balance** to `PAYMENT_SYNC_URL`.
  `syncDebtorById(id[,amt])` → `postSync("debtor_upsert" | "payment_added",
  {key,name,email,total,paid,remaining,planFreq,monthly,planDay[,amount]})` (no-cors; offline queue
  `dt_syncQueue` flushes on boot). Called on add / edit / addLoan / payment.
- Config at top of `app.js`: `PAYMENT_SYNC_URL` (blank = off → tap-to-send only) + `PAYMENT_SYNC_SECRET`
  (`dt-pay-9oytk60`). `getSyncConfig()` returns these constants.
- Engine = `reminders/AutoReminders.gs` (rewritten v3.24): `doPost` upserts a **"Reminders"** tab
  (Email|Name|Freq|Monthly|DueDay|Remaining|Enrolled|Active|LastPaid|LastSent) and on payments
  updates Remaining + stamps LastPaid. `sendReminders()` runs at **8 AM & 2 PM** (two triggers via
  `createTriggers`): on a debtor's **due day** it sends twice; the **next day** it sends an
  **overdue** follow-up unless `LastPaid ≥ dueDay` (`dueToday_` decides). Weekly amount =
  `weeklyAmount_` (monthly ÷ that weekday's occurrences that month; mid-month = remaining ones),
  monthly = full amount; both capped at remaining. Dedupe per `yyyy-MM-dd + AM/PM` slot via
  LastSent. `sendPaymentConfirm_` sends the receipt + "fully paid ✓". Email-only. Guide: `SETUP.md`.
- **Redeploy after editing the .gs:** Manage deployments → ✏ → Version: New version (same `/exec` URL).

**Pro request counter (still live):** Settings **"⚡ Upgrade to Pro"** → `pro-request.html`
(Cloudflare-beacon) counts demand; `dt_proRequested` stops repeat taps.

## Sign-up auto-import (debtors self-register)
Debtors fill a Google Form → response Sheet **Published to web as CSV** → the app
auto-imports on open. **Backend-configured feed, per-device filtering:**
- Set the CSV link in the `SIGNUP_CSV_URL` constant at the top of `app.js` (no app UI for the URL).
- The sheet may have a **Code** column. Each device stores its own **lender code** (`dt_lenderCode`),
  set only in **Settings → Sign-up code** (that card appears only when `SIGNUP_CSV_URL` is set; no prompt).
  If the sheet HAS a Code column, `pullSignups()` imports **only rows whose Code matches** this device's
  code (many lenders, each seeing theirs). If there's **no Code column** (or code left blank) it's
  single-lender mode → imports everyone. "Phone number" is accepted as an alias for "Phone".
- Config is LIVE on a **dedicated Google account**: `SIGNUP_FORM_URL` (forms.gle/g5ENoD8kL1yZ22hn7)
  + `SIGNUP_FORM_PREFILL` (form `1FAIpQLSeVrw7bMT0odS9AcfpJYqLQQAvWqiRym1m1DJfQP4h7dUEuJQ`, Code entry
  `2093344895`) + new `SIGNUP_CSV_URL` (sheet `…2PACX-1vSUpcJ…`, gid 91289261). Reminder emails
  (Apps Script) also send from that dedicated account.
  Each device auto-generates a tag (`ensureLenderCode`, since prefill is set) and shows its own
  personalized sign-up link + QR. As of v3.21 the **"+ Add debtor" button opens that QR directly**
  (`openSignupQR()` in app.js — QR + Copy/Share, plus a subtle "Or add manually" link that falls
  back to `openAddDebtor()`). The old Settings "Debtor sign-up link" card was removed. Lenders
  share *that* link so their debtors' rows carry their tag.
- Adds only **new** names (de-duped by `normName`, never overwrites). Falls back to manual
  **Import CSV** on fetch failure. Import needs only Name + Total Debt. Guide: `signup-form.md`.
- Updates on app open only (no closed-app push without the Pro backend).

## Data & safety
- All data is in IndexedDB on the device — nothing is uploaded, nothing is in the repo.
- CSV export/import is the backup path (headers include Due Date + Note as of v3.2).
- The lock gates *access*; it does not encrypt stored data.
