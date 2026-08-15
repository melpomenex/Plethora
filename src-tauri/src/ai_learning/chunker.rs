//! Heading-aware recursive chunker for the semantic index (task 4.2, design D12).
//!
//! Splitting strategy, coarse → fine:
//! 1. **Headings** — markdown ATX (`#`…`######`), HTML `<h1>`–`<h6>` via a tag
//!    scan of `html_content` when present, and a typographic heuristic for
//!    plain-text projections of EPUB spines / PDF pages (headings there arrive
//!    as bare lines because `processor::epub` strips the tags). A heading
//!    change always closes the current chunk, so chunks never silently span
//!    unrelated sections.
//! 2. **Paragraphs** — blank-line separated blocks (or block-level elements in
//!    HTML). A paragraph shorter than `atomic_max` (1200 chars) with a stable
//!    location is *atomic*: it is never split mid-paragraph.
//! 3. **Sentences** — only oversized blocks (> `atomic_max`) are split at
//!    sentence terminators into ≤ `target_max` pieces, with a one-sentence
//!    overlap between consecutive pieces/chunks in the same section.
//!
//! Target size is 700–900 chars (~200–260 tokens). All offsets are **char**
//! offsets into the chunker's input text (for HTML sources, into the
//! tag-stripped projection produced here; TS enriches EPUB chunks with CFI
//! ranges and PDF chunks with page rects later — see `models::ChunkLocation`).
//!
//! Extracts, annotations and card fronts are single chunks with their own
//! location payloads (`single_chunk`), per task 4.7.

use crate::ai_learning::models::{ChunkLocation, ChunkModel};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;

/// Default chunker tuning (design D12: 700–900 chars, one-sentence overlap,
/// 1200-char atomic-paragraph rule).
pub const DEFAULT_TARGET_MIN: usize = 700;
pub const DEFAULT_TARGET_MAX: usize = 900;
pub const DEFAULT_ATOMIC_MAX: usize = 1200;
pub const DEFAULT_OVERLAP_SENTENCES: usize = 1;

#[derive(Debug, Clone)]
pub struct ChunkOptions {
    /// Preferred minimum chunk size in chars (soft — a section boundary may
    /// produce shorter chunks).
    pub target_min: usize,
    /// Preferred maximum chunk size in chars. Accumulation stops before
    /// exceeding this when the current chunk already holds content.
    pub target_max: usize,
    /// Paragraphs shorter than this are atomic and never split.
    pub atomic_max: usize,
    /// Sentences of overlap between consecutive chunks in the same section.
    pub overlap_sentences: usize,
}

impl Default for ChunkOptions {
    fn default() -> Self {
        Self {
            target_min: DEFAULT_TARGET_MIN,
            target_max: DEFAULT_TARGET_MAX,
            atomic_max: DEFAULT_ATOMIC_MAX,
            overlap_sentences: DEFAULT_OVERLAP_SENTENCES,
        }
    }
}

/// Source-specific input for `chunk_document`.
#[derive(Debug, Clone)]
pub enum ChunkInput<'a> {
    /// Markdown with ATX headings.
    Markdown { text: &'a str },
    /// HTML / XHTML markup (documents' `html_content`, or an EPUB spine
    /// document). Parsed with a tag scanner; offsets refer to the extracted
    /// plain-text projection.
    Html { html: &'a str },
    /// Plain text (EPUB spine projection, transcripts, generic text). When
    /// `heading_heuristic` is set (EPUB / PDF projections) short single-line
    /// blocks that look like headings open a new section.
    Plain {
        text: &'a str,
        heading_heuristic: bool,
    },
    /// Page-scoped plain text (PDF). Every page boundary closes the chunk and
    /// is recorded in the location payload as `pageNumber`.
    Paged { pages: &'a [String] },
}

/// Context identifying what is being chunked.
#[derive(Debug, Clone)]
pub struct ChunkContext<'a> {
    pub document_id: &'a str,
    /// `document` | `extract` | `annotation` | `card`.
    pub source_type: &'a str,
    pub source_id: Option<&'a str>,
    /// Location surface kind: `pdf` | `epub` | `html` | `markdown` | `text`.
    pub location_source_type: &'a str,
    /// EPUB spine index (chapter) the text came from, when known.
    pub spine_index: Option<i64>,
}

/// sha256 hex of a chunk's text — matches the `rag.rs` chunk-hash convention.
pub fn chunk_content_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

/// Rough token estimate (~4 chars/token), same convention as `rag.rs`.
pub fn approx_token_count(text: &str) -> i64 {
    (text.chars().count() / 4) as i64
}

/// Deterministic chunk id so re-indexing identical content reuses rows.
fn chunk_id(document_id: &str, source_type: &str, source_id: Option<&str>, content_hash: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(document_id.as_bytes());
    hasher.update(b"|");
    hasher.update(source_type.as_bytes());
    hasher.update(b"|");
    hasher.update(source_id.unwrap_or("").as_bytes());
    hasher.update(b"|");
    hasher.update(content_hash.as_bytes());
    hex::encode(hasher.finalize())
}

// ── Block model ─────────────────────────────────────────────────────────────

/// A paragraph-level block with its section context and location span.
#[derive(Debug, Clone)]
struct Block {
    text: String,
    heading_path: Vec<String>,
    /// Char offset of `text[0]` in the input.
    start: usize,
    /// Char offset one past the last char of `text` in the input.
    end: usize,
    page: Option<i64>,
}

impl Block {
    fn len_chars(&self) -> usize {
        self.text.chars().count()
    }
}

// ── Sentence splitting ──────────────────────────────────────────────────────

/// Split text into sentences, keeping terminators attached. Handles ASCII
/// `.!?` and CJK `。！？` terminators. Unicode-safe: indices are char offsets.
fn split_sentences(text: &str) -> Vec<(usize, usize, String)> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut start = 0usize;

    for i in 0..chars.len() {
        let c = chars[i];
        let terminates = matches!(c, '.' | '!' | '?' | '。' | '！' | '？');
        if !terminates {
            continue;
        }
        // CJK terminators end the sentence unconditionally — CJK text uses
        // no separating spaces. ASCII terminators require the next char to be
        // whitespace, a closing quote/bracket, another terminator, or end of
        // text (so "3.14" or "e.g" stay intact).
        let next = chars.get(i + 1).copied();
        let boundary = matches!(c, '。' | '！' | '？')
            || match next {
                None => true,
                Some(n) => {
                    n.is_whitespace()
                        || matches!(n, '"' | '\'' | '”' | '’' | '）' | ')' | '」' | '》')
                        || matches!(n, '.' | '!' | '?' | '。' | '！' | '？')
                }
            };
        if !boundary {
            continue;
        }
        // Extend over a run of closers/terminators (e.g. `..."` or `?!`).
        let mut end = i + 1;
        while let Some(&n) = chars.get(end) {
            if matches!(n, '"' | '\'' | '”' | '’' | '）' | ')' | '」' | '》') {
                end += 1;
            } else {
                break;
            }
        }
        let piece: String = chars[start..end].iter().collect();
        let trimmed_end = piece.trim_end();
        let trailing_ws = piece.chars().count() - trimmed_end.chars().count();
        out.push((start, end - trailing_ws, trimmed_end.to_string()));
        start = end;
    }

    if start < chars.len() {
        let piece: String = chars[start..].iter().collect();
        let piece = piece.trim();
        if !piece.is_empty() {
            out.push((start, chars.len(), piece.to_string()));
        }
    }

    out.into_iter().filter(|(_, _, s)| !s.is_empty()).collect()
}

