## 0. Dependency gates

This change has no hard implementation dependency. Before downstream work begins, stabilize profile IDs, BCP-47 language tags, active-profile resolution, association modes, and the separation from application locale.

## 1. Data model and migration

- [ ] 1.1 Define profile, preference, association, detection-evidence, and lifecycle types with stable IDs and BCP-47 validation.
- [ ] 1.2 Add SQLite tables/indexes and migration-safe repository methods for profiles and document/media associations.
- [ ] 1.3 Add backup/export/import and sync serialization with account/workspace scoping and conflict rules.

## 2. API and state

- [ ] 2.1 Add Tauri commands and TypeScript API wrappers for profile CRUD, activation, association, and suggestion dismissal.
- [ ] 2.2 Add a profile store/provider that keeps active profile separate from application locale and invalidates profile-scoped projections safely.
- [ ] 2.3 Add migration tests for fresh, existing, offline, duplicate, archived, and deleted-profile databases.

## 3. Reader and settings UX

- [ ] 3.1 Build profile management/settings UI with proficiency/preferences and accessible profile switching.
- [ ] 3.2 Add non-blocking content-language suggestion UI with confirm, dismiss, explicit enable, and explicit disable.
- [ ] 3.3 Expose resolved profile context to document, Queue, media, transcript, and future practice entry points without changing inactive readers.
- [ ] 3.4 Add mobile, e-ink, reduced-motion, keyboard, and screen-reader interaction tests.

## 4. Verification

- [ ] 4.1 Verify application locale changes do not alter target-language behavior and vice versa.
- [ ] 4.2 Verify profile deletion/archival preserves source documents, positions, Queue state, and generic learning items.
- [ ] 4.3 Verify no language UI appears for unassociated content and active profile changes do not leak state across mounted readers.
