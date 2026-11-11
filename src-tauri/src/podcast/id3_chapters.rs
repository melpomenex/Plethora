//! Embedded ID3v2 and MP4 / M4A / M4B chapter extractor.
//!
//! Supports:
//! - ID3v2 `CHAP` (Chapter) and `CTOC` (Table of Contents) frames in MP3 files
//!   (ID3v2 Chapter Frame Addendum: https://id3.org/id3v2-chapters-1.0)
//! - QuickTime / MP4 `chpl` (Chapter List) atoms in M4A, M4B, and MP4 files

use crate::models::podcast_ad::{ChapterSource, PodcastChapter};
use crate::podcast::parser::is_sponsor_title;
use std::fs::File;
use std::io::Read;
use std::path::Path;

/// Parse a syncsafe 32-bit integer (7 bits per byte)
fn parse_syncsafe_u32(b: &[u8]) -> u32 {
    if b.len() < 4 {
        return 0;
    }
    ((b[0] as u32 & 0x7F) << 21)
        | ((b[1] as u32 & 0x7F) << 14)
        | ((b[2] as u32 & 0x7F) << 7)
        | (b[3] as u32 & 0x7F)
}

/// Decode string from ID3 text encoding byte
fn decode_id3_string(encoding: u8, bytes: &[u8]) -> String {
    match encoding {
        0 => {
            // ISO-8859-1 (Latin-1)
            bytes.iter().map(|&c| c as char).collect()
        }
        1 => {
            // UTF-16 with BOM
            if bytes.len() >= 2 {
                let bom = (bytes[0], bytes[1]);
                let u16_slice: Vec<u16> = if bom == (0xFE, 0xFF) {
                    // Big-endian
                    bytes[2..]
                        .chunks_exact(2)
                        .map(|c| u16::from_be_bytes([c[0], c[1]]))
                        .collect()
                } else if bom == (0xFF, 0xFE) {
                    // Little-endian
                    bytes[2..]
                        .chunks_exact(2)
                        .map(|c| u16::from_le_bytes([c[0], c[1]]))
                        .collect()
                } else {
                    bytes
                        .chunks_exact(2)
                        .map(|c| u16::from_le_bytes([c[0], c[1]]))
                        .collect()
                };
                String::from_utf16_lossy(&u16_slice)
            } else {
                String::new()
            }
        }
        2 => {
            // UTF-16BE without BOM
            let u16_slice: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16_slice)
        }
        3 => {
            // UTF-8
            String::from_utf8_lossy(bytes).into_owned()
        }
        _ => String::from_utf8_lossy(bytes).into_owned(),
    }
}

