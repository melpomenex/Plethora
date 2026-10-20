# Capture & Import → Learning Studio UX

## Product and visual authority

Audience: a student recording a long class, a professional saving a meeting, or a learner importing an existing source. The primary job is to safely preserve spoken content and return to its useful passages. Operate mode governs capture/review; Read mode governs the transcript. Success is a saved, navigable session with user-approved learning objects, not a large number of generated cards.

Use the supplied brief as product authority and the existing `DESIGN.md`, `docs/design-system.md`, `src/index.css` and Material primitives as visual authority. This planning-only work does not introduce PRODUCT.md, new brand assets or new application UI. Use surface-container roles, primary/on-primary actions, on-surface/variant text, error/warning/success roles and existing reading tokens. Status is text plus icon plus tone. No hardcoded palette, decorative gradients, hover lifts or waveform-driven GPU backdrop. Transcript measure ~65ch; long metadata truncates visually with accessible full labels.

## Screen architecture and entry/navigation contract

```text
Existing library / palette / import / native share
  CaptureImportDialog (ResponsiveDialogSheet; desktop dialog)
    Record | Import Audio/Video | Import Transcript | Import Supported URL
      durable document + recording session
      LearningStudio [document-owned route/tab]
        Capture / Processing [conditional, same session]
        Overview | Transcript | Extracts | Flashcards | Ask Plethora
        SessionPlayer [only with playable media; existing playback primitives]
        SourceInspector [wide] / SourceSheet [compact]
```

Register one `capture-import` command; preserve `record-lecture`/“record audio” as aliases opening Record within it. Both Apple and other hosts forward to the shared controller, avoiding double event handlers. Existing import menus can select the same flow; unrelated PDF/EPUB/audiobook import remains unchanged. Deep links use document identity plus session area/segment, not unstable component indexes. Browser back restores prior tab/list position. Open in Source from review carries existing return-to-review context; Back returns to the same card and draft selection. A background session never steals focus on completion; show a quiet Ready badge linking to it.

Global active-recording strip: “Recording · 43:12 · Saved through 43:10 · Open”. Visible in the app shell during navigation; mobile uses a compact strip above safe-area navigation. Close/minimize preserves capture; Finish is explicit. Closing the app warns about stopping where supported but does not rely on an unload prompt for durability. Recoverable sessions appear on library reentry and the Capture dialog without forcing an unrelated view change.

## 1. Capture & Import

Desktop dialog hierarchy: title “Capture & Import”; four labeled action rows with concrete supporting text; optional details below the selected row; primary Continue/Start and Cancel footer. Mobile uses the same action list in a sheet/full-height dialog as space requires, with 48px coarse-pointer targets. Four options remain discoverable without horizontal scrolling.

- **Record Audio** — “Save audio on this device while you record.” Optional title defaults to local session date/time; profile defaults Lecture; collection defaults current collection. Start requests microphone only after the disk writer is prepared.
- **Import Recording** — native multi-file picker, drop target on desktop, “Choose folder” where native plugin supports it. File rows show name/size/recognized type and per-file status. Default one session per file; explicit multipart audiobook mode belongs to the existing audiobook flow. Shared course/project assignment applies to all rows without silently merging recordings.
- **Import Transcript** — SRT, VTT, TXT; helper “You can study a transcript without audio.” Optional Attach recording is a later explicit step. No requirement to choose media to continue.
- **Import Supported URL** — URL field followed by source detection. Show recognized adapter/source and permitted action; unknown/DRM/private/unsupported source gives “This source cannot be imported here. Import a recording or transcript you can access.” No universal download promise.

Optional details: title, existing collection picker (label “Course or project”), content type and collapsible Processing. Processing shows actual configured processor (“On device” or named remote destination), “Transcribe when ready”, and “Prepare study suggestions” initially off unless a relevant existing user preference applies. Meeting cards remain off even when meeting analysis is selected. Explain required setup inline, while keeping Save/Import available. Changing preferences does not prompt for a key before the source can be saved. Remote authorization dialog names audio/text leaving the device, provider/destination and any known charge; refusal saves source and pauses processing.

