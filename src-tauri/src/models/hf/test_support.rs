//! Shared test helpers for the HF module (test-only; never compiled in prod).

#![cfg(test)]

use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

/// A minimal local HTTP server for download tests. `responder(connection)`
/// returns `(status, body)`; the body is sent with `Content-Length`.
///
/// For cancellation tests, declare a `Content-Length` larger than the bytes
/// actually sent and keep the connection open, so the client blocks mid-stream
/// and cancellation is deterministic.
pub struct TestServer {
    pub url: String,
    stop: tokio::sync::watch::Sender<bool>,
    handle: tokio::task::JoinHandle<()>,
}

pub struct TestServerBuilder {
    /// status/body per connection index (1-based)
    responder: Box<dyn FnMut(u32) -> (u16, Vec<u8>) + Send>,
    /// if Some(n): declare Content-Length = body.len() but only send n bytes,
    /// then hold the connection open (never close) until the test stops.
    hold_after_bytes: Option<usize>,
    /// notifies the test once the (partial) body has been delivered
    hold_signal: Option<tokio::sync::oneshot::Sender<()>>,
}

impl TestServerBuilder {
    pub fn new(responder: impl FnMut(u32) -> (u16, Vec<u8>) + Send + 'static) -> Self {
        Self {
            responder: Box::new(responder),
            hold_after_bytes: None,
            hold_signal: None,
        }
    }

    /// Declare the full `Content-Length` but only send the first `n` bytes of
    /// the body, holding the connection open afterward. Returns a receiver that
    /// resolves once the partial body has been written.
    pub fn hold_after_bytes(
        mut self,
        n: usize,
    ) -> (Self, tokio::sync::oneshot::Receiver<()>) {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.hold_after_bytes = Some(n);
        self.hold_signal = Some(tx);
        (self, rx)
    }

    pub async fn spawn(self) -> TestServer {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{}/model.bin", addr);
        let (stop_tx, mut stop_rx) = tokio::sync::watch::channel(false);
        let hold_after_bytes = self.hold_after_bytes;
        let hold_signal = Arc::new(Mutex::new(self.hold_signal));
        let mut responder = self.responder;

        let handle = tokio::spawn(async move {
            let mut conn: u32 = 0;
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => break,
                    res = listener.accept() => {
                        if let Ok((mut socket, _)) = res {
                            conn += 1;
                            let (status, body) = responder(conn);
                            let mut buf = [0u8; 4096];
                            let _ = socket.read(&mut buf).await;
                            let reason = if status == 200 { "OK" } else { "Error" };
                            let sent_len = hold_after_bytes
                                .map(|n| n.min(body.len()))
                                .unwrap_or(body.len());
                            let head = format!(
                                "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                                body.len()
                            );
                            if socket.write_all(head.as_bytes()).await.is_err() {
                                continue;
                            }
                            if socket.write_all(&body[..sent_len]).await.is_err() {
                                continue;
                            }
                            if let Some(signal) = hold_signal.lock().await.take() {
                                let _ = signal.send(());
                            }
                            let _ = socket.flush().await;
                            // When we declared more bytes than we sent, keep the
                            // socket open so the client stays blocked mid-stream.
                            if hold_after_bytes.is_some() && sent_len < body.len() {
                                let _ = stop_rx.changed().await;
                            }
                        }
                    }
                }
            }
        });

        TestServer {
            url,
            stop: stop_tx,
            handle,
        }
    }
}

impl TestServer {
    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.stop();
        self.handle.abort();
    }
}
