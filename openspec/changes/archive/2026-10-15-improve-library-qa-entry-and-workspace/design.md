## Context

See [proposal.md](proposal.md) for the motivation. The user confirmed the lead experience: **ask immediately, with clear source selection and cited answers**. This is an Operate surface for readers turning saved material into understanding.

The supplied screenshot is the incumbent command-hub composition. Preserve its six quick actions, resume card, theme, and suggestion layout; the requested change starts with the Ask tile's destination and continues inside Document Q&A.

Current implementation evidence:

- `CommandCenter.tsx` handles `palette.askLibrary` by queueing `suggestion.label` or, for the bare tile, an unsolicited library-themes question.
- `LibraryAskHost.tsx` renders `SelectionActionsSheet` for that pending request. The optional `documentId` is not passed into the sheet.
- `MainLayout.tsx` already resolves `/qa` and `/doc-qa` to the `doc-qa` tab. `tabsStore.addTab` reactivates reusable tabs in their containing pane.
- `DocumentQATab.tsx` already supports saved sessions, document/section mentions, whole-library retrieval, focused-document operations, web search, and citation rendering. Its empty state teaches syntax; its composer is at the bottom; its source selector is a small header dropdown.
- `documentQaSessions.ts` owns `document-qa-sessions-v1`, with 50-session/50-message caps. The actual legacy migration source is `plethora-document-qa`; older planning prose names an obsolete key.
- `libraryTask.ts` accepts document filters and exposes real retrieved sources, evidence level, retrieval mode, and retrieval-only status. `DocumentQASources.tsx` already resolves source locations and supports copy-with-sources.

No canonical Document Q&A specification exists. The new capability specifies this workspace without duplicating the session, mobile selection-Ask, or citation-navigation capabilities in earlier unarchived changes. The existing command-hub spec's requirement to prefill a grounded composer remains satisfied by using Document Q&A as that composer.

## Goals / Non-Goals

**Goals:**

- One action from the palette reaches the actual Q&A workspace; zero AI calls occur before an explicit Ask.
- A novice can type a natural question immediately and understand which sources it will use.
- Existing conversations, draft tokens, citations, tool results, and learning items survive the navigation change.
- Evidence and recovery are part of the conversation, with useful keyboard and small-screen behavior.

**Non-Goals:**

- Rebuild the command hub, rename the Document Q&A tab, or replace the reader's selection Ask sheet.
- Add a new provider, indexing engine, backend storage layer, NotebookLM workflow, graph canvas, streaming/cancellation system, or AI-generated starter service.
- Replace explicit section/chapter requests or flashcard tool workflows with retrieval-only summaries.
- Promise exhaustive analysis of every library document, or show guessed indexing coverage or locations.

## Decisions

### 1. Route an explicit entry intent to the existing tab

Extend the typed handoff in `libraryAskHandoff.ts` to distinguish **open library workspace** from **prefill question**, retaining a unique request id and optional document/passage context. Keep compatibility for existing `requestAsk` callers. The bare quick action supplies no question; question suggestions carry their complete text and actual document identity.

The app-shell host uses the established navigation path to open/reactivate `doc-qa`, then leaves the request pending until the destination is mounted, session hydration has completed, and the destination's pane is active. Document Q&A applies the request and acknowledges that exact id only after preparing the destination. Do not use timeouts to race mounting; do not let Strict Mode, remounts, or unrelated mounted tabs consume a request twice. Acknowledge-by-id must not clear a newer pending intent.

The tile remains navigable when documents or a generation provider are missing, so the destination can explain import/setup. Preserve genuine platform capability restrictions and supported fallbacks. Update the tile description to “Open Document Q&A” rather than imply an immediate generated answer.

**Alternative considered:** navigate only, or retain the sheet. Navigation alone loses prompt/context intent; the sheet keeps users outside saved Q&A sessions.

### 2. Enter a clean library question without overwriting existing work

For a bare entry, reuse an active empty, draft-free library session with web search off. Otherwise flush the outgoing session and draft, then create a clean library session. A document suggestion uses the same rule with that document's scope and prefills its editable question. Repeated activation with no intervening editing or sending reuses the prepared session and existing tab.

Persist a backward-compatible optional draft record on each session: raw composer text plus the structured document/section references needed to restore it faithfully. Reuse existing mention/section codecs; normalize malformed or missing draft data to empty. A palette handoff, session switch, and New conversation flush the draft before switching. Reloading or resuming restores the draft, without sending it or replaying tool effects. Keep existing session keys, caps, titles, and legacy migration behavior.

