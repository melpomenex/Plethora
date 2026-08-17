# Plethora Privacy & Security Architecture

> Canonical privacy architecture and data-flow map for Plethora.
>
> Core principle: **Local-First, Zero Unintended Egress, Zero-Knowledge Sync, Transparent Disclosures**.

---

## 1. Overview & Guarantees

Plethora is built on the philosophy that reading, thinking, and note-taking are intimate personal activities that deserve complete privacy:

1. **Local-First Default**: Plethora operates 100% offline without requiring an account or network connection. All documents, notes, extracts, review histories, and knowledge graphs live in a local SQLite database (`plethora.db`) on your physical device.
2. **Opt-In Cloud Augmentation**: Commercial features (multi-device sync, cloud AI, hosted OCR, neural voice synthesis, and remote capture) are strictly opt-in.
3. **End-to-End Encryption**: Multi-device synchronization uses client-side encryption. The Plethora Cloud relay stores only opaque ciphertext; neither Plethora nor any infrastructure provider holds the keys to decrypt your reading library.
4. **Per-Document "Local-Only" Shield**: Any document marked `isLocalOnly` is globally prevented from leaving the device. All cloud pathways (AI, RAG, TTS, transcription, OCR) automatically divert to on-device algorithms.
5. **No Telemetry by Default**: Diagnostics and error reporting are disabled out-of-the-box (`opt_in` only) and collect only content-scrubbed performance counters.

---

## 2. Data Flow & Disclosure Registry

| Feature ID | Subsystem | Trigger | Destination | Encryption | Retention | Third-Party Access | Local Fallback |
|---|---|---|---|---|---|---|---|
| `cloud_sync` | Multi-Device Sync | Automatic | Plethora Cloud Relay / S3 | **End-to-End Encrypted** | Until deleted by user | None (zero-knowledge) | Local SQLite DB & device files |
| `cloud_backup` | Cloud Vault Backups | Scheduled | Plethora Cloud Vault | **End-to-End Encrypted** | Rolling 30 days | None | Local `.plethora` export |
| `cloud_ai_intelligence` | RAG & AI Learning | Manual | AI Gateway / Provider | **In-Transit TLS** | Ephemeral (zero training retention) | BYO Key / Pro Model Provider | On-device EmbeddingGemma, Ollama |
| `cloud_document_processing` | Cloud OCR & Reflow | Manual | Plethora Parser Workers | **In-Transit TLS** | Ephemeral (deleted on completion) | Cloud OCR / Parser Workers | Local PDF parser, on-device OCR |
| `cloud_tts` | Neural TTS Synthesis | Manual | Neural TTS Cluster | **In-Transit TLS** | Ephemeral (cached locally) | Voice Provider | System TTS & Pocket TTS |
| `cloud_transcription` | Audio/Video Speech | Manual | Whisper Cluster | **In-Transit TLS** | Ephemeral audio chunks | Hosted Whisper | Local Whisper.cpp |
| `cloud_web_capture` | Remote Web Inbox | Manual | Remote Capture Queue | **Stored Encrypted** | Until synced to local inbox | None | Local browser extension |
| `telemetry_crash_reporting` | Diagnostics | Opt-in | Telemetry Ingestion | **In-Transit TLS** | 90 days aggregated | None | Complete disablement (default) |

---

## 3. The `isLocalOnly` Shield

Plethora enforces sensitive document isolation via `isCloudEligible(document)`.

When a document has `isLocalOnly: true` (or `metadata.isLocalOnly: true`):
- Sync engine will NOT upload the document binary or its extracts.
- Cross-library RAG and AI tutor ignore the document during query embedding.
- TTS and transcription fallback exclusively to local Whisper.cpp and system speech synthesizers.
- OCR bypasses cloud reconstructors and uses on-device engines.

---

## 4. Account Deletion & Data Portability

- **Account Deletion**: Deleting your Plethora account triggers a complete cascade removing all cloud-held ciphertext, capture queue items, device registrations, and billing tokens within 30 days. Local data on your devices remains 100% intact unless you explicitly opt in to erase the local device storage.
- **Portability**: All library data can be exported at any time to open `.plethora` archive format, standard Anki `.apkg` packages, Markdown trees, or SQLite database files.
