# Buzzy (web)

Installable offline PWA (formerly "Decoy web"; the crypto engine is still called DecoyCore). Plain HTML/CSS/JS, no build step. Spec: the native `decoy` repo.

## Features
- 6-digit real PIN + a different decoy PIN that opens an identical-looking fake vault.
- Two encrypted blobs, each exactly 256 KiB, real one in a random slot, nothing stored says which is real. Unlock tries both every time.
- Key: PBKDF2-SHA256, 600,000 iterations, random 16-byte salt per blob → AES-256-GCM, random 12-byte IV per save. Plaintext padded with random bytes to fixed size. Vault cap ≈ 256 KiB of JSON.
- Lockout: 4 free wrong tries, then 1, 5, 15, 60 min (60 repeats). Counter stored in IndexedDB, survives reloads.
- Auto-lock after 30 s idle, and immediately when the app is hidden/backgrounded. Keys live only in memory.
- Entries: four-digit code (0001, 0002, …, stable; assigned on create, filled in for old entries), coded name, optional http(s) link with Open button, username, password, notes. Search matches code, name, link, user, notes. Password generator.
- New entries always open with blank username/password (autocomplete off, no sample data).
- Per-entry shortcut link: `<site>/#0001` jumps to that entry after unlock.
- Encrypted export/import backup with its own passphrase (PBKDF2 600k + AES-GCM). Backs up the vault that's open.
- Dark mode. IndexedDB only; CSP blocks all network except same-origin. Service worker only caches app files.

## Limits (honest)
- Clipboard clear after 15 s is best effort: iOS only lets a page write the clipboard while it's open; if Decoy is backgrounded/locked first, the copied value stays until overwritten.
- No Keychain / Secure Enclave access from the web. Security rests on the PIN's PBKDF2 cost; a 6-digit PIN is brute-forceable offline by someone who copies the device's site data. The lockout only stops guessing through the app.
- Clearing Safari website data deletes the vault. Keep backups.

## Install on iPhone / Android
Host over HTTPS. iPhone: open in Safari, Share → Add to Home Screen. Android: Chrome ⋮ → Add to Home screen. The PIN screen shows this tip when not installed.
Per-entry shortcuts (`#0001`) work when opened as a link; iOS may open the installed icon at the app's start page instead.

## Tests
`npm test` (Node 20+, uses built-in WebCrypto): crypto round trip at 600k, fixed sizes, tamper detection, decoy separation, random slot placement, lockout schedule, generator, backup.
