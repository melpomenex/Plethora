//! Embedding backend registry for the semantic index (task 4.4, design D10).
//!
//! Four live backends:
//! - **OnDevice** — EmbeddingGemma 300M via LiteRT in the android-genai
//!   plugin (task 4.5). `OnDevice` is the inert stub used when no plugin
//!   bridge was installed at resolution time (desktop, tests, or the plugin
//!   failed to initialize): indexing stores chunks without vectors and
//!   retrieval runs `lexicalOnly`. `OnDeviceLive` carries the installed
//!   bridge closure and produces real 768-dim vectors; per-call failures
//!   (model not downloaded, inference error) still degrade to
//!   lexical-only rather than failing indexing.
//! - **Ollama / Cloud** — built from the existing `EmbeddingProvider` impls in
//!   `ai/embeddings.rs` via the shared `build_provider` factory and the
//!   `EmbeddingConfigInput` the frontend already sends for RAG.
//! - **Mock** — deterministic hash-seeded vectors used by tests and benches.
//!
//! Every stored vector persists its `model` and `embedding_version`. The
//! version is a stable function of `(backend kind, model)`, so switching the
//! configured model bumps the version: existing embeddings are then stale
//! (chunks remain; retrieval falls back to lexical until re-embedded).

use crate::ai::embedding_config::build_provider;
use crate::ai::embeddings::EmbeddingProvider;
use crate::commands::semantic_graph::EmbeddingConfigInput;
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};

/// Which backend produced/stores an embedding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EmbeddingBackendKind {
    OnDevice,
    Ollama,
    Cloud,
    Mock,
}

impl EmbeddingBackendKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EmbeddingBackendKind::OnDevice => "on-device",
            EmbeddingBackendKind::Ollama => "ollama",
            EmbeddingBackendKind::Cloud => "cloud",
            EmbeddingBackendKind::Mock => "mock",
        }
    }
}

/// Error returned when embeddings cannot be produced. The indexer treats this
/// as "store chunks without vectors" (never a hard failure) and retrieval
/// switches to lexical-only mode — matching the `EmbeddingUnavailable` error
/// category in the TS taxonomy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddingUnavailable {
    pub reason: String,
}

impl std::fmt::Display for EmbeddingUnavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "embedding unavailable: {}", self.reason)
    }
}

impl std::error::Error for EmbeddingUnavailable {}

/// A resolved embedding backend.
#[derive(Clone)]
pub enum EmbeddingBackend {
    /// On-device EmbeddingGemma with no usable bridge: desktop, tests, or
    /// the android-genai plugin never initialized. Reports unavailable; the
    /// indexer stores chunks without vectors (lexical-only retrieval).
    OnDevice { model: &'static str },
    /// On-device EmbeddingGemma behind an installed android-genai bridge.
    /// Embedding may still fail per call (model not downloaded yet,
    /// inference error); every failure degrades to lexical-only mode.
    OnDeviceLive {
        model: &'static str,
        embedder: Arc<OnDeviceEmbedFn>,
    },
    /// Ollama or an explicitly configured cloud provider, built from the
    /// existing `EmbeddingProvider` trait objects.
    Provider {
        kind: EmbeddingBackendKind,
        provider: Arc<dyn EmbeddingProvider>,
        model: String,
    },
    /// Deterministic mock: hash-seeded unit vectors (tests + benches).
    Mock { dim: usize, model: &'static str },
}

impl std::fmt::Debug for EmbeddingBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EmbeddingBackend::OnDevice { model } => {
                f.debug_struct("OnDevice").field("model", model).finish()
            }
            EmbeddingBackend::OnDeviceLive { model, .. } => f
                .debug_struct("OnDeviceLive")
                .field("model", model)
                .finish(),
            EmbeddingBackend::Provider { kind, model, .. } => f
                .debug_struct("Provider")
                .field("kind", &kind.as_str())
                .field("model", model)
                .finish(),
            EmbeddingBackend::Mock { dim, model } => f
                .debug_struct("Mock")
                .field("dim", dim)
                .field("model", model)
                .finish(),
        }
    }
}

