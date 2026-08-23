---
title: "Language Learning Profiles"
description: "Dedicated target language profiles (A1-C2 CEFR levels, native language, lemma tracking, and study goals)."
category: "language-learning"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["language profile","cefr level","target language","foreign language settings"]
aliases: ["language profile","cefr level","target language","foreign language settings"]
relatedDocs: ["language.vocabulary","language.dictionary_peek","language.sentence_mining"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/language/learning-profiles.md"
---
# Language Learning Profiles

## Purpose
Configures language-specific dictionaries, morphology lemmatizers, frequency lists, and CEFR proficiency targets for foreign language reading.

## User-Facing Behavior
- Profile switcher in navigation header allowing one-click toggle between study languages.
- Configures target CEFR level (A1 Beginner, A2 Elementary, B1 Intermediate, B2 Upper Intermediate, C1 Advanced, C2 Mastery).
- Tracks cumulative known vocabulary word count and daily lexical growth.

## Exact Behavioral Rules
1. Every profile maintains its own isolated vocabulary knowledge base (known lemmas, learning lemmas, ignored proper nouns).
2. Document readers automatically activate the matching profile's tokenizer based on document language metadata.
3. Multiple active target language profiles are supported simultaneously.

## Rationale
Prevents lexical interference when learning multiple languages and allows different dictionaries and TTS voices per language.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `language.targetCefrLevel` | `"B2"` | Desired target CEFR vocabulary tier |

## Platform Behavior
- **All Platforms**: Profiles synced across devices via encrypted delta logs.