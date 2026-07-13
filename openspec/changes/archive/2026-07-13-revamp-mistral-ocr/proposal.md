## Why

The current OCR system lacks integration with modern state-of-the-art vision/OCR language models. Mistral AI provides a powerful OCR API (`mistral-ocr-latest`) capable of high-fidelity document structure and formatting extraction. Integrating it will allow users to convert scanned documents or image-only PDFs into clean, readable formatting, rendered natively within the application.

## What Changes

- **Mistral OCR Integration**: Implement a new `Mistral` provider type in the Tauri Rust backend using Mistral's official API (`https://api.mistral.ai/v1/files` and `https://api.mistral.ai/v1/ocr`).
- **Markdown-to-HTML Conversion**: Convert the Markdown output returned by Mistral OCR into structured HTML using the `pulldown-cmark` library, allowing it to render seamlessly in the HTML viewer/iframe within the app.
- **Settings UI Enhancement**: Add Mistral OCR to the list of OCR providers in Settings, exposing input fields for configuring the Mistral API Key.
- **Cleanup Policy**: Ensure uploaded files to Mistral's storage for OCR purposes are promptly cleaned up/deleted via the API after processing is complete.

## Capabilities

### New Capabilities
- `mistral-ocr-integration`: Support high-quality cloud-based OCR using Mistral OCR API with Markdown-to-HTML conversion on the backend.

### Modified Capabilities
<!-- Leave empty as we are adding a brand new provider configuration rather than altering existing core specs -->

## Impact

- **Rust Backend**:
  - `src-tauri/Cargo.toml`: Add `pulldown-cmark` crate.
  - `src-tauri/src/ocr/mod.rs`: Add `MistralOCRConfig` and `Mistral` provider enum variant.
  - `src-tauri/src/ocr/providers.rs`: Implement `MistralProvider` with file upload, OCR execution, and file deletion.
  - `src-tauri/src/commands/ocr.rs`: Update commands to handle Mistral and format outputs as `"html"`.
- **TypeScript Frontend**:
  - `src/types/settings.ts` & `src/stores/settingsStore.ts`: Include `mistral` settings and type declarations.
  - `src/components/settings/OCRSettings.tsx`: Update provider selection UI and display API Key fields for Mistral OCR.
  - `src/api/ocrCommands.ts`: Update TypeScript types to match the updated Rust `OCRConfig`.
