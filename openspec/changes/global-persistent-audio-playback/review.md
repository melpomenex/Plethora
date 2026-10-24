# Adversarial proposal review

Performed as a skeptical self-review after writing proposal, design, specs and tasks. This is not an independent code review or an implementation test result.

| Challenge | Resolved contract / acceptance evidence required |
| --- | --- |
| Could route changes terminate playback? | Main-window owner is above Routes and adaptive wrapper branches; source views are subscriptions. Close, resident eviction, scroll-item replacement and responsive reparenting tests are mandatory (design 1; tasks 2.6, 5.3–5.5, 7.1). |
| Could two engines play? | Registry replacement is explicitly insufficient; takeover waits for pause acknowledgment, revokes old generations and rejects start on pause failure. Android selects native decoding with no HTML peer; TTS/video/capture acquire exclusive lease (design 2,4; tasks 2.4,4.2,5.1). |
| Could mini-player state diverge from native playback? | Native state is authoritative; frontend subscribes before full snapshot/reconnect, rejects stale revisions, imports native journal before hydration. Applied transport receipts never execute again (design 2,5,6; tasks 4.3–4.4). |
| Could Android backgrounding kill playback? | Existing forwarding player is replaced for ordinary media by service-owned ExoPlayer, native queue/seek/focus/timer/journal, valid FGS and playback-scoped wake ownership. No claim of survival after force-stop or process kill. Physical background matrix is P0 (design 5; task 7.3). |
| Could old media resume after focus changes? | Generation/lease revocation, user-pause revision and explicit pause reasons gate gain. TTS finish/unmount, headphone reconnect and cold restart never implicitly resume prior media (design 4,6; tasks 5.1–5.2). |
| Could persistence cause write storms? | One five-second changed-position schedule, lifecycle flush coalescing and one in-flight + latest record; unchanged pause has no writes. Native journal is bounded and acknowledged only after DB commit; test transaction counts (design 6,9; tasks 3.2,4.3). |
| Could reading progress be overwritten by audio? | Text-linked Audio Edition positions never write document CFI/page/scroll/reading percentage. Promoted podcast maps episode to actual document and commits episode/document/outbox atomically; live engines ignore remote merge seek (design 6; tasks 3.3–3.5). |
| Could the mini player obscure annotations/review? | Dock reserves measured space, bottom geometry includes audio/nav/assistant, safe area once, overlay tokens/focus/Back reused; keyboard/fullscreen/zoom/reader anchor fixtures required (design 7; tasks 6.1–6.4). |
| Could ticks make scrolling lag? | Selector projection <=2Hz, compact <=1Hz, unrelated roots never subscribe to position; expanded UI lazy; no visualizer/RAF/whole-file Blob. Runtime profiling plus local bench/bundle/memory gates specified (design 9; task 7.2). |
| Could Linux rendering regress? | Static opaque surfaces, no native transparency/config change, no backdrop blur and no source reconstruction; packaged Wayland/X11 paint/GPU comparison. Pre-existing Linux config stays untouched (design 7,9; tasks 7.2,8.6). |
| Could chapters, bookmarks, DSP, TTS or study break? | Original source/global coordinates and existing stores/components reused; separate chapter/queue/relative seek; TTS paid consent/cancellation retained; native study capture provenance and DSP/anchor parity are required before affected rollout (design 3–7; tasks 5,6.3,8). |
| Could desktop OS integration be assumed complete? | Windows HWND gap and souvlaki silence lifetime documented; explicit native desktop lifecycle observer work and hardware matrix. Linux D-Bus control is distinct from rendering compositor; platform failures do not claim success (design 5; tasks 5.7,8.5–8.6). |
| Could a fresh implementer still choose the major architecture? | Authority per platform, paths/contracts, message identity/order, migration/restore precedence, UI composition, priority dependencies and per-task verification are specified. Runtime codec/OEM/DSP acceptance remains verification work, not an undecided architectural alternative. |

## Gaps corrected during review

- Explicit native Play/Pause must not reuse the existing toggle-only callback; proposed RemoteMediaContext and dispatcher changes are called out.
- Native standard commands need durable applied receipts and request-ID dedupe; replaying them from existing pending queue would double-seek.
- A browser facade needs browser-backend checkpoint handlers, not an assumption of Tauri SQLite.
- Service background decoding needs playback-scoped wake ownership, not just a MediaSession notification.
- Desktop lifecycle/suspend handling needs explicit native observers; souvlaki is not an audio-focus or power-observer API.
- Promoted podcast SQL and document progress need one transaction; Promise.all of current calls is not atomic.
- Permission comments are not normative Android rules: media-session notification exemptions are recorded and denial/allow tests remain mandatory.
- Existing canonical podcast spec used a delta-only header and had no Purpose, which would block later archive. Only title/Purpose/Requirements structure was normalized; all existing requirement/scenario bodies remain byte-for-byte unchanged. Future behavior exists only in this change's deltas.

## Executed proposal validation

On 2026-10-23:

- `openspec status --change global-persistent-audio-playback`: 4/4 planning artifacts complete (proposal, specs, design, tasks).
- `openspec validate global-persistent-audio-playback --type change --strict --no-interactive --json`: PASS, `valid: true`, zero issues after canonical formatting correction.
- `openspec validate podcast-position-persistence --type spec --strict --no-interactive --json`: PASS, zero issues.
- Artifact existence/nonempty check and requirement/scenario structure check: PASS; six spec files, 45 unchecked implementation tasks, every requirement includes WHEN/THEN acceptance scenarios.
- Canonical podcast requirement-body preservation check against `git show HEAD:openspec/specs/podcast-position-persistence/spec.md`: PASS.
- `git diff --check`: PASS; untracked change-artifact whitespace/existence checks also required in final verification.

Application unit tests, native builds, physical-device tests and performance benchmarks were **not run** because this task is proposal-only. Their commands, thresholds, fixtures and evidence requirements are in validation.md. No application code was implemented, no apply workflow ran, no commit/push/release occurred, and unrelated pre-existing changes were preserved.

## Implementation handoff

Change: `global-persistent-audio-playback` in `openspec/changes/global-persistent-audio-playback/`.

Start `/opsx:apply global-persistent-audio-playback` in a new authorized implementation session. Read audit.md first, then design.md/specs/validation.md, and work through tasks.md in dependency order. P0 core/native Android acceptance precedes P1 parity and desktop refinement; both are required before relevant production rollout. P2 is separate future work, with no current apply checkboxes. Do not interpret planning completion as implementation completion.
