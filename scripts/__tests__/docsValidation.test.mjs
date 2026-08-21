/**
 * Unit tests for Canonical Documentation Validation Tooling (scripts/docs-validate.mjs)
 * Run with `npm run test:scripts`
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFrontmatter,
  validateDocFile,
  extractAllowlistedActions,
} from "../docs-validate.mjs";

const VALID_SAMPLE_DOC = `---
id: tts.word_highlighting
title: TTS Word Highlighting
domain: tts
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Synchronizes real-time text highlight with spoken audio words across readers.
how_to: Open any document and click the TTS Play button in the reader header or press Alt+P.
why: Dual-coding cognitive reinforcement maintains visual focus during fast listening.
aliases:
  - audio karaoke
  - read aloud highlight
settings:
  - tts.highlightSpokenWord
actions:
  - id: settings.tts.highlighting
    label: Open TTS Settings
related:
  - tts.playback
---

# TTS Word Highlighting

## Purpose
Explains spoken word visual feedback during playback.

## User-Facing Behavior
As speech plays, each word is highlighted with high-contrast indicator.

## Exact Behavioral Rules
1. Highlights current word based on timestamp events.
2. Scrolls viewport smoothly to keep active sentence visible.

## Rationale
Prevents loss of reading place and enhances comprehension.
`;

const ALLOWLISTED_ACTIONS = new Set([
  "settings.tts.highlighting",
  "settings.appearance.eink",
  "action.reader.toggle_tts",
]);

test("valid canonical documentation file passes all validation checks", () => {
  const res = validateDocFile("docs/product/tts/word-highlighting.md", VALID_SAMPLE_DOC, ALLOWLISTED_ACTIONS);
  assert.equal(res.ok, true, `Validation failed with errors: ${res.errors.join(", ")}`);
  assert.equal(res.errors.length, 0);
  assert.equal(res.frontmatter.id, "tts.word_highlighting");
  assert.equal(res.frontmatter.domain, "tts");
  assert.equal(res.frontmatter.actions.length, 1);
  assert.equal(res.frontmatter.actions[0].id, "settings.tts.highlighting");
});

test("missing frontmatter delimiter is detected as error", () => {
  const badDoc = VALID_SAMPLE_DOC.replace(/^---/, "");
  const res = validateDocFile("test.md", badDoc, ALLOWLISTED_ACTIONS);
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /Frontmatter error/);
});

test("missing required frontmatter fields (e.g. why, how_to) are caught", () => {
  const badDoc = VALID_SAMPLE_DOC.replace(/why: .*\n/, "");
  const res = validateDocFile("test.md", badDoc, ALLOWLISTED_ACTIONS);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("Missing required frontmatter field: 'why'")));
});

test("invalid hierarchical feature ID format is rejected", () => {
  const badDoc = VALID_SAMPLE_DOC.replace("id: tts.word_highlighting", "id: INVALID_ID");
  const res = validateDocFile("test.md", badDoc, ALLOWLISTED_ACTIONS);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("Invalid ID format")));
});

test("invalid product domain is rejected", () => {
  const badDoc = VALID_SAMPLE_DOC.replace("domain: tts", "domain: cryptocurrency");
  const res = validateDocFile("test.md", badDoc, ALLOWLISTED_ACTIONS);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("Invalid domain 'cryptocurrency'")));
});

test("invalid target platform is rejected", () => {
  const badDoc = VALID_SAMPLE_DOC.replace("desktop-macos", "symbian-os");
  const res = validateDocFile("test.md", badDoc, ALLOWLISTED_ACTIONS);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("Invalid platform 'symbian-os'")));
});

test("unallowlisted safe action ID is rejected", () => {
  const badDoc = VALID_SAMPLE_DOC.replace("settings.tts.highlighting", "system.format_hard_drive");
  const res = validateDocFile("test.md", badDoc, ALLOWLISTED_ACTIONS);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("Unregistered action ID 'system.format_hard_drive'")));
});

test("missing required markdown sections (e.g. ## Rationale) are caught", () => {
  const badDoc = VALID_SAMPLE_DOC.replace("## Rationale", "## Random Thoughts");
  const res = validateDocFile("test.md", badDoc, ALLOWLISTED_ACTIONS);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("Missing required markdown section '## Rationale'")));
});

test("extractAllowlistedActions correctly parses registered actions from TypeScript file", () => {
  const mockTs = `
export const REGISTERED_HELP_ACTIONS = {
  "settings.appearance.eink": { label: "E-ink" },
  "action.reader.toggle_tts": { label: "TTS" },
} as const;
  `;
  const actions = extractAllowlistedActions(mockTs);
  assert.equal(actions.has("settings.appearance.eink"), true);
  assert.equal(actions.has("action.reader.toggle_tts"), true);
  assert.equal(actions.has("nonexistent.action"), false);
});
