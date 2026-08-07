import { describe, expect, it } from "vitest";
import {
  WEB_BRIDGE_NS,
  parseWebBridgeMessage,
} from "../webview-extract-bridge";
import { proxyOriginOf, isTrustedBridgeEvent } from "../webProxy";

describe("proxy origin derivation", () => {
  it("derives the origin from a proxied loopback URL", () => {
    expect(proxyOriginOf("http://127.0.0.1:54912/web?url=https%3A%2F%2Fexample.com"))
      .toBe("http://127.0.0.1:54912");
  });

  it("returns empty string for malformed input", () => {
    expect(proxyOriginOf("not a url")).toBe("");
  });
});

describe("isTrustedBridgeEvent — wrong origin / wrong source are rejected", () => {
  const proxyOrigin = "http://127.0.0.1:54912";
  const frameWindow = {} as Window;

  it("rejects a message from a foreign source", () => {
    const foreign = { source: {} as Window, origin: proxyOrigin };
    expect(isTrustedBridgeEvent(foreign, frameWindow, proxyOrigin)).toBe(false);
  });

  it("rejects a message from the right window but a different origin", () => {
    const wrongOrigin = { source: frameWindow, origin: "https://evil.example" };
    expect(isTrustedBridgeEvent(wrongOrigin, frameWindow, proxyOrigin)).toBe(false);
  });

  it("rejects when no frame or proxy origin is available yet", () => {
    expect(isTrustedBridgeEvent({ source: frameWindow, origin: proxyOrigin }, null, proxyOrigin)).toBe(false);
    expect(isTrustedBridgeEvent({ source: frameWindow, origin: proxyOrigin }, frameWindow, null)).toBe(false);
  });

  it("accepts the proxied frame's own message", () => {
    expect(isTrustedBridgeEvent({ source: frameWindow, origin: proxyOrigin }, frameWindow, proxyOrigin)).toBe(true);
  });
});

describe("parseWebBridgeMessage — malformed payloads are ignored", () => {
  it("rejects non-objects and null", () => {
    expect(parseWebBridgeMessage(null)).toBeNull();
    expect(parseWebBridgeMessage(undefined)).toBeNull();
    expect(parseWebBridgeMessage("string")).toBeNull();
    expect(parseWebBridgeMessage(42)).toBeNull();
  });

  it("rejects messages with the wrong namespace", () => {
    expect(
      parseWebBridgeMessage({ ns: "other-ns", type: "ready", payload: { url: "u", title: "t" } })
    ).toBeNull();
    expect(
      parseWebBridgeMessage({ type: "ready", payload: { url: "u", title: "t" } })
    ).toBeNull();
  });

  it("rejects messages with an unknown type", () => {
    expect(
      parseWebBridgeMessage({ ns: WEB_BRIDGE_NS, type: "bogus", payload: {} })
    ).toBeNull();
  });

  it("rejects messages missing or malformed payloads", () => {
    expect(parseWebBridgeMessage({ ns: WEB_BRIDGE_NS, type: "ready" })).toBeNull();
    expect(
      parseWebBridgeMessage({ ns: WEB_BRIDGE_NS, type: "ready", payload: "nope" })
    ).toBeNull();
    expect(
      parseWebBridgeMessage({ ns: WEB_BRIDGE_NS, type: "ready", payload: { url: 42, title: "t" } })
    ).toBeNull();
  });

  it("rejects shape-mismatched payloads per type", () => {
    // selection/extract need text+html+url+title strings
    expect(
      parseWebBridgeMessage({
        ns: WEB_BRIDGE_NS,
        type: "selection",
        payload: { text: "hi", html: "", url: "u" }, // missing title
      })
    ).toBeNull();
    // navigate needs url + boolean newTab
    expect(
      parseWebBridgeMessage({
        ns: WEB_BRIDGE_NS,
        type: "navigate",
        payload: { url: "https://example.com", newTab: "yes" },
      })
    ).toBeNull();
    // text-response needs numeric id + string text
    expect(
      parseWebBridgeMessage({
        ns: WEB_BRIDGE_NS,
        type: "text-response",
        payload: { id: "x", text: "t" },
      })
    ).toBeNull();
    // proxy-error needs reason + host strings
    expect(
      parseWebBridgeMessage({
        ns: WEB_BRIDGE_NS,
        type: "proxy-error",
        payload: { reason: "upstream timed out", host: 123 },
      })
    ).toBeNull();
  });
});

describe("parseWebBridgeMessage — valid messages pass", () => {
  it("parses a ready message", () => {
    const msg = parseWebBridgeMessage({
      ns: WEB_BRIDGE_NS,
      type: "ready",
      payload: { url: "https://en.wikipedia.org/wiki/Spaced_repetition", title: "Spaced repetition" },
    });
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("ready");
    if (msg!.type === "ready") {
      expect(msg!.payload.url).toBe("https://en.wikipedia.org/wiki/Spaced_repetition");
    }
  });

  it("parses a selection message including empty text (cleared selection)", () => {
    const cleared = parseWebBridgeMessage({
      ns: WEB_BRIDGE_NS,
      type: "selection",
      payload: { text: "", html: "", url: "https://example.com/", title: "Example" },
    });
    expect(cleared).not.toBeNull();
    expect(cleared!.type).toBe("selection");
    if (cleared!.type === "selection") {
      expect(cleared!.payload.text).toBe("");
    }

    const selected = parseWebBridgeMessage({
      ns: WEB_BRIDGE_NS,
      type: "selection",
      payload: { text: "some text", html: "<p>some text</p>", url: "https://example.com/", title: "Example" },
    });
    expect(selected).not.toBeNull();
    if (selected!.type === "selection") {
      expect(selected!.payload.text).toBe("some text");
    }
  });

  it("parses navigate, extract, text-response, and proxy-error messages", () => {
    const navigate = parseWebBridgeMessage({
      ns: WEB_BRIDGE_NS,
      type: "navigate",
      payload: { url: "https://example.com/next", newTab: false },
    });
    expect(navigate).not.toBeNull();

    const extract = parseWebBridgeMessage({
      ns: WEB_BRIDGE_NS,
      type: "extract",
      payload: { text: "selected", html: "<b>selected</b>", url: "https://example.com/", title: "Example" },
    });
    expect(extract).not.toBeNull();
    expect(extract!.type).toBe("extract");

    const textResponse = parseWebBridgeMessage({
      ns: WEB_BRIDGE_NS,
      type: "text-response",
      payload: { id: 7, text: "page body text" },
    });
    expect(textResponse).not.toBeNull();

    const proxyError = parseWebBridgeMessage({
      ns: WEB_BRIDGE_NS,
      type: "proxy-error",
      payload: { reason: "upstream returned HTTP 403", host: "example.com" },
    });
    expect(proxyError).not.toBeNull();
    expect(proxyError!.type).toBe("proxy-error");
  });
});
