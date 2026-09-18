import { test } from "node:test";
import assert from "node:assert/strict";
import { Linter } from "eslint";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ruleSource = readFileSync(
  new URL("../eslint-rules/no-hardcoded-chrome-colors.js", import.meta.url),
  "utf8",
);
const rule = await import(
  `data:text/javascript;base64,${Buffer.from(ruleSource).toString("base64")}`
).then((m) => m.default);

const linter = new Linter();

function lint(code, filename = "src/components/md3/Button.tsx") {
  return linter.verify(code, [
    {
      files: ["**/*.tsx"],
      plugins: { plethora: { rules: { "no-hardcoded-chrome-colors": rule } } },
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      rules: { "plethora/no-hardcoded-chrome-colors": "error" },
    },
  ], { filename });
}

test("flags hex colors in className inside migrated paths", () => {
  const messages = lint('export const x = <button className="bg-[#1f2937]">a</button>;');
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /semantic token/);
});

test("allows token-based classNames", () => {
  const messages = lint('export const x = <button className="bg-surface-container-high">a</button>;');
  assert.equal(messages.length, 0);
});

test("md3-allow comment suppresses", () => {
  const messages = lint([
    "// md3-allow: brand color for the YouTube logo",
    'export const x = <button className="text-[#ff0000]">a</button>;',
    "",
  ].join("\n"));
  assert.equal(messages.length, 0);
});

test("non-migrated paths are not flagged", () => {
  const messages = lint(
    'export const x = <button className="bg-[#1f2937]">a</button>;',
    "src/components/media/RSSReader.tsx",
  );
  assert.equal(messages.length, 0);
});

test("flags the legacy primary-button recipe", () => {
  const messages = lint(
    'export const x = <button className="bg-primary text-primary-foreground hover:bg-primary/90">a</button>;',
  );
  assert.ok(messages.some((m) => /md3 Button/.test(m.message)));
});

for (const expression of ["{'bg-[#123456]'}", "{`bg-[#123456] ${active}`} "]) {
  test(`flags expression colors ${expression}`, () => {
    assert.equal(lint(`const x = <div className=${expression} />;`)[0].messageId, "hardcodedColor");
  });
}
test("flags arbitrary radius and permits shape variables", () => {
  assert.equal(lint('const x = <div className={"rounded-[28px]"} />;')[0].messageId, "arbitraryRadius");
  assert.equal(lint('const x = <div className="rounded-[var(--md-shape-extra-large)]" />;').length, 0);
  assert.equal(lint('// md3-allow: custom geometry\nconst x = <div className="rounded-[28px]" />;').length, 0);
});
