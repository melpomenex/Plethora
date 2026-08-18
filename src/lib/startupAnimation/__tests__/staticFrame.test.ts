/**
 * Static-frame parity + offline guarantees.
 *
 * The pre-React frame inside index.html cannot import the KP_GEOMETRY
 * constants, so this test pins its inline values to the exported ones —
 * the two layers cannot drift (design D1/D7). The same checker asserts the
 * frame and the React startup components reference nothing remote (offline
 * launch, spec lifecycle requirement).
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { KP_GEOMETRY } from "../types";

const root = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

const html = read("index.html");
const frameStart = html.indexOf('<style id="kp-static-style">');
const frameEnd = html.indexOf("<!-- /boot-frame -->");
const frame = frameStart >= 0 && frameEnd > frameStart ? html.slice(frameStart, frameEnd) : "";

describe("static pre-React frame geometry parity (KP_GEOMETRY)", () => {
  it("the frame markup exists inside #root", () => {
    expect(frameStart).toBeGreaterThan(-1);
    expect(frame).toContain('id="boot-frame"');
  });

  it("boot surface matches KP_GEOMETRY.bootSurface", () => {
    expect(frame.toLowerCase()).toContain(
      `background: ${KP_GEOMETRY.bootSurface.toLowerCase()}`
    );
  });

  it("scene cap matches KP_GEOMETRY.containerMaxWidth", () => {
    expect(frame).toContain(`max-width: ${KP_GEOMETRY.containerMaxWidth}px`);
  });

  it("mascot size matches KP_GEOMETRY per form factor (desktop base, phone media query)", () => {
    expect(frame).toContain(`width: ${KP_GEOMETRY.mascotSizeDesktop}px`);
    expect(frame).toContain(`height: ${KP_GEOMETRY.mascotSizeDesktop}px`);
    expect(frame).toContain(`width: ${KP_GEOMETRY.mascotSizePhone}px`);
    expect(frame).toContain(`height: ${KP_GEOMETRY.mascotSizePhone}px`);
  });

  it("carries the canonical mascot hexes (same guard as brandInventory)", () => {
    for (const hex of ["#8B5CF6", "#7C3AED", "#5B21B6", "#F59E0B"]) {
      expect(frame).toContain(hex);
    }
  });
});

describe("offline guarantee: no remote references in the launch surface", () => {
  const REMOTE = /https?:\/\//;

  it("the index.html static frame references nothing remote", () => {
    // The xmlns namespace is a URI, not a network reference — SVG requires it.
    expect(frame.replace(/\sxmlns="[^"]*"/g, "")).not.toMatch(REMOTE);
  });

  it("src/components/startup/* references nothing remote", () => {
    const dir = join(root, "src", "components", "startup");
    const files = readdirSync(dir).filter((f) => /\.(tsx|ts|css)$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source.replace(/\sxmlns="[^"]*"/g, ""), `${file} references a remote URL`).not.toMatch(
        REMOTE
      );
    }
  });

  it("src/lib/startupAnimation/* references nothing remote", () => {
    const dir = join(root, "src", "lib", "startupAnimation");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, `${file} references a remote URL`).not.toMatch(REMOTE);
    }
  });
});
