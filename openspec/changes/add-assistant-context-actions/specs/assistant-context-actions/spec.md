## Purpose

Let people get help with what they are reading or discussing through labeled actions inside the Assistant, with explicit context targets and minimal typing on mobile and desktop.

## ADDED Requirements

### Requirement: Shared labeled contextual actions

The mobile Assistant and desktop document-side Assistant SHALL offer the same contextual action catalog in ordinary conversation mode. The primary actions SHALL be Summarize, Explain, and Quiz me in that order, followed by More. Every action SHALL include a meaningful icon, visible localized label, and accessible name including its target. When the available width or text scale cannot fit the primary actions, lower-priority actions SHALL move into More; when necessary a single labeled Actions control SHALL expose the catalog. The UI SHALL NOT require horizontal scrolling, hover, or guessing an unlabeled icon to find an action. Learning Agent controls and the selection Ask sheet SHALL retain their existing behavior.

#### Scenario: Desktop and mobile share meanings
- **WHEN** the user opens the mobile Assistant or desktop panel with the same readable source
- **THEN** Summarize, Explain, and Quiz me have the same target rules and result behavior on both presentations

#### Scenario: Compact or enlarged-text layout
- **WHEN** all primary labels do not fit at the current panel width or text scale
- **THEN** the UI moves Quiz me into More, and uses a labeled Actions entry if needed, without clipping labels or shrinking targets

### Requirement: Useful secondary actions with defined outcomes

More SHALL group actions under Understand, Think, and Study and SHALL include the primary actions whenever they are not promoted. Understand SHALL offer Key points, Key terms, Translate, and Outline document; Think SHALL offer Give an example and Examine argument; Study SHALL offer Make flashcards. Summarize SHALL request a concise recap, Explain SHALL request a plain-language explanation, Key points SHALL request the main claims, Key terms SHALL explain source terminology, and Examine argument SHALL separate claims, reasons, assumptions, and open questions while distinguishing source statements from inference. Give an example SHALL be available in Chat scope and SHALL identify generated examples as illustrative. It SHALL NOT silently change answer scope to become available. Outline document SHALL explicitly target the whole named source, regardless of an active passage target. Translation SHALL require a destination-language choice, SHALL operate only on a selection, attached sections, or bounded passage, and SHALL send nothing if the choice is canceled.

#### Scenario: Practical reading help
- **WHEN** a user activates Key terms on a difficult selected paragraph
- **THEN** the reply explains terms from that paragraph with source grounding rather than inventing unrelated vocabulary

#### Scenario: Translation requires language and a bounded target
- **WHEN** the user selects Translate for a passage and chooses a language
- **THEN** the Assistant translates that captured passage into the chosen language in the conversation
- **AND** a whole-document target instead offers guidance to select a passage without sending a request

#### Scenario: Scope-compatible examples
- **WHEN** Document or Library scope is selected
- **THEN** Give an example is unavailable with guidance to explicitly choose Chat for illustrative examples, and activation does not change scope

#### Scenario: Explicit document outline
- **WHEN** a selection is active and the user activates Outline document
- **THEN** the displayed request names the whole source and its outline uses the whole-source coverage policy rather than outlining only the selection

### Requirement: Visible deterministic action targets

The Assistant SHALL identify what each action operates on separately from the Chat/Document/Library answer scope. The default target SHALL prioritize a live source selection, then an applicable pinned selection, then explicitly attached sections, then the viewer's focused passage/page window or transcript segment, then readable full-source context, then a substantive conversation when no source is attached. Labels SHALL describe actual available evidence rather than claiming a whole source or current passage that is not supplied. A pinned selection from a different source SHALL require an explicit target choice or removal before submission. More SHALL let the user explicitly select eligible targets including the whole document and conversation. A manual target SHALL reset when its source changes or is detached.

#### Scenario: No-typing selection summary
- **WHEN** a user selects a paragraph and taps Summarize
- **THEN** the user message identifies the selection and source and the reply summarizes that selection, with surrounding context secondary