// ── Input parsers → blocks ──────────────────────────────────────────────────

/// Parse markdown into blocks. ATX headings update a level-indexed path.
fn parse_markdown_blocks(text: &str) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut heading_path: Vec<(usize, String)> = Vec::new();
    let mut para_start: Option<usize> = None;
    let mut para = String::new();
    let mut offset = 0usize;

    fn flush(
        para: &mut String,
        start: &mut Option<usize>,
        offset: usize,
        blocks: &mut Vec<Block>,
        heading_path: &[(usize, String)],
    ) {
        let trimmed = para.trim();
        if !trimmed.is_empty() {
            if let Some(s) = *start {
                blocks.push(Block {
                    text: trimmed.to_string(),
                    heading_path: heading_path.iter().map(|(_, t)| t.clone()).collect(),
                    start: s,
                    end: s + trimmed.chars().count(),
                    page: None,
                });
            }
        }
        para.clear();
        *start = None;
        let _ = offset;
    }

    for line in text.split_inclusive('\n') {
        let line_len = line.chars().count();
        let trimmed = line.trim();
        let heading = parse_atx_heading(trimmed);
        if let Some((level, title)) = heading {
            flush(&mut para, &mut para_start, offset, &mut blocks, &heading_path);
            // Level-indexed path: drop deeper-or-equal levels, then push.
            heading_path.retain(|(l, _)| *l < level);
            heading_path.push((level, title));
        } else if trimmed.is_empty() {
            flush(&mut para, &mut para_start, offset, &mut blocks, &heading_path);
        } else {
            if para_start.is_none() {
                let lead = line.chars().take_while(|c| c.is_whitespace()).count();
                para_start = Some(offset + lead);
            }
            if para.is_empty() {
                para.push_str(trimmed);
            } else {
                para.push(' ');
                para.push_str(trimmed);
            }
        }
        offset += line_len;
    }
    flush(&mut para, &mut para_start, offset, &mut blocks, &heading_path);
    blocks
}

/// `# Title` → `(level, title)` for ATX headings (1–6).
fn parse_atx_heading(line: &str) -> Option<(usize, String)> {
    let rest = line.strip_prefix('#')?;
    let mut level = 1usize;
    let mut rest = rest;
    while let Some(next) = rest.strip_prefix('#') {
        level += 1;
        rest = next;
    }
    if level > 6 {
        return None;
    }
    let title = rest.trim().trim_end_matches('#').trim();
    if title.is_empty() {
        return None;
    }
    Some((level, title.to_string()))
}

/// Typographic heading heuristic for tag-stripped projections (EPUB spine
/// text, PDF page text): a single-line block of 4–120 chars without sentence
/// punctuation and ≥3 alphabetic chars, that is mostly uppercase or short.
fn looks_like_heading_line(block: &str) -> bool {
    let trimmed = block.trim();
    let lines: Vec<&str> = trimmed.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.len() != 1 {
        return false;
    }
    let char_count = trimmed.chars().count();
    if !(4..=120).contains(&char_count) || trimmed.ends_with('.') {
        return false;
    }
    let alpha_count = trimmed.chars().filter(|ch| ch.is_alphabetic()).count();
    if alpha_count < 3 {
        return false;
    }
    let uppercase_count = trimmed.chars().filter(|ch| ch.is_uppercase()).count();
    uppercase_count * 2 >= alpha_count || char_count <= 70
}