/// Default on-device model identity (EmbeddingGemma 300M, 768-dim). Must
/// stay in sync with `incrementum_android_genai::EMBEDDING_MODEL` and the
/// Kotlin plugin's `EMBEDDING_MODEL_NAME` — it feeds `embedding_version`.
pub const ON_DEVICE_MODEL: &str = "embeddinggemma-300m";

// ──────────────────────────────────────────────────────────────────────────
// On-device bridge (task 4.5): a process-wide closure into the android-genai
// plugin's `embedTexts` command, installed once from the app setup (Android
// only). Keeping it a registry rather than an enum field on every backend
// preserves the `EmbeddingBackend::OnDevice { model }` construction used by
// the indexer tests as a deterministic stub.
// ──────────────────────────────────────────────────────────────────────────

/// Successful on-device embed: one vector per input text.
pub struct OnDeviceEmbedOutput {
    pub vectors: Vec<Vec<f32>>,
}

/// On-device embed failure, carrying the shared plugin error code
/// (`model_downloadable`, `model_downloading`, `model_unavailable`,
/// `feature_not_compiled`, `inference_failed`, `platform_unsupported`, ...).
pub struct OnDeviceEmbedFailure {
    pub code: String,
    pub message: String,
}

impl std::fmt::Display for OnDeviceEmbedFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

/// Bridge closure: `(&texts, normalize, kind)` → vectors or a coded failure.
/// `kind` is "document" (indexing) or "query" (retrieval) and selects the
/// Gemma prompt template applied natively.
pub type OnDeviceEmbedFn = dyn Fn(&[String], bool, &str) -> Result<OnDeviceEmbedOutput, OnDeviceEmbedFailure>
    + Send
    + Sync;

/// Process-wide bridge installed by the app setup (Android only). Mutex (not
/// OnceLock) so tests and teardown can clear it; reads are short critical
/// sections that only clone the Arc.
static ON_DEVICE_EMBEDDER: Mutex<Option<Arc<OnDeviceEmbedFn>>> = Mutex::new(None);

/// Install (or replace) the on-device embedding bridge. Called from the app
/// setup on Android with a closure over the android-genai plugin's
/// `embed_texts_via_app`.
pub fn install_on_device_embedder(embedder: Arc<OnDeviceEmbedFn>) {
    if let Ok(mut slot) = ON_DEVICE_EMBEDDER.lock() {
        *slot = Some(embedder);
    }
}

/// Remove the on-device bridge (lifecycle hook; not used in normal flow).
pub fn clear_on_device_embedder() {
    if let Ok(mut slot) = ON_DEVICE_EMBEDDER.lock() {
        *slot = None;
    }
}

/// The currently installed bridge, if any.
pub fn on_device_embedder() -> Option<Arc<OnDeviceEmbedFn>> {
    ON_DEVICE_EMBEDDER.lock().ok().and_then(|slot| slot.clone())
}

/// How many texts one native embed call accepts (matches the Kotlin
/// `embedTexts` cap; the indexer batches at 25 anyway).
const ON_DEVICE_EMBED_BATCH_CAP: usize = 32;

/// Stable embedding version for a backend identity: first 8 bytes of
/// `sha256("kind/model")` folded into a positive i64. Distinct models yield
/// distinct versions with overwhelming probability; version 1 is the
/// migration default for the folded legacy rows.
pub fn embedding_version_for(kind: &str, model: &str) -> i64 {
    let mut hasher = Sha256::new();
    hasher.update(kind.as_bytes());
    hasher.update(b"/");
    hasher.update(model.as_bytes());
    let digest = hasher.finalize();
    let raw = u64::from_be_bytes(digest[..8].try_into().expect("8 bytes"));
    // Keep it comfortably inside i64 and never zero (0 would collide with the
    // "no version recorded" NULL semantics in ai_index_state).
    (raw % 9_000_000_000_000) as i64 + 1
}

