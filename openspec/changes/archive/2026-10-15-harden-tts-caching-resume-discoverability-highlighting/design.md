# Design: Harden TTS Caching, Resume, Discoverability, Highlighting

## 1. Context & Constraints

Document-reader TTS today (`ReaderTTSControls` + `ReaderSpeechIndex` + `ttsCache` + `WordHighlighter`/`WordHighlightLayer` + provider registry with 10 adapters, file list in proposal) is feature-complete but insufficiently durable, not resumable across sessions, invisible when disabled, and default-off for existing users. This design hardens exactly those four surfaces while preserving every working subsystem (epub.js, PDF.js, selection state machine, audio cache architecture, anchored speech index, `useSpokenWordFollow` follow behavior, `transcript-karaoke-sync` timing vocabulary, audio-edition/hands-free pipelines).

Unknown provider ids already fall back to `system` inside `getAdapter`; `sanitizeTTSSettings` retains them for a non-blocking registry notice — preserved.

## 2. Goals / Non-Goals

Goals: (a) duplicate-charge prevention via durable caching with precise keys and deduplication; (b) per-document exact TTS resume that survives restarts; (c) permanent Listen affordance with minimal setup friction; (d) reliable default-on spoken-word highlighting with a measured→approximate timing ladder and occurrence-correct DOM mapping. Non-goals: see proposal.

## 3. Current Behavior Audit (code-grounded, 2026-08-19)

### 3.1 Persistent cache (`src/utils/ttsCache.ts` + `src/api/tts.ts`)

- DB: `plethora-tts-cache` v1, stores `audio-cache {key, audioData:ArrayBuffer, durationSec, size, lastAccessed}` + `cache-meta {totalSize, maxSize}` with `DEFAULT_MAX_SIZE_BYTES=500*1024*1024` and `500 MB` display default in task. LRU via `ensureCacheSize` scanning `lastAccessed` index. Comment on line 1 notes legacy DB name left as garbage.
- Key: `makeCacheKey(provider,model,voice,speed,format,digestText128(text))` where `digestText128` is FNV-1a 128-bit over `TextEncoder` bytes, hex 32 chars, joined with `encodeURIComponent` and `:`. Called in `generateSpeech` at `src/api/tts.ts:157`.
- Read path `getCachedAudio(key)` bumps `lastAccessed` in a readwrite tx and returns `audioData+durationSec`. Write path `setCachedAudio` adds size to meta then `store.put` → `ensureCacheSize`. Both swallow errors.
- `generateSpeech` does `if(cached) return blobUrl(cached)` with `fromCache:true` in `rawOutput`; otherwise `adapter.synthesize(... includeTimings:true ...)` then `void cacheAudioResult(key,audioUrl,audioData,durationSec)` which prefers `audioData` when present otherwise `fetch(audioUrl) → arrayBuffer`. `void` means generation is complete before commit.
- `TTSCacheEntry` has no `wordTimings`; cached hit loses measured timings.
- In-memory buffer in `ReaderTTSControls` is a separate `Map<number, BufferedAudio {audioUrl,durationSec,text,wordTimings,system}>` with `bufferStatus`, `playbackIdRef` epoch, `-bufferMgr {activeGenCount, queuedIndices, getBufferedSecondsAhead, evictPlayedChunks(EVICT_BEHIND_COUNT=3), reset}`. Eviction Deletes from `audioBufferRef` and `bufferStatus` maps but never touches IndexedDB. Voice change clears the map and resets the manager.

### 3.2 Listening position

- No TTS checkpoint is written. `ReaderTTSControls` holds `chunkIndex`/`wordOffset` in component state only. `resolveStartPosition(explicit)` chain (`src/components/common/ReaderTTSControls.tsx:397`) consults `pendingAnchorRef` → live viewport (`resolveViewportAnchor`) → authoritative position (`resolvePositionAnchor`) → `getInitialChunk()` (`pageNumber` / `scrollPercent` → `ReaderSpeechIndex.chunkIndexForScrollPercent` / `chunksForPage`) → `{0,0}`.
- Durable visual stores exist in parallel with divergent semantics: localStorage `ViewState` (350 ms debounce, `getPreferredViewStateKey` with `plethora_user` profile namespace, stored as `document-view-state:v2:u:{profileId}:…`, `src/lib/readerPosition.ts`) and SQLite `DocumentPosition` (`type:'page'|'scroll'|'cfi'|'time'`, `src/api/position.ts`), written via `saveDocumentPosition` + `updateDocumentProgressAuto`. EPUP `currentCfi` is lazily available.
- `DocumentViewer` constrains viewer type inference to `localDocument` vs `activeGlobalDocument` to avoid cross-tab bleed, and flushes `ViewState` on tab eviction (`readerTabCap=2`).

