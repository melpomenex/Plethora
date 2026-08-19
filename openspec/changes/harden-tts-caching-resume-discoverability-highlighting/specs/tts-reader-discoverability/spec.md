## ADDED Requirements

### Requirement: Listen affordance is always discoverable in the desktop reader

Every supported document surface (PDF, EPUB, Markdown, imported HTML/article) SHALL expose a visible, discoverable **Listen** (speaker) affordance in the reader chrome regardless of whether TTS is currently enabled or configured. The affordance MUST NOT be suppressed solely because `tts.enabled===false`. Opening the reader as the active tab or inside Queue surfaces with the same document types MUST both offer the affordance.

#### Scenario: TTS disabled yet Listen is visible

- **WHEN** a user opens a PDF, EPUB, Markdown, or HTML article and `tts.enabled===false` (the shipped default)
- **THEN** a Listen button is visible in the reader chrome without requiring the user to have visited Settings

#### Scenario: Unsupported types do not misleadingly show Listen

- **WHEN** the document type is `audio`, `video`, or `youtube` (the Audio Edition / media player path)
- **THEN** the Listen/TTS reader affordance is not shown in this spec's document-reader sense (the media player's own controls stay authoritative)

### Requirement: Unconfigured users see a lightweight setup flow, not a dead end

Clicking the Listen affordance when TTS is not configured/usable SHALL open a lightweight setup sheet (dialog/bottom sheet) rather than doing nothing or jumping directly into silent failure. The sheet SHALL present the lowest-friction immediate option first — **Use System Voice** when the device's Web Speech `speechSynthesis` is available — plus cloud provider choices populated dynamically from the existing `listAdapters()` registry (respecting platform filters: `pocket` only on Tauri desktop, `android` only on native mobile) annotated when an API key/setup is required, and a **Configure more…** link to the full **Settings → Text to Speech** surface. No credential collection or full provider configuration is duplicated inside the sheet.

#### Scenario: Zero-config immediate playback via System Voice

- **WHEN** a user clicks Listen with TTS unconfigured on a desktop where System TTS is available, then chooses "Use System Voice"
- **THEN** TTS is enabled with `provider:"system"` in one tap and playback begins at the current viewport anchor (no API key, no settings visit)

#### Scenario: Cloud provider requires configuration

- **WHEN** a user clicks Listen and selects a cloud provider (e.g., OpenRouter, Groq, Fal.ai) that needs a provider key or proxy
- **THEN** the sheet explains setup is needed and routes to **Settings → Text to Speech** with the provider pre-selected; the reader does not attempt synthesis without a valid configuration and does not surface a cryptic provider error as the first experience

#### Scenario: Dynamic provider list, not hardcoded

- **WHEN** a new provider adapter is added to `listAdapters()` or `TTS_PROVIDER_IDS`
- **THEN** the setup sheet picks it up automatically when its auth requirements and platform constraints are satisfied, without editing the sheet's provider enumeration

### Requirement: Enabled semantics are usable, not hidden

`tts.enabled` SHALL mean "TTS is configured and usable for playback in this reader" — not "entirely hide the TTS feature from the reader." When `tts.enabled` and `validateTTSConfiguration` are satisfied, the Listen button's action opens/starts (or resumes) the existing reader TTS controls (`ReaderTTSControls`) and its playback bar; when not satisfied, the same button opens the setup sheet. The full configuration experience remains owned by **Settings → Text to Speech** and is not duplicated inside the reader. Existing saved `tts.enabled=false` user preferences MUST remain valid (the reader simply offers the setup sheet on first click instead of hiding).

#### Scenario: Configured reader shows playback controls on click

- **WHEN** TTS is enabled and configured (System or a credentialed cloud provider) and the user clicks Listen
- **THEN** the existing TTS playback bar (`ReaderTTSControls`) opens/starts at the resolved start anchor (live viewport → authoritative position → listening checkpoint → saved position → start, per the exact-start spec) with the usual Play/Pause/Prev/Next/speed/voice/highlight controls

#### Scenario: Existing disabled users are offered onboarding

- **WHEN** a previously-saved `tts.enabled=false` user opens any supported document after this change
- **THEN** the reader shows the Listen affordance and, on click, offers the setup sheet (including System one-tap) rather than continuing to hide TTS

### Requirement: Desktop reader layout respects existing chrome

The Listen/TTS affordance and playback bar MUST NOT obscure document text, conflict with Queue controls (`QueueNavigationControls`), the minimap (`DocumentMinimap`), selection UI (`SelectionActionBar`/`SelectionActionsSheet`), or rating chips, and MUST behave consistently across desktop document tabs and Queue reader surfaces. The current `absolute z-40` floating placement that overlaps content is replaced by an in-chrome layout (e.g., top chrome flex row or footer-adjacent bar) integrated with the reader's native chrome.

#### Scenario: Controls do not overlap content

- **WHEN** the TTS playback bar is visible on a desktop tab alongside Queue navigation and minimap
- **THEN** the bar and its Listen trigger occupy the reader's chrome area; document text remains fully visible and scrollable, and no hit-targets overlap the minimap or selection toolbar

### Requirement: `tts.enabled=false` never breaks "Read from here"

The selection gesture "Read from here" (system's `SelectionBarAction` → TTS imperative handle, `src/components/viewer/selectionInteraction/SelectionActionBar.tsx`) MUST remain reachable when the document surface supports anchoring, even when `tts.enabled===false`, by routing the request through the same discovery/setup → play flow when the reader offers a usable path (e.g., System TTS available). Capability gating MUST be on document anchoring + at least one usable speech path, not on prior discovery of the global enable toggle.

#### Scenario: Select and read even when not yet enabled

- **WHEN** a user with `tts.enabled===false` makes a text selection on a supported Markdown page and invokes "Read from here"
- **THEN** a usable selection is not blocked solely because TTS was previously disabled; where a zero-config path (System voice) exists the system offers it and then reads continuously from the first selected word, and where no usable path exists it shows actionable guidance (not a dead-ended no-op)
