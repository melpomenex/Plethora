# Acceptance Plan: Fix Assistant Full-Transcript Context, Token Budgeting, and Source Coverage

## Overview

This document specifies deterministic acceptance criteria, test fixtures, coverage assertions, and verification scenarios to ensure that whole-source Assistant actions and questions default to complete transcript coverage, honor user-configured context settings, and eliminate premature head-truncation.

---

## 1. Regression Reproduction Acceptance Scenario: Michael Pollan 2-Hour Video

### Scenario Description
- **Source**: 2-hour, 2-minute video transcript (~32,000 words, ~41,000 tokens).
- **Playback Position**: Paused at 18:20.
- **Scope**: Document scope.
- **Provider**: OpenRouter (`anthropic/claude-3.5-sonnet` or similar).
- **AI Settings**: User configured Context Window = 50,000 tokens.
- **Action**: User clicks "Key points".

### Expected Behavior (Pass Criteria)
1. **No Head Truncation**: `resolveActionEnvelope` in `execution.ts` does NOT slice the transcript with `trimToTokenWindow` or reduce it by 0.55. The envelope carries the complete canonical transcript.
2. **Policy Resolution**: Request policy resolves `configuredContextTokens = 50,000`, `maxOutputTokens = 4,096`, and `promptBudgetTokens = 45,904`.
3. **Direct Fit Processing**: Because the 41,000-token transcript fits within the 45,904-token prompt budget:
   - `videoContextPlanner` selects `mode: "full"` and `coverage: "full"`.
   - The entire transcript (from 00:00 to 2:02:00) is included directly in the prompt.
   - `sourceCoverage` is set to `"full"`.
4. **Prompt Assembly**: `promptBuilder` does NOT inject the disclaimer `"SOURCE COVERAGE LIMIT: The supplied source content is only a bounded window..."`.
5. **Takeaways Verification**: The generated takeaways cover arguments and claims spanning early, middle, and late sections of the video (including sections after 1:30:00).
6. **UI Coverage Indicator**: The UI displays the badge `Full transcript · 2h 02m · Direct context`.
7. **Negative Assertion**: The response does NOT contain the phrase "supplied window" or restrict evidence to 00:06–00:45.

---

## 2. Transcript Duration Scenarios (Synthetic Sentinel Tests)

Each test fixture contains three embedded sentinel markers:
- `SENTINEL_ALPHA_START` at 00:00:30
- `SENTINEL_BETA_MIDDLE` at 50% video duration
- `SENTINEL_OMEGA_END` at 95% video duration

### Test Matrix

| Scenario ID | Video Duration | Token Estimate | Configured Context | Expected Mode | Coverage Status | Sentinel Assertions |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **DUR-30S** | 30 seconds | ~120 tokens | 8,192 tokens | `full` | `full` | ALPHA present |
| **DUR-5M** | 5 minutes | ~1,200 tokens | 8,192 tokens | `full` | `full` | ALPHA, BETA, OMEGA present |
| **DUR-30M** | 30 minutes | ~7,500 tokens | 16,384 tokens | `full` | `full` | ALPHA, BETA, OMEGA present |
| **DUR-2H-LARGE** | 2 hours | ~38,000 tokens | 50,000 tokens | `full` | `full` | ALPHA, BETA, OMEGA present |
| **DUR-2H-SMALL** | 2 hours | ~38,000 tokens | 8,192 tokens | `map-reduce` | `hierarchical-full` | Intermediate summaries cover all 3; final synthesis reflects ALPHA, BETA, OMEGA |
| **DUR-6H** | 6 hours | ~110,000 tokens | 50,000 tokens | `map-reduce` | `hierarchical-full` | All windows processed; intermediate budgets ≥ 160 tokens; final synthesis includes OMEGA |
| **DUR-12H** | 12 hours | ~220,000 tokens | 65,536 tokens | `map-reduce` | `hierarchical-full` | Multi-stage reduction succeeds; no 32-token degradation; final synthesis includes OMEGA |

---

## 3. Context Policy and Settings Precedence Scenarios

### Scenarios

#### TC-POL-01: Global 50,000-Token Fallback with Unset Provider Override
- **Given**: `settingsStore.settings.ai.maxTokens = 50000`, active provider is OpenRouter with `contextWindowTokens = undefined` and model `anthropic/claude-3.5-sonnet`.
- **When**: `resolveRequestPolicy` is invoked from `AssistantPanel` or `resolveActionEnvelope`.
- **Then**: `configuredContextTokens` is `50000`, `promptBudgetTokens` is `45904` (with default 4096 output reserve). It does NOT fall back to 8,192.

#### TC-POL-02: Provider-Specific Context Override Wins Over Global
- **Given**: `settingsStore.settings.ai.maxTokens = 50000`, active provider is Ollama with `contextWindowTokens = 16384`.
- **When**: `resolveRequestPolicy` is invoked.
- **Then**: `configuredContextTokens` is `16384`.

