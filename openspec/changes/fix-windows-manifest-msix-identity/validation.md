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

## Windows runner evidence (run 39222548979, commit 608c046)

The Windows test build ran on a real `windows-latest` runner. Everything passed except the first
version of the manifest gate, which failed on its own `mt.exe` invocation — the build itself, the
identity package and the installer were all produced and uploaded:

| Step | Result |
| --- | --- |
| `Assert Windows identity metadata is in sync` | success (version sync gate works in CI) |
| `Build Windows sparse identity package` | success — `PlethoraIdentity.msix` built with `Identity/@Version="3.3.0.0"`, `AppxSignature.p7x` present |
| `Export identity certificate (public half)` | success — `CN=Plethora Sparse Dev`, self-signed (VM trust step available) |
| `Build Tauri application (Windows, NSIS)` | success — `Plethora_3.3.0_x64-setup.exe` (239 MB) |
| `Assert installer hooks were wired in` | success — generated `installer.nsi` line 28 includes `installer-hooks.nsh`, lines 4774/4819 insert the POSTINSTALL/PREUNINSTALL macros, lines 4681-4682 pack `register-sparse-identity.ps1` and `PlethoraIdentity.msix` |
| `Verify the manifest gate itself (self-test)` | success |
| `Verify Windows bundles` | **failure**: the gate's `mt.exe -inputresource:…;#1` call extracted nothing, and the script discarded mt's error text |

**Root cause and fix (verified here on Linux, on the artifact from that run):** the embedded
manifests were fine — `llvm-readobj --coff-resources` shows `RT_MANIFEST` ID 1 in both executables,
and reading the resource directly returns the corrected childless `<msix>` element with
`assemblyIdentity version="3.3.0.0"`. The gate now reads the PE resource itself
(`Get-EmbeddedManifestXml`, pure .NET; two bugs found and fixed while testing it against these real
binaries: resource-directory RVAs were being used as file offsets, and the resource data carries
padding that `[xml]` rejects until trimmed). `mt.exe` is now a supplementary schema check whose
output and exit code are reported instead of swallowed, and its absence no longer fails the gate.

Running the fixed gate against the executables extracted from that installer, with the shipped
`PlethoraIdentity.msix` and registration helper, reports `identity OK` for both and
`Windows manifest verification passed.`

## Second runner iteration (run 39242443549, v3.4.0 build)

The gate now reads manifests itself, and on the Windows runner it reported:

- `identity OK` for `plethora-tauri.exe` **and** `pdf-reflow-diag.exe`, against the packaged
  `PlethoraIdentity.msix` (identity version `3.4.0.0`).
- **`plethora-tauri.exe stayed alive for 5s and logged no SideBySide error (PASS)`** — on a real
  Windows loader, with no identity package registered, the executable starts.
- `pdf-reflow-diag.exe printed its usage output and exited 2 (PASS: application code ran)`.
- `Windows manifest verification passed.` and `Windows bundle verification passed.`
- The supplementary `mt.exe` read failed with `c101008c: An illegal character was encountered` for
  both executables — the same reason it produced nothing in the first iteration. mt.exe cannot read
  these resource payloads; the direct PE reader can, which is why the gate no longer depends on it.

The step still exited non-zero: GitHub's `shell: pwsh` handler ends a step script with
`exit $LASTEXITCODE`, and the failed supplementary mt.exe left 31 there — after both scripts had
printed success. Reproduced and fixed locally:

| Check | Result |
| --- | --- |
| Pre-fix gate + runner exit rule (control) | exit **31** (the CI failure) |
| Fixed gate + same rule | exit **0** |
| Identity mismatch in the packaged .msix (real failure) | exit **1**, naming field, declared and expected value |
| Non-PE executable (fake bundle) | exit **1**, "is not a PE file (no MZ signature)" |
| `-SelfTest` | passes |

Both verifier scripts now reset `$LASTEXITCODE` after a passing run, so a supplementary tool can
never decide a step's result — while genuine verification failures still fail loudly.

## Green runner result and the v3.4.0 release

- **Windows test build `39262746798` (972d24d) — completed / success.** All 23 steps passed,
  including `Verify Windows bundles (sidecars + embedded manifest + smoke launch)`; the artifact
  `plethora-windows-test-972d24d…` (239 MB) carries `Plethora_3.4.0_x64-setup.exe`, the identity
  package (`Identity/@Version` 3.4.0.0, signed), `plethora-identity-dev.cer` and the generated
  `installer.nsi`.
- The first v3.4.0 release leg failed at the same verification step (it was built before the
  exit-code fix) and its upload was skipped, so the release had no Windows installer. Its documented
  backfill path was used: `release.yml` with `version_tag=v3.4.0`, `build_ref=main`,
  `windows_only=true` → **run `39281944700`, completed / success**, verification passed and
  `Upload Windows bundles` ran. The release now carries `Plethora_3.4.0_x64-setup.exe`
  (239,307,599 bytes) and its `.sig`, and `latest.json` lists `windows-x86_64` at version 3.4.0.

Tasks 3.4 and 5.4 are closed by this evidence. What still needs a Windows VM: 3.3, 3.5, 3.6, 4.3 and
7.1–7.4 (the loader launch on a clean image with a visible window, install/upgrade/uninstall of the
identity registration, the two trust outcomes, and the end-to-end repair).
