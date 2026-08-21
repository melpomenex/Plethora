/**
 * Unit tests for Command Palette Intent Classifier (helpIntent.ts)
 * Tests 50+ diverse query fixtures across navigation, direct lookup, product help, and content search.
 */

import { describe, it, expect } from "vitest";
import { classifyPaletteInput } from "../helpIntent";

describe("classifyPaletteInput", () => {
  // 1. Explicit Prefixes (Forced Help Mode)
  const PREFIX_FIXTURES = [
    "? e-ink mode",
    "?how do I enable reflow",
    "? tts speed",
    "/help spaced repetition",
    "/help fsrs retention",
    "/help kindle clippings",
    "help: youtube transcript sync",
    "help: sentence mining",
    "help audio review mode",
    "help easy days",
  ];

  for (const query of PREFIX_FIXTURES) {
    it(`classifies explicit prefix query '${query}' as product_help with forcedPrefix=true`, () => {
      const res = classifyPaletteInput(query);
      expect(res.kind).toBe("product_help");
      if (res.kind === "product_help") {
        expect(res.forcedPrefix).toBe(true);
        expect(res.query.length).toBeGreaterThan(0);
      }
    });
  }

  // 2. Direct Canonical Alias Lookups (Zero-LLM Direct Answers)
  const DIRECT_ALIAS_FIXTURES = [
    { query: "e-ink mode", expectedId: "platform.eink" },
    { query: "sm18", expectedId: "scheduler.sm18" },
    { query: "read aloud", expectedId: "tts.playback" },
    { query: "pdf reflow", expectedId: "reader.pdf.reflow" },
    { query: "sentence mining", expectedId: "language.sentence_mining" },
    { query: "shadowing mode", expectedId: "language.shadowing" },
    { query: "audiobook sync", expectedId: "audiobook.sync" },
    { query: "web clipper", expectedId: "import.browser_ext" },
    { query: "kindle clippings", expectedId: "import.kindle" },
    { query: "easy days", expectedId: "scheduler.load_balancing" },
    { query: "socratic tutor", expectedId: "ai.socratic_tutor" },
    { query: "neural queue", expectedId: "queue.neural_queue" },
    { query: "zen mode", expectedId: "review.zen_mode" },
  ];

  for (const fixture of DIRECT_ALIAS_FIXTURES) {
    it(`classifies direct lookup query '${fixture.query}' as direct_lookup for ${fixture.expectedId}`, () => {
      const res = classifyPaletteInput(fixture.query);
      expect(res.kind).toBe("direct_lookup");
      if (res.kind === "direct_lookup") {
        expect(res.directResult.featureId).toBe(fixture.expectedId);
        expect(res.directResult.confidence).toBeGreaterThanOrEqual(0.92);
        expect(res.directResult.summary.length).toBeGreaterThan(10);
      }
    });
  }

  // 3. Natural Language Questions (Product Help)
  const NL_QUESTION_FIXTURES = [
    "how do I enable continuous scroll in PDF?",
    "how to adjust FSRS retention target?",
    "how can I import my Anki deck?",
    "what is the 3D SInc matrix in SM-18?",
    "what are the composition sliders in queue?",
    "where is the E-ink monochrome toggle?",
    "where can I find my reading goals?",
    "why is this queue item reappearing tomorrow?",
    "why did TTS audio pause at the chapter end?",
    "can Plethora transcribe podcasts offline?",
    "does Plethora support Apple Podcasts?",
    "explain incremental reading workflow",
    "tell me about active recall interruptions",
    "troubleshoot TTS not scrolling viewport",
    "fix e-ink ghosting on Onyx Boox",
  ];

  for (const query of NL_QUESTION_FIXTURES) {
    it(`classifies natural language question '${query}' as product_help`, () => {
      const res = classifyPaletteInput(query);
      expect(res.kind).toBe("product_help");
      if (res.kind === "product_help") {
        expect(res.forcedPrefix).toBe(false);
      }
    });
  }

  // 4. App Section Navigation
  const NAVIGATION_FIXTURES = [
    { query: "Dashboard", target: "/dashboard" },
    { query: "Queue", target: "/queue" },
    { query: "Settings", target: "/settings" },
    { query: "Analytics", target: "/analytics" },
    { query: "Documents", target: "/documents" },
  ];

  for (const fixture of NAVIGATION_FIXTURES) {
    it(`classifies navigation command '${fixture.query}' as navigation to ${fixture.target}`, () => {
      const res = classifyPaletteInput(fixture.query);
      expect(res.kind).toBe("navigation");
      if (res.kind === "navigation") {
        expect(res.targetPath).toBe(fixture.target);
      }
    });
  }

  // 5. General Document & Library Content Searches
  const CONTENT_SEARCH_FIXTURES = [
    "attention is all you need vaswani",
    "gradient descent learning rate decay",
    "mitochondria ATP synthesis cellular respiration",
    "french subjunctive conjugation irregular verbs",
    "quantum computing Shor algorithm qubits",
    "constitutional law commerce clause Supreme Court",
    "rust ownership borrow checker lifetime annotations",
    "neuroplasticity synaptic pruning long term potentiation",
  ];

  for (const query of CONTENT_SEARCH_FIXTURES) {
    it(`classifies content query '${query}' as document_content`, () => {
      const res = classifyPaletteInput(query);
      expect(res.kind).toBe("document_content");
      if (res.kind === "document_content") {
        expect(res.query).toBe(query);
      }
    });
  }
});
