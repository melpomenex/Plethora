//! Shared test helpers for the HF module (test-only; never compiled in prod).

#![cfg(test)]

use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio::time::Duration;

/// A recorded incoming request head (request line + headers, verbatim).
#[derive(Debug, Clone)]
pub struct RecordedRequest {
    pub head: String,
}

impl RecordedRequest {
    /// Case-insensitive contains over the raw head (header lookup helper).
    pub fn has_header(&self, name: &str) -> bool {
        self.head.to_ascii_lowercase().contains(&name.to_ascii_lowercase())
    }

    /// The value of `Range:` if present, e.g. `bytes=1048576-`.
    pub fn range_header(&self) -> Option<String> {
        for line in self.head.lines() {
            let lower = line.to_ascii_lowercase();
            if lower.starts_with("range:") {
                return Some(line["range:".len()..].trim().to_string());
            }
        }
        None
    }
}

/// A minimal local HTTP server for download tests. `responder(connection)`
/// returns `(status, body)`; the body is sent with `Content-Length`.
///
/// For cancellation tests, declare a `Content-Length` larger than the bytes
/// actually sent and keep the connection open (`hold_after_bytes`), so the
/// client blocks mid-stream and cancellation is deterministic.
pub struct TestServer {
    pub url: String,
    requests: Arc<Mutex<Vec<RecordedRequest>>>,
    stop: tokio::sync::watch::Sender<bool>,
    handle: tokio::task::JoinHandle<()>,
}

impl TestServer {
    /// Every request head the server has accepted, in arrival order.
    pub async fn requests(&self) -> Vec<RecordedRequest> {
        self.requests.lock().await.clone()
    }
}

pub struct TestServerBuilder {
    /// status/body per connection index (1-based)
    responder: Box<dyn FnMut(u32) -> (u16, Vec<u8>) + Send>,
    /// if Some(n): declare Content-Length = body.len() but only send n bytes,
    /// then keep the connection open until the test stops.
    hold_after_bytes: Option<usize>,
    /// notifies the test once the (partial) body has been delivered
    hold_signal: Option<tokio::sync::oneshot::Sender<()>>,
    /// if Some(n): send n bytes then abruptly close the connection
    /// (simulates a mid-stream connection drop).
    drop_after_bytes: Option<usize>,
    /// notifies the test once the pre-drop bytes have been written
    drop_signal: Option<tokio::sync::oneshot::Sender<()>>,
    /// honor `Range: bytes=N-` requests with 206 + Content-Range slices
    support_ranges: bool,
    /// if Some((chunk, delay_ms)): send the body `chunk` bytes at a time with
    /// `delay_ms` between writes (tests read-timeout refresh behavior).
    trickle: Option<(usize, u64)>,
}

