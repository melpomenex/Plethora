# Tasks: Add Optional Study Mode and Learner Preferences

- [ ] 3.1 Add Migration `163_study_learner_preferences` and Rust repository/commands in `study_mode_repository.rs` and `commands/study_mode.rs`.
- [ ] 3.2 Add `studyMode` settings slice in `settingsStore.ts`, Study Mode settings UI with `<SettingsSearchTarget>` + `settingsSearchCatalog.ts` + i18n keys, and add missing `tts.handsFreeStudy` search target.
- [ ] 3.3 Implement bounded learner context builder (`src/lib/study-plans/studyMode/learnerContext.ts`) and optional Customize Preferences drawer.
- [ ] 3.4 Implement `StudyModeWorkspace.tsx` (desktop split/panel + mobile responsive tabs/sheet) and unobtrusive Read/Study toggle in `DocumentViewer.tsx`, Command Palette, and document context menu.
