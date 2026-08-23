---
title: "Unified AI Task Router"
description: "Task-based AI orchestration routing fast/full/reasoning workloads across on-device Gemini Nano and cloud providers with JSON repair and fallback."
category: "ai-and-models"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["ai router","task router","ai providers","model selection","gemini nano"]
aliases: ["ai router","task router","ai providers","model selection","gemini nano"]
relatedDocs: ["ai.learn_this","ai.library_rag","security.privacy_toggle"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/ai/task-router.md"
---
# Unified AI Task Router

## Purpose
Provides a centralized, resilient AI task execution engine (`src/lib/ai/`) that handles model routing, prompt containment, response schema validation, and automatic JSON repair.

## User-Facing Behavior
- Unified configuration interface supporting OpenAI, Anthropic, OpenRouter, Groq, Ollama (local), and on-device Gemini Nano.
- Visual latency and token cost diagnostics overlay.
- Automatic graceful fallback if a remote provider is offline or rate-limited.

## Exact Behavioral Rules
1. Every AI task defines typed input/output schemas adhering to `AITaskDefinition`.
2. All retrieved document text is wrapped in untrusted containment delimiters (`<untrusted_doc_chunk id="...">`) to prevent prompt injection.
3. If model output contains malformed JSON or markdown fences, the router automatically applies rule-based AST repairs before retrying.

## Rationale
Eliminates brittle, ad-hoc LLM calls throughout the application and enforces strict schema contracts and privacy boundaries.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `ai.defaultProvider` | `"openai"` | Primary AI provider for cloud synthesis |
| `ai.onDeviceEnabled` | `true` | Prefer on-device Gemini Nano / LiteRT when available |

## Platform Behavior
- **Android**: Direct integration with ML Kit GenAI (Gemini Nano) for 100% offline on-device AI.
- **Desktop**: Local Ollama support alongside cloud providers.