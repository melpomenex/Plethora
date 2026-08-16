## Context

Incrementum is an incremental reading and spaced repetition system. Effective spaced repetition relies critically on knowledge formulation: cards must be atomic, unambiguous, comprehensible, and resistant to interference. Dr. Piotr Wozniak's *20 Rules of Knowledge Formulation* (and its modern SuperMemo Guru incremental reading extensions) is the established foundational methodology for optimal item creation.

Currently, Incrementum's AI card creation features (Document Q&A, Assistant, Flashcard Studio) use generic prompt instructions. When users ask the AI to "create flashcards", models frequently produce wordy answers, complex multi-item lists, and disconnected trivia that cause high lapse rates during review. Providing a system-wide `/20rules` command and visual reminder gives learners immediate access to cognitive science-backed flashcards.

## Goals / Non-Goals

**Goals:**
- Provide a unified `/20rules` (and `/formulate`) command across Document Q&A, the Assistant panel, and AI Flashcard Studio.
- Provide explicit, user-facing reminders and educational explanations of what the 20 rules are (Minimum Information Principle, Cloze deletions, High Applicability, Anti-Interference, etc.) and why they matter.
- Implement a shared prompt construction engine that injects concise, strict 20-rules constraints into LLM completions and tool calls across all surfaces.
- Ensure generated flashcards are output via standard tool calls (`create_qa_card`, `create_cloze_card`) so they are directly previewed, edited, and saved into the user's review deck.
- Support full internationalization for command labels, descriptions, and reminders.

**Non-Goals:**
- Replacing existing standard templates in Flashcard Studio; `/20rules` complements them as a specialized formulation strategy.
- Automated static linter for cards manually typed in the review editor (future enhancement).

## Decisions

### Decision 1: Shared Knowledge Formulation Core Module (`src/lib/ai/knowledgeFormulation.ts`)
We will create a centralized module `src/lib/ai/knowledgeFormulation.ts` containing:
1. `TWENTY_RULES_METADATA`: Command name (`/20rules`), aliases (`["/formulate", "/rules", "/twenty-rules"]`), title, short summary, and detailed 20-rules reminder text.
2. `buildTwentyRulesSystemPrompt(baseContext?: string)`: Generates structured LLM instructions requiring:
   - **Comprehension first**: Extract concepts that form a coherent picture.
   - **Minimum Information Principle**: Answers must be as short as humanly possible (words/phrases, not paragraphs). Questions must be pinpoint specific.
   - **Cloze Deletions**: Prefer cloze deletions for sentence facts and terminology.
   - **Avoid Sets & Lists**: Never make a single card asking for a list of 5 items; break down into individual binary or cloze associations.
   - **Combat Interference**: Disambiguate similar terms with clear context cues.
   - **Redundancy (Knowledge Darwinism)**: Formulate key ideas from both active and passive angles (e.g. term → definition AND definition → term).
   - **High Applicability**: Focus on rules, mechanisms, and "why/how" over superficial trivia.
3. `isTwentyRulesCommand(input: string)`: Utility to detect if a prompt starts with the command.
4. `stripTwentyRulesCommand(input: string)`: Cleans input to isolate the remaining user query.

*Rationale*: A single source of truth prevents prompt drift between the Assistant, Document Q&A, and Flashcard Studio.

### Decision 2: Assistant Panel Workflow
In `src/components/assistant/AssistantPanel.tsx`:
1. Add `/20rules` to the Quick Actions row next to `/tools`, `/help`, `/clear`.
2. Update `/help` command text to describe `/20rules`.
3. In `handleSend`:
   - If `/20rules` is called with no context and no trailing text, output an educational guide explaining the 20 rules with contrasting good vs bad card examples.
   - If `/20rules` is called with active document/context, augment the system prompt with `buildTwentyRulesSystemPrompt()` and instruct the model to execute `create_qa_card` and `create_cloze_card` tool calls.

### Decision 3: Document Q&A Tab Integration
In `src/components/tabs/DocumentQATab.tsx`:
1. Add a `/20rules` quick action button / chip in the composer toolbar with a hover tooltip displaying the 20 Rules reminder.
2. When the user sends a query starting with `/20rules` or clicks the chip, inject the 20 Rules formulation directives into `systemPrompt`.

### Decision 4: AI Flashcard Studio Integration
In `src/components/review/FlashcardStudioModal.tsx`:
1. Add the `twenty-rules` template to `QUICK_TEMPLATES` with icon, `/20rules` command chip, and description.
2. In the `templates` view, render a prominent feature card for the 20 Rules of Knowledge Formulation explaining the rules.
3. When selected, the studio prompt is populated with the formulation prompt and the session model instruction enforces atomic card output.

## Risks / Trade-offs

- **[Risk]** Overly verbose prompts might increase token usage.
  - *Mitigation*: The 20-rules system instruction is tightly engineered to be concise (~250 tokens), focusing on negative constraints (no lists, minimal answers, use clozes) that produce higher density cards in fewer output tokens.
- **[Risk]** Models might ignore tool calls when given detailed rule prompts.
  - *Mitigation*: The tool calling instructions remain prioritized and explicit in both system prompt and user prompt wrappers.

## Migration Plan

No database schema migrations or local storage migrations required. New templates and commands are backward-compatible and additive.