impl EmbeddingBackend {
    /// Build the backend from the frontend embedding config. `None` resolves
    /// to the on-device backend (offline-first default, design D10): live
    /// when the android-genai bridge is installed (Android app runtime),
    /// inert stub otherwise (desktop, tests) so indexing degrades to
    /// lexical-only.
    pub fn from_config(config: Option<&EmbeddingConfigInput>) -> Self {
        // On Android with the on-device embedding model live, it wins over any
        // configured cloud embedding backend: queries MUST be embedded by the
        // same model that built the index (cross-model cosine matches nothing
        // and silently degrades retrieval to lexical-only), and on-device is
        // the privacy/offline default (design D10). A deliberately local
        // Ollama config is still honored.
        if let Some(cfg) = config {
            let is_local = cfg.provider == crate::ai::embeddings::EmbeddingProviderType::Ollama;
            if !is_local && on_device_embedder().is_some() {
                tracing::info!(
                    provider = %crate::ai::embedding_config::provider_name(cfg),
                    "preferring live on-device embedding model over configured cloud backend \
                     (same-model index/query + on-device default)"
                );
                return Self::on_device_default();
            }
        }
        match config {
            None => Self::on_device_default(),
            Some(cfg) => match build_provider(cfg) {
                Ok(provider) => EmbeddingBackend::Provider {
                    kind: if cfg.provider == crate::ai::embeddings::EmbeddingProviderType::Ollama {
                        EmbeddingBackendKind::Ollama
                    } else {
                        EmbeddingBackendKind::Cloud
                    },
                    provider: Arc::from(provider),
                    model: crate::ai::embedding_config::model_name(cfg),
                },
                // Config present but unusable (missing key/model): surface as
                // on-device-style unavailable rather than failing indexing.
                Err(e) => {
                    tracing::warn!("embedding config unusable ({}), defaulting to on-device", e);
                    Self::on_device_default()
                }
            },
        }
    }

    /// The on-device backend for the current process: live when a plugin
    /// bridge is installed, stub otherwise.
    fn on_device_default() -> Self {
        match on_device_embedder() {
            Some(embedder) => EmbeddingBackend::OnDeviceLive {
                model: ON_DEVICE_MODEL,
                embedder,
            },
            None => EmbeddingBackend::OnDevice {
                model: ON_DEVICE_MODEL,
            },
        }
    }

    pub fn kind(&self) -> EmbeddingBackendKind {
        match self {
            EmbeddingBackend::OnDevice { .. } | EmbeddingBackend::OnDeviceLive { .. } => {
                EmbeddingBackendKind::OnDevice
            }
            EmbeddingBackend::Provider { kind, .. } => *kind,
            EmbeddingBackend::Mock { .. } => EmbeddingBackendKind::Mock,
        }
    }