/// Parse plain text into paragraph blocks; optionally promote heuristic
/// heading lines to section boundaries.
fn parse_plain_blocks(text: &str, heading_heuristic: bool) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut heading_path: Vec<String> = Vec::new();
    let mut offset = 0usize;

    for para in text.split("\n\n") {
        let trimmed = para.trim();
        if !trimmed.is_empty() {
            if heading_heuristic && looks_like_heading_line(trimmed) {
                heading_path.push(trimmed.to_string());
            } else {
                blocks.push(Block {
                    text: normalized_plain_paragraph(trimmed),
                    heading_path: heading_path.clone(),
                    start: offset + leading_chars(para),
                    end: offset + leading_chars(para) + trimmed.chars().count(),
                    page: None,
                });
            }
        }
        offset += para.chars().count() + 2; // the "\n\n" separator
    }
    blocks
}

fn leading_chars(s: &str) -> usize {
    s.chars().take_while(|c| c.is_whitespace()).count()
}

/// Collapse single newlines inside a paragraph (hard-wrapped text) to spaces.
fn normalized_plain_paragraph(para: &str) -> String {
    if para.contains('\n') {
        para.lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        para.to_string()
    }
}

/// Parse paged text (PDF) into blocks carrying page numbers. Heading heuristic
/// applies within pages.
fn parse_paged_blocks(pages: &[String]) -> Vec<Block> {
    let mut blocks = Vec::new();
    for (idx, page) in pages.iter().enumerate() {
        let page_no = (idx + 1) as i64;
        for block in parse_plain_blocks(page, true) {
            blocks.push(Block {
                page: Some(page_no),
                ..block
            });
        }
    }
    blocks
}

/// Block-level HTML tags that force a paragraph boundary.
const HTML_BLOCK_TAGS: &[&str] = &[
    "p", "div", "section", "article", "header", "footer", "main", "aside", "ul", "ol",
    "table", "figure", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr",
    "blockquote", "pre", "br", "hr",
];

/// Scan HTML tags into blocks with a heading path (task 4.2: "html via tag
/// scan of html_content"). Offsets refer to the plain-text projection built
/// while scanning: flushed blocks separated by a single space, in document
/// order.
fn parse_html_blocks(html: &str) -> Vec<Block> {
    struct Parser {
        blocks: Vec<Block>,
        heading_path: Vec<(usize, String)>,
        current_text: String,
        /// Char offset in the projection where the current paragraph started.
        para_start: Option<usize>,
        /// Running length of the projection (flushed blocks + separators).
        proj_offset: usize,
        open_heading: Option<(usize, String)>,
        skip_depth: usize,
    }

    impl Parser {
        fn flush(&mut self) {
            let trimmed = self.current_text.trim().to_string();
            if !trimmed.is_empty() {
                let start = self.para_start.unwrap_or(self.proj_offset);
                let len = trimmed.chars().count();
                self.blocks.push(Block {
                    text: trimmed,
                    heading_path: self.heading_path.iter().map(|(_, t)| t.clone()).collect(),
                    start,
                    end: start + len,
                    page: None,
                });
                self.proj_offset += len + 1;
            }
            self.current_text.clear();
            self.para_start = None;
        }

        fn append_text(&mut self, run: &str) {
            let collapsed: String = run
                .chars()
                .map(|c| if c.is_whitespace() { ' ' } else { c })
                .collect();
            let piece = collapsed.trim();
            if piece.is_empty() {
                return;
            }
            self.append_piece(piece);
        }

        fn append_piece(&mut self, piece: &str) {
            if let Some((_, htext)) = self.open_heading.as_mut() {
                if !htext.is_empty() && !piece.is_empty() {
                    htext.push(' ');
                }
                htext.push_str(piece);
                return;
            }
            if piece.is_empty() {
                return;
            }
            if self.current_text.is_empty() {
                self.para_start = Some(self.proj_offset);
                self.current_text.push_str(piece);
            } else {
                self.current_text.push(' ');
                self.current_text.push_str(piece);
            }
        }
    }

    let mut p = Parser {
        blocks: Vec::new(),
        heading_path: Vec::new(),
        current_text: String::new(),
        para_start: None,
        proj_offset: 0,
        open_heading: None,
        skip_depth: 0,
    };

    let bytes = html.as_bytes();
    let mut i = 0usize;
    let n = bytes.len();

    while i < n {
        if bytes[i] != b'<' {
            let run_start = i;
            while i < n && bytes[i] != b'<' {
                i += 1;
            }
            if p.skip_depth == 0 {
                p.append_text(&html[run_start..i]);
            }
            continue;
        }

        // Parse `<...>`.
        let tag_start = i + 1;
        let mut j = tag_start;
        while j < n && bytes[j] != b'>' {
            j += 1;
        }
        let tag_body = &html[tag_start..j.min(n)];
        let name = html_tag_name(tag_body);
        let closing = tag_body.starts_with('/');

        if name == "style" || name == "script" {
            if closing {
                p.skip_depth = p.skip_depth.saturating_sub(1);
            } else if !tag_body.ends_with('/') {
                p.skip_depth += 1;
            }
        } else if p.skip_depth == 0 {
            let level = heading_level(&name);
            match (level, closing) {
                (Some(l), false) => {
                    p.flush();
                    p.open_heading = Some((l, String::new()));
                }
                (Some(l), true) => {
                    if let Some((hl, text)) = p.open_heading.take() {
                        let title = text.trim().to_string();
                        if !title.is_empty() {
                            let lvl = hl.min(l);
                            p.heading_path.retain(|(hp, _)| *hp < lvl);
                            p.heading_path.push((lvl, title));
                        }
                    }
                }
                _ => {
                    let boundary = closing || name == "br" || name == "hr";
                    let block_tag = HTML_BLOCK_TAGS.contains(&name.as_str());
                    if block_tag && boundary {
                        if p.open_heading.is_some() {
                            // <br/> inside a heading: keep on one line.
                            if let Some((_, htext)) = p.open_heading.as_mut() {
                                htext.push(' ');
                            }
                        } else {
                            p.flush();
                        }
                    }
                }
            }
        }
        i = (j + 1).min(n);
    }
    p.flush();
    p.blocks
}

