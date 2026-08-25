/**
 * Corpus provisioning for the memory benchmark (task 3.7).
 *
 * Populates `.bench/corpus/` from `scripts/memory-bench/corpus.json`:
 *   - generated items (the fixture PDFs) are produced deterministically;
 *   - file items (the demo EPUBs) are copied from their recorded source path;
 *     an EPUB source that is missing locally aborts with the exact remediation
 *     (this repo does not commit the EPUB binaries; demo/books/ is untracked).
 *
 * Every item is hash-verified before a run. On mismatch the harness refuses to
 * run and names the item plus both hashes, per the memory-benchmark-harness
 * spec ("Corpus mismatch stops the run").
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPdf } from "./generate-fixture-pdf.mjs";
import { buildEpub } from "./generate-fixture-epub.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the manifest file. */
export const CORPUS_MANIFEST_PATH = join(scriptDir, "corpus.json");

export function loadCorpusManifest() {
  return JSON.parse(readFileSync(CORPUS_MANIFEST_PATH, "utf8"));
}

export function sha256OfBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function sha256OfFile(path) {
  return sha256OfBuffer(readFileSync(path));
}

/**
 * Deterministic long-text fixture (task 4.1): the tts-cycles / edition-cycles
 * stages synthesize a deterministic VOLUME from this text (no network, no
 * paid providers). Purely procedural — identical on every machine.
 */
export function buildLongText({ paragraphs = 200, wordsPerSentence = 16 } = {}) {
  const subjects = ["memory", "footprint", "cache", "edition", "section", "reader", "webkit", "harness", "cycle", "settle"];
  const verbs = ["measures", "bounds", "retains", "evicts", "samples", "reports", "revoke", "converges", "monotonic", "attributes"];
  const objects = ["the process tree", "every section", "each cache entry", "the working set", "a bounded ring", "the baseline", "the ratchet", "an owned URL", "the soak tier", "the quiet app"];
  const lines = [];
  let state = 12345;
  const rand = () => {
    // xorshift32 — deterministic "randomness".
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
  for (let p = 0; p < paragraphs; p++) {
    const sentences = [];
    const sentenceCount = 3 + (rand() % 4);
    for (let s = 0; s < sentenceCount; s++) {
      const parts = [];
      const wordCount = wordsPerSentence - 4 + (rand() % 8);
      for (let w = 0; w < wordCount; w += 3) {
        parts.push(
          `${subjects[rand() % subjects.length]} ${verbs[rand() % verbs.length]} ${objects[rand() % objects.length]}`,
        );
      }
      sentences.push(`Paragraph ${p} sentence ${s}: ${parts.join(", ")}.`);
    }
    lines.push(sentences.join(" "));
  }
  return `${lines.join("\n\n")}\n`;
}

/**
 * Produce the bytes for one corpus item from its manifest source entry.
 * @returns {Buffer} the item's content
 */
export function renderCorpusItem(item) {
  const source = item.source;
  if (source.kind === "generated") {
    if (source.script === "generate-fixture-pdf.mjs") {
      const pdf = buildPdf({
        pages: source.pages ?? 3,
        label: source.label,
      });
      return Buffer.from(pdf, "ascii");
    }
    if (source.script === "generate-fixture-epub.mjs") {
      return Buffer.from(buildEpub({ chapters: source.chapters ?? 3, title: source.title }));
    }
    if (source.script === "corpus.js#long-text") {
      return Buffer.from(buildLongText({ paragraphs: source.paragraphs ?? 200 }), "utf8");
    }
    throw new Error(`unsupported generated corpus script: ${source.script}`);
  }
  if (source.kind === "file") {
    const srcPath = join(process.cwd(), source.path);
    if (!existsSync(srcPath)) {
      throw new Error(
        `corpus item source missing: ${srcPath} (${source.note ?? "see corpus.json"})`,
      );
    }
    return readFileSync(srcPath);
  }
  throw new Error(`unsupported corpus source kind: ${source.kind}`);
}

/**
 * Provision the corpus into `corpusDir`, verifying every hash.
 *
 * @param {object} options
 * @param {string} options.corpusDir - target directory (default .bench/corpus)
 * @param {string} options.repoRoot - repository root (for relative sources)
 * @returns {{ items: Record<string, string>, corpusDir: string }}
 *   item id -> file name, for the driver to hand the app via /manifest.
 */
export function provisionCorpus({ corpusDir = join(process.cwd(), ".bench", "corpus"), repoRoot = process.cwd() } = {}) {
  const manifest = loadCorpusManifest();
  mkdirSync(corpusDir, { recursive: true });

  const items = {};
  for (const [id, item] of Object.entries(manifest.items)) {
    const content = renderCorpusItem(item, { repoRoot });
    const actual = sha256OfBuffer(content);
    if (actual !== item.sha256) {
      throw new Error(
        `corpus hash mismatch for "${id}": generated ${actual} but manifest records ${item.sha256} — ` +
          `refusing to run (a mismatched corpus cannot be compared to a baseline)`,
      );
    }
    const target = join(corpusDir, item.fileName);
    writeFileSync(target, content);
    items[id] = item.fileName;
  }
  return { items, corpusDir };
}

/**
 * Verify an existing corpus against the manifest. Returns the item map, or
 * throws naming every mismatch.
 */
export function verifyCorpus({ corpusDir } = {}) {
  const manifest = loadCorpusManifest();
  const mismatches = [];
  const items = {};
  for (const [id, item] of Object.entries(manifest.items)) {
    const target = join(corpusDir, item.fileName);
    if (!existsSync(target)) {
      mismatches.push(`"${id}": missing ${target}`);
      continue;
    }
    const actual = sha256OfFile(target);
    if (actual !== item.sha256) {
      mismatches.push(`"${id}": file hash ${actual} but manifest records ${item.sha256}`);
      continue;
    }
    items[id] = item.fileName;
  }
  if (mismatches.length > 0) {
    throw new Error(
      `corpus verification failed:\n  ${mismatches.join("\n  ")}\n` +
        `run the provisioner (npm run bench:memory -- --provision) to repair .bench/corpus/`,
    );
  }
  return { items, corpusDir };
}

// CLI: node corpus.js <corpusDir> [--repo-root <root>]
const isCli = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const corpusDir = process.argv[2] ?? join(process.cwd(), ".bench", "corpus");
  const repoRootArg = process.argv.indexOf("--repo-root");
  const repoRoot = repoRootArg >= 0 ? process.argv[repoRootArg + 1] : process.cwd();
  try {
    const result = provisionCorpus({ corpusDir, repoRoot });
    for (const [id, fileName] of Object.entries(result.items)) {
      console.log(`${id} -> ${join(corpusDir, fileName)}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