### 3.3 Discoverability

- `ReaderTTSControls:188 returns null when `tts.enabled===false`; `chunks.length===0` also returns null. `DocumentViewer` wires `ttsHighlightSpokenWord` from `settings.tts.highlightSpokenWord ?? true` but `canReadAloud` (`line 8578`) gates on `settings?.tts?.enabled`. Global default `createDefaultTTSSettings().enabled=false`. Provider selector in `TTSSettings` hides `pocket` off-Tauri and `android` off-mobile.
- System provider validation (`validateTTSConfiguration`) passes when not enabled or `pocket|system`; otherwise requires key/borrowed-key/proxy per adapter `auth.mode`. Groq always valid even without key.

### 3.4 Highlighting

- Settings schema v4 already defines `highlightSpokenWord:true` + `followSpokenWord:true` (`src/utils/ttsSettings.ts:45-46,348-350,494-507,608-616`), migrated via `migrateTTSSettings(v3→v4)` and sanitized via `sanitizeTTSSettings`, stored through `settingsStore` and read as `ttsHighlightSpokenWord` in `DocumentViewer`. `WordHighlightLayer` routes via `sectionContainers` map preventing duplicate-text sibling highlight.
- `WordHighlighter` (657 lines) caches `IndexedText {chars, normalizedText, wordNormStarts}`, resolves `pdf-word` via `[data-w]` and section offsets via `ordinalForSectionOffset`, and injects karaoke-vocabulary styles (measured vs `--approx`, eink flat variant). `WordTimings` (`src/utils/wordTimings.ts`, 166 lines) splits `WordTiming{word,start_ms,end_ms,source}` with `MIN_WORD_MS=60`, `synthesizeWordTimings(text,0,durationSec)` weighted `length+1`, `resolveChunkTimings` preferring measured when `wordTimingsAlignWith`, and `nextActiveWordIndex` commit gate.
- `ReaderTTSControls.startWordTracking` rAF loop samples `audio.currentTime`, commits only on index change, pauses while `paused|ended|document.hidden`.

## 4. Decisions

### D1. Preserve the two-tier storage split (audio vs lightweight state)

Large audio blobs stay in the dedicated IndexedDB store. Lightweight checkpoints and settings stay in the durable per-document / settings stores (SQLite mirroring browser IndexedDB). Zustand `settingsStore` never holds audio. Cross with `openspec/spec/performance-benchmark-gate` and `specs/premium-tts-audiobooks` offline-cache language — already respected.

### D2. Cache key completion

New canonical key includes every synthesis-affecting field; fields with no effect MUST NOT be added. Build via helpers `digestText128` (keep for text) and `digestJson128` for composite objects.

```
key = [
  provider, model, voice, speedNormalized, format,
  languageIfAffectsOutput,              // only when != "Auto" / adapter declares language dependence
  digest128(instructions)  or "" ,       // only when adapter.capabilities.supportsInstructions && non-empty
  digest128(canonicalPreset) or "" ,     // only when non-default preset and provider supports preset/prosody
  digest128(pronunciationDict) or "" ,   // sorted keys, NFKC folded, only when non-empty
  digest128(speakerEmbeddingUrl) or cloneModelId or "" ,  // only for cloned-voice kinds
  baseUrlIfOpenAICompatible or "" ,
  digestText128(text)
].join(":")  // encodeURIComponent per segment; empty segments preserved as empty string so key length signals inclusion
```

Canonicalization rules (spec-level, tested):
- `speed`: `Number(speed).toFixed(3).replace(/\.?0+$/,"")` — `1` and `1.0` alias.
- `language`: lowercased, normalized (`Auto`→"" suppressed); only included for fal/pocket where it changes output.
- `instructions`: `normalizeForMatch(trim)` then digest; empty suppressed.
- Preset: when `presetId !== defaultPresetId` or adapter supports prosody, serialize `{prompt, temperature, topP, topK, repetitionPenalty}` with `foldForMatch` on prompt, numeric rounding to 2 dp; `maxNewTokens` excluded (affects chunk count, not per-segment audio identity on some adapters) unless adapter declares otherwise.
- `pronunciationDictionary`: sorted keys, `foldForMatch(key) → foldForMatch(value)`, JSON stringified then digested; empty `{}` suppressed.
- `baseUrl`: normalized (`trim`, trailing `/` stripped, lowercase host) for `openai-compatible` only.

`makeCacheKey(provider, model, voice, speed, format, text)` is kept as a shim emitting the legacy shape; synthesis path migrates to `makeCacheKeyV2(params)` / `makeTTSCacheKey({provider,model,voice,speed,format,language,instructions,preset,voiceProfile,pronunciationDictionary,baseUrl,text})`. Deduplication and lookup use `V2` after migration; `getCachedAudio` tries `V2` then legacy key (single alias lookup) so existing entries remain usable without a bulk copy.

### D3. Durable write as the completion gate

For paid providers (adapters whose `auth.mode` is `apiKey`/`borrowed` or `kind!=='local'` and `id` in `{fal,openai,openai-compatible,elevenlabs,openrouter,plethora,groq}`, plus any future hosted tier) the spec's invariant applies:

```
check persistent cache (V2 then legacy)
  hit → return cached (audio + wordTimings, bump lastAccessed, record 'persistent')
  miss → inFlightDeduper(key).run(synthesize) → arrayBuffer + durationSec + wordTimings?
        → setCachedAudioDurable(key, buffer, durationSec, wordTimings?)  // await commit, retry once on transient IDB error, unique QuotaExceeded → evict LRU then retry
        → only now resolve to caller / enter in-memory buffer / become playable
        → update cacheMeta / evict if over max
