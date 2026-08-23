---
title: "Sentence Mining"
description: "1-click generation of contextual target-language cloze cards pairing sentence text, audio snippet, dictionary definition, and translation."
category: "language-learning"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["sentence card","mining flashcard","audio sentence card","1-click cloze"]
aliases: ["sentence card","mining flashcard","audio sentence card","1-click cloze"]
relatedDocs: ["language.dictionary_peek","review.flashcard_studio","tts.playback"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/language/sentence-mining.md"
---
# Sentence Mining

## Purpose
Automates the creation of high-yield spaced repetition sentence cards directly from native reading and video listening materials.

## User-Facing Behavior
- Captures the complete target sentence containing the unknown word.
- Automatically Clozes the target word (`{{c1::target_word}}`).
- Attaches the dictionary definition to the back of the card.
- Clips surrounding audio recording from video/podcast or generates neural TTS pronunciation.

## Exact Behavioral Rules
1. Automatically detects sentence boundaries using Unicode sentence segmentation rules.
2. Extracts source document title, page number, and chapter citation into provenance metadata.
3. Automatically marks the mined lemma as `state: "learning"` in the user's language profile.

## Rationale
Sentences provide syntactic anchors and collocations that make word meanings stick naturally in long-term memory.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `language.mining.autoRecordAudio` | `true` | Attach audio snippet or neural TTS pronunciation to mined card |

## Platform Behavior
- **All Platforms**: One-click creation takes <200ms with zero dialog interruption.