//! Bounded registry of in-flight cloud LLM stream requests.
//!
//! Rust counterpart of the Kotlin plugin's `StreamRequestRegistry`
//! (`StreamEnqueueResult`/`StreamCancelState` bookkeeping with a single
//! terminal event per request), adapted to the cloud streaming model in
//! `commands/llm.rs`: every `llm_stream_chat` invocation owns its task, so
//! instead of queueing work behind one inference worker the registry maps a
//! request id to a cancellation signal. `llm_cancel_stream` flips the signal;
//! the stream task observes it in a `tokio::select!`, which drops (aborts) the
//! in-flight reqwest future.
//!
//! Terminal-event ownership (single emission guarantee):
//! - `cancel` returns `true` only for a live entry — cancellation claims the
//!   terminal event and removes the entry, so the stream task must emit the
//!   single `llm:stream:error` with code `cancelled`.
//! - `complete` returns `true` only when it removed a live entry — a `false`
//!   result means cancellation already claimed the terminal event (or the id
//!   was never registered), so the caller must not emit another terminal
//!   event for this request.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, OnceLock};

use tokio::sync::watch;

/// Bound on concurrently tracked stream requests.
///
/// Entries are removed on every terminal path (completion, error, or
/// cancellation), so the bound only guards against unbounded growth if a
/// stream task dies without cleanup; it is not expected to be reached in
/// practice.
pub const DEFAULT_MAX_STREAM_REQUESTS: usize = 64;

type CancelSender = watch::Sender<bool>;

/// Registry mapping live stream request ids to their cancellation signal.
pub struct StreamRequestRegistry {
    max_entries: usize,
    // `HashMap::new` is not a const constructor, so the map is lazily
    // initialized on first use; `OnceLock::new` is const, keeping the
    // registry constructible in a `static`.
    entries: OnceLock<Mutex<HashMap<String, CancelSender>>>,
}

impl StreamRequestRegistry {
    /// Create a registry tracking at most `max_entries` concurrent requests.
    pub const fn new(max_entries: usize) -> Self {
        Self {
            max_entries,
            entries: OnceLock::new(),
        }
    }

    /// Track a new stream request.
    ///
    /// Returns a token whose `cancelled()` future resolves when `cancel` is
    /// called for this id. Returns `None` when the id is already live
    /// (duplicate) or the registry is full — in both cases the stream still
    /// runs, just without cancellation support.
    pub fn register(&self, request_id: &str) -> Option<StreamCancelToken> {
        let mut entries = self.lock();
        if entries.len() >= self.max_entries || entries.contains_key(request_id) {
            return None;
        }
        let (tx, rx) = watch::channel(false);
        entries.insert(request_id.to_string(), tx);
        Some(StreamCancelToken { rx })
    }

    /// Signal cancellation for a live request and remove its entry.
    ///
    /// Returns `true` when a live entry was cancelled — cancellation now owns
    /// the terminal event. Returns `false` for an unknown or already finished
    /// id (no-op, no event is owed to the caller).
    pub fn cancel(&self, request_id: &str) -> bool {
        let sender = self.lock().remove(request_id);
        match sender {
            Some(tx) => {
                // The receiver treats both the value change and a subsequent
                // channel close as cancellation, but send first so the token
                // observes the explicit signal.
                let _ = tx.send(true);
                true
            }
            None => false,
        }
    }

    /// Remove a finished request.
    ///
    /// Returns `true` when a live entry was removed (the caller owns the
    /// terminal event it already emitted). Returns `false` when cancellation
    /// already claimed the terminal event or the id was never registered —
    /// a second terminal event must not be emitted.
    pub fn complete(&self, request_id: &str) -> bool {
        self.lock().remove(request_id).is_some()
    }

    /// Whether the id currently has a live entry.
    pub fn contains(&self, request_id: &str) -> bool {
        self.lock().contains_key(request_id)
    }

    /// Number of live entries (diagnostics/tests).
    pub fn len(&self) -> usize {
        self.lock().len()
    }

