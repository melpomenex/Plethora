//! Configurable resource budgets and archive security limits.
//!
//! Rationale:
//! - Multi-year Apple Health `export.xml` files routinely exceed 50 MB and can reach 500 MB–1.5 GB.
//! - Streaming XML/CSV parsers use fixed-size buffers (~8-64 KiB) so memory stays bounded.
//! - Archive limits defend against ZIP bombs, entry floods, and unbounded disk/memory exhaustion
//!   while comfortably accommodating multi-year Google Takeout, Garmin, Oura, and Apple Health ZIPs.

#[derive(Debug, Clone, Copy)]
pub struct ArchiveSecurityLimits {
    /// Maximum number of entries in a ZIP central directory.
    pub max_entries: usize,
    /// Maximum uncompressed size of any single archive entry (1.5 GiB).
    pub max_single_entry_bytes: u64,
    /// Maximum cumulative uncompressed bytes read across selected entries in one import (2 GiB).
    pub max_total_expanded_bytes: u64,
    /// Maximum allowed uncompressed/compressed ratio once compressed size exceeds `ratio_floor_bytes`.
    pub max_compression_ratio: u64,
    /// Compressed byte threshold above which `max_compression_ratio` is enforced (1 MiB).
    pub ratio_floor_bytes: u64,
    /// Maximum nesting depth for archives (0 = reject nested .zip/.gz/.tar inside archives).
    pub max_nested_archive_depth: usize,
    /// Maximum length of a single normalized archive path.
    pub max_path_len: usize,
}

impl Default for ArchiveSecurityLimits {
    fn default() -> Self {
        Self {
            max_entries: 50_000,
            max_single_entry_bytes: 1536 * 1024 * 1024, // 1.5 GiB
            max_total_expanded_bytes: 2 * 1024 * 1024 * 1024, // 2 GiB
            max_compression_ratio: 120,
            ratio_floor_bytes: 1024 * 1024, // 1 MiB
            max_nested_archive_depth: 0,
            max_path_len: 512,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct StreamingParserLimits {
    /// Maximum CSV rows per file (2,000,000 rows).
    pub max_csv_rows: usize,
    /// Maximum single CSV field length (1 MiB) to prevent memory blowup on unclosed quotes.
    pub max_csv_field_bytes: usize,
    /// Maximum standalone JSON file size when parsed as DOM (256 MiB).
    pub max_json_bytes: u64,
    /// Maximum standalone XML file size when streamed (2 GiB).
    pub max_xml_bytes: u64,
}

impl Default for StreamingParserLimits {
    fn default() -> Self {
        Self {
            max_csv_rows: 2_000_000,
            max_csv_field_bytes: 1024 * 1024,
            max_json_bytes: 256 * 1024 * 1024,
            max_xml_bytes: 2 * 1024 * 1024 * 1024,
        }
    }
}