```

Implementation strategy preserving liveness:
- `generateSpeech` gains optional `signal?: AbortSignal` and internal `awaitCache?: boolean` flag defaulting to `true` for paid tiers; `ReaderTTSControls`' prefetch path passes an abort signal tied to `playbackIdRef` epoch.
- To allow immediate playback, `ReaderTTSControls.generateChunkAudio` may create an object URL and begin `<audio>.play()` *while* the durable commit is pending, but `bufferStatus` stays `loading` until the commit resolves; if the document closes before commit and the commit fails/cancels, the next open re-starts synthesis (and correctly does not mark the entry as cached). Alternatively, expose a `playWithPendingCommit(buffer, commitPromise)` where the UI plays but the segment is not considered `ready`'d in cache diagnostics until commit settles.
- Cache failures are surfaced at `debug`/`console.warn` level without blocking user playback, but the segment remains uncached — next request re-generates. Never report "fromCache" for a non-committed entry. System/android/pocket writes may `void` as today.

IDB fixes included: `ensureCacheSize` must not chain deletes off a single read txn (use a second write txn), must handle txn `abort`/schema errors by reopening, and must delete corrupt entries on `DataError`.

Store `wordTimings` in `TTSCacheEntry { wordTimings?: WordTiming[] }`. On cached hit returned timings drive `startWordTracking` directly (no re-synthesis). Corrupt durations are recomputed via `setCachedAudioDurable` on overwrite.

### D4. In-flight deduplication

Module `src/api/tts/dedup.ts` (or inside `src/api/tts.ts`) exports `getOrCreateTTSGeneration(key, factory)` holding `Map<string, Promise<GenerateSpeechResult>>` with `finally` cleanup. Key is the V2 cache key. Factory is the `adapter.synthesize(...)+arrayBuffer capture` path. All concurrent callers (prefetch waterfall, user play, remount) await the same promise and share the single cache write. `ReaderTTSControls.bufferMgr` remains but skips enqueue for keys already in the deduper map.

### D5. Cache lifecycle, corruption, migration

- Default cap keeps 500 MB; settings UI offers discrete maxes 250/500/1000/2000 MB and "Unlimited" (clamped to `min(availableQuotaHint, 8*GB)` or `Number.MAX_SAFE_INTEGER` with a single guard). Eviction stays LRU by `lastAccessed`. `getCacheSize` remains the source of truth for the UI.
- Corrupt/partial reads: `try/catch` around `store.get` already returns `null`; add `entry.audioData instanceof ArrayBuffer` validation — delete and return `null` on corrupt.
- Schema migration: if key shape changes, bump `DB_VERSION` to `2`. `onupgradeneeded` from `1→2` adds optional `wordTimings` index (if needed) and leaves existing rows in place; no bulk delete. Lookup tries `V2` then `legacy` so old entries stay valid for unchanged synthesis params. A background adopt (optional) lazily re-keys entries on first hit by deleting legacy and writing under V2.
- Config change handling: `updateMaxCacheSize` triggers `ensureCacheSize` (already does). Provider/voice/model/speed/instructions/preset change naturally changes `V2` key so the next request misses — no cache clear.
- Document text change: text digest in key makes stale segments miss naturally; old segments remain until LRU.

### D6. TTS listening checkpoint — schema & persistence

Table `tts_listening_positions` (Rust SQLite) / `plethora-tts-positions` IndexedDB store in browser mode, key `(profileId, documentId)`:

```ts
interface TTSListeningPosition {
  documentId: string;
  profileId: string;              // getCurrentUserId() || "anon" — same namespace as readerPosition
  updatedAt: number;              // ms epoch
  textFingerprint: string;         // e.g. digestText128(normalized first+last 2k chars + length) — cheap document-content hash
  speechFingerprint: string;       // digest of concatenated sectionKeys + section text lengths
  provider: string;               // at checkpoint time (for telemetry/diagnostics only — position stays valid after provider change)
  model: string;
  voiceId: string;
  stableAnchor: SourceAnchor;      // primary location (CFI/wordId/text-offset/page)
  chunkIndex: number;              // advisory (used for UI 37:42 display only)
  chunkTextHash: string;           // digestText128(chunk.text)
  wordIndex: number;               // position inside chunk
  normalizedCharOffset: number;     // sectionOffset or flat doc offset at word start
  intraChunkMs: number | null;     // audio currentTime at pause (for within-word resume fidelity)
  surroundingText: string;         // ~80 chars around anchor (for fuzzy recovery)
  scrollPercentHint: number | null; // fallback only
  cfi: string | null;              // EPUB
  pageNumber: number | null;       // PDF
}
```

Storage abstraction `src/utils/ttsListeningPosition.ts` (or `src/lib/ttsListeningPosition.ts`) offers:
`getTTSListeningPosition(documentId, profileId): Promise<TTSListeningPosition|null>`,
`saveTTSListeningPosition(pos, {throttled?: boolean})`,
`clearTTSListeningPosition(documentId, profileId)`,
`listeningPositionFingerprint(doc, speechIndex)` — helpers reusing `foldForMatch`.

Write gating:
- Periodic: at most once per 4 s while playing (tracked inside `ReaderTTSControls.startWordTracking` tick + chunk change), debounced via a 350 ms `setTimeout` matching `readerPosition`.
- Immediate: `pause`, `stop`, `seek/skip` (`handlePrev/Next`, `startFrom`), `beforeunload`/`visibilitychange`/`pagehide`, `DocumentViewer` unmount, `tabsStore` tab eviction flush (reuse `flushAllViewStateWrites` hook). Use `navigator.sendBeacon`-style best-effort via sync `save` on unload.
- Do NOT write while stopped/idle.

Recover on open:
1. `speechIndex.locate(stableAnchor)` — if found, verify `chunkTextHash` fold-matches `chunk.text` slice; on mismatch but same anchor, accept anchor position (chunking changed). Intra-word: if `intraChunkMs` present and measured word timings available (+ cache hit with timings), resolve exact word via `findActiveWordIndex` against timings at that `intraChunkMs`.
2. Else try `normalizedCharOffset` within owning section via `sectionIdx = fingerprintMatch` then `wordIndexForSectionOffset`.
3. Else fuzzy `surroundingText` via `foldForMatch` substring search constrained to section.
4. Else fallback to `cfi`→`rangeFromCfi`→section offset path or `pageNumber`→`chunksForPage`, then visual position.
5. If all fail → `{0,0}`.

Display of 37:42 uses `chunkIndex * ~estimatedDurationSec + intraChunkMs` when exact durations unknown, or summed cached `durationSec` when available; a text-only "Section 3 · word 47" fallback is acceptable when duration unknown.

### D7. Resume affordance & priority chain integration

Existing Play priority chain gains a new level `ttsCheckpoint` between authoritative position and saved position:

`(1) explicit/pendingAnchor → (2) live viewport → (3) authoritative position → (4) TTS listening checkpoint → (5) saved scroll position → (6) start`.

When a valid listening checkpoint exists and `documentVisibility` is initial open (not a TOC jump), show inside/above `ReaderTTSControls` a non-blocking banner:
`"Resume listening from 37:42?"  [Resume] [Start from here] [Start over] [× dismiss]`.
- Resume → `startFrom(sourceAnchor)` atword.
- Start from here → resolve viewport and start there (checkpoint kept but not auto-used next time unless saved again).
- Start over → clear checkpoint or start at `{0,0}` (user choice).
- Dismiss / ignore → banner auto-hides after 12 s or on first manual Play; checkpoint retained.
Heuristic for showing: `updatedAt` within 30 days, not at `{0,0}`, and `wordsRemainingInDoc > 100` or `durationRemainingSec > 20`. Do not show when checkpoint is exactly the current viewport or when `followSpokenWord` is actively following (already resuming).

Auto-start is prohibited: opening a document never auto-plays TTS, even with a checkpoint.

Provider/voice change does not invalidate position — the anchor stays; only cached audio identity depends on provider config, so next generation synthesizes anew while resuming at the same word.

### D8. Synchronization between visual and listening positions

- While `followSpokenWord` && `isPlaying`: `onChunkChange(chunkIndex, scrollPercent)` updates `ViewState`+`DocumentPosition` coarsely (at chunk boundaries, not per word) using `getScrollPercent` or CFI/page for that chunk — already implemented. This co-movement is the only allowed listening→visual coupling.
- While not playing or follow off: listening checkpoint writes never update `ViewState`. Conversely, `ViewState` writes (`handleScroll`, PDF location) never overwrite `TTSListeningPosition` — they target different tables/stores.
- A manual scroll that writes `ViewState` while TTS is paused deliberately DOES update `pendingAnchor` semantics (viewport re-anchor on next Play per D3 in propose) but does not move the persisted listening checkpoint until next Play's pause.

### D9. Discoverability — Listen affordance and setup sheet

Render path after this change:

```
DocumentViewer top chrome (flex row: back/TOC/title | Listen button | Queue controls | priority chip | ...)
  when !ttsEnabled or !validateTTSConfiguration.valid:
    Listen button ≡ SpeakerHigh + "Listen" (always visible for supported types)
      onClick → open lightweight SetupSheet (Dialog/BottomSheet)
  else:
    Listen button ≡ SpeakerHigh + "Listen" (same button, now toggles/starts ReaderTTSControls bar)
