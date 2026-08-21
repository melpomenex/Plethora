---
id: ai.task_router
title: Unified AI Task Router
domain: ai
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Task-based AI orchestration routing fast/full/reasoning workloads across on-device Gemini Nano and cloud providers with JSON repair and fallback.
how_to: Open Settings → AI & Privacy to configure your preferred providers (OpenAI, Anthropic, OpenRouter, Ollama, on-device Gemini Nano).
why: Different AI tasks have vastly different speed and capability requirements; automated routing matches simple lookups to fast on-device models and complex synthesis to frontier models.
aliases:
  - ai router
  - task router
  - ai providers
  - model selection
  - gemini nano
settings:
  - ai.defaultProvider
  - ai.onDeviceEnabled
  - ai.jsonRepairAttempts
actions:
  - id: settings.privacy.billing
    label: Open AI Provider Settings
    shortcut: Alt+,
related:
  - ai.learn_this
  - ai.library_rag
  - security.privacy_toggle
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