    /// Whether no entries are live.
    pub fn is_empty(&self) -> bool {
        self.lock().is_empty()
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, CancelSender>> {
        let mutex = self.entries.get_or_init(|| Mutex::new(HashMap::new()));
        // A panic while holding the lock would leave poisoned state that is
        // safe to recover: the map is still structurally valid and every
        // entry is independent.
        mutex.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Cancellation handle returned by [`StreamRequestRegistry::register`].
///
/// `cancelled()` is safe to use directly in `tokio::select!`: it resolves
/// only on real cancellation and never fires spuriously.
pub struct StreamCancelToken {
    rx: watch::Receiver<bool>,
}

impl StreamCancelToken {
    /// Resolve once the request is cancelled.
    ///
    /// If every sender is dropped without a cancel signal (only possible via
    /// `complete` removing the entry, after which the token is no longer
    /// polled), this parks forever rather than resolving, so a `select!`
    /// branch using it can never win without an actual cancellation.
    pub async fn cancelled(&mut self) {
        loop {
            if self.rx.changed().await.is_err() {
                std::future::pending::<()>().await;
            }
            if *self.rx.borrow() {
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::Future;
    use std::time::Duration;

    fn registry() -> StreamRequestRegistry {
        StreamRequestRegistry::new(3)
    }

    #[test]
    fn register_makes_id_live_until_complete() {
        let r = registry();
        assert!(r.register("a").is_some());
        assert!(r.contains("a"));
        assert_eq!(r.len(), 1);

        assert!(r.complete("a"));
        assert!(!r.contains("a"));
        assert!(r.is_empty());
    }

    #[test]
    fn complete_is_idempotent_only_once() {
        // Second complete must return false: only one side may claim the
        // terminal event.
        let r = registry();
        r.register("a").unwrap();
        assert!(r.complete("a"));
        assert!(!r.complete("a"));
    }

    #[test]
    fn complete_for_unknown_id_is_noop() {
        let r = registry();
        assert!(!r.complete("missing"));
    }

    #[test]
    fn cancel_claims_terminal_and_prevents_complete_claim() {
        let r = registry();
        r.register("a").unwrap();

        assert!(r.cancel("a"));
        // Cancellation already removed the entry and claimed the terminal
        // event: completing afterwards must not claim anything.
        assert!(!r.complete("a"));
        assert!(!r.contains("a"));
    }

    #[test]
    fn double_cancel_is_noop() {
        let r = registry();
        r.register("a").unwrap();
        assert!(r.cancel("a"));
        // The id is now unknown — a repeated cancel must be a no-op so no
        // second terminal event can be produced.
        assert!(!r.cancel("a"));
    }

    #[test]
    fn cancel_unknown_id_is_noop() {
        let r = registry();
        assert!(!r.cancel("missing"));
        assert!(r.is_empty());
    }

    #[test]
    fn duplicate_register_returns_none() {
        let r = registry();
        assert!(r.register("a").is_some());
        assert!(r.register("a").is_none());
        assert_eq!(r.len(), 1);
    }

    #[test]
    fn register_is_bounded() {
        let r = registry(); // max 3
        assert!(r.register("a").is_some());
        assert!(r.register("b").is_some());
        assert!(r.register("c").is_some());
        assert!(r.register("d").is_none());
        assert_eq!(r.len(), 3);

        // Completing one entry frees capacity again.
        r.complete("b");
        assert!(r.register("d").is_some());
    }

    #[test]
    fn cancelled_id_can_be_reregistered() {
        let r = registry();
        r.register("a").unwrap();
        r.cancel("a");
        assert!(r.register("a").is_some());
    }

    #[test]
    fn independent_ids_do_not_interfere() {
        let r = registry();
        r.register("a").unwrap();
        r.register("b").unwrap();
        assert!(r.cancel("a"));
        assert!(r.contains("b"));
        assert!(!r.contains("a"));
    }

    #[tokio::test]
    async fn cancel_token_resolves_only_on_cancel() {
        let r = registry();
        let mut token = r.register("a").unwrap();

        // Without cancellation the token stays pending.
        assert!(
            tokio::time::timeout(Duration::from_millis(25), token.cancelled())
                .await
                .is_err()
        );

        r.cancel("a");
        // Must resolve promptly after the signal.
        tokio::time::timeout(Duration::from_secs(1), token.cancelled())
            .await
            .expect("token resolves after cancel");
    }

    #[tokio::test]
    async fn cancel_token_never_resolves_on_complete() {
        let r = registry();
        let mut token = r.register("a").unwrap();
        // complete() drops the sender without signalling. The token must not
        // treat channel closure as cancellation.
        r.complete("a");
        assert!(
            tokio::time::timeout(Duration::from_millis(25), token.cancelled())
                .await
                .is_err()
        );
    }

    /// Future that reports (via `on_drop`) when it is dropped — stands in for
    /// the in-flight reqwest stream in `llm_stream_chat`.
    struct MockStream {
        on_drop: Option<Box<dyn FnMut() + Send + Sync>>,
    }

    impl MockStream {
        fn new(on_drop: impl FnMut() + Send + Sync + 'static) -> Self {
            Self {
                on_drop: Some(Box::new(on_drop)),
            }
        }
    }

    impl Future for MockStream {
        type Output = Result<(), String>;

        fn poll(
            mut self: std::pin::Pin<&mut Self>,
            _cx: &mut std::task::Context<'_>,
        ) -> std::task::Poll<Self::Output> {
            // Like a live SSE stream: never ready on its own.
            std::task::Poll::Pending
        }
    }

    impl Drop for MockStream {
        fn drop(&mut self) {
            if let Some(mut f) = self.on_drop.take() {
                f();
            }
        }
    }

    /// Mirrors the `tokio::select!` shape used by `llm_stream_chat`: a biased
    /// select with the stream future polled first and cancellation as the
    /// abort path. Cancelling (as `llm_cancel_stream` would, concurrently with
    /// the in-flight stream) must drop the stream future — aborting the
    /// in-flight request — exactly once.
    #[tokio::test]
    async fn cancellation_aborts_pending_stream_future() {
        let registry = std::sync::Arc::new(StreamRequestRegistry::new(3));
        let mut token = registry.register("a").expect("register");

        let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = std::sync::Arc::clone(&dropped);
        let mut stream_fut = MockStream::new(move || {
            flag.store(true, std::sync::atomic::Ordering::SeqCst);
        });

        // Cancel from a concurrent task, the way the `llm_cancel_stream`
        // command fires while the stream task is awaiting network I/O.
        let canceller = {
            let registry = std::sync::Arc::clone(&registry);
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(25)).await;
                registry.cancel("a");
            })
        };

        let result = tokio::select! {
            biased;
            result = stream_fut => result,
            () = token.cancelled() => Err("cancelled".to_string()),
        };

        canceller.await.expect("canceller task");
        assert_eq!(result.unwrap_err(), "cancelled");
        assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
        assert!(!registry.contains("a"));
    }
}
