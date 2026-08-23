---
title: "AI Paid Billing Safety Gate"
description: "Explicit user opt-in consent gates preventing accidental paid API usage for cloud LLMs, Fal.ai TTS, and cloud embeddings."
category: "settings-privacy-troubleshooting"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["billing safety","api cost protection","paid consent gate","privacy toggle","credit protection"]
aliases: ["billing safety","api cost protection","paid consent gate","privacy toggle","credit protection"]
relatedDocs: ["ai.task_router","tts.playback","sync.yjs_cloud"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/settings/billing-safety.md"
---
# AI Paid Billing Safety Gate

## Purpose
Guarantees that Plethora will never initiate a billable third-party cloud API request without explicit, unambiguous user authorization.

## User-Facing Behavior
- If a feature requires a paid API (e.g. Fal.ai voice cloning or cloud vector embedding) and consent is not enabled, a clear consent dialog appears.
- Displays estimated cost per 1,000 words or per audio minute.
- Allows configuring monthly spending ceilings.

## Exact Behavioral Rules
1. Every network client checks `aiBillingConsent.ts` flags before dispatching requests.
2. If consent is disabled, the request is blocked and gracefully degraded to a local on-device alternative (e.g. Pocket TTS, local LiteRT embeddings).
3. API keys are stored securely in local OS keyrings / encrypted storage.

## Rationale
Builds radical trust with users. Plethora functions 100% offline and free by default, using paid cloud services only when explicitly requested.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `ai.billingConsent.paidTtsEnabled` | `false` | Allow billable cloud TTS voice generation |
| `ai.billingConsent.paidEmbeddingsEnabled` | `false` | Allow billable cloud embedding API calls |

## Platform Behavior
- **All Platforms**: Zero unexpected network traffic.