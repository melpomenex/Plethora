## Context

Incrementum has a legacy third-party collection .zip import feature with three independent failure points:

1. **Dead backend**: `src-tauri/src/legacy_third_party_import.rs` defines `import_legacy_third_party_package` and `validate_legacy_third_party_package` Tauri commands, but `mod legacy_third_party_import;` is missing from `lib.rs` and neither command is in `generate_handler![]`. The code never compiles.

2. **Unwired frontend**: `src/routes/documents.tsx` → `handleImportFromPicker` only handles `url`, `arxiv`, `local`. The `legacy-third-party` source falls through silently — no error, no feedback, no import.

3. **Fragile XML parser**: The existing Rust code uses string-based `find()` calls for XML tag extraction. This breaks on CDATA sections, nested tags, namespaced elements, and encoding edge cases common in legacy third-party collection exports.

The algorithm implementations (Plethora Classic, Plethora Adaptive, Plethora Precision) are all fully functional — this is purely about the import pipeline.

## Goals / Non-Goals

**Goals:**
- Make the legacy third-party collection .zip import end-to-end functional
- Use a proper XML parser (`quick-xml`) for robust parsing
- Wire the frontend to show import progress and navigate to imported documents
- Preserve existing learning data (interval, repetitions, easiness) as metadata on imported documents

**Non-Goals:**
- Media file extraction/import (deferred — current code already lists media files)
- Incrementum→legacy third-party collection export
- Support for non-XML legacy third-party collection export formats
- Algorithm migration (imported items start with default scheduling state, not converted from SM intervals)

## Decisions

### 1. Use `quick-xml` instead of string-based parsing

**Choice**: Replace manual `find()` tag extraction with `quick-xml` for proper XML event-based parsing.

**Alternatives considered**:
- Keep string parsing: Too fragile, breaks on real legacy third-party collection exports that use CDATA, HTML content, or malformed XML
- `roxmltree`: DOM-based, loads entire file into memory — fine for legacy third-party collection exports but `quick-xml` is already more widely used in the Rust ecosystem
- `serde_xml_rs`: Requires compile-time schema knowledge; Plethora XML varies by version

**Rationale**: `quick-xml` handles CDATA, namespaces, encoding, and malformed XML gracefully via event iteration. It's zero-copy where possible and well-maintained.

### 2. Frontend flow: import into document store, not a separate utility

**Choice**: Use the existing `useDocumentStore` flow — call `importPlethoraPackage` to parse the .zip, then `convertPlethoraCollectionToDocuments` and feed documents through the store's existing import pipeline.

**Rationale**: `legacyThirdPartyImport.ts` already has the conversion logic. The store handles deduplication, indexing, and navigation. No need for a parallel import path.

### 3. Keep `legacyThirdPartyImport.ts` utility layer

**Choice**: Keep the TypeScript utility as-is (it's already well-structured). Just wire it into the import handler.

**Rationale**: The utility already handles validation, parsing, conversion to documents and learning items. It just needs to be called.

### 4. Rename module to `legacy_third_party_import` to avoid confusion with `algorithms::legacy-third-party`

**Choice**: Rename `src-tauri/src/legacy_third_party_import.rs` → `src-tauri/src/legacy_third_party_import.rs` and declare as `mod legacy_third_party_import;`.

**Rationale**: There are two `classic.rs` files — one at `src-tauri/src/legacy_third_party_import.rs` (import) and one at `src-tauri/src/algorithms/classic.rs` (scheduling algorithms). The module name `legacy_third_party_import` avoids clash or cause confusion. `legacy_third_party_import` clearly distinguishes the import module.

## Risks / Trade-offs

- **[Plethora XML format variability]** → `quick-xml` event-based parsing is flexible, but unknown XML structures will fall through to the generic handler. Mitigation: Log unrecognized structures and return items with raw content so users don't lose data.
- **[Large .zip files]** → Current implementation reads all files into memory. Acceptable for typical Plethora collections (usually < 100MB). Not worth adding streaming complexity.
- **[HTML in XML content]** → Plethora often embeds HTML inside XML elements (rich text, images). The parser will preserve this as-is in the content field. Rendering is handled by Incrementum's existing document viewer which supports HTML.