fn heading_level(tag: &str) -> Option<usize> {
    match tag {
        "h1" => Some(1),
        "h2" => Some(2),
        "h3" => Some(3),
        "h4" => Some(4),
        "h5" => Some(5),
        "h6" => Some(6),
        _ => None,
    }
}

fn html_tag_name(tag_body: &str) -> String {
    let s = tag_body.trim().trim_start_matches('/');
    let end = s
        .find(|c: char| c.is_whitespace() || c == '/' || c == '>')
        .unwrap_or(s.len());
    s[..end].to_lowercase()
}

// ── Packing ─────────────────────────────────────────────────────────────────

/// A chunk under construction.
#[derive(Debug)]
struct PendingChunk {
    parts: VecDeque<Block>,
    len: usize,
    heading_path: Vec<String>,
    page: Option<i64>,
    start: usize,
    end: usize,
}

impl PendingChunk {
    fn from_block(block: &Block) -> Self {
        Self {
            len: block.len_chars(),
            heading_path: block.heading_path.clone(),
            page: block.page,
            start: block.start,
            end: block.end,
            parts: VecDeque::from([block.clone()]),
        }
    }

    fn push(&mut self, block: &Block) {
        self.len += block.len_chars();
        self.end = block.end;
        self.parts.push_back(block.clone());
    }
}

/// State that survives chunk boundaries within a section for the overlap rule.
struct SectionOverlapState {
    heading_path: Vec<String>,
    page: Option<i64>,
    tail_sentences: Vec<String>,
}

/// Heading-aware recursive packing: headings → paragraphs → sentences.
fn pack_blocks(
    ctx: &ChunkContext<'_>,
    blocks: &[Block],
    opts: &ChunkOptions,
    location_source_type: &str,
) -> Vec<ChunkModel> {
    let mut state = PackState {
        chunks: Vec::new(),
        pending: None,
        overlap: None,
        ordinal: 0,
    };

    for block in blocks {
        let block_len = block.len_chars();

        // Section boundary: heading change or page change closes the chunk
        // and resets the overlap state (no overlap across sections).
        let section_changed = match state.pending.as_ref() {
            Some(p) => p.heading_path != block.heading_path || p.page != block.page,
            None => false,
        };
        if section_changed {
            state.close(opts, ctx, location_source_type);
            state.overlap = None;
        }

        if block_len <= opts.atomic_max {
            // Atomic paragraph: never split. Close the current chunk first if
            // adding would overflow the target and the chunk is big enough.
            let fits = state
                .pending
                .as_ref()
                .map(|p| p.len + block_len <= opts.target_max)
                .unwrap_or(true);
            if !fits && state.pending.as_ref().map(|p| p.len).unwrap_or(0) >= opts.target_min {
                state.close(opts, ctx, location_source_type);
            }
            match state.pending.as_mut() {
                Some(p) => p.push(block),
                None => state.pending = Some(PendingChunk::from_block(block)),
            }
        } else {
            // Oversized block: recurse to sentence level. Pieces become their
            // own chunks with a one-sentence overlap between them.
            state.close(opts, ctx, location_source_type);
            state.pack_oversized(block, opts, ctx, location_source_type);
        }
    }
    state.close(opts, ctx, location_source_type);
    state.chunks
}

/// Mutable packing state carried across blocks.
struct PackState {
    chunks: Vec<ChunkModel>,
    pending: Option<PendingChunk>,
    overlap: Option<SectionOverlapState>,
    ordinal: i64,
}

