# Design: custom on-device models + AI packs

## Native APIs

- LiteRT (already 2.1.0 for embeddings)
- LiteRT-LM: https://developers.google.com/edge/litert-lm/android (`litertlm-android`) — Kotlin **stable** per current docs
- Play for On-device AI (beta): https://developer.android.com/google/play/on-device-ai — install-time / fast-follow / on-demand; RAM targeting example in docs
- NPU: LiteRT NPU + Play Feature Delivery for runtime libs

Deprecated/superseded: treating “just drop a .tflite in assets” as the LLM strategy; old standalone MediaPipe LLM samples as the long-term Android production path when LiteRT-LM exists.

## Tiers

| Tier | Criteria (indicative; measure at implement) | Deliver |
|---|---|---|
| none | low RAM / no accelerator | no custom gen model; Nano if any; Language ID only |
| embed | ~2–4 GB free + current Gemma success path | EmbeddingGemma on demand (already) |
| gen | high RAM (e.g. ≥6 GB as Play targeting example) + GPU/NPU | optional LLM pack on demand |

Low-end devices MUST NOT receive or attempt to load incompatible multi-GB models.

## Architecture

`LocalModelProvider` implements `AIProvider`. Capability `downloadState` drives UX. Routing: user pin > Nano if prefer on-device > local-model if downloaded > cloud per policy.

## Licensing

Block merge of any pack until LICENSE + attribution strings are in-repo. Track commercial-use.

## Privacy / security

Models from Play or pinned hashes only. No `trust_remote_code`. Verify sha256. Supply chain: pin URLs/pack names.

## UX / resources

Never silent huge downloads. Show size. Prefer Wi-Fi. Share descriptor type with G/B downloads but **do not** force AICore into this installer.

## Tests

Tier classifier unit tests with fake DeviceInfo. Provider fakes. No CI download of GB models.

## Unresolved

Exact model identity/license — implementation gate, not an excuse to skip the rest of the infrastructure.
