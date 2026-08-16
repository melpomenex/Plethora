## 1. Core 20 Rules Module

- [x] 1.1 Create `src/lib/ai/knowledgeFormulation.ts` with 20 rules metadata, educational reminders, prompt builder, and command parser
- [x] 1.2 Add unit tests in `src/lib/ai/__tests__/knowledgeFormulation.test.ts` for command detection, prompt synthesis, and reminder formatting

## 2. Assistant Panel Integration

- [x] 2.1 Add `/20rules` quick action chip and command handler to `src/components/assistant/AssistantPanel.tsx`
- [x] 2.2 Update `/help` command output in `AssistantPanel.tsx` to document `/20rules` and its formulation principles
- [x] 2.3 Inject 20 Rules system prompt into Assistant card generation flows when `/20rules` is invoked

## 3. Document Q&A Tab Integration

- [x] 3.1 Add `/20rules` quick action chip and tooltip reminder to `src/components/tabs/DocumentQATab.tsx`
- [x] 3.2 Update Document Q&A prompt handling in `DocumentQATab.tsx` to support `/20rules` command and inject 20 Rules system prompt

## 4. AI Flashcard Studio Integration

- [x] 4.1 Add "20 Rules Formulation" (`/20rules`) to `QUICK_TEMPLATES` in `src/components/review/FlashcardStudioModal.tsx`
- [x] 4.2 Add 20 Rules reminder card and visual cues in Flashcard Studio templates view
- [x] 4.3 Update Studio prompt construction to enforce 20 rules when twenty-rules mode is triggered

## 5. Localization & Verification

- [x] 5.1 Add translation strings for 20 rules labels, descriptions, and reminders in `src/lib/i18n/locales/` (en, de, es, fr, ja, zh)
- [x] 5.2 Add unit and integration tests verifying UI chips, template selection, and command execution across Assistant, Document Q&A, and Studio
- [x] 5.3 Run full test suites (`npm test`) and type checking to ensure complete correctness
