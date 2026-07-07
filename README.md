# 💰 Debt Tracker

Offline-first debt & payment tracker (₱ Philippine Peso). Pure HTML/CSS/vanilla JS,
IndexedDB storage, service-worker offline support, PIN + biometric lock. No frameworks,
no backend, no external libraries.

Built by **Jongparkour**.

---

## Features
- Debtors: add / edit / delete (name, total debt, payment rule)
- Payments: add / edit / delete (amount + date), grouped by month
- Auto totals: paid & remaining, progress bar
- Search by name + filter (all / active / fully paid)
- CSV export (debtors & payments) for backup
- Works fully offline (service worker, cache + network-first)
- App lock: PIN (PBKDF2) + fingerprint/face (WebAuthn) + recovery code
- Light & dark theme, mobile-first

## File structure
```
index.html          markup + views + lock screen
style.css           all styling
db.js               IndexedDB wrapper (debtors, payments)
app.js              CRUD, totals, grouping, CSV, ₱ formatting
auth.js             PIN + biometric lock + recovery
service-worker.js   offline caching
manifest.json       PWA manifest
icon-192.png / icon-512.png / icon-maskable-512.png / icon.svg
serve.ps1           local dev server (no installs needed)
```

---

## Run locally (Windows, no installs)
Service workers and biometrics require HTTP(S) — not `file://`.

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```
Open **http://localhost:8080/**. Ctrl+C to stop.

(Or use the VS Code "Live Server" extension → right-click index.html → Open with Live Server.)

---

## Deploy (get an HTTPS URL)
PWABuilder needs a live HTTPS site. Easiest option:

**Netlify Drop** — https://app.netlify.com/drop
1. Drag the entire `debt-tracker` folder onto the page.
2. You get a URL like `https://your-name.netlify.app` (HTTPS, free).
3. Confirm it loads and the lock screen appears.

> The app uses relative paths, so it works whether it's at the site root or a subfolder.

---

## Package as a PURE fullscreen APK (no address bar)
The browser address bar only appears if Android can't verify you own the domain.
Verification = hosting `.well-known/assetlinks.json` with the fingerprint of the
key that signed the APK. This repo already includes a template for it.

### 1. Build in PWABuilder
1. Go to **https://www.pwabuilder.com**, paste your Netlify URL.
2. **Package For Stores → Android.**
3. Set a **Package ID** you control, e.g. `com.jongparkour.debttracker`
   (write it down — it must match assetlinks.json).
4. Signing key → **"Generate new"**. Download the `.keystore` and SAVE the
   passwords + key alias — you need the SAME key to ship updates later.
5. PWABuilder shows a **SHA-256 fingerprint** and generates an `assetlinks.json`
   inside the downloaded ZIP (usually `assetlinks.json` in the root).

### 2. Fill in and re-deploy assetlinks.json
Open `.well-known/assetlinks.json` in this project and replace:
- `REPLACE_WITH_YOUR_PACKAGE_ID` → your Package ID from step 3
- `REPLACE_WITH_SHA256_FINGERPRINT_FROM_PWABUILDER` → the SHA-256 fingerprint

(Or just copy PWABuilder's generated `assetlinks.json` over this file — same thing.)
Then re-deploy the folder to Netlify. Verify it loads at:
`https://your-site.netlify.app/.well-known/assetlinks.json`

### 3. Install
- Transfer the `.apk` to the phone, tap it, allow "install from unknown sources".
- First launch verifies the domain → **no address bar, fullscreen app**.
- If a bar still shows: assetlinks fingerprint/package_id don't match, or the file
  isn't reachable. Re-check step 2, then reinstall.
- Fingerprint/face unlock uses the phone's real sensor.

> Order matters: you must build first (to get the fingerprint), then host
> assetlinks.json, then (re)install. The included `netlify.toml` already serves
> the file with the correct `application/json` content-type.

---

## Data & backup
- All data lives in **IndexedDB on the device** — nothing is uploaded.
- **Back up** with the CSV export buttons. Do this before "Erase everything",
  clearing site data, or uninstalling.
- **Lock recovery**: keep your recovery code somewhere safe. Lose the PIN *and*
  the code *and* biometrics = the only way in is erase + restore from CSV.

## Security notes
- PIN and recovery code are stored only as PBKDF2-SHA256 hashes (never plaintext).
- Biometrics use the device platform authenticator via WebAuthn (secure context only).
- This gates **access**; it does not encrypt the stored data. A technical user with
  the unlocked device could still read IndexedDB. (Optional future upgrade: encrypt
  the data with a key derived from the PIN.)

## Versioning
When you change any file, bump the cache name in `service-worker.js`
(`debt-tracker-vN`) so users get the update, and update the footer / `APP_VERSION`
in app.js if it's a release.
