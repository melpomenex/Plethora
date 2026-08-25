# memory-bench — memory benchmark harness (collector half)

Deterministic memory measurement for the Plethora desktop app on **Linux and
macOS**. See `docs/memory-profile.md` for how memory is measured and why
PSS (Linux) / physical footprint (macOS), and the change
`openspec/changes/bound-runtime-memory-and-gate/` for the original harness,
`openspec/changes/eliminate-long-running-memory-growth/` for the macOS
collector, soak tiers, and TTS/edition stages.

## Layout

| Module | Purpose |
|---|---|
| `smaps-rollup.js` | Strict parser for `/proc/<pid>/smaps_rollup` (Linux). Fields: `Pss`, `Pss_Anon`, `Pss_File`, `Pss_Shmem`, `Private_Dirty`, `Rss`, `Swap`. Unknown/absent fields are `null`, never `0`; malformed input yields an attributed error. |
| `discovery.js` | Linux process discovery rooted at the launched PID: relationship by process group **and** ancestor chain, verified by the `PLETHORA_MEMORY_RUN_ID` marker in `/proc/<pid>/environ`. Role classification: `native`, `web-content`, `network`, `other`. |
| `sample.js` | Per-process sampling (an exited process is recorded absent with a reason, never a failure) and tree aggregation (total sums proportional fields only, never `Rss`; `treeHeadlineBytes` picks the platform headline). |
| `macos-footprint.js` | macOS collector: invokes the native helper, re-verifies ancestry, records per-process `markerVerified`, normalizes into the shared sample shape (`Pss` carries `ri_phys_footprint`; `Rss` populated, never summed). |
| `native/macos-footprint/` | Standalone cargo helper (libproc/`proc_pid_rusage` FFI; **never linked into the app**). Built on demand by the driver on darwin (`cargo build --release`). |
| `platform.js` | Platform gate: Linux needs a readable `smaps_rollup`; darwin needs the built helper; anything else refuses with the plug-in point named. |
| `scenario.js` | Fixed stage sequence: idle → tabs → close → open/close cycles → TTS cycles → edition cycles → optional idle soak → final idle. |
| `capture-tree.sh` | **Manual incident capture** (not a collector): `ps`/`vmmap`/`leaks`/`sample` for the whole tree, timestamped. First thing to run if the ~74 GB class incident recurs. |
| `fixtures/` | Rollup fixture files used by the unit tests. |

Unit tests live in `scripts/__tests__/memoryBench*.test.mjs` and run under
`npm run test:scripts` (`node --test`).

## Running

```bash
npm run bench:memory                        # reader scenario (Linux or macOS)
npm run bench:memory -- --soak=quick        # + idle-soak stage (see tiers)
npm run bench:memory -- --tts-cycles 24 --edition-cycles 12
node scripts/check-memory-budget.mjs        # compare against committed baselines
```

### Idle-soak tiers (task 4.2)

| Tier | Duration | Sample interval | Use |
|---|---|---|---|
| `quick` | 5 min | 30 s | pre-merge / local iteration |
| `dev` | 30 min | 30 s | feature development |
| `nightly` | 4 h | 60 s | unattended nightly on the Mac mini |
| `extended` | 10–12 h (11 h) | 120 s | reproducing the overnight incident class |

**Operating procedure — Mac mini unattended soaks:** start the run in
`tmux`/`nohup` against the build under test
(`node scripts/memory-bench/driver.js --soak=nightly --output .bench/<name>.json
> .bench/<name>.log 2>&1 &`). The result file records a per-sample,
per-process series (keyed by elapsed seconds) so a failed overnight run is
attributable the next morning: which process, which role, growth shape
(linear vs stepped), and when it started. If a run fails, also capture
`bash scripts/memory-bench/capture-tree.sh` artifacts while the app is still
up. The harness host logs through the native logger, so JS-side causes
appear in the captured log.

### Scenario stages beyond the reader cycles (task 4.1)

- `tts-cycles/<n>` — one synthesize → play → stop → dispose cycle per phase,
  alternating **cache-miss** (salted text; synthesis + persistent-cache put)
  and **cache-hit** (fixed text; persistent-cache get + Blob/URL mint)
  variants. Defaults: 12 cycles, ~2 000 chars each from the `long-text-1`
  corpus fixture. No network: the scenario-only `scenario-synth` provider
  synthesizes deterministic byte patterns.
- `edition-cycles/<n>` — create edition (K sections, default 4) → generate →
  cancel mid-run → retry → delete, through the same store actions the UI
  uses. Defaults: 6 cycles.
- `idle-soak/<elapsedSec>` — periodic samples, above.

### Gate self-test (design D11)

```bash
node scripts/memory-bench/driver.js --synthetic-leak-mb 1 ...   # retain 1 MB per cycle step
```

must FAIL the ratchet/slope metrics while every peak metric stays under its
ceiling — proving the slope gate, not the ceiling, catches leaks.

## Design invariants

- A process is counted only when it belongs to the launched instance — by
  marker (Linux) or by ancestry from the driver-launched root (macOS); a
  foreign WebKit process with a matching name is never counted.
- A field that cannot be parsed is **absent**, never defaulted to zero.
- The tree total is a PSS-family sum on Linux and a physical-footprint sum on
  macOS; summing RSS would double-count shared text on either platform.
- Baselines are machine-profile-scoped (`platformKind` discriminator); the
  comparator refuses cross-platform comparisons (exit 2).
