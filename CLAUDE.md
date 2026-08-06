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

## Reminders — free tier + Pro (deferred)
**Free (live):** debtors have **email** + **phone** fields; tap **✉️/💬** on a debtor to send a reminder via `mailto:`/`sms:` (pre-filled). Recording a payment shows a **receipt** modal (today/week/month/overall + remaining) with tap-to-send Email/Text. All on-device, free, private.

**Pro (built but NOT wired yet — waiting for demand):**
- Settings → Auto reminders shows an **"⚡ Upgrade to Pro"** button (no setup fields). Tapping it opens `pro-request.html` (a Cloudflare-beacon page) → **pageviews of `/pro-request.html` = number of Pro requests**. A local `dt_proRequested` flag stops repeat taps. **When it reaches ~10, build the central automation.**
- The full automation code is ready: `reminders/AutoReminders.gs` (Apps Script **Web App**: `doPost` upsert + payment-confirmation email + AM/PM reminder triggers, branded HTML emails) + `reminders/SETUP.md`.
- The app's sync plumbing is **dormant** in `app.js` (`getSyncConfig`/`postSync`/`syncDebtorById`, offline queue `dt_syncQueue`) — it no-ops because no URL is set. To turn Pro on, re-add a URL source (central endpoint) and the Settings fields, then deploy `AutoReminders.gs`.
- No free SMS (carriers charge the sender).

## Sign-up auto-import (debtors self-register)
Debtors fill a Google Form → response Sheet **Published to web as CSV** → the app
auto-imports on open. **Backend-configured feed, per-device filtering:**
- Set the CSV link in the `SIGNUP_CSV_URL` constant at the top of `app.js` (no app UI for the URL).
- The sheet may have a **Code** column. Each device stores its own **lender code** (`dt_lenderCode`),
  set only in **Settings → Sign-up code** (that card appears only when `SIGNUP_CSV_URL` is set; no prompt).
  If the sheet HAS a Code column, `pullSignups()` imports **only rows whose Code matches** this device's
  code (many lenders, each seeing theirs). If there's **no Code column** (or code left blank) it's
  single-lender mode → imports everyone. "Phone number" is accepted as an alias for "Phone".
- Config is LIVE: `SIGNUP_FORM_URL` (forms.gle/ZJgtq5qgWeik96NK8) + `SIGNUP_FORM_PREFILL`
  (form `1FAIpQLSf3IKrM3HoNu53sy-31qttfOR1PVsqcJ4tye8DIomnof73B6Q`, Code entry `2093344895`).
  Each device auto-generates a tag (`ensureLenderCode`, since prefill is set) and shows its own
  personalized sign-up link + QR in **Settings → Debtor sign-up link** (`signupShareLink()`).
  Lenders share *that* link so their debtors' rows carry their tag.
- Adds only **new** names (de-duped by `normName`, never overwrites). Falls back to manual
  **Import CSV** on fetch failure. Import needs only Name + Total Debt. Guide: `signup-form.md`.
- Updates on app open only (no closed-app push without the Pro backend).

## Data & safety
- All data is in IndexedDB on the device — nothing is uploaded, nothing is in the repo.
- CSV export/import is the backup path (headers include Due Date + Note as of v3.2).
- The lock gates *access*; it does not encrypt stored data.