```

Sheet:
- Header: "Listen — Choose how Plethora should read this document".
- Zero-config row: "Use System Voice" (when `systemTtsAvailable` per `useSystemVoices` `speechSynthesis.getVoices()`) — on select: `updateSettings({tts:{...enabled:true, provider:"system", defaultVoiceId: picked}})` and immediately begin viewport-anchored playback.
- Cloud rows: dynamic from `listAdapters().filter(id ∈ {fal,groq,openrouter,elevenlabs,openai,openai-compatible})` with badges "Configured" (via `resolveProviderKey`) / "Needs API key" dimmed but selectable → navigates to Settings → Text to Speech (deep link or programmatic tab).
- On mobile, include `android` sherpa entry where `isNativeMobile()` and capability present.
- Depth: "Configure more…" link to settings; sheet does not duplicate model/voice browsers.

`tts.enabled` semantics: `enabled===false` means "not yet set up; show discoverable affordance, don't auto-play or prebuffer". `preBufferChunks` effect already guards on `ttsEnabled` (`ReaderTTSControls:1015`) — preserve; prefetch only runs when enabled+configured. The imperative bar itself (playback UI) remains gated on `tts.enabled && validateTTSConfiguration.valid` for active controls; the affordance-tier button is not.

Layout: place the Listen control in the existing reader chrome row (the container holding `QueueNavigationControls`/`DocumentMinimap`/rating chips), not `absolute z-40`. Remove the current `absolute z-40` styling that overlaps content; playback bar remains anchored to the reader footer area where it already lives, respecting minimap and selection chrome.

All doc types PDF/EPUB/Markdown/HTML article expose it; `audio`/`video`/`youtube`/`other` do not.

### D10. Highlighting — default-on, timing ladder, occurrence correctness

Default-on implementation keeps spec `improve-reader-tts` v4 but changes one migration detail: pre-v4 persisted users whose `schemaVersion < 4` and `highlightSpokenWord === undefined` now migrate to `true` (previously the phrasing "off by default" applied only to archived `improve-pocket-tts`; this change's spec explicitly supersedes it). `sanitizeTTSSettings` fallback already maps non-boolean → `true`; no new schema version needed (stay v4).

Timing ladder (already implemented — harden, persist, expose):

1. Provider measured: enable per provider (elevenlabs/fal/openai/compatible/plethora `supportsWordTimings:true`, groq/pocket/openrouter false). Normalize via `src/api/tts/timing.ts` into `WordTiming[] source:"measured"` and cache alongside audio. On cache hit reuse without re-request.
2. System Web Speech: `onboundary {charIndex, charLength?}` → `chunk.words` binary search via `normStart/normEnd` (already correct after `improve-reader-tts`).
3. Native Android: `onWordPosition {utteranceId, sentenceIndex, charIndex}` filtered by monotonic `utteranceId` (already correct); sherpa engine path stays sentence-anchored + synthesized fallback marked `approximate:true`.
4. Fallback: `synthesizeWordTimings(chunk.text, 0, durationSec)` validated via `wordTimingsAlignWith` and `durationSec>0`, marked `"synthesized"`.

Mapping (already anchored — preserve):
- EPUB: section-keyed instance selection (`sectionContainers Map`) ensures correct iframe body.
- PDF reflow: `[data-w="{wordId}"]` → text node → range.
- PDF fixed: canonical word table → text-layer span rect overlap (already in `visibleText`/highlighter).
- Markdown/HTML: `IndexedText.ordinalForSectionOffset` + `rangesForNormalizedSpan` with `foldForMatch` validation.
Fallback hierarchy: (1) exact word + exact range, (2) exact timing + best DOM range, (3) `synthesize` approximate, (4) chunk-level highlight, (5) none (never wrong occurrence).

Lifecycle: cleared on `stop`/`chapter change`/`document switch`/`unmount` (existing effects extended to new checkpoint-aware restarts). Timing source flag `activeTimingApproximate` still drives `--approx` styling.

Performance hardening retained: rAF sampled clock (`audio.currentTime`) with `nextActiveWordIndex` gate; no whole-document rescan per frame; `IndexedText` rebuilt only on container signature change; capped caches (`cachedCharOffset 200`, injected styles per container).

### D11. Prefetch, cost safety, and diagnostics

Prefetch keeps `BUFFER_TARGET_SEC ≈60`, `MAX_CONCURRENT_GEN=3`, waterfall `getBufferedSecondsAhead` scan. Must check persistent cache (V2 then legacy) before deduper; must go through deduper when missing; must never synthesize an identical key twice concurrently (verified via adapter call count). Quota-signaling for `plethora` adapter uses pre-flight disclosure + `premium-tts-audiobooks` envelope — not mutated here.

Diagnostics (dev guard `import.meta.env.DEV` or `settings.debug?.ttsDiagnostics`):
- For each segment played, `console.debug("[TTS cache]", {key: V2, legacyKey?: string, source, fromCache, durationSec, hasWordTimings, provider, voice, speed})`.
- For resume, `console.debug("[TTS resume]", {resolvedAnchor, resolutionMethod, chunkIndex, wordIndex, intraChunkMs, staleness})`.
- For highlight, `console.debug("[TTS highlight]", {anchor, method:'anchored'|'fallback', approximate})`.
No credentials or text are logged; key includes only digests.

### D12. Settings surfaces

**Settings → Text to Speech** final sections:
- Existing: Enabled toggle + provider grid + per-provider credentials/model/speed/instructions + presets + cloned voices + Pocket status + Hands-Free toggle.
- New: **Highlight words while reading aloud** (checkbox `highlightSpokenWord`, default on, copy "Highlights the current word as Plethora reads the document aloud.") — already present implicitly via v4; ensure labeled row exists and is not buried.
- New: **Downloaded speech** card:
  ```
  Downloaded speech
  184 MB · 312 segments  of 500 MB    [Manage…]
  Plethora stores generated speech on this device so replaying the same
  passages does not require another TTS request.
  [Clear cached speech]
  ```
  Manage → `Select` for max: 250 / 500 / 1000 / 2000 / Unlimited (device-managed). Clear → confirmation ("This removes all cached speech and cannot be undone. Next playback will regenerate audio via your provider.") → calls `clearAudioCache()` + resets `cachedTotalSize`.

Styling reuses existing card/section patterns, `border-border bg-card`, i18n via `settings.*` keys.

### D13. Error & fallback behavior

- IDB unavailable / `openDB` fails: `getCachedAudio` returns `null`, `setCachedAudioDurable` no-ops after one retry, playback proceeds uncached with `console.warn` — not a blocking error.
- Quota exceeded while writing: evict one LRU batch then retry once; if still full, bypass cache for this segment and surface a one-time non-blocking toast "Device storage full — speech caching paused."
- Concurrent eviction: `ensureCacheSize` serialized behind a `cacheMutex: Promise<void>` chain.
- Checkpoint corruption: `parse` failure → delete key and return `null` (graceful fallback to viewport/position).
- Profile switch: checkpoint namespace isolates; reading the wrong profile's `V2:…` localStorage ViewState never bleeds into another user's resume.

### D14. Migration & compatibility

- `ttsCache` `DB_VERSION` 1→2 if `TTSCacheEntry` gains `wordTimings` and/or key widening requires a new index; `onupgradeneeded` creates no new stores, just bumps version so old handles reopen. Existing rows with missing `wordTimings` behave as "no timings" (synthesized fallback).
- Key widening does NOT invalidate legacy entries immediately — dual-lookup keeps them valid for exact legacy param combinations; entries for changed params miss naturally and repopulate under V2 keys, eventually evicted LRU. No 500 MB wipe on upgrade.
- Settings: stay v4; `migrateTTSSettings` already fills missing `highlightSpokenWord/false→true`; document that pre-v4 users are intentionally migrated to default-on. `sanitizeTTSSettings` remains the boundary on rehydrate.
- `tts.enabled` already persisted; flipping semantics is additive (no data rewrite) — previously-hidden users now see Listen.

### D15. Performance, a11y, e-ink

- Persist writes throttled (4 s cadence + edge-triggered) and `requestIdleCallback`-friendly where available.
- rAF loop and `findActiveWordIndex` scanning are per-chunk and gated on word-change commitment; no per-frame React re-render of `DocumentViewer`.
- `WordHighlighter` style injection uses theme tokens; highlight not solely color — shape (rounded `box-shadow` underline) distinguishes. E-ink flat variant retained. `prefers-reduced-motion` → instant follow, no highlight animation. All controls keyboard-reachable, `aria-pressed` for highlight toggle, `aria-label` for Listen.

## 5. Alternatives Considered

- Single localStorage audio cache: rejected — blobs too large, wrong store, quota too low.
- Persisting raw `chunkIndex` only: rejected — fragility to re-chunking; stable anchors required.
- Modeling checkpoint as `DocumentPosition type:'time'` extension: considered, but `positions` table already carries visual progress; a dedicated `tts_listening_positions` table isolates schema and avoids complicating the positions migration that already spans audiobook/podcast paths.

## 6. Risks

See proposal Risks; mitigated in D3/D5/D6/D13.

## 7. Rollout

Each numbered task group (tasks.md) is independently shippable. Rollback: revert commit(s) for a group; v2 keys alias to legacy so downgrade players still read legacy hits; checkpoints ignored when store absent.