impl TestServerBuilder {
    pub fn new(responder: impl FnMut(u32) -> (u16, Vec<u8>) + Send + 'static) -> Self {
        Self {
            responder: Box::new(responder),
            hold_after_bytes: None,
            hold_signal: None,
            drop_after_bytes: None,
            drop_signal: None,
            support_ranges: false,
            trickle: None,
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

    /// Send only the first `n` bytes of the body on the **first** connection,
    /// then close it abruptly (mid-stream failure); later connections serve
    /// their full body. Returns a receiver that resolves once those bytes have
    /// been written.
    pub fn drop_after_bytes(
        mut self,
        n: usize,
    ) -> (Self, tokio::sync::oneshot::Receiver<()>) {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.drop_after_bytes = Some(n);
        self.drop_signal = Some(tx);
        (self, rx)
    }

    /// Honor `Range: bytes=N-` request headers with `206 Partial Content` and
    /// a `Content-Range` header, serving `body[N..]`.
    pub fn support_ranges(mut self) -> Self {
        self.support_ranges = true;
        self
    }

    /// Send the body `chunk` bytes at a time, sleeping `delay_ms` between
    /// writes, so data keeps trickling (read timeouts refresh, total
    /// timeouts would fire).
    pub fn trickle(mut self, chunk: usize, delay_ms: u64) -> Self {
        self.trickle = Some((chunk, delay_ms));
        self
    }

    pub async fn spawn(self) -> TestServer {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let url = format!("http://{}/model.bin", addr);
        let (stop_tx, mut stop_rx) = tokio::sync::watch::channel(false);
        let hold_after_bytes = self.hold_after_bytes;
        let drop_after_bytes = self.drop_after_bytes;
        let support_ranges = self.support_ranges;
        let trickle = self.trickle;
        let requests: Arc<Mutex<Vec<RecordedRequest>>> = Arc::new(Mutex::new(Vec::new()));
        let hold_signal = Arc::new(Mutex::new(self.hold_signal));
        let drop_signal = Arc::new(Mutex::new(self.drop_signal));
        let mut responder = self.responder;
        let requests_for_task = Arc::clone(&requests);

        let handle = tokio::spawn(async move {
            let mut conn: u32 = 0;
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => break,
                    res = listener.accept() => {
                        if let Ok((mut socket, _)) = res {
                            conn += 1;
                            let (status, body) = responder(conn);

                            // Read the request head (up to \r\n\r\n) so tests
                            // can assert on headers like Range.
                            let mut buf = vec![0u8; 8192];
                            let mut head = String::new();
                            let deadline = tokio::time::Instant::now()
                                + Duration::from_secs(5);
                            loop {
                                if head.contains("\r\n\r\n") || head.len() >= 8192 {
                                    break;
                                }
                                let n = tokio::time::timeout_at(deadline, socket.read(&mut buf))
                                    .await
                                    .ok()
                                    .and_then(|r| r.ok())
                                    .unwrap_or(0);
                                if n == 0 {
                                    break;
                                }
                                head.push_str(&String::from_utf8_lossy(&buf[..n]));
                            }
                            requests_for_task.lock().await.push(RecordedRequest { head });

                            // Range support: slice the body per the request.
                            let mut status = status;
                            let mut body = body;
                            let mut content_range: Option<String> = None;
                            if support_ranges {
                                let range = requests_for_task
                                    .lock()
                                    .await
                                    .last()
                                    .and_then(|r| r.range_header());
                                if let Some(range) = range {
                                    if let Some(start) = range
                                        .strip_prefix("bytes=")
                                        .and_then(|spec| spec.split('-').next())
                                        .and_then(|n| n.trim().parse::<usize>().ok())
                                    {
                                        if start >= body.len() {
                                            status = 416;
                                            body = Vec::new();
                                        } else {
                                            status = 206;
                                            content_range = Some(format!(
                                                "bytes {}-{}/{}",
                                                start,
                                                body.len() - 1,
                                                body.len()
                                            ));
                                            body = body.split_off(start);
                                        }
                                    }
                                }
                            }

                            let reason = match status {
                                200 => "OK",
                                206 => "Partial Content",
                                416 => "Range Not Satisfiable",
                                _ => "Error",
                            };
                            // Drop mode fires on the first connection only;
                            // later connections serve fully.
                            let drop_this_conn = drop_after_bytes.filter(|_| conn == 1);
                            let sent_len = hold_after_bytes
                                .map(|n| n.min(body.len()))
                                .or_else(|| drop_this_conn.map(|n| n.min(body.len())))
                                .unwrap_or(body.len());
                            let mut head_response = format!(
                                "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n",
                                body.len()
                            );
                            if let Some(range) = content_range {
                                head_response.push_str(&format!("Content-Range: {range}\r\n"));
                            }
                            head_response.push_str("\r\n");
                            if socket.write_all(head_response.as_bytes()).await.is_err() {
                                continue;
                            }

                            if let Some((chunk, delay_ms)) = trickle {
                                for piece in body.chunks(chunk.max(1)) {
                                    if socket.write_all(piece).await.is_err() {
                                        break;
                                    }
                                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                                }
                            } else if socket.write_all(&body[..sent_len]).await.is_err() {
                                continue;
                            }
                            if let Some(signal) = hold_signal.lock().await.take() {
                                let _ = signal.send(());
                            }
                            if let Some(signal) = drop_signal.lock().await.take() {
                                let _ = signal.send(());
                            }
                            let _ = socket.flush().await;
                            // Drop mode: close the connection abruptly so the
                            // client sees a truncated body (mid-stream fail).
                            if drop_this_conn.is_some() && sent_len < body.len() {
                                let _ = socket.shutdown().await;
                                continue;
                            }
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
            requests,
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
