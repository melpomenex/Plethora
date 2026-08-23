---
title: "Lexical Coverage & Highlight"
description: "Real-time color-coded vocabulary highlighting in readers based on user's known, learning, and new lemma states."
category: "language-learning"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["vocabulary highlight","word frequency color","known words","comprehensible input"]
aliases: ["vocabulary highlight","word frequency color","known words","comprehensible input"]
relatedDocs: ["language.profiles","language.dictionary_peek","reader.selection.actions"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/language/lexical-coverage.md"
---
# Lexical Coverage & Highlight

## Purpose
Provides instantaneous visual feedback on text difficulty by highlighting words according to your personal vocabulary knowledge base.

## User-Facing Behavior
- Displays document Lexical Coverage stats in reader header (e.g. `94.2% Known Words • 42 New Lemmas`).
- Color coding:
  - **Unmarked (White/Normal)**: Known words.
  - **Yellow / Amber**: Active learning vocabulary (in spaced repetition).
  - **Blue / Underlined**: New, unseen words.
- Clicking any highlighted word opens the Dictionary Peek card.

## Exact Behavioral Rules
1. Tokenizes text using language-specific morphological analyzers (e.g. Kuromoji/MeCab for Japanese, Jieba for Chinese, SpaCy for European languages).
2. Maps inflected forms (e.g. `corriendo`, `corrió`) to root lemma (`correr`).
3. Marking a word as "Known" removes highlights across all open documents immediately.

## Rationale
Language immersion works best when content is ~95-98% comprehensible ($i+1$). Lexical coverage statistics allow learners to pick appropriately challenging texts.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `language.highlightLearningWords` | `true` | Highlight words currently under active review |

## Platform Behavior
- **All Platforms**: Tokenization executed in native Rust threads with zero UI blocking.