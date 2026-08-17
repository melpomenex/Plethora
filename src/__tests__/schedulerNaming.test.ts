import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Brand guard: no SuperMemo-derived scheduler branding (SM-2/SM-18/SM-20…)
 * may appear in user-facing frontend strings. Internal ids (`sm2`, `sm18`, …),
 * type/enum identifiers, and developer comments are exempt; third-party
 * product names ("SuperMemo" as an import source) are allowlisted.
 */

const ROOT = path.resolve(__dirname, "../..");

const ALLOWED_FILES = new Set([
  // Third-party product name used as an import source label, not a scheduler name.
  "src/utils/supermemoImport.ts",
  "src/components/documents/EnhancedFilePicker.tsx",
  "src/utils/ankiImport.ts",
  "src/routes/documents.tsx",
  // Factual attribution of Wozniak's published formulation rules in an AI prompt.
  "src/lib/ai/knowledgeFormulation.ts",
  // This test's own fixtures/wording.
  "src/__tests__/schedulerNaming.test.ts",
]);

/** Strip comments (line + block) while respecting string/template literals. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      out += "\n";
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      out += " ";
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        out += source[i];
        if (source[i] === "\\") {
          out += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (source[i] === quote || source[i] === "\n") {
          i += 1;
          break;
        }
        i += 1;
      }
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** Collect the contents of string/template literals from comment-stripped code. */
function stringLiterals(code: string): string[] {
  const literals: string[] = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let value = "";
      i += 1;
      while (i < n) {
        if (code[i] === "\\") {
          value += code[i] + (code[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (code[i] === quote || code[i] === "\n") break;
        value += code[i];
        i += 1;
      }
      i += 1;
      literals.push(value);
    } else {
      i += 1;
    }
  }
  return literals;
}

function listSourceFiles(): string[] {
  const git = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { cwd: ROOT, encoding: "utf8" });
  return git
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .filter((f) => !/\.test\.(ts|tsx)$/.test(f))
    .filter((f) => !f.endsWith(".bench.ts"))
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
}

const SM_TOKEN = /\bSM-?\d{1,2}\b/;

describe("scheduler naming brand guard", () => {
  const files = listSourceFiles();
  expect(files.length).toBeGreaterThan(100);

  it("string literals contain no SM-<n> scheduler branding", () => {
    const offenders: string[] = [];
    for (const rel of files) {
      const code = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      for (const literal of stringLiterals(code)) {
        const match = literal.match(SM_TOKEN);
        if (match) offenders.push(`${rel}: ${JSON.stringify(literal.slice(0, 60))}`);
      }
      // JSX text nodes (between tags) are not string literals — check those too.
      const jsxText = code.match(/>\s*[^<>{}]*\bSM-?\d{1,2}\b[^<>{}]*\s*</);
      if (jsxText) offenders.push(`${rel}: JSX ${jsxText[0].slice(0, 40)}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the word "SuperMemo" only appears in allowlisted import-source strings', () => {
    const offenders: string[] = [];
    for (const rel of files) {
      if (ALLOWED_FILES.has(rel)) continue;
      const code = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      const inStrings = stringLiterals(code).some((l) => /\bSuperMemo\b/.test(l));
      const inJsx = />\s*[^<>{}]*\bSuperMemo\b[^<>{}]*\s*</.test(code);
      if (inStrings || inJsx) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