#### Scenario: Reading without a selection
- **WHEN** no selection or sections are attached and the viewer supplies a nearby-page window
- **THEN** Summarize uses that window and the target label identifies the nearby pages rather than the whole document

#### Scenario: Only full-source text is supplied
- **WHEN** the viewer supplies readable full-source text without a focused passage
- **THEN** the target label says This document or Full transcript and does not claim a current passage

#### Scenario: Mismatched pinned source
- **WHEN** the reader shows Document B while an explicitly pinned excerpt belongs to Document A
- **THEN** the Assistant names both targets and requires the user to choose one or clear the old pin before a quick action submits

#### Scenario: No reading source
- **WHEN** no source is attached but a substantive conversation exists
- **THEN** conversation-compatible actions name the conversation target and Summarize is labeled Recap chat
- **AND** with neither source nor substantive conversation the Assistant offers attach-source/start-conversation guidance instead of an enabled action with fabricated context

### Requirement: Target authority and grounding survive asynchronous work

Action submission SHALL capture the target's identity, content or stable resolution inputs, locator, coverage, parameters, and answer scope at activation. This capture SHALL remain authoritative throughout context resolution, generation, citation attribution, retry, and any explicitly permitted tool work. A passage action SHALL NOT expand to the whole document because of its label or prompt wording. Whole-source actions SHALL disclose partial coverage when the available budget does not cover the source. Source-targeted actions in Library scope SHALL NOT widen to other sources. Existing selection citation behavior and source-grounding boundaries SHALL remain enforced. A source change while a parameter picker is open SHALL require target re-selection before dispatch.

#### Scenario: Source changes during generation
- **WHEN** a user starts Explain on a passage in Document A and opens Document B before completion
- **THEN** the result remains attributed to Document A in its owning conversation or is discarded according to the conversation lifecycle, and is never relabeled or grounded as Document B

#### Scenario: Passage summary avoids whole-document inference
- **WHEN** a localized Summarize action targets a bounded passage in a long book
- **THEN** the request retains passage coverage without silently loading or summarizing the rest of the book

#### Scenario: Full document exceeds budget
- **WHEN** a whole-document action can include only windows or retrieved chunks within the model budget
- **THEN** the answer clearly states the partial coverage and does not claim exhaustive whole-document treatment

#### Scenario: Source changes during language choice
- **WHEN** the user opens Translate and changes documents before choosing a language
- **THEN** no request is issued until the user selects the intended valid target again

### Requirement: Immediate actions preserve drafts and input focus

Activating a ready action without parameters SHALL submit it immediately to the existing conversation without requiring Send, overwriting unsent text, clearing attachments or section chips, sending draft images, or opening the software keyboard. Actions SHALL remain usable through the menu while a draft exists. Each submitted turn SHALL show a localized readable action and named target and SHALL use the existing configured model/provider, citations, consent gates, stop, and error UI. Pure answer and quiz actions SHALL NOT create cards, extracts, or document edits. No action SHALL trigger automatic indexing or silently change provider, paid-fallback consent, or answer scope.

#### Scenario: Unsent draft survives a shortcut
- **WHEN** a user has an unsent question and image attachment and activates Explain from the action menu
- **THEN** Explain submits using the named action target while the draft and attachment remain unsent and unchanged

#### Scenario: Read-only result attempts a write
- **WHEN** a Summarize response includes a proposed card creation or document edit
- **THEN** the mutation is not executed and the action remains a conversational response

### Requirement: Single-flight action lifecycle and exact-target recovery

Only one action turn SHALL start at a time, including asynchronous context loading. Repeated activation SHALL NOT create duplicate turns or provider calls. Running actions SHALL have visible progress and a stop control. Errors and cancellation SHALL preserve the composer draft and target information. Retry SHALL use the original action and captured target; if that target is no longer available, the UI SHALL offer an explicit Run on current context choice rather than substituting it silently. Actions without readable context or an available AI path SHALL explain the problem with an appropriate setup/recovery entry instead of issuing a doomed request. The catalog SHALL cause no inference or source indexing merely by rendering or opening.

