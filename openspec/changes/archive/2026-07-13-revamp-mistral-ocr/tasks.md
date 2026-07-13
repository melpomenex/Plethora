## 1. Backend Setup and Types

- [x] 1.1 Add `pulldown-cmark` dependency to `src-tauri/Cargo.toml`
- [x] 1.2 Add `Mistral` to `OCRProviderType` enum in `src-tauri/src/ocr/providers.rs` and map its serialization to `"mistral"`
- [x] 1.3 Add `MistralOCRConfig` and the `mistral_ocr` field to `OCRConfig` in `src-tauri/src/ocr/mod.rs`
- [x] 1.4 Update the `OCRConfig` interface and nested `MistralOCRConfig` in `src/api/ocrCommands.ts`

## 2. Core OCR Provider Implementation

- [x] 2.1 Implement the `MistralProvider` struct in `src-tauri/src/ocr/providers.rs`
- [x] 2.2 Write Mistral API communication logic (multipart/form-data upload to `/v1/files`, `/v1/ocr` request, and `/v1/files/{file_id}` deletion)
- [x] 2.3 Add Markdown-to-HTML conversion using `pulldown-cmark` inside `MistralProvider`
- [x] 2.4 Wire `MistralProvider` inside `create_provider` and availability checks in `src-tauri/src/ocr/providers.rs` and `processor.rs`

## 3. Tauri Commands and Frontend Integration

- [x] 3.1 Update provider parsing and default formats in `src-tauri/src/commands/ocr.rs`
- [x] 3.2 Update settings types in `src/types/settings.ts`, the settings store defaults/validation in `src/stores/settingsStore.ts`, and Zod validation in `src/utils/settingsValidation.ts`
- [x] 3.3 Add Mistral OCR option, icon, description, and settings form for Mistral API Key inside `src/components/settings/OCRSettings.tsx`
- [x] 3.4 Verify the compiled build and run unit/E2E test validation
