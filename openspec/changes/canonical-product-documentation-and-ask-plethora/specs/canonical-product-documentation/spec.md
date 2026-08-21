## ADDED Requirements

### Requirement: Structured canonical product documentation corpus
The system SHALL maintain an authoritative, version-aware product documentation corpus under `docs/product/` organized by functional domain (e.g. `reading/`, `queue/`, `scheduling/`, `review/`, `tts/`, `audiobooks/`, `podcasts/`, `rss/`, `ocr/`, `transcription/`, `ai/`, `sync/`, `eink/`, `settings/`, `platform/`). Every active user-visible feature and behavioral rule SHALL be documented in this corpus.

#### Scenario: Authoritative domain feature document
- **WHEN** an agent or user inspects a feature document such as `docs/product/features/tts/playback-position.md`
- **THEN** the document contains the complete user-facing behavioral rules, entry points, settings, platform matrix, failure modes, troubleshooting steps, and related feature references.

### Requirement: Mandatory YAML frontmatter schema with stable feature IDs
Every product feature document SHALL contain structured YAML frontmatter matching a defined schema. Frontmatter MUST include: `id` (stable hierarchical identifier, e.g., `tts.word_highlighting`), `title`, `domain`, `status` (`implemented` | `partial` | `experimental` | `deprecated` | `planned`), `platforms` (array of `desktop-macos`, `desktop-windows`, `desktop-linux`, `mobile-android`, `mobile-ios`, `eink`), `summary`, `aliases` (synonyms and natural search vocabulary), `settings` (associated setting keys), `actions` (allowlisted executable action IDs), and `related` (related stable feature IDs).

#### Scenario: Stable ID decoupling from UI strings
- **WHEN** a UI button label or translation changes in the application
- **THEN** the canonical documentation maintains its stable `id` (e.g., `appearance.theme.eink`) and cross-references remain unbroken.

#### Scenario: Aliases support diverse user vocabulary
- **WHEN** a user searches using colloquial terms like "AirPods", "earbuds", or "media buttons"
- **THEN** the search matches the `aliases` metadata of `tts.headphone_controls` and `audio.media_controls`.

### Requirement: Comprehensive mandatory document sections
Each feature document SHALL include standardized markdown sections: `## Purpose`, `## User-Facing Behavior`, `## Entry Points`, `## Exact Behavioral Rules`, `## Rationale`, `## Settings & Defaults`, `## Platform Behavior`, `## Interactions & Dependencies`, `## Persistence & State Lifecycle`, `## Edge Cases & Limitations`, `## Failure Modes & Troubleshooting`, and `## Safe Actions`.

#### Scenario: Grounded explanation for "why" questions
- **WHEN** a user asks why an article reappeared in their queue or why TTS paused at a specific paragraph
- **THEN** the `## Rationale` and `## Exact Behavioral Rules` sections provide the precise algorithmic and architectural rationale without fabrication.

#### Scenario: Platform parity documentation
- **WHEN** a feature behaves differently across desktop, mobile, or e-ink (such as background audio playback or volume button scrolling)
- **THEN** the `## Platform Behavior` section explicitly details supported targets and platform-specific constraints.

### Requirement: Safe allowlisted action declarations
Feature documents MAY declare safe interactive UI actions in their frontmatter and markdown sections using registered action IDs (e.g., `action: settings.appearance.eink`). The documentation system and LLM help assistant SHALL NOT declare or trigger any action ID that is not pre-registered in the typed application action registry.

#### Scenario: Documented action button in help
- **WHEN** a feature document includes a registered action `settings.audio.hands_free`
- **THEN** the help system surfaces an interactive button allowing the user to navigate directly to that settings panel.