Empty: four choices. Loading picker: compact spinner on chosen row, cancelable. Permission denied: contextual explanation and Open system settings when a supported API exists, Retry otherwise; no loop. Offline: local eligible processing remains; remote stages show “Waiting for connection” and never start a request. Multiple import results show successes and failures individually with Retry failed; one bad file does not clear successful rows. Duplicate file shows existing session with Open existing / Create separate session; no hidden duplicate source or reprocessing.

## 2. Active Recording

```text
Header: [Back to library] [Session title / rename] [Recording ● + text]
Primary: 43:12 elapsed
Health: Saved through 43:10 [check] / Saving… / Storage needs attention
Activity: low-rate audio level, labeled “Audio detected” or “No input detected”
Content: optional Live captions [Temporary · may change]
Markers: Important | Confusing | Save recent extract | Card candidate
Footer: Pause/Resume [when supported]                    Finish recording
Overflow: input device / export saved audio / discard with confirmation
```

Desktop centers capture controls while a narrow chronological marker rail sits alongside optional captions. Mobile puts Pause/Finish in a persistent thumb-reachable footer and two labeled marker rows immediately above it. Finish is visually primary; discard lives in overflow. Mark Important/Confusing is one tap, saves current media sample timestamp immediately and briefly announces “Confusing moment saved at43:12.” A subtle check/haptic confirms persistence; failure remains in a visible alert with Retry, never a success animation. User attention can leave for the whole lecture.

Save Recent Extract marks the bounded previous window. Final transcript available → exact source-linked selection; no final transcript yet → “Audio bookmark saved; passage will appear after transcription.” Never store live caption text as a quote. Card candidate creates a marker, not a review card; after transcription it points to source evidence and remains reviewable. Repeated recent-extract action follows existing bounded extension semantics where applicable. Markers remain useful without AI and can seek saved audio.

Pause excludes paused duration from media time; wall-clock session metadata remains available. When unsupported, omit Pause and explain Finish/Continue behavior in help, not a dead control. Input disconnect/call/background restriction → persistent “Recording interrupted. Audio saved through…” with Review saved / Resume / Finish. Resume is always explicit after interruption. Permission revocation stops input, drains writes and preserves prefix. Low storage/blocked writer safely stops with “Saved43:10. Recording stopped because storage is full.” Do not dismiss this as a toast alone.

On failure before any bytes: show No audio captured with retry/import. On recoverable restart: title “Recovered recording”, exact retained duration and known gaps; Review/Export/Continue/Discard. Continue opens a new part and explicitly mentions the missed interval. Never invent an uninterrupted timeline through a crash.

## 3. Transcription Processing

Same session workspace, not a separate wizard requiring manual navigation. Header shows session title, saved media duration, actual processor and “You can leave this screen.” Stage list:

1. Recording saved / File imported — verified size/duration when known.
2. Preparing media — actual probe/decode status; indeterminate if no measurable denominator.
3. Transcribing — committed minutes of actual known duration, provider/model, cancel/retry.
4. Structuring concepts — completed sections/known total; no fabricated overall percent.
5. Generating study suggestions — folded into section tasks internally; label represents real available results rather than a fake separate LLM call.
6. Ready for review — counts of valid drafts and unresolved failures.

Player and Transcript open as soon as usable data exists. Completed text is labeled “Partial transcript”; live captions use a different temporary area. Show failure at its stage with a plain explanation and action: Choose processor, Download local model, Approve cloud processing, Retry failed sections or Keep source only. Do not force users to rerun successful upstream work. Cancel STT stops new provider work but retains media/committed text; Stop analysis keeps transcript and completed proposals. After cancel, show stopped state until explicit Retry.

Generation unavailable: “Recording saved. Add a transcription provider to create a transcript” with Open settings and Continue listening. If no generation model but transcript exists: reading, search, correction, manual extracts and manual card editing remain. Partial success shows “Transcript ready · 3 sections need attention”; it never hides valid results behind a global error page.

## 4. Completed Session Overview

