/**
 * Copy marketing/demo-library generated books into demo/ for capture.
 * Refuses unless MARKETING_SEED=1 so normal installs stay empty.
 *
 *   MARKETING_SEED=1 node scripts/marketing/seed-demo-library.mjs
 *   MARKETING_SEED=1 node scripts/marketing/seed-demo-library.mjs --reset
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCorpus } from "./build-corpus.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DEMO = join(ROOT, "demo");
const GEN = join(ROOT, "marketing/demo-library/generated");
const LIB_JSON = join(ROOT, "marketing/demo-library/library.json");

function assertFlag() {
  if (process.env.MARKETING_SEED !== "1") {
    console.error("Refusing to write demo/: set MARKETING_SEED=1 (normal installs must stay unchanged).");
    process.exit(1);
  }
}

function resetSeededDemo() {
  for (const rel of ["books", "apkg", "audio"]) {
    const dir = join(DEMO, rel);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  rmSync(join(DEMO, ".marketing-seed.json"), { force: true });
}

function seed() {
  buildCorpus();
  mkdirSync(join(DEMO, "books"), { recursive: true });
  mkdirSync(join(DEMO, "apkg"), { recursive: true });
  mkdirSync(join(DEMO, "audio"), { recursive: true });

  const copies = [
    ["encoding-versus-highlighting.epub", "books"],
    ["william-james-habit-memory.epub", "books"],
    ["spaced-retrieval-methods.pdf", "books"],
    ["lecture-demo.wav", "audio"],
  ];
  for (const [name, dest] of copies) {
    const from = join(GEN, name);
    if (!existsSync(from)) {
      throw new Error(`Missing generated file ${from}`);
    }
    cpSync(from, join(DEMO, dest, name));
  }
  writeFileSync(
    join(DEMO, ".marketing-seed.json"),
    `${JSON.stringify(
      {
        storyId: "memory-sleep-cognition",
        seededAt: "2026-08-23T12:00:00.000Z",
        rngSeed: 1890,
        library: "marketing/demo-library/library.json",
        note: "Written only when MARKETING_SEED=1. Safe to delete; see scripts/marketing/README.md.",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(DEMO, "apkg", "README.marketing.txt"),
    "No .apkg in this seed. Cards live in marketing/demo-library (JSON). Do not add commercial decks.\n",
  );
}

assertFlag();
if (process.argv.includes("--reset")) {
  resetSeededDemo();
  console.log("Cleared demo/books, demo/apkg, demo/audio, demo/.marketing-seed.json");
}
if (!process.argv.includes("--reset-only")) {
  seed();
  console.log("Seeded demo/ from marketing/demo-library (MARKETING_SEED=1).");
  console.log("Library:", LIB_JSON);
}
