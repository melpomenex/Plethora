---
title: "Apple Core Ai Packaging"
description: "Apple Core Ai Packaging documentation for Plethora."
category: "platforms-and-devices"
order: 100
published: true
featureStatus: "shipping"
platforms: ["all"]
keywords: []
aliases: []
relatedDocs: []
owner: "E"
claimIds: []
sourcePath: "docs/product/features/platform/apple-core-ai-packaging.md"
---
/**
 * Out-of-app packaging for Apple Core AI custom models.
 *
 * 1. Convert source weights with Apple's converter to `.aimodel` (iOS 27+).
 * 2. Record `sha256`, `byteSize`, and `installSizeBytes`.
 * 3. Sign a catalog JSON and pin URL + digest in the client.
 *
 * Plethora never converts weights on device and never fetches `.aimodel`
 * packages unless `settings.features.appleCoreAI` is on.
 */