/// Extract chapters from raw ID3v2 tag bytes.
pub fn extract_id3v2_chapters(
    data: &[u8],
    episode_id: &str,
    duration_secs: Option<i64>,
) -> Vec<PodcastChapter> {
    if data.len() < 10 || &data[0..3] != b"ID3" {
        return Vec::new();
    }

    let version = data[3]; // e.g. 3 for ID3v2.3, 4 for ID3v2.4
    let tag_size = parse_syncsafe_u32(&data[6..10]) as usize;
    let end_of_tag = (10 + tag_size).min(data.len());

    let mut pos = 10;
    let mut raw_chapters = Vec::new();

    while pos + 10 <= end_of_tag {
        let frame_id = &data[pos..pos + 4];
        if frame_id == [0, 0, 0, 0] {
            // Reached padding
            break;
        }

        let frame_size = if version >= 4 {
            parse_syncsafe_u32(&data[pos + 4..pos + 8]) as usize
        } else {
            u32::from_be_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]])
                as usize
        };

        let frame_data_start = pos + 10;
        let frame_data_end = (frame_data_start + frame_size).min(end_of_tag);

        if frame_id == b"CHAP" && frame_data_end <= data.len() && frame_data_end > frame_data_start
        {
            let chap_bytes = &data[frame_data_start..frame_data_end];
            // Element ID is null-terminated string
            if let Some(null_idx) = chap_bytes.iter().position(|&b| b == 0) {
                let element_id = String::from_utf8_lossy(&chap_bytes[..null_idx]).into_owned();
                let time_start = null_idx + 1;
                if time_start + 16 <= chap_bytes.len() {
                    let start_ms = u32::from_be_bytes([
                        chap_bytes[time_start],
                        chap_bytes[time_start + 1],
                        chap_bytes[time_start + 2],
                        chap_bytes[time_start + 3],
                    ]) as i64;

                    let end_ms = u32::from_be_bytes([
                        chap_bytes[time_start + 4],
                        chap_bytes[time_start + 5],
                        chap_bytes[time_start + 6],
                        chap_bytes[time_start + 7],
                    ]) as i64;

                    // Remaining bytes are sub-frames (TIT2 for title, WXXX for link)
                    let subframes_start = time_start + 16;
                    let mut title = element_id.clone();
                    let mut link_url = None;

                    if subframes_start < chap_bytes.len() {
                        let sub_bytes = &chap_bytes[subframes_start..];
                        let mut sub_pos = 0;
                        while sub_pos + 10 <= sub_bytes.len() {
                            let sub_id = &sub_bytes[sub_pos..sub_pos + 4];
                            let sub_size = if version >= 4 {
                                parse_syncsafe_u32(&sub_bytes[sub_pos + 4..sub_pos + 8]) as usize
                            } else {
                                u32::from_be_bytes([
                                    sub_bytes[sub_pos + 4],
                                    sub_bytes[sub_pos + 5],
                                    sub_bytes[sub_pos + 6],
                                    sub_bytes[sub_pos + 7],
                                ]) as usize
                            };
                            let sub_start = sub_pos + 10;
                            let sub_end = (sub_start + sub_size).min(sub_bytes.len());

                            if sub_id == b"TIT2" && sub_start < sub_end {
                                let encoding = sub_bytes[sub_start];
                                let text_bytes = &sub_bytes[sub_start + 1..sub_end];
                                let clean_text = decode_id3_string(encoding, text_bytes);
                                let trimmed = clean_text.trim_matches('\0').trim();
                                if !trimmed.is_empty() {
                                    title = trimmed.to_string();
                                }
                            } else if sub_id.starts_with(b"W") && sub_start < sub_end {
                                let text_bytes = &sub_bytes[sub_start..sub_end];
                                let url_str = String::from_utf8_lossy(text_bytes)
                                    .trim_matches('\0')
                                    .trim()
                                    .to_string();
                                if url_str.starts_with("http") {
                                    link_url = Some(url_str);
                                }
                            }

                            sub_pos = sub_end;
                        }
                    }

                    raw_chapters.push((start_ms, end_ms, title, link_url));
                }
            }
        }

        pos = frame_data_end;
    }

    raw_chapters.sort_by_key(|c| c.0);

    let num_chaps = raw_chapters.len();
    let mut chapters = Vec::with_capacity(num_chaps);

    for (idx, (start_ms, explicit_end_ms, title, link_url)) in raw_chapters.into_iter().enumerate()
    {
        let is_sponsor = is_sponsor_title(&title);
        let end_ms = if explicit_end_ms > start_ms {
            explicit_end_ms
        } else {
            duration_secs.map(|d| d * 1000).unwrap_or(start_ms)
        };

        chapters.push(PodcastChapter {
            id: format!("{}:id3:{}", episode_id, idx),
            episode_id: episode_id.to_string(),
            chapter_index: idx as i32,
            title,
            start_ms,
            end_ms,
            image_url: None,
            link_url,
            source: ChapterSource::Id3Chap.as_str().to_string(),
            is_advertisement: is_sponsor,
        });
    }

    // Fix up consecutive end times
    for idx in 0..chapters.len() {
        if idx + 1 < chapters.len() {
            let next_start = chapters[idx + 1].start_ms;
            if chapters[idx].end_ms <= chapters[idx].start_ms || chapters[idx].end_ms > next_start {
                chapters[idx].end_ms = next_start;
            }
        }
    }

    chapters
}

