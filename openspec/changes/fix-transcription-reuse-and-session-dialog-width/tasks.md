## 1. Reproduce the transcript store disconnect

- [x] 1.1 Add a backend fixture containing a podcast episode linked by document metadata, an empty episode transcript, and a completed document/chapter transcript with segment and word timings; verify the episode-only lookup sees no text while the fixed resolver returns the saved transcript.
- [x] 1.2 Extend `src/components/viewer/__tests__/AudiobookViewer.test.tsx` with the queue-completed podcast navigation case; verify the former lookup-failure path could trigger transcription, and retain saved-result and provider-call assertions for the fix.

## 2. Resolve durable transcripts across media identities

- [x] 2.1 Add repository-backed episode/document transcript resolution using the persisted episode link and deterministic completed-source precedence; verify backend tests cover exact identity isolation, queue chapter IDs, multiple saved rows, complete-over-partial precedence, and existing episode transcripts.
- [x] 2.2 Wire `get_podcast_transcript` to the shared resolution boundary and minimally extend the API state contract if needed; verify document-only results reach callers with original text, segment order, millisecond-to-second conversion, and word timings, while legacy text-only results remain readable.
- [x] 2.3 Resolve saved results independently of finished queue history and frontend caches; verify backend tests reload the fixture through a fresh repository connection after queue-row deletion and still return the same transcript.
- [x] 2.4 Preserve persistence-before-completion and expose active/inconsistent state for the resolved item; verify queue completion can be followed immediately by a fresh successful read and injected persistence errors propagate before successful completion.

## 3. Make viewer loading and auto-start agree

- [x] 3.1 Replace implicit loaded/empty handling with identity-scoped loading, ready, missing, active-job, and error outcomes; verify delayed and failed lookups never invoke providers, usable saved results do not require model availability, and navigation ignores stale responses.
- [x] 3.2 Observe linked queue jobs from podcast views and refresh persisted results on completion; verify opening during pending/processing attaches to existing progress and completion during initial lookup makes the transcript visible without duplicate work.
- [x] 3.3 Serialize automatic starts across rerenders and remounts using shared/backend job guards, with a final active/completed check at the start boundary; verify confirmed absence starts once, a completion race starts no redundant job, and existing provider-routing tests still pass.
- [x] 3.4 Show recoverable lookup/inconsistent-data errors through existing viewer affordances and retain explicit retry behavior; verify errors never become automatic retranscription loops and ordinary audiobook chapter recovery still passes.

## 4. Restore Customize Session desktop bounds

- [x] 4.1 Give adaptive surfaces ownership of width without the shared `w-full` cascade conflict, preserving non-adaptive dialog behavior; verify primitive tests or browser geometry cover default desktop bounds, caller-specific sizing, and unchanged compact sheet sizing.
- [x] 4.2 Restore Customize Session's 42rem maximum on desktop dialog presentations while retaining portal, focus, layer, viewport, and footer behavior; verify session customization tests preserve apply/cancel/reset, save-new/update-queue, ranking controls, Escape dismissal, and focus restoration.
- [x] 4.3 Extend the existing session-customize browser harness with many long tags, a long active queue name, and Save-as state; verify at 1440px and a wider desktop viewport that the panel is at most 42rem wide, centered within a small pixel tolerance, free of horizontal overflow, and scrollable with header/footer visible.

- [x] 4.4 Retain and extend phone/tablet checks for navigation interception, footer hit targets, safe areas, keyboard-reduced viewport, resize, and effective zoomed viewport bounds; verify the queue component and command-palette destination routing and capture a desktop/compact screenshot pair with the real application CSS.

## 5. Integration and repository gates

- [x] 5.1 Run focused backend transcript/repository tests, the viewer and session modal Vitest suites, affected adaptive tests, and `npm run test:visual -- src/visual/session-customize.visual.spec.ts`; verify all changed behavior passes and record any unrelated existing failures separately.
- [x] 5.2 Exercise document/episode lookups, viewer navigation, restart, and finished-row cleanup using saved-transcript fixtures; verify the transcript stays readable and provider invocation/job creation counts do not increase merely from navigation.
- [x] 5.3 Run the repository's required lint/type/build checks for the implementation and `npm run bench:check`; record the failing performance gate alongside an unchanged-HEAD comparison in validation.md, and leave performance/bundle baselines unchanged.
- [x] 5.4 Run `openspec validate fix-transcription-reuse-and-session-dialog-width --strict` and reconcile overlapping mobile-layering artifacts if they changed during implementation; verify both delta specs remain satisfied and capture final implementation/test evidence.