    pub fn kind_name(&self) -> &'static str {
        self.kind().as_str()
    }

    pub fn model_name(&self) -> String {
        match self {
            EmbeddingBackend::OnDevice { model }
            | EmbeddingBackend::OnDeviceLive { model, .. }
            | EmbeddingBackend::Mock { model, .. } => model.to_string(),
            EmbeddingBackend::Provider { model, .. } => model.clone(),
        }
    }

    pub fn embedding_version(&self) -> i64 {
        match self {
            EmbeddingBackend::OnDevice { model }
            | EmbeddingBackend::OnDeviceLive { model, .. }
            | EmbeddingBackend::Mock { model, .. } => {
                embedding_version_for(self.kind_name(), model)
            }
            EmbeddingBackend::Provider { model, kind, .. } => {
                embedding_version_for(kind.as_str(), model)
            }
        }
    }

    /// Whether this backend can produce vectors right now. The on-device
    /// stub is never available; the live bridge is (per-call failures such
    /// as `model_downloadable` still degrade to lexical mode at embed time).
    pub fn is_available(&self) -> bool {
        match self {
            EmbeddingBackend::OnDevice { .. } => false,
            EmbeddingBackend::OnDeviceLive { .. } => true,
            EmbeddingBackend::Provider { provider, .. } => provider.is_available(),
            EmbeddingBackend::Mock { .. } => true,
        }
    }

    pub fn dimension(&self) -> usize {
        match self {
            EmbeddingBackend::OnDevice { .. } | EmbeddingBackend::OnDeviceLive { .. } => 768, // EmbeddingGemma 300M
            EmbeddingBackend::Provider { provider, .. } => provider.dimension(),
            EmbeddingBackend::Mock { dim, .. } => *dim,
        }
    }

    /// Embed a batch of texts. Returns `Err(EmbeddingUnavailable)` when the
    /// backend cannot run — callers degrade to lexical mode instead of
    /// failing. On-device batches use the document prompt template.
    pub async fn embed_texts(
        &self,
        texts: &[String],
    ) -> Result<Vec<Vec<f32>>, EmbeddingUnavailable> {
        self.embed_texts_with_kind(texts, "document").await
    }

    /// Embed a single text (query-side embedding at retrieval time): the
    /// on-device backend uses the query prompt template.
    pub async fn embed_text(&self, text: &str) -> Result<Vec<f32>, EmbeddingUnavailable> {
        let mut out = self
            .embed_texts_with_kind(&[text.to_string()], "query")
            .await?;
        Ok(out.pop().unwrap_or_default())
    }

    /// Shared embed path. `kind` selects the native Gemma prompt template
    /// ("document" for indexed chunks, "query" for retrieval queries).
    async fn embed_texts_with_kind(
        &self,
        texts: &[String],
        kind: &str,
    ) -> Result<Vec<Vec<f32>>, EmbeddingUnavailable> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        match self {
            EmbeddingBackend::OnDevice { .. } => Err(EmbeddingUnavailable {
                reason: "on-device embedding bridge not installed (desktop, tests, \
                         or the android-genai plugin is unavailable)"
                    .to_string(),
            }),
            EmbeddingBackend::OnDeviceLive { embedder, .. } => {
                embed_via_bridge(embedder, texts, kind).await
            }
            EmbeddingBackend::Provider { provider, .. } => {
                let responses = provider
                    .generate_embeddings_batch(texts)
                    .await
                    .map_err(|e| EmbeddingUnavailable { reason: e })?;
                let vectors = responses
                    .into_iter()
                    .map(|r| r.embedding)
                    .collect::<Vec<_>>();
                if vectors.iter().any(|v| v.is_empty()) {
                    return Err(EmbeddingUnavailable {
                        reason: "provider returned an empty embedding".to_string(),
                    });
                }
                Ok(vectors)
            }
            EmbeddingBackend::Mock { dim, .. } => {
                Ok(texts.iter().map(|t| mock_embedding(t, *dim)).collect())
            }
        }
    }
}

/// Run one on-device embed job through the installed bridge in batches of
/// the native cap, off the async worker threads (the Kotlin call blocks on
/// native inference). Every failure — including "model not downloaded" — is
/// `EmbeddingUnavailable` so the indexer stores chunks without vectors
/// instead of failing.
async fn embed_via_bridge(
    embedder: &Arc<OnDeviceEmbedFn>,
    texts: &[String],
    kind: &str,
) -> Result<Vec<Vec<f32>>, EmbeddingUnavailable> {
    let mut vectors: Vec<Vec<f32>> = Vec::with_capacity(texts.len());
    for batch in texts.chunks(ON_DEVICE_EMBED_BATCH_CAP) {
        let embedder = Arc::clone(embedder);
        let batch: Vec<String> = batch.to_vec();
        let batch_len = batch.len();
        let kind = kind.to_string();
        let output = tokio::task::spawn_blocking(move || embedder(&batch, true, &kind))
            .await
            .map_err(|e| EmbeddingUnavailable {
                reason: format!("on-device embedding task failed: {e}"),
            })?
            .map_err(|f| EmbeddingUnavailable {
                reason: format!("on-device embedding unavailable ({}): {f}", f.code),
            })?;
        if output.vectors.len() != batch_len {
            return Err(EmbeddingUnavailable {
                reason: format!(
                    "on-device embedding returned {} vectors for {} texts",
                    output.vectors.len(),
                    batch_len
                ),
            });
        }
        if output.vectors.iter().any(|v| v.is_empty()) {
            return Err(EmbeddingUnavailable {
                reason: "on-device embedding returned an empty vector".to_string(),
            });
        }
        vectors.extend(output.vectors);
    }
    Ok(vectors)
}