/// Parse MP4 / QuickTime `chpl` (Chapter List) atom bytes
pub fn extract_mp4_chpl_atom(
    data: &[u8],
    episode_id: &str,
    duration_secs: Option<i64>,
) -> Vec<PodcastChapter> {
    // Traverse boxes searching for `chpl`
    let mut found_chpl = None;
    find_box_recursive(data, 0, data.len(), b"chpl", &mut found_chpl);

    let chpl_data = match found_chpl {
        Some(slice) => slice,
        None => return Vec::new(),
    };

    if chpl_data.len() < 9 {
        return Vec::new();
    }

    // chpl layout:
    // 1 byte version (usually 0)
    // 3 bytes flags
    // 4 bytes reserved
    // 1 byte chapter count
    let count = chpl_data[8] as usize;
    let mut pos = 9;
    let mut raw_chapters = Vec::new();

    for _ in 0..count {
        if pos + 9 > chpl_data.len() {
            break;
        }

        let timestamp = u64::from_be_bytes([
            chpl_data[pos],
            chpl_data[pos + 1],
            chpl_data[pos + 2],
            chpl_data[pos + 3],
            chpl_data[pos + 4],
            chpl_data[pos + 5],
            chpl_data[pos + 6],
            chpl_data[pos + 7],
        ]);
        // Timestamp is in 10,000,000 units per second (100ns)
        let start_ms = (timestamp / 10_000) as i64;
        pos += 8;

        let title_len = chpl_data[pos] as usize;
        pos += 1;

        if pos + title_len > chpl_data.len() {
            break;
        }

        let title = String::from_utf8_lossy(&chpl_data[pos..pos + title_len])
            .trim()
            .to_string();
        pos += title_len;

        raw_chapters.push((start_ms, title));
    }

    raw_chapters.sort_by_key(|c| c.0);

    let num_chaps = raw_chapters.len();
    let mut chapters = Vec::with_capacity(num_chaps);

    for (idx, (start_ms, title)) in raw_chapters.into_iter().enumerate() {
        let is_sponsor = is_sponsor_title(&title);
        chapters.push(PodcastChapter {
            id: format!("{}:m4a:{}", episode_id, idx),
            episode_id: episode_id.to_string(),
            chapter_index: idx as i32,
            title,
            start_ms,
            end_ms: start_ms, // assigned below
            image_url: None,
            link_url: None,
            source: ChapterSource::Id3Chap.as_str().to_string(),
            is_advertisement: is_sponsor,
        });
    }

    for idx in 0..chapters.len() {
        if idx + 1 < chapters.len() {
            chapters[idx].end_ms = chapters[idx + 1].start_ms;
        } else if let Some(d_secs) = duration_secs {
            chapters[idx].end_ms = d_secs * 1000;
        }
    }

    chapters
}

/// Helper to recursively search an MP4 container for a specific box type
fn find_box_recursive<'a>(
    data: &'a [u8],
    start: usize,
    end: usize,
    target_type: &[u8; 4],
    result: &mut Option<&'a [u8]>,
) {
    let mut pos = start;
    while pos + 8 <= end {
        let size =
            u32::from_be_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]) as usize;
        let box_type = &data[pos + 4..pos + 8];

        let box_size = if size == 1 && pos + 16 <= end {
            // 64-bit size
            u64::from_be_bytes([
                data[pos + 8],
                data[pos + 9],
                data[pos + 10],
                data[pos + 11],
                data[pos + 12],
                data[pos + 13],
                data[pos + 14],
                data[pos + 15],
            ]) as usize
        } else if size == 0 {
            end - pos
        } else {
            size
        };

        if box_size < 8 || pos + box_size > end {
            break;
        }

        if box_type == target_type {
            *result = Some(&data[pos + 8..pos + box_size]);
            return;
        }

        // Recurse into containers
        let is_container = matches!(
            box_type,
            b"moov" | b"udta" | b"trak" | b"mdia" | b"minf" | b"stbl"
        );
        if is_container {
            find_box_recursive(data, pos + 8, pos + box_size, target_type, result);
            if result.is_some() {
                return;
            }
        }

        pos += box_size;
    }
}

