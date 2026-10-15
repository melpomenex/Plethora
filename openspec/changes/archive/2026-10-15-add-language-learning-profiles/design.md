## Context

The application already persists document metadata in SQLite, keeps UI preferences in `settingsStore`, and obtains language hints from EPUB/HTML/video metadata. The new model must not reuse the UI locale as a target language and must not force a reader into language mode. Existing profile-like concepts such as collections and account identity are separate concerns.

## Dependencies

- Hard dependencies: none; this is a foundation contract.
- Soft dependencies: `complete-app-internationalization` and `add-collections` for locale terminology and eventual scope decisions.
- Downstream changes #2–#23 consume the profile context; profile IDs and language-tag semantics must be frozen before their migrations begin.

## Goals / Non-Goals

**Goals:**

- Model multiple simultaneous target languages and one base/explanation language per profile.
- Keep explicit user choices authoritative over detection.
- Make profile resolution available to every content type and platform.
- Keep association changes reversible and source documents immutable.

**Non-Goals:**

- A course tree, placement exam, social tutor marketplace, or automatic language lessons.
- Replacing `settingsStore` or application localization.
- Inferring proficiency as a medical/educationally certified measurement.

## Decisions

1. **SQLite profile records plus association records.** Use UUID text IDs and JSON only for extensible preferences/configuration; queryable language codes and association modes remain columns. This scales and participates in backup/export better than localStorage.
2. **BCP-47-compatible language identifiers.** Store canonical language plus optional region/script (`es`, `ja`, `zh-Hant`) so adapters can declare exact support. Application locale remains a separate setting.
3. **Association state is tri-state.** `auto`, `enabled`, and `disabled` let detection suggest study without overriding the user. An association may be cleared without deleting the profile.
4. **Active profile is a setting, not a global singleton.** Persist the active profile per account/workspace, expose a nullable selection, and require content surfaces to pass the resolved profile explicitly to avoid cross-tab races.
5. **Profile statistics are derived projections.** Store only bounded counters/snapshots if needed for fast dashboards; lexicon/analytics tables remain the source of truth.

## Risks / Trade-offs

- [Wrong detection can surprise users] → Never auto-enable; show a dismissible suggestion and record an explicit disable.
- [Profile deletion could orphan language data] → Offer archive/export, detach content, and delete profile-scoped derived data only after confirmation; retain source documents.
- [Sync conflicts across devices] → Use last-write-wins for preferences, stable IDs for profiles/associations, and preserve explicit enable/disable over auto suggestions.
- [Profile context can be stale in a mounted reader] → Include profile ID/version in reader queries and invalidate only language projections, never reader position.

## Migration Plan

1. Add tables and nullable association fields without changing current reader behavior.
2. Backfill no profiles automatically; derive non-authoritative language suggestions from existing document metadata on first library load.
3. Let the user confirm a profile and association, then enable language mode explicitly.
4. Include profile/association data in backup and sync serializers with forward-compatible unknown-field handling.

## Open Questions

- Whether profiles are account-global or collection-local after the collections model is fully deployed.
- Whether an active profile should be per tab in addition to per workspace.
- Which language detector is available offline on each platform; the contract must tolerate no detector.
