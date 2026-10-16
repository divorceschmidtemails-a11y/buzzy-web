# Decoy (web)

Installable offline PWA version of Decoy. Plain HTML/CSS/JS, no build step. Spec: the native `decoy` repo.

## Features
- 6-digit real PIN + a different decoy PIN that opens an identical-looking fake vault.
- Two encrypted blobs, each exactly 256 KiB, real one in a random slot, nothing stored says which is real. Unlock tries both every time.
- Key: PBKDF2-SHA256, 600,000 iterations, random 16-byte salt per blob → AES-256-GCM, random 12-byte IV per save. Plaintext padded with random bytes to fixed size. Vault cap ≈ 256 KiB of JSON.
- Lockout: 4 free wrong tries, then 1, 5, 15, 60 min (60 repeats). Counter stored in IndexedDB, survives reloads.
- Auto-lock after 30 s idle, and immediately when the app is hidden/backgrounded. Keys live only in memory.
- Entries: coded name, username, password, notes. Search, password generator.
- Encrypted export/import backup with its own passphrase (PBKDF2 600k + AES-GCM). Backs up the vault that's open.
- Dark mode. IndexedDB only; CSP blocks all network except same-origin. Service worker only caches app files.

## Limits (honest)
- Clipboard clear after 15 s is best effort: iOS only lets a page write the clipboard while it's open; if Decoy is backgrounded/locked first, the copied value stays until overwritten.
- No Keychain / Secure Enclave access from the web. Security rests on the PIN's PBKDF2 cost; a 6-digit PIN is brute-forceable offline by someone who copies the device's site data. The lockout only stops guessing through the app.
- Clearing Safari website data deletes the vault. Keep backups.

## Install on iPhone
Host over HTTPS, open in Safari, Share → Add to Home Screen.

## Tests
`npm test` (Node 20+, uses built-in WebCrypto): crypto round trip at 600k, fixed sizes, tamper detection, decoy separation, random slot placement, lockout schedule, generator, backup.
