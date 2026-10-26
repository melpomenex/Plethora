## Context

See `proposal.md` for motivation. The user's phone capture shows a source-aware Assistant with a pinned quotation and a large empty conversation, but no obvious reading actions. The capture also contains different document titles in the reader and quotation: the action target must be explicit and must never be inferred from the most convenient title.

Verified integration points in the current tree:

- `src/components/assistant/AssistantPanel.tsx:4567` renders desktop quick actions from `assistantSlashCommands.ts`: `/20rules`, `/tools`, `/help`, `/clear`. Mobile exposes these through `mobile/MobileComposerMenu.tsx`; these are utilities, not a reading-task catalog.
- `AssistantPanel.tsx:1361` owns shared submission, request epochs, and display/source overrides. Mobile submission calls `snapshotForSubmit()`; both presentations need an immutable action envelope through the entire asynchronous run.
- `AssistantPanel.tsx:674` prioritizes a live selection over a matching pinned snapshot. Section mentions, document IDs, source removal, and captured card-tool document context already exist.
- `src/utils/assistantContext.ts:14` records resolved context status, source, and full/window/chunk coverage. `src/lib/ai/assistant/documentIntent.ts` currently infers whole-document intent from typed language. An explicit passage action cannot depend on its localized button label evading that matcher.
- `AssistantPanel.tsx:2074` submits per-answer flashcards with isolated source text and empty history; `src/features/assistant/assistantMessageFlashcards.ts` and the shared 20 Rules/card-tool path supply formulation. Preserve that existing per-answer contract.
- `mobile/MobileAssistantHost.tsx:179` measures chrome against the partial detent and reserves 96px for conversation. The `mobile-assistant-composer` spec explicitly bans persistent quick-action rows; this change replaces that restriction with a bounded contextual exception.
- `DESIGN.md` specifies themed Material roles, Phosphor icons, tonal depth, visible focus, and 48px coarse-pointer targets. The mode for this surface is Operate.

## Goals / Non-Goals

**Goals:**

- Let a person reading one-handed get useful help without composing a prompt.
- Make the relationship between action, reading target, and answer scope understandable before submission.
- Share catalog, target resolution, and execution across desktop/mobile while preserving their layout and focus behavior.
- Keep behavior deterministic enough to test without an LLM and keep new logic outside the large panel component.

**Non-Goals:**

- Redesign the Assistant header, reader, Learning Agent, selection action sheet, or app theme.
- Add Settings, user-defined prompts, automatic action ranking, automatic network work, document rewriting, or a separate AI runtime.
- Implement cross-library comparisons or recommendations in the first delivery. Those need explicit source selection and retrieval UX.

## Decisions

### One stable action strip, progressive disclosure for the rest

Use icon-plus-label controls, not unlabeled glyphs. The normal strip is **Summarize · Explain · Quiz me · More**. Keep this order stable; do not reorder based on usage or model suggestions. Place it immediately above the input, after any existing contextual chips. Replace the desktop utility shortcut row instead of stacking another row on it; move utilities into the desktop More menu and keep their insertion behavior.

On mobile the strip appears only in ordinary Chat composer mode, with a useful target, no keyboard or dictation, no in-flight turn, and sufficient conversation height. During composition, generation, or an open Actions menu it collapses and the existing add menu continues to expose the full catalog. Collapsing the duplicate strip while the menu is open gives more room to browse actions. Do not add a toolbar of follow-up suggestions after every answer. An empty conversation uses a short invitation such as “Start with what you're reading”; the strip is the single action entry point, without duplicate welcome cards.

When width or larger text cannot fit the primary trio and More, retain Summarize, Explain, More; move Quiz me to More. If that still cannot fit, expose a single labeled Actions control. Never clip labels, remove labels, force horizontal scrolling, or make controls smaller. Mobile action targets are at least 48px; desktop targets are at least 40px, 48px on coarse pointers. For ordinary font scale, the strip fits in one 48–64px row; enlarged text can use the compact Actions entry instead of increasing permanent chrome.

