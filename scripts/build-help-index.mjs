#!/usr/bin/env node
/**
 * Canonical Help Index Builder
 * Parses docs/product/, creates structured search chunks with metadata,
 * computes corpus SHA-256 hash, and generates bundled index files.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, findMarkdownFiles } from "./docs-validate.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(REPO_ROOT, "docs", "product");
const OUTPUT_ROOT_HELP = path.join(REPO_ROOT, ".help", "index.json");
const OUTPUT_SRC_HELP_JSON = path.join(REPO_ROOT, "src", "features", "help", "generated", "helpIndex.json");
const OUTPUT_SRC_HELP_TS = path.join(REPO_ROOT, "src", "features", "help", "generated", "helpIndexData.ts");

/**
 * Extracts markdown section bodies by header name (## Header).
 */
export function extractSections(body) {
  const sections = {};
  const lines = body.split("\n");
  let currentSection = "intro";
  let currentLines = [];

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.*)$/);
    if (headerMatch) {
      if (currentLines.length > 0) {
        sections[currentSection] = currentLines.join("\n").trim();
      }
      currentSection = headerMatch[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections[currentSection] = currentLines.join("\n").trim();
  }

  return sections;
}

/**
 * Generates search chunks for a single document.
 */
export function generateDocChunks(doc) {
  const chunks = [];
  const relativePath = doc.filePath.replace(/\\/g, "/");

  // Chunk 1: Summary / How-to / Why (Primary Overview)
  const summaryText = [
    `Title: ${doc.title}`,
    `Domain: ${doc.domain}`,
    `Summary: ${doc.summary}`,
    `How to use: ${doc.how_to}`,
    `Rationale: ${doc.why}`,
    doc.aliases?.length ? `Aliases: ${doc.aliases.join(", ")}` : "",
    doc.settings?.length ? `Settings: ${doc.settings.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  chunks.push({
    id: `${doc.id}#summary`,
    docId: doc.id,
    title: doc.title,
    domain: doc.domain,
    section: "Summary & How-To",
    content: summaryText,
    aliases: doc.aliases || [],
    tags: [doc.domain, ...(doc.settings || []), ...(doc.aliases || [])],
    platforms: doc.platforms || ["all"],
    actions: doc.actions || [],
    filePath: relativePath,
  });

  // Chunk 2: Behavioral Rules
  const rules = doc.sections["Exact Behavioral Rules"] || doc.sections["Behavioral Rules"];
  if (rules) {
    chunks.push({
      id: `${doc.id}#rules`,
      docId: doc.id,
      title: `${doc.title} › Behavioral Rules`,
      domain: doc.domain,
      section: "Exact Behavioral Rules",
      content: rules,
      aliases: doc.aliases || [],
      tags: [doc.domain, "rules"],
      platforms: doc.platforms || ["all"],
      actions: doc.actions || [],
      filePath: relativePath,
    });
  }

  // Chunk 3: Rationale / Concept explanation
  const rationale = doc.sections["Rationale"] || doc.sections["Purpose"];
  if (rationale && rationale !== doc.why) {
    chunks.push({
      id: `${doc.id}#rationale`,
      docId: doc.id,
      title: `${doc.title} › Purpose & Rationale`,
      domain: doc.domain,
      section: "Rationale",
      content: rationale,
      aliases: doc.aliases || [],
      tags: [doc.domain, "rationale", "why"],
      platforms: doc.platforms || ["all"],
      actions: doc.actions || [],
      filePath: relativePath,
    });
  }

  // Chunk 4: Troubleshooting / Failure Modes
  const troubleshooting =
    doc.sections["Failure Modes & Troubleshooting"] ||
    doc.sections["Troubleshooting"] ||
    doc.sections["Edge Cases & Limitations"];
  if (troubleshooting) {
    chunks.push({
      id: `${doc.id}#troubleshooting`,
      docId: doc.id,
      title: `${doc.title} › Troubleshooting`,
      domain: doc.domain,
      section: "Troubleshooting",
      content: troubleshooting,
      aliases: doc.aliases || [],
      tags: [doc.domain, "troubleshooting", "errors"],
      platforms: doc.platforms || ["all"],
      actions: doc.actions || [],
      filePath: relativePath,
    });
  }

  return chunks;
}