If a request arrives during generation, navigate immediately but defer session preparation until the current response has been saved to its originating session. Show a small pending-entry notice and allow dismissal. This bounds the change without refactoring generation into a new session execution engine. Disable incompatible history/scope mutations during that turn, with a readable explanation; never let an old async response land in the new session. Rapid duplicate bare entries coalesce.

**Alternative considered:** always resume the current conversation, or replace its composer. Resuming can silently reuse an unrelated focused document/history; replacing a draft loses work. Saving drafts lets the entry feel immediate without either failure.

### 3. Make the question the focal point

Preserve the app's themed Material grammar from `DESIGN.md`, `docs/design-system.md`, and `src/components/md3/`. Reuse its font, tonal surfaces, pill buttons, focus rings, and Phosphor icons. The screenshot's gold is an active theme, not a new hardcoded Q&A palette.

Use one question composer, positioned near the upper-middle of an empty conversation and anchored below the transcript after the first send. Keep the same input instance where practical so draft, focus, IME, and selection survive the transition. No second hero input, oversized decorative icon, nested control cards, or third permanent sidebar.

Conceptual desktop layout (illustrative content, not application data):

```text
┌ Conversations ────┬ Document Q&A                         More ⋯ ┐
│ + New conversation│                                            │
│                   │ What would you like to understand?         │
│ Saved questions   │ Ask a question. Follow the sources.         │
│ …                 │                                            │
│                   │ Sources: [Whole library ▾]                 │
│                   │ ┌────────────────────────────────────────┐ │
│                   │ │ Ask about the ideas in your library…   │ │
│                   │ │ Add document · Add section      [Ask]  │ │
│                   │ └────────────────────────────────────────┘ │
│                   │ Find connections · Compare viewpoints     │
│                   │ Summarize a document                       │
│                   │ Answers use matching passages in your      │
│                   │ selected sources.                          │
└───────────────────┴────────────────────────────────────────────┘
```

On a wide view keep the existing history rail at roughly 15–16rem and the main reading measure around 65–75ch. Header actions are History, New conversation, and More; Clear conversation moves into More and retains confirmation. The empty state uses a short heading and supporting sentence, with source scope immediately adjacent to the input. After the first send, collapse starter guidance and keep conversation continuity without an animated hero sequence.

**Alternative considered:** a dashboard of AI tools or a three-column research studio. Both add choices before the first question and compress the reading area.

### 4. Expose effective scope, including advanced overrides

The source control provides **Whole library** and a searchable **Choose document** list from real eligible document metadata. Show the active collection name when collection-scoped; avoid showing a whole-account label for a collection-restricted request. Search/display bounded metadata lists; opening the workspace must not extract whole-library content.

Keep `selectedDocumentId` compatibility. Make the existing precedence visible: selected sections narrow to those sections; explicit document mentions target those documents; otherwise the chosen document applies; otherwise the eligible library applies. Reflect overrides as removable source chips/labels beside the composer. Removing an override reveals the underlying selected scope. A removed/ineligible source requires reselection; never silently broaden to the library.

Plain library entry starts with web search off. Keep web search and `/20rules` in secondary controls, with explicit text/toggle state. Web search on changes the visible source description and retains its existing behavior; ordinary library entry must not silently enable it.

For ordinary knowledge questions without section/chapter/tool/web intent, use the existing grounded library task for library and chosen-document scope, passing the actual allowed document ids through `RetrievalFilters.documentIds`. Resolve those ids against the current collection and AI eligibility at submission; an empty allowed set fails closed. Do not bypass local-only, AI-excluded, provider, or retrieval-only policies. Existing document/section tool workflows continue through their established handlers with honest source presentation.

**Alternative considered:** add a multi-document selection manager and a new persisted scope model. The existing mentions already cover expert multi-document questions; a simple picker solves the novice task with less migration risk.

### 5. Use useful starters that remain under the user's control

Show three lightweight actions next to the empty-state composer, not a grid competing with it:

| Starter | Prepared interaction |
| --- | --- |
| Find connections | Prefill “What connections can you find between ideas in my selected sources? Cite the passages that support them.” |
| Compare viewpoints | Prefill “Where do my selected sources agree or disagree? Cite the evidence for each viewpoint.” |
| Summarize a document | Open the source picker; after selection prefill “Summarize the main arguments in this document and cite supporting passages.” |

These are local templates. Clicking a starter never sends, fetches full documents, or generates suggestions. Existing user text is preserved; do not overwrite a nonempty draft to insert a template. A user with a draft can continue typing or explicitly start another conversation. Explanations describe matching retrieved passages, avoiding a promise to exhaustively compare the entire library.