Before mobile geometry falls back to a single expanded detent, suppress the optional strip whenever it would leave less than 96px of conversation. Re-evaluate on viewport, keyboard, font, chip, and sheet changes without repeatedly toggling the strip at the threshold. Existing composer capabilities and both normal sheet stops take priority. No persistent preference is necessary: visibility follows current layout, and actions remain accessible in the add menu.

More is an anchored, bounded menu in the desktop panel. On mobile it opens the existing in-flow composer menu directly to its contextual Actions section; the add control opens the same menu at its normal start. Use up to two columns of icon-plus-label actions, grouped by purpose, with one vertical scroll region and a one-column fallback for large text/narrow widths. Do not open another sheet over the Assistant. Opening either menu leaves the keyboard closed, Escape/Back dismisses the menu first, and focus returns to its trigger. Menus do not overlap model/scope pickers.

Alternative considered: an always-visible grid is discoverable but consumes the reading area; an icon-only carousel hides meaning and actions. A single contextual strip plus the existing menu balances discovery and reading.

### Concrete first-delivery action contracts

All generated content appears in the current conversation, with the normal citation/coverage behavior. IDs are stable and independent of translated labels. Counts below are prompt targets, not claims that the model always obeys exact formatting.

| Placement / ID | Label and suggested Phosphor icon | User need and result | Target / interaction |
| --- | --- | --- | --- |
| Primary / `summarize` | Summarize · TextAlignLeft | Regain the thread of a dense passage; concise recap up to roughly 150 words | Current target; conversation label becomes “Recap chat” |
| Primary / `explain` | Explain · Lightbulb | Unpack a difficult paragraph in plain language; define necessary jargon | Current target; chat target focuses the latest substantive answer with relevant turns |
| Primary / `quiz` | Quiz me · Question | Check understanding with one short question, hidden answer, and no saved review cards | Frozen current target, then inline Show answer / Hint / Next question |
| Understand / `key-points` | Key points · ListBullets | Pull out up to five claims or takeaways | Current source or substantive conversation |
| Understand / `key-terms` | Key terms · BookOpenText | Define up to five terms as used by the source | Text source or substantive conversation |
| Understand / `translate` | Translate · Translate | Read a difficult passage in a familiar language, preserving meaning and names | Selection, attached sections, or bounded passage; select a destination language before sending |
| Understand / `outline-document` | Outline document · TreeStructure | See the structure and argument of a chapter, article, or transcript | Explicit whole-source target, visibly labeled; available with a readable document/transcript |
| Think / `example` | Give an example · Shapes | Connect an abstract concept to a concrete situation | Chat scope; mark generated examples as illustrative, not quotations or source facts |
| Think / `analyze-argument` | Examine argument · Scales | Separate the main claim, supporting reasons, assumptions, and open questions | Source or substantive conversation; distinguish critique/inference from what the author says |
| Study / `flashcards` | Make flashcards · Brain | Turn source concepts into a small set of reviewable cards | Source or conversation; visible “Creates study cards” description, then existing 20 Rules/card-tool workflow, default target five cards |

The primary trio is also present in More; this is necessary when compact layout hides the strip. Document scope keeps all source-derived claims evidence-bound; Give an example is unavailable there with “Use Chat for illustrative examples” guidance and an explicit scope control. It does not change scope on activation. Library scope does not turn a source shortcut into a library-wide search; hide Give an example there too. Translation never silently translates an entire long book: whole-document and conversation targets show guidance to select a passage. Do not introduce an implicit translation-language setting; require a picker per translation action, preselecting the UI language while allowing change. Cancel sends nothing.

The catalog uses declared target kinds, required capabilities, outcome kind (`answer`, `quiz`, `cards`), prompt builder, optional parameter picker, and grounding/tool policy. Pure generation actions cannot execute document/card mutation tools. Only the labeled flashcard action grants the existing card-tool subset. If a model response unexpectedly contains a mutation request for Summarize, it is not executed. General slash commands retain their current semantics.

### Resolve the target once, visibly, and preserve it through submission

“Answer from” chooses the existing Chat/Document/Library grounding boundary. “Use” identifies what an action operates on. A source shortcut uses a source target even in Chat; the ordinary scope remains unchanged. Reuse the existing source/selection chip or header subtitle to show the resolved target and locator; do not add a redundant permanent target row. Show the full target selector at the top of More. Include the target in each action's accessible name and persisted user message, for example “Summarize selected text · The Vital Question · p. 42”.

