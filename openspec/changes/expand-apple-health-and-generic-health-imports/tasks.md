## 1. Large Apple Health & Generic CSV

- [x] 1.1 Implement streaming `apple_health.rs` supporting both `export.xml` and `export.zip` (`apple_health_export/export.xml`) above 50 MB with bounded memory, XXE protection, progress, and cancellation.
- [x] 1.2 Implement RFC-4180 `generic_csv.rs` supporting BOM, multiline quoted fields, alternate delimiters, expanded sleep/biometric columns, and formula-injection defense.
- [x] 1.3 Implement `CsvMappingProfile` persistence and preview/parse integration for unrecognized CSVs.
- [x] 1.4 Preserve Plethora JSON v1 and `.plethora-health.enc` compatibility in `plethora_json.rs`.
- [x] 1.5 Add unit and large-file streaming tests for >50 MB synthetic Apple Health XML and complex CSV edge cases.
