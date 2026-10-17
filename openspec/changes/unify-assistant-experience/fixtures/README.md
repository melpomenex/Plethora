# Legacy storage fixture corpus

Supporting capture for `unify-assistant-experience` tasks 0.4, 1.5 and 8.3. It contains **no production user data**: every record is synthetic and generated deterministically from a fixed seed.

- `manifest.json` — committed manifest: storage shapes, counts, bytes and SHA-256 per file. Regenerate/verify with the command below; a manifest mismatch means the corpus changed.
- `data/` — the generated corpus itself (git-ignored, ~2.6 MB):
  - `sidebar-conversations.json` — `assistant-panel-conversations-v1` (`StoredConversationMap`): 60 conversation keys / 572 messages, including a 250-message thread (above the 200 storage cap), images, tool calls, legacy citation arrays and unknown future fields.
  - `qa-sessions.json` — `document-qa-sessions-v1` (`DocumentQaSession[]`): 62 sessions / 514 messages (above the 50×50 caps), drafts with section mentions and context passages, duplicate original IDs.
  - `legacy-document-qa.json` — `plethora-document-qa` Zustand persist blob in modern (`{state:{},version}`), legacy (messages) and raw variants.
  - `corrupt-records.json` — malformed, typed-wrong, duplicate and mixed inputs for quarantine tests, plus a truncated JSON and a cached-HTML blob.
  - `oversized-session.json` — one >1.1 MB session JSON for quota/disk-failure tests.
  - `ai-conversations.sql` — `ai_conversations`/`ai_messages` rows in the migration-003 schema (55-message thread, null document FK, orphaned message, NULL token counts).

Regenerate and verify:

```sh
node scripts/fixtures/generate-legacy-assistant-fixtures.mjs
```

Determinism requirement: running the generator twice must produce identical SHA-256 values in `manifest.json`. Never introduce wall-clock values, `Math.random()` or host-specific paths in the generator.