Default target resolution is deterministic:

1. Current live reader selection, attributed to its registered document.
2. Explicitly pinned selection from that same active/attached source. If its source differs from the current reader, mark the mismatch and ask for one target choice; never silently reinterpret it as the current document. Removing it restores the current reading context.
3. Explicitly attached section mentions, as a named section or “2 attached sections”.
4. Viewer-provided focused text: section/passage/page window or timestamped transcript segment. Say “Current passage”, “Nearby pages”, or “Transcript segment” according to actual supplied coverage.
5. Readable whole-source context when no focused window is supplied: say “This document” or “Full transcript”, not “Current passage”.
6. Substantive conversation if no source is attached. Use conversation-specific labels; do not promote a greeting or tool-status-only thread into usable source material.
7. Otherwise show a short attach-source/start-conversation hint rather than enabled actions with invented context.

Within More, the user can explicitly choose an eligible selection, attached sections, current passage, whole document, or conversation without changing answer scope. A manual target applies to the current source identity and resets on source detach/switch or invalidation. Whole-document is opt-in when a selection/passage exists. Outline document is itself an explicit whole-source action; it never follows a selection by accident. A source mismatch choice and translation-language choice are the only extra decisions before otherwise immediate actions.

Capture action ID, chosen target kind, document ID/title, locator, source revision, section/selection identifiers, effective text or frozen resolver inputs, answer scope, and action parameters at activation. Resolve async text against that identity. Validate availability again at dispatch, especially after the language picker. Source changes during a picker require re-selection; source changes after submission cannot retarget a running turn. Preserve the normal epoch/cancellation behavior when conversations change. Late responses either complete against the original captured target in the owning thread or are discarded by the existing lifecycle; they never attach to the newly active source.

Extend the shared submit request with explicit action/target metadata and pass it into `callLLM` and the grounding adapters. For action turns, the frozen target and coverage are authoritative over live `context`, pinned selections, section mentions, pronoun resolution, and `isWholeDocumentRequest`. Reuse text loaders, token budgeting, citation source registration, and document coverage policies; do not solve this by building isolated provider requests or merely changing the prompt string. Store optional action provenance on messages so display/retry uses the captured target, while older messages without metadata still load.

For full-document actions, load canonical full text within the existing budget; if only windows/chunks fit, disclose the actual partial coverage. An outline of excerpts cannot claim complete document coverage. Passage actions never automatically load the rest of a book. Library retrieval cannot widen a source-targeted action beyond its named source. Conversation targets use a frozen relevant transcript and disclose history truncation when needed; they do not re-inject a detached source.

Alternative considered: just call `setInput('Summarize this')`. It leaves the user needing another tap, can overwrite a draft, and allows ambient source changes and whole-document heuristics to alter the target.

### Preserve the composer and reuse execution

Dispatch read actions directly through the shared submission function with a friendly display prompt plus action metadata. Do not route them through the ordinary send handler, which clears input/images. Keep unsent text, images, section chips, cursor position, and scroll intent intact; never automatically send draft attachments with a shortcut. A tap does not focus the text field or open the keyboard. Desktop retains focus on the activating button or result; mobile keeps touch focus outside editable fields. Opening More must not eagerly build unrelated expensive command content.

Guard the turn synchronously before asynchronous source resolution, parameter dispatch, or provider work; a rapid double tap must create only one user turn/request. While resolution or generation is running, show the normal busy/stop UI and disable additional action submissions. Cancellation, failure, and retry retain the draft and captured target. Retrying uses the original action envelope; context that is no longer available produces a recoverable message and explicit Run on current context choice, rather than silently substituting a new source. Use configured provider/model routing and all existing consent gates; no automatic retrieval/indexing or paid fallback is introduced.

Flashcards reuse formulation, explicit tool allowlisting, frozen document/deck association, and `ChatFlashcardCollection`; do not pass an unrelated conversation when the target is a passage. Conversation-target cards may use the captured conversation; the existing per-message flashcard action remains isolated to the clicked answer. Surface generation/persistence results through the existing collection and controls. Prevent automatic retry of completed card writes; partial failures use existing per-card retry rather than replaying a whole batch.

