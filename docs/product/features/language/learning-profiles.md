---
id: language.profiles
title: Language Learning Profiles
domain: language
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Dedicated target language profiles (A1-C2 CEFR levels, native language, lemma tracking, and study goals).
how_to: Open Settings → Language Learning. Create a language profile, choose your native language and target language (e.g. Spanish, Japanese, German).
why: Language acquisition requires separate vocabulary lexicons and tailored dictionary engines distinct from general knowledge reading.
aliases:
  - language profile
  - cefr level
  - target language
  - foreign language settings
settings:
  - language.activeProfileId
  - language.targetCefrLevel
actions:
  - id: action.language.dictionary
    label: Open Language Dictionary
    shortcut: Alt+L
related:
  - language.vocabulary
  - language.dictionary_peek
  - language.sentence_mining
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
