// Copyright 2026 Plethora
// SPDX-License-Identifier: Apache-2.0
// Wire DTOs for guided generation — TS validators remain authoritative.

import Foundation

#if canImport(FoundationModels)
import FoundationModels

@available(iOS 26.0, macOS 26.0, *)
@Generable
struct AppleFmSmartTaggingOutput {
  @Generable
  struct ExistingTag {
    var tag: String
    var confidence: Double
    var reason: String
  }

  @Generable
  struct ProposedTag {
    var name: String
    var confidence: Double
    var reason: String
  }

  var existingTags: [ExistingTag]
  var proposedNewTags: [ProposedTag]
}

@available(iOS 26.0, macOS 26.0, *)
@Generable
struct AppleFmLibraryAnswer {
  @Generable
  struct SourceRef {
    var refId: String
    var quote: String
  }

  var answer: String
  var sourceRefs: [SourceRef]
  var evidenceLevel: String
}

@available(iOS 26.0, macOS 26.0, *)
@Generable
struct AppleFmFlashcard {
  var question: String
  var answer: String
  var card_type: String
  var tags: [String]?
  var evidenceQuote: String?
  var sourceChunkIndex: Int?
}

@available(iOS 26.0, macOS 26.0, *)
@Generable
struct AppleFmFlashcardsOutput {
  var cards: [AppleFmFlashcard]
}

@available(iOS 26.0, macOS 26.0, *)
@Generable
struct AppleFmLearningCardCandidate {
  var cardType: String
  var question: String
  var answer: String
  var clozeText: String?
  var conceptKeys: [String]
  var concept: String?
  var evidenceQuote: String?
  var imageRefId: String?
  var tags: [String]?
}

@available(iOS 26.0, macOS 26.0, *)
@Generable
struct AppleFmLearningMaterialProposal {
  var importance: Double
  var knowledgeType: String
  var concepts: [String]
  var suggestedCards: [AppleFmLearningCardCandidate]
  var prerequisites: [String]
  var tags: [String]
  var rationale: String
}

#endif