### Make Quiz me usable without typing

Quiz me starts a small typed quiz state attached to the current conversation: captured target, question index, question text, answer, optional hint, and reveal state. Generate one question and its answer/hint in a structured response using the existing AI path, then render only the question. A text-only model failure must not expose an answer as a pretend hidden-answer quiz: present a recoverable generation error with Retry. Treat answer/hint content as hidden until requested, including in the accessibility tree.

Show answer and Hint reveal already-generated content locally and make no new model request. Next question starts one generation turn against the same frozen target, excludes prior questions, hides the answer again, and uses the normal busy/stop behavior. Users may still type an answer; ordinary Assistant follow-up preserves the quiz's target and does not require grading to continue. Quiz progress is conversation-local, does not schedule reviews or create cards, and clears on New conversation. Persist optional quiz metadata with conversation messages; restoration does not regenerate it. A user-chosen source change ends the active quiz controls with a readable notice and a Start quiz on current source action, preventing old questions being labeled as about a new document.

Alternative considered: a generated list of questions and answers is simpler but makes self-testing hard and immediately reveals the answers. A separate assessment mode adds navigation and persistence that this feature does not need.

### Match the existing instrument and verify its pressure points

Use existing Material button/menu primitives, semantic tokens, Phosphor glyphs, focus and overlay contracts. No new visual brand or hardcoded application palette. The companion `.lavish/assistant-context-actions.html` is an illustrative interaction concept in Plethora's Material theme roles, not a live Assistant and not a pixel-exact implementation commitment. It demonstrates phone idle/More/quiz and the document-side desktop panel.

Localize labels, target kinds, menus, placeholders, accessible names, errors, quiz controls, and display prompts in all six locales. Keep action IDs and outcome policy independent of localization. No new Settings controls are required; if implementation later adds one, apply the repository's Settings search catalog, coverage, and tests.

Acceptance focuses on 320/390/430px phone widths, representative short/landscape and keyboard-open states, partial/expanded sheets, and a desktop reader beside a 320–600px resizable panel. Include 200% text, German labels, screen-reader use, keyboard-only use, reduced motion, theme contrast, and menus under model/scope interactions. Use bounded screenshot verification and targeted integration tests; run `npm run bench:check` for implementation. Do not change performance baselines unless an intentional measured change is explained.

## Risks / Trade-offs

- [More permanent chrome on phones] → One conditional strip, compact fallback, add-menu redundancy, and optional-strip suppression before detent collapse. No repeated action grids in the transcript.
- [Wrong context produces a confident answer] → Visible target, explicit mismatch resolution, typed frozen action envelope, source-restricted grounding, and regression tests around selection/document changes and localized prompts.
- [Small screens and long labels] → Measure fit, reduce promoted actions, and use one-column More when needed; never depend on tooltips for meaning.
- [Quiz response formatting varies by model] → Validate a small structured payload, render recoverable failure, and test hidden-answer accessibility. No new provider-specific runtime.
- [Card creation is a durable effect] → Name the effect before activation, use only the existing card path, and prevent duplicate/replayed writes.
- [Offline or unconfigured AI] → Use existing readiness state and a useful setup/recovery entry instead of enabled actions that cannot run; available local models continue working through current routing.
- [Parallel Assistant changes] → Reconcile with `simplify-assistant-mode-controls`, `mobile-assistant-gesture-haptics`, and `unify-assistant-experience` before implementation. Keep this work limited to ordinary conversation actions and the mobile composer delta.

## Migration Plan

1. Add the shared catalog, typed action envelope, and backward-compatible optional action/quiz message metadata; no database migration or new settings.
2. Add desktop action discovery, then mobile strip/menu integration with the height budget. Keep utility commands reachable before removing the desktop utility row.
3. Enable secondary generation, translation, flashcards, and quiz controls through the same action executor and targeted tests.
4. Validate phone/desktop behavior and repository performance/bundle gates, then archive/sync the two capability deltas after implementation is accepted.

Rollback removes the strip/contextual menu sections and restores utility shortcuts. Older chat renderers must safely ignore optional metadata; saved messages and created cards remain valid.
