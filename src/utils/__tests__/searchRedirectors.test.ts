import { describe, expect, it } from "vitest";
import { unwrapSearchRedirector } from "../searchRedirectors";

/** base64url("https://en.wikipedia.org/wiki/Atari") — Bing's `u=a1…` shape. */
const BING_TARGET = "https://en.wikipedia.org/wiki/Atari";
const bingParam = `a1${btoa(BING_TARGET).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

describe("unwrapSearchRedirector", () => {
  it("unwraps google /url?q= redirectors", () => {
    expect(
      unwrapSearchRedirector(
        "https://www.google.com/url?q=https://en.wikipedia.org/wiki/Rome&rct=j"
      )
    ).toBe("https://en.wikipedia.org/wiki/Rome");
  });

  it("unwraps google /imgres?imgurl= redirectors", () => {
    expect(
      unwrapSearchRedirector("https://www.google.com/imgres?imgurl=https://example.com/pic.png")
    ).toBe("https://example.com/pic.png");
  });

  it("unwraps duckduckgo /l/?uddg= redirectors", () => {
    expect(
      unwrapSearchRedirector(
        "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=abc"
      )
    ).toBe("https://example.com/page");
  });

  it("unwraps bing /ck/a base64url u= redirectors", () => {
    expect(unwrapSearchRedirector(`https://www.bing.com/ck/a?!&u=${bingParam}&ntb=1`)).toBe(
      BING_TARGET
    );
  });

  it("passes non-redirector URLs through untouched", () => {
    const url = "https://en.wikipedia.org/wiki/Rome";
    expect(unwrapSearchRedirector(url)).toBe(url);
    // Google search itself is not a redirector.
    const search = "https://www.google.com/search?q=test";
    expect(unwrapSearchRedirector(search)).toBe(search);
  });

  it("falls back to the original URL on missing or malformed params", () => {
    const missing = "https://www.google.com/url?sa=t&rct=j";
    expect(unwrapSearchRedirector(missing)).toBe(missing);
    const empty = "https://www.google.com/url?q=";
    expect(unwrapSearchRedirector(empty)).toBe(empty);
    const badB64 = "https://www.bing.com/ck/a?u=a1%%%not-base64%%%";
    expect(unwrapSearchRedirector(badB64)).toBe(badB64);
  });

  it("never returns a non-http(s) target", () => {
    // A javascript:/file: payload must not be extracted as a navigation URL.
    const js = "https://www.google.com/url?q=javascript:alert(1)";
    expect(unwrapSearchRedirector(js)).toBe(js);
    const file = "https://duckduckgo.com/l/?uddg=file%3A%2F%2F%2Fetc%2Fpasswd";
    expect(unwrapSearchRedirector(file)).toBe(file);
  });

  it("extracts http(s) targets verbatim — downstream validation decides reachability", () => {
    // The unwrap itself is transport-neutral: a loopback target is still an
    // http URL; rejection happens in the same isSafeWebUrl + per-hop proxy
    // validation applied to every navigation (unchanged security boundary).
    const loopback = "http://127.0.0.1:8080/private";
    expect(
      unwrapSearchRedirector(`https://www.google.com/url?q=${encodeURIComponent(loopback)}`)
    ).toBe(loopback);
  });
});