**Alternative considered:** auto-submit chips or generated personalized questions. They add accidental requests, cost, and latency before the user confirms scope.

### 6. Carry evidence and errors with the answer

The answer begins with the answer text. Add a compact evidence line with the submitted scope and actual number of distinct cited documents, then reuse `DocumentQASources` for expandable source excerpts and location links. Preserve citation numbering, answer-to-source association, resolution fallbacks, and `sourcesCopyText`. Count cited sources, not every retrieved candidate, and do not present similarity scores as confidence percentages.

Carry optional evidence/scope metadata on the saved message so an old answer does not acquire the current composer's scope label after a source change. Legacy answers render exactly as their stored data allows; no fabricated badges or duplicate footer. Focused section/tool responses keep their existing source context and actions; they gain citation UI only when structured citations actually exist.

Use a single accessible status announcement while processing. Show precise phases only if real lifecycle events are available; otherwise use neutral “Finding an answer in your selected sources…” wording. On empty/weak evidence, report that limited matching evidence was found. On unavailable indexing, report what was unavailable, without claiming the library was searched. Distinguish an empty library, unavailable selected document, provider/setup failure, and retrieval failure.

Retry restores the original question and scope for review, requires explicit Ask, and avoids duplicate user turns/tool side effects. Import and Settings links preserve the draft for return. Keep a usable composer in the empty-library state; provide an Import documents action rather than the current full-page dead end.

**Alternative considered:** a permanent sources inspector or decorative confidence meter. Inline evidence keeps the answer readable and uses facts the existing retrieval system can actually supply.

### 7. Adapt the workspace, not just its font sizes

Below the space needed for both history and a readable composer, collapse the history rail into an explicitly labeled History sheet/drawer. Keep source selection available in a responsive dialog/sheet, long document titles readable, and composer/Ask above the software keyboard and safe area. No horizontal scrolling at 360 CSS pixels; support 200% zoom and long translations. Match existing app breakpoints/components rather than add a separate device detector.

Desktop palette handoff focuses the labeled textarea after navigation settles. Touch entry shows the workspace without forcing the keyboard; tapping a starter or input focuses it. Enter sends when not composing; Shift+Enter inserts a newline. Native controls own activation; Escape dismisses the inner picker/drawer and returns focus. Use at least 40px effective targets, visible focus, dialog focus management, and reduced-motion behavior. Delete/rename/history controls must work without hover.

**Alternative considered:** keep hiding the history rail on phones. That prevents users from recovering the work this handoff preserves.

## Risks / Trade-offs

- **Multiple mounted tabs and async session writes** → apply/acknowledge each intent once in the active destination, flush outgoing state, and defer incompatible switches during processing. Test slow generation plus navigation.
- **Draft persistence adds fields to capped local storage** → optional normalized fields, bounded existing session storage, and storage-failure handling that retains the live draft and reports a failed save before switching.
- **The current retrieval branch omits explicit collection filters** → resolve eligible document ids at submission and test selected-document, collection, excluded-content, and empty-set cases; use existing APIs rather than introduce a new index.
- **Source counts and old answers can mislead** → snapshot actual request scope/evidence on new messages and omit unsupported detail on legacy messages.
- **Generic cross-library starters may find limited matches** → describe retrieval honestly and encourage refining a question; do not market them as exhaustive corpus reports.
- **Large `DocumentQATab` component** → extract bounded presentational composer/start-state/scope pieces into the existing Document Q&A feature area as needed. Keep session and generation ownership singular.
- **Navigation without a configured provider differs from the old disabled tile** → preserve platform exclusions while allowing setup/import states; update availability and keyboard tests together.

## Migration Plan

1. Add optional normalized draft and message-evidence metadata with backward-compatible defaults and focused persistence tests. Preserve existing keys and caps; leave the legacy source untouched.
2. Wire the typed entry intent through the established tab navigator, then change the palette tile and library-question suggestions. Keep product help, related-document search, review suggestions, and selection Ask on their current routes.
3. Build the composer/start state, explicit source selection, evidence presentation, and recovery UI using existing primitives. Verify the unchanged section/chapter/card workflows alongside the new ordinary question route.
4. Validate on representative large and empty libraries, desktop and 360px mobile layouts, a light and dark/gold theme, keyboard/IME, and reduced motion. Run targeted regression tests, type/lint checks, and the local performance/bundle gate during implementation.
5. Rollback changes only the route/layout code; existing sessions remain readable because added fields are optional. No data deletion or bulk migration is required.
