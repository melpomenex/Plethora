# Plethora updater key rotation (rebrand task 3.8)

The Tauri updater chain now targets the **Plethora** repository and signs
artifacts with a **new minisign keypair**. This note records what was done,
the known transitional limitation, and the operational steps the release
owner must complete before the first Plethora release.

## What changed

- `src-tauri/tauri.conf.json`
  - `plugins.updater.endpoints[0]` →
    `https://github.com/melpomenex/Plethora/releases/latest/download/latest.json`
  - `plugins.updater.pubkey` → the new Plethora public key (below).
- `src/utils/updateChecker.ts` — the in-app "new version available" checker
  reads `api.github.com/repos/melpomenex/Plethora`.
- `scripts/release.cjs` — the Cargo.lock bump regex is anchored on the new
  crate name `plethora-tauri` (the old anchor silently no-opped after the
  crate rename).
- `scripts/release-downloads.sh` — OWNER/REPO docs/defaults → Plethora.
- `scripts/verify-update-artifact.mjs` / `verify-release-updates.mjs` — doc
  examples updated; the tools themselves read artifact names from
  `latest.json`, so they needed no functional change.

## The new keypair

Generated with `minisign` (installed at `/opt/homebrew/bin/minisign`):

```
minisign -G -W \
  -p src-tauri/keys/plethora-updater.pub \
  -s src-tauri/keys/plethora-updater.key
```

- `src-tauri/keys/` is **gitignored**; the secret key is never committed.
- Public key (base64 of the whole `.pub` file, as Tauri expects) is wired
  into `tauri.conf.json`:
  `dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXkgRjFGMjQ0MEJFNUMwRTlDNQpSV1RGNmNEbEMwVHk4V3ppZVJhcmROYlJIZ09Gc1ExK05WTGZIRXBuV1BCTjdtcmFZTjV4QTJERwo=`

## ⚠ Before the first real Plethora release (owner checklist)

1. **Regenerate the key with a password.** The locally generated key uses
   `-W` (no password) so it could be produced non-interactively. Before
   signing anything public, rotate it:
   `minisign -C -s src-tauri/keys/plethora-updater.key` (sets a password),
   re-encode the `.pub` with `base64`, and update `tauri.conf.json`.
   Alternatively generate a fresh pair on dedicated media.
2. **Upload the secrets to the Plethora repo** (already referenced by
   `.github/workflows/release.yml`):
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of the secret key file
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the key's password (empty if
     the `-W` key is kept, which is discouraged)
3. Run `scripts/verify-release-updates.mjs --repo melpomenex/Plethora
   --tag v<X.Y.Z>` after the first release publishes.

## Transitional limitation (D29)

`tauri.conf.json` accepts exactly **one** updater public key; there is no
key-list fallback. Consequences:

- Existing Incrementum installs verify updates against the **old** pubkey.
  The last Incrementum-branded release (signed with the old key) is the final
  one those installs can auto-update to — that release's only job is the
  in-app notice directing users to download Plethora manually (see
  `docs/legacy/final-incrementum-notice.md`).
- Plethora builds carry the new key from the first release; there is no
  window where both keys are accepted, by design of the updater plugin.
