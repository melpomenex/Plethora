# AI Learning release qualification

This directory holds the reproducible protocol, the intended support matrix
and the evidence record for the AI Learning completion program. It is a
qualification workspace, **not** a claim that any platform has passed.

Current state: no physical device, native model execution, real provider run
or measured device resource gate has been recorded. Every advertised matrix
cell remains **pending** until evidence exists at the required execution layer.
Mock integration, simulator and emulator results are recorded as such and never
resolve a physical-device or desktop-real-provider requirement.

## Documents

- `device-protocol.md` — the ten-step reproduction protocol, matrix and release
  blockers.
- `release-blockers.md` — the current blocker table with owners, reproducers
  and closure evidence.
- `evidence/manifest.json` — the machine-checked evidence manifest. It starts
  with zero records and `PENDING` identities.
- `../../src/test/aiLearning/fixtures.ts` — the synthetic fixture corpus.
- `../../src/test/aiLearning/evidence.ts` — evidence validation rules.

## Validate

```sh
node scripts/ai-learning-evidence.mjs
# or
npm run ai:evidence:validate
```

The validator rejects a passing record unless it matches the manifest's release
commit and capability revision, covers every required stage for its feature,
declares a reproduction command/host/owner and a redacted evidence path, and
uses an execution layer that actually satisfies the cell's requirement.

## Recording new evidence

1. Run the protocol step that produces the evidence; keep raw machine details
   local and redacted diagnostics in the repository.
2. Append one record per feature/platform/layer to
   `evidence/manifest.json`.
3. Set the manifest `releaseCommit` and `capabilityRevision` to the values
   printed by the build. Any routing, schema, persistence or lifecycle change
   invalidates impacted records: bump the revision and rerun them.
4. Run the validator. A `pass` record with a stale revision, missing stage or
   lower execution layer will be rejected.

The support claim in `docs/IMPLEMENTATION_STATUS.md` follows this manifest, not
the other way around.
