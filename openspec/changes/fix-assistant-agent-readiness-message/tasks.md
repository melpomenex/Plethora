## 1. Reason derivation

- [ ] 1.1 Add a pure helper (e.g. `learningAgentBlockedReason(row, t)`) beside the existing readiness helpers: pick the first dependency whose state is `missing`/`unsupported`/`unknown`/`checking`, prefer its `reasonKey`, translate it, else fall back to `t("assistant.agent.modeBlocked")`; never read `limitations[0]`. Unit-test order, missing keys, and `ready` rows.
- [ ] 1.2 Replace the `limitations[0]` branch in `src/components/assistant/AssistantPanel.tsx:600-605` with the helper and keep `LEARNING_AGENT_AVAILABILITY_MESSAGES` handling for the synchronous unavailable reasons. Done when no code path passes an untranslated key into `assistant.mode.unavailable`.

## 2. Presentation parity

- [ ] 2.1 Assert the notice (title/aria/tooltip and the in-sheet notice at `:4300`) contains the translated reason for both `mobilePresentation` (`Learn`) and desktop (`Learning Agent`) renders, and that no string in the rendered output matches `/^[a-z]+\.[a-zA-Z0-9.]+$/` for the reason slot.
- [ ] 2.2 Add a regression fixture whose readiness row is `setup-required` **and** carries `ai.limitation.lexicalRetrieval`; prove the mode does not enter, the notice names the dependency reason, and a `ready` row with the same limitation still enters.

## 3. Locale and copy guards

- [ ] 3.1 Confirm `assistant.mode.unavailable` exists with a `{reason}` placeholder in all six locales (locales inherit `en` via spread; verify no locale overrides it without the placeholder).
- [ ] 3.2 Add an i18n guard test that every key the Assistant passes to `t()` in the blocked-mode path resolves in `en` (reuse the literal-key scanner in `src/lib/i18n/__tests__/i18n-completeness.test.ts`). Done when a new readiness key cannot ship untranslated.

## 4. Verification

- [ ] 4.1 Run `npx vitest run src/components/assistant src/lib/ai/features src/lib/i18n`, `npx tsc --noEmit`, and `openspec validate fix-assistant-agent-readiness-message --strict`.
- [ ] 4.2 Record the before/after strings for the reported mobile scenario in the change note (`Learning Agent is unavailable: ai.limitation.lexicalRetrieval` → translated dependency reason).
