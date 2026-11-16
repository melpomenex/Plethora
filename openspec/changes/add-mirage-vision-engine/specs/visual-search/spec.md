## ADDED Requirements

### Requirement: Visual Semantic Search & Auto-Tagging (SQLite FTS5)
The system SHALL run a background worker on newly ingested images to index Mirage's scene description, detected object names/attributes, and OCR text into a dedicated SQLite FTS5 table (`image_visual_search_fts`), and expose visual queries in Plethora's search UI.

#### Scenario: Background indexing populates FTS5 and auto-tags
- **WHEN** an image asset is indexed by the Mirage search worker
- **THEN** `image_visual_metadata` and `image_visual_search_fts` are populated with scene description, object names/attributes, OCR text, and generated tags

#### Scenario: Unified search returns visual matches
- **WHEN** a user searches for `"red circuit diagram"` or `"handwritten equation"` in `palette_search` or `GlobalSearch`
- **THEN** matching image assets are returned with their scene snippet and tags
