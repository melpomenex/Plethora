# Focused provider validation

The scope is one optional TTS provider. The original hardware/architecture
qualification program is historical under `evidence/initial-scope/` and is not a
prerequisite for this change. Existing application checks still apply.

## Native smoke

Use the pinned complete pair and runtime. On available development hardware,
confirm real nonempty 24 kHz WAV speech for female/male and en-US/en-GB mapping,
repeated calls with warm weights and clean utterance state. Verify backend and
offload rather than assuming GPU execution. Record timing/memory as observations,
not universal support tiers. Test cancellation/kill/reap and capped-output failure.
No 30-minute benchmark, named-device certification or M4/RTX matrix is required
before integrating the provider. Keep untested platform claims explicit.

## Deterministic tests without weight downloads

- Provider registration/capabilities, model/voice/locale mapping, no cloud fallback.
- Existing settings/default/migration behavior and stable Settings search coverage.
- Full HF file contract, hashes/containment, wrong/missing projector, partial install
  refusal and safe in-use model removal.
- Native protocol framing/bounds, serialized work, model reuse, cancelled/stale
  output rejection, stuck child termination/reaping and unload.
- Existing cache reuse plus LFM3 identity separation and per-consumer cancellation.
- Existing reader start/stop controls, preview and Audio Edition WAV dispatch.

## Local gates

Run affected native/Vitest suites, applicable type/lint/build checks, Settings
search gates, `npm run test:scripts` and `npm run bench:check`. Record genuine
pre-existing failures; do not suppress tests or weaken performance/bundle
baselines to make a run pass. Package/build checks follow normal desktop targets,
not a developer-device allowlist. Do not claim physical platform execution from
source compilation alone.

## Product acceptance

A user can choose LFM3 in existing TTS settings, see runtime/model requirements,
download the optional model with license information, choose a voice/language,
preview it, and use ordinary read-aloud controls. Available acceleration is
selected automatically; compatible CPU execution remains available. Missing
native targets show an honest unavailable state and existing providers remain
usable. No new audio-owner/cache/edition-job subsystem is required.

Model/runtime notices and applicable commercial rights remain release obligations.
The user reports clearance; attach its scope when provided. This task does not
publish a commercial app release.
