# Change notes — fix-assistant-agent-readiness-message

## Reported mobile scenario: before / after (task 4.2)

Readiness row: `learning-agent`, status `setup-required`, dependencies include
`generation: missing` (`ai.reason.noGenerationRoute`) and the mobile lexical
fallback adds `limitations: ["ai.limitation.lexicalRetrieval"]`.

**Before** — the Assistant read `limitations[0]` as the blocking reason and
passed the untranslated key into `assistant.mode.unavailable`:

> Learning Agent is unavailable: ai.limitation.lexicalRetrieval

The same string appeared in the toggle's `title` tooltip, in the
`data-agent-notice` status row, and in the in-sheet notice.

**After** — the reason comes from the first unmet dependency's translated
`reasonKey` (`src/lib/ai/features/readinessCopy.ts`):

> Learning Agent is unavailable: No generation provider is available.

When no unmet dependency exposes a translatable reason key, the stable fallback
is used instead — still one translated sentence, never a dotted key:

> Learning Agent is unavailable: AI setup is not finished yet.

Parity: the identical sentence renders for the desktop `Learning Agent` toggle
and the mobile (`Learn`) presentation, including the in-sheet notice shown when
the mode is opened through the command palette.

A `ready` row that carries `ai.limitation.lexicalRetrieval` still enters
Learning Agent mode with no unavailable notice.

Regression coverage:

- `src/lib/ai/features/__tests__/readinessCopy.test.ts` — derivation order,
  missing keys, untranslated keys, ready rows, limitations ignored.
- `src/components/assistant/__tests__/AssistantPanelLearningAgent.test.tsx` —
  mobile/desktop toggle and in-sheet parity, raw-key absence, and the
  `setup-required` + lexical-limitation vs `ready` + lexical-limitation pair.
- `src/lib/i18n/__tests__/readiness-copy-keys.test.ts` — every readiness
  reason/limitation key resolves in `en`, and `assistant.mode.unavailable`
  keeps its single `{reason}` placeholder in every locale.
