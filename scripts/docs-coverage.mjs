#!/usr/bin/env node
/**
 * Canonical Product Documentation Coverage Tool
 * Compares codebase features (Rust commands, Zustand stores, routes, palette actions, AI tasks)
 * against documented feature IDs in docs/product/.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDocCorpus } from "./docs-validate.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(REPO_ROOT, "docs", "product");

/**
 * Master inventory of core user-facing features mapped to their expected canonical doc ID.
 */
export const CORE_FEATURE_INVENTORY = [
  // 1. Reading & Viewers
  { id: "reader.pdf.page_mode", name: "PDF Page Mode Reader", domain: "reading", codeRefs: ["src/components/viewer/PDFViewer.tsx", "src/components/viewer/DocumentViewer.tsx"] },
  { id: "reader.pdf.scroll_mode", name: "PDF Continuous Scroll Reader", domain: "reading", codeRefs: ["src/components/viewer/PDFContinuousReader.tsx"] },
  { id: "reader.pdf.reflow", name: "PDF Reflow Engine", domain: "reading", codeRefs: ["src-tauri/src/commands/pdf_reflow.rs", "src/components/viewer/PDFReflowViewer.tsx"] },
  { id: "reader.epub.cfi", name: "EPUB Reader & CFI Tracking", domain: "reading", codeRefs: ["src/components/viewer/EPUBViewer.tsx", "src-tauri/src/commands/epub_server.rs"] },
  { id: "reader.html.article", name: "HTML Web Article Reader", domain: "reading", codeRefs: ["src/components/viewer/HTMLViewer.tsx"] },
  { id: "reader.markdown.native", name: "Native Markdown Reader", domain: "reading", codeRefs: ["src/components/viewer/MarkdownViewer.tsx"] },
  { id: "reader.video.transcript", name: "Video Transcript Sync", domain: "reading", codeRefs: ["src/components/viewer/VideoTranscriptViewer.tsx", "src/api/youtube.ts"] },
  { id: "reader.vim.navigation", name: "Vim Reading Navigation", domain: "reading", codeRefs: ["src/stores/vimModeStore.ts", "src/hooks/useVimReading.ts"] },
  { id: "reader.selection.actions", name: "Selection Action Bar", domain: "reading", codeRefs: ["src/components/viewer/SelectionActionBar.tsx"] },
  { id: "reader.position.restore", name: "Reading Position Persistence", domain: "reading", codeRefs: ["src-tauri/src/commands/position.rs", "src/hooks/usePositionPersistence.ts"] },

  // 2. Document Management & Ingestion
  { id: "import.local_files", name: "Multi-Format File Import", domain: "imports", codeRefs: ["src-tauri/src/commands/document.rs"] },
  { id: "import.url_scraping", name: "Web URL Article Ingestion", domain: "imports", codeRefs: ["src-tauri/src/commands/article_capture.rs", "src/hooks/useURLDetector.ts"] },
  { id: "import.arxiv", name: "ArXiv Paper Import", domain: "imports", codeRefs: ["src/utils/arxiv.ts", "src-tauri/src/commands/arxiv.rs"] },
  { id: "import.kindle", name: "Kindle Clippings Ingestion", domain: "imports", codeRefs: ["src-tauri/src/commands/kindle_clippings.rs", "src/components/import/KindleImportModal.tsx"] },
  { id: "import.anki_apkg", name: "Anki Deck Import (.apkg)", domain: "imports", codeRefs: ["src-tauri/src/commands/anki.rs"] },
  { id: "import.supermemo_zip", name: "SuperMemo XML/ZIP Import", domain: "imports", codeRefs: ["src-tauri/src/commands/supermemo_import.rs"] },
  { id: "import.browser_ext", name: "Browser Extension Bridge", domain: "imports", codeRefs: ["src-tauri/src/commands/browser_sync_server.rs"] },
  { id: "library.collection", name: "Collections & Folder Archives", domain: "imports", codeRefs: ["src/stores/collectionStore.ts", "src-tauri/src/commands/collection_archive.rs"] },

  // 3. Queue & Incremental Reading
  { id: "queue.scroll_session", name: "Composed Scroll Queue", domain: "queue", codeRefs: ["src/components/queue/QueueScrollPage.tsx", "src/utils/queueScrollBudget.ts"] },
  { id: "queue.composition", name: "Queue Composition Sliders", domain: "queue", codeRefs: ["src/stores/settingsStore.ts"] },
  { id: "queue.priority_score", name: "0-100 Priority Scoring", domain: "queue", codeRefs: ["src-tauri/src/commands/priority_queue.rs"] },
  { id: "queue.extract_chain", name: "Extract Chain & Inheritance", domain: "queue", codeRefs: ["src/stores/extractStore.ts"] },
  { id: "queue.extract_lifecycle", name: "Extract Lifecycle Actions", domain: "queue", codeRefs: ["src/stores/extractStore.ts"] },
  { id: "queue.neural_queue", name: "Neural Topic Queue", domain: "queue", codeRefs: ["src-tauri/src/commands/neural_queue.rs"] },
  { id: "queue.reappearance", name: "Reappearance Interval Rules", domain: "queue", codeRefs: ["src-tauri/src/commands/queue.rs"] },

  // 4. Scheduling & Algorithms
  { id: "scheduler.fsrs", name: "FSRS-6 Spaced Repetition", domain: "scheduling", codeRefs: ["src/utils/fsrsParameters.ts", "src-tauri/src/commands/fsrs.rs"] },
  { id: "scheduler.sm18", name: "SuperMemo 18 Algorithm (3D SInc)", domain: "scheduling", codeRefs: ["src-tauri/src/commands/sm18.rs", "src-tauri/src/commands/sm18_data.rs"] },
  { id: "scheduler.sm20.arena", name: "SM-20 Algorithm Arena", domain: "scheduling", codeRefs: ["src/components/review/ArenaChoiceRail.tsx"] },
  { id: "scheduler.sm20.postpone", name: "SM-20 Postpone Engine", domain: "scheduling", codeRefs: ["src-tauri/src/commands/postpone.rs"] },
  { id: "scheduler.scoped_params", name: "Scoped Retention Overrides", domain: "scheduling", codeRefs: ["src/utils/fsrsScope.ts"] },
  { id: "scheduler.load_balancing", name: "Queue Load Smoothing & Easy Days", domain: "scheduling", codeRefs: ["src/stores/reviewStore.ts"] },

  // 5. Review & Learning Items
  { id: "review.flashcard_studio", name: "Flashcard Studio (Q/A, Cloze)", domain: "review", codeRefs: ["src/components/review/FlashcardStudioModal.tsx", "src/lib/ai/cardValidator.ts"] },
  { id: "review.image_occlusion", name: "OCR Image Occlusion Editor", domain: "review", codeRefs: ["src/components/occlusion/OcclusionComposerHost.tsx"] },
  { id: "review.audio_review", name: "Hands-Free Audio Review", domain: "review", codeRefs: ["src/hooks/useTTS.ts"] },
  { id: "review.zen_mode", name: "Zen Fullscreen Review", domain: "review", codeRefs: ["src/components/review/ZenReviewMode.tsx"] },
  { id: "review.source_provenance", name: "Review Card Source Provenance", domain: "review", codeRefs: ["src/components/review/ReviewSourceContext.tsx"] },
  { id: "review.undo", name: "Review Rating Undo", domain: "review", codeRefs: ["src/stores/reviewUndoStore.ts"] },

  // 6. Language Learning System
  { id: "language.profiles", name: "Language Learning Profiles", domain: "language", codeRefs: ["src/stores/languageProfileStore.ts"] },
  { id: "language.vocabulary", name: "Lexical Coverage Highlighting", domain: "language", codeRefs: ["src/stores/languageKnowledgeStore.ts"] },
  { id: "language.dictionary_peek", name: "Dictionary Peek Card", domain: "language", codeRefs: ["src/components/language/DictionaryPeek.tsx"] },
  { id: "language.sentence_mining", name: "Sentence Mining & Cloze", domain: "language", codeRefs: ["src/components/language/SentenceModePanel.tsx"] },
  { id: "language.shadowing", name: "Shadowing & Pronunciation", domain: "language", codeRefs: ["src/components/language/ShadowingMode.tsx"] },

  // 7. Media, Audio & Neural TTS
  { id: "tts.playback", name: "Multi-Engine TTS (Pocket TTS, Sherpa)", domain: "tts", codeRefs: ["src/hooks/useTTS.ts", "src-tauri/src/commands/pocket_tts.rs"] },
  { id: "tts.word_highlighting", name: "TTS Word Highlighting", domain: "tts", codeRefs: ["src/components/viewer/ReaderTTSControls.tsx"] },
  { id: "tts.auto_scroll", name: "TTS Viewport Auto-Scroll", domain: "tts", codeRefs: ["src/components/viewer/ReaderTTSControls.tsx"] },
  { id: "tts.resume_position", name: "TTS Position Persistence", domain: "tts", codeRefs: ["src-tauri/src/commands/position.rs"] },
  { id: "audio.media_controls", name: "OS Media Keys / SMTC / MPRIS", domain: "tts", codeRefs: ["src-tauri/src/commands/media_control.rs"] },
  { id: "audio.hands_free_study", name: "Hands-Free Headphone Study", domain: "tts", codeRefs: ["src/stores/settingsStore.ts"] },
  { id: "audiobook.sync", name: "Audiobook EPUB Text Sync", domain: "tts", codeRefs: ["src/components/viewer/AudiobookViewer.tsx"] },

  // 8. AI Learning System & Tools
  { id: "ai.task_router", name: "Unified AI Task Router", domain: "ai", codeRefs: ["src/lib/ai/router.ts"] },
  { id: "ai.learn_this", name: "Learn This Flashcard Generation", domain: "ai", codeRefs: ["src/lib/ai/tasks/definitions/learnThisTask.ts"] },
  { id: "ai.library_rag", name: "Grounded Ask-Library RAG", domain: "ai", codeRefs: ["src/lib/ai/tasks/definitions/libraryTask.ts"] },
  { id: "ai.socratic_tutor", name: "Socratic Tutoring Sessions", domain: "ai", codeRefs: ["src/lib/ai/tasks/definitions/socraticTutor.ts"] },
  { id: "ai.active_recall", name: "Active Recall In-Reading Prompts", domain: "ai", codeRefs: ["src/lib/ai/tasks/definitions/recallQuestion.ts"] },
  { id: "ai.notebooklm", name: "NotebookLM Py AppImage Integration", domain: "ai", codeRefs: ["src-tauri/src/commands/notebooklm.rs", "src/features/documentQa/notebooklmResearch.ts"] },

  // 9. RSS & Podcasts
  { id: "rss.feed_reader", name: "Full-Text RSS Feed Reader", domain: "media", codeRefs: ["src-tauri/src/commands/rss.rs", "src/components/rss/RSSReaderView.tsx"] },
  { id: "rss.queue_integration", name: "RSS in Reading Queue", domain: "media", codeRefs: ["src/stores/settingsStore.ts"] },
  { id: "rss.semantic_learning", name: "Semantic Preference Learning", domain: "media", codeRefs: ["src-tauri/src/commands/rss_preferences.rs"] },
  { id: "podcast.whisper", name: "Podcast Search & Local Whisper", domain: "media", codeRefs: ["src-tauri/src/commands/podcast.rs"] },

  // 10. Platform Specifics & Display Modes
  { id: "platform.eink", name: "True E-Ink Monochrome Mode", domain: "platform", codeRefs: ["src/components/settings/EinkSettingsPanel.tsx", "src/contexts/ThemeContext.tsx"] },
  { id: "platform.mobile_android", name: "Android SAF / GenAI / TTS", domain: "platform", codeRefs: ["src/api/tts/android/bridge.ts"] },
  { id: "platform.desktop_native", name: "Desktop Native Window & Tray", domain: "platform", codeRefs: ["src-tauri/src/commands/tray.rs"] },
  { id: "platform.battery_saver", name: "Battery & Thermal Throttling", domain: "platform", codeRefs: ["src-tauri/src/commands/battery.rs"] },

  // 11. Search, Navigation & Command Palette
  { id: "palette.command_center", name: "Global CommandCenter (Cmd+K)", domain: "search", codeRefs: ["src/components/search/CommandCenter.tsx", "src/components/search/GlobalSearch.tsx"] },
  { id: "palette.contextual_actions", name: "Per-View Contextual Actions", domain: "search", codeRefs: ["src/commandPalette/contextualActions.ts"] },
  { id: "graph.knowledge_sphere", name: "3D Knowledge Sphere Graph", domain: "search", codeRefs: ["src/components/tabs/KnowledgeSphereTab.tsx"] },

  // 12. Settings, Appearance, Sync & Security
  { id: "settings.themes", name: "100+ Themes & Custom Fonts", domain: "settings", codeRefs: ["src/contexts/ThemeContext.tsx", "src/index.css"] },
  { id: "sync.yjs_cloud", name: "End-to-End Encrypted Cloud Sync", domain: "settings", codeRefs: ["src-tauri/src/commands/cloud_sync.rs"] },
  { id: "security.privacy_toggle", name: "AI Paid Billing Safety Gate", domain: "settings", codeRefs: ["src/lib/ai/aiBillingConsent.ts"] },
];

