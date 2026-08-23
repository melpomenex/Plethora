# Design: Android local RAG composition

## Architecture

```text
question → SemanticRetriever.retrieve(scope)
        → wrapUntrustedBlock per chunk
        → AIProvider.generate LibraryAnswer
        → validate citations
        → CitationChips (existing locators)
```

Retrievers and generators are independently selectable. Default retriever `ai_learning`. AppSearch hybrid is opt-in when C’s flag is on.

## Native APIs

None owned here.

## TypeScript

`composeRag({ retriever, generator, scope, namespace: "library" | "help" })`. Help MUST use help retriever only.

## Privacy / fallback / errors

Same as A/B. If generator missing, return hits without synthesis. Never silently cloud-generate.

## Tests

Composition unit tests with FakeRetriever + FakeAIProvider: citations validate; help namespace cannot see library ids; generator none returns hits only.

## Background

If generation gets `ForegroundRequired`, keep retrieval results on screen and mark answer incomplete.
