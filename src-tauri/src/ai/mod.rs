//! AI integration module
//!
//! This module provides AI/LLM integration for Incrementum, including:
//! - Multiple LLM provider support (OpenAI, Anthropic, OpenRouter, Ollama)
//! - Multiple embedding provider support (OpenAI, Cohere, OpenRouter, Ollama)
//! - Flashcard generation
//! - Q&A with document context
//! - Content summarization

pub mod embedding_config;
pub mod embeddings;
pub mod flashcard_generator;
pub mod prompts;
pub mod provider_wrapper;
pub mod providers;
pub mod qa;
pub mod smart_tagging;
pub mod stream_registry;
pub mod summarizer;

// Re-exports - use the new enum-based provider
pub use embeddings::{
    CohereEmbeddingProvider, EmbeddingModel, EmbeddingProviderType, EmbeddingResponse,
    OllamaEmbeddingProvider, OpenAIEmbeddingProvider, OpenRouterEmbeddingProvider,
};
pub use provider_wrapper::{AIConfig, AIProvider};
pub use providers::{LLMProviderType, Message, MessageRole};

// Note: FlashcardGenerator, QuestionAnswerer, and Summarizer still need to be updated
// to use AIProvider instead of Box<dyn LLMProvider>