impl PackState {
    /// Close the pending chunk (if any), emit it, and record its tail for the
    /// one-sentence overlap rule.
    fn close(&mut self, opts: &ChunkOptions, ctx: &ChunkContext<'_>, location_source_type: &str) {
        let Some(p) = self.pending.take() else { return };
        let mut text_parts: Vec<String> = Vec::new();

        // One-sentence overlap with the previous chunk in the same section.
        if let Some(state) = self.overlap.as_ref() {
            if state.heading_path == p.heading_path
                && state.page == p.page
                && opts.overlap_sentences > 0
            {
                for s in state.tail_sentences.iter().take(opts.overlap_sentences) {
                    text_parts.push(s.clone());
                }
            }
        }

        for part in &p.parts {
            text_parts.push(part.text.clone());
        }
        let text = text_parts.join("\n\n");
        if text.trim().is_empty() {
            return;
        }

        let chunk = build_chunk(
            ctx,
            location_source_type,
            p.heading_path.clone(),
            p.page,
            p.start,
            p.end,
            self.ordinal,
            &text,
        );
        self.ordinal += 1;
        self.chunks.push(chunk);

        // Remember this chunk's tail sentences for the next chunk's overlap.
        let tail = split_sentences(p.parts.back().map(|b| b.text.as_str()).unwrap_or(""))
            .into_iter()
            .map(|(_, _, s)| s)
            .take(opts.overlap_sentences)
            .collect::<Vec<_>>();
        self.overlap = Some(SectionOverlapState {
            heading_path: p.heading_path,
            page: p.page,
            tail_sentences: tail,
        });
    }

    /// Split an oversized block at sentence boundaries into ≤ target_max
    /// pieces with a one-sentence overlap between consecutive pieces.
    fn pack_oversized(
        &mut self,
        block: &Block,
        opts: &ChunkOptions,
        ctx: &ChunkContext<'_>,
        location_source_type: &str,
    ) {
        let sentences = split_sentences(&block.text);
        if sentences.is_empty() {
            return;
        }

        let mut piece_start = sentences[0].0;
        let mut piece_sentences: Vec<(usize, usize, String)> = Vec::new();
        let mut piece_len = 0usize;
        let mut carry_overlap: Vec<String> = Vec::new();

        let mut flush = |piece_start: &mut usize,
                         piece_sentences: &mut Vec<(usize, usize, String)>,
                         piece_len: &mut usize,
                         carry_overlap: &mut Vec<String>,
                         ordinal: &mut i64,
                         chunks: &mut Vec<ChunkModel>| {
            if piece_sentences.is_empty() {
                return;
            }
            let mut texts: Vec<String> = Vec::new();
            if !carry_overlap.is_empty() {
                texts.append(carry_overlap);
            }
            let end = piece_sentences
                .last()
                .map(|(_, e, _)| *e)
                .unwrap_or(*piece_start);
            for (_, _, s) in piece_sentences.iter() {
                texts.push(s.clone());
            }
            let text = texts.join(" ");
            if !text.trim().is_empty() {
                let chunk = build_chunk(
                    ctx,
                    location_source_type,
                    block.heading_path.clone(),
                    block.page,
                    block.start + *piece_start,
                    block.start + end,
                    *ordinal,
                    &text,
                );
                *ordinal += 1;
                chunks.push(chunk);
            }

            *carry_overlap = piece_sentences
                .iter()
                .rev()
                .take(opts.overlap_sentences)
                .rev()
                .map(|(_, _, s)| s.clone())
                .collect();
            *piece_len = 0;
            piece_sentences.clear();
        };

        for (s_off, e_off, sentence) in sentences {
            let s_len = sentence.chars().count();
            if piece_len + s_len > opts.target_max && piece_len > 0 {
                flush(
                    &mut piece_start,
                    &mut piece_sentences,
                    &mut piece_len,
                    &mut carry_overlap,
                    &mut self.ordinal,
                    &mut self.chunks,
                );
                piece_start = s_off;
            }
            piece_len += s_len;
            piece_sentences.push((s_off, e_off, sentence));
        }
        flush(
            &mut piece_start,
            &mut piece_sentences,
            &mut piece_len,
            &mut carry_overlap,
            &mut self.ordinal,
            &mut self.chunks,
        );

        // Sentence-level pieces are self-overlapping; a following atomic chunk
        // in the same section starts fresh (no double overlap).
        self.overlap = None;
    }
}

/// Assemble a `ChunkModel` with deterministic id + location payload.
fn build_chunk(
    ctx: &ChunkContext<'_>,
    location_source_type: &str,
    heading_path: Vec<String>,
    page: Option<i64>,
    start_offset: usize,
    end_offset: usize,
    ordinal: i64,
    text: &str,
) -> ChunkModel {
    let content_hash = chunk_content_hash(text);
    let location = ChunkLocation {
        source_type: location_source_type.to_string(),
        document_id: ctx.document_id.to_string(),
        ordinal,
        start_offset,
        end_offset,
        heading_path: heading_path.clone(),
        page_number: page,
        spine_index: ctx.spine_index,
        cfi_range: None,
        page_rects: None,
        extract_id: ctx.source_id.map(str::to_string),
        anchor_id: ctx.source_id.map(str::to_string),
    };
    ChunkModel {
        id: chunk_id(ctx.document_id, ctx.source_type, ctx.source_id, &content_hash),
        document_id: ctx.document_id.to_string(),
        source_type: ctx.source_type.to_string(),
        source_id: ctx.source_id.map(str::to_string),
        ordinal,
        text: text.to_string(),
        heading_path,
        location_json: serde_json::to_string(&location).unwrap_or_default(),
        content_hash,
        token_count: approx_token_count(text),
    }
}

