## Purpose

Provides on-device and local semantic embedding generation via Google's open-weight EmbeddingGemma 2 model (270M LiteRT on Android and Ollama on desktop), enabling private, offline vector indexing and retrieval with Matryoshka Representation Learning dimension optimization.

## ADDED Requirements

### Requirement: EmbeddingGemma 2 on-device model resolution and execution

The system SHALL support `embeddinggemma-2-270m` as an on-device embedding model for Android and local environments. The inference engine SHALL produce unit-length (L2-normalized) vectors from input texts using the Gemma 2 tokenizer and prompt templates.

#### Scenario: Document chunk embedding
- **WHEN** the semantic indexer submits text chunks to the `embeddinggemma-2-270m` on-device backend with kind `document`
- **THEN** the engine embeds each text with the document prompt template
- **AND** returns an ordered list of 768-dimensional float32 vectors

#### Scenario: Retrieval query embedding
- **WHEN** the retrieval engine embeds a user search query with kind `query`
- **THEN** the engine embeds the text with the search query prompt template
- **AND** returns a single 768-dimensional vector in the same metric space as indexed documents

### Requirement: Verified Apache 2.0 asset download

The system SHALL download and SHA-256 verify the un-gated Apache 2.0 EmbeddingGemma 2 LiteRT model artifact and tokenizer from canonical repository hosts (Hugging Face / ModelScope) into app-private storage without requiring user authentication tokens.

#### Scenario: Direct unauthenticated model download
- **WHEN** a user initiates downloading the on-device embedding model on Android
- **THEN** the download manager fetches the model and tokenizer from public URLs without HTTP 401 authentication errors
- **AND** reports progress percentages to the caller
- **AND** atomically promotes files into place once their SHA-256 checksums match pinned digests

#### Scenario: Checksum mismatch rejection
- **WHEN** a downloaded artifact fails the pinned SHA-256 digest check
- **THEN** the system rejects the file, deletes partial data, and marks the embedding status as unavailable with an error

### Requirement: Model version isolation and automatic re-indexing

The system SHALL assign a distinct `embedding_version` derived from the model name (`embeddinggemma-2-270m`) and backend kind. Changing from legacy `embeddinggemma-300m` to `embeddinggemma-2-270m` SHALL flag previously indexed chunks as stale and trigger automatic background re-indexing without mixing vector spaces.

#### Scenario: Model change triggers background re-indexing
- **WHEN** the active on-device embedding model changes from `embeddinggemma-300m` to `embeddinggemma-2-270m`
- **THEN** the system generates a distinct `embedding_version`
- **AND** marks stored document index states as stale
- **AND** the indexer re-embeds chunks with the new model in the background

#### Scenario: Retrieval falls back cleanly during re-index
- **WHEN** a query is submitted while chunks are in the process of re-embedding
- **THEN** cosine vector retrieval filters strictly by the active `embedding_version`
- **AND** documents not yet re-indexed remain searchable via lexical FTS5 fallback

### Requirement: Matryoshka Representation Learning (MRL) dimension slicing

The system SHALL support slicing output embeddings to target Matryoshka dimensions (such as 256 or 512 dimensions) prior to L2 normalization when configured, reducing vector blob storage and acceleration overhead.

#### Scenario: Truncated vector storage
- **WHEN** an MRL dimension of 256 is selected
- **THEN** output vectors are sliced to the first 256 dimensions and L2-normalized
- **AND** stored rows in `semantic_chunk_embeddings` record dimension 256 and an MRL-isolated `embedding_version`

### Requirement: Desktop local Ollama support

The system SHALL recognize `embeddinggemma-2` in the local Ollama provider configuration with a default dimension of 768 on desktop platforms.

#### Scenario: Inferred dimension for Ollama model
- **WHEN** an Ollama provider is configured with model name containing `embeddinggemma-2`
- **THEN** the system automatically infers a vector dimension of 768