/**
 * Calculates documentation coverage against the inventoried features.
 */
export function calculateDocCoverage(docsDir = DOCS_DIR) {
  const corpus = validateDocCorpus(docsDir);
  const total = CORE_FEATURE_INVENTORY.length;
  let documented = 0;
  const missing = [];
  const covered = [];

  for (const feature of CORE_FEATURE_INVENTORY) {
    if (corpus.allDocIds.has(feature.id)) {
      documented++;
      covered.push(feature);
    } else {
      missing.push(feature);
    }
  }

  const coveragePercent = total > 0 ? (documented / total) * 100 : 0;

  return {
    total,
    documented,
    coveragePercent,
    missing,
    covered,
    corpusValidFiles: corpus.validFiles,
    corpusTotalFiles: corpus.totalFiles,
    corpusErrorsCount: corpus.errorsCount,
  };
}

// CLI Execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const thresholdArg = args.indexOf("--threshold");
  const threshold = thresholdArg !== -1 ? parseFloat(args[thresholdArg + 1]) : 95.0;

  console.log("Analyzing Plethora canonical product documentation coverage ...");
  const stats = calculateDocCoverage();

  console.log("\n=======================================================");
  console.log("PLETHORA PRODUCT DOCUMENTATION COVERAGE REPORT");
  console.log("=======================================================");
  console.log(`Inventoried Core Features:  ${stats.total}`);
  console.log(`Documented & Verified:      ${stats.documented} (${stats.coveragePercent.toFixed(1)}%)`);
  console.log(`Total Docs Files in Corpus:  ${stats.corpusTotalFiles}`);
  console.log(`Target Coverage Gate:        ${threshold.toFixed(1)}%`);
  console.log("=======================================================");

  if (stats.missing.length > 0) {
    console.log(`\n⚠️ Missing Canonical Documentation for ${stats.missing.length} feature(s):`);
    for (const m of stats.missing) {
      console.log(`  - [${m.id}] ${m.name} (${m.domain})`);
    }
  }

  if (stats.coveragePercent < threshold) {
    console.error(`\n❌ Documentation Coverage FAILED: ${stats.coveragePercent.toFixed(1)}% < ${threshold.toFixed(1)}% threshold.`);
    process.exit(1);
  } else {
    console.log(`\n✅ Documentation Coverage PASSED: ${stats.coveragePercent.toFixed(1)}% >= ${threshold.toFixed(1)}% threshold.`);
    process.exit(0);
  }
}
