#!/usr/bin/env node
/**
 * Canonical Product Documentation Validator
 * Validates YAML frontmatter, markdown sections, unique IDs, cross-references, and allowlisted actions.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(REPO_ROOT, "docs", "product");
const REGISTERED_ACTIONS_PATH = path.join(REPO_ROOT, "src", "features", "help", "registeredHelpActions.ts");

export const VALID_DOMAINS = new Set([
  "reading",
  "imports",
  "queue",
  "scheduling",
  "review",
  "language",
  "tts",
  "ai",
  "media",
  "platform",
  "search",
  "settings",
  "concepts",
  "troubleshooting",
]);

export const VALID_STATUSES = new Set([
  "implemented",
  "partial",
  "experimental",
  "deprecated",
  "planned",
]);

export const VALID_PLATFORMS = new Set([
  "desktop-macos",
  "desktop-windows",
  "desktop-linux",
  "mobile-android",
  "mobile-ios",
  "eink",
  "pwa",
  "all",
]);

export const REQUIRED_FRONTMATTER_FIELDS = [
  "id",
  "title",
  "domain",
  "status",
  "platforms",
  "summary",
  "how_to",
  "why",
  "aliases",
  "settings",
  "actions",
  "related",
];

export const REQUIRED_SECTIONS = [
  "Purpose",
  "User-Facing Behavior",
  "Exact Behavioral Rules",
  "Rationale",
];

/**
 * Parses simple YAML-subset frontmatter between --- lines without heavy dependencies.
 */
