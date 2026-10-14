---
id: platform.apple_core_ai_models
title: Apple Core AI Model Packaging
domain: platform
status: partial
platforms:
  - desktop-macos
  - mobile-ios
summary: Packaging contract and safety gates for opt-in Apple Core AI custom model packages.
how_to: Enable Apple Core AI in Settings → On-device AI when the native model support is available.
why: Large custom models need a verified package, clear storage requirements, and explicit user opt-in before installation.
aliases:
  - apple core ai
  - core ai models
  - aimodel packages
settings:
  - features.appleCoreAI
actions: []
related:
  - platform.mobile_ios
  - platform.desktop_native
---

# Apple Core AI Model Packaging

## Purpose
Defines the package and catalog safety contract for custom Apple Core AI models. Model conversion happens outside Plethora using Apple's converter; the app does not convert source weights on-device.

## User-Facing Behavior
- Core AI is disabled by default and remains opt-in through `features.appleCoreAI`.
- The native model download and install flow is not yet implemented. Enabling the setting does not fetch a package by itself.
- When custom model packaging is supported, catalogs identify the `aimodel-27` format and include a SHA-256 digest, download size, install size, minimum OS version, recommended memory, and license.

## Exact Behavioral Rules
1. Apple model packages use the `aimodel-27` format.
2. Catalog bytes can be checked against a pinned SHA-256 digest before use.
3. Packages larger than 8 GiB fail the size gate.
4. Installation requires space for the package, a 512 MiB margin, and at least 1 GiB remaining after installation. Large iPhone installs receive a warning above 1.5 GiB.
5. The model's recommended memory must fit the available memory budget.

## Rationale
Model packaging and installation can consume substantial storage and memory. Validation and explicit opt-in keep package handling predictable and prevent silent model downloads.