/**
 * Builds the complete help index from documentation files.
 */
export function buildHelpIndex(docsDir = DOCS_DIR) {
  const mdFiles = findMarkdownFiles(docsDir);
  const docs = [];
  const chunks = [];
  const aliasMap = {};
  const hash = crypto.createHash("sha256");

  // Sort files for deterministic hashing and output
  mdFiles.sort();

  for (const file of mdFiles) {
    const raw = fs.readFileSync(file, "utf8");
    hash.update(raw);

    const { frontmatter, body } = parseFrontmatter(raw);
    if (!frontmatter || !frontmatter.id) continue;

    const sections = extractSections(body);
    const relPath = path.relative(REPO_ROOT, file).replace(/\\/g, "/");

    const docEntry = {
      ...frontmatter,
      filePath: relPath,
      sections,
    };

    docs.push(docEntry);

    // Build alias map
    if (frontmatter.title) {
      aliasMap[frontmatter.title.toLowerCase().trim()] = frontmatter.id;
    }
    if (Array.isArray(frontmatter.aliases)) {
      for (const alias of frontmatter.aliases) {
        aliasMap[alias.toLowerCase().trim()] = frontmatter.id;
      }
    }

    const docChunks = generateDocChunks(docEntry);
    chunks.push(...docChunks);
  }

  const corpusHash = `sha256:${hash.digest("hex")}`;

  return {
    version: "1.0.0",
    corpusHash,
    generatedAt: new Date().toISOString(),
    totalDocs: docs.length,
    totalChunks: chunks.length,
    aliasMap,
    docs,
    chunks,
  };
}

// CLI Execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("Building pre-indexed canonical help knowledge bundle ...");
  const index = buildHelpIndex();

  const jsonStr = JSON.stringify(index, null, 2);
  const tsContent = `// Auto-generated by scripts/build-help-index.mjs - DO NOT EDIT MANUALLY\nimport type { ProductDocArticle, HelpDocChunk } from "../helpTypes";\n\nexport interface GeneratedHelpIndex {\n  version: string;\n  corpusHash: string;\n  generatedAt: string;\n  totalDocs: number;\n  totalChunks: number;\n  aliasMap: Record<string, string>;\n  docs: ProductDocArticle[];\n  chunks: HelpDocChunk[];\n}\n\nexport const BUNDLED_HELP_INDEX: GeneratedHelpIndex = ${jsonStr} as GeneratedHelpIndex;\nexport default BUNDLED_HELP_INDEX;\n`;

  fs.mkdirSync(path.dirname(OUTPUT_ROOT_HELP), { recursive: true });
  fs.mkdirSync(path.dirname(OUTPUT_SRC_HELP_JSON), { recursive: true });

  fs.writeFileSync(OUTPUT_ROOT_HELP, jsonStr, "utf8");
  fs.writeFileSync(OUTPUT_SRC_HELP_JSON, jsonStr, "utf8");
  fs.writeFileSync(OUTPUT_SRC_HELP_TS, tsContent, "utf8");

  const sizeKb = (Buffer.byteLength(jsonStr, "utf8") / 1024).toFixed(1);
  console.log(`\n======================================================`);
  console.log(`HELP INDEX GENERATION COMPLETE`);
  console.log(`======================================================`);
  console.log(`Indexed Documents:   ${index.totalDocs}`);
  console.log(`Search Chunks:       ${index.totalChunks}`);
  console.log(`Indexed Aliases:     ${Object.keys(index.aliasMap).length}`);
  console.log(`Corpus SHA-256:      ${index.corpusHash.slice(0, 19)}...`);
  console.log(`Bundle Size:         ${sizeKb} KB (Budget: <3,000 KB)`);
  console.log(`Outputs:`);
  console.log(`  - ${path.relative(REPO_ROOT, OUTPUT_ROOT_HELP)}`);
  console.log(`  - ${path.relative(REPO_ROOT, OUTPUT_SRC_HELP_JSON)}`);
  console.log(`  - ${path.relative(REPO_ROOT, OUTPUT_SRC_HELP_TS)}`);
  console.log(`======================================================\n`);
}
