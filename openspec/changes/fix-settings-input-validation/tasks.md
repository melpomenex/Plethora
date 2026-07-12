## 1. Reusable NumericInput Component

- [ ] 1.1 Implement the `NumericInput` component in `src/components/common/UI.tsx` with local state, onChange, and onBlur handling.
- [ ] 1.2 Add exports for `NumericInput` and `NumericInputProps` to `src/components/common/index.ts`.

## 2. Refactor settings components to use NumericInput

- [ ] 2.1 Refactor `src/components/settings/DocumentsSettings.tsx` to replace raw number inputs with `NumericInput`.
- [ ] 2.2 Refactor `src/components/settings/SettingsPage.tsx` to replace raw number inputs with `NumericInput`.
- [ ] 2.3 Refactor `src/components/settings/LearningSettings.tsx` to replace raw number inputs with `NumericInput`.
- [ ] 2.4 Refactor other settings files that have number inputs: `AIProviderSettings.tsx`, `AISettings.tsx`, `EmbeddingSettings.tsx`, `ImportExportSettings.tsx`, `IntegrationSettings.tsx`, `LLMProviderSettings.tsx`, `TTSSettings.tsx`.

## 3. Verification

- [ ] 3.1 Verify code compiles successfully.
- [ ] 3.2 Verify settings inputs can be cleared, typed into, and validated properly on blur.