/// A stored embedding row is stale when its version or model no longer
/// matches the active backend (design D14: version bump marks stale; chunks
/// remain and retrieval falls back to lexical until re-embedded).
pub fn embedding_is_stale(
    stored_version: i64,
    stored_model: &str,
    backend: &EmbeddingBackend,
) -> bool {
    stored_version != backend.embedding_version() || stored_model != backend.model_name()
}

/// Deterministic hash-seeded unit vector for the mock backend: identical
/// texts embed identically (cosine 1.0), different texts decorrelate.
pub fn mock_embedding(text: &str, dim: usize) -> Vec<f32> {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let seed = u64::from_be_bytes(hasher.finalize()[..8].try_into().expect("8 bytes"));
    let mut state = seed;
    let mut v = Vec::with_capacity(dim);
    for _ in 0..dim {
        // splitmix64
        state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        v.push(((z >> 11) as f64 / (1u64 << 53) as f64 - 0.5) as f32);
    }
    // Unit L2 norm (same math as vector_store::normalize_vector).
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as TestMutex;

    /// Serializes tests that resolve backends from the process-wide bridge
    /// registry (`from_config`) or mutate it, so parallel test threads cannot
    /// observe each other's installs. Tests that construct backends directly
    /// (stub/live) need no lock: the stub never consults the registry and
    /// the live variant's embedder is its own field.
    static REGISTRY_TEST_LOCK: TestMutex<()> = TestMutex::new(());

    #[test]
    fn version_is_stable_and_model_sensitive() {
        let a = embedding_version_for("on-device", "embeddinggemma-300m");
        let b = embedding_version_for("on-device", "embeddinggemma-300m");
        assert_eq!(a, b, "same identity must yield the same version");
        let c = embedding_version_for("on-device", "other-model");
        assert_ne!(a, c, "model change must bump the version");
        let d = embedding_version_for("cloud", "embeddinggemma-300m");
        assert_ne!(a, d, "backend change must bump the version");
        assert!(a > 0 && c > 0, "versions must be positive");
    }

    #[test]
    fn version_mismatch_marks_stale_and_lexical_fallback_flag() {
        let backend = EmbeddingBackend::OnDevice {
            model: ON_DEVICE_MODEL,
        };
        let v1 = backend.embedding_version();

        // Fresh embedding under the same backend: not stale.
        assert!(!embedding_is_stale(v1, ON_DEVICE_MODEL, &backend));

        // Simulate a version bump (model swap): stale.
        let newer = EmbeddingBackend::OnDevice {
            model: "embeddinggemma-300m-v2",
        };
        assert!(embedding_is_stale(v1, ON_DEVICE_MODEL, &newer));
        // Model-name-only drift also counts as stale.
        assert!(embedding_is_stale(v1, "old-model", &backend));

        // Stale detection drives the lexical-only flag in retrieval: a stale
        // index reports no usable embeddings for the active version.
        let backend_version = newer.embedding_version();
        assert_ne!(backend_version, v1, "bumped version must differ");

        // Live and stub on-device backends share the version identity.
        let live = EmbeddingBackend::OnDeviceLive {
            model: ON_DEVICE_MODEL,
            embedder: Arc::new(|_, _, _| {
                Err(OnDeviceEmbedFailure {
                    code: "inference_failed".into(),
                    message: "unused".into(),
                })
            }),
        };
        assert_eq!(live.embedding_version(), v1);
        assert_eq!(live.model_name(), backend.model_name());
        assert_eq!(live.kind_name(), "on-device");
    }

    #[tokio::test]
    async fn on_device_stub_is_unavailable_and_lexical_fallback_holds() {
        // The stub (no bridge installed at resolution time) is unavailable:
        // indexing stores chunks without vectors, retrieval goes lexicalOnly.
        let backend = EmbeddingBackend::OnDevice {
            model: ON_DEVICE_MODEL,
        };
        assert!(!backend.is_available());
        assert_eq!(backend.dimension(), 768);
        let err = backend
            .embed_texts(&["hello".to_string()])
            .await
            .unwrap_err();
        assert!(
            err.reason.contains("bridge not installed"),
            "{}",
            err.reason
        );
        let query_err = backend.embed_text("hello").await.unwrap_err();
        assert!(query_err.reason.contains("bridge not installed"));
    }

    #[tokio::test]
    async fn live_bridge_embeds_documents_and_maps_kinds() {
        // Records every (texts, normalize, kind) the bridge receives.
        let calls: Arc<TestMutex<Vec<(Vec<String>, bool, String)>>> =
            Arc::new(TestMutex::new(Vec::new()));
        let seen = Arc::clone(&calls);
        let backend = EmbeddingBackend::OnDeviceLive {
            model: ON_DEVICE_MODEL,
            embedder: Arc::new(move |texts, normalize, kind| {
                if let Ok(mut c) = seen.lock() {
                    c.push((texts.to_vec(), normalize, kind.to_string()));
                }
                Ok(OnDeviceEmbedOutput {
                    vectors: texts
                        .iter()
                        .map(|t| {
                            let mut v = mock_embedding(t, 768);
                            v.truncate(768);
                            v
                        })
                        .collect(),
                })
            }),
        };
        assert!(backend.is_available());

        let vectors = backend
            .embed_texts(&["alpha".to_string(), "beta".to_string()])
            .await
            .expect("embed documents");
        assert_eq!(vectors.len(), 2);
        assert_eq!(vectors[0].len(), 768);
        let query = backend.embed_text("find this").await.expect("embed query");
        assert_eq!(query.len(), 768);

        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 2, "one call per entry point");
        assert_eq!(
            calls[0].2, "document",
            "batch path uses the document template"
        );
        assert!(calls[0].1, "vectors are L2-normalized for the index");
        assert_eq!(
            calls[1].2, "query",
            "single-text path uses the query template"
        );
        assert_eq!(calls[1].0, ["find this".to_string()]);
    }

    #[tokio::test]
    async fn live_bridge_batches_beyond_the_native_cap() {
        let call_sizes: Arc<TestMutex<Vec<usize>>> = Arc::new(TestMutex::new(Vec::new()));
        let seen = Arc::clone(&call_sizes);
        let backend = EmbeddingBackend::OnDeviceLive {
            model: ON_DEVICE_MODEL,
            embedder: Arc::new(move |texts, _, _| {
                if let Ok(mut c) = seen.lock() {
                    c.push(texts.len());
                }
                Ok(OnDeviceEmbedOutput {
                    vectors: texts.iter().map(|t| mock_embedding(t, 8)).collect(),
                })
            }),
        };
        let texts: Vec<String> = (0..70).map(|i| format!("text-{i}")).collect();
        let vectors = backend.embed_texts(&texts).await.expect("batched embed");
        assert_eq!(vectors.len(), 70);
        let sizes = call_sizes.lock().unwrap();
        assert_eq!(*sizes, vec![32, 32, 6], "chunks at the native cap");
    }

    #[tokio::test]
    async fn live_bridge_model_missing_degrades_to_unavailable() {
        // Model not downloaded: the plugin rejects with model_downloadable
        // and the backend surfaces EmbeddingUnavailable (indexer stores
        // chunks without vectors rather than failing).
        let backend = EmbeddingBackend::OnDeviceLive {
            model: ON_DEVICE_MODEL,
            embedder: Arc::new(|_, _, _| {
                Err(OnDeviceEmbedFailure {
                    code: "model_downloadable".into(),
                    message: "embedding model is not downloaded".into(),
                })
            }),
        };
        let err = backend.embed_texts(&["x".to_string()]).await.unwrap_err();
        assert!(err.reason.contains("model_downloadable"), "{}", err.reason);
        let downloading = EmbeddingBackend::OnDeviceLive {
            model: ON_DEVICE_MODEL,
            embedder: Arc::new(|_, _, _| {
                Err(OnDeviceEmbedFailure {
                    code: "model_downloading".into(),
                    message: "download in progress".into(),
                })
            }),
        };
        let err = downloading.embed_text("x").await.unwrap_err();
        assert!(err.reason.contains("model_downloading"), "{}", err.reason);
    }

    #[tokio::test]
    async fn live_bridge_rejects_miscounted_and_empty_vectors() {
        let short = EmbeddingBackend::OnDeviceLive {
            model: ON_DEVICE_MODEL,
            embedder: Arc::new(|texts, _, _| {
                Ok(OnDeviceEmbedOutput {
                    vectors: vec![mock_embedding(&texts[0], 8)],
                })
            }),
        };
        let err = short
            .embed_texts(&["a".to_string(), "b".to_string()])
            .await
            .unwrap_err();
        assert!(
            err.reason.contains("returned 1 vectors for 2 texts"),
            "{}",
            err.reason
        );

        let empty = EmbeddingBackend::OnDeviceLive {
            model: ON_DEVICE_MODEL,
            embedder: Arc::new(|_, _, _| {
                Ok(OnDeviceEmbedOutput {
                    vectors: vec![Vec::new()],
                })
            }),
        };
        let err = empty.embed_text("a").await.unwrap_err();
        assert!(err.reason.contains("empty vector"), "{}", err.reason);
    }

    #[tokio::test]
    async fn mock_backend_is_deterministic_and_normalized() {
        let backend = EmbeddingBackend::Mock {
            dim: 64,
            model: "mock",
        };
        let a = backend.embed_text("deterministic text").await.unwrap();
        let b = backend.embed_text("deterministic text").await.unwrap();
        let c = backend.embed_text("different text").await.unwrap();
        assert_eq!(a, b, "identical texts must embed identically");
        assert_eq!(a.len(), 64);
        let norm: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5, "mock vectors are unit norm");
        let sim = crate::ai::embedding_config::cosine_similarity(&a, &c);
        assert!(sim < 0.9, "different texts must decorrelate, got {sim}");
    }

    #[test]
    fn from_config_none_yields_on_device_stub_without_a_bridge() {
        // Nothing installs the bridge in tests (and on desktop): the default
        // stays the deterministic stub.
        let _guard = REGISTRY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear_on_device_embedder();
        let backend = EmbeddingBackend::from_config(None);
        assert_eq!(backend.kind(), EmbeddingBackendKind::OnDevice);
        assert_eq!(backend.model_name(), ON_DEVICE_MODEL);
        assert!(!backend.is_available());
    }

    #[test]
    fn from_config_none_yields_live_backend_when_bridge_installed() {
        let _guard = REGISTRY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear_on_device_embedder();
        install_on_device_embedder(Arc::new(|_, _, _| {
            Err(OnDeviceEmbedFailure {
                code: "inference_failed".into(),
                message: "not exercised".into(),
            })
        }));
        let backend = EmbeddingBackend::from_config(None);
        assert!(
            backend.is_available(),
            "installed bridge makes the backend live"
        );
        clear_on_device_embedder();
        // And back to stub after teardown.
        let backend = EmbeddingBackend::from_config(None);
        assert!(!backend.is_available());
    }
}