Header: title, date/content profile, collection/tags; overflow Rename/Move/Privacy/Export/Delete. Below: duration/media availability and independent transcript/analysis states. Primary action reflects the next useful step: Review8 flashcard suggestions, Review extracts, Continue transcription or Open transcript. A five-area navigation follows (Overview/Transcript/Extracts/Flashcards/Ask Plethora).

Overview body uses existing tonal panels: generated section outline with real segment/cue links; key concepts; Important moments; Confusing moments; outputs such as decisions/actions for Meeting. AI summary is visibly labeled and may say “Based on partial transcript” or “Transcript changed; refresh summary.” Do not replace original text with summary. Each key takeaway opens source evidence; no citation glyph when no evidence exists.

Empty overview with media only: player, markers and Transcribe action. Transcript-only: text metadata and cue/section navigation, no blank player region. No proposed cards: “No flashcard suggestions yet” with Generate or manual creation; not an error. Meeting: decisions/actions visible, cards area says “Off for meetings · Enable suggestions”; no unwanted autogenerated drafts. Relevant course/project is an existing collection chip; selecting opens its library view.

## 5. Transcript Reading

Wide layout: player/outline pane ~280–360px, reading pane with a comfortable measure, optional existing AdaptiveInspector at right. Tablet collapses outline/inspector as available width decreases. Mobile: compact sticky player only with media, local search/section controls, transcript, selection bottom bar/sheet. Safe-area/keyboard insets leave the selected paragraph and primary action visible. Layout adapts from content constraints using existing shell breakpoints, not an unrelated platform implementation.

Each paragraph: valid timestamp or untimed paragraph label, optional real speaker label, text and discreet menu. Playback highlights current segment; auto-follow pauses on user scroll/selection and offers Follow playback. Search yields result count and Next/Previous; selecting a match scrolls/highlights exact text and seeks only when there is playable media and real timing. SRT-only cues scroll without fake Play controls. Unknown end time has no invented duration label.

Selection uses existing `useSelectionInteraction`, selection bar and responsive sheet: Copy / Create Extract / Generate Flashcard / Ask Plethora / Correct transcript. Capture stable segment keys/ranges before opening a dialog. Create Extract previews exact words, source and Save; no automatic route away after save. Generate Flashcard invokes a bounded section/passage request and opens existing Studio editor/draft review; manual card available without AI. Ask focuses existing Assistant with visible session/selection context. Correct transcript edits source only, saves with revision conflict handling and warns that accepted materials retain their original wording.

Speakers absent → no invented names; user can add/rename a label later. Technical terms/equations render through existing safe math/text conventions; correction does not remove case/notation. Timing gaps show text without audio precision. Failed segment page loads offer Retry locally while already loaded text remains. Large transcripts virtualize rows without destroying active selection/focus; pin selected row during toolbar interaction.

## 6. Extract Review

Two visible filters: Proposed and Saved, with honest counts. Proposed rows show exact quotation (typographic quote treatment), source cue/section, why suggested (plain labeled AI explanation), duplicate/stale status, Keep/Edit note/Discard. Source preview stays synchronized with player. Editing source quotation requires choosing actual canonical ranges; arbitrary rewriting goes into a note and is labeled as such. An AI summary is always in a separate “AI summary” block, never styled as verbatim.

Desktop inspector shows full source and adjacent segments; mobile opens Source in a bottom sheet with optional player and Return to extract. Batch Keep selected is available, with per-item result counts/retry. Keeping twice returns the same extract. Existing resolved manual extracts appear in Saved without a second promotion step. Pending audio bookmarks remain visually distinct and can later resolve to text; they cannot be mistaken for saved quotes. Stale transcript warnings offer Open original wording / Find current passage; no silent rewriting.

## 7. Flashcard Approval

Use the extracted Flashcard Studio draft list/editor, not a second authoring UI. Header: “Flashcard suggestions ·8”, selected count, grouping by concept, selection controls. Each card shows type/learning target, front/back or cloze, exact source preview/link, quality annotations and current draft status. Actions: Accept, Edit, Reject, Regenerate, Compare duplicate. Batch footer: Accept selected / Accept all eligible. No card is due or counted as saved before acceptance.