#### TC-POL-03: Per-Model Override Wins Over Provider and Global
- **Given**: `settingsStore.settings.ai.maxTokens = 50000`, provider `contextWindowTokens = 16384`, and `modelContextWindows["custom-model"] = 32768`.
- **When**: `resolveRequestPolicy` is invoked for `model = "custom-model"`.
- **Then**: `configuredContextTokens` is `32768`.

#### TC-POL-04: LLM Provider Settings UI Saves Context for All Providers
- **Given**: User navigates to Settings → LLM Providers and edits an OpenRouter provider.
- **When**: User selects `64k` preset and clicks Save.
- **Then**: `llmProvidersStore` updates provider with `contextWindowTokens = 65536` and `contextWindowPreset = "64k"`.

#### TC-POL-05: AI Settings NumericInput Does Not Clamp 50,000 to 32,000
- **Given**: User enters `50000` into `AISettings` context window input.
- **When**: Input triggers `onChange` and `onBlur`.
- **Then**: `settingsStore.settings.ai.maxTokens` is stored as `50000`.

---

## 4. Assistant Action Coverage Matrix

| Action | Intent Type | Document Scope Default | Selection Present | Expected Coverage |
| :--- | :--- | :--- | :--- | :--- |
| **Key points** | Whole-source analytical | Full transcript (direct or map-reduce) | Bounded to selection | `full` or `hierarchical-full` (or `window` if selection) |
| **Summarize** | Whole-source analytical | Full transcript (direct or map-reduce) | Bounded to selection | `full` or `hierarchical-full` (or `window` if selection) |
| **Outline document** | Whole-source analytical | Full transcript (direct or map-reduce) | Ignored (action is whole-source only) | `full` or `hierarchical-full` |
| **Explain** | Contextual explanation | Whole-transcript if no selection | Bounded to selection | `full` (whole source) or `window` (selection) |
| **Examine argument** | Whole-source analytical | Full transcript | Bounded to selection | `full` or `hierarchical-full` |
| **Quiz me** | Whole-source study | Sourced across whole duration | Bounded to selection | `full` or `hierarchical-full` |
| **Make flashcards** | Whole-source study | Sourced across whole duration | Bounded to selection | `full` or `hierarchical-full` |
| **Key terms** | Whole-source analytical | Sourced across whole duration | Bounded to selection | `full` or `hierarchical-full` |
| **Translate** | Localized passage | Requires selection/passage | Sourced from selection | `window` |

---

## 5. Intent-Aware Routing Scenarios

### Scenario TC-ROUTE-01: Explicit Timestamp Reference
- **Prompt**: `"What happens around 42:15?"`
- **Expected Mode**: `mode: "timestamp"`, `coverage: "window"`.
- **Assertion**: Retrieves segments covering 39:15 to 45:15. Bypasses whole-video map-reduce.

### Scenario TC-ROUTE-02: Explicit Playback Moment Cue
- **Prompt**: `"What did he just say about neurotransmitters?"` (paused at 18:20).
- **Expected Mode**: `mode: "playback"`, `coverage: "window"`.
- **Assertion**: Context centered around 18:20. Bypasses whole-video map-reduce.

### Scenario TC-ROUTE-03: Factual Needle in Long Video
- **Prompt**: `"What did he say about plants?"` (discussion only at 1:45:00, video is 2 hours, over budget).
- **Expected Mode**: `mode: "retrieval"`, `coverage: "chunks"`.
- **Assertion**: High-recall semantic/lexical search retrieves 1:45:00 segments regardless of current 18:20 playback position.

---

## 6. Cross-Surface Consistency Assertions

1. **Document Viewer (`DocumentViewerWrapper.tsx`)**:
   - `videoContext` exposes complete transcript with `transcriptStatus: "ready-full"`.
   - "Key points" executes full-transcript planning.
2. **Queue Scroll (`QueueScrollPage.tsx`)**:
   - Live video context supplies complete transcript.
   - Clicking "Key points" generates identical full-source response.
3. **Document Q&A (`DocumentQATab.tsx` & `workspaceGrounding.ts`)**:
   - Single-video document question invokes full-transcript planning with document attribution.
4. **Mobile Drawer (`MobileAssistantHost.tsx` / `AssistantPanel.tsx`)**:
   - Inherits `AssistantPanel` full-transcript planning without mobile-specific truncation.

---

## 7. Explicit Pass / Fail Conditions

- **FAIL**: Any whole-source context action on a complete transcript produces output containing `"supplied window"` or restricts evidence to the first 10% of the video.
- **FAIL**: A user setting of 50,000 tokens resolves to 8,192 tokens when the model supports 50,000+.
- **FAIL**: Long transcripts (50+ windows) generate intermediate map-reduce summaries with budgets under 150 tokens.
- **FAIL**: A failure in video transcript processing causes Document scope to widen and retrieve unrelated documents from the library.
- **PASS**: All automated test suites (`transcriptDurationScenarios`, `contextWindowPrecedence`, `contextActionCoverage`, `michaelPollanRegression`) exit code 0.
