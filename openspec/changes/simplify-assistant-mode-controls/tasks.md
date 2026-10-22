## 1. Shared source presentation

- [x] 1.1 Add localized `Answer from` labels, the three source choices, their explanations, accessible names, and source-expansion recovery text in `src/lib/i18n/locales/{en,de,es,fr,ja,zh}.ts`; verify all six locales have matching keys and no source choice is visibly called Chat.
- [x] 1.2 Refine `AssistantScopeSelector.tsx` into the secondary source control using the existing `chat | document | library` values and themed primitives; verify selector tests cover label-to-value mapping, current-value visibility, checkmarks, keyboard selection/dismissal, focus return, and disabled state without changing engine metadata or serialized identifiers.
- [x] 1.3 Update `AskSheet.tsx` and `DocumentQATab.tsx` consumers and nearby recovery copy to use the same source terminology; verify their existing entry defaults, source subset selection, strict-source fallback, and submission behavior through focused tests.

## 2. Assistant mode and composer hierarchy

- [x] 2.1 Remove the source selector from `AssistantPanel.tsx`'s header, retaining one labelled Chat / Learning Agent group; place `Answer from` beside the Chat composer and existing agent source controls in the equivalent agent area. Verify component tests find one mode group, one source control only in Chat, and no header Chat / Document / Library group.
- [x] 2.2 Preserve independent Chat source state across Chat → Agent → Chat transitions without unmounting the composer/conversation; verify both Document and Library round trips retain the draft, attachments, messages, and review artifacts and that existing saved scopes display their corresponding new labels on restore.
- [x] 2.3 Preserve explicit submit dispatch, readiness feedback, palette handoffs, source validation, and generation locks; extend `AssistantPanelLearningAgent.test.tsx` and its integration coverage to prove toggling never submits, Chat remains on its existing scope-aware path, agent output bypasses legacy tool parsing, unavailable agent never silently sends as Chat, and changing controls cannot mutate an active turn.

## 3. Responsive interaction and accessibility

- [x] 3.1 Add a bounded in-sheet mobile source list using existing focus/overlay ownership and mutually exclusive popup behavior, with 40px targets and 48px on coarse pointers; verify keyboard navigation stays inside the expanded sheet, every choice is reachable, Back/Escape closes the list before the host, and focus/draft/attachments survive dismissal.
- [x] 3.2 Keep full mode labels readable with wrapping at supported narrow widths; add or extend a composed Assistant browser harness under `src/visual/` and assert no horizontal overflow or clipped controls at minimum sidebar width, mobile partial/expanded with the keyboard open, 200% zoom, and a long translation. Inspect light, dark, and legal-pad captures, including an open source menu and agent mode.

## 4. Validation and specification coordination

- [x] 4.1 Run focused selector, Assistant agent, AskSheet, and Document Q&A tests plus touched-code lint and TypeScript checks; record passing commands and investigate any unrelated baseline failure separately. Verify General knowledge remains context-aware, Document remains strict, and Library keeps citations and the permitted source subset.
- [x] 4.2 Run the composed real-browser checks and `npm run bench:check`; record results and screenshots in the change's validation notes. Resolve regressions without relaxing performance or bundle baselines for this presentation change.
- [x] 4.3 Reconcile the overlapping first `assistant-conversation-scopes` requirement with the current `unify-assistant-experience` delta before archive, preserving this mode/source hierarchy and the latest canonical grounding scenarios; verify `openspec validate simplify-assistant-mode-controls --strict` succeeds and document the reconciliation/archive order.
