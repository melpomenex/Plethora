//! Scratch baseline runner for openspec change `fix-pdf-extract-log-spam`
//! (task 1.1). Not part of the app; invoked manually before and after a
//! pdf-extract upgrade to compare extraction output:
//!
//! ```text
//! cargo run --example pdf_extract_baseline -- <output-dir> <pdf> [<pdf>...]
//! ```
//!
//! Writes `<stem>.full.txt` (whole-document text) and `<stem>.pages.txt`
//! (per-page text joined by `===PAGE===`) for each input PDF. Exit code is
//! always 0; callers diff the outputs between dependency versions.

use std::path::PathBuf;

fn main() {
    let mut args = std::env::args_os().skip(1);
    let Some(out_dir) = args.next().map(PathBuf::from) else {
        eprintln!("usage: pdf_extract_baseline <output-dir> <pdf> [<pdf>...]");
        std::process::exit(2);
    };
    std::fs::create_dir_all(&out_dir).expect("create output dir");

    for pdf in args {
        let pdf = PathBuf::from(pdf);
        let stem = pdf.file_stem().and_then(|s| s.to_str()).unwrap_or("doc");
        let Ok(bytes) = std::fs::read(&pdf) else {
            eprintln!("skip {}: unreadable", pdf.display());
            continue;
        };

        let full = pdf_extract::extract_text_from_mem(&bytes);
        let pages = pdf_extract::extract_text_from_mem_by_pages(&bytes);

        let full_path = out_dir.join(format!("{}.full.txt", stem));
        let pages_path = out_dir.join(format!("{}.pages.txt", stem));
        match full {
            Ok(text) => std::fs::write(&full_path, &text).expect("write full text"),
            Err(e) => std::fs::write(&full_path, format!("ERROR: {}", e)).expect("write full text"),
        }
        match pages {
            Ok(pages) => {
                std::fs::write(&pages_path, pages.join("===PAGE===")).expect("write pages text")
            }
            Err(e) => {
                std::fs::write(&pages_path, format!("ERROR: {}", e)).expect("write pages text")
            }
        }
        eprintln!(
            "{}: wrote {}.full.txt / {}.pages.txt",
            pdf.display(),
            stem,
            stem
        );
    }
}
