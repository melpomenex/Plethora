import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * CSS-conflict guard (spec requirement "App CSS does not re-declare upstream
 * layout rules").
 *
 * PDF.js's text-layer layout is owned by `pdfjs-dist/web/pdf_viewer.css`. App
 * stylesheets MUST NOT re-declare layout-affecting properties on `.textLayer`
 * or its span / `.markedContent` / `.endOfContent` descendants — the stale
 * pre-v3 overrides this guard replaces were what broke selection accuracy on
 * the PDF.js 5 upgrade. Selection tint, cursor, and stacking context remain
 * allowed.
 */

// Layout properties that must never be declared on text-layer selectors.
const FORBIDDEN_PROPERTIES = [
  "display",
  "height",
  "top",
  "line-height",
  "box-sizing",
  "margin",
  "padding",
  "border",
  "overflow",
  "position",
  "transform",
];

// Sub-properties of the shorthands above (e.g. border-radius, overflow-x,
// margin-inline) are equally forbidden.
function isForbiddenProperty(property: string): boolean {
  const prop = property.trim().toLowerCase();
  if (FORBIDDEN_PROPERTIES.includes(prop)) return true;
  return FORBIDDEN_PROPERTIES.some((base) => prop.startsWith(`${base}-`));
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

interface RuleBlock {
  selector: string;
  declarations: { property: string; value: string }[];
}

/** Flattens nested blocks (e.g. `@media`, `@supports`) into leaf rules. */
function parseRuleBlocks(css: string): RuleBlock[] {
  const withoutComments = stripComments(css);
  const blocks: RuleBlock[] = [];

  // Iteratively split the top level by balanced braces.
  let i = 0;
  const n = withoutComments.length;
  while (i < n) {
    const open = withoutComments.indexOf("{", i);
    if (open === -1) break;
    const selector = withoutComments.slice(i, open).trim();

    let depth = 1;
    let j = open + 1;
    while (j < n && depth > 0) {
      const ch = withoutComments[j];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      j += 1;
    }
    const body = withoutComments.slice(open + 1, Math.max(open + 1, j - 1));

    if (selector.startsWith("@")) {
      // At-rule: recurse into its body for nested rules.
      if (body.includes("{")) {
        blocks.push(...parseRuleBlocks(body));
      }
    } else {
      const declarations = body
        .split(";")
        .map((decl) => {
          const colon = decl.indexOf(":");
          if (colon === -1) return null;
          return {
            property: decl.slice(0, colon).trim(),
            value: decl.slice(colon + 1).trim(),
          };
        })
        .filter((d): d is { property: string; value: string } => d !== null && d.property.length > 0);
      blocks.push({ selector, declarations });
    }
    i = j;
  }
  return blocks;
}

function textLayerRuleBlocks(css: string): RuleBlock[] {
  return parseRuleBlocks(css).filter((rule) =>
    // `.textLayerContainer` is an app-owned wrapper, not the PDF.js layer; the
    // guard targets `.textLayer` and its descendants only.
    /\.textLayer(?![a-zA-Z])/.test(rule.selector)
  );
}

function collectAppCssFiles(): string[] {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "src");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules") continue;
        walk(full);
      } else if (entry.endsWith(".css")) {
        out.push(full);
      }
    }
  };
  walk(srcDir);
  return out;
}

describe("app CSS must not re-declare PDF.js text-layer layout", () => {
  const cssFiles = collectAppCssFiles();
  expect(cssFiles.length).toBeGreaterThan(0);

  it.each(cssFiles)("%s declares no layout properties on .textLayer selectors", (file) => {
    const css = readFileSync(file, "utf8");
    const offending: string[] = [];

    for (const rule of textLayerRuleBlocks(css)) {
      for (const decl of rule.declarations) {
        if (isForbiddenProperty(decl.property)) {
          offending.push(`${rule.selector} { ${decl.property}: ${decl.value} }`);
        }
      }
    }

    expect(offending).toEqual([]);
  });

  it("allows the app-specific selection tint, cursor, and stacking rules", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "PDFViewer.css"), "utf8");
    // The tint rules set background/color only — they must keep existing.
    expect(css).toContain(".textLayer ::selection");
    expect(css).toContain("cursor: text");
    // And none of the tint rules may smuggle in a layout property.
    for (const rule of textLayerRuleBlocks(css)) {
      for (const decl of rule.declarations) {
        expect(isForbiddenProperty(decl.property), `${rule.selector} → ${decl.property}`).toBe(false);
      }
    }
  });

  it("keeps the text layer stacked above the page canvas (selection must be reachable)", () => {
    // The app's LAYER 1 rule pins the page canvas to z-index 1; upstream's
    // .textLayer z-index 0 would paint BELOW the canvas and swallow selection
    // pointer events. The app must keep a text-layer stacking guarantee >= the
    // canvas's. (This regression actually shipped once — see the z-index note
    // on the .textLayer rule.)
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "PDFViewer.css"), "utf8");
    const blocks = parseRuleBlocks(css);

    const canvasZ = blocks.find((rule) => /\[data-pdf-page\]\s*canvas/.test(rule.selector))
      ?.declarations.find((decl) => decl.property === "z-index")?.value;
    const textLayerZ = blocks.find((rule) => rule.selector === ".textLayer")
      ?.declarations.find((decl) => decl.property === "z-index")?.value;

    expect(canvasZ, "expected [data-pdf-page] canvas z-index rule").toBeDefined();
    expect(textLayerZ, "expected .textLayer z-index rule").toBeDefined();
    expect(Number(textLayerZ)).toBeGreaterThanOrEqual(Number(canvasZ));
  });
});