/// Chunk a document-like source (multi-block). Produces chunks with monotonic
/// offsets and per-chunk heading paths.
pub fn chunk_document(
    ctx: &ChunkContext<'_>,
    input: ChunkInput<'_>,
    opts: &ChunkOptions,
) -> Vec<ChunkModel> {
    let blocks = match &input {
        ChunkInput::Markdown { text } => parse_markdown_blocks(text),
        ChunkInput::Html { html } => parse_html_blocks(html),
        ChunkInput::Plain {
            text,
            heading_heuristic,
        } => parse_plain_blocks(text, *heading_heuristic),
        ChunkInput::Paged { pages } => parse_paged_blocks(pages),
    };
    pack_blocks(ctx, &blocks, opts, ctx.location_source_type)
}

/// Build a single chunk for an extract / annotation / card front (task 4.7).
#[allow(clippy::too_many_arguments)]
pub fn single_chunk(
    ctx: &ChunkContext<'_>,
    text: &str,
    ordinal: i64,
    page_number: Option<i64>,
    start_offset: usize,
    end_offset: usize,
) -> Option<ChunkModel> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let content_hash = chunk_content_hash(text);
    let location = ChunkLocation {
        source_type: ctx.location_source_type.to_string(),
        document_id: ctx.document_id.to_string(),
        ordinal,
        start_offset,
        end_offset,
        heading_path: Vec::new(),
        page_number,
        spine_index: ctx.spine_index,
        cfi_range: None,
        page_rects: None,
        extract_id: ctx
            .source_id
            .map(str::to_string)
            .filter(|_| ctx.source_type == "extract"),
        anchor_id: ctx.source_id.map(str::to_string),
    };
    Some(ChunkModel {
        id: chunk_id(ctx.document_id, ctx.source_type, ctx.source_id, &content_hash),
        document_id: ctx.document_id.to_string(),
        source_type: ctx.source_type.to_string(),
        source_id: ctx.source_id.map(str::to_string),
        ordinal,
        text: text.to_string(),
        heading_path: Vec::new(),
        location_json: serde_json::to_string(&location).unwrap_or_default(),
        content_hash,
        token_count: approx_token_count(text),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx<'a>(doc: &'a str) -> ChunkContext<'a> {
        ChunkContext {
            document_id: doc,
            source_type: "document",
            source_id: None,
            location_source_type: "markdown",
            spine_index: None,
        }
    }

    fn parse_location(chunk: &ChunkModel) -> ChunkLocation {
        serde_json::from_str(&chunk.location_json).expect("valid location json")
    }

    #[test]
    fn markdown_headings_close_chunks_and_record_paths() {
        let text = "# Intro\n\n"
            .to_string()
            + &"Intro paragraph. ".repeat(30)
            + "\n\n## Details\n\n"
            + &"Detail paragraph. ".repeat(120);
        let chunks = chunk_document(&ctx("d1"), ChunkInput::Markdown { text: &text }, &ChunkOptions::default());
        assert!(chunks.len() >= 3, "expected multiple chunks, got {}", chunks.len());

        // No chunk spans the Intro/Details boundary.
        for c in &chunks {
            let contains_intro = c.text.contains("Intro paragraph");
            let contains_detail = c.text.contains("Detail paragraph");
            assert!(
                !(contains_intro && contains_detail),
                "chunk spans sections: {}…",
                &c.text.chars().take(80).collect::<String>()
            );
        }
        // Heading paths recorded.
        assert!(chunks.iter().any(|c| c.heading_path == vec!["Intro".to_string()]));
        assert!(chunks
            .iter()
            .any(|c| c.heading_path == vec!["Intro".to_string(), "Details".to_string()]));
    }

    #[test]
    fn nested_headings_build_level_indexed_paths() {
        let text = "# A\n\none\n\n## B\n\ntwo\n\n### C\n\nthree\n\n## D\n\nfour";
        let chunks = chunk_document(&ctx("d2"), ChunkInput::Markdown { text }, &ChunkOptions::default());
        let paths: Vec<Vec<String>> = chunks.iter().map(|c| c.heading_path.clone()).collect();
        assert!(paths.contains(&vec!["A".into()]));
        assert!(paths.contains(&vec!["A".into(), "B".into()]));
        assert!(paths.contains(&vec!["A".into(), "B".into(), "C".into()]));
        assert!(paths.contains(&vec!["A".into(), "D".into()]));
    }

    #[test]
    fn target_size_respected_for_paragraph_accumulation() {
        let para = "A normal-sized paragraph with plenty of words in it. ".repeat(6);
        let text = (0..40)
            .map(|i| format!("Paragraph {i} {para}"))
            .collect::<Vec<_>>()
            .join("\n\n");
        let chunks = chunk_document(&ctx("d3"), ChunkInput::Markdown { text: &text }, &ChunkOptions::default());
        assert!(chunks.len() > 1);
        for c in &chunks {
            let len = c.text.chars().count();
            // target_max + one atomic paragraph slack
            assert!(
                len <= 900 + para.chars().count() + 2,
                "chunk too large: {len}"
            );
        }
    }

    #[test]
    fn one_sentence_overlap_between_consecutive_chunks() {
        // Force a single huge paragraph so sentence-splitting kicks in with
        // a target_max of 60 for readability.
        let mut para = String::new();
        for i in 0..40 {
            para.push_str(&format!("Sentence number {i} is right here. "));
        }
        let opts = ChunkOptions {
            target_min: 40,
            target_max: 120,
            atomic_max: 40,
            overlap_sentences: 1,
        };
        let chunks = chunk_document(&ctx("d4"), ChunkInput::Plain { text: &para, heading_heuristic: false }, &opts);
        assert!(chunks.len() >= 3, "expected >= 3 chunks, got {}", chunks.len());
        for pair in chunks.windows(2) {
            let prev_tail = pair[0].text.rsplit(". ").next().unwrap_or("").to_string();
            let next_head = pair[1].text.split(". ").next().unwrap_or("").to_string();
            assert!(
                pair[1].text.contains(&prev_tail),
                "overlap missing: prev tail {:?} not in {:?}",
                prev_tail,
                &pair[1].text.chars().take(90).collect::<String>()
            );
            let _ = next_head;
        }
    }

    #[test]
    fn atomic_paragraph_rule_keeps_short_paragraphs_whole() {
        let para = "w".repeat(1100); // < atomic_max 1200, single "word"
        let text = para.clone();
        let chunks = chunk_document(&ctx("d5"), ChunkInput::Plain { text: &text, heading_heuristic: false }, &ChunkOptions::default());
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, para);
    }

    #[test]
    fn oversized_paragraph_splits_at_sentences() {
        let mut para = String::new();
        for i in 0..200 {
            para.push_str(&format!("This is sentence {i} with several words. "));
        }
        let chunks = chunk_document(&ctx("d6"), ChunkInput::Plain { text: &para, heading_heuristic: false }, &ChunkOptions::default());
        assert!(chunks.len() > 1);
        for c in &chunks {
            // Allow overlap sentence slack of ~80 chars.
            assert!(
                c.text.chars().count() <= DEFAULT_TARGET_MAX + 80,
                "sentence piece too large: {}",
                c.text.chars().count()
            );
        }
    }

    #[test]
    fn offsets_are_monotonic_and_within_input() {
        let mut text = String::from("# Head\n\n");
        for i in 0..60 {
            text.push_str(&format!("Paragraph {i} with a moderate amount of text to accumulate. "));
            text.push_str("\n\n");
        }
        let total = text.chars().count();
        let chunks = chunk_document(&ctx("d7"), ChunkInput::Markdown { text: &text }, &ChunkOptions::default());
        let mut last_start = 0usize;
        for (i, c) in chunks.iter().enumerate() {
            let loc = parse_location(c);
            assert!(loc.start_offset >= last_start, "chunk {i} start {} < previous {}", loc.start_offset, last_start);
            assert!(loc.end_offset <= total, "chunk {i} end {} > total {}", loc.end_offset, total);
            assert!(loc.end_offset >= loc.start_offset);
            last_start = loc.start_offset;
        }
    }

    #[test]
    fn html_tag_scan_records_heading_paths() {
        let html = "<html><body>\
            <h1>Part One</h1>\
            <p>First paragraph of prose.</p>\
            <h2>Chapter</h2>\
            <p>Second paragraph of prose.</p>\
            <style>body { color: red }</style>\
            <script>var x = 1;</script>\
            <p>Third paragraph.</p>\
            </body></html>";
        let chunks = chunk_document(
            &ChunkContext {
                document_id: "d8",
                source_type: "document",
                source_id: None,
                location_source_type: "html",
                spine_index: None,
            },
            ChunkInput::Html { html },
            &ChunkOptions::default(),
        );
        assert!(chunks.len() >= 2);
        assert!(chunks.iter().any(|c| c.heading_path == vec!["Part One".to_string()]
            && c.text.contains("First paragraph")));
        assert!(chunks.iter().any(|c| c.heading_path == vec!["Part One".to_string(), "Chapter".to_string()]
            && c.text.contains("Second paragraph")));
        // style/script content must not leak.
        assert!(chunks.iter().all(|c| !c.text.contains("color") && !c.text.contains("var x")));
    }

    #[test]
    fn epub_plain_text_heuristic_detects_heading_lines() {
        // Mirrors the processor::epub projection: bare heading lines + prose.
        let text = "Part One: The Beginning\n\nFirst paragraph under part one with some content.\n\nA VERY SHORT ALLCAPS SECTION\n\nSecond paragraph under the section heading.";
        let chunks = chunk_document(
            &ChunkContext {
                document_id: "d9",
                source_type: "document",
                source_id: None,
                location_source_type: "epub",
                spine_index: Some(3),
            },
            ChunkInput::Plain { text, heading_heuristic: true },
            &ChunkOptions::default(),
        );
        let paths: Vec<Vec<String>> = chunks.iter().map(|c| c.heading_path.clone()).collect();
        assert!(paths.contains(&vec!["Part One: The Beginning".to_string()]));
        assert!(paths.contains(&vec![
            "Part One: The Beginning".to_string(),
            "A VERY SHORT ALLCAPS SECTION".to_string()
        ]));
        // Heading text itself is not chunk content.
        assert!(chunks.iter().all(|c| !c.text.contains("ALLCAPS SECTION")));
        // Spine index recorded for later CFI enrichment.
        assert!(chunks.iter().all(|c| parse_location(c).spine_index == Some(3)));
    }

    #[test]
    fn paged_input_records_page_numbers_and_breaks_on_page_change() {
        let page1 = "Intro text paragraph. ".repeat(20);
        let page2 = "Continuation text paragraph. ".repeat(20);
        let pages = vec![page1.clone(), page2.clone()];
        let chunks = chunk_document(
            &ChunkContext {
                document_id: "d10",
                source_type: "document",
                source_id: None,
                location_source_type: "pdf",
                spine_index: None,
            },
            ChunkInput::Paged { pages: &pages },
            &ChunkOptions::default(),
        );
        assert!(chunks.len() >= 2);
        for c in &chunks {
            let loc = parse_location(c);
            assert!(loc.page_number.is_some(), "page number missing");
            assert_eq!(loc.source_type, "pdf");
        }
        // No chunk mixes both pages.
        assert!(chunks
            .iter()
            .all(|c| !(c.text.contains("Intro text") && c.text.contains("Continuation text"))));
    }

    #[test]
    fn unicode_offsets_are_char_based() {
        let text = "# 标题\n\n这是一段中文文本。它包含多个句子。用于验证字符偏移。".to_string()
            + &"\n\n日本語の段落もここにあります。オフセットを確認します。".repeat(5);
        let total = text.chars().count();
        let chunks = chunk_document(&ctx("d11"), ChunkInput::Markdown { text: &text }, &ChunkOptions::default());
        assert!(!chunks.is_empty());
        for c in &chunks {
            let loc = parse_location(c);
            assert!(loc.end_offset <= total);
            assert!(loc.start_offset <= loc.end_offset);
        }
        assert!(chunks.iter().any(|c| c.heading_path == vec!["标题".to_string()]));
    }

    #[test]
    fn sentence_splitting_handles_cjk_and_quotes() {
        let text = "第一句在这里。第二句在这里！第三句呢？English \"quoted.\" Done";
        let sentences = split_sentences(text);
        assert!(sentences.len() >= 4, "got {:?}", sentences);
        let joined: String = sentences.iter().map(|(_, _, s)| s.clone()).collect::<Vec<_>>().join("");
        assert!(joined.contains("第一句在这里。"));
        assert!(joined.contains("English \"quoted.\""));
    }

    #[test]
    fn empty_and_whitespace_inputs_produce_no_chunks() {
        for input in [
            ChunkInput::Plain { text: "", heading_heuristic: true },
            ChunkInput::Plain { text: "   \n\n  \n", heading_heuristic: true },
            ChunkInput::Html { html: "<html><body></body></html>" },
        ] {
            let chunks = chunk_document(&ctx("d12"), input, &ChunkOptions::default());
            assert!(chunks.is_empty());
        }
    }

    #[test]
    fn single_chunk_carries_extract_location() {
        let ectx = ChunkContext {
            document_id: "doc",
            source_type: "extract",
            source_id: Some("ext-1"),
            location_source_type: "pdf",
            spine_index: None,
        };
        let chunk = single_chunk(&ectx, "An extracted passage. ", 0, Some(12), 30, 52).unwrap();
        assert_eq!(chunk.source_type, "extract");
        assert_eq!(chunk.ordinal, 0);
        assert_eq!(chunk.text, "An extracted passage.");
        let loc = parse_location(&chunk);
        assert_eq!(loc.extract_id.as_deref(), Some("ext-1"));
        assert_eq!(loc.anchor_id.as_deref(), Some("ext-1"));
        assert_eq!(loc.page_number, Some(12));
        assert_eq!(loc.start_offset, 30);
        assert_eq!(loc.end_offset, 52);
        assert_eq!(chunk.content_hash, chunk_content_hash("An extracted passage."));
    }

    #[test]
    fn single_chunk_skips_empty_text() {
        let ectx = ChunkContext {
            document_id: "doc",
            source_type: "card",
            source_id: Some("item-1"),
            location_source_type: "text",
            spine_index: None,
        };
        assert!(single_chunk(&ectx, "   ", 0, None, 0, 0).is_none());
    }

    #[test]
    fn chunk_ids_are_deterministic_and_content_addressed() {
        let text = "Deterministic content for identity.";
        let a = chunk_document(&ctx("same"), ChunkInput::Plain { text, heading_heuristic: false }, &ChunkOptions::default());
        let b = chunk_document(&ctx("same"), ChunkInput::Plain { text, heading_heuristic: false }, &ChunkOptions::default());
        assert_eq!(a.len(), b.len());
        assert_eq!(a[0].id, b[0].id);
        let c = chunk_document(&ctx("other"), ChunkInput::Plain { text, heading_heuristic: false }, &ChunkOptions::default());
        assert_ne!(a[0].id, c[0].id);
    }

    #[test]
    fn ordinals_are_sequential_per_source() {
        let mut text = String::new();
        for i in 0..30 {
            text.push_str(&format!("# H{i}\n\n"));
            text.push_str(&"Body text sentence. ".repeat(20));
            text.push_str("\n\n");
        }
        let chunks = chunk_document(&ctx("d13"), ChunkInput::Markdown { text: &text }, &ChunkOptions::default());
        for (i, c) in chunks.iter().enumerate() {
            assert_eq!(c.ordinal, i as i64);
            assert_eq!(parse_location(c).ordinal, i as i64);
        }
    }
}
