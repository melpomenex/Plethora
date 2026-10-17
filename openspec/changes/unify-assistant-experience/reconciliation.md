# Predecessor specification reconciliation

This file makes the deliberate changes to unarchived capability contracts explicit. It is supporting planning material, not a second capability owner or a claim that absent base specs can accept MODIFIED deltas today. Current validated deltas target only existing bases. Task 0.1 must resolve the following before implementation/archival of overlapping behavior.

## Ordering and mechanical checks

1. Reconcile/archive the implemented `unify-assistant-conversation-and-video-context` and `update-mobile-assistant-composer` using the repository workflow. Preserve all verified scenarios and do not mark unverified gates complete merely to archive.
2. The gesture change remains independently owned while its device gates are unfinished. If its capability has not reached `openspec/specs`, update its pending requirement as part of the implementation's coordinated spec work; do not add a duplicate ADDED capability here. When its base exists, add a normal MODIFIED delta to this change instead. Never force-archive unfinished validation to manufacture a base.
3. Once each base exists, materialize the complete replacement blocks below as MODIFIED deltas under its exact capability path, declare those modified capabilities in this proposal, and run strict validation again. Preserve unaffected predecessor requirements/scenarios. This is a deterministic artifact rebase, not an unresolved product choice.
4. Before archive, compare resulting base spec text to this change's `assistant-context-routing`, `assistant-conversation-lifecycle` and `mobile-ask-sheet`; no simultaneous top-level-mode mandate, independent selection-store mandate or all-detents-modal mandate may remain. Audit old pending session/Yjs plans as superseded work, not parallel implementations.

## assistant-conversation-scopes

Replace the entire `Three explicit user-selectable conversational scopes` requirement when the predecessor base is available:

### Requirement: Three explicit user-selectable conversational scopes

The Assistant SHALL preserve Chat, strict Document and strict Library policies across supported surfaces. New ordinary conversations SHALL default to contextual Chat, showing optional available source attachments without requiring a top-level technical mode choice. An explicit document/library entry SHALL prepare the corresponding visible restriction. Source attachments and effective restrictions SHALL remain visible; the three policies SHALL be reachable through secondary source controls. Merely opening a document or video SHALL not silently impose a strict restriction. This requirement's presentation supersedes the earlier three adjacent top-level mode buttons; it does not remove any grounding policy.

#### Scenario: Newly opened Assistant defaults to Chat scope
- **WHEN** an ordinary new conversation opens over a document/video
- **THEN** the document/video is visible as optional context and Chat behavior applies without a mandatory mode choice

#### Scenario: Explicit Library Q&A entry point selects Library scope
- **WHEN** Ask about your library is activated
- **THEN** its prepared canonical conversation visibly targets the authorized library subset with Library grounding
- **AND** no question is submitted automatically

## mobile-assistant-conversation

Replace the entire `Selection Ask remains isolated` requirement (retain its name for a straightforward MODIFIED delta; renaming later is optional):

### Requirement: Selection Ask remains isolated

Selection Ask SHALL use the same canonical repository/controller and existing global mobile host as ordinary Assistant conversations. Isolation SHALL mean that distinct conversation IDs preserve their own messages/drafts/context; it SHALL NOT require a competing store or sheet. A new selection prepares its own canonical thread unless the user explicitly adds it to an existing one. Returning to the prior global thread SHALL retain its state. Only one conflicting Assistant presentation SHALL be interactive at a time.

#### Scenario: Selection Ask between global turns
- **GIVEN** a global conversation and draft exist
- **WHEN** the user opens a new selection question, dismisses it and resumes the prior thread
- **THEN** both canonical threads retain their own messages/drafts and the selection thread can be reopened from History

#### Scenario: Selection action while global open
- **WHEN** selection Ask is accepted while the global host is open
- **THEN** the host prepares the selection thread after preserving the outgoing draft
- **AND** no stacked competing sheet or duplicate writable history is created

## mobile-assistant-sheet

Replace the entire `Accessible and responsive presentation` requirement once its base is available, preserving the incumbent 48px/reduced-motion/direct-manipulation guarantees:

### Requirement: Accessible and responsive presentation

Tap, keyboard and assistive activation SHALL provide the complete invocation flow. The sheet SHALL have an accessible name and explicit Close/Expand/Collapse controls with focus restoration and non-haptic state indications. Expanded SHALL contain focus as a modal; usable partial mode SHALL be a named nonmodal region allowing the visible reader to remain operable. Modal state, focus containment and background inert behavior SHALL change atomically with detent ownership. Constrained viewports SHALL use expanded-only fallback. Controls SHALL have at least 48 CSS-pixel touch targets. Reduced motion SHALL remove spring settlement while retaining direct manipulation. Drag rendering SHALL not perform AI/context extraction or rerender the conversation on every movement frame.

#### Scenario: VoiceOver or TalkBack
- **WHEN** a screen-reader user invokes, expands, collapses and closes Assistant
- **THEN** its name/state/actions and focus transitions are announced correctly, and the exposed reader is accessible only in nonmodal partial mode or after dismissal
- **AND** exploration alone does not start a drag and closing restores usable focus

#### Scenario: Reduced motion and haptics off
- **GIVEN** reduced motion and disabled haptics
- **WHEN** the user opens, expands and dismisses Assistant
- **THEN** all states remain visually and accessibly distinguishable without spring motion or vibration

#### Scenario: Reader load
- **WHEN** the user drags while a representative large PDF renders or video plays
- **THEN** reveal tracks the finger without document remount, extraction, model requests, per-frame conversation rerenders or unrelated reading-position mutation

Also revise `Adaptive sheet detents and handle ownership` only if its final archived form requires a blanket scrim/all-background lock: retain current geometry/handle/one-state-per-drag guarantees, make partial reader input pass through outside sheet bounds, and retain scroll non-chaining from inside the sheet. Existing Back/system-gesture requirement remains unchanged.

## Other scope and temporal guarantees

- The earlier external-lookup change replaces old keyword expansion with Chat/Document/Library policy. Preserve that implementation/spec update before applying this proposal; this proposal adds deterministic attachment authorization, not a return to keyword-authorized widening.
- `mobile-assistant-composer`'s earlier desktop/selection-unchanged clauses describe that earlier change's scope. They do not justify deleting desktop controls or adding new mobile chrome in this work. Retain the compact mobile bar and registry-backed add menu while changing shared ownership.
- `document-qa-workspace` existing draft preservation, no auto-submit, busy-entry behavior, source controls, study/research actions and accessibility remain applicable. Any controller update allowing a presentation switch during generation must retain its original-turn durability guarantee.
- Stale `local-data-plane` no-sync prose and old Yjs overhaul plans are not authorities for new conversation transport. Use actual restored Pro sync and existing `plethora-sync` contract. General cleanup of those historical specifications is outside this proposal.
