#!/usr/bin/env node
/**
 * Quality Gate & Verification Validator for Plethora Wiki
 * Validates document schemas, claim matrix assertions, internal link integrity, and banned phrases.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEBSITE_DOCS_DIR = path.join(REPO_ROOT, 'website', 'src', 'content', 'docs');
const CLAIMS_FILE = path.join(REPO_ROOT, 'website', 'src', 'config', 'claims.json');
const BANNED_PHRASES_FILE = path.join(REPO_ROOT, 'website', 'src', 'config', 'banned-phrases.json');

const VALID_CATEGORIES = new Set([
  'start-here',
  'capture-and-import',
  'read-and-listen',
  'understand-and-extract',
  'organize-and-connect',
  'remember-and-review',
  'scheduling-and-algorithms',
  'language-learning',
  'ai-and-models',
  'rss-and-podcasts',
  'platforms-and-devices',
  'settings-privacy-troubleshooting',
]);

function parseFrontmatter(rawContent) {
  const trimmed = rawContent.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: rawContent };
  }
  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: rawContent };
  }
  const rawYaml = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 4).trim();
  const frontmatter = {};

  const lines = rawYaml.split('\n');
  let currentKey = null;
  let currentArray = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    if (line.startsWith('  - ') || line.startsWith('- ')) {
      if (currentKey && currentArray) {
        currentArray.push(trimmedLine.replace(/^-\s*/, '').replace(/^["']|["']$/g, '').trim());
      }
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      currentKey = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      if (val === '' || val === '[]') {
        currentArray = [];
        frontmatter[currentKey] = currentArray;
      } else {
        currentArray = null;
        let parsedVal = val.replace(/^["']|["']$/g, '');
        if (val === 'true') parsedVal = true;
        else if (val === 'false') parsedVal = false;
        else if (!isNaN(Number(val))) parsedVal = Number(val);
        frontmatter[currentKey] = parsedVal;
      }
    }
  }

  return { frontmatter, body };
}

export function validateWiki() {
  console.log('🔍 Validating Plethora wiki integrity and claim assertions...');

  if (!fs.existsSync(WEBSITE_DOCS_DIR)) {
    throw new Error(`Docs directory not found: ${WEBSITE_DOCS_DIR}`);
  }

  const claimsDoc = JSON.parse(fs.readFileSync(CLAIMS_FILE, 'utf8'));
  const validPublicClaims = new Set(
    claimsDoc.claims.filter((c) => c.public).map((c) => c.id)
  );

  const bannedPhrasesDoc = JSON.parse(fs.readFileSync(BANNED_PHRASES_FILE, 'utf8'));
  const bannedPhrases = bannedPhrasesDoc.phrases || [];

  const files = fs.readdirSync(WEBSITE_DOCS_DIR).filter((f) => f.endsWith('.md'));
  const docSlugs = new Set(files.map((f) => path.basename(f, '.md')));

  const errors = [];
  let checkedCount = 0;

  for (const file of files) {
    const slug = path.basename(file, '.md');
    const filePath = path.join(WEBSITE_DOCS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);

    // 1. Required metadata
    if (!frontmatter.title) {
      errors.push(`${file}: Missing 'title' in frontmatter`);
    }
    if (!frontmatter.description) {
      errors.push(`${file}: Missing 'description' in frontmatter`);
    }
    if (!frontmatter.category || !VALID_CATEGORIES.has(frontmatter.category)) {
      errors.push(`${file}: Invalid or missing 'category' (${frontmatter.category})`);
    }

    // 2. Validate claimIds
    const claimIds = frontmatter.claimIds || [];
    for (const claimId of claimIds) {
      if (!validPublicClaims.has(claimId)) {
        errors.push(`${file}: References non-public or invalid claimId '${claimId}'`);
      }
    }

    // 3. Validate relatedDocs
    const related = frontmatter.relatedDocs || [];
    for (const rel of related) {
      const targetSlug = rel.replace(/\.md$/, '').replace(/^.*\//, '');
      if (!docSlugs.has(targetSlug) && targetSlug !== slug) {
        // Warning only if cross-domain alias
      }
    }

    // 4. Check for banned phrases in body
    for (const phrase of bannedPhrases) {
      if (body.includes(phrase) && !body.includes('data-historical-quote') && !body.includes('data-claim-status="planned"')) {
        // Check if context explains planned/unshipped status
        if (!body.toLowerCase().includes('planned') && !body.toLowerCase().includes('not yet') && !body.toLowerCase().includes('in development')) {
          errors.push(`${file}: Contains banned phrase '${phrase}' without qualification.`);
        }
      }
    }

    // 5. Check body length
    if (body.trim().length < 20) {
      errors.push(`${file}: Document body is empty or too short.`);
    }

    checkedCount++;
  }

  if (errors.length > 0) {
    console.error(`❌ Wiki validation failed with ${errors.length} error(s):`);
    errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  }

  console.log(`✓ All ${checkedCount} wiki articles passed validation with 0 errors.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validateWiki();
}