Desktop shows list and editor/source inspector together; mobile shows compact list → detail → existing editor sheet, with retained selections on back. Keyboard: arrow navigation where existing list convention supports it, Enter open, labeled controls with no undocumented destructive shortcut. Accept all displays exact eligible count and excludes stale/ungrounded/unresolved duplicates; reason is visible. Editing revalidates before acceptance. An accepted card displays Saved with Open in review and Open in Source; it does not disappear so quickly that the user cannot confirm the result.

Duplicate comparison: side-by-side existing and proposed content, match explanation and source. Use existing adds this source reference without changing existing scheduling; Skip rejects draft; Keep both is explicit. Never preselect an automatic merge or rewrite reviewed cards. Acceptance failure shows the failed item and retry; accepted items remain saved, with no duplicate on repeat click. Regenerate replaces only unaccepted suggestions after successful new output; failed generation keeps original drafts. Rejected drafts are absent from review; user can inspect rejected drafts locally and regenerate deliberately.

## Ask Plethora, privacy and organization

The Ask area hands off into the existing Assistant window/conversation store with visible Session or Course scope; it does not create a new chat backend. Course scope explicitly resolves documents in the chosen collection; source citations use the same session navigation resolver. Missing index/model shows the actual blocker, with bounded local excerpt fallback when valid. Unsupported answers state insufficient evidence. Clearing selection context follows existing Assistant behavior; it must not silently broaden a private selection to the library.

Privacy controls reuse document local-only/AI-excluded semantics; recording consent helper says “Make sure you have permission to record” with existing help/legal navigation, not jurisdiction-specific legal claims. Cloud action shows actual destination and source kind before sending; cancelling the disclosure retains local work. No transcript text, titles, source paths or audio appear in diagnostic logs. Delete media and Delete session are distinct: show exact retained/deleted content and accepted-material effects before committing. Default retains original media indefinitely.

## Accessibility, interaction and state coverage

Use md3/Button, fields, dialogs, ResponsiveDialogSheet, AdaptiveInspector, useToast, existing focus/modal/i18n conventions and reading typography. 40px minimum chrome targets, 48px coarse-pointer hit areas; sufficient contrast in dark/light/custom/E-Ink themes; icons always named. Focus moves to dialog title/first useful control and returns to origin. Announce capture status/stage/marker commit through a throttled polite live region; never announce waveform samples or every elapsed second. Errors needing action remain inline with an alert role. Timer readable as duration, not a continuously shouting live region.

Audio activity uses a low-frequency meter (≤10Hz), suspended when hidden; no perpetual high-cost waveform render. Haptics call an existing supported native feedback API only after committed marker/save, otherwise visual/text feedback suffices. Do not add a haptics dependency to achieve parity. Respect reduced motion; progress/microinteractions use existing duration/easing tokens and no hover movement. Permission, confirmation and duplicate dialogs are accessible without color, audio or vibration. All new strings use existing i18n catalogs, including long translated titles and RTL checks.

| State | Required observable behavior across screens |
|---|---|
| Loading | Skeleton maintains layout; operation has identity/cancel where valid; existing content remains readable. |
| Empty | Show the next manual/source action, no fake sample content. |
| Permission denied | Start fails once, no automatic retry; imported-file route still works. |
| Offline | Saved content/manual actions work; cloud stages wait explicitly with zero egress. |
| Processing | Stage and actual processor shown; navigate away/return preserves job. |
| Partial success | Completed audio/text/drafts stay usable; retry failed unit only. |
| Failed | Error belongs to stage, names remedy, retains original and last committed work. |
| Recovered | Display retained duration/gaps and explicit resume/export/discard choices. |
| Stale/corrected | Source snapshot persists; fresh passage is verified before exact highlighting. |
| Missing media | Transcript/learning access survives; no playable timestamp button. |

Implementation visual QA captures all seven screens at desktop1440×900 and mobile390×844, including keyboard open, large text, reduced motion, dark/light/E-Ink and long titles. See validation.md; these are required future checks, not screenshots produced by this documentation task.
