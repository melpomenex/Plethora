## Context

All 23 original language proposals build capabilities that assume a learner can manage vocabulary, view progress, discover/generate content, install packs, and start practice sessions. Without a unified destination, 14 `src/lib/language*` modules remain unreachable in production UI.

## Goals / Non-Goals

**Goals:**
- Provide a clean, responsive, localized, theme-aware Language Learning dashboard consistent with Plethora's existing tab shell.
- Keep the main bundle entry chunk within budget by lazy-loading the dashboard and its sub-views.
- Present honest empty, loading, unavailable, stale, and insufficient-evidence states rather than fabricated numbers.

**Non-Goals:**
- Duplicating Plethora's FSRS-7 scheduler or generic analytics/settings architecture.
- Requiring paid cloud AI to complete onboarding or use local vocabulary/reading features.

## Decisions

1. **Lazy tab shell.** Mount `"language-learning"` as a standard lazy tab via `debugLazy` and `NAVIGATION_DESTINATIONS`, enabling instant opt-in/onboarding inside the dashboard while preserving `settings.languageLearning.enabled = false` default for document reader mounts until enabled.
2. **Composable workspace sub-views.** Today, Vocabulary, Content & Generation, Practice & Tutor, Analytics, and Language Packs live as separate lazy sub-views sharing one active profile selector.

## Risks / Trade-offs

- [Large vocabulary lists slowing UI] -> Use paged Rust queries (`search_language_lexical_entries` with offset/limit) rather than loading full lexicons into memory.
