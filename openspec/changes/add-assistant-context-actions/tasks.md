## 1. Catalog and target model

- [x] 1.1 Reconcile this change with current Assistant/mobile changes and record the existing submit, grounding, overlay, and geometry boundaries; verify the design's anchors and both capability deltas still match the tree before editing implementation.
- [x] 1.2 Add the ten-action catalog with stable IDs, localized labels/icons, grouping, target/capability predicates, outcome/tool policy, and typed parameter definitions outside AssistantPanel; verify table-driven tests cover every action and visibility for Chat/Document/Library and missing provider/context.
- [x] 1.3 Add deterministic target resolution and manual-target invalidation for live/pinned selections, mismatched sources, attached sections, focused document/media windows, full source, and substantive conversation; verify precedence, locator/coverage labels, source mismatch choice, and detach/switch tests.

## 2. Shared execution and grounding

- [x] 2.1 Extend shared submission and optional message provenance with an immutable action envelope, source/version/locator, answer scope, target coverage, and parameters; verify backward-compatible conversation restoration and captured-target submission for mobile and desktop.
- [x] 2.2 Make action metadata authoritative through context loaders and grounding adapters, bypassing ambient pin/section and whole-document prompt inference; verify passage actions do not expand, explicit document outline ignores selection, full-source overflow is disclosed, and source actions do not widen Library retrieval.
- [x] 2.3 Dispatch actions without using the draft-clearing send handler, with synchronous single-flight protection before async source loading and no implicit draft images; verify double tap, preserved text/images/section chips/cursor, cancellation, source switch, and exact-target retry integration cases.
- [x] 2.4 Apply read-only versus card-tool action policy through the existing provider/consent pipeline; verify answer/quiz actions cannot execute mutations, unavailable paths show recovery, and catalog rendering/opening triggers no inference, indexing, or unconsented paid fallback.

## 3. Desktop and mobile discovery

- [x] 3.1 Build the shared labeled icon strip and grouped contextual More content using existing Material/Phosphor primitives; verify stable action ordering, accessible target names, normal/compact/Actions-only fit, and all ten actions are reachable.
- [x] 3.2 Replace desktop utility shortcut chips with the contextual strip and anchored More menu, preserving utility insertion behavior in More; verify resizable narrow/wide panels, scope/model menu exclusivity, draft editing, and ordinary keyboard send remain usable.
- [x] 3.3 Extend MobileComposerMenu with the searchable contextual catalog and target choice, with More entering the same menu at Actions; verify add/More identity, search matches, attachment/slash/registry semantics, no forced keyboard, focus return, and Escape/Android Back dismissal order.
- [x] 3.4 Add the optional mobile strip and geometry suppression before single-detent fallback, hiding it during drafts/attachments, keyboard, dictation, loading, generation, and an open Actions menu; verify at least 96px of conversation, stable threshold behavior, both normal detents when possible, and unchanged Learning Agent/selection Ask surfaces.

## 4. Action outcomes

- [x] 4.1 Add scoped prompt builders for summary, explanation, key points, key terms, argument analysis, illustrative examples, and document outline; verify deterministic request content, source-only versus illustrative policies, localized display prompts, and unchanged citations/coverage behavior.
- [x] 4.2 Add the bounded-target translation language picker with UI-language default and target revalidation; verify language selection, cancel-without-submit, whole-document guidance, and source-switch-during-picker behavior without a new Settings control.
- [x] 4.3 Integrate Make flashcards with the existing 20 Rules/card tools and collection UI, including visible creation copy, isolated source, and captured deck association; verify source/conversation targets, existing per-answer isolation, duplicate prevention, and partial-write recovery without replaying saved cards.
- [x] 4.4 Add validated quiz question/answer/hint output and conversation-local optional quiz metadata; verify schema failure recovery, restoration without inference, and answer/hint concealment in both visual and accessibility trees.
- [x] 4.5 Add labeled Hint, Show answer, Next question, and source-change restart controls; verify reveal causes zero extra model requests, Next uses the same captured target and excludes old questions, typed follow-up remains possible, and New conversation clears quiz state.

## 5. Localization and acceptance

- [x] 5.1 Translate the complete action UI in de/en/es/fr/ja/zh and use semantic theme/motion tokens; verify locale key coverage, long German labels, 200% text, visible focus, contrast, and 40px desktop/48px coarse-pointer targets.
- [x] 5.2 Run a bounded visual/interaction pass at 320/390/430px phone widths, short/landscape and keyboard-open states, partial/expanded sheets, and a reader beside 320–600px desktop panels; record captures/results and confirm no clipped menus, horizontal action scroll, lost drafts, or detent regression.
- [x] 5.3 Run focused action/grounding/composer/quiz/flashcard tests plus existing Assistant regressions, TypeScript and relevant lint checks; verify all pass and record any pre-existing unrelated failures separately.
- [x] 5.4 Run `npm run bench:check` after implementation and `openspec validate add-assistant-context-actions --strict`; verify benchmark and bundle budgets pass without unexplained baseline changes and the change remains valid before requesting acceptance.
