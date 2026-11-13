## Context

See `proposal.md` for the current coverage gap. The app already uses `useI18n()` and `t()` with six locale dictionaries. Non-English dictionaries spread `...en`, so checking whether a key exists does not establish that it has a translation. The Study Plans components currently contain substantial direct English UI copy, and `studyErrorMessage.ts` returns hardcoded English messages for feature errors.

## Goals / Non-Goals

**Goals:**

- Use the existing locale setting, translation helpers, and dictionaries for all application-authored copy in the audited surfaces.
- Produce a concrete inventory of the app's current user-facing feature surfaces and cover new and recently expanded surfaces, starting with all Study Plans flows and their app entry points.
- Make newly introduced or updated feature keys explicit in each supported locale and detect untranslated source literals before they ship.
- Keep Settings search catalog and coverage entries in step if the audit changes Settings controls or groups.

**Non-Goals:**

- Replacing the i18n runtime or removing English fallback globally for legacy keys.
- Adding supported locales or translating user-authored, generated, imported, or third-party content.
- Changing feature behavior beyond rendering application-authored copy in the selected locale.

## Decisions

- **Use the existing translation runtime and six locale dictionaries.** This avoids a second localization path and keeps locale switching consistent with the rest of the app. A new framework or global fallback-policy change was considered but would add migration risk without helping identify the current gaps.
- **Build a bounded surface inventory before editing copy.** Enumerate current destinations and the associated new or recently expanded screens, overlays, dialogs, mobile variants, and error paths. This defines the source files and key groups the coverage check must protect, and lets the audit report any existing surface whose provenance is unclear.
- **Check explicit translations for audited feature keys.** Since `...en` makes inherited strings appear present at runtime, locale coverage must inspect the source dictionaries or otherwise prove a non-English entry was supplied. Keep a small reviewed allowlist for universal terms and proper names instead of treating equal-to-English values as generally acceptable.
- **Combine runtime-oriented locale checks with a scoped source scan.** Preserve key and placeholder checks, then add coverage for hardcoded JSX text and visible string attributes in the audited files. Keep the scan bounded to the inventory and review its allowlist to limit false positives from identifiers, examples, and developer-only copy. Use existing TypeScript/Vitest tooling rather than adding a dependency.
- **Translate errors through the shared i18n path.** Feature error keys and validation outcomes should resolve through locale dictionaries so the error surfaces follow the same locale behavior as labels and dialogs; remove duplicated English message tables when their callers can use the shared translation lookup.
- **Verify representative end-to-end flows in each locale.** Automated checks establish key and source coverage; a focused smoke pass checks that the real screens, dialogs, consent copy, error states, and accessible names render correctly after switching locales.

## Risks / Trade-offs

- [The surface inventory may miss a secondary route or portal-rendered dialog] → Include route/navigation registrations and feature-owned overlays in the inventory, then review the final source list against the app's active destinations.
- [A source scan can flag technical labels or produce false positives] → Scope it to audited UI modules, permit only reviewed exceptions, and validate flagged items as user-facing or non-user-facing.
- [Large locale dictionaries make translation review easy to overlook] → Group feature keys consistently, preserve placeholder checks, and ensure every new key is present explicitly in all five non-English dictionaries.
- [Generated curriculum and assessment content may be in a different language from the app UI] → Keep generated and imported content outside the interface-copy contract while localizing all labels and framing copy around it.

## Migration Plan

1. Inventory current feature surfaces and record the files and key groups in scope.
2. Convert application-authored literals and error messages to translation keys, then add explicit values to all supported locale dictionaries.
3. Add or update source and dictionary coverage checks and correct any failures.
4. Smoke-test representative Study Plans and other audited feature flows in all six locales.

No persisted data migration is required. If a translation or coverage change causes a regression, reverting the associated UI/key changes restores the previous rendering behavior.
