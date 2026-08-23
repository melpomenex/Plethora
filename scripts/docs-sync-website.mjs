#!/usr/bin/env node
/**
 * Synchronizes and ingests canonical product documentation from docs/product/**
 * into the website Astro content collection at website/src/content/docs/**.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_PRODUCT_DIR = path.join(REPO_ROOT, 'docs', 'product');
const WEBSITE_DOCS_DIR = path.join(REPO_ROOT, 'website', 'src', 'content', 'docs');
const CLAIMS_FILE = path.join(REPO_ROOT, 'website', 'src', 'config', 'claims.json');

// Map canonical domain / folder names to the 12 public wiki categories
const DOMAIN_TO_CATEGORY = {
  concepts: 'start-here',
  reading: 'read-and-listen',
  imports: 'capture-and-import',
  queue: 'understand-and-extract',
  review: 'remember-and-review',
  scheduling: 'scheduling-and-algorithms',
  language: 'language-learning',
  ai: 'ai-and-models',
  media: 'rss-and-podcasts',
  platform: 'platforms-and-devices',
  settings: 'settings-privacy-troubleshooting',
  troubleshooting: 'settings-privacy-troubleshooting',
};

// Aliases for legacy documentation links
const LEGACY_ALIASES = {
  'getting-started': { category: 'start-here', order: 1 },
  'incremental-reading': { category: 'understand-and-extract', order: 2 },
  'reading-formats': { category: 'read-and-listen', order: 3 },
  'spaced-repetition': { category: 'scheduling-and-algorithms', order: 4 },
  'anki-packages': { category: 'capture-and-import', order: 5 },
  'local-library': { category: 'start-here', order: 6 },
};

function parseYamlFrontmatter(content) {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }
  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
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
        currentArray.push(trimmedLine.replace(/^-\s*/, '').trim());
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
        let parsedVal = val;
        if (val.startsWith('"') && val.endsWith('"')) {
          parsedVal = val.slice(1, -1);
        } else if (val === 'true') parsedVal = true;
        else if (val === 'false') parsedVal = false;
        else if (!isNaN(Number(val))) parsedVal = Number(val);
        frontmatter[currentKey] = parsedVal;
      }
    }
  }

  return { frontmatter, body };
}

function findMarkdownFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findMarkdownFiles(filePath));
    } else if (file.endsWith('.md')) {
      results.push(filePath);
    }
  }
  return results;
}

export function syncDocs() {
  console.log('🔄 Ingesting canonical documentation from docs/product/ to website...');

  if (fs.existsSync(WEBSITE_DOCS_DIR)) {
    const existing = fs.readdirSync(WEBSITE_DOCS_DIR);
    for (const f of existing) {
      if (f.endsWith('.md')) {
        fs.unlinkSync(path.join(WEBSITE_DOCS_DIR, f));
      }
    }
  } else {
    fs.mkdirSync(WEBSITE_DOCS_DIR, { recursive: true });
  }

  const files = findMarkdownFiles(DOCS_PRODUCT_DIR);
  let claimsDoc = { claims: [] };
  if (fs.existsSync(CLAIMS_FILE)) {
    claimsDoc = JSON.parse(fs.readFileSync(CLAIMS_FILE, 'utf8'));
  }
  const validClaimIds = new Set(claimsDoc.claims.map((c) => c.id));

  let syncedCount = 0;
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const { frontmatter, body } = parseYamlFrontmatter(raw);

    const relPath = path.relative(DOCS_PRODUCT_DIR, file);
    const domainFolder = relPath.split(path.sep)[1] || relPath.split(path.sep)[0];
    const slug = path.basename(file, '.md');
    const category = LEGACY_ALIASES[slug]?.category || DOMAIN_TO_CATEGORY[domainFolder] || 'start-here';

    // Filter unpublished documents
    if (frontmatter.published === false || frontmatter.status === 'deprecated') {
      continue;
    }

    const title = frontmatter.title || slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const description = frontmatter.summary || frontmatter.description || `${title} documentation for Plethora.`;
    const claimIds = (frontmatter.claimIds || []).filter((id) => validClaimIds.has(id));

    const enrichedFrontmatter = {
      title,
      description,
      category,
      order: LEGACY_ALIASES[slug]?.order ?? (typeof frontmatter.order === 'number' ? frontmatter.order : 100),
      published: true,
      featureStatus: frontmatter.status === 'planned' ? 'planned' : frontmatter.status === 'experimental' ? 'experimental' : 'shipping',
      platforms: frontmatter.platforms || ['all'],
      keywords: frontmatter.aliases || [],
      aliases: frontmatter.aliases || [],
      relatedDocs: frontmatter.related || [],
      owner: 'E',
      claimIds,
      sourcePath: `docs/product/${relPath.replace(/\\/g, '/')}`,
    };

    const frontmatterLines = [
      '---',
      `title: ${JSON.stringify(enrichedFrontmatter.title)}`,
      `description: ${JSON.stringify(enrichedFrontmatter.description)}`,
      `category: ${JSON.stringify(enrichedFrontmatter.category)}`,
      `order: ${enrichedFrontmatter.order}`,
      `published: true`,
      `featureStatus: ${JSON.stringify(enrichedFrontmatter.featureStatus)}`,
      `platforms: ${JSON.stringify(enrichedFrontmatter.platforms)}`,
      `keywords: ${JSON.stringify(enrichedFrontmatter.keywords)}`,
      `aliases: ${JSON.stringify(enrichedFrontmatter.aliases)}`,
      `relatedDocs: ${JSON.stringify(enrichedFrontmatter.relatedDocs)}`,
      `owner: "E"`,
      `claimIds: ${JSON.stringify(enrichedFrontmatter.claimIds)}`,
      `sourcePath: ${JSON.stringify(enrichedFrontmatter.sourcePath)}`,
      '---',
      '',
    ];

    const targetFile = path.join(WEBSITE_DOCS_DIR, `${slug}.md`);
    fs.writeFileSync(targetFile, frontmatterLines.join('\n') + body, 'utf8');
    syncedCount++;
  }

  console.log(`✓ Ingested and synchronized ${syncedCount} documentation articles.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncDocs();
}
