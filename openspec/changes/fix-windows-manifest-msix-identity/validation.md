# Validation — fix-windows-manifest-msix-identity

Evidence gathered on a Linux workstation (no Windows host available). Everything that can be
decided without the Windows loader is verified below; the loader-level acceptance is the
Windows checklist at the end.

## What is verified here

| # | Claim | Evidence |
| --- | --- | --- |
| 1 | `app.manifest` declares the childless attribute form and its values match the identity package | `python3` XML assertions: `<assemblyIdentity>` is the first child of `<assembly>`, `<msix>` is in `urn:schemas-microsoft-com:msix.v1`, has **no** children, all three attributes non-empty, and `packageName`/`publisher`/`applicationId` equal `Identity/@Name`, `Identity/@Publisher`, `Applications/Application/@Id` of `src-tauri/windows/sparse/Package.appxmanifest` |
| 2 | Version drift is detected and regenerated from one source | Before: `node scripts/sync-windows-identity.mjs` → exit 1 naming `app.manifest`, `sparse/Package.appxmanifest`, `msix/Package.appxmanifest` with declared `2.7.0.0` vs expected `3.3.0.0`. After `--write`: exit 0 ("in sync (version 3.3.0.0)") |
| 3 | Drift rules are covered by tests | `node --test scripts/__tests__/sync-windows-identity.test.mjs` → 9/9 pass, including the pre-fix child-element manifest (rejected), a missing attribute, a wrong namespace, an identity mismatch, and write-mode regeneration |
| 4 | `npm run test:scripts` still passes | 233 passed / 3 failed — the 3 failures are pre-existing and unrelated (`applyIosProjectOverrides`, marketing screenshot freshness, `memoryBenchMacOs` RAM assertion; the last fails standalone) |
| 5 | Both Windows packaging scripts refuse a stale identity version | PowerShell 7.4.6, fixture trees: synced manifest → `Identity package version asserted: 3.3.0.0` / `MSIX package version asserted: 3.3.0.0`; drifted manifest (`2.7.0.0`) → exit 1, naming file, declared and expected version plus the fix command |
| 6 | The release workflow fails on identity drift | `node scripts/sync-windows-identity.mjs` after a deliberate `3.3.0` → `3.3.1` bump → exit 1 (all three files named); exit 0 after restoring. Workflow YAML parses and the step sits between "Install Windows App SDK" and "Build Windows sparse identity package", i.e. before both the identity package and the binaries are produced |
| 7 | The NSIS hooks compile and carry the intended command lines | `makensis 3.12` compiles `src-tauri/windows/installer-hooks.nsh` inside a harness; `-V4` output shows `ExecWait: "powershell.exe … -File "$INSTDIR\register-sparse-identity.ps1" -InstallDir "$INSTDIR" -Msix "$INSTDIR\PlethoraIdentity.msix""`, `IfFileExists … ? 0 : plethora_identity_uninstall_fallback`, and the no-`$` fallback removal command. Control runs: an `!insertmacro` typo and a missing `!macroend` both fail the compile, so the harness has teeth |
| 8 | Installer registration policy behaves as designed | `register-sparse-identity.ps1` under PowerShell 7.4.6: missing package → exit 10 ("identity package not found"); unsigned package → exit 10 ("no `AppxSignature.p7x`"); undecodable signature → exit 10; manifest values parsed correctly (`Name=Plethora.Plethora Publisher=CN=Plethora Sparse Dev Version=3.3.0.0 ApplicationId=Plethora`); every outcome logged to `identity-registration.log`; the log states that no certificate store was modified |
| 9 | Uninstall removes the registration and tolerates its absence | With stub package-manager cmdlets: package present → `Remove-AppxPackage` called with the registered full name, exit 0; nothing registered → "no package identity was registered for this user", exit 0, no removal call |
| 10 | Registration is idempotent across upgrades | Anchored test-time substitution of the two gates, stub cmdlets, seven scenarios: not registered → add only; same version + same location → no-op; older version → remove + add; same version at a different location → remove + add; foreign publisher → untouched, add; `0x80073CF9` → treated as success; other failure → exit 20 with the **Windows** error code (`registration failed (0x80004005)`) rather than the .NET wrapper HResult |
| 11 | Runtime repair uses the documented command surface and classifies results | `cargo test --lib` in `plugins/plethora-windows-intelligence` → 13 passed (11 new, all platform-independent): command literals survive spaces and non-ASCII (`C:\Program Files\Plethora 学習`), a `'` in a path cannot break out of the literal, the command is one `-Command` argument, success/`0x80073CF9`/untrusted-root/failure classification, error-code extraction is `char`-safe (a byte-index version panicked on the zh-CN message from the report), and the diagnostics payload shape |
| 12 | That code compiles for Windows | `cargo check --target x86_64-pc-windows-msvc` → finished; only pre-existing dead-code warnings for non-Windows stubs |
| 13 | The release gate catches the exact defect class | `scripts/verify-windows-manifests.ps1 -SelfTest` → "child-element defect rejected, identity mismatch rejected, fixed manifest accepted, identity package read correctly". End-to-end with a stub `mt.exe` and fixture bundles: corrected manifest → exit 0; the **3.3.0 manifest** → exit 1 naming `publisherIdentity, packageIdentity` and the launch consequence; identity mismatch → exit 1 naming field and values; surviving GUI process → PASS; `pdf-reflow-diag.exe` usage output → PASS; diagnostic binary without usage output → exit 1 |
| 14 | The gate is wired into the release verification | `scripts/verify-windows-bundles.ps1` parses and calls it from `Assert-RequiredSidecars` (line 128) with the extracted bundle root and the identity package it already locates |
| 15 | Documentation reflects the new behaviour | Trouble‑shooting entries added to `docs/USER_HANDBOOK.md` (source of truth) plus the maintained `de`/`es` editions: failure happens before application code, `SideBySide` event 62 evidence, cause, "VC++ Redistributable cannot fix this", `mt.exe` extraction command. `docs/architecture/native-ai.md` rewritten for installer-time registration, the repair path, and the manifest form. `scripts/release-notes.md` carries the hotfix notes (manual reinstall + interim manifest patch) |
| 16 | No stale identity version remains in build inputs | `grep -rn 2.7.0.0` → one live leftover found and fixed (`scripts/build-windows-msix-package.ps1 -Version = "2.7.0.0"`, now asserted against `tauri.conf.json`). Remaining hits are historical comments, the deliberate pre‑fix test fixtures, and this change's own planning documents |
| 17 | The new diagnostics type is valid TypeScript | `npx tsc --noEmit --strict … src/lib/ai/windows/types.ts` → exit 0. (Repo-wide `tsc --noEmit` fails on a pre-existing missing-file reference, `src/utils/__tests__/tokenizer.test.ts`, unrelated to this change) |

## Verified on Windows only (still outstanding)

These cannot be exercised without the Windows loader and a real installer, and remain unchecked in
`tasks.md`: **1.2, 1.3, 3.3** (install/upgrade run), **3.4** (`tauri build` producing the hooks),
**3.5, 3.6, 4.3, 5.4, 7.1–7.4**.

The two that decide the change's acceptance:

1. **7.1 / 7.3 — launch with no identity package registered.** Task 1.1 removes the schema violation,
   which is what the loader rejected. If a *valid* `<msix>` element whose package is not registered also
   aborts the launch on the tested build, apply the fallback recorded in `design.md` (D1 risk): ship the
   identity element only in builds whose installer registration is guaranteed. The corrected element was
   not verified against a real loader here — no Windows host was available.
2. **3.5 — the trust gate.** Confirm the registered/unregistered outcomes with a manually trusted
   certificate and with an untrusted one, and confirm no certificate store is touched in either case.

Also outstanding by design (not a task): a production signing decision for `PlethoraIdentity.msix`.
Until a certificate the user's machine already trusts signs it, the installer correctly skips
registration and identity-dependent Windows AI features stay off.
