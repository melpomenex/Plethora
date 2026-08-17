//! Dev-only scratch diagnostics for figure-geometry work (Piece B).
//! Measures how much of the analysis raster's ink is covered by text-line
//! bounding boxes (with configurable pixel expansion), and what connected
//! components remain after subtraction — the leak that produces sub-glyph
//! noise visual blocks on pure-text pages.
//!
//! Usage:
//!   cargo run --release --example figdiag -- debug/gauntlet/inputs/<file>.json [expand]

use base64::Engine as _;
use plethora_tauri_lib::pdf::analysis::raster::{PageInkMask, PageRaster};
use plethora_tauri_lib::pdf::analysis::rows::band_lines;
use plethora_tauri_lib::pdf::analysis::words::extract_words;
use plethora_tauri_lib::pdf::analysis::TextItemInput;
use plethora_tauri_lib::pdf::coordinates::RasterGeometry;

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("input json path");
    let expand: i64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(1);

    let raw = std::fs::read_to_string(&path).unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let raster_png = value
        .get_mut("rasterPngBase64")
        .map(|v| v.take())
        .and_then(|v| v.as_str().map(str::to_owned))
        .map(|s| {
            base64::engine::general_purpose::STANDARD
                .decode(s.as_bytes())
                .unwrap()
        });
    let request: serde_json::Value = serde_json::from_str(
        &serde_json::to_string(&serde_json::to_value(&value).unwrap()).unwrap(),
    )
    .unwrap();
    let page_width = request["pageWidth"].as_f64().unwrap();
    let page_height = request["pageHeight"].as_f64().unwrap();
    let rotation = request["rotation"].as_u64().unwrap_or(0) as u16;
    let scale = request["rasterScale"].as_f64().unwrap();
    let items: Vec<TextItemInput> = serde_json::from_value(request["textItems"].clone()).unwrap();

    let mask = PageInkMask::from_png(&raster_png.expect("raster")).unwrap();
    let geometry = RasterGeometry::new(
        mask.width,
        mask.height,
        scale,
        rotation,
        page_width,
        page_height,
    );
    let raster = PageRaster {
        mask: mask.clone(),
        geometry,
    };
    println!(
        "page {}x{} rot {} scale {} raster {}x{} ink {}",
        page_width, page_height, rotation, scale, mask.width, mask.height, mask.total_ink
    );

    let words = extract_words(&items);
    let lines = band_lines(&words);
    println!(
        "{} words, {} lines (single-column approximation)",
        words.len(),
        lines.len()
    );

    // Ink rows per line: for each line, look at raster rows in the line's
    // x-extent and find inked rows outside the line's bbox rows.
    let mut worst_above: Vec<(i64, usize)> = Vec::new(); // (px above bbox, line idx)
    let mut worst_below: Vec<(i64, usize)> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let rect = geometry.pdf_rect_to_raster(&line.bbox);
        let x0 = (rect.x.floor() as i64).max(0) as u32;
        let x1 = ((rect.x + rect.width).ceil() as i64).min(mask.width as i64) as u32;
        let by0 = rect.y.round() as i64;
        let by1 = (rect.y + rect.height).round() as i64;
        let mut top_ink: i64 = i64::MIN;
        let mut bottom_ink: i64 = i64::MAX;
        for y in 0..mask.height {
            let mut inked = false;
            for x in x0..x1 {
                if mask.is_inked(x, y) {
                    inked = true;
                    break;
                }
            }
            if inked {
                top_ink = top_ink.max(y as i64);
                bottom_ink = bottom_ink.min(y as i64);
            }
        }
        if top_ink > i64::MIN && !x0.eq(&x1) {
            let above = by0 - top_ink; // positive: ink higher than bbox top
            let below = bottom_ink - by1; // positive: ink lower than bbox bottom
            if above > 0 {
                worst_above.push((above, i));
            }
            if below > 0 {
                worst_below.push((below, i));
            }
        }
    }
    worst_above.sort_by(|a, b| b.0.cmp(&a.0));
    worst_below.sort_by(|a, b| b.0.cmp(&a.0));
    println!(
        "lines with ink ABOVE bbox top: {} (max {}px) | BELOW bbox bottom: {} (max {}px)",
        worst_above.len(),
        worst_above.first().map(|t| t.0).unwrap_or(0),
        worst_below.len(),
        worst_below.first().map(|t| t.0).unwrap_or(0),
    );
    for &(px, i) in worst_above.iter().take(5) {
        println!(
            "  above {}px: line {} bbox {:?} text {:?}",
            px,
            i,
            lines[i].bbox,
            lines[i]
                .word_indices
                .iter()
                .take(4)
                .map(|&w| &words[w].text)
                .collect::<Vec<_>>()
        );
    }
    for &(px, i) in worst_below.iter().take(5) {
        println!(
            "  below {}px: line {} bbox {:?} text {:?}",
            px,
            i,
            lines[i].bbox,
            lines[i]
                .word_indices
                .iter()
                .take(4)
                .map(|&w| &words[w].text)
                .collect::<Vec<_>>()
        );
    }

    // Stage dump: regions before/after attach_captions (approximate
    // single-column lines; enough to debug growth/overlap behavior).
    if std::env::var("STAGES").is_ok() {
        let median = {
            let mut hs: Vec<f64> = lines.iter().map(|l| l.line_height).collect();
            hs.sort_by(|a, b| a.total_cmp(b));
            hs.get(hs.len() / 2).copied().unwrap_or(10.0)
        };
        let mut regions = plethora_tauri_lib::pdf::analysis::figures::detect_visual_regions(
            Some(&raster),
            &lines,
            median,
        );
        println!("--- detect_visual_regions: {} regions", regions.len());
        for r in &regions {
            println!(
                "  raw {:.1}x{:.1} bbox=({:.0},{:.0},{:.0},{:.0})",
                r.bbox.width(),
                r.bbox.height(),
                r.bbox.x0,
                r.bbox.y0,
                r.bbox.x1,
                r.bbox.y1
            );
        }
        plethora_tauri_lib::pdf::analysis::figures::attach_captions(
            &mut regions,
            &lines,
            median,
            |l| {
                l.word_indices
                    .iter()
                    .map(|&w| words[w].text.clone())
                    .collect::<Vec<_>>()
                    .join(" ")
            },
        );
        println!("--- after attach_captions: {} regions", regions.len());
        for r in &regions {
            println!(
                "  final {:.1}x{:.1} bbox=({:.0},{:.0},{:.0},{:.0}) cap={:?}",
                r.bbox.width(),
                r.bbox.height(),
                r.bbox.x0,
                r.bbox.y0,
                r.bbox.x1,
                r.bbox.y1,
                r.caption.as_deref().map(|s| &s[..s.len().min(30)])
            );
        }
    }

    // Subtraction coverage with the given expansion.
    let mut non_text = mask.ink.clone();
    let mut covered = 0u64;
    for line in &lines {
        let rect = geometry.pdf_rect_to_raster(&line.bbox);
        let x0 = ((rect.x.floor() as i64 - expand).max(0)) as u32;
        let y0 = ((rect.y.floor() as i64 - expand).max(0)) as u32;
        let x1 = ((rect.x + rect.width).ceil() as i64 + expand).min(mask.width as i64) as u32;
        let y1 = ((rect.y + rect.height).ceil() as i64 + expand).min(mask.height as i64) as u32;
        for y in y0..y1 {
            for x in x0..x1 {
                let idx = y as usize * mask.width as usize + x as usize;
                if non_text[idx] == 1 {
                    non_text[idx] = 0;
                    covered += 1;
                }
            }
        }
    }
    let leftover = mask.total_ink - covered;
    println!(
        "expand {}px: covered {} / {} ink px ({:.2}%), leftover {} px",
        expand,
        covered,
        mask.total_ink,
        100.0 * covered as f64 / mask.total_ink as f64,
        leftover
    );

    // Classify leftover pixels: inside some line bbox (x AND y) but ink
    // outside the subtracted rect? Or outside every line bbox?
    let mut inside_bbox = 0u64;
    let mut near_vert = 0u64; // within line's y-range ±2 but outside x-extent
    let mut far = 0u64;
    let mut far_samples: Vec<(u32, u32)> = Vec::new();
    for y in 0..mask.height {
        for x in 0..mask.width {
            let idx = y as usize * mask.width as usize + x as usize;
            if non_text[idx] != 1 {
                continue;
            }
            let px = x as f64 + 0.5;
            let py = y as f64 + 0.5;
            let mut in_bbox = false;
            let mut near_v = false;
            for line in &lines {
                let r = geometry.pdf_rect_to_raster(&line.bbox);
                if px >= r.x - 2.0
                    && px <= r.x + r.width + 2.0
                    && py >= r.y - 2.0
                    && py <= r.y + r.height + 2.0
                {
                    if px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height {
                        in_bbox = true;
                    } else {
                        near_v = true;
                    }
                    break;
                }
            }
            if in_bbox {
                inside_bbox += 1;
            } else if near_v {
                near_vert += 1;
            } else {
                far += 1;
                if far_samples.len() < 40 {
                    far_samples.push((x, y));
                }
            }
        }
    }
    println!(
        "leftover classification: inside-line-bbox {} | within 2px of a line bbox {} | FAR (no line within 2px) {}",
        inside_bbox, near_vert, far
    );
    if !far_samples.is_empty() {
        println!("  far samples (x,y): {:?}", far_samples);
        // Which lines are nearest to the first few far pixels?
        for &(x, y) in far_samples.iter().take(6) {
            let mut best: Option<(f64, usize)> = None;
            for (i, line) in lines.iter().enumerate() {
                let r = geometry.pdf_rect_to_raster(&line.bbox);
                let dx = if px_lt(x, r.x) {
                    r.x - x as f64
                } else if gt(x as f64, r.x + r.width) {
                    x as f64 - (r.x + r.width)
                } else {
                    0.0
                };
                let dy = if (y as f64) < r.y {
                    r.y - y as f64
                } else if (y as f64) > r.y + r.height {
                    y as f64 - (r.y + r.height)
                } else {
                    0.0
                };
                let d = dx.max(dy);
                if best.map_or(true, |(bd, _)| d < bd) {
                    best = Some((d, i));
                }
            }
            if let Some((d, i)) = best {
                println!(
                    "  far px ({},{}) nearest line {} dist {:.1}px bbox {:?} words {:?}",
                    x,
                    y,
                    i,
                    d,
                    lines[i].bbox,
                    lines[i]
                        .word_indices
                        .iter()
                        .take(3)
                        .map(|&w| &words[w].text)
                        .collect::<Vec<_>>()
                );
            }
        }
    }
}

fn px_lt(x: u32, rx: f64) -> bool {
    (x as f64) < rx
}
fn gt(v: f64, hi: f64) -> bool {
    v > hi
}
// (stage dump mode handled in main via env flag below)
