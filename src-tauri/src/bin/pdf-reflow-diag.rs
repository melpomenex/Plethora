//! Dev-only PDF reflow diagnostic runner (NO Tauri runtime).
//!
//! Reads the JSON files the frontend collector
//! (`src/components/viewer/pdfCanonicalCollector.ts`) produces — the exact
//! wire format the `pdf_reflow_analyze_page` command receives (camelCase,
//! `rasterPngBase64`) — decodes the raster, and calls the REAL
//! `pdf::analysis::analyze_page` directly, writing the canonical page JSON
//! next to the requested output dir.
//!
//! Usage:
//!   cargo run --bin pdf-reflow-diag -- \
//!     --input-dir debug/gauntlet/inputs --output-dir debug/gauntlet/pages
//!
//! One `*.json` file per page in `--input-dir`; output file name is
//! `<input-stem>.canonical.json`. Exit code 1 if any page fails; per-page
//! errors are recorded in `<stem>.error.txt` instead of aborting the batch.

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine as _;
use plethora_tauri_lib::pdf::analysis::{analyze_page, PageAnalysisRequest};

fn usage() -> ! {
    eprintln!("usage: pdf-reflow-diag --input-dir <dir> --output-dir <dir> [--pretty]");
    std::process::exit(2);
}

fn main() {
    let mut input_dir: Option<PathBuf> = None;
    let mut output_dir: Option<PathBuf> = None;
    let mut pretty = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--input-dir" => input_dir = args.next().map(PathBuf::from),
            "--output-dir" => output_dir = args.next().map(PathBuf::from),
            "--pretty" => pretty = true,
            _ => usage(),
        }
    }
    let input_dir = input_dir.unwrap_or_else(|| usage());
    let output_dir = output_dir.unwrap_or_else(|| usage());

    fs::create_dir_all(&output_dir).expect("create output dir");

    let mut entries: Vec<PathBuf> = fs::read_dir(&input_dir)
        .unwrap_or_else(|e| panic!("read input dir {}: {e}", input_dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|ext| ext == "json"))
        .collect();
    entries.sort();

    if entries.is_empty() {
        eprintln!("no *.json inputs in {}", input_dir.display());
        std::process::exit(1);
    }

    let mut failures = 0usize;
    for path in &entries {
        let stem = path.file_stem().unwrap().to_string_lossy().to_string();
        let out_path = output_dir.join(format!("{stem}.canonical.json"));
        match run_one(path) {
            Ok(page_json) => {
                let text = if pretty {
                    serde_json::to_string_pretty(&page_json).expect("serialize page")
                } else {
                    serde_json::to_string(&page_json).expect("serialize page")
                };
                fs::write(&out_path, text).expect("write canonical json");
                eprintln!(
                    "[pdf-reflow-diag] {stem}: ok ({} blocks, classification {:?}) -> {}",
                    page_json["blocks"].as_array().map(|a| a.len()).unwrap_or(0),
                    page_json["classification"].as_str().unwrap_or("?"),
                    out_path.display()
                );
            }
            Err(error) => {
                failures += 1;
                eprintln!("[pdf-reflow-diag] {stem}: FAILED: {error}");
                let _ = fs::write(
                    output_dir.join(format!("{stem}.error.txt")),
                    format!("{error}\n"),
                );
            }
        }
    }

    if failures > 0 {
        eprintln!(
            "[pdf-reflow-diag] {failures}/{} page(s) failed",
            entries.len()
        );
        std::process::exit(1);
    }
    eprintln!(
        "[pdf-reflow-diag] analyzed {} page(s) -> {}",
        entries.len(),
        output_dir.display()
    );
}

/// Decode one collected-input file and run the real analyzer.
///
/// The input is the same camelCase JSON the Tauri command receives; the
/// raster arrives as base64 PNG, which `PageAnalysisRequest` skips
/// (`#[serde(skip)] raster_png`), so it is split out before deserializing
/// the rest into the request struct.
fn run_one(path: &Path) -> Result<serde_json::Value, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let mut value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("parse JSON: {e}"))?;

    let raster_png = match value
        .get_mut("rasterPngBase64")
        .map(|v| v.take())
        .and_then(|v| v.as_str().map(str::to_owned))
    {
        None => None,
        Some(encoded) => Some(
            base64::engine::general_purpose::STANDARD
                .decode(encoded.as_bytes())
                .map_err(|e| format!("rasterPngBase64 is not valid base64: {e}"))?,
        ),
    };

    let mut request: PageAnalysisRequest =
        serde_json::from_value(value).map_err(|e| format!("decode PageAnalysisRequest: {e}"))?;
    request.raster_png = raster_png;

    let started = std::time::Instant::now();
    // Panics are caught per page: an analyzer panic on one page (a real
    // pipeline bug — e.g. a non-total-order sort comparator) must not abort
    // the whole diagnostic batch. The default panic hook still prints the
    // panic to stderr; we additionally capture the payload per page.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| analyze_page(&request)))
        .map_err(|payload| {
            let msg = payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown panic payload".to_string());
            format!("PANIC in analyze_page: {msg}")
        })?;
    let page = result.map_err(|e| format!("analyze_page: {e}"))?;
    eprintln!(
        "[pdf-reflow-diag]   page {} analyzed in {:?}",
        request.page_number,
        started.elapsed()
    );
    serde_json::to_value(&page).map_err(|e| format!("serialize page: {e}"))
}
