## Why

When creating an Audio Edition, users can currently choose between several TTS quality tiers and providers (Pocket TTS, OpenAI, ElevenLabs, Chatterbox Turbo). However, while Plethora already includes a full Fal.ai cloud TTS adapter supporting high-fidelity speech synthesis, cloned voices, and pre-flight billing estimation, Fal.ai is missing from both the primary quality options and the Advanced provider selection dropdown in the Audio Edition creation dialog.

Adding Fal.ai gives users on both mobile and desktop the ability to generate long-form document audio editions using Fal.ai's neural models and custom voice clones with transparent cost estimation, voice auditioning, and safety consent gates.

## What Changes

- Add Fal.ai as a first-class choice when creating an Audio Edition:
  - Add a dedicated "Fal.ai" profile option alongside Fast (Pocket), Natural (OpenAI), Best (ElevenLabs), and Expressive (Chatterbox) in the primary quality and voice profile selector.
  - Add Fal.ai (`fal`) to the Advanced Settings Provider dropdown so it is explicitly selectable on both desktop and mobile viewports.
- Populate Fal.ai built-in voices (`Vivian`, `Serena`, `Dylan`, `Eric`, etc.) and any user-configured custom/cloned voice profiles from settings when Fal.ai is selected.
- Gate unsupported parameters cleanly: disable the speed slider with clear explanatory feedback when Fal.ai is selected (matching adapter capabilities where speed is not supported), while keeping voice instructions enabled.
- Ensure the creation dialog's layout remains responsive, touch-friendly, and non-clipping across mobile devices and desktop window sizes when rendering all available provider options.
- Integrate Fal.ai pre-flight character count and cost estimation ($0.02 / 1k chars default) and enforce the existing paid TTS billing consent gate prior to audition or full edition generation.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `audio-edition-generation`: Add Fal.ai to the supported quality presets and provider options for Audio Edition synthesis, voice auditioning, and cost estimation.
- `audio-edition-generation-dialog`: Surface Fal.ai in the dialog's quality selector and Advanced provider dropdown with responsive mobile and desktop layout, voice roster, and parameter constraint handling.

## Impact

- `src/components/audio/CreateAudioEditionDialog.tsx`: Primary dialog component updated with Fal.ai preset/provider options, responsive grid styling, voice listing, and speed disabling.
- `src/types/audioEdition.ts`: Update `QualityPreset` type to include `"fal"` option.
- `src/components/audio/__tests__/CreateAudioEditionDialog.test.tsx`: Unit tests verifying Fal.ai selection, voice enumeration, audition requests, parameter disabling, and job dispatch.
