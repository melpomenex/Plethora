## 1. Association and host entry

- [x] 1.1 Mount `LanguageProfileSuggestionBanner` in `DocumentViewerWrapper`
- [x] 1.2 Add `LanguageProfileAssociationPrompt` for unavailable host state
- [x] 1.3 Refresh host after association via projection epoch / provider key

## 2. Capability resolver

- [x] 2.1 Add `resolveLanguageHostCapabilities` with truthful provider probes
- [x] 2.2 Change controller defaults to pessimistic unavailable
- [x] 2.3 Add `useLanguageHostProductionBindings` hook

## 3. Provider wiring

- [x] 3.1 Add AI translation provider and register in `createTranslationService`
- [x] 3.2 Add AI writing provider and inject via wrapper
- [x] 3.3 Add production reading assist registry with wildcard language support
- [x] 3.4 Inject shadowing providers and pronunciation manifest
- [x] 3.5 Default shadowing route to cloud when Groq configured

## 4. Reader integration

- [x] 4.1 Extend `DocumentViewerWrapper` for embedded Queue Scroll usage
- [x] 4.2 Switch `QueueScrollPage` to wrapper with `openedFrom="queue"`
- [x] 4.3 Pass reading assist registry through host context

## 5. Tests and fixtures

- [x] 5.1 Add golden-path integration test
- [x] 5.2 Add manual Spanish fixtures under `src/test/fixtures/language-mode/`

## 6. Verification

- [x] 6.1 Run `npx tsc --noEmit` (pre-existing unrelated errors remain in repo)
- [x] 6.2 Run language-related Vitest suites (29 passed)
- [x] 6.3 Run `openspec validate complete-language-mode-end-to-end --strict`
- [x] 6.4 Adversarial verification pass — top issues addressed; see deliverables