/// Extract chapters from an audio file on disk (.mp3, .m4a, .m4b).
pub fn extract_audio_file_chapters(
    file_path: &Path,
    episode_id: &str,
    duration_secs: Option<i64>,
) -> Result<Vec<PodcastChapter>, String> {
    if !file_path.exists() {
        return Err(format!("File does not exist: {}", file_path.display()));
    }

    let mut file = File::open(file_path).map_err(|e| format!("Failed to open file: {}", e))?;
    // Read up to 8MB header which contains ID3 or MP4 moov/udta atoms
    let mut buffer = vec![0u8; 8 * 1024 * 1024];
    let bytes_read = file
        .read(&mut buffer)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    buffer.truncate(bytes_read);

    // Try ID3v2 first (standard for MP3)
    if buffer.starts_with(b"ID3") {
        let chaps = extract_id3v2_chapters(&buffer, episode_id, duration_secs);
        if !chaps.is_empty() {
            return Ok(chaps);
        }
    }

    // Try MP4 chpl atom (standard for M4A / M4B)
    let mp4_chaps = extract_mp4_chpl_atom(&buffer, episode_id, duration_secs);
    if !mp4_chaps.is_empty() {
        return Ok(mp4_chaps);
    }

    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_id3v2_chap_frames() {
        // Build a synthetic ID3v2.3 tag with 2 CHAP frames
        let mut tag = Vec::new();
        tag.extend_from_slice(b"ID3");
        tag.push(3); // v2.3
        tag.push(0); // revision
        tag.push(0); // flags

        let mut body = Vec::new();

        // CHAP frame 1: "Intro" at 0s..30s
        let mut chap1_payload = Vec::new();
        chap1_payload.extend_from_slice(b"chp1\0");
        chap1_payload.extend_from_slice(&0u32.to_be_bytes()); // start 0ms
        chap1_payload.extend_from_slice(&30000u32.to_be_bytes()); // end 30,000ms
        chap1_payload.extend_from_slice(&[0xFF; 8]); // byte offsets unused

        // Subframe TIT2
        let mut tit2 = Vec::new();
        tit2.push(3); // UTF-8
        tit2.extend_from_slice(b"Introduction");
        chap1_payload.extend_from_slice(b"TIT2");
        chap1_payload.extend_from_slice(&(tit2.len() as u32).to_be_bytes());
        chap1_payload.extend_from_slice(&[0, 0]); // flags
        chap1_payload.extend_from_slice(&tit2);

        body.extend_from_slice(b"CHAP");
        body.extend_from_slice(&(chap1_payload.len() as u32).to_be_bytes());
        body.extend_from_slice(&[0, 0]); // flags
        body.extend_from_slice(&chap1_payload);

        // CHAP frame 2: "Sponsor: Squarespace" at 30s..60s
        let mut chap2_payload = Vec::new();
        chap2_payload.extend_from_slice(b"chp2\0");
        chap2_payload.extend_from_slice(&30000u32.to_be_bytes()); // start 30,000ms
        chap2_payload.extend_from_slice(&60000u32.to_be_bytes()); // end 60,000ms
        chap2_payload.extend_from_slice(&[0xFF; 8]);

        let mut tit2_2 = Vec::new();
        tit2_2.push(3);
        tit2_2.extend_from_slice(b"Sponsor: Squarespace");
        chap2_payload.extend_from_slice(b"TIT2");
        chap2_payload.extend_from_slice(&(tit2_2.len() as u32).to_be_bytes());
        chap2_payload.extend_from_slice(&[0, 0]);
        chap2_payload.extend_from_slice(&tit2_2);

        body.extend_from_slice(b"CHAP");
        body.extend_from_slice(&(chap2_payload.len() as u32).to_be_bytes());
        body.extend_from_slice(&[0, 0]);
        body.extend_from_slice(&chap2_payload);

        // Syncsafe size for header
        let body_len = body.len() as u32;
        let s0 = ((body_len >> 21) & 0x7F) as u8;
        let s1 = ((body_len >> 14) & 0x7F) as u8;
        let s2 = ((body_len >> 7) & 0x7F) as u8;
        let s3 = (body_len & 0x7F) as u8;
        tag.extend_from_slice(&[s0, s1, s2, s3]);
        tag.extend_from_slice(&body);

        let chapters = extract_id3v2_chapters(&tag, "test_ep", Some(60));
        assert_eq!(chapters.len(), 2);

        assert_eq!(chapters[0].title, "Introduction");
        assert_eq!(chapters[0].start_ms, 0);
        assert_eq!(chapters[0].end_ms, 30000);
        assert!(!chapters[0].is_advertisement);

        assert_eq!(chapters[1].title, "Sponsor: Squarespace");
        assert_eq!(chapters[1].start_ms, 30000);
        assert_eq!(chapters[1].end_ms, 60000);
        assert!(chapters[1].is_advertisement);
    }

    #[test]
    fn test_extract_mp4_chpl_atom() {
        // Build synthetic MP4 moov -> udta -> chpl
        let mut chpl_payload = Vec::new();
        chpl_payload.push(0); // version
        chpl_payload.extend_from_slice(&[0, 0, 0]); // flags
        chpl_payload.extend_from_slice(&[0, 0, 0, 0]); // reserved
        chpl_payload.push(2); // 2 chapters

        // Chapter 1: 0s, "Welcome"
        let ts1 = 0u64 * 10_000;
        chpl_payload.extend_from_slice(&ts1.to_be_bytes());
        chpl_payload.push(7); // len
        chpl_payload.extend_from_slice(b"Welcome");

        // Chapter 2: 45s, "Sponsor Segment"
        let ts2 = 45_000u64 * 10_000;
        chpl_payload.extend_from_slice(&ts2.to_be_bytes());
        chpl_payload.push(15);
        chpl_payload.extend_from_slice(b"Sponsor Segment");

        // chpl box
        let mut chpl_box = Vec::new();
        chpl_box.extend_from_slice(&((chpl_payload.len() + 8) as u32).to_be_bytes());
        chpl_box.extend_from_slice(b"chpl");
        chpl_box.extend_from_slice(&chpl_payload);

        // udta box
        let mut udta_box = Vec::new();
        udta_box.extend_from_slice(&((chpl_box.len() + 8) as u32).to_be_bytes());
        udta_box.extend_from_slice(b"udta");
        udta_box.extend_from_slice(&chpl_box);

        // moov box
        let mut moov_box = Vec::new();
        moov_box.extend_from_slice(&((udta_box.len() + 8) as u32).to_be_bytes());
        moov_box.extend_from_slice(b"moov");
        moov_box.extend_from_slice(&udta_box);

        let chapters = extract_mp4_chpl_atom(&moov_box, "mp4_ep", Some(120));
        assert_eq!(chapters.len(), 2);

        assert_eq!(chapters[0].title, "Welcome");
        assert_eq!(chapters[0].start_ms, 0);
        assert_eq!(chapters[0].end_ms, 45000);
        assert!(!chapters[0].is_advertisement);

        assert_eq!(chapters[1].title, "Sponsor Segment");
        assert_eq!(chapters[1].start_ms, 45000);
        assert_eq!(chapters[1].end_ms, 120000);
        assert!(chapters[1].is_advertisement);
    }
}
