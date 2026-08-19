import { describe, expect, it } from "vitest";
import {
  XTHREAD_ERROR_COPY,
  isXThreadErrorType,
  normalizeThreadErrorType,
  parseThreadError,
  resolveThreadError,
  type XThreadErrorType,
} from "../xthreadError";

/**
 * Parity table: the snake_case `type` tags the Rust backend serializes
 * (`src-tauri/src/threadreader.rs` `ThreadError`, `rename_all =
 * "snake_case"`) must each map to a distinct, non-generic UI copy. The Rust
 * side asserts the same serialized shape in
 * `thread_error_serializes_as_snake_case_type_message`.
 */
const RUST_SNAKE_CASE_TYPES: Array<[string, XThreadErrorType]> = [
  ["thread_unavailable", "threadUnavailable"],
  ["thread_reader_unavailable", "threadReaderUnavailable"],
  ["rate_limited", "rateLimited"],
  ["network_error", "networkError"],
  ["invalid_url", "invalidUrl"],
  ["auth", "auth"],
];

describe("xthreadError — Rust/UI error-type parity", () => {
  it("every Rust ThreadError snake_case type normalizes to its camelCase copy key", () => {
    for (const [snake, camel] of RUST_SNAKE_CASE_TYPES) {
      expect(normalizeThreadErrorType(snake)).toBe(camel);
      expect(isXThreadErrorType(camel)).toBe(true);
    }
  });

  it("every canonical type maps to distinct, non-generic title/detail copy", () => {
    const titles = new Set<string>();
    const details = new Set<string>();
    for (const [, camel] of RUST_SNAKE_CASE_TYPES) {
      const copy = XTHREAD_ERROR_COPY[camel];
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
      // No variant may fall through to the generic fallback's detail (the
      // raw-message-as-detail fallback) — typed errors must be distinguishable
      // from "Something went wrong".
      expect(copy.detail).not.toBe("Something went wrong while fetching this thread.");
      titles.add(copy.title);
      details.add(copy.detail);
    }
    expect(titles.size).toBe(RUST_SNAKE_CASE_TYPES.length);
    expect(details.size).toBe(RUST_SNAKE_CASE_TYPES.length);
  });

  it("accepts kebab-case and already-camelCase shapes from legacy consumers", () => {
    expect(normalizeThreadErrorType("thread-reader-unavailable")).toBe("threadReaderUnavailable");
    expect(normalizeThreadErrorType("threadUnavailable")).toBe("threadUnavailable");
    expect(normalizeThreadErrorType("RateLimited")).toBe("rateLimited");
    expect(normalizeThreadErrorType("  network_error ")).toBe("networkError");
    expect(normalizeThreadErrorType(undefined)).toBeUndefined();
    expect(normalizeThreadErrorType("something_else")).toBeUndefined();
  });

  it("parseThreadError normalizes snake_case types embedded in Tauri rejections", () => {
    const viaError = new Error(
      'Tauri command "get_twitter_thread" failed: {"type":"thread_reader_unavailable","message":"TRA 500"}'
    );
    expect(parseThreadError(viaError).type).toBe("threadReaderUnavailable");

    const viaTypedError = Object.assign(new Error("boom"), { type: "rate_limited" });
    expect(parseThreadError(viaTypedError).type).toBe("rateLimited");

    const viaJsonString = parseThreadError('{"type":"invalid_url","message":"bad"}');
    expect(viaJsonString.type).toBe("invalidUrl");
    expect(viaJsonString.message).toBe("bad");
  });

  it("extracts the embedded envelope even when the message contains quotes", () => {
    // The backend message itself contains `"` characters — the old regex
    // `\{"type"...\}` would bail and silently drop the type (generic
    // fallback, the exact bug this fix targets). JSON.parse of the substring
    // from the envelope signature survives embedded quotes.
    const withQuotes =
      'Tauri command "get_twitter_thread" failed: {"type":"thread_reader_unavailable","message":"ThreadReaderApp 500: \\"boom\\" for id 123"}';
    const parsed = parseThreadError(withQuotes);
    expect(parsed.type).toBe("threadReaderUnavailable");
    expect(parsed.message).toBe('ThreadReaderApp 500: "boom" for id 123');

    // Same via an Error wrapper (the real Tauri rejection path).
    const viaError = new Error(
      'Tauri command "get_twitter_thread" failed: {"type":"rate_limited","message":"wait \\"a\\" moment"}'
    );
    expect(parseThreadError(viaError).type).toBe("rateLimited");
    expect(parseThreadError(viaError).message).toBe('wait "a" moment');
  });

  it("falls back to the plain message when no envelope is embedded", () => {
    expect(parseThreadError(new Error("Something exploded with { braces }")).message).toBe(
      "Something exploded with { braces }"
    );
    expect(parseThreadError("plain rejection text")).toEqual({ message: "plain rejection text" });
  });

  it("resolveThreadError maps typed errors to their copy and keeps raw text secondary", () => {
    const resolved = resolveThreadError({ type: "thread_unavailable", message: "Tweet not found or restricted in GraphQL" });
    expect(resolved.typed).toBe(true);
    expect(resolved.type).toBe("threadUnavailable");
    expect(resolved.copy.title).toBe("Unable to load this X thread");
    expect(resolved.copy.detail).toContain("private, deleted");
    // The raw backend message is never the primary copy — it travels separately.
    expect(resolved.message).toBe("Tweet not found or restricted in GraphQL");
    expect(resolved.copy.title).not.toContain("not found");
  });

  it("unknown types fall back to generic copy with the raw message as detail", () => {
    const resolved = resolveThreadError(new Error("something exploded"));
    expect(resolved.typed).toBe(false);
    expect(resolved.copy.title).toBe("Unable to load this X thread");
    expect(resolved.copy.detail).toBe("something exploded");
  });

  it("resolveThreadError handles empty/unknown errors without throwing", () => {
    expect(resolveThreadError(null).copy.title).toBe("Unable to load this X thread");
    expect(resolveThreadError(undefined).copy.title).toBe("Unable to load this X thread");
  });
});
