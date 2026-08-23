---
title: "Grounded Ask-Library RAG"
description: "Grounded question-answering across your personal document library with numbered citation markers [N], untrusted chunk containment, and honest refusal."
category: "ai-and-models"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["ask library","library rag","semantic search qa","book question answering"]
aliases: ["ask library","library rag","semantic search qa","book question answering"]
relatedDocs: ["ai.task_router","reader.position.restore","review.source_provenance"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/ai/ask-library-rag.md"
---
# Grounded Ask-Library RAG

## Purpose
Enables conversational inquiry across your personal library of books, papers, and notes while enforcing strict evidence grounding and verifiable source citations.

## User-Facing Behavior
- Responds with concise, synthesized answers directly answering your query.
- Embeds numbered citation badges `[1]`, `[2]` after every claim.
- Clicking a citation badge opens the source book to the exact page and highlight where the evidence was found.
- If the library lacks evidence, states honestly: *"Your library does not contain sufficient information to answer this question."*

## Exact Behavioral Rules
1. Retrieves top-k relevant document chunks via hybrid vector + FTS5 lexical retrieval.
2. Injects chunks into `libraryTask.ts` inside prompt containment blocks (`<untrusted_doc_chunk id="...">`).
3. Schema validator (`libraryAnswer.ts`) verifies that every citation quote exists verbatim in the retrieved source chunk; unverified quotes are stripped.

## Rationale
Eliminates LLM hallucination. Users must be able to trust that every factual assertion is backed by verifiable text in their personal library.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `ai.rag.maxChunks` | `6` | Maximum number of context chunks passed to model |

## Platform Behavior
- **Desktop & Mobile**: Local vector embeddings and lexical indexing executed locally.