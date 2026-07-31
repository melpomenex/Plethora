## ADDED Requirements

> The capability id `tts-moss-provider` is retained for continuity with the
> directory name, but the requirements below describe the pivoted native Android
> TTS provider (`android`), not MOSS.

### Requirement: Native Android TTS registers as a local provider available on Android

The system SHALL register an `android` TTS provider on the existing adapter contract with `kind: "local"` and no credential requirement, and SHALL offer it on Android.

Unlike Pocket TTS, which is gated behind `isTauri() && !isNativeMobile()` because it depends on a shell sidecar, the native provider SHALL NOT be excluded on the basis of being mobile. The provider SHALL be hidden on desktop, where Pocket TTS remains the local option.

#### Scenario: Offered on Android

- **WHEN** the provider selector is shown in a native Android build
- **THEN** the native Android TTS provider appears as a selectable local provider

#### Scenario: Not offered on desktop

- **WHEN** the provider selector is shown on desktop
- **THEN** the native Android provider is hidden and Pocket TTS remains the local option, unchanged

#### Scenario: No credentials required

- **WHEN** the native provider is selected
- **THEN** configuration validation passes with no API key and no network request is made for synthesis

### Requirement: KittenTTS is the compact default model

The provider SHALL offer KittenTTS Micro (sherpa-onnx `kitten-nano`) as the default compact model — small enough to be the recommended first download — and SHALL treat it as the default selection when no model is installed.

#### Scenario: KittenTTS offered as default

- **WHEN** the user opens the model manager with no model installed
- **THEN** KittenTTS Micro is shown as the recommended default with its size and the option to download it

#### Scenario: KittenTTS downloads and speaks offline

- **WHEN** the user downloads KittenTTS and speaks a passage with no network connection
- **THEN** synthesis and playback complete entirely on device

### Requirement: Kokoro-82M is an optional higher-quality model

The provider SHALL offer Kokoro-82M as an optional, larger, higher-quality model that users install on demand. It SHALL NOT be downloaded by default.

#### Scenario: Kokoro installable, selectable, usable, removable

- **WHEN** the user installs Kokoro, selects it as the active model, speaks a passage, then removes it
- **THEN** each step succeeds, and after removal the model's files are gone and the provider falls back to KittenTTS (if installed) or System TTS

#### Scenario: Switching models at runtime

- **WHEN** the user switches the active model while the provider is configured
- **THEN** the next synthesis uses the newly selected model without an application reload

### Requirement: Voice selection

The provider SHALL enumerate each model's voices from the native runtime and SHALL let the user pick a voice per model.

#### Scenario: Voices reflect the installed model

- **WHEN** the user opens the voice picker for an installed model
- **THEN** the voices listed match the model's actual voice roster as reported by the native runtime

#### Scenario: Voice persists across sessions

- **WHEN** the user selects a voice and restarts the app
- **THEN** the previously selected voice is retained

### Requirement: Rate control

The provider SHALL honor a playback/synthesis rate and SHALL apply it to native synthesis.

#### Scenario: Rate applied to native synthesis

- **WHEN** the user sets a rate other than 1.0 and speaks
- **THEN** the generated audio reflects the requested rate

### Requirement: Multilingual synthesis where the model supports it

For models that support multiple languages, the provider SHALL synthesize input in any supported language without requiring the user to declare a language per request, since reading material is often mixed.

#### Scenario: Non-Latin script synthesis where supported

- **WHEN** a model that supports a non-Latin script is installed and text in that script is synthesized
- **THEN** audio is produced without additional configuration

#### Scenario: Chunking respects the model's limit

- **WHEN** text longer than the provider's declared limit is synthesized
- **THEN** it is chunked at sentence boundaries using the adapter's declared limit, consistent with the other providers

### Requirement: Pocket TTS desktop behavior is unchanged

The native Android provider SHALL NOT alter Pocket TTS availability, configuration, or behavior on desktop. Pocket SHALL remain gated behind `isTauri() && !isNativeMobile()`.

#### Scenario: Pocket unchanged on desktop

- **WHEN** the provider selector is shown on desktop
- **THEN** Pocket TTS appears exactly as before this change, with no new gating or dependency introduced by the native provider

#### Scenario: No desktop code path invokes the native plugin

- **WHEN** the application runs on desktop
- **THEN** the native Android plugin is neither loaded nor invoked, and Pocket synthesis is unaffected
