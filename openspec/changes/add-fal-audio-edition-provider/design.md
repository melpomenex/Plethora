## Context

See `proposal.md` for motivation.

Plethora currently includes a robust `falAdapter` (`src/api/tts/providers/fal.ts`) that communicates with Fal.ai endpoints for speech synthesis, supports custom voice cloning via speaker file URLs, normalizes word timestamps, and is covered by the billing safety consent gate (`isPaidTtsProvider`).

However, in `CreateAudioEditionDialog.tsx`:
- The primary "Quality & Voice Profile" tier selector only renders 4 preset buttons: Fast (Pocket), Natural (OpenAI), Best (ElevenLabs), and Expressive (Chatterbox).
- In the "Advanced Settings" dropdown, the provider `<select>` only lists Pocket, OpenRouter, ElevenLabs, OpenAI, Chatterbox, and System Default, despite `handleProviderChange` containing an unlinked case for `"fal"`.
- Speed control does not account for Fal.ai's lack of a speed parameter (`falAdapter.capabilities.supportsSpeed: false`).

## Goals / Non-Goals

**Goals:**
- Provide a prominent Fal.ai choice in `CreateAudioEditionDialog` on both mobile and desktop:
  - In the primary Quality & Voice Profile selector as a distinct "Fal.ai" profile card.
  - In the Advanced Settings Provider dropdown as "Fal.ai (Cloud)".
- Support Fal.ai built-in voices (`Vivian`, `Serena`, `Dylan`, `Eric`, etc.) and user-configured custom/cloned profiles.
- Disable speed controls with helpful explanatory text when Fal.ai is active, while keeping voice instructions enabled.
- Ensure the layout is responsive, touch-friendly, and non-clipping on mobile devices and desktop.
- Enforce billing safety consent (`requestPaidConsent`) and accurate pre-flight cost estimations ($0.02 / 1k chars).

**Non-Goals:**
- Adding new Fal.ai endpoints or modifying the core `falAdapter` wire protocol.
- Modifying reader read-aloud TTS UI (scoped to Audio Edition creation).
- Adding offline local model execution for Fal (Fal is strictly a cloud provider).

## Decisions

### Decision 1: Add "Fal.ai" as a primary Quality & Voice Profile preset
- **Choice**: Add `"fal"` to the `QualityPreset` type (`"fast" | "natural" | "best" | "expressive" | "fal" | "custom"`) and render a dedicated preset card alongside Fast, Natural, Best, and Expressive.
- **Rationale**: The user prompt specifically asks for the choice to use Fal.ai as well as the options already available (OpenAI, ElevenLabs, etc.). Because OpenAI and ElevenLabs are featured as primary preset cards, Fal.ai must be directly accessible from the primary tier selection without requiring the user to find and open Advanced Settings.
- **Alternatives Considered**:
  - *Only add to Advanced dropdown*: Rejected; hides Fal.ai behind a collapsible toggle, creating unequal discoverability compared to OpenAI and ElevenLabs.

### Decision 2: Responsive grid layout for mobile and desktop
- **Choice**: Update the preset cards grid from `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` to `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` with compact padding and touch targets.
- **Rationale**: On mobile screens (360px–420px viewport width), stacking 5 large cards in a single column consumes over 400px of vertical height, forcing the user to scroll excessively to reach the voice selector and action buttons. A 2-column layout on mobile fits 5 cards comfortably within ~220px of height.
- **Alternatives Considered**:
  - *Keep `grid-cols-1` on mobile*: Causes extreme vertical bloat and awkward scrolling inside the modal on small phone screens.
  - *Horizontal carousel on mobile*: Risk of users missing options scrolled out of view.

### Decision 3: Capability-based parameter constraint gating
- **Choice**: When Fal.ai is active (`provider === "fal"`), disable the speed slider and display helper text: "Speed is not supported by Fal.ai models and is ignored." Keep custom prompt / voice instructions enabled since Fal models support prompts.
- **Rationale**: `falAdapter.capabilities.supportsSpeed` is `false`. Attempting to send a speed parameter has no effect on Fal models and confuses the user if the audition sounds unchanged.

### Decision 4: Reuse existing Fal billing defaults and consent gate
- **Choice**: Keep the existing `$0.02 / 1k chars` pricing in `PROVIDER_PRICING_DEFAULTS.fal` and existing `isPaidTtsProvider("fal")` consent gate.
- **Rationale**: Already implemented and tested in `audioEditionEstimation.ts` and `aiBillingConsent.ts`. No new billing mechanisms required.

## Risks / Trade-offs

- **[Risk: Missing API key on audition or generation]** → **Mitigation**: `resolveProviderKey` detects missing keys. In direct mode, `invokeFalModel` throws a validation error that surfaces in the dialog's inline error banner without breaking the UI.
- **[Risk: Unconsented cloud API billing]** → **Mitigation**: `isPaidTtsProvider("fal")` triggers `requestPaidConsent` before any audition or generation job starts, preventing accidental charges.
- **[Risk: Touch target size on small screens with 5 cards]** → **Mitigation**: In a 2-column mobile layout, each card maintains at least 44px touch height, clear active borders (`ring-2 ring-primary/20`), and legible font sizing.
