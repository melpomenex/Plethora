## Why

Incrementum is built around incremental reading and spaced repetition, but generating effective, high-retention flashcards requires adhering to sound cognitive principles. Dr. Piotr Wozniak's *20 Rules of Knowledge Formulation* (and its modern incremental reading evolution on SuperMemo Guru) is the gold standard for creating atomic, high-retention flashcards that avoid interference, maximize applicability, and keep learning pleasurable.

Currently, users across Document Q&A, the Assistant panel, and AI Flashcard Studio must manually describe how they want cards formulated or receive generic cards that frequently violate the minimum information principle (e.g., wordy answers, complex enumerations, passive facts lacking context). Adding a dedicated, memorable command (e.g., `/20rules` and `/formulate`) across these surfaces equips users with one-click access to prompt-engineered 20-rules card formulation, accompanied by explicit reminders of what the rules are and why they work.

## What Changes

- **Core Formulation System & Prompt Engine**:
  - Add a shared knowledge formulation module defining the 20 rules of knowledge formulation, concise summaries, reminder metadata, and optimized system prompt directives for LLM generation.
  - Formulate cards strictly adhering to core principles: Comprehension before memorization, Minimum Information Principle (atomic items), Cloze deletions as mnemonic anchors, Rule-based abstract knowledge over isolated facts, Avoidance of complex sets/enumerations, Redundancy from multiple angles (Knowledge Darwinism), Contextual cues, and Source/Date anchors.

- **Assistant Panel Surface**:
  - Add `/20rules` (and alias `/formulate`) slash command support with auto-completion / quick-action chip.
  - Update `/help` documentation to explain `/20rules` and summarize its knowledge formulation principles.
  - When invoked with or without trailing prompt text, guide the user and model to synthesize the active document/context into cards adhering to the 20 rules.

- **Document Q & A Tab Surface**:
  - Add `/20rules` quick action button / chip above or beside the input composer.
  - Support typing `/20rules` in the Document Q&A chat composer to inject the 20-rules knowledge formulation directives into the conversation context with active document citations.
  - Provide an inline reminder card/tooltip highlighting key formulation rules and what the command does.

- **AI Flashcard Studio Surface**:
  - Add a dedicated "20 Rules Formulation" quick template and context chip (`/20rules`).
  - Render an educational reminder card describing how the 20 rules refine card generation (atomic cards, cloze anchors, anti-interference).
  - Update Studio generation prompts and preset directives to enforce atomic formulation.

- **Shared Internationalization & Documentation**:
  - Add localized strings for the `/20rules` command, descriptions, rule reminders, and template labels across supported languages (en, de, es, fr, ja, zh).

## Capabilities

### New Capabilities
- `knowledge-formulation-rules`: Shared definition, prompt templates, rule summaries, and validation for Dr. Piotr Wozniak's 20 Rules of Knowledge Formulation applied to flashcard generation across all AI surfaces in Incrementum.

### Modified Capabilities
- `flashcard-studio-sessions`: Studio session templates and chips updated to include the 20 Rules Formulation preset and command trigger.

## Impact

- **Frontend Components**:
  - `src/components/assistant/AssistantPanel.tsx`
  - `src/components/tabs/DocumentQATab.tsx`
  - `src/components/review/FlashcardStudioModal.tsx`
  - `src/lib/ai/` prompt & task definitions
  - `src/lib/i18n/locales/`
- **APIs and Prompts**:
  - Chat system prompts for Document Q&A, Assistant, and Flashcard Studio.
- **Dependencies**: No external runtime dependency additions required.