#### Scenario: Repeated tap while loading context
- **WHEN** a user taps Summarize twice before the source loader resolves
- **THEN** exactly one user turn and one generation run start

#### Scenario: Retry after document switch
- **WHEN** an action on Document A fails and the reader has switched to Document B
- **THEN** Retry retains Document A, or asks explicitly to run on current context if the old target cannot be recovered

#### Scenario: No ready provider
- **WHEN** the current environment has neither a usable configured provider nor a ready local model
- **THEN** the Assistant shows actionable AI setup/readiness guidance and no inference request is made by action activation

### Requirement: Conversational quiz supports tap-only study

Quiz me SHALL start with one question grounded in the captured target and keep its answer and optional hint concealed from view and the accessibility tree. It SHALL expose Show answer, Hint when available, and Next question as labeled controls. Show answer and Hint SHALL reveal existing generated content without another inference request. Next question SHALL request one new question on the same target, avoid previously asked questions, and conceal its answer again. Typed answers SHALL remain possible. Quiz controls SHALL NOT create saved cards or scheduled reviews. Quiz state SHALL survive conversation restoration without automatic regeneration; New conversation SHALL clear it. Switching the source SHALL retire the previous active quiz controls with an explicit restart entry for the new source. Invalid quiz content SHALL produce a recoverable failure rather than pretending an exposed answer is hidden.

#### Scenario: Self-test without a keyboard
- **WHEN** the user taps Quiz me, then Hint, then Show answer
- **THEN** one question is shown first, the hint and answer are revealed only when requested, no extra generation request is made for those reveals, and the keyboard stays closed

#### Scenario: Continue studying
- **WHEN** the user taps Next question
- **THEN** one new question is generated for the same captured target, the prior question is excluded, and the new answer starts hidden

#### Scenario: Restore a quiz or change source
- **WHEN** the conversation is reopened
- **THEN** the stored question and reveal state return without a new model request
- **AND** if the active source changes the old quiz controls retire and offer an explicit restart on the new source

### Requirement: Explicit flashcard creation reuses study behavior

Make flashcards SHALL disclose that it creates study cards before activation, formulate from its captured target, and render persisted cards through the existing collection UI and review controls. Source-targeted generation SHALL not include unrelated conversation history, and card association SHALL use the captured source/deck even if the reader changes. A repeated activation or retry after successful persistence SHALL NOT replay completed card writes. The existing per-answer flashcard action SHALL remain isolated to its clicked response.

#### Scenario: Study a selected passage
- **WHEN** a user activates Make flashcards on a captured passage and changes documents while cards are generated
- **THEN** the generated collection uses that passage and retains the original source association

#### Scenario: Partial persistence failure
- **WHEN** some generated cards are saved and another card fails
- **THEN** the collection exposes existing per-card recovery without recreating cards that already succeeded

### Requirement: Accessible localized action surfaces

All action labels, target descriptions, menu groups, display requests, quiz controls, errors, and accessible names SHALL be localized in de, en, es, fr, ja, and zh. Controls SHALL provide visible focus and at least 48 CSS-pixel targets on coarse pointers and 40 CSS-pixel targets otherwise. More SHALL work by touch and keyboard, expose expansion state and appropriate menu/dialog semantics, preserve meaningful focus on dismissal, close before the Assistant on Escape/Back, and remain within the visible panel/sheet at large text and with the software keyboard present. The visual treatment SHALL follow current theme roles and reduced-motion preferences.

#### Scenario: Screen-reader or keyboard use
- **WHEN** the user explores action controls, opens More, invokes an action, and dismisses More with Escape or Back
- **THEN** labels and targets are announced, controls work without hover, and focus returns to the trigger without closing the Assistant or opening the keyboard

#### Scenario: Long translations and large text
- **WHEN** German labels or 200 percent text scale are active
- **THEN** labels remain readable through promotion reduction and menu reflow with no horizontal action scrolling or clipped controls