export function parseFrontmatter(rawContent) {
  const trimmed = rawContent.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: null, body: rawContent, error: "Missing frontmatter delimiter '---'" };
  }

  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: null, body: rawContent, error: "Unterminated frontmatter delimiter" };
  }

  const rawYaml = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 4).trim();
  const frontmatter = {};

  const lines = rawYaml.split("\n");
  let currentKey = null;
  let currentArray = null;
  let currentObjectArray = null;
  let currentObject = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;

    // Check for array item with object fields (e.g. actions: - id: ... label: ...)
    if (line.match(/^\s+-\s+id:\s*(.*)$/)) {
      const match = line.match(/^\s+-\s+id:\s*(.*)$/);
      if (currentObjectArray) {
        currentObject = { id: match[1].trim().replace(/^["']|["']$/g, "") };
        currentObjectArray.push(currentObject);
      }
      continue;
    }

    if (currentObject && line.match(/^\s+(label|shortcut):\s*(.*)$/)) {
      const match = line.match(/^\s+(label|shortcut):\s*(.*)$/);
      currentObject[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
      continue;
    }

    // Check for simple array item (e.g. - item)
    if (line.match(/^\s*-\s+(.*)$/)) {
      const item = line.match(/^\s*-\s+(.*)$/)[1].trim().replace(/^["']|["']$/g, "");
      if (currentArray) {
        currentArray.push(item);
      }
      continue;
    }

    // Check for top-level key
    const keyMatch = line.match(/^([a-z0-9_]+):\s*(.*)$/i);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const val = keyMatch[2].trim();
      currentObject = null;

      if (val === "" || val === "[]") {
        if (currentKey === "actions") {
          currentObjectArray = [];
          frontmatter[currentKey] = currentObjectArray;
          currentArray = null;
        } else {
          currentArray = [];
          frontmatter[currentKey] = currentArray;
          currentObjectArray = null;
        }
      } else if (val.startsWith("[") && val.endsWith("]")) {
        const inner = val.slice(1, -1).trim();
        frontmatter[currentKey] = inner
          ? inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""))
          : [];
        currentArray = null;
        currentObjectArray = null;
      } else {
        frontmatter[currentKey] = val.replace(/^["']|["']$/g, "");
        currentArray = null;
        currentObjectArray = null;
      }
    }
  }

  return { frontmatter, body, error: null };
}

/**
 * Loads allowlisted actions from registeredHelpActions.ts
 */
export function extractAllowlistedActions(sourceCode) {
  const actions = new Set();
  const regex = /"([a-z0-9_.]+)"\s*:\s*\{/g;
  let match;
  while ((match = regex.exec(sourceCode)) !== null) {
    actions.add(match[1]);
  }
  return actions;
}

/**
 * Validates a single product doc markdown file.
 */
export function validateDocFile(filePath, rawContent, allowlistedActions = new Set()) {
  const errors = [];
  const warnings = [];

  const { frontmatter, body, error } = parseFrontmatter(rawContent);
  if (error || !frontmatter) {
    errors.push(`Frontmatter error: ${error}`);
    return { ok: false, errors, warnings, frontmatter: null };
  }

  // 1. Required fields
  for (const field of REQUIRED_FRONTMATTER_FIELDS) {
    if (frontmatter[field] === undefined || frontmatter[field] === null || frontmatter[field] === "") {
      errors.push(`Missing required frontmatter field: '${field}'`);
    }
  }

  // 2. ID validation
  if (frontmatter.id) {
    if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(frontmatter.id)) {
      errors.push(`Invalid ID format '${frontmatter.id}'. Must match 'domain.subdomain.feature' pattern.`);
    }
  }

  // 3. Domain validation
  if (frontmatter.domain && !VALID_DOMAINS.has(frontmatter.domain)) {
    errors.push(`Invalid domain '${frontmatter.domain}'. Allowed: ${Array.from(VALID_DOMAINS).join(", ")}`);
  }

  // 4. Status validation
  if (frontmatter.status && !VALID_STATUSES.has(frontmatter.status)) {
    errors.push(`Invalid status '${frontmatter.status}'. Allowed: ${Array.from(VALID_STATUSES).join(", ")}`);
  }

  // 5. Platforms validation
  if (Array.isArray(frontmatter.platforms)) {
    if (frontmatter.platforms.length === 0) {
      errors.push("Platforms array must contain at least one target platform.");
    }
    for (const p of frontmatter.platforms) {
      if (!VALID_PLATFORMS.has(p)) {
        errors.push(`Invalid platform '${p}'. Allowed: ${Array.from(VALID_PLATFORMS).join(", ")}`);
      }
    }
  } else if (frontmatter.platforms !== undefined) {
    errors.push("Platforms must be an array of strings.");
  }

  // 6. Summary / How-to / Why length checks
  if (typeof frontmatter.summary === "string" && frontmatter.summary.length < 10) {
    errors.push("Field 'summary' must be at least 10 characters.");
  }
  if (typeof frontmatter.how_to === "string" && frontmatter.how_to.length < 10) {
    errors.push("Field 'how_to' must be at least 10 characters.");
  }
  if (typeof frontmatter.why === "string" && frontmatter.why.length < 10) {
    errors.push("Field 'why' must be at least 10 characters.");
  }

  // 7. Actions allowlist check
  if (Array.isArray(frontmatter.actions)) {
    for (const action of frontmatter.actions) {
      if (!action.id || !action.label) {
        errors.push("Every action must have both 'id' and 'label' properties.");
        continue;
      }
      if (allowlistedActions.size > 0 && !allowlistedActions.has(action.id)) {
        errors.push(`Unregistered action ID '${action.id}' in actions list. Must be registered in registeredHelpActions.ts`);
      }
    }
  }

  // 8. Markdown Sections check
  for (const sec of REQUIRED_SECTIONS) {
    const secRegex = new RegExp(`^##\\s+${sec}\\b`, "im");
    if (!secRegex.test(body)) {
      errors.push(`Missing required markdown section '## ${sec}'`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    frontmatter,
    body,
  };
}

/**
 * Finds all markdown files recursively in a directory.
 */
export function findMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Validates the entire docs corpus.
 */
export function validateDocCorpus(docsDir = DOCS_DIR, registeredActionsPath = REGISTERED_ACTIONS_PATH) {
  const results = {
    totalFiles: 0,
    validFiles: 0,
    errorsCount: 0,
    duplicateIds: [],
    brokenReferences: [],
    fileResults: new Map(),
    allDocIds: new Set(),
  };

  let allowlistedActions = new Set();
  if (fs.existsSync(registeredActionsPath)) {
    const src = fs.readFileSync(registeredActionsPath, "utf8");
    allowlistedActions = extractAllowlistedActions(src);
  }

  const files = findMarkdownFiles(docsDir);
  results.totalFiles = files.length;

  const docMap = new Map();

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const res = validateDocFile(file, content, allowlistedActions);
    results.fileResults.set(file, res);

    if (res.frontmatter?.id) {
      if (docMap.has(res.frontmatter.id)) {
        results.duplicateIds.push({
          id: res.frontmatter.id,
          firstFile: docMap.get(res.frontmatter.id),
          secondFile: file,
        });
      } else {
        docMap.set(res.frontmatter.id, file);
        results.allDocIds.add(res.frontmatter.id);
      }
    }

    if (res.ok) {
      results.validFiles++;
    } else {
      results.errorsCount += res.errors.length;
    }
  }

  // Cross-reference checking for related IDs
  for (const [file, res] of results.fileResults.entries()) {
    if (res.frontmatter?.related && Array.isArray(res.frontmatter.related)) {
      for (const relId of res.frontmatter.related) {
        if (!results.allDocIds.has(relId)) {
          results.brokenReferences.push({
            file,
            target: relId,
            reason: `Referenced related feature ID '${relId}' does not exist in documentation corpus`,
          });
          results.errorsCount++;
        }
      }
    }
  }

  return results;
}

// CLI Execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("Validating canonical product documentation in docs/product/ ...");
  const results = validateDocCorpus();

  console.log(`\nInspected ${results.totalFiles} documentation files.`);
  let hasErrors = false;

  for (const [file, res] of results.fileResults.entries()) {
    if (!res.ok) {
      hasErrors = true;
      console.error(`\n❌ Error in ${path.relative(REPO_ROOT, file)}:`);
      for (const err of res.errors) {
        console.error(`  - ${err}`);
      }
    }
  }

  if (results.duplicateIds.length > 0) {
    hasErrors = true;
    console.error("\n❌ Duplicate Feature IDs Detected:");
    for (const dup of results.duplicateIds) {
      console.error(`  - ID '${dup.id}' used in both:\n      1) ${dup.firstFile}\n      2) ${dup.secondFile}`);
    }
  }

  if (results.brokenReferences.length > 0) {
    hasErrors = true;
    console.error("\n❌ Broken Cross-References Detected:");
    for (const ref of results.brokenReferences) {
      console.error(`  - ${path.relative(REPO_ROOT, ref.file)} -> ${ref.target}: ${ref.reason}`);
    }
  }

  if (hasErrors || results.errorsCount > 0) {
    console.error(`\nValidation FAILED with ${results.errorsCount + results.duplicateIds.length} error(s).`);
    process.exit(1);
  } else {
    console.log(`✅ All ${results.totalFiles} product documentation files passed validation with 0 errors.`);
    process.exit(0);
  }
}
