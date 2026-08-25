/**
 * FlashcardStudioModal - AI-Powered Flashcard Creation Studio
 * 
 * Best-in-class UX features:
 * - Immersive full-screen modal with glassmorphism effects
 * - Smart document selection with search and quick filters
 * - GRANULAR CONTEXT CONTROL: chapters, page ranges, text excerpts
 * - COST ESTIMATOR: see token usage before sending
 * - INTERACTIVE HIGHLIGHTING: select text directly to use as context
 * - MagnifyingGlass within document to find relevant sections quickly
 * - Interactive chat with markdown rendering and syntax highlighting
 * - Live card preview with flip animation
 * - Inline card editing for quick fixes
 * - Bulk operations with keyboard shortcuts
 * - Quick templates for common generation tasks
 * - Progress indicators and smooth transitions
 * - Smart tagging system with autocomplete
 * - TOC section selector with visual hierarchy
 */

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useLatexPreview } from "../../hooks/useLatexPreview";
import {
  AlignLeft,
  BookOpen,
  Brain,
  CaretRight,
  ChartBar,
  ChatCircle,
  Check,
  CheckCircle,
  CircleNotch,
  ClockCounterClockwise,
  Copy,
  DotsThree,
  CurrencyDollar,
  FloppyDisk,
  FolderOpen,
  FrameCorners,
  Funnel,
  Gear,
  Hash,
  Images,
  Lightbulb,
  Lightning,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Quotes,
  Sparkle,
  Tag,
  TextAa,
  TextT,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  createLearningItem,
  generateLearningItemsFromExtract,
  type CreateLearningItemInput,
} from "../../api/learning-items";
import { getExtracts, type Extract } from "../../api/extracts";
import { chatWithContext, type LLMMessage } from "../../api/llm";
import {
  notebooklmGenerateArtifact,
  notebooklmGetSettings,
  notebooklmListNotebooks,
  notebooklmPreviewFlashcards,
  notebooklmSelectNotebook,
  type NotebookSummary,
} from "../../api/integrations";
import { ingestImageFile, listImageAssets, type ImageAsset } from "../../api/image-registry";
import { modelSupportsImageInput, normalizeOcclusionRegions } from "../../utils/occlusionAI";
import { getVideoTranscript } from "../../api/video-extracts";
import { extractYouTubeID, fetchYouTubeTranscript } from "../../api/youtube";
import { renderMarkdown } from "../../utils/markdown";
import { useDocumentStore, useLLMProvidersStore, useSettingsStore, useStudyDeckStore } from "../../stores";
import { useToast } from "../common/Toast";
import { useI18n } from "../../lib/i18n";
import { isTauri, isMac } from "../../lib/tauri";
import { cn } from "../../utils";
import { buildChapterQAContext, getChapterTitles } from "../../utils/chapterUtils";
import { resolveFlashcardTarget, type FlashcardTargetOverride } from "../../utils/flashcardTarget";
import { generateFlashcardsWithRouter } from "../../lib/ai/generateFlashcardsRouter";
import {
  isCatalogOnDeviceProviderId,
  listAvailableOnDeviceProviders,
  type OnDeviceProviderOption,
} from "../../lib/ai/onDeviceProviderCatalog";
import { withOnDeviceRun } from "../../lib/ai/onDeviceRunStore";
import { ON_DEVICE_TAG } from "../../utils/aiExtractUtils";
import { NumericInput } from "../common";
import type { ImageOcclusionRegion, MultipleChoiceOption } from "../../types/learningItemInteractions";
import { OcclusionLightbox } from "../occlusion/OcclusionLightbox";
import { StudioOcclusionComposerLauncher } from "./studio/StudioOcclusionComposerLauncher";
import { ImageRegistryLibrary } from "../image-registry/ImageRegistryLibrary";
import { ExtractBrowserPanel } from "./ExtractBrowserPanel";
import { extractDocumentText, getDocument } from "../../api/documents";
import {
  buildTwentyRulesSystemPrompt,
  getTwentyRulesReminderMarkdown,
  isTwentyRulesCommand,
  stripTwentyRulesCommand,
  TWENTY_RULES_COMMAND,
  TWENTY_RULES_PROMPT_TEMPLATE,
} from "../../lib/ai/knowledgeFormulation";
import {
  migrateLegacyState,
  loadSessions,
  saveSessions,
  getSession,
  setActiveSessionId as persistActiveSessionId,
  createSession as createStudioSession,
  updateSession as updateStudioSession,
  deleteSession as deleteStudioSession,
  renameSession as renameStudioSession,
  type FlashcardStudioSession,
} from "./flashcardStudioSessions";
import { loadDocumentQaText, createDocumentQaRequestContent } from "../../features/documentQa/sectionContextRequest";
import { useDocumentSections } from "../../hooks/useDocumentSections";
import { SectionMentionPopup } from "../common/SectionMentionPopup";
import {
  buildSectionsSnapshot,
  describeSectionDiagnostic,
  type SectionNode,
  type SectionSourceReference,
} from "../../utils/sectionIndex";
import { useDocumentOutlineStore } from "../../stores/documentOutlineStore";
import { loadAudiobookSectionCatalog } from "../../features/documentQa/audiobookSectionCatalog";
import { useMobileShell } from "../../hooks/useMobileShell";
import { ContextControlPanel } from "./studio/ContextControlPanel";
import { DocumentSelector } from "./studio/DocumentSelector";
import { DeckSelector } from "./studio/DeckSelector";
import { StudioContextChipBar } from "./studio/StudioContextChipBar";
import { StudioSheets } from "./studio/StudioSheets";
import type { StudioSheet } from "./studio/studioChips";
import {
  mediaTranscriptContextText,
  preferredStudioDocumentContextText,
  resolveStudioSectionContext,
} from "./studio/mediaSectionContext";
import {
  CHARS_PER_TOKEN,
  DEFAULT_CONTEXT_SELECTION,
  estimateContextTokens,
  estimateTokens,
  formatTokenCount,
  normalizeContextSelection,
  type ContextSelection,
} from "./studio/contextSelection";

// Re-exported so existing importers (flashcardStudioSessions.ts and its test
// suites) keep resolving these from this module after the extraction.
export {
  DEFAULT_CONTEXT_SELECTION,
  normalizeContextSelection,
} from "./studio/contextSelection";
export type { ContextSelection } from "./studio/contextSelection";

/** Human-friendly label for a section (breadcrumb > title, or just title). Mirrors sectionIndex.sectionLabel. */
function sectionLabel(section: SectionNode): string {
  return section.breadcrumb.length > 0
    ? `${section.breadcrumb.join(" > ")} > ${section.title}`
    : section.title;
}

type DraftCardType = "qa" | "cloze" | "multiple-choice" | "image-occlusion";
type ViewMode = "chat" | "templates" | "history" | "sessions" | "extracts";

// Matches the Assistant's section-mention token form, e.g. `#{Introduction}`.
const SECTION_REGEX = /#{([^}]+)}/g;

export interface DraftCard {
  id: string;
  type: DraftCardType;
  question?: string;
  answer?: string;
  text?: string;
  multipleChoiceOptions?: MultipleChoiceOption[];
  multipleChoiceCorrectOptionId?: string;
  imageOcclusionAssetId?: string;
  imageOcclusionRegions?: ImageOcclusionRegion[];
  selected: boolean;
  sourceMessageId?: string;
  createdAt: number;
  isEditing?: boolean;
  tags: string[];
  /** Parent extract retained when a draft is created from an extract. */
  extractId?: string;
  /** If true, this card was already persisted to the DB (e.g. via generateLearningItemsFromExtract)
   *  and should NOT be re-created by handleSaveSelected. */
  alreadyPersisted?: boolean;
  /** The DB id of the already-persisted learning item (if alreadyPersisted). */
  persistedItemId?: string;
  /** Section provenance when the card was generated from a `#` section focus. */
  sourceContext?: SectionSourceReference;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  cardsGenerated?: number;
  tokensUsed?: number;
  /** Section provenance when the response was generated from a `#` section focus. */
  sourceContext?: SectionSourceReference;
}

interface FlashcardStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  seed?: FlashcardStudioSeed | null;
}

interface FlashcardStudioSeed {
  key: string;
  documentId?: string | null;
  excerpt?: string;
  draftCardType?: DraftCardType;
  imageAssetId?: string;
  resetDraftCards?: boolean;
  autoEditDraft?: boolean;
  /** If set, auto-generate flashcards from this extract when the modal opens */
  extractId?: string;
  /** If set, manually saved cards retain this extract as their parent. */
  linkedExtractId?: string;
  /** Tag applied to the next created flashcard (e.g. from `:deck <name>`). */
  deckTag?: string;
  languageProvenance?: { profileId?: string; sourceAnchor?: unknown; sourceFingerprint?: string; origin?: string };
}

interface QuickTemplate {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  prompt: string;
  command?: string;
}

interface GenerationHistoryItem {
  id: string;
  prompt: string;
  timestamp: number;
  cardCount: number;
  documentName?: string;
}

const HISTORY_KEY = "flashcard-studio-history";
const NOTEBOOKLM_PROVIDER_ID = "__notebooklm__";

// Cost per 1K tokens (approximate for GPT-4)
const COST_PER_1K_INPUT = 0.01;
const COST_PER_1K_OUTPUT = 0.03;

// Matches an explicit card-count instruction in the user's own message, e.g.
// "give me 20 cards" or "12 flashcards please" — this takes precedence over
// the configured/resolved target for that single generation.
const EXPLICIT_CARD_COUNT_REGEX = /\b(\d{1,3})\s*(?:flash ?cards?|cards?)\b/i;

/** Extracts an explicit card count the user asked for in free text, if any. */
function extractExplicitCardCount(text: string): number | null {
  const match = text.match(EXPLICIT_CARD_COUNT_REGEX);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function buildSystemPrompt(targetCount: number, isTwentyRules?: boolean): string {
  return `You are an expert flashcard creation assistant specialized in spaced repetition and active recall learning.${
    isTwentyRules ? `\n\n${buildTwentyRulesSystemPrompt()}` : ""
  }

When creating flashcards, return them as JSON in a code block using this exact schema:

\`\`\`json
{
  "cards": [
    { "type": "qa", "question": "...", "answer": "..." },
    { "type": "cloze", "text": "The {{c1::term}} is important because {{c2::reason}}." },
    {
      "type": "multiple-choice",
      "question": "...",
      "answer": "Optional explanation shown after reveal",
      "options": [
        { "id": "a", "text": "Choice A" },
        { "id": "b", "text": "Choice B" }
      ],
      "correctOptionId": "b"
    }
  ]
}
\`\`\`

Return ONLY the JSON code block (no other text) when the user is asking you to create flashcards.

Rules for excellent flashcards:
- Use "qa" for conceptual questions that benefit from detailed explanations
- Use "cloze" for factual recall with {{c1::}} or {{::}} deletions
- Use "multiple-choice" when plausible distractors will improve recall
- Keep cards atomic: one fact per card
- Use clear, specific questions
- Answers should be concise but complete
- For cloze deletions, ensure the context makes the answer inferable
- Generate approximately ${targetCount} card${targetCount === 1 ? "" : "s"} for this request, unless the user's message explicitly asks for a different number — in that case, follow the user's explicit number instead
- If the user is just chatting, answer normally without JSON`;
}


export const QUICK_TEMPLATES: QuickTemplate[] = [
  {
    id: "twenty-rules",
    icon: <Sparkle className="w-4 h-4 text-amber-500" />,
    label: "20 Rules Formulation",
    description: "Atomic items via Dr. Wozniak's 20 Rules (Min info principle, clozes, anti-interference)",
    prompt: TWENTY_RULES_PROMPT_TEMPLATE,
    command: "/20rules",
  },
  {
    id: "summarize",
    icon: <AlignLeft className="w-4 h-4" />,
    label: "Summarize Key Points",
    description: "Extract main concepts as Q&A cards",
    prompt: "Create flashcards summarizing the key points from this content. Focus on the most important concepts that would be valuable for long-term retention.",
  },
  {
    id: "definitions",
    icon: <BookOpen className="w-4 h-4" />,
    label: "Key Definitions",
    description: "Generate cards for important terms",
    prompt: "Identify all important terminology, definitions, and key terms in this content. Create cloze deletion cards for terms and Q&A cards for conceptual understanding.",
  },
  {
    id: "deep-dive",
    icon: <Brain className="w-4 h-4" />,
    label: "Deep Understanding",
    description: "Why, how, and implications",
    prompt: "Create cards that test deep understanding: why things work the way they do, how concepts relate to each other, and what the implications are. Avoid simple factual recall.",
  },
  {
    id: "examples",
    icon: <Quotes className="w-4 h-4" />,
    label: "Examples & Applications",
    description: "Concrete examples and use cases",
    prompt: "Generate cards based on examples, case studies, or applications mentioned in this content. Create scenario-based questions when possible.",
  },
  {
    id: "compare",
    icon: <Funnel className="w-4 h-4" />,
    label: "Compare & Contrast",
    description: "Similarities and differences",
    prompt: "Identify concepts that can be compared and contrasted. Create cards that highlight similarities, differences, relationships, and distinctions between related ideas.",
  },
  {
    id: "mnemonics",
    icon: <Lightbulb className="w-4 h-4" />,
    label: "With Mnemonics",
    description: "Include memory aids",
    prompt: "Create flashcards and include memory aids, mnemonics, or associations where helpful. Make the cards memorable and easy to recall.",
  },
  {
    id: "theorems",
    icon: <ChartBar className="w-4 h-4" />,
    label: "Theorems & Proofs",
    description: "Mathematical theorems and key steps",
    prompt: "Identify all theorems, lemmas, corollaries, and propositions in this content. For each: create a card with the theorem statement, and optionally cards for key proof steps or applications.",
  },
  {
    id: "formulas",
    icon: <TextAa className="w-4 h-4" />,
    label: "Formulas & Equations",
    description: "Key formulas with explanations",
    prompt: "Extract important formulas, equations, or mathematical expressions. Create cards that show the formula and test understanding of when and how to apply it.",
  },
];

function normalizeCardType(value?: string): DraftCardType | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "qa" || normalized === "q&a" || normalized === "question" || normalized === "question-answer") {
    return "qa";
  }
  if (normalized === "cloze" || normalized === "cloze_deletion" || normalized === "cloze-deletion") {
    return "cloze";
  }
  if (normalized === "multiple-choice" || normalized === "multiple_choice" || normalized === "mcq") {
    return "multiple-choice";
  }
  if (normalized === "image-occlusion" || normalized === "image_occlusion") {
    return "image-occlusion";
  }
  return null;
}

function parseCardsFromResponse(content: string, sourceMessageId: string): { cards: DraftCard[]; cleaned: string } {
  const normalized = content.replace(/\r\n/g, "\n");

  const summaryText = (count: number) =>
    `Generated ${count} draft card${count === 1 ? "" : "s"} (see Draft Cards).`;

  const normalizeJsonLike = (raw: string): string => {
    let s = raw.trim();
    // Some models literally include a leading "json" line.
    s = s.replace(/^\s*json\s*\n/i, "");

    // Common mistake: returning `"cards": [...]` instead of `{ "cards": [...] }`
    if (/^\s*"cards"\s*:/.test(s)) s = `{${s}}`;

    // Allow trailing commas (JSON5-ish) by stripping them.
    s = s.replace(/,\s*([}\]])/g, "$1");

    return s.trim();
  };

  const extractBalancedObjects = (text: string): string[] => {
    // Extract top-level `{...}` objects from a JSON-ish stream. Useful when the model
    // returns a sequence of objects but forgets to wrap them in `[...]` or `{ cards: [...] }`.
    const out: string[] = [];
    let inString = false;
    let escaping = false;
    let depth = 0;
    let start = -1;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        if (inString) escaping = true;
        continue;
      }
      if (ch === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
        continue;
      }
      if (ch === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          out.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }

    return out;
  };

  const extractBalancedJson = (text: string): string | null => {
    // Heuristic for models that forget to close fences or include extra text around JSON.
    // Extract the first balanced JSON object/array starting at the first "{" or "[".
    const start = Math.min(
      ...[text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0)
    );
    if (!Number.isFinite(start)) return null;

    let inString = false;
    let escaping = false;
    let depth = 0;
    let started = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        if (inString) escaping = true;
        continue;
      }
      if (ch === "\"") {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === "{" || ch === "[") {
        started = true;
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth--;
        if (started && depth === 0) {
          const candidate = text.slice(start, i + 1).trim();
          return candidate;
        }
      }
    }
    return null;
  };

  const extractCardsArrayFromLooseKey = (text: string): string | null => {
    const m = /"cards"\s*:\s*\[/i.exec(text);
    if (!m || m.index === undefined) return null;
    const bracketIndex = text.indexOf("[", m.index);
    if (bracketIndex < 0) return null;
    const candidate = extractBalancedJson(text.slice(bracketIndex));
    if (!candidate || !candidate.startsWith("[")) return null;
    return candidate;
  };

  const cardsFromParsedList = (list: unknown[], sourceId: string): DraftCard[] => {
    const cards: DraftCard[] = [];
    list.forEach((entry: unknown) => {
      const e = entry as {
        type?: string;
        question?: string;
        answer?: string;
        text?: string;
        options?: Array<string | MultipleChoiceOption>;
        correctOptionId?: string;
        imageAssetId?: string;
        imageOcclusionAssetId?: string;
        regions?: unknown;
        imageOcclusionRegions?: unknown;
      };
      let type = normalizeCardType(e?.type);

      // If the model forgot "type", infer from fields.
      if (!type) {
        if (typeof e?.question === "string" && typeof e?.answer === "string") type = "qa";
        else if (typeof e?.question === "string" && Array.isArray(e?.options)) type = "multiple-choice";
        else if ((typeof e?.imageAssetId === "string" || typeof e?.imageOcclusionAssetId === "string") && (Array.isArray(e?.regions) || Array.isArray(e?.imageOcclusionRegions))) type = "image-occlusion";
        else if (typeof e?.text === "string") type = "cloze";
      }
      if (!type) return;

      const baseCard = {
        id: `draft-${sourceId}-${cards.length}`,
        type,
        selected: true,
        sourceMessageId: sourceId,
        createdAt: Date.now(),
        tags: [],
      };

      if (type === "qa") {
        const question = typeof e?.question === "string" ? e.question.trim() : "";
        const answer = typeof e?.answer === "string" ? e.answer.trim() : "";
        if (!question || !answer) return;
        cards.push({ ...baseCard, question, answer });
      } else if (type === "cloze") {
        const text = typeof e?.text === "string" ? e.text.trim() : "";
        if (!text) return;
        cards.push({ ...baseCard, text });
      } else if (type === "multiple-choice") {
        const question = typeof e?.question === "string" ? e.question.trim() : "";
        const options = (Array.isArray(e?.options) ? e.options : [])
          .map((option, index): MultipleChoiceOption => {
            if (typeof option === "string") {
              return { id: `choice-${index + 1}`, text: option };
            }
            return {
              id: option.id || `choice-${index + 1}`,
              text: option.text,
              isCorrect: option.isCorrect,
              feedback: option.feedback,
            };
          })
          .filter((option) => typeof option.text === "string" && option.text.trim().length > 0);
        const correctOptionId =
          (typeof e.correctOptionId === "string" ? e.correctOptionId : undefined) ||
          options.find((option) => option.isCorrect)?.id;
        if (!question || options.length < 2 || !correctOptionId) return;
        cards.push({
          ...baseCard,
          type: "multiple-choice",
          question,
          answer: typeof e.answer === "string" ? e.answer.trim() : "",
          multipleChoiceOptions: options,
          multipleChoiceCorrectOptionId: correctOptionId,
        });
      } else if (type === "image-occlusion") {
        const imageOcclusionAssetId =
          typeof e.imageAssetId === "string"
            ? e.imageAssetId.trim()
            : typeof e.imageOcclusionAssetId === "string"
            ? e.imageOcclusionAssetId.trim()
            : "";
        const imageOcclusionRegions = normalizeOcclusionRegions(e.regions ?? e.imageOcclusionRegions).regions;
        if (!imageOcclusionAssetId || imageOcclusionRegions.length === 0) return;
        cards.push({
          ...baseCard,
          type: "image-occlusion",
          question: typeof e.question === "string" ? e.question.trim() : "",
          answer: typeof e.answer === "string" ? e.answer.trim() : "",
          imageOcclusionAssetId,
          imageOcclusionRegions,
        });
      }
    });
    return cards;
  };

  const tryParseJsonishObjectStream = (text: string): DraftCard[] => {
    const objs = extractBalancedObjects(text);
    if (objs.length === 0) return [];

    const parsedObjects: unknown[] = [];
    for (const obj of objs) {
      const raw = normalizeJsonLike(obj);
      try {
        parsedObjects.push(JSON.parse(raw));
      } catch {
        // ignore
      }
    }
    if (parsedObjects.length === 0) return [];
    return cardsFromParsedList(parsedObjects, sourceMessageId);
  };

  const tryParseFromJson = (): { cards: DraftCard[]; cleaned: string } | null => {
    // Prefer explicit json fenced blocks, but accept generic fences too.
    const fences = [...normalized.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
    for (const m of fences) {
      const raw = normalizeJsonLike((m[1] ?? "").trim());
      if (!raw) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { cards?: unknown[] })?.cards)
        ? (parsed as { cards: unknown[] }).cards
        : [];
      if (!Array.isArray(list) || list.length === 0) continue;

      const cards = cardsFromParsedList(list, sourceMessageId);

      if (cards.length === 0) continue;
      const cleaned = normalized.replace(m[0], "").trim();
      return { cards, cleaned: cleaned || summaryText(cards.length) };
    }

    // Models sometimes start a fence but forget to close it.
    const fenceStart = normalized.match(/```(?:json)?\s*\n?/i);
    if (fenceStart?.index !== undefined) {
      const afterFence = normalized.slice(fenceStart.index + fenceStart[0].length).trim();
      const candidate =
        extractCardsArrayFromLooseKey(afterFence) ??
        extractBalancedJson(afterFence);
      if (candidate) {
        try {
          const parsed = JSON.parse(normalizeJsonLike(candidate)) as unknown;
          const list = Array.isArray(parsed)
            ? parsed
            : Array.isArray((parsed as { cards?: unknown[] })?.cards)
            ? (parsed as { cards: unknown[] }).cards
            : [];
          if (Array.isArray(list) && list.length > 0) {
            const rebuilt = `\`\`\`json\n${normalizeJsonLike(candidate)}\n\`\`\``;
            // Recurse through the normal path for consistent validation.
            return tryParseFromJsonFromSingleFence(rebuilt);
          }
        } catch {
          // ignore
        }
      }
    }

    // Finally: attempt to parse JSON even if there's no fence at all.
    const unfencedCandidate =
      extractCardsArrayFromLooseKey(normalized) ??
      extractBalancedJson(normalized);
    if (unfencedCandidate) {
      const rebuilt = `\`\`\`json\n${normalizeJsonLike(unfencedCandidate)}\n\`\`\``;
      return tryParseFromJsonFromSingleFence(rebuilt);
    }

    // If we couldn't parse a full JSON payload, try extracting per-card objects.
    const streamCards = tryParseJsonishObjectStream(normalized);
    if (streamCards.length > 0) {
      return { cards: streamCards, cleaned: summaryText(streamCards.length) };
    }

    return null;
  };

  const tryParseFromJsonFromSingleFence = (fenced: string): { cards: DraftCard[]; cleaned: string } | null => {
    const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(fenced);
    if (!m) return null;
    const raw = normalizeJsonLike((m[1] ?? "").trim());
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { cards?: unknown[] })?.cards)
      ? (parsed as { cards: unknown[] }).cards
      : [];
    if (!Array.isArray(list) || list.length === 0) return null;

    const cards = cardsFromParsedList(list, sourceMessageId);

    if (cards.length === 0) return null;
    return { cards, cleaned: summaryText(cards.length) };
  };

  const tryParseFromText = (): DraftCard[] => {
    const cards: DraftCard[] = [];

    const pushQa = (questionRaw: string, answerRaw: string) => {
      const question = questionRaw.trim();
      const answer = answerRaw.trim();
      if (!question || !answer) return;
      const id = `draft-${sourceMessageId}-${cards.length}`;
      cards.push({
        id,
        type: "qa",
        question,
        answer,
        selected: true,
        sourceMessageId,
        createdAt: Date.now(),
        tags: [],
      });
    };

    const pushCloze = (textRaw: string) => {
      const text = textRaw.trim();
      if (!text) return;
      const id = `draft-${sourceMessageId}-${cards.length}`;
      cards.push({
        id,
        type: "cloze",
        text,
        selected: true,
        sourceMessageId,
        createdAt: Date.now(),
        tags: [],
      });
    };

    // 1) Prefer explicit "Card N" sections (matches the UI screenshot output).
    const hasCardHeaders = /(?:^|\n)\s*Card\s+\d+\s*:?\s*(?:\n|$)/i.test(normalized);
    if (hasCardHeaders) {
      const parts = normalized.split(/(?:^|\n)\s*Card\s+\d+\s*:?\s*(?:\n|$)/i).slice(1);
      for (const part of parts) {
        const block = part.trim();
        if (!block) continue;

        const qMatch = block.match(/(?:^|\n)\s*(?:Q|Question|Front)\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:A|Answer|Back)\s*:)|$)/i);
        const aMatch = block.match(/(?:^|\n)\s*(?:A|Answer|Back)\s*:\s*([\s\S]*?)(?=$)/i);
        if (qMatch?.[1] && aMatch?.[1]) {
          pushQa(qMatch[1], aMatch[1]);
          continue;
        }

        // If the model outputs a cloze line in a "Card N" section, stage it.
        if (block.includes("{{") && block.includes("}}")) {
          pushCloze(block);
        }
      }

      return cards;
    }

    // 2) Otherwise, try to parse repeated Q/A pairs anywhere in the message.
    const qaRegex = /(?:^|\n)\s*(?:Q|Question|Front)\s*:\s*([\s\S]*?)\n\s*(?:A|Answer|Back)\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:Q|Question|Front)\s*:)|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = qaRegex.exec(normalized)) !== null) {
      const q = m[1] ?? "";
      const a = m[2] ?? "";
      pushQa(q, a);
    }
    if (cards.length > 0) return cards;

    // 3) As a last resort, stage any obvious cloze strings.
    const clozeRegex = /(?:^|\n)\s*(?:Cloze\s*:)?\s*([^\n]*\{\{[^}]+\}\}[^\n]*)/gi;
    while ((m = clozeRegex.exec(normalized)) !== null) {
      const t = m[1] ?? "";
      if (t.includes("{{") && t.includes("}}")) pushCloze(t);
    }

    return cards;
  };

  const jsonResult = tryParseFromJson();
  if (jsonResult) return jsonResult;

  const textCards = tryParseFromText();
  if (textCards.length > 0) return { cards: textCards, cleaned: content };

  return { cards: [], cleaned: content };
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function highlightCloze(text: string): React.ReactElement {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\{\{([^}]+)\}\}$/);
        if (match) {
          const content = match[1].replace(/^c\d+::/, "");
          return (
            <span key={i} className="bg-primary/20 text-primary font-semibold px-1 rounded">
              {content}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function stripClozeMarkup(text: string): string {
  return text.replace(/\{\{(.*?)\}\}/g, "$1");
}

function mapPlainOffsetToMarkedOffset(markedText: string, plainOffset: number): number {
  if (plainOffset <= 0) return 0;

  let plainIndex = 0;
  let markedIndex = 0;

  while (markedIndex < markedText.length) {
    if (markedText.startsWith("{{", markedIndex) || markedText.startsWith("}}", markedIndex)) {
      markedIndex += 2;
      continue;
    }
    if (plainIndex === plainOffset) {
      return markedIndex;
    }
    plainIndex += 1;
    markedIndex += 1;
  }

  return markedText.length;
}

function wrapMarkedTextByPlainOffsets(markedText: string, startOffset: number, endOffset: number): string {
  const openIndex = mapPlainOffsetToMarkedOffset(markedText, startOffset);
  const closeIndex = mapPlainOffsetToMarkedOffset(markedText, endOffset);
  if (openIndex >= closeIndex) return markedText;

  const before = markedText.slice(Math.max(0, openIndex - 2), openIndex);
  const after = markedText.slice(closeIndex, closeIndex + 2);
  if (before === "{{" && after === "}}") {
    return markedText;
  }

  return `${markedText.slice(0, openIndex)}{{${markedText.slice(openIndex, closeIndex)}}}${markedText.slice(closeIndex)}`;
}

function estimateCost(
  inputTokens: number, 
  outputTokens: number = 500,
  pricing?: { prompt?: number; completion?: number }
): string {
  if (!pricing) {
    // Fallback to default estimates
    const inputCost = (inputTokens / 1000) * COST_PER_1K_INPUT;
    const outputCost = (outputTokens / 1000) * COST_PER_1K_OUTPUT;
    const total = inputCost + outputCost;
    return total < 0.01 ? "< $0.01" : `~ $${total.toFixed(2)}`;
  }
  
  const inputCost = (inputTokens / 1000) * (pricing.prompt || 0);
  const outputCost = (outputTokens / 1000) * (pricing.completion || 0);
  const total = inputCost + outputCost;
  
  if (total === 0) return "Free";
  if (total < 0.001) return `< $0.001`;
  if (total < 0.01) return `~ $${total.toFixed(3)}`;
  return `~ $${total.toFixed(2)}`;
}

// Format price for display
function formatModelPrice(price?: number): string {
  if (price === undefined || price === null) return "N/A";
  if (price === 0) return "Free";
  if (price < 0.001) return `$${(price * 1000000).toFixed(0)} per 1M`;
  return `$${price.toFixed(4)}`;
}

function CostEstimator({
  inputText,
  isVisible,
  pricing,
  compact = false,
}: {
  inputText: string;
  isVisible: boolean;
  pricing?: { prompt?: number; completion?: number };
  /** Single-line form for mobile: the per-1M price breakdown is what wraps this
   *  onto three lines on a phone, so it is dropped rather than shrunk. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const tokens = useMemo(() => estimateTokens(inputText), [inputText]);
  const cost = useMemo(() => estimateCost(tokens, 500, pricing), [tokens, pricing]);

  if (!isVisible) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap rounded-lg bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground">
        <ChartBar className="h-3 w-3 flex-shrink-0" />
        <span>{t("flashcardStudio.tokensWithCount", { count: formatTokenCount(tokens) })}</span>
        <span className="opacity-50">·</span>
        <span className="truncate">{t("flashcardStudio.estimatedCost", { cost })}</span>
        {tokens > 4000 && (
          <WarningCircle
            className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-amber-500"
            aria-label={t("flashcardStudio.largeContext")}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded-lg text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <ChartBar className="w-3.5 h-3.5" />
        <span>{t("flashcardStudio.tokensWithCount", { count: formatTokenCount(tokens) })}</span>
      </div>
      <div className="w-px h-3 bg-border" />
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <CurrencyDollar className="w-3.5 h-3.5" />
        <span>{t("flashcardStudio.estimatedCost", { cost })}</span>
      </div>
      {pricing && (
        <div className="text-muted-foreground" title={t("flashcardStudio.modelPricingTitle")}>
          {t("flashcardStudio.modelPricingValue", {
            prompt: formatModelPrice(pricing.prompt),
            completion: formatModelPrice(pricing.completion),
          })}
        </div>
      )}
      {tokens > 4000 && (
        <div className="flex items-center gap-1 text-amber-500">
          <WarningCircle className="w-3.5 h-3.5" />
          <span>{t("flashcardStudio.largeContext")}</span>
        </div>
      )}
    </div>
  );
}

function CardPreview({
  card,
  isFlipped,
  onFlip,
  isEditing,
  onEdit,
  onSaveEdit,
  sourceExcerpt,
  imageAssets,
  defaultImageAssetId,
}: {
  card: DraftCard;
  isFlipped: boolean;
  onFlip: () => void;
  isEditing: boolean;
  onEdit: () => void;
  onSaveEdit: (updates: Partial<DraftCard>) => void;
  sourceExcerpt?: string;
  imageAssets: ImageAsset[];
  defaultImageAssetId?: string;
}) {
  const { t } = useI18n();
  const clozeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const sourceExcerptRef = useRef<HTMLDivElement>(null);
  const [isImageLightboxOpen, setIsImageLightboxOpen] = useState(false);
  const [isEditLightboxOpen, setIsEditLightboxOpen] = useState(false);
  const [canUndoCloze, setCanUndoCloze] = useState(false);
  const lastClozeTextRef = useRef<string | null>(null);
  const [sourceSelection, setSourceSelection] = useState<{
    text: string;
    startOffset: number;
    endOffset: number;
  } | null>(null);
  const [editForm, setEditForm] = useState<Partial<DraftCard>>({
    type: card.type,
    question: card.question || "",
    answer: card.answer || "",
    text: card.text || "",
    multipleChoiceOptions: card.multipleChoiceOptions || [
      { id: "choice-1", text: "" },
      { id: "choice-2", text: "" },
    ],
    multipleChoiceCorrectOptionId: card.multipleChoiceCorrectOptionId,
    imageOcclusionAssetId: card.imageOcclusionAssetId || defaultImageAssetId,
    imageOcclusionRegions: card.imageOcclusionRegions || [],
  });

  useEffect(() => {
    setEditForm({
      type: card.type,
      question: card.question || "",
      answer: card.answer || "",
      text: card.text || "",
      multipleChoiceOptions: card.multipleChoiceOptions || [
        { id: "choice-1", text: "" },
        { id: "choice-2", text: "" },
      ],
      multipleChoiceCorrectOptionId: card.multipleChoiceCorrectOptionId,
      imageOcclusionAssetId: card.imageOcclusionAssetId || defaultImageAssetId,
      imageOcclusionRegions: card.imageOcclusionRegions || [],
    });
    setSourceSelection(null);
  }, [card, defaultImageAssetId]);

  const activeType = (editForm.type as DraftCardType | undefined) || card.type;
  const previewContent = activeType === "qa"
    ? `${editForm.question || ""}\n---\n${editForm.answer || ""}`
    : activeType === "cloze"
    ? (editForm.text || "")
    : activeType === "multiple-choice"
    ? `${editForm.question || ""}\n${(editForm.multipleChoiceOptions || []).map((option) => option.text).join("\n")}\n${editForm.answer || ""}`
    : `${editForm.question || ""}\n${editForm.answer || ""}`;
  const { html: previewHtml, isPending: previewPending } = useLatexPreview(previewContent);
  const previewAssetId = (editForm.imageOcclusionAssetId as string | undefined) || defaultImageAssetId;
  const previewAsset = imageAssets.find((asset) => asset.id === previewAssetId) || null;
  const trimmedSourceExcerpt = sourceExcerpt?.trim() || "";

  const setType = (type: DraftCardType) => {
    setEditForm((form) => ({
      ...form,
      type,
      question: type === "cloze" ? undefined : (form.question as string) || "",
      answer: type === "cloze" ? undefined : (form.answer as string) || "",
      text:
        type === "cloze"
          ? ((form.text as string) || trimmedSourceExcerpt || "")
          : undefined,
      multipleChoiceOptions:
        type === "multiple-choice"
          ? (Array.isArray(form.multipleChoiceOptions) && form.multipleChoiceOptions.length > 0
              ? form.multipleChoiceOptions
              : [{ id: "choice-1", text: "" }, { id: "choice-2", text: "" }])
          : undefined,
      multipleChoiceCorrectOptionId:
        type === "multiple-choice"
          ? (form.multipleChoiceCorrectOptionId as string | undefined) || "choice-1"
          : undefined,
      imageOcclusionAssetId:
        type === "image-occlusion"
          ? ((form.imageOcclusionAssetId as string | undefined) || defaultImageAssetId)
          : undefined,
      imageOcclusionRegions:
        type === "image-occlusion"
          ? (Array.isArray(form.imageOcclusionRegions) ? form.imageOcclusionRegions : [])
          : undefined,
    }));
  };

  const wrapClozeSelection = () => {
    const textarea = clozeTextareaRef.current;
    const currentText = ((editForm.text as string) || "");
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = currentText.slice(start, end);
    const wrapped = `{{${selectedText}}}`;
    const nextText = currentText.slice(0, start) + wrapped + currentText.slice(end);

    lastClozeTextRef.current = currentText;
    setCanUndoCloze(true);
    setEditForm((form) => ({ ...form, text: nextText }));
    requestAnimationFrame(() => {
      if (!clozeTextareaRef.current) return;
      clozeTextareaRef.current.focus();
      clozeTextareaRef.current.selectionStart = start;
      clozeTextareaRef.current.selectionEnd = start + wrapped.length;
    });
  };

  const undoClozeWrap = () => {
    if (lastClozeTextRef.current === null) return;
    setEditForm((form) => ({ ...form, text: lastClozeTextRef.current! }));
    lastClozeTextRef.current = null;
    setCanUndoCloze(false);
  };

  const updateSourceSelection = useCallback(() => {
    const selection = window.getSelection();
    const container = sourceExcerptRef.current;
    if (!selection || selection.isCollapsed || !container || !selection.rangeCount) {
      setSourceSelection(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSourceSelection(null);
      return;
    }

    const preRange = range.cloneRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const text = selection.toString();
    const endOffset = startOffset + text.length;

    if (!text.trim() || endOffset <= startOffset) {
      setSourceSelection(null);
      return;
    }

    setSourceSelection({
      text,
      startOffset,
      endOffset,
    });
  }, []);

  const applySourceSelectionAsCloze = () => {
    if (!sourceSelection || !trimmedSourceExcerpt) return;

    const currentText = ((editForm.text as string) || "").trim();
    const hasCompatibleBase =
      currentText.length > 0 && stripClozeMarkup(currentText) === trimmedSourceExcerpt;
    const baseText = hasCompatibleBase ? currentText : trimmedSourceExcerpt;
    const nextText = wrapMarkedTextByPlainOffsets(
      baseText,
      sourceSelection.startOffset,
      sourceSelection.endOffset
    );

    lastClozeTextRef.current = baseText;
    setCanUndoCloze(true);
    setEditForm((form) => ({ ...form, text: nextText }));
    setSourceSelection(null);
    window.getSelection()?.removeAllRanges();
    requestAnimationFrame(() => clozeTextareaRef.current?.focus());
  };

  const editLightbox = (
    <CardEditLightbox
      isOpen={isEditLightboxOpen}
      card={card}
      editForm={editForm}
      onEditFormChange={setEditForm}
      sourceExcerpt={sourceExcerpt}
      imageAssets={imageAssets}
      defaultImageAssetId={defaultImageAssetId}
      onSave={() => {
        onSaveEdit(editForm);
        setIsEditLightboxOpen(false);
      }}
      onCancel={() => setIsEditLightboxOpen(false)}
      onClose={() => setIsEditLightboxOpen(false)}
    />
  );

  if (isEditing) {
    return (
      <>
      <div className="space-y-3 p-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.cardTypeLabel")}</label>
          <button
            type="button"
            onClick={() => setIsEditLightboxOpen(true)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={t("flashcardStudio.expandEditor")}
          >
            <FrameCorners className="w-3.5 h-3.5" />
          </button>
        </div>
        <select
          value={activeType}
          onChange={(e) => setType(e.target.value as DraftCardType)}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="qa">{t("flashcardStudio.cardTypeQaShort")}</option>
          <option value="cloze">{t("flashcardStudio.cardTypeCloze")}</option>
          <option value="multiple-choice">{t("flashcardStudio.cardTypeMultipleChoice")}</option>
          <option value="image-occlusion">{t("flashcardStudio.cardTypeImageOcclusion")}</option>
        </select>

        {activeType === "qa" ? (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.question")}</label>
              <textarea
                value={(editForm.question as string) || ""}
                onChange={(e) => setEditForm((f) => ({ ...f, question: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                rows={2}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.answer")}</label>
              <textarea
                value={(editForm.answer as string) || ""}
                onChange={(e) => setEditForm((f) => ({ ...f, answer: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                rows={3}
              />
            </div>
          </>
        ) : activeType === "cloze" ? (
          <div>
            <label className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.clozeTextLabel")}</label>
            {trimmedSourceExcerpt && (
              <div className="mt-1.5 mb-2 rounded-md border border-border/60 bg-muted/20 p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Source Extract
                  </span>
                  <div className="flex items-center gap-2">
                    {sourceSelection && (
                      <button
                        type="button"
                        onClick={applySourceSelectionAsCloze}
                        className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:opacity-90"
                      >
                        Cloze selection
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditForm((form) => ({ ...form, text: trimmedSourceExcerpt }))}
                      className="text-[10px] font-medium text-primary hover:opacity-80"
                    >
                      Use full extract
                    </button>
                  </div>
                </div>
                <div
                  ref={sourceExcerptRef}
                  onMouseUp={updateSourceSelection}
                  onKeyUp={updateSourceSelection}
                  className="max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground select-text rounded-md border border-transparent px-1 py-0.5"
                >
                  {trimmedSourceExcerpt}
                </div>
                <div className="mt-2 flex items-start justify-between gap-3">
                  <p className="text-[11px] text-muted-foreground">
                    Highlight a word or phrase in the extract, then use <span className="font-medium text-foreground">Cloze selection</span> to hide it in context.
                  </p>
                  {sourceSelection && (
                    <div className="max-w-[45%] rounded-md bg-background/80 px-2 py-1 text-[10px] text-muted-foreground">
                      Selected: <span className="text-foreground">{sourceSelection.text.trim()}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            <textarea
              ref={clozeTextareaRef}
              value={(editForm.text as string) || ""}
              onChange={(e) => setEditForm((f) => ({ ...f, text: e.target.value }))}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
                  e.preventDefault();
                  wrapClozeSelection();
                }
              }}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              rows={4}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">
                Select text and press <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Ctrl+B</kbd> to wrap it as a Cloze deletion.
              </p>
              <div className="flex items-center gap-1.5">
                {canUndoCloze && (
                  <button
                    type="button"
                    onClick={undoClozeWrap}
                    className="shrink-0 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  >
                    {t("flashcardStudio.undoCloze")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={wrapClozeSelection}
                  className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/15"
                >
                  Wrap selection
                </button>
              </div>
            </div>
          </div>
        ) : activeType === "multiple-choice" ? (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.question")}</label>
              <textarea
                value={(editForm.question as string) || ""}
                onChange={(e) => setEditForm((f) => ({ ...f, question: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.choices")}</label>
                <button
                  type="button"
                  onClick={() =>
                    setEditForm((form) => ({
                      ...form,
                      multipleChoiceOptions: [
                        ...(form.multipleChoiceOptions || []),
                        {
                          id: `choice-${(form.multipleChoiceOptions?.length || 0) + 1}`,
                          text: "",
                        },
                      ],
                    }))
                  }
                  className="text-xs text-primary hover:opacity-80"
                >
                  {t("flashcardStudio.addChoice")}
                </button>
              </div>
              {(editForm.multipleChoiceOptions || []).map((option, index) => (
                <div key={option.id || index} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`correct-${card.id}`}
                    checked={editForm.multipleChoiceCorrectOptionId === option.id}
                    onChange={() =>
                      setEditForm((form) => ({
                        ...form,
                        multipleChoiceCorrectOptionId: option.id,
                      }))
                    }
                  />
                  <input
                    value={option.text}
                    onChange={(e) =>
                      setEditForm((form) => ({
                        ...form,
                        multipleChoiceOptions: (form.multipleChoiceOptions || []).map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, text: e.target.value } : entry
                        ),
                      }))
                    }
                    placeholder={t("flashcardStudio.choiceNumber", { count: index + 1 })}
                    className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              ))}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.explanationOptional")}</label>
              <textarea
                value={(editForm.answer as string) || ""}
                onChange={(e) => setEditForm((f) => ({ ...f, answer: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                rows={2}
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.prompt")}</label>
              <textarea
                value={(editForm.question as string) || ""}
                onChange={(e) => setEditForm((f) => ({ ...f, question: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                rows={2}
                placeholder={t("flashcardStudio.imagePromptPlaceholder")}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.revealExplanation")}</label>
              <textarea
                value={(editForm.answer as string) || ""}
                onChange={(e) => setEditForm((f) => ({ ...f, answer: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                rows={2}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.sourceImage")}</label>
              <select
                value={(editForm.imageOcclusionAssetId as string | undefined) || ""}
                onChange={(e) =>
                  setEditForm((form) => ({
                    ...form,
                    imageOcclusionAssetId: e.target.value || undefined,
                  }))
                }
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">{t("flashcardStudio.selectImportedImage")}</option>
                {imageAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.file_name || asset.id}
                  </option>
                ))}
              </select>
            </div>
            <StudioOcclusionComposerLauncher
              assetId={editForm.imageOcclusionAssetId}
              regions={(editForm.imageOcclusionRegions as ImageOcclusionRegion[] | undefined) || []}
              onRegionsChange={(regions) => setEditForm((form) => ({ ...form, imageOcclusionRegions: regions }))}
            />
          </>
        )}
        {previewHtml && (
          <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-sm">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("flashcardStudio.preview")} {previewPending && <span className="opacity-50">...</span>}
            </div>
            <div
              className="prose prose-sm max-w-none [&_.math-expression-block]:my-1 [&_.math-expression-block]:flex [&_.math-expression-block]:justify-center"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => onSaveEdit({})}
            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("flashcardStudio.cancel")}
          </button>
          <button
            onClick={() => onSaveEdit(editForm)}
            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:opacity-90"
          >
            {t("flashcardStudio.saveChanges")}
          </button>
        </div>
      </div>
      {editLightbox}
      </>
    );
  }

  return (
    <div
      onClick={onFlip}
      className="cursor-pointer group perspective-1000"
    >
      <div
        className={cn(
          "relative min-h-[100px] rounded-xl border bg-card p-4 transition-all duration-300",
          "hover:border-primary/30 hover:shadow-md",
          isFlipped && card.type === "qa" ? "ring-2 ring-primary/20" : "border-border"
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1">
            {card.type === "qa" ? (
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">
                  {isFlipped ? t("flashcardStudio.answerLabel") : t("flashcardStudio.questionLabel")}
                </div>
                <div className="text-sm text-foreground/90 leading-relaxed">
                  {isFlipped
                    ? card.answer
                    : card.question}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  {isFlipped ? t("flashcardStudio.clickToSeeQuestion") : t("flashcardStudio.clickToRevealAnswer")}
                </div>
              </div>
            ) : card.type === "multiple-choice" ? (
              <div className="space-y-2">
                <div className="text-sm font-medium text-foreground">{card.question}</div>
                <div className="space-y-1.5">
                  {(card.multipleChoiceOptions || []).map((option) => (
                    <div
                      key={option.id}
                      className={cn(
                        "rounded-md border px-2.5 py-2 text-sm",
                        isFlipped && card.multipleChoiceCorrectOptionId === option.id
                          ? "border-green-500/40 bg-green-500/10"
                          : "border-border bg-background"
                      )}
                    >
                      {option.text}
                    </div>
                  ))}
                </div>
                {isFlipped && card.answer && (
                  <div className="text-xs text-muted-foreground">{card.answer}</div>
                )}
              </div>
            ) : card.type === "image-occlusion" ? (
              <div className="space-y-3">
                <div className="text-sm font-medium text-foreground">{card.question || t("flashcardStudio.imageOcclusionCard")}</div>
                {previewAsset ? (
                  <div className="relative overflow-hidden rounded-lg border border-border bg-muted/30">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setIsImageLightboxOpen(true);
                      }}
                      className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-black/80"
                    >
                      <FrameCorners className="h-3 w-3" />
                      {t("flashcardStudio.expandImage")}
                    </button>
                    <img src={previewAsset.data_url} alt={previewAsset.file_name || t("flashcardStudio.occlusionSource")} className="w-full object-contain" />
                    {!isFlipped &&
                      (card.imageOcclusionRegions || []).map((region, index) => (
                        <div
                          key={region.id || `${region.x}-${region.y}-${index}`}
                          className="absolute rounded border border-white/30 bg-slate-950/80"
                          style={{
                            left: `${region.x}%`,
                            top: `${region.y}%`,
                            width: `${region.width}%`,
                            height: `${region.height}%`,
                          }}
                        />
                      ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("flashcardStudio.selectImageForOcclusion")}
                  </div>
                )}
                {isFlipped && card.answer && (
                  <div className="text-xs text-muted-foreground">{card.answer}</div>
                )}
                {previewAsset ? (
                  <OcclusionLightbox
                    isOpen={isImageLightboxOpen}
                    asset={previewAsset}
                    regions={(card.imageOcclusionRegions || []) as ImageOcclusionRegion[]}
                    title={card.question || previewAsset.file_name || t("flashcardStudio.imageOcclusionCard")}
                    onClose={() => setIsImageLightboxOpen(false)}
                  />
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-foreground/90 leading-relaxed">
                {highlightCloze(card.text || "")}
              </div>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-muted transition-opacity"
          >
            <PencilSimple className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>
      {editLightbox}
    </div>
  );
}

/**
 * Backdrop dismiss that survives the Android soft keyboard.
 *
 * A bare `onClick={onClose}` on a backdrop fires whenever the click *resolves*
 * over the backdrop. Tapping a textarea on Android opens the keyboard, which
 * reflows the layout and can slide the backdrop under the finger before the
 * click completes — so the modal closes the instant you try to type in it.
 * Requiring the press to have *started* on the backdrop fixes that, and also
 * stops a drag-select inside the panel from dismissing it on release.
 */
export function useBackdropDismiss(onClose: () => void) {
  const pressedBackdrop = useRef(false);
  return {
    onPointerDown: (event: React.PointerEvent) => {
      pressedBackdrop.current = event.target === event.currentTarget;
    },
    onClick: (event: React.MouseEvent) => {
      const dismiss = event.target === event.currentTarget && pressedBackdrop.current;
      pressedBackdrop.current = false;
      if (dismiss) onClose();
    },
  };
}

function CardEditLightbox({
  isOpen,
  card,
  editForm,
  onEditFormChange,
  sourceExcerpt,
  imageAssets,
  defaultImageAssetId,
  onSave,
  onCancel,
  onClose,
}: {
  isOpen: boolean;
  card: DraftCard;
  editForm: Partial<DraftCard>;
  onEditFormChange: React.Dispatch<React.SetStateAction<Partial<DraftCard>>>;
  sourceExcerpt?: string;
  imageAssets: ImageAsset[];
  defaultImageAssetId?: string;
  onSave: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const clozeTextareaRef = useRef<HTMLTextAreaElement>(null);
  const sourceExcerptRef = useRef<HTMLDivElement>(null);
  const [sourceSelection, setSourceSelection] = useState<{
    text: string;
    startOffset: number;
    endOffset: number;
  } | null>(null);
  const [canUndoCloze, setCanUndoCloze] = useState(false);
  const lastClozeTextRef = useRef<string | null>(null);

  const activeType = (editForm.type as DraftCardType | undefined) || card.type;
  const trimmedSourceExcerpt = sourceExcerpt?.trim() || "";

  const setType = (type: DraftCardType) => {
    onEditFormChange((form) => ({
      ...form,
      type,
      question: type === "cloze" ? undefined : (form.question as string) || "",
      answer: type === "cloze" ? undefined : (form.answer as string) || "",
      text:
        type === "cloze"
          ? ((form.text as string) || trimmedSourceExcerpt || "")
          : undefined,
      multipleChoiceOptions:
        type === "multiple-choice"
          ? (Array.isArray(form.multipleChoiceOptions) && form.multipleChoiceOptions.length > 0
              ? form.multipleChoiceOptions
              : [{ id: "choice-1", text: "" }, { id: "choice-2", text: "" }])
          : undefined,
      multipleChoiceCorrectOptionId:
        type === "multiple-choice"
          ? (form.multipleChoiceCorrectOptionId as string | undefined) || "choice-1"
          : undefined,
      imageOcclusionAssetId:
        type === "image-occlusion"
          ? ((form.imageOcclusionAssetId as string | undefined) || defaultImageAssetId)
          : undefined,
      imageOcclusionRegions:
        type === "image-occlusion"
          ? (Array.isArray(form.imageOcclusionRegions) ? form.imageOcclusionRegions : [])
          : undefined,
    }));
  };

  const wrapClozeSelection = () => {
    const textarea = clozeTextareaRef.current;
    const currentText = ((editForm.text as string) || "");
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = currentText.slice(start, end);
    const wrapped = `{{${selectedText}}}`;
    const nextText = currentText.slice(0, start) + wrapped + currentText.slice(end);

    lastClozeTextRef.current = currentText;
    setCanUndoCloze(true);
    onEditFormChange((form) => ({ ...form, text: nextText }));
    requestAnimationFrame(() => {
      if (!clozeTextareaRef.current) return;
      clozeTextareaRef.current.focus();
      clozeTextareaRef.current.selectionStart = start;
      clozeTextareaRef.current.selectionEnd = start + wrapped.length;
    });
  };

  const undoClozeWrap = () => {
    if (lastClozeTextRef.current === null) return;
    onEditFormChange((form) => ({ ...form, text: lastClozeTextRef.current! }));
    lastClozeTextRef.current = null;
    setCanUndoCloze(false);
  };

  const updateSourceSelection = useCallback(() => {
    const selection = window.getSelection();
    const container = sourceExcerptRef.current;
    if (!selection || selection.isCollapsed || !container || !selection.rangeCount) {
      setSourceSelection(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setSourceSelection(null);
      return;
    }

    const preRange = range.cloneRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const text = selection.toString();
    const endOffset = startOffset + text.length;

    if (!text.trim() || endOffset <= startOffset) {
      setSourceSelection(null);
      return;
    }

    setSourceSelection({ text, startOffset, endOffset });
  }, []);

  const applySourceSelectionAsCloze = () => {
    if (!sourceSelection || !trimmedSourceExcerpt) return;

    const currentText = ((editForm.text as string) || "").trim();
    const hasCompatibleBase =
      currentText.length > 0 && stripClozeMarkup(currentText) === trimmedSourceExcerpt;
    const baseText = hasCompatibleBase ? currentText : trimmedSourceExcerpt;
    const nextText = wrapMarkedTextByPlainOffsets(
      baseText,
      sourceSelection.startOffset,
      sourceSelection.endOffset
    );

    lastClozeTextRef.current = baseText;
    setCanUndoCloze(true);
    onEditFormChange((form) => ({ ...form, text: nextText }));
    setSourceSelection(null);
    window.getSelection()?.removeAllRanges();
    requestAnimationFrame(() => clozeTextareaRef.current?.focus());
  };

  const previewContent = activeType === "qa"
    ? `${editForm.question || ""}\n---\n${editForm.answer || ""}`
    : activeType === "cloze"
    ? (editForm.text || "")
    : activeType === "multiple-choice"
    ? `${editForm.question || ""}\n${(editForm.multipleChoiceOptions || []).map((option) => option.text).join("\n")}\n${editForm.answer || ""}`
    : `${editForm.question || ""}\n${editForm.answer || ""}`;
  const { html: previewHtml, isPending: previewPending } = useLatexPreview(previewContent);

  const previewAssetId = (editForm.imageOcclusionAssetId as string | undefined) || defaultImageAssetId;
  const previewAsset = imageAssets.find((asset) => asset.id === previewAssetId) || null;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const backdropDismiss = useBackdropDismiss(onClose);

  const inputCls = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";
  const labelCls = "text-xs font-medium text-muted-foreground mb-1.5 block";

  return (
    <div
      className="fixed inset-0 z-[9993] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      {...backdropDismiss}
    >
      <div
        className="flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <div className="text-sm font-semibold text-foreground">{t("flashcardStudio.editCardTitle")}</div>
            <div className="text-xs text-muted-foreground">{t("flashcardStudio.editCardHint")}</div>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={activeType}
              onChange={(e) => setType(e.target.value as DraftCardType)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="qa">{t("flashcardStudio.cardTypeQaShort")}</option>
              <option value="cloze">{t("flashcardStudio.cardTypeCloze")}</option>
              <option value="multiple-choice">{t("flashcardStudio.cardTypeMultipleChoice")}</option>
              <option value="image-occlusion">{t("flashcardStudio.cardTypeImageOcclusion")}</option>
            </select>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {activeType === "cloze" ? (
            <div className="flex gap-6 h-full">
              {/* Source extract pane */}
              {trimmedSourceExcerpt && (
                <div className="w-[38%] flex flex-col min-h-0">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className={labelCls}>{t("flashcardStudio.sourceExtractLabel")}</span>
                    <div className="flex items-center gap-2">
                      {sourceSelection && (
                        <button
                          type="button"
                          onClick={applySourceSelectionAsCloze}
                          className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                        >
                          Cloze selection
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onEditFormChange((form) => ({ ...form, text: trimmedSourceExcerpt }))}
                        className="text-xs font-medium text-primary hover:opacity-80"
                      >
                        Use full extract
                      </button>
                    </div>
                  </div>
                  <div
                    ref={sourceExcerptRef}
                    onMouseUp={updateSourceSelection}
                    onKeyUp={updateSourceSelection}
                    className="flex-1 min-h-0 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground select-text rounded-md border border-border/60 bg-muted/20 px-3 py-2"
                  >
                    {trimmedSourceExcerpt}
                  </div>
                  {sourceSelection && (
                    <div className="mt-2 rounded-md bg-background px-2 py-1 text-xs text-muted-foreground">
                      Selected: <span className="text-foreground font-medium">{sourceSelection.text.trim()}</span>
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Highlight a word or phrase, then click <span className="font-medium text-foreground">Cloze selection</span>.
                  </p>
                </div>
              )}
              {/* Cloze editor pane */}
              <div className={`flex flex-col min-h-0 ${trimmedSourceExcerpt ? "w-[62%]" : "w-full"}`}>
                <span className={labelCls}>{t("flashcardStudio.clozeTextLabel")}</span>
                <textarea
                  ref={clozeTextareaRef}
                  value={(editForm.text as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, text: e.target.value }))}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
                      e.preventDefault();
                      wrapClozeSelection();
                    }
                  }}
                  className={`${inputCls} flex-1 min-h-[200px] resize-y font-mono`}
                  placeholder="Enter text with {{cloze deletions}}..."
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    Select text and press <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Ctrl+B</kbd> to wrap as Cloze.
                  </p>
                  <div className="flex items-center gap-1.5">
                    {canUndoCloze && (
                      <button
                        type="button"
                        onClick={undoClozeWrap}
                        className="shrink-0 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                      >
                        {t("flashcardStudio.undoCloze")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={wrapClozeSelection}
                      className="shrink-0 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/15"
                    >
                      Wrap selection
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : activeType === "qa" ? (
            <div className="space-y-4 max-w-3xl mx-auto">
              <div>
                <span className={labelCls}>{t("flashcardStudio.question")}</span>
                <textarea
                  value={(editForm.question as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, question: e.target.value }))}
                  className={inputCls}
                  rows={4}
                />
              </div>
              <div>
                <span className={labelCls}>{t("flashcardStudio.answer")}</span>
                <textarea
                  value={(editForm.answer as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, answer: e.target.value }))}
                  className={inputCls}
                  rows={6}
                />
              </div>
            </div>
          ) : activeType === "multiple-choice" ? (
            <div className="space-y-4 max-w-3xl mx-auto">
              <div>
                <span className={labelCls}>{t("flashcardStudio.question")}</span>
                <textarea
                  value={(editForm.question as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, question: e.target.value }))}
                  className={inputCls}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={labelCls}>{t("flashcardStudio.choices")}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onEditFormChange((form) => ({
                        ...form,
                        multipleChoiceOptions: [
                          ...(form.multipleChoiceOptions || []),
                          { id: `choice-${(form.multipleChoiceOptions?.length || 0) + 1}`, text: "" },
                        ],
                      }))
                    }
                    className="text-xs text-primary hover:opacity-80"
                  >
                    {t("flashcardStudio.addChoice")}
                  </button>
                </div>
                {(editForm.multipleChoiceOptions || []).map((option, index) => (
                  <div key={option.id || index} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`correct-lightbox-${card.id}`}
                      checked={editForm.multipleChoiceCorrectOptionId === option.id}
                      onChange={() =>
                        onEditFormChange((form) => ({
                          ...form,
                          multipleChoiceCorrectOptionId: option.id,
                        }))
                      }
                    />
                    <input
                      value={option.text}
                      onChange={(e) =>
                        onEditFormChange((form) => ({
                          ...form,
                          multipleChoiceOptions: (form.multipleChoiceOptions || []).map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, text: e.target.value } : entry
                          ),
                        }))
                      }
                      placeholder={t("flashcardStudio.choiceNumber", { count: index + 1 })}
                      className={inputCls}
                    />
                  </div>
                ))}
              </div>
              <div>
                <span className={labelCls}>{t("flashcardStudio.explanationOptional")}</span>
                <textarea
                  value={(editForm.answer as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, answer: e.target.value }))}
                  className={inputCls}
                  rows={3}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4 max-w-3xl mx-auto">
              <div>
                <span className={labelCls}>{t("flashcardStudio.prompt")}</span>
                <textarea
                  value={(editForm.question as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, question: e.target.value }))}
                  className={inputCls}
                  rows={3}
                  placeholder={t("flashcardStudio.imagePromptPlaceholder")}
                />
              </div>
              <div>
                <span className={labelCls}>{t("flashcardStudio.revealExplanation")}</span>
                <textarea
                  value={(editForm.answer as string) || ""}
                  onChange={(e) => onEditFormChange((f) => ({ ...f, answer: e.target.value }))}
                  className={inputCls}
                  rows={3}
                />
              </div>
              <div>
                <span className={labelCls}>{t("flashcardStudio.sourceImage")}</span>
                <select
                  value={(editForm.imageOcclusionAssetId as string | undefined) || ""}
                  onChange={(e) =>
                    onEditFormChange((form) => ({
                      ...form,
                      imageOcclusionAssetId: e.target.value || undefined,
                    }))
                  }
                  className={inputCls}
                >
                  <option value="">{t("flashcardStudio.selectImportedImage")}</option>
                  {imageAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.file_name || asset.id}
                    </option>
                  ))}
                </select>
              </div>
              <StudioOcclusionComposerLauncher
                assetId={editForm.imageOcclusionAssetId}
                regions={(editForm.imageOcclusionRegions as ImageOcclusionRegion[] | undefined) || []}
                onRegionsChange={(regions) => onEditFormChange((form) => ({ ...form, imageOcclusionRegions: regions }))}
              />
            </div>
          )}
        </div>

        {/* Footer: Preview + Actions */}
        <div className="border-t border-border px-6 py-4">
          {previewHtml && (
            <div className="mb-3 rounded-md border border-border/50 bg-muted/30 p-3 text-sm max-h-32 overflow-y-auto">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("flashcardStudio.preview")} {previewPending && <span className="opacity-50">...</span>}
              </div>
              <div
                className="prose prose-sm max-w-none [&_.math-expression-block]:my-1 [&_.math-expression-block]:flex [&_.math-expression-block]:justify-center"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("flashcardStudio.cancel")}
            </button>
            <button
              onClick={onSave}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
            >
              {t("flashcardStudio.saveChanges")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onClick,
}: {
  template: QuickTemplate;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/30 hover:bg-primary/5 transition-all text-left group"
    >
      <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
        {template.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-medium text-sm text-foreground">{template.label}</div>
          {template.command && (
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-normal">
              {template.command}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{template.description}</div>
      </div>
      <CaretRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

export function FlashcardStudioModal({ isOpen, onClose, seed }: FlashcardStudioModalProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { documents, loadDocuments } = useDocumentStore();
  const { decks, activeDeckIds, addDeck } = useStudyDeckStore();
  const providers = useLLMProvidersStore((state) => state.providers);
  const enabledProviders = useMemo(() => providers.filter((p) => p.enabled), [providers]);
  const maxTokens = useSettingsStore((state) => state.settings.ai.maxTokens) || 4000;
  const aiControls = useSettingsStore((state) => state.settings.ai.aiControls);
  const preferredProviderType = useSettingsStore((state) => state.settings.ai.provider);
  const notebookLmEnabled = useSettingsStore((state) => state.settings.features.notebooklmEnabled);
  // NotebookLM requires the desktop backend (Google auth/cookie capture lives in
  // Rust). Hide it in the browser/PWA rather than letting it silently no-op.
  const notebookLmAvailable = notebookLmEnabled && isTauri();

  // On-device providers (Gemini Nano on Android, Apple FM on macOS) are not rows
  // in the cloud LLM registry — list them separately for the provider picker.
  const [availableOnDeviceProviders, setAvailableOnDeviceProviders] = useState<
    OnDeviceProviderOption[]
  >([]);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void listAvailableOnDeviceProviders().then((options) => {
      if (!cancelled) setAvailableOnDeviceProviders(options);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Mobile shell decides whether configuration lives in the chip bar + sheets
  // (phone/narrow tablet) or inline across the top (desktop).
  const isMobileShell = useMobileShell();

  // State
  const [mobileActivePanel, setMobileActivePanel] = useState<"generator" | "drafts">("generator");
  /** Which configuration bottom sheet is open on mobile; null = none. Single
   *  value rather than a boolean per sheet, so "one sheet at a time" is
   *  structural and the Escape guard below has one thing to check. */
  const [activeSheet, setActiveSheet] = useState<StudioSheet | null>(null);
  /** Measured composer height so the mobile textarea grows with its content
   *  instead of reserving a third row that is empty most of the time. */
  const [composerHeight, setComposerHeight] = useState<number | undefined>(undefined);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>("");
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [isNotebookLoading, setIsNotebookLoading] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [resolvedDocumentContent, setResolvedDocumentContent] = useState<string | undefined>(undefined);
  const [contextLoadState, setContextLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [contextLoadError, setContextLoadError] = useState<string | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [draftCards, setDraftCards] = useState<DraftCard[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("chat");
  // Active Studio session — the source of truth for the live workspace.
  // The component mirrors one session's messages/drafts/context at a time.
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // Sessions list state, re-read from storage when the Sessions view is shown.
  const [sessionsCache, setSessionsCache] = useState<FlashcardStudioSession[]>([]);
  // Controls the "discard unsaved drafts?" confirmation when starting a new session.
  const [showNewSessionDialog, setShowNewSessionDialog] = useState(false);
  // Inline rename target within the Sessions view.
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Delete confirmation within the Sessions view.
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [generationHistory, setGenerationHistory] = useState<GenerationHistoryItem[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [bulkTagInput, setBulkTagInput] = useState("");
  const [isTagInputVisible, setIsTagInputVisible] = useState(false);
  const [contextSelection, setContextSelection] = useState<ContextSelection>(DEFAULT_CONTEXT_SELECTION);
  // Session-local override of the flashcard generation target (undefined = use
  // the global AI settings default). Resets to undefined on "New session".
  const [sessionTargetOverride, setSessionTargetOverride] = useState<FlashcardTargetOverride | undefined>(undefined);
  const [showTargetPanel, setShowTargetPanel] = useState(false);
  // Section-mention (`#`) popup state for the chat input. Mirrors the Assistant.
  const [showSectionPopup, setShowSectionPopup] = useState(false);
  const [sectionQuery, setSectionQuery] = useState("");
  const [sectionCursorIndex, setSectionCursorIndex] = useState(0);
  const [allExtracts, setAllExtracts] = useState<Extract[]>([]);
  const [areExtractsLoading, setAreExtractsLoading] = useState(false);
  const [generatingExtractIds, setGeneratingExtractIds] = useState<Set<string>>(new Set());
  const [imageAssets, setImageAssets] = useState<ImageAsset[]>([]);
  const [selectedImageAssetIds, setSelectedImageAssetIds] = useState<string[]>([]);
  const [isImageImporting, setIsImageImporting] = useState(false);
  const [isImageRegistryOpen, setIsImageRegistryOpen] = useState(false);
  const [languageSourceConfirmed, setLanguageSourceConfirmed] = useState(false);
  const appliedSeedKeyRef = useRef<string | null>(null);
  const seededDocumentIdRef = useRef<string | null>(null);
  const seededExtractIdRef = useRef<string | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftCardsContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const saveInFlightRef = useRef(false);

  const preferredOnDeviceProviderId = useSettingsStore(
    (state) => state.settings.ai.preferredOnDeviceProviderId
  );

  useEffect(() => {
    if (!isOpen) return;
    if (selectedProviderId) return;
    if (enabledProviders.length > 0) {
      const preferred = enabledProviders.find((p) => p.provider === preferredProviderType);
      setSelectedProviderId(preferred?.id ?? enabledProviders[0].id);
      return;
    }
    if (notebookLmAvailable) {
      setSelectedProviderId(NOTEBOOKLM_PROVIDER_ID);
      return;
    }
    if (availableOnDeviceProviders.length > 0) {
      const preferredOnDevice = availableOnDeviceProviders.find(
        (option) => option.id === preferredOnDeviceProviderId
      );
      setSelectedProviderId(preferredOnDevice?.id ?? availableOnDeviceProviders[0].id);
    }
  }, [
    isOpen,
    enabledProviders,
    selectedProviderId,
    preferredProviderType,
    preferredOnDeviceProviderId,
    notebookLmAvailable,
    availableOnDeviceProviders,
  ]);

  useEffect(() => {
    if (!isOpen || !notebookLmAvailable) return;
    const loadNotebookState = async () => {
      setIsNotebookLoading(true);
      try {
        const [settings, listed] = await Promise.all([
          notebooklmGetSettings(),
          // Listing can now reject (e.g. expired session surfacing as an auth
          // error). Treat that as "no notebooks available" so settings still
          // load and the modal does not crash.
          notebooklmListNotebooks().catch(() => [] as Awaited<ReturnType<typeof notebooklmListNotebooks>>),
        ]);
        setNotebooks(listed);
        const activeId = settings.activeNotebookId || listed[0]?.id || "";
        if (activeId) {
          setSelectedNotebookId(activeId);
        }
      } catch (error) {
        console.error("Failed to load NotebookLM state", error);
      } finally {
        setIsNotebookLoading(false);
      }
    };
    void loadNotebookState();
  }, [isOpen, notebookLmAvailable]);

  useEffect(() => {
    if (!notebookLmAvailable && selectedProviderId === NOTEBOOKLM_PROVIDER_ID) {
      setSelectedProviderId(enabledProviders[0]?.id ?? null);
    }
  }, [notebookLmAvailable, selectedProviderId, enabledProviders]);

  useEffect(() => {
    if (!selectedProviderId || !isCatalogOnDeviceProviderId(selectedProviderId)) return;
    if (availableOnDeviceProviders.some((option) => option.id === selectedProviderId)) return;
    setSelectedProviderId(enabledProviders[0]?.id ?? null);
  }, [availableOnDeviceProviders, selectedProviderId, enabledProviders]);

  useEffect(() => {
    if (!isOpen) return;
    if (documents.length === 0) {
      void loadDocuments();
    }
  }, [isOpen, documents.length, loadDocuments]);

  const refreshImageAssets = useCallback(async () => {
    try {
      const assets = await listImageAssets();
      setImageAssets(Array.isArray(assets) ? assets : []);
    } catch (error) {
      console.error("Failed to load image registry assets", error);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refreshImageAssets();
  }, [isOpen, refreshImageAssets]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setAreExtractsLoading(true);
    getExtracts()
      .then((result) => {
        if (!cancelled) setAllExtracts(result);
      })
      .catch((err) => {
        console.error("Failed to load extracts", err);
      })
      .finally(() => {
        if (!cancelled) setAreExtractsLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen]);

  // Hydrate the live workspace from a session record.
  const hydrateFromSession = useCallback((session: FlashcardStudioSession | null) => {
    if (!session) {
      setMessages([]);
      setDraftCards([]);
      setContextSelection(DEFAULT_CONTEXT_SELECTION);
      setSessionTargetOverride(undefined);
      return;
    }
    setMessages(Array.isArray(session.messages) ? session.messages : []);
    setDraftCards(Array.isArray(session.draftCards) ? session.draftCards : []);
    setSessionTargetOverride(session.flashcardTargetOverride);
    if (session.selectedProviderId) setSelectedProviderId(session.selectedProviderId);
    if (typeof session.selectedNotebookId === "string") setSelectedNotebookId(session.selectedNotebookId);
    setSelectedDocumentId(session.selectedDocumentId ?? null);
    // Prefer the session's deck, else fall back to the first active deck.
    setSelectedDeckId(session.selectedDeckId ?? activeDeckIds[0] ?? null);
    setContextSelection(session.contextSelection ? normalizeContextSelection(session.contextSelection) : DEFAULT_CONTEXT_SELECTION);
    if (session.viewMode && ["chat", "templates", "sessions", "extracts"].includes(session.viewMode)) {
      setViewMode(session.viewMode as ViewMode);
    } else if (session.viewMode === "history") {
      // Legacy persisted view mode — map to the sessions view.
      setViewMode("sessions");
    }
  }, [activeDeckIds]);

  // Flush (synchronously persist) the current live workspace into the active
  // session record. Used before a session switch to avoid stale-debounce races.
  const flushActiveSession = useCallback(() => {
    if (!activeSessionId) return;
    // Guard (6.3): if the active id no longer resolves to a stored session
    // (corrupt/missing record), recreate it rather than writing into the void.
    if (!getSession(activeSessionId)) {
      const doc = documents.find((d) => d.id === selectedDocumentId);
      const recovered = createStudioSession({
        selectedProviderId,
        selectedNotebookId,
        selectedDocumentId,
        selectedDeckId,
        contextSelection,
        messages,
        draftCards,
        viewMode,
        documentName: doc?.title,
        flashcardTargetOverride: sessionTargetOverride,
      });
      saveSessions([recovered, ...loadSessions()]);
      persistActiveSessionId(recovered.id);
      setActiveSessionId(recovered.id);
      return;
    }
    const doc = documents.find((d) => d.id === selectedDocumentId);
    updateStudioSession(activeSessionId, {
      selectedProviderId,
      selectedNotebookId,
      selectedDocumentId,
      selectedDeckId,
      contextSelection,
      messages: messages.slice(-50),
      draftCards: draftCards.slice(0, 100),
      viewMode,
      documentName: doc?.title,
      flashcardTargetOverride: sessionTargetOverride,
    });
  }, [activeSessionId, selectedProviderId, selectedNotebookId, selectedDocumentId, selectedDeckId, contextSelection, messages, draftCards, viewMode, documents, sessionTargetOverride]);

  // Whether the active session has drafts that were never persisted to the
  // learning-item DB. Used to decide whether "New session" must confirm.
  const hasUnpersistedDrafts = useMemo(
    () => draftCards.some((c) => !c.alreadyPersisted),
    [draftCards],
  );

  /**
   * Switch the live workspace to a target session: flush the outgoing session,
   * mark the target active, hydrate its state, and refresh the sessions cache.
   */
  const switchToSession = useCallback((targetId: string) => {
    // Flush the outgoing session before swapping the active id, so a pending
    // debounced save can't fire against the wrong session.
    if (activeSessionId && activeSessionId !== targetId) {
      const doc = documents.find((d) => d.id === selectedDocumentId);
      updateStudioSession(activeSessionId, {
        selectedProviderId,
        selectedNotebookId,
        selectedDocumentId,
        selectedDeckId,
        contextSelection,
        messages: messages.slice(-50),
        draftCards: draftCards.slice(0, 100),
        viewMode,
        documentName: doc?.title,
        flashcardTargetOverride: sessionTargetOverride,
      });
    }
    persistActiveSessionId(targetId);
    setActiveSessionId(targetId);
    const target = getSession(targetId);
    hydrateFromSession(target);
    setSessionsCache(loadSessions());
  }, [activeSessionId, selectedProviderId, selectedNotebookId, selectedDocumentId, selectedDeckId, contextSelection, messages, draftCards, viewMode, documents, hydrateFromSession, sessionTargetOverride]);

  /**
   * Create a fresh empty session and switch to it. When `carryDrafts` is true,
   * the current drafts are copied into the new session (e.g. when the user
   * chooses "Keep drafts" in the discard confirmation).
   */
  const startFreshSession = useCallback((opts: { carryDrafts?: boolean } = {}) => {
    const carriedDrafts = opts.carryDrafts ? draftCards : [];
    const fresh = createStudioSession({
      draftCards: carriedDrafts,
      contextSelection: { ...DEFAULT_CONTEXT_SELECTION },
    });
    saveSessions([fresh, ...loadSessions()]);
    persistActiveSessionId(fresh.id);
    setActiveSessionId(fresh.id);
    // Hydrate to a clean slate (empty chat + default context), optionally
    // carrying drafts. The flashcard generation target always resets to the
    // current global default on a new session — it never inherits a prior
    // session's override.
    setMessages([]);
    setContextSelection({ ...DEFAULT_CONTEXT_SELECTION });
    setDraftCards(carriedDrafts);
    setSessionTargetOverride(undefined);
    setViewMode("chat");
    setSessionsCache(loadSessions());
  }, [draftCards]);

  // Resume a past session from the Sessions view (see §5).
  const handleResumeSession = useCallback((id: string) => {
    switchToSession(id);
    setViewMode("chat");
  }, [switchToSession]);

  // Delete a session; if it was active, a fresh empty one is created upstream.
  const handleDeleteSession = useCallback((id: string) => {
    const newActiveId = deleteStudioSession(id);
    setActiveSessionId(newActiveId);
    if (id === activeSessionId) {
      const fresh = getSession(newActiveId);
      hydrateFromSession(fresh);
    }
    setSessionsCache(loadSessions());
  }, [activeSessionId, hydrateFromSession]);

  const handleRenameSession = useCallback((id: string, title: string) => {
    renameStudioSession(id, title);
    setSessionsCache(loadSessions());
  }, []);

  /**
   * Begin a new session. If the active session has drafts that were never
   * persisted to the learning-item DB, ask the user whether to keep or discard
   * them; otherwise start a clean session immediately.
   */
  const handleNewSession = useCallback(() => {
    if (hasUnpersistedDrafts) {
      setShowNewSessionDialog(true);
      return;
    }
    startFreshSession({ carryDrafts: false });
  }, [hasUnpersistedDrafts, startFreshSession]);

  const confirmNewSession = useCallback((choice: "keep" | "clean") => {
    setShowNewSessionDialog(false);
    startFreshSession({ carryDrafts: choice === "keep" });
  }, [startFreshSession]);

  const commitRename = useCallback(() => {
    if (renamingSessionId && renameValue.trim()) {
      handleRenameSession(renamingSessionId, renameValue);
    }
    setRenamingSessionId(null);
    setRenameValue("");
  }, [renamingSessionId, renameValue, handleRenameSession]);

  const beginRename = useCallback((session: FlashcardStudioSession) => {
    setRenamingSessionId(session.id);
    setRenameValue(session.title);
  }, []);

  const confirmDeleteSession = useCallback(() => {
    if (deletingSessionId) {
      handleDeleteSession(deletingSessionId);
    }
    setDeletingSessionId(null);
  }, [deletingSessionId, handleDeleteSession]);

  useEffect(() => {
    if (!isOpen) return;

    // One-time legacy migration + ensure an active session exists.
    const activeId = migrateLegacyState();
    setActiveSessionId(activeId);
    setSessionsCache(loadSessions());

    const session = getSession(activeId);
    hydrateFromSession(session);
    if (!session?.selectedDeckId && activeDeckIds[0]) {
      setSelectedDeckId(activeDeckIds[0]);
    }

    // Legacy generation-history log is retained read-only for display.
    const historyRaw = localStorage.getItem(HISTORY_KEY);
    if (historyRaw) {
      try {
        const parsed = JSON.parse(historyRaw);
        if (Array.isArray(parsed)) setGenerationHistory(parsed.slice(0, 20));
      } catch {
        // ignore
      }
    }
  }, [isOpen]);

  // Debounced save: write current component state back into the active session.
  useEffect(() => {
    if (!isOpen || !activeSessionId) return;
    flushActiveSession();
    // Refresh the cached list so the Sessions view reflects live changes.
    setSessionsCache(loadSessions());
  }, [isOpen, activeSessionId, selectedProviderId, selectedNotebookId, selectedDocumentId, selectedDeckId, contextSelection, messages, draftCards, viewMode, flushActiveSession, sessionTargetOverride]);

  // Refresh the sessions list whenever the Sessions view is opened, so it
  // reflects any external changes (e.g. migration, or another tab's edits).
  useEffect(() => {
    if (!isOpen) return;
    if (viewMode === "sessions") {
      setSessionsCache(loadSessions());
    }
  }, [isOpen, viewMode]);

  // Auto-scroll messages within the container only
  useEffect(() => {
    if (!isOpen) return;
    // Use requestAnimationFrame to ensure DOM is updated before scrolling
    requestAnimationFrame(() => {
      if (messagesContainerRef.current && messagesEndRef.current && shouldAutoScrollRef.current) {
        const container = messagesContainerRef.current;
        // Use scrollHeight; offsetTop math is brittle in nested/fixed layouts.
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      }
    });
  }, [messages, isOpen]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // If the user scrolls up, don't yank them back to the bottom.
    shouldAutoScrollRef.current = distanceToBottom < 80;
  }, []);

  // Auto-scroll draft cards to top when new cards are added (they're prepended)
  useEffect(() => {
    if (!isOpen || draftCards.length === 0) return;
    requestAnimationFrame(() => {
      if (draftCardsContainerRef.current) {
        draftCardsContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }, [draftCards.length, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey) {
        // A configuration sheet owns Escape while it is open. Both its listener
        // and this one are on `document`, and the sheet's stopPropagation()
        // does not stop sibling listeners on the same node — without this guard
        // Escape would dismiss the sheet *and* close the whole Studio.
        if (activeSheet) return;
        if (editingCardId) {
          setEditingCardId(null);
        } else if (viewMode !== "chat") {
          setViewMode("chat");
        } else {
          onClose();
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (input.trim() && !isSending) {
          void handleSend();
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        handleNewSession();
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        const selected = draftCards.filter((c) => c.selected);
        if (selected.length > 0 && !isSaving) {
          void handleSaveSelected();
        }
      }

      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        const activeElement = document.activeElement;
        if (activeElement?.tagName !== "INPUT" && activeElement?.tagName !== "TEXTAREA") {
          setShowShortcuts(true);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, input, isSending, isSaving, draftCards, editingCardId, viewMode, onClose, handleNewSession, activeSheet]);

  // Never leave a sheet key set behind a closed modal — reopening the Studio
  // would otherwise mount straight into that sheet.
  useEffect(() => {
    if (!isOpen) setActiveSheet(null);
  }, [isOpen]);

  // Grow the mobile composer to fit its content. Driven off `input` rather than
  // the change handler so programmatic edits (templates, section mentions,
  // restored sessions) resize it too. Desktop keeps its fixed 3 rows.
  useEffect(() => {
    if (!isMobileShell) {
      setComposerHeight(undefined);
      return;
    }
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    setComposerHeight(textarea.scrollHeight);
  }, [input, isMobileShell, isOpen, viewMode, mobileActivePanel]);

  const currentProvider = useMemo(() => {
    if (!selectedProviderId) return null;
    return enabledProviders.find((p) => p.id === selectedProviderId) || null;
  }, [enabledProviders, selectedProviderId]);
  const isNotebookProviderSelected = selectedProviderId === NOTEBOOKLM_PROVIDER_ID;
  const isOnDeviceProviderSelected = isCatalogOnDeviceProviderId(selectedProviderId);
  const selectedOnDeviceProvider = availableOnDeviceProviders.find(
    (option) => option.id === selectedProviderId
  );
  const backdropDismiss = useBackdropDismiss(onClose);
  // OpenRouter (and other aggregator/custom-model setups) can point at any current or
  // future vision-capable model; the name-based heuristic below is necessarily incomplete,
  // so it only downgrades to a soft warning instead of hard-disabling the button.
  const hasModelConfigured = Boolean(currentProvider && currentProvider.model?.trim());
  const isRecognizedVisionModel = useMemo(
    () =>
      Boolean(
        currentProvider &&
          modelSupportsImageInput(
            currentProvider.provider,
            currentProvider.model,
            currentProvider.baseUrl?.trim() || undefined
          )
      ),
    [currentProvider]
  );
  const canUseVisionOcclusion = hasModelConfigured;

  const currentModelPricing = useMemo(() => {
    if (!currentProvider?.model || !currentProvider?.modelPricing) return undefined;
    const modelInfo = currentProvider.modelPricing[currentProvider.model];
    return modelInfo?.pricing;
  }, [currentProvider]);

  const selectedDocument = useMemo(() => {
    if (!selectedDocumentId) return null;
    return documents.find((d) => d.id === selectedDocumentId) || null;
  }, [documents, selectedDocumentId]);
  const selectedMediaSections = useDocumentOutlineStore((state) =>
    selectedDocumentId ? state.mediaSectionsByDocId.get(selectedDocumentId) : undefined
  );
  const setSharedMediaSections = useDocumentOutlineStore((state) => state.setMediaSections);
  const mediaTranscriptText = useMemo(
    () => mediaTranscriptContextText(selectedMediaSections),
    [selectedMediaSections],
  );
  const isSelectedAudiobook = selectedDocument?.fileType === "audio"
    || selectedDocument?.tags?.some((tag) => tag.toLowerCase() === "audiobook")
    || false;
  const selectedDocumentText = useMemo(
    () => preferredStudioDocumentContextText(
      resolvedDocumentContent,
      selectedDocument?.content,
      selectedMediaSections,
    ),
    [resolvedDocumentContent, selectedDocument?.content, selectedMediaSections],
  );

  // Section tree for the `#` mention menu and section-focused context. The hook
  // auto-resolves PDF/EPUB outlines from useDocumentOutlineStore, so passing the
  // document text is enough. Same machinery the Assistant uses.
  const {
    tree: sectionTree,
    flat: sectionFlat,
  } = useDocumentSections({
    documentId: selectedDocument?.id,
    content: selectedDocumentText ?? "",
    useStoreOutline: true,
  });

  // Resolve the focused section ids back to nodes against the current tree.
  const selectedSectionNodes = useMemo<SectionNode[]>(() => {
    const ids = normalizeContextSelection(contextSelection).selectedSectionIds;
    if (ids.length === 0) return [];
    const byId = new Map(sectionFlat.map((node) => [node.id, node]));
    return ids.map((id) => byId.get(id)).filter((node): node is SectionNode => Boolean(node));
  }, [contextSelection, sectionFlat]);

  // Cheap token estimate for the focused sections (for cost/summary display).
  const focusedSectionTokens = useMemo(() => {
    if (selectedSectionNodes.length === 0) return 0;
    return selectedSectionNodes.reduce((sum, node) => sum + (node.content ? estimateTokens(node.content) : 0), 0);
  }, [selectedSectionNodes]);

  // Token figure shown on the mobile context chip. Uses the same estimator as
  // the Context Control panel so the chip and the sheet always agree.
  const chipContextTokens = useMemo(
    () =>
      estimateContextTokens({
        content: selectedDocumentText,
        title: selectedDocument?.title ?? "",
        selection: contextSelection,
        maxTokens,
        focusedSectionTokens,
      }),
    [selectedDocumentText, selectedDocument?.title, contextSelection, maxTokens, focusedSectionTokens]
  );

  // Concatenated focused-section text for the live cost estimator (sections
  // mode doesn't go through the contextContent memo, so we feed the estimator
  // directly). This is an estimate — actual resolution (neighbors, truncation)
  // happens at send time.
  const sectionsContextText = useMemo(() => {
    if (selectedSectionNodes.length === 0) return "";
    return selectedSectionNodes.map((node) => node.content || "").join("\n\n");
  }, [selectedSectionNodes]);

  // Whether the user is currently in section-focus mode (component-scope, used
  // by both the cost estimator and handleSend).
  const isSectionMode = normalizeContextSelection(contextSelection).mode === "sections";

  useEffect(() => {
    if (!isOpen || !selectedDocument) {
      setResolvedDocumentContent(undefined);
      setContextLoadState("idle");
      setContextLoadError(null);
      return;
    }

    // If extracted content is already available, prefer it immediately.
    if (selectedDocument.content?.trim()) {
      setResolvedDocumentContent(selectedDocument.content);
      setContextLoadState("ready");
      setContextLoadError(null);
      return;
    }

    // Audiobook chapters published by the viewer already contain authoritative
    // transcript text. They are valid context even when documents.content is
    // empty and the separate video-transcript HTTP service is unavailable.
    if (mediaTranscriptText) {
      setResolvedDocumentContent(mediaTranscriptText);
      setContextLoadState("ready");
      setContextLoadError(null);
      return;
    }

    let cancelled = false;
    setResolvedDocumentContent(undefined);
    setContextLoadState("loading");
    setContextLoadError(null);
    const resolveMediaTranscript = async () => {
      try {
        if (isSelectedAudiobook) {
          const sections = await loadAudiobookSectionCatalog(selectedDocument);
          const transcript = mediaTranscriptContextText(sections);
          if (transcript && !cancelled) {
            setSharedMediaSections(selectedDocument.id, sections);
            setResolvedDocumentContent(transcript);
            setContextLoadState("ready");
            setContextLoadError(null);
            return;
          }
          if (cancelled) return;
        }

        if (selectedDocument.fileType === "video" || selectedDocument.fileType === "audio") {
          // getVideoTranscript reaches a separate HTTP API (VITE_API_URL) that
          // usually isn't running in the browser/PWA. Surface a clear message
          // instead of silently leaving the user with no context.
          try {
            const transcript = await getVideoTranscript(selectedDocument.id);
            if (!cancelled) {
              setResolvedDocumentContent(transcript?.transcript?.trim() || undefined);
              setContextLoadState(transcript?.transcript?.trim() ? "ready" : "error");
            }
          } catch (transcriptError) {
            console.warn("Failed to resolve video/audio transcript", transcriptError);
            if (!cancelled) {
              setResolvedDocumentContent(undefined);
              setContextLoadState("error");
              setContextLoadError(t("flashcardStudio.transcriptUnavailableDesc"));
              toast.info(
                t("flashcardStudio.transcriptUnavailable"),
                t("flashcardStudio.transcriptUnavailableDesc")
              );
            }
          }
          return;
        }

        if (selectedDocument.fileType === "youtube") {
          const videoId = extractYouTubeID(selectedDocument.filePath);
          if (!videoId) {
            if (!cancelled) setResolvedDocumentContent(undefined);
            return;
          }
          const segments = await fetchYouTubeTranscript(videoId);
          if (!cancelled) {
            const transcript = segments.map((segment) => segment.text).join(" ").trim();
            setResolvedDocumentContent(transcript || undefined);
            setContextLoadState(transcript ? "ready" : "error");
            if (!transcript) setContextLoadError(t("flashcardStudio.transcriptUnavailableDesc"));
          }
          return;
        }

        const canonical = await loadDocumentQaText(selectedDocument.id, { getDocument, extractDocumentText });
        if (!cancelled) {
          setResolvedDocumentContent(canonical || undefined);
          setContextLoadState(canonical ? "ready" : "error");
          setContextLoadError(canonical ? null : "No readable text could be extracted from this document.");
        }
      } catch (error) {
        console.warn("Failed to resolve transcript content for flashcard context", error);
        if (!cancelled) {
          setResolvedDocumentContent(undefined);
          setContextLoadState("error");
          setContextLoadError(error instanceof Error ? error.message : "Document context could not be loaded.");
        }
      }
    };

    void resolveMediaTranscript();
    return () => {
      cancelled = true;
    };
  }, [isOpen, isSelectedAudiobook, mediaTranscriptText, selectedDocument, setSharedMediaSections, t]);

  const previousDocumentIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const previous = previousDocumentIdRef.current;
    previousDocumentIdRef.current = selectedDocumentId;
    if (previous && previous !== selectedDocumentId) {
      if (seededDocumentIdRef.current === selectedDocumentId) {
        seededDocumentIdRef.current = null;
      } else {
        setContextSelection(DEFAULT_CONTEXT_SELECTION);
      }
    }
  }, [isOpen, selectedDocumentId]);

  const selectedDeck = useMemo(() => {
    if (!selectedDeckId) return null;
    return decks.find((d) => d.id === selectedDeckId) || null;
  }, [decks, selectedDeckId]);

  const deckTags = useMemo(() => {
    if (!selectedDeck) return [];
    return selectedDeck.tagFilters.length > 0 ? selectedDeck.tagFilters : [selectedDeck.name];
  }, [selectedDeck]);

  const suggestedDeckName = useMemo(() => {
    const title = selectedDocument?.title?.trim();
    if (!title) return "";
    return title.replace(/\s*\([^)]*\)\s*$/, "").trim() || title;
  }, [selectedDocument]);

  const handleCreateDeck = useCallback((name: string) => {
    const trimmed = name.trim() || t("flashcardStudio.untitledDeck");
    addDeck(trimmed, [trimmed], selectedDocument?.id);
    const createdOrMatched = useStudyDeckStore
      .getState()
      .decks.find((deck) => deck.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (createdOrMatched) {
      toast.success(
        t("flashcardStudio.deckReady"),
        t("flashcardStudio.deckReadyDesc", { name: createdOrMatched.name })
      );
      return createdOrMatched.id;
    }
    return null;
  }, [addDeck, selectedDocument?.id, t, toast]);

  const contextContent = useMemo(() => {
    const normalizedSelection = normalizeContextSelection(contextSelection);
    const selectedChapters = normalizedSelection.chapters;

    switch (normalizedSelection.mode) {
      case "full":
        return selectedDocumentText?.slice(0, maxTokens * CHARS_PER_TOKEN);

      case "chapters": {
        if (!selectedDocumentText) return undefined;
        if (selectedChapters.length === 0) return undefined;
        const availableChapterNumbers = new Set(getChapterTitles(selectedDocumentText).map((chapter) => chapter.number));
        if (selectedChapters.some((chapter) => !availableChapterNumbers.has(chapter))) return undefined;
        const perChapterTokens = Math.floor(maxTokens / selectedChapters.length);
        return selectedChapters
          .map((num) => buildChapterQAContext(selectedDocument.title, selectedDocumentText, num, perChapterTokens))
          .join("\n\n---\n\n");
      }

      case "excerpt":
        // A seeded excerpt is self-sufficient even when the full EPUB body is
        // still loading. An empty explicit excerpt is invalid; never broaden it.
        return normalizedSelection.excerpt.trim() || undefined;

      case "pages":
        // Approximate: assume 500 words per page, 4 chars per word
        if (!selectedDocumentText) return undefined;
        if (normalizedSelection.pageRange) {
          const charsPerPage = 2000;
          const start = (normalizedSelection.pageRange.start - 1) * charsPerPage;
          const end = normalizedSelection.pageRange.end * charsPerPage;
          const pageContent = selectedDocumentText.slice(start, end).trim();
          return pageContent || undefined;
        }
        return undefined;

      case "search":
        return normalizedSelection.excerpt.trim() || undefined;

      case "sections":
        // Resolution is deferred to send time so ranges are computed against
        // freshly fetched document text (mirrors AssistantPanel). The cost
        // estimator uses the cheap focusedSectionTokens estimate instead.
        return undefined;

      default:
        return undefined;
    }
  }, [selectedDocument, selectedDocumentText, contextSelection, maxTokens]);

  // The flashcard generation target currently in effect for this session:
  // the session-local override if the user set one, otherwise the global AI
  // settings default. Auto mode scales with the size of the selected context
  // (falling back to the whole document when the exact context isn't
  // resolvable yet, e.g. `sections` mode, which resolves at send time).
  const effectiveFlashcardTarget = useMemo(
    () => resolveFlashcardTarget(aiControls, contextContent ?? selectedDocumentText ?? "", sessionTargetOverride),
    [aiControls, contextContent, selectedDocumentText, sessionTargetOverride]
  );

  const contextValidationError = useMemo(() => {
    if (!selectedDocument) return null;
    if (contextLoadState === "loading") return "Document context is still loading.";
    if (contextLoadState === "error" && !selectedDocumentText) return contextLoadError || "Document context is unavailable.";
    if (contextSelection.mode === "full") return selectedDocumentText?.trim() ? null : "No readable document text is available.";
    if (contextContent?.trim()) return null;
    if (contextSelection.mode === "chapters") return "Select an available chapter before generating cards.";
    if (contextSelection.mode === "pages") return "Apply a valid page range that contains document text.";
    if (contextSelection.mode === "excerpt") return "Add an excerpt before generating cards.";
    if (contextSelection.mode === "search") return "Search the document and select a result before generating cards.";
    if (contextSelection.mode === "sections") {
      // Resolution happens at send time; here we only ensure the focus is non-empty.
      // Stale/unresolvable sections are surfaced as errors from resolveSectionFocusedContext.
      const ids = normalizeContextSelection(contextSelection).selectedSectionIds;
      if (ids.length === 0) return t("flashcardStudio.sectionsEmpty");
      // Section ids may exist but no longer resolve against the current tree.
      if (selectedSectionNodes.length === 0) return t("flashcardStudio.sectionsUnresolvable");
      return null;
    }
    return "Choose valid document context before generating cards.";
  }, [contextContent, contextLoadError, contextLoadState, contextSelection, selectedDocument, selectedDocumentText, selectedSectionNodes, t]);

  const stats = useMemo(() => {
    const selected = draftCards.filter((c) => c.selected);
    return {
      total: draftCards.length,
      selected: selected.length,
      qa: selected.filter((c) => c.type === "qa").length,
      cloze: selected.filter((c) => c.type === "cloze").length,
      multipleChoice: selected.filter((c) => c.type === "multiple-choice").length,
      imageOcclusion: selected.filter((c) => c.type === "image-occlusion").length,
    };
  }, [draftCards]);

  const createBlankDraftCard = useCallback((type: DraftCardType): DraftCard => {
    const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const seededExcerpt = contextSelection.excerpt?.trim() || "";
    const base: DraftCard = {
      id,
      type,
      selected: true,
      createdAt: Date.now(),
      tags: [],
    };

    if (type === "qa") {
      return { ...base, question: "", answer: "" };
    }
    if (type === "cloze") {
      return { ...base, text: seededExcerpt };
    }
    if (type === "multiple-choice") {
      return {
        ...base,
        question: "",
        answer: "",
        multipleChoiceOptions: [
          { id: "choice-1", text: "" },
          { id: "choice-2", text: "" },
        ],
        multipleChoiceCorrectOptionId: "choice-1",
      };
    }
    return {
      ...base,
      question: "",
      answer: "",
      imageOcclusionAssetId: selectedImageAssetIds[0],
      imageOcclusionRegions: [],
    };
  }, [contextSelection.excerpt, selectedImageAssetIds]);

  useEffect(() => {
    if (!isOpen) {
      appliedSeedKeyRef.current = null;
      seededExtractIdRef.current = null;
      setLanguageSourceConfirmed(false);
      return;
    }
    if (!seed?.key || appliedSeedKeyRef.current === seed.key) {
      return;
    }

    appliedSeedKeyRef.current = seed.key;
    setLanguageSourceConfirmed(false);
    seededExtractIdRef.current = seed.linkedExtractId ?? null;

    // If a seed arrives while the active session already has chat/drafts, start
    // a fresh session so the seed targets a clean workspace (carrying the seed
    // draft rather than the old pile). A bare document/excerpt seed without a
    // draft, applied to an empty session, just updates that session in place.
    const activeSessionHasContent = messages.length > 0 || draftCards.length > 0;
    const seedCreatesDraft = Boolean(seed.resetDraftCards || seed.draftCardType || seed.extractId);
    if (activeSessionHasContent && seedCreatesDraft) {
      startFreshSession({ carryDrafts: false });
    }

    if (seed.documentId !== undefined) {
      seededDocumentIdRef.current = seed.documentId;
      setSelectedDocumentId(seed.documentId);
    }

    if (seed.excerpt?.trim()) {
      setContextSelection({
        ...DEFAULT_CONTEXT_SELECTION,
        mode: "excerpt",
        excerpt: seed.excerpt,
      });
    }

    if (seed.resetDraftCards || seed.draftCardType) {
      const nextCard = createBlankDraftCard(seed.draftCardType || "qa");
      if ((seed.draftCardType || "qa") === "cloze" && seed.excerpt?.trim()) {
        nextCard.text = seed.excerpt.trim();
      }
      nextCard.extractId = seed.linkedExtractId;
      if (seed.draftCardType === "image-occlusion" && seed.imageAssetId) {
        nextCard.imageOcclusionAssetId = seed.imageAssetId;
        setSelectedImageAssetIds([seed.imageAssetId]);
      }
      // Apply a transient deck tag (e.g. from `:deck <name>`) to the new card.
      if (seed.deckTag?.trim()) {
        nextCard.tags = [...(nextCard.tags ?? []), seed.deckTag.trim()];
      }
      setDraftCards([nextCard]);
      setFlippedCardId(null);
      setEditingCardId(seed.autoEditDraft === false ? null : nextCard.id);
      setViewMode("chat");
    }

    // Auto-generate flashcards from extract if seed includes extractId
    if (seed.extractId) {
      // Use microtask to let the modal render first
      queueMicrotask(() => {
        handleGenerateFromExtract(seed.extractId!);
      });
    }
  }, [isOpen, seed, createBlankDraftCard, startFreshSession, messages.length, draftCards.length]);

  // Image occlusion now opens the Image Occlusion Composer (mounted at the app
  // shell) for the selected image, where AI suggestion happens in-context with
  // per-region review. The usable/needs-manual-authoring bucket split is gone.
  const handleGenerateImageOcclusions = () => {
    if (isSending) return;
    if (!currentProvider) {
      toast.error(t("flashcardStudio.noLlmProvider"), t("flashcardStudio.noLlmProviderDesc"));
      return;
    }
    if (!canUseVisionOcclusion) {
      toast.error(t("flashcardStudio.imageOcclusionVisionUnsupported"), t("flashcardStudio.imageOcclusionVisionUnsupportedDesc"));
      return;
    }
    if (selectedImageAssetIds.length === 0) {
      toast.error(t("flashcardStudio.noImageSelected"), t("flashcardStudio.noImageSelectedDesc"));
      return;
    }
    window.dispatchEvent(
      new CustomEvent("plethora:create-image-occlusion", {
        detail: {
          assetId: selectedImageAssetIds[0],
          documentId: selectedDocument?.id ?? undefined,
          deckId: selectedDeck?.id,
        },
      }),
    );
  };

  const handleSend = async (customPrompt?: string) => {
    const promptText = customPrompt || input;
    if (!promptText.trim() || isSending) return;
    if (!isNotebookProviderSelected && !isOnDeviceProviderSelected && !currentProvider) {
      toast.error(t("flashcardStudio.noLlmProvider"), t("flashcardStudio.noLlmProviderDesc"));
      return;
    }
    if (isNotebookProviderSelected && !selectedNotebookId) {
      toast.error(t("flashcardStudio.noNotebookSelected"), t("flashcardStudio.noNotebookSelectedDesc"));
      return;
    }
    if (selectedDocument && contextValidationError) {
      toast.error("Context unavailable", contextValidationError);
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: promptText.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);
    setViewMode("chat");

    try {
      if (isOnDeviceProviderSelected) {
        // Gemini Nano's context window is ~3k tokens, far below what the studio
        // normally sends, so this does NOT go through chatWithContext. It hands
        // the source text to the on-device SDK, which chunks it, runs one
        // inference per chunk, and parses the line-oriented output. Nano emits
        // malformed JSON too often for parseCardsFromResponse's JSON path to be
        // reliable (see design.md decision 4).
        const sourceText =
          contextContent?.trim() || selectedDocumentText?.trim() || promptText.trim();
        const explicit = extractExplicitCardCount(promptText);
        const target = explicit ?? resolveFlashcardTarget(aiControls, sourceText).count;

        const generated = await withOnDeviceRun("Flashcard generation", ({ signal, onProgress }) =>
          generateFlashcardsWithRouter(sourceText, {
            count: target,
            tags: [ON_DEVICE_TAG],
            signal,
            onProgress,
            providerId: selectedProviderId ?? undefined,
          }),
        );

        const assistantId = `assistant-${Date.now()}`;
        const cards: DraftCard[] = generated.map((card, index) => ({
          id: `ondevice-${assistantId}-${index}`,
          type: card.card_type === "cloze" ? ("cloze" as const) : ("qa" as const),
          question: card.question,
          answer: card.answer,
          // A cloze draft carries its sentence in `text`; `question` holds it too
          // so the card reads correctly in either renderer.
          text: card.card_type === "cloze" ? card.question : undefined,
          selected: true,
          sourceMessageId: assistantId,
          createdAt: Date.now(),
          tags: card.tags,
        }));

        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content:
              cards.length > 0
                ? t("flashcardStudio.onDeviceGenerated", { count: cards.length })
                : t("flashcardStudio.onDeviceNoCards"),
            timestamp: Date.now(),
            cardsGenerated: cards.length,
          },
        ]);

        if (cards.length > 0) {
          setDraftCards((prev) => [...cards, ...prev]);
          toast.success(
            t("flashcardStudio.cardsGenerated", { count: cards.length }),
            t("flashcardStudio.cardsGeneratedDesc"),
          );
          const historyItem: GenerationHistoryItem = {
            id: assistantId,
            prompt: promptText.trim(),
            timestamp: Date.now(),
            cardCount: cards.length,
            documentName: selectedDocument?.title,
          };
          setGenerationHistory((prev) => [historyItem, ...prev.slice(0, 19)]);
          localStorage.setItem(
            HISTORY_KEY,
            JSON.stringify([historyItem, ...generationHistory.slice(0, 19)]),
          );
        }
        return;
      }

      if (isNotebookProviderSelected) {
        const notebookTitle = notebooks.find((n) => n.id === selectedNotebookId)?.title || "NotebookLM";
        const contextBlocks: string[] = [promptText.trim()];
        if (selectedDocument?.title) {
          contextBlocks.push(`Document title: ${selectedDocument.title}`);
        }
        if (selectedDeck?.name) {
          contextBlocks.push(`Target deck: ${selectedDeck.name}`);
        }
        if (contextContent?.trim()) {
          contextBlocks.push(`Reference context:\n${contextContent.trim()}`);
        }

        const job = await notebooklmGenerateArtifact({
          notebookId: selectedNotebookId,
          artifactType: "flashcards",
          instructions: contextBlocks.join("\n\n"),
        });
        if (job.status === "failed" || job.status === "expired-auth") {
          throw new Error(job.error || `NotebookLM job failed with status ${job.status}`);
        }

        const previewItems = await notebooklmPreviewFlashcards(job.id);
        const generated = previewItems.map((item, index) => ({
          id: `notebooklm-${job.id}-${index}-${Date.now()}`,
          type: "qa" as const,
          question: item.question,
          answer: item.answer,
          selected: true,
          sourceMessageId: job.id,
          createdAt: Date.now(),
          tags: item.tags || [],
        }));
        const payloadFallback = job.payload.flashcards.map((card, index) => ({
          id: `notebooklm-${job.id}-payload-${index}-${Date.now()}`,
          type: "qa" as const,
          question: card.question,
          answer: card.answer,
          selected: true,
          sourceMessageId: job.id,
          createdAt: Date.now(),
          tags: card.tags || [],
        }));
        const cards = generated.length > 0 ? generated : payloadFallback;

        const assistantId = `assistant-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content:
              cards.length > 0
                ? `NotebookLM generated ${cards.length} flashcards from "${notebookTitle}".`
                : `NotebookLM completed the request for "${notebookTitle}", but no flashcards were returned.`,
            timestamp: Date.now(),
            cardsGenerated: cards.length,
          },
        ]);

        if (cards.length > 0) {
          setDraftCards((prev) => [...cards, ...prev]);
          toast.success(t("flashcardStudio.cardsGenerated", { count: cards.length }), t("flashcardStudio.cardsGeneratedDesc"));
          const historyItem: GenerationHistoryItem = {
            id: assistantId,
            prompt: promptText.trim(),
            timestamp: Date.now(),
            cardCount: cards.length,
            documentName: selectedDocument?.title,
          };
          setGenerationHistory((prev) => [historyItem, ...prev.slice(0, 19)]);
          localStorage.setItem(HISTORY_KEY, JSON.stringify([historyItem, ...generationHistory.slice(0, 19)]));
        }
        return;
      }

      const history: LLMMessage[] = messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }));

      // An explicit count stated in the user's own message (e.g. "give me 20
      // cards") takes precedence over the configured/resolved target for this
      // one generation; otherwise use the effective (session or global) target,
      // recomputed against the content actually being sent as context.
      const isTwentyRules = isTwentyRulesCommand(promptText);
      const explicitCount = extractExplicitCardCount(promptText);
      const resolvedTarget = explicitCount
        ? explicitCount
        : resolveFlashcardTarget(
            aiControls,
            contextContent ?? selectedDocumentText ?? "",
            sessionTargetOverride
          ).count;

      const llmMessages: LLMMessage[] = [{ role: "system", content: buildSystemPrompt(resolvedTarget, isTwentyRules) }];
      
      // Add context-specific system messages
      if (selectedDocument?.title) {
        let contextDesc = `Use the document titled "${selectedDocument.title}"`;
        const selectedChapters = Array.isArray(contextSelection.chapters) ? contextSelection.chapters : [];
        
        if (contextSelection.mode === "chapters" && selectedChapters.length > 0) {
          const chapters = getChapterTitles(selectedDocumentText || "");
          const chapterNames = selectedChapters
            .map((num) => chapters.find((c) => c.number === num)?.title || `Chapter ${num}`)
            .join(", ");
          contextDesc += `, focusing on: ${chapterNames}`;
        } else if (contextSelection.mode === "sections" && selectedSectionNodes.length > 0) {
          // Use labels resolved against the current tree (breadcrumb > title).
          const sectionNames = selectedSectionNodes.map(sectionLabel).join(", ");
          contextDesc += `, focusing on: ${sectionNames}`;
        } else if (contextSelection.mode === "pages" && contextSelection.pageRange) {
          contextDesc += `, pages ${contextSelection.pageRange.start}-${contextSelection.pageRange.end}`;
        } else if (contextSelection.mode === "excerpt") {
          contextDesc += `, specifically the selected excerpt`;
        } else if (contextSelection.mode === "search") {
          contextDesc += `, focusing on search results`;
        }
        
        llmMessages.push({ role: "system", content: contextDesc });
      }
      
      if (selectedDeck) {
        llmMessages.push({
          role: "system",
          content: `Create cards suitable for the "${selectedDeck.name}" deck.`,
        });
      }
      
      llmMessages.push(...history, { role: "user", content: userMessage.content });

      // Section-focused resolution (mirrors AssistantPanel). At send time,
      // structural headings use freshly fetched document text while timed media
      // chapters use their authoritative attached transcript. The contextContent
      // memo deliberately returns undefined for `sections` mode. On success we
      // override the context sent to the LLM, rewrite the last user message to
      // wrap the focused body, and stamp sourceContext for provenance.
      let effectiveContextContent = contextContent;
      let sectionSourceContext: SectionSourceReference | undefined;
      let sectionTruncatedNote = "";
      const shouldResolveSections = normalizeContextSelection(contextSelection).mode === "sections";
      if (shouldResolveSections && selectedSectionNodes.length > 0 && selectedDocument) {
        const documentId = selectedDocument.id;

        // Transcript-backed audiobook chapters carry authoritative attached
        // content and must not be forced through character-range resolution.
        // Structural headings retain the fresh-text load and one-time rebuild.
        const focused = await resolveStudioSectionContext({
          selectedSections: selectedSectionNodes,
          availableSections: sectionFlat,
          documentId,
          maxTokens,
          currentText: selectedDocumentText,
          loadCanonicalText: () => loadDocumentQaText(documentId, { getDocument, extractDocumentText }),
          rebuildAvailableSections: (freshText) => {
            const freshFlat = buildSectionsSnapshot(
              documentId,
              freshText,
              useDocumentOutlineStore.getState().getOutline(documentId),
            ).flat;
            const directSections = sectionFlat.filter(
              (section) => section.source === "selection" || section.source === "media-transcript",
            );
            const directIds = new Set(directSections.map((section) => section.id));
            return [
              ...directSections,
              ...freshFlat.filter((section) => !directIds.has(section.id)),
            ];
          },
        });

        if (!focused.ok) {
          const reasons = focused.unresolved.map(describeSectionDiagnostic).join("; ");
          throw new Error(t("flashcardStudio.sectionUnresolved", { reasons }));
        }

        effectiveContextContent = focused.content;
        sectionSourceContext = focused.source;
        if (focused.truncated) sectionTruncatedNote = t("flashcardStudio.sectionTruncated");

        const request = createDocumentQaRequestContent({
          documentContext: focused.content,
          userQuestion: promptText.replace(SECTION_REGEX, "").trim(),
          focusLabel: focused.labels.join(", "),
        });
        SECTION_REGEX.lastIndex = 0;
        const lastUserIdx = llmMessages.map((message) => message.role).lastIndexOf("user");
        if (lastUserIdx >= 0) llmMessages[lastUserIdx] = { role: "user", content: request.userPromptContent };
      }

      // Use 'general' context type only when there is genuinely nothing to send.
      // A bare excerpt (e.g. selected EPUB text via right-click → Create Flashcard)
      // is enough to use document context even if the full document isn't loaded.
      const hasDocumentContent = !!(effectiveContextContent?.trim());
      const response = await chatWithContext(
        currentProvider.provider,
        currentProvider.model,
        llmMessages,
        {
          type: hasDocumentContent ? "document" : "general",
          documentId: hasDocumentContent ? selectedDocument?.id : undefined,
          content: effectiveContextContent,
          contextWindowTokens: maxTokens,
        },
        currentProvider.apiKey,
        currentProvider.baseUrl?.trim() || undefined,
        currentProvider.temperature,
        currentProvider.maxTokens,
        currentProvider.systemPrompt,
        aiControls.contextFromRelatedCards,
        aiControls.documentSnippetLength
      );

      const assistantId = `assistant-${Date.now()}`;
      const { cards, cleaned } = parseCardsFromResponse(response.content, assistantId);

      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: sectionTruncatedNote
          ? `${sectionTruncatedNote}\n\n${cleaned || response.content}`
          : cleaned || response.content,
        timestamp: Date.now(),
        cardsGenerated: cards.length,
        sourceContext: sectionSourceContext,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (cards.length > 0) {
        // Carry section provenance onto generated cards when applicable.
        const provenancedCards = sectionSourceContext
          ? cards.map((card) => ({ ...card, sourceContext: sectionSourceContext }))
          : cards;
        setDraftCards((prev) => [...provenancedCards, ...prev]);
        toast.success(t("flashcardStudio.cardsGenerated", { count: cards.length }), t("flashcardStudio.cardsGeneratedDesc"));
        
        const historyItem: GenerationHistoryItem = {
          id: assistantId,
          prompt: promptText.trim(),
          timestamp: Date.now(),
          cardCount: cards.length,
          documentName: selectedDocument?.title,
        };
        setGenerationHistory((prev) => [historyItem, ...prev.slice(0, 19)]);
        localStorage.setItem(HISTORY_KEY, JSON.stringify([historyItem, ...generationHistory.slice(0, 19)]));
      }
    } catch (error) {
      toast.error(t("flashcardStudio.generationFailed"), error instanceof Error ? error.message : t("flashcardStudio.failedReachLlm"));
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "system",
          content: `Error: ${error instanceof Error ? error.message : "Failed to reach the LLM"}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveSelected = async () => {
    const selected = draftCards.filter((c) => c.selected);
    if (selected.length === 0 || isSaving || saveInFlightRef.current) return;
    if (seed?.languageProvenance && !languageSourceConfirmed) {
      toast.info("Confirm the language source before saving", "The source fingerprint and origin will be stored with these cards.");
      return;
    }
    saveInFlightRef.current = true;

    // Separate already-persisted cards (from extract generation) from new drafts
    const alreadySaved = selected.filter((c) => c.alreadyPersisted);
    const toCreate = selected.filter((c) => !c.alreadyPersisted);

    if (toCreate.length === 0) {
      // All selected cards were already persisted — just clear them from drafts
      setDraftCards((prev) => prev.filter((c) => !c.selected));
      toast.success(t("flashcardStudio.cardsSaved"), t("flashcardStudio.cardsSavedDesc", { count: alreadySaved.length }));
      saveInFlightRef.current = false;
      return;
    }

    setIsSaving(true);

    try {
      const results = await Promise.all(
        toCreate.map(async (card) => {
          try {
            const baseInput: CreateLearningItemInput = {
              item_type: card.type === "cloze" ? "cloze" : "qa",
              question:
                card.type === "cloze"
                  ? (card.text || "").trim()
                  : (card.question || "").trim(),
              answer:
                card.type === "qa"
                  ? (card.answer || "").trim()
                  : card.type === "multiple-choice"
                  ? ((card.multipleChoiceOptions || []).find((option) => option.id === card.multipleChoiceCorrectOptionId)?.text || "").trim()
                  : (card.answer || "").trim(),
              cloze_text: card.type === "cloze" ? (card.text || "").trim() : undefined,
              extract_id: card.extractId ?? seededExtractIdRef.current ?? seed?.linkedExtractId,
              document_id: selectedDocument?.id ?? seed?.documentId ?? undefined,
              tags: [...deckTags, ...card.tags],
              image_asset_ids:
                card.type === "image-occlusion"
                  ? [card.imageOcclusionAssetId || selectedImageAssetIds[0]].filter(Boolean) as string[]
                  : selectedImageAssetIds,
              interaction_metadata:
                card.type === "multiple-choice"
                  ? {
                      interactionType: "multiple-choice",
                      multipleChoiceOptions: card.multipleChoiceOptions || [],
                      multipleChoiceCorrectOptionId: card.multipleChoiceCorrectOptionId,
                      multipleChoiceExplanation: card.answer || undefined,
                    }
                  : card.type === "image-occlusion"
                  ? {
                      interactionType: "image-occlusion",
                      imageOcclusionAssetId: card.imageOcclusionAssetId || selectedImageAssetIds[0],
                      imageOcclusionRegions: card.imageOcclusionRegions || [],
                      imageOcclusionPrompt: card.question || undefined,
                    }
                  : undefined,
            };

            if (seed?.languageProvenance) {
              baseInput.interaction_metadata = {
                ...(baseInput.interaction_metadata ?? {}),
                languageProvenance: seed.languageProvenance,
              };
            }

            if (card.type === "qa" && (!baseInput.question || !baseInput.answer)) {
              throw new Error("Q&A cards require both a question and an answer.");
            }
            if (card.type === "cloze" && !baseInput.cloze_text) {
              throw new Error("Cloze cards require cloze text.");
            }
            if (
              card.type === "multiple-choice" &&
              (
                !baseInput.question ||
                (card.multipleChoiceOptions || []).filter((option) => option.text.trim().length > 0).length < 2 ||
                !card.multipleChoiceCorrectOptionId
              )
            ) {
              throw new Error("Multiple choice cards require a question, at least two options, and a correct answer.");
            }
            if (
              card.type === "image-occlusion" &&
              (
                !((card.imageOcclusionAssetId || selectedImageAssetIds[0])) ||
                (card.imageOcclusionRegions || []).length === 0
              )
            ) {
              throw new Error("Image occlusion cards require an image and at least one hidden region.");
            }

            await createLearningItem(baseInput);
            return { id: card.id, success: true };
          } catch (error) {
            // If the backend rejected it as a semantic duplicate, the card is
            // already in the DB — treat it as a successful save.
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.includes("Potential duplicate detected") || msg.includes("duplicate")) {
              console.warn("Card already exists (duplicate), treating as saved:", card.id);
              return { id: card.id, success: true, wasDuplicate: true };
            }
            console.error("Failed to create card", error);
            return { id: card.id, success: false };
          }
        })
      );

      const failedIds = results.filter((r) => !r.success).map((r) => r.id);
      const newlySaved = toCreate.length - failedIds.length;
      const savedCount = alreadySaved.length + newlySaved;

      // Materialize every deck reference among the saved cards in the same
      // action: the picker deck's tags, the transient `:deck` seed, and any
      // `deck:` tags. A deck referenced at creation must be immediately
      // visible in Deck Manager (parity invariant, issue #44 bug 10).
      if (newlySaved > 0) {
        const savedDeckNames = new Set<string>(deckTags);
        if (seed?.deckTag?.trim()) savedDeckNames.add(seed.deckTag.trim());
        for (const card of toCreate) {
          for (const tag of card.tags ?? []) {
            if (tag.toLowerCase().startsWith("deck:")) {
              const name = tag.slice(5).trim();
              if (name) savedDeckNames.add(name);
            }
          }
        }
        if (savedDeckNames.size > 0) {
          useStudyDeckStore.getState().ensureDecksExist([...savedDeckNames]);
        }
      }
      // Remove all selected cards from drafts (persisted ones + successfully created ones).
      // Keep failed ones so the user can retry.
      const idsToRemove = new Set([
        ...alreadySaved.map((c) => c.id),
        ...toCreate.filter((c) => !failedIds.includes(c.id)).map((c) => c.id),
      ]);
      setDraftCards((prev) => prev.filter((c) => !idsToRemove.has(c.id)));
      
      if (failedIds.length > 0) {
        toast.error(t("flashcardStudio.someCardsFailed"), t("flashcardStudio.someCardsFailedDesc", { saved: savedCount, failed: failedIds.length }));
      } else {
        toast.success(t("flashcardStudio.cardsSaved"), t("flashcardStudio.cardsSavedDesc", { count: savedCount }));
      }
    } finally {
      setIsSaving(false);
      saveInFlightRef.current = false;
    }
  };

  const handleUseExtractAsContext = useCallback((extract: Extract) => {
    setSelectedDocumentId(extract.document_id);
    setContextSelection({ ...DEFAULT_CONTEXT_SELECTION, mode: "excerpt", excerpt: extract.content });
    setViewMode("chat");
  }, []);

  const handleCreateCardFromExtract = useCallback((extract: Extract) => {
    const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const card: DraftCard = {
      id,
      type: "qa",
      question: extract.content.trim(),
      answer: "",
      extractId: extract.id,
      selected: true,
      createdAt: Date.now(),
      tags: [],
    };
    setDraftCards((prev) => [card, ...prev]);
    setEditingCardId(card.id);
    setSelectedDocumentId(extract.document_id);
  }, []);

  const handleGenerateFromExtract = useCallback(async (extractId: string) => {
    setGeneratingExtractIds((prev) => new Set(prev).add(extractId));
    try {
      const items = await generateLearningItemsFromExtract(extractId);
      const newDrafts: DraftCard[] = items.map((item, idx) => {
        // The local Rust generator creates cloze cards with question=[...] and answer=hidden_word
        // but never sets cloze_text. Convert to proper {{c1::}} format for the DraftCard.
        if (item.item_type === "Cloze") {
          const clozeText = item.cloze_text
            || (item.question && item.answer
              ? item.question.replace(/\[\.\.\.\]/g, `{{c1::${item.answer}}}`)
              : item.question || "");
          return {
            id: `draft-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
            type: "cloze" as const,
            question: item.question || "",
            answer: item.answer,
            text: clozeText,
            selected: true,
            createdAt: Date.now(),
            tags: item.tags || [],
            alreadyPersisted: true,
            persistedItemId: item.id,
          };
        }
        return {
          id: `draft-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
          type: "qa" as const,
          question: item.question || "",
          answer: item.answer || "",
          text: item.cloze_text,
          selected: true,
          createdAt: Date.now(),
          tags: item.tags || [],
          alreadyPersisted: true,
          persistedItemId: item.id,
        };
      });
      setDraftCards((prev) => [...newDrafts, ...prev]);
      toast.success(t("flashcardStudio.cardsGenerated", { count: newDrafts.length }));
    } catch (error) {
      console.error("Failed to generate cards from extract", error);
      toast.error(t("flashcardStudio.extractGenerationFailed"), String(error));
    } finally {
      setGeneratingExtractIds((prev) => {
        const next = new Set(prev);
        next.delete(extractId);
        return next;
      });
    }
  }, [t]);

  const ingestFilesIntoRegistry = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setIsImageImporting(true);
    try {
      const previousIds = new Set(imageAssets.map((asset) => asset.id));
      const imported = await Promise.all(files.map((file) => ingestImageFile(file)));
      const importedIds = imported.map((asset) => asset.id);
      const duplicateCount = importedIds.filter((id) => previousIds.has(id)).length;

      setImageAssets((prev) => {
        const merged = [...imported, ...prev];
        const dedup = new Map(merged.map((asset) => [asset.id, asset]));
        return Array.from(dedup.values());
      });
      setSelectedImageAssetIds((prev) => Array.from(new Set([...prev, ...importedIds])));

      if (duplicateCount > 0 && duplicateCount === imported.length) {
        toast.info(t("imageRegistry.duplicateReused"), t("imageRegistry.duplicateReusedDesc", { count: duplicateCount }));
      } else {
        toast.success(
          t("flashcardStudio.imagesImported"),
          duplicateCount > 0
            ? t("imageRegistry.assetsAddedWithDuplicates", { added: imported.length - duplicateCount, duplicates: duplicateCount })
            : t("flashcardStudio.imagesImportedDesc", { count: imported.length })
        );
      }
    } catch (error) {
      toast.error(t("flashcardStudio.imageImportFailed"), error instanceof Error ? error.message : t("flashcardStudio.unableImportImage"));
    } finally {
      setIsImageImporting(false);
    }
  }, [imageAssets, t, toast]);

  const toggleSelectedImageAsset = (assetId: string) => {
    setSelectedImageAssetIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  };

  const handleTemplateSelect = (template: QuickTemplate) => {
    setInput(template.prompt);
    inputRef.current?.focus();
    setViewMode("chat");
    
    if (!selectedDocument) {
      toast.info(t("flashcardStudio.selectDocumentFirst"), t("flashcardStudio.selectDocumentFirstDesc"));
    }
  };

  const toggleSelectAll = (value: boolean) => {
    setDraftCards((prev) => prev.map((c) => ({ ...c, selected: value })));
  };

  const handleAddTagToSelected = () => {
    if (!bulkTagInput.trim()) return;
    const tags = bulkTagInput.split(",").map((t) => t.trim()).filter(Boolean);
    setDraftCards((prev) =>
      prev.map((c) =>
        c.selected ? { ...c, tags: [...new Set([...c.tags, ...tags])] } : c
      )
    );
    setBulkTagInput("");
    setIsTagInputVisible(false);
    toast.success(t("flashcardStudio.tagsAdded"), t("flashcardStudio.tagsAddedDesc", { count: tags.length }));
  };

  const handleDeleteSelected = () => {
    setDraftCards((prev) => prev.filter((c) => !c.selected));
    toast.success(t("flashcardStudio.cardsRemoved"), t("flashcardStudio.cardsRemovedDesc"));
  };

  const handleEditCard = (cardId: string, updates: Partial<DraftCard>) => {
    if (Object.keys(updates).length === 0) {
      setEditingCardId(null);
      return;
    }
    setDraftCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, ...updates, isEditing: false } : c))
    );
    setEditingCardId(null);
    toast.success(t("flashcardStudio.cardUpdated"), t("flashcardStudio.cardUpdatedDesc"));
  };

  const duplicateCard = (card: DraftCard) => {
    const newCard: DraftCard = {
      ...card,
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: Date.now(),
      selected: true,
    };
    setDraftCards((prev) => [newCard, ...prev]);
    toast.success(t("flashcardStudio.cardDuplicated"), t("flashcardStudio.cardDuplicatedDesc"));
  };

  // Sections matching the current `#query` — used to drive keyboard navigation
  // for the popup (the popup itself filters/sorts internally with the same
  // scoring heuristics). Mirrors AssistantPanel.getFilteredAssistantSections.
  const filteredSectionOptions = useMemo<SectionNode[]>(() => {
    if (!showSectionPopup) return [];
    if (!sectionQuery) return sectionFlat;
    const q = sectionQuery.toLowerCase();
    return sectionFlat
      .map((sec) => {
        const titleLower = sec.title.toLowerCase();
        const breadLower = sec.breadcrumb.join(" > ").toLowerCase();
        let score = 0;
        if (titleLower.startsWith(q)) score += 100;
        else if (titleLower.includes(q)) score += 50;
        if (breadLower.includes(q)) score += 20;
        return { sec, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 100)
      .map((s) => s.sec);
  }, [showSectionPopup, sectionQuery, sectionFlat]);

  const handleInputChange = (value: string) => {
    setInput(value);

    // Only show the section popup when a document is selected.
    if (!selectedDocument) {
      setShowSectionPopup(false);
      setSectionQuery("");
      return;
    }

    const textarea = inputRef.current;
    const cursorPos = textarea ? textarea.selectionStart : value.length;
    const beforeCursor = value.slice(0, cursorPos);
    const hashMatch = beforeCursor.match(/#([^#\s]*)$/);

    if (hashMatch) {
      setShowSectionPopup(true);
      setSectionQuery(hashMatch[1]);
      setSectionCursorIndex(0);
    } else {
      setShowSectionPopup(false);
      setSectionQuery("");
    }

    // If no `#{...}` tokens remain, drop any stale section focus.
    const hasTokens = SECTION_REGEX.test(value);
    SECTION_REGEX.lastIndex = 0;
    if (!hasTokens && normalizeContextSelection(contextSelection).selectedSectionIds.length > 0) {
      setContextSelection((prev) => ({ ...normalizeContextSelection(prev), selectedSectionIds: [], mode: "full" }));
    }
  };

  const handleSelectStudioSection = (node: SectionNode) => {
    if (!inputRef.current) return;
    const textarea = inputRef.current;
    const cursorPos = textarea.selectionStart;
    const beforeCursor = input.slice(0, cursorPos);
    const hashMatch = beforeCursor.match(/#([^#\s]*)$/);
    if (!hashMatch) return;

    const hashPos = cursorPos - hashMatch[0].length;
    const token = `#{${node.title}}`;
    const newValue = input.slice(0, hashPos) + token + " " + input.slice(cursorPos);
    setInput(newValue);
    setShowSectionPopup(false);
    setSectionQuery("");

    setContextSelection((prev) => {
      const normalized = normalizeContextSelection(prev);
      if (normalized.selectedSectionIds.includes(node.id)) return { ...normalized, mode: "sections" };
      return { ...normalized, mode: "sections", selectedSectionIds: [...normalized.selectedSectionIds, node.id] };
    });

    setTimeout(() => {
      const newPos = hashPos + token.length + 1;
      textarea.setSelectionRange(newPos, newPos);
      textarea.focus();
    }, 0);
  };

  const handleRemoveSectionById = (id: string) => {
    const node = sectionFlat.find((n) => n.id === id);
    if (node) {
      const token = `#{${node.title}}`;
      setInput((current) => current.split(token).join("").replace(/[ \t]{2,}/g, " ").trim());
    }
    setContextSelection((prev) => {
      const normalized = normalizeContextSelection(prev);
      const nextIds = normalized.selectedSectionIds.filter((existing) => existing !== id);
      if (nextIds.length === 0) return { ...normalized, selectedSectionIds: [], mode: "full" };
      return { ...normalized, selectedSectionIds: nextIds };
    });
  };

  const handleInputKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (showSectionPopup) {
      const filtered = filteredSectionOptions;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSectionCursorIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : prev));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSectionCursorIndex((prev) => (prev > 0 ? prev - 1 : 0));
        return;
      }
      if (e.key === "Enter" && filtered.length > 0) {
        e.preventDefault();
        handleSelectStudioSection(filtered[sectionCursorIndex] || filtered[0]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSectionPopup(false);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (input.trim() && !isSending) {
        void handleSend();
      }
    }
  };

  const handleNotebookSelect = async (id: string) => {
    setSelectedNotebookId(id);
    if (!id) return;
    try {
      await notebooklmSelectNotebook(id);
    } catch (error) {
      toast.error(t("flashcardStudio.notebookSelectionFailed"), error instanceof Error ? error.message : t("flashcardStudio.unableSelectNotebook"));
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9990] flex items-stretch justify-center bg-black/60 backdrop-blur-sm p-0 sm:items-center sm:p-4 animate-in fade-in duration-200"
      {...backdropDismiss}
      onPasteCapture={(event) => {
        if (isImageRegistryOpen) return;
        const imageFiles = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
        if (imageFiles.length === 0) return;

        event.preventDefault();
        void ingestFilesIntoRegistry(imageFiles);
      }}
    >
      <div
        className="flex h-[100dvh] w-full max-w-7xl flex-col overflow-hidden rounded-none border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200 sm:h-[90vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {seed?.languageProvenance && (
          <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-foreground" role="status">
            <span className="min-w-0 flex-1">Language source attached. Confirm it is still current before saving.</span>
            <button type="button" className="shrink-0 rounded border border-amber-500/50 px-2 py-1 font-medium hover:bg-amber-500/10" onClick={() => setLanguageSourceConfirmed(true)} aria-pressed={languageSourceConfirmed}>
              {languageSourceConfirmed ? "Source confirmed" : "Confirm source"}
            </button>
          </div>
        )}
        {/* Header — mobile collapses to a compact title row plus a full-width
            Chat/Drafts segmented control, replacing both the wrapped desktop
            control row and the separate panel-toggle band below. */}
        {isMobileShell ? (
          <div className="flex flex-col gap-1.5 border-b border-border bg-gradient-to-r from-muted/50 to-muted/30 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-gradient-to-br from-primary to-primary-600 p-1.5 text-primary-foreground shadow-md shadow-primary/25 flex-shrink-0">
                <Sparkle className="h-4 w-4" />
              </div>
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                {t("flashcardStudio.title")}
              </h2>
              <button
                onClick={() => handleNewSession()}
                title={t("flashcardStudio.newSession")}
                aria-label={t("flashcardStudio.newSession")}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-muted"
              >
                <Plus className="h-5 w-5" />
              </button>
              <button
                onClick={() => setActiveSheet("views")}
                title={t("flashcardStudio.sheetViewsTitle")}
                aria-label={t("flashcardStudio.sheetViewsTitle")}
                className={cn(
                  "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg active:bg-muted",
                  viewMode === "chat" ? "text-muted-foreground" : "text-primary"
                )}
              >
                <DotsThree className="h-5 w-5" weight="bold" />
              </button>
              <button
                onClick={onClose}
                aria-label={t("common.close")}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground active:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
              <button
                type="button"
                onClick={() => setMobileActivePanel("generator")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-all",
                  mobileActivePanel === "generator"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground"
                )}
              >
                <ChatCircle className="h-3.5 w-3.5" />
                {t("flashcardStudio.chat")}
              </button>
              <button
                type="button"
                onClick={() => setMobileActivePanel("drafts")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-all",
                  mobileActivePanel === "drafts"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground"
                )}
              >
                <Brain className="h-3.5 w-3.5" />
                {t("flashcardStudio.draftCards")}
                {stats.total > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[10px] font-semibold",
                      mobileActivePanel === "drafts"
                        ? "bg-primary-foreground/20"
                        : "bg-primary text-primary-foreground"
                    )}
                  >
                    {stats.total}
                  </span>
                )}
              </button>
            </div>
          </div>
        ) : (
        <div className="flex flex-col gap-3 border-b border-border bg-gradient-to-r from-muted/50 to-muted/30 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:pt-4">
          <div className="flex items-center justify-between w-full sm:w-auto gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-gradient-to-br from-primary to-primary-600 p-2.5 text-primary-foreground shadow-lg shadow-primary/25 flex-shrink-0">
                <Sparkle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground leading-snug">{t("flashcardStudio.title")}</h2>
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {t("flashcardStudio.subtitle")}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors sm:hidden flex-shrink-0"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {/* View Mode Tabs */}
            <div className="flex items-center rounded-lg border border-border bg-background p-1 overflow-x-auto max-w-full">
              <button
                onClick={() => setViewMode("chat")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap",
                  viewMode === "chat" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ChatCircle className="w-3.5 h-3.5" />
                {t("flashcardStudio.chat")}
              </button>
              <button
                onClick={() => setViewMode("templates")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap",
                  viewMode === "templates" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Lightning className="w-3.5 h-3.5" />
                {t("flashcardStudio.templates")}
              </button>
              <button
                onClick={() => setViewMode("sessions")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap",
                  viewMode === "sessions" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                title={t("flashcardStudio.sessions")}
              >
                <ClockCounterClockwise className="w-3.5 h-3.5" />
                {t("flashcardStudio.sessions")}
                {sessionsCache.length > 0 && (
                  <span className="ml-0.5 text-[10px] bg-primary-foreground/20 px-1 rounded-full">
                    {sessionsCache.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setViewMode("extracts")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap",
                  viewMode === "extracts" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <TextT className="w-3.5 h-3.5" />
                {t("flashcardStudio.extracts")}
                {allExtracts.length > 0 && (
                  <span className="ml-0.5 text-[10px] bg-primary-foreground/20 px-1 rounded-full">
                    {allExtracts.length}
                  </span>
                )}
              </button>
            </div>

            {/* New session */}
            <button
              onClick={() => handleNewSession()}
              title={`${t("flashcardStudio.newSession")} (${isMac() ? "⌘" : "Ctrl"}+Shift+N)`}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border bg-background text-xs font-medium text-foreground hover:bg-muted transition-colors flex-shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t("flashcardStudio.newSession")}</span>
            </button>

            {/* Provider Selector */}
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 flex-shrink-0">
              <Gear className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                value={selectedProviderId ?? ""}
                onChange={(e) => setSelectedProviderId(e.target.value || null)}
                className="bg-transparent text-xs text-foreground outline-none min-w-[100px] max-w-[150px]"
              >
                {enabledProviders.length === 0 && <option value="">{t("flashcardStudio.noProvider")}</option>}
                {notebookLmAvailable && <option value={NOTEBOOKLM_PROVIDER_ID}>NotebookLM</option>}
                {availableOnDeviceProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.id === "ondevice-apple-foundation"
                      ? t("assistant.providerAppleFoundation")
                      : t("flashcardStudio.onDeviceProvider")}
                  </option>
                ))}
                {enabledProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {isNotebookProviderSelected && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 flex-shrink-0">
                {isNotebookLoading ? (
                  <CircleNotch className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
                ) : (
                  <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <select
                  value={selectedNotebookId}
                  onChange={(e) => void handleNotebookSelect(e.target.value)}
                  className="bg-transparent text-xs text-foreground outline-none min-w-[120px] max-w-[180px]"
                >
                  <option value="">{t("flashcardStudio.selectNotebook")}</option>
                  {notebooks.map((notebook) => (
                    <option key={notebook.id} value={notebook.id}>
                      {notebook.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              onClick={onClose}
              className="hidden rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors sm:block flex-shrink-0"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        )}

        {/* Context Bar — one chip row on mobile, the full inline bar on desktop. */}
        {isMobileShell ? (
          mobileActivePanel === "generator" && (
            <StudioContextChipBar
              state={{
                documentTitle: selectedDocument?.title ?? null,
                deckName: selectedDeck?.name ?? null,
                deckTags,
                imageCount: imageAssets.length,
                selectedImageCount: selectedImageAssetIds.length,
                contextSelection,
                contextTokens: chipContextTokens,
                providerName: isNotebookProviderSelected
                  ? "NotebookLM"
                  : selectedOnDeviceProvider?.label ?? currentProvider?.name ?? null,
              }}
              onOpenSheet={setActiveSheet}
            />
          )
        ) : (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-6 py-3">
          <DocumentSelector
            documents={documents}
            selectedId={selectedDocumentId}
            onSelect={(id) => {
              setSelectedDocumentId(id);
              // Reset context selection when document changes
              if (id !== selectedDocumentId) {
                setContextSelection({
                  ...DEFAULT_CONTEXT_SELECTION,
                });
              }
            }}
          />

          <DeckSelector
            decks={decks}
            selectedId={selectedDeckId}
            suggestedName={suggestedDeckName}
            onSelect={setSelectedDeckId}
            onCreateDeck={handleCreateDeck}
          />

          {selectedDeck && deckTags.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Tag className="w-3.5 h-3.5" />
              <span className="max-w-[200px] truncate">{deckTags.join(", ")}</span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleGenerateImageOcclusions()}
              disabled={isImageImporting || isSending || selectedImageAssetIds.length === 0 || !canUseVisionOcclusion}
              title={
                selectedImageAssetIds.length === 0
                  ? t("flashcardStudio.noImageSelectedDesc")
                  : !canUseVisionOcclusion
                  ? t("flashcardStudio.imageOcclusionNoModelDesc")
                  : !isRecognizedVisionModel
                  ? t("flashcardStudio.imageOcclusionModelUnsupportedDesc", { model: currentProvider?.model ?? "" })
                  : t("flashcardStudio.generateImageOcclusions")
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
            >
              {isSending ? (
                <CircleNotch className="w-3.5 h-3.5 animate-spin" />
              ) : !isRecognizedVisionModel && canUseVisionOcclusion ? (
                <WarningCircle className="w-3.5 h-3.5 text-amber-500" />
              ) : (
                <Sparkle className="w-3.5 h-3.5" />
              )}
              {t("flashcardStudio.generateImageOcclusions")}
            </button>
            <button
              type="button"
              onClick={() => setIsImageRegistryOpen(true)}
              disabled={isImageImporting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-60"
            >
              <Images className="w-3.5 h-3.5" />
              {t("flashcardStudio.openImageLibrary")}
            </button>
          </div>
          {imageAssets.length > 0 && (
            <div className="basis-full mt-2 flex items-center gap-2 overflow-x-auto pb-1">
              {imageAssets.slice(0, 16).map((asset) => {
                const selected = selectedImageAssetIds.includes(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => toggleSelectedImageAsset(asset.id)}
                    className={cn(
                      "relative h-12 w-12 overflow-hidden rounded-md border transition-all",
                      selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                    )}
                    title={asset.file_name || asset.id}
                  >
                    <img src={asset.data_url} alt={asset.file_name || "Registry image"} className="h-full w-full object-cover" />
                  </button>
                );
              })}
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {t("flashcardStudio.selectedCount", { count: selectedImageAssetIds.length })}
              </span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {t("flashcardStudio.imagePasteHint")}
              </span>
            </div>
          )}
        </div>
        )}

        {/* Context Control Panel — inline on desktop; on mobile it lives
            behind the context chip's bottom sheet. */}
        {!isMobileShell && selectedDocument && (
          <div className="px-6 py-3 border-b border-border bg-muted/10">
            {contextLoadState === "loading" && (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground" role="status">
                <CircleNotch className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                Loading document context…
              </div>
            )}
            {contextLoadState === "error" && !selectedDocumentText && (
              <div className="mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
                <WarningCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{contextLoadError || "Document context could not be loaded. Close and reopen the studio to retry."}</span>
              </div>
            )}
            <ContextControlPanel
              document={{
                id: selectedDocument.id,
                title: selectedDocument.title,
                content: selectedDocumentText,
              }}
              selection={contextSelection}
              onChange={setContextSelection}
              maxTokens={maxTokens}
              selectedSections={selectedSectionNodes}
              focusedSectionTokens={focusedSectionTokens}
              onRemoveSection={handleRemoveSectionById}
            />
          </div>
        )}

        {/* Main Content */}
        <div className="grid flex-1 min-h-0 gap-0 overflow-hidden lg:grid-cols-[1fr_400px]">
          {/* Left Panel */}
          <div className={cn(
            "flex h-full min-h-0 flex-col border-r border-border",
            mobileActivePanel === "generator" ? "flex" : "hidden lg:flex"
          )}>
            {viewMode === "chat" && (
              <>
                {/* Messages */}
                <div
                  ref={messagesContainerRef}
                  onScroll={handleMessagesScroll}
                  className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4"
                >
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-8">
                      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                        <Sparkle className="w-8 h-8 text-primary" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground mb-2">
                        {t("flashcardStudio.welcome")}
                      </h3>
                      <p className="text-sm text-muted-foreground max-w-md mb-4">
                        {t("flashcardStudio.welcomeBodyPrefix")}{" "}
                        {t("flashcardStudio.welcomeBodyUse")} <strong>{t("flashcardStudio.contextControlTitle")}</strong>{" "}
                        {t("flashcardStudio.welcomeBodySuffix")}
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {QUICK_TEMPLATES.slice(0, 3).map((t) => (
                          <button
                            key={t.id}
                            onClick={() => handleTemplateSelect(t)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-border bg-background hover:bg-muted transition-colors"
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          "flex flex-col animate-in slide-in-from-bottom-2 duration-200",
                          message.role === "user" ? "items-end" : "items-start"
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] rounded-2xl px-4 py-3",
                            message.role === "user"
                              ? "bg-primary text-primary-foreground rounded-br-md"
                              : message.role === "system"
                              ? "bg-destructive/10 text-destructive border border-destructive/20"
                              : "bg-muted text-foreground rounded-bl-md border border-border"
                          )}
                        >
                          {message.role === "assistant" ? (
                            <div
                              className="prose prose-sm dark:prose-invert max-w-none"
                              dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                            />
                          ) : (
                            <p className="text-sm leading-relaxed">{message.content}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 px-1">
                          <span className="text-[11px] text-muted-foreground">
                            {formatRelativeTime(message.timestamp)}
                          </span>
                          {message.cardsGenerated && message.cardsGenerated > 0 && (
                            <span className="text-[11px] text-primary font-medium">
                              {t("flashcardStudio.generatedCardsShort", { count: message.cardsGenerated })}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="border-t border-border px-4 pt-4 pb-[calc(max(1rem,env(safe-area-inset-bottom))+var(--shell-mobile-nav-height,0px))] bg-card">
                  <div className="relative">
                    {selectedDocument && showSectionPopup && (
                      <SectionMentionPopup
                        tree={sectionTree}
                        flat={sectionFlat}
                        query={sectionQuery}
                        selectedIndex={sectionCursorIndex}
                        open={showSectionPopup}
                        onSelect={handleSelectStudioSection}
                        onClose={() => setShowSectionPopup(false)}
                      />
                    )}
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => handleInputChange(e.target.value)}
                      onKeyDown={handleInputKeyDown}
                      placeholder={selectedDocument
                        ? t("flashcardStudio.contextPromptPlaceholder")
                        : t("flashcardStudio.generalPromptPlaceholder")}
                      // Mobile starts at 2 rows and grows with the content
                      // (capped), returning the third row to the conversation.
                      rows={isMobileShell ? 2 : 3}
                      style={
                        isMobileShell
                          ? { height: composerHeight, maxHeight: "40vh" }
                          : undefined
                      }
                      className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                    />
                    <button
                      onClick={() => handleSend()}
                      disabled={isSending || !input.trim() || (isNotebookProviderSelected && !selectedNotebookId)}
                      className="absolute right-3 bottom-3 p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                    >
                      {isSending ? (
                        <CircleNotch className="h-4 w-4 animate-spin" />
                      ) : (
                        <PaperPlaneTilt className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  
                  {/* Flashcard generation target */}
                  <div className={cn("relative", isMobileShell ? "mt-2" : "mt-3")}>
                    <button
                      type="button"
                      onClick={() => setShowTargetPanel((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                      title="Adjust how many flashcards are generated for this session"
                    >
                      <span>
                        {effectiveFlashcardTarget.mode === "auto"
                          ? `~${effectiveFlashcardTarget.count} cards (auto)`
                          : `${effectiveFlashcardTarget.count} cards`}
                      </span>
                      {sessionTargetOverride && (
                        <span className="rounded-full bg-primary/15 text-primary px-1.5 py-0.5 text-[10px] font-medium">
                          session
                        </span>
                      )}
                    </button>

                    {showTargetPanel && (
                      <div className="absolute z-10 bottom-full mb-2 left-0 w-64 rounded-xl border border-border bg-card shadow-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground">Cards for this session</span>
                          {sessionTargetOverride && (
                            <button
                              type="button"
                              onClick={() => setSessionTargetOverride(undefined)}
                              className="text-[11px] text-primary hover:underline"
                            >
                              Reset to default
                            </button>
                          )}
                        </div>
                        <div className="inline-flex rounded-lg border border-border overflow-hidden w-full">
                          {(["fixed", "auto"] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() =>
                                setSessionTargetOverride({
                                  mode,
                                  fixedCount: sessionTargetOverride?.fixedCount ?? aiControls.flashcardFixedCount,
                                  autoMin: sessionTargetOverride?.autoMin ?? aiControls.flashcardAutoMin,
                                  autoMax: sessionTargetOverride?.autoMax ?? aiControls.flashcardAutoMax,
                                })
                              }
                              className={cn(
                                "flex-1 px-2 py-1 text-xs capitalize transition-colors",
                                (sessionTargetOverride?.mode ?? aiControls.flashcardCountMode) === mode
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-background text-foreground hover:bg-muted"
                              )}
                            >
                              {mode === "fixed" ? "Fixed" : "Auto"}
                            </button>
                          ))}
                        </div>
                        {(sessionTargetOverride?.mode ?? aiControls.flashcardCountMode) === "fixed" ? (
                          <NumericInput
                            min={1}
                            max={100}
                            value={sessionTargetOverride?.fixedCount ?? aiControls.flashcardFixedCount}
                            onChange={(value) =>
                              setSessionTargetOverride({
                                mode: "fixed",
                                fixedCount: value,
                                autoMin: sessionTargetOverride?.autoMin ?? aiControls.flashcardAutoMin,
                                autoMax: sessionTargetOverride?.autoMax ?? aiControls.flashcardAutoMax,
                              })
                            }
                            className="w-full px-2 py-1.5 bg-background border border-border rounded-lg text-foreground text-xs"
                          />
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <NumericInput
                              min={1}
                              max={sessionTargetOverride?.autoMax ?? aiControls.flashcardAutoMax}
                              value={sessionTargetOverride?.autoMin ?? aiControls.flashcardAutoMin}
                              onChange={(value) =>
                                setSessionTargetOverride({
                                  mode: "auto",
                                  fixedCount: sessionTargetOverride?.fixedCount ?? aiControls.flashcardFixedCount,
                                  autoMin: value,
                                  autoMax: Math.max(value, sessionTargetOverride?.autoMax ?? aiControls.flashcardAutoMax),
                                })
                              }
                              className="w-16 px-2 py-1.5 bg-background border border-border rounded-lg text-foreground text-xs"
                            />
                            <span className="text-[11px] text-muted-foreground">to</span>
                            <NumericInput
                              min={sessionTargetOverride?.autoMin ?? aiControls.flashcardAutoMin}
                              max={100}
                              value={sessionTargetOverride?.autoMax ?? aiControls.flashcardAutoMax}
                              onChange={(value) =>
                                setSessionTargetOverride({
                                  mode: "auto",
                                  fixedCount: sessionTargetOverride?.fixedCount ?? aiControls.flashcardFixedCount,
                                  autoMin: Math.min(value, sessionTargetOverride?.autoMin ?? aiControls.flashcardAutoMin),
                                  autoMax: value,
                                })
                              }
                              className="w-16 px-2 py-1.5 bg-background border border-border rounded-lg text-foreground text-xs"
                            />
                          </div>
                        )}
                        <p className="text-[10px] text-muted-foreground leading-snug">
                          Only affects this session. Change the default in Settings → AI.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Cost Estimator */}
                  <div className={isMobileShell ? "mt-2" : "mt-3"}>
                    <CostEstimator
                      inputText={
                        isNotebookProviderSelected
                          ? input
                          : input + (contextContent || (isSectionMode ? sectionsContextText : ""))
                      }
                      // Hidden for on-device inference: it is free, so the dollar
                      // figure is meaningless, and the token count measures the
                      // cloud payload rather than what the chunker actually sends
                      // per invocation. Both halves would be wrong. Chunk count
                      // is surfaced by the progress strip instead.
                      isVisible={!isOnDeviceProviderSelected}
                      pricing={currentModelPricing}
                      compact={isMobileShell}
                    />
                  </div>
                </div>
              </>
            )}

            {viewMode === "templates" && (
              <div className="flex-1 min-h-0 overflow-y-auto p-6">
                <div className="max-w-2xl mx-auto">
                  <div className="mb-6 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 dark:bg-amber-950/20">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500 mt-0.5">
                        <Sparkle className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-foreground flex items-center gap-2">
                          <span>Dr. Piotr Wozniak's 20 Rules of Knowledge Formulation</span>
                          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-normal">/20rules</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Effective flashcards must be <strong>atomic</strong>, clear, and resistant to interference. Use <strong>/20rules</strong> to formulate cards adhering to the Minimum Information Principle, cloze mnemonic anchors, and high applicability.
                        </p>
                      </div>
                    </div>
                  </div>

                  <h3 className="text-lg font-semibold text-foreground mb-2">{t("flashcardStudio.quickTemplates")}</h3>
                  <p className="text-sm text-muted-foreground mb-6">
                    {t("flashcardStudio.quickTemplatesDesc")}{" "}
                    {t("flashcardStudio.contextControlHintPrefix")} <strong>{t("flashcardStudio.contextControlTitle")}</strong> {t("flashcardStudio.contextControlHintSuffix")}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {QUICK_TEMPLATES.map((template) => (
                      <TemplateCard
                        key={template.id}
                        template={template}
                        onClick={() => handleTemplateSelect(template)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {viewMode === "sessions" && (
              <div className="flex-1 min-h-0 overflow-y-auto p-6">
                <div className="max-w-2xl mx-auto">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">{t("flashcardStudio.sessions")}</h3>
                      <p className="text-sm text-muted-foreground">
                        {t("flashcardStudio.sessionsDesc")}
                      </p>
                    </div>
                    <button
                      onClick={() => handleNewSession()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {t("flashcardStudio.newSession")}
                    </button>
                  </div>
                  {sessionsCache.length > 1 && (
                    <p className="text-[11px] text-muted-foreground mb-4">{t("flashcardStudio.sessionsCapNote")}</p>
                  )}

                  {sessionsCache.length === 0 ? (
                    <div className="text-center py-12">
                      <ClockCounterClockwise className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                      <p className="text-sm text-muted-foreground">{t("flashcardStudio.sessionsEmpty")}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sessionsCache.map((session) => {
                        const isActive = session.id === activeSessionId;
                        const isRenaming = renamingSessionId === session.id;
                        return (
                          <div
                            key={session.id}
                            className={cn(
                              "p-4 rounded-xl border bg-card transition-colors",
                              isActive ? "border-primary/60 ring-1 ring-primary/30" : "border-border hover:bg-muted/50",
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                {isRenaming ? (
                                  <input
                                    autoFocus
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onBlur={commitRename}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") commitRename();
                                      if (e.key === "Escape") {
                                        setRenamingSessionId(null);
                                        setRenameValue("");
                                      }
                                    }}
                                    className="w-full px-2 py-1 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                                  />
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-medium text-foreground truncate">
                                      {session.title}
                                    </p>
                                    {isActive && (
                                      <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
                                        {t("flashcardStudio.activeSessionLabel")}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {session.documentName && (
                                  <p className="text-xs text-muted-foreground mt-1 truncate">
                                    {t("flashcardStudio.historyFromDocument", { name: session.documentName })}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                <span className="text-xs font-medium text-primary">
                                  {t("flashcardStudio.cardsWithCount", { count: session.cardCount })}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {formatRelativeTime(session.updatedAt)}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/60">
                              <button
                                onClick={() => handleResumeSession(session.id)}
                                disabled={isActive}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <FolderOpen className="w-3.5 h-3.5" />
                                {t("flashcardStudio.resume")}
                              </button>
                              <button
                                onClick={() => beginRename(session)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted"
                              >
                                <PencilSimple className="w-3.5 h-3.5" />
                                {t("flashcardStudio.rename")}
                              </button>
                              <button
                                onClick={() => setDeletingSessionId(session.id)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive ml-auto"
                              >
                                <Trash className="w-3.5 h-3.5" />
                                {t("flashcardStudio.delete")}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {viewMode === "extracts" && (
              areExtractsLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <CircleNotch className="w-6 h-6 text-muted-foreground animate-spin" />
                </div>
              ) : (
                <ExtractBrowserPanel
                  extracts={allExtracts}
                  documents={documents.map((d) => ({ id: d.id, title: d.title }))}
                  selectedDocumentId={selectedDocumentId}
                  generatingExtractIds={generatingExtractIds}
                  onUseAsContext={handleUseExtractAsContext}
                  onGenerateCards={handleGenerateFromExtract}
                  onCreateCard={handleCreateCardFromExtract}
                />
              )
            )}
          </div>

          {/* Right Panel - Draft Cards */}
          <div className={cn(
            "flex h-full min-h-0 flex-col bg-muted/20",
            mobileActivePanel === "drafts" ? "flex" : "hidden lg:flex"
          )}>
            {/* Draft Header */}
            <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {t("flashcardStudio.draftCards")}
                  {stats.total > 0 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({stats.selected}/{stats.total})
                    </span>
                  )}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {stats.qa > 0 && `${stats.qa} ${t("flashcardStudio.cardTypeQaShort")}`}
                  {stats.qa > 0 && stats.cloze > 0 && " · "}
                  {stats.cloze > 0 && `${stats.cloze} ${t("flashcardStudio.cardTypeCloze")}`}
                  {(stats.multipleChoice > 0 || stats.imageOcclusion > 0) && (stats.qa > 0 || stats.cloze > 0) && " · "}
                  {stats.multipleChoice > 0 && `${stats.multipleChoice} ${t("flashcardStudio.cardTypeMcShort")}`}
                  {stats.multipleChoice > 0 && stats.imageOcclusion > 0 && " · "}
                  {stats.imageOcclusion > 0 && `${stats.imageOcclusion} ${t("flashcardStudio.cardTypeImageShort")}`}
                  {stats.selected === 0 && t("flashcardStudio.noCardsSelected")}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {([
                  ["qa", "Q&A"],
                  ["cloze", "Cloze"],
                  ["multiple-choice", "MC"],
                  ["image-occlusion", "Image"],
                ] as const).map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      const nextCard = createBlankDraftCard(type);
                      setDraftCards((prev) => [nextCard, ...prev]);
                      setEditingCardId(nextCard.id);
                    }}
                    className="hidden rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-muted md:inline-flex"
                    title={t("flashcardStudio.addCardTitle", { label })}
                  >
                    + {label}
                  </button>
                ))}
                <button
                  onClick={() => toggleSelectAll(true)}
                  className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                  title={t("flashcardStudio.selectAll")}
                >
                  <CheckCircle className="w-4 h-4" />
                </button>
                <button
                  onClick={() => toggleSelectAll(false)}
                  className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                  title={t("flashcardStudio.deselectAll")}
                >
                  <WarningCircle className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-border mx-1" />
                <button
                  onClick={() => setDraftCards([])}
                  className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  title={t("flashcardStudio.clearAll")}
                >
                  <Trash className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Bulk Actions */}
            {stats.selected > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-primary/5">
                {isTagInputVisible ? (
                  <div className="flex-1 flex items-center gap-2">
                    <Hash className="w-4 h-4 text-muted-foreground" />
                    <input
                      autoFocus
                      value={bulkTagInput}
                      onChange={(e) => setBulkTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddTagToSelected();
                        if (e.key === "Escape") setIsTagInputVisible(false);
                      }}
                      placeholder={t("flashcardStudio.tagsPlaceholder")}
                      className="flex-1 text-xs bg-transparent outline-none"
                    />
                    <button
                      onClick={handleAddTagToSelected}
                      className="text-xs text-primary font-medium hover:opacity-80"
                    >
                      {t("reviewHome.add")}
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setIsTagInputVisible(true)}
                      className="flex items-center gap-1.5 text-xs text-primary hover:opacity-80"
                    >
                      <Tag className="w-3.5 h-3.5" />
                      {t("flashcardStudio.tagSelected", { count: stats.selected })}
                    </button>
                    <button
                      onClick={handleDeleteSelected}
                      className="flex items-center gap-1.5 text-xs text-destructive hover:opacity-80"
                    >
                      <Trash className="w-3.5 h-3.5" />
                      {t("queue.delete")}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Cards List */}
            <div ref={draftCardsContainerRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              {draftCards.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-4">
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-3">
                    <Sparkle className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">{t("flashcardStudio.noDraftCards")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("flashcardStudio.generateCardsHint")}
                  </p>
                </div>
              ) : (
                draftCards.map((card, index) => (
                  <div
                    key={card.id}
                    className={cn(
                      "group relative rounded-xl border bg-card overflow-hidden transition-all duration-200",
                      card.selected
                        ? "border-primary/50 shadow-sm shadow-primary/10"
                        : "border-border opacity-70 hover:opacity-100"
                    )}
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    {/* Card Header */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                      <button
                        onClick={() =>
                          setDraftCards((prev) =>
                            prev.map((c) =>
                              c.id === card.id ? { ...c, selected: !c.selected } : c
                            )
                          )
                        }
                        className={cn(
                          "w-5 h-5 rounded border flex items-center justify-center transition-colors",
                          card.selected
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-border bg-background hover:border-primary/50"
                        )}
                      >
                        {card.selected && <Check className="w-3.5 h-3.5" />}
                      </button>
                      <span
                        className={cn(
                          "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded",
                          card.type === "qa"
                            ? "bg-blue-500/10 text-blue-600"
                            : card.type === "cloze"
                            ? "bg-purple-500/10 text-purple-600"
                            : card.type === "multiple-choice"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : "bg-amber-500/10 text-amber-700"
                        )}
                      >
                        {card.type === "qa"
                          ? "Q&A"
                          : card.type === "cloze"
                          ? t("flashcardStudio.cardTypeCloze")
                          : card.type === "multiple-choice"
                          ? t("flashcardStudio.cardTypeMultipleChoice")
                          : t("flashcardStudio.cardTypeImageOcclusion")}
                      </span>
                      {card.tags.length > 0 && (
                        <div className="flex items-center gap-1">
                          {card.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                          {card.tags.length > 2 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{card.tags.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="flex-1" />
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => duplicateCard(card)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground"
                          title={t("flashcardStudio.duplicate")}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingCardId(card.id)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground"
                          title={t("flashcardStudio.edit")}
                        >
                          <PencilSimple className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            setDraftCards((prev) => prev.filter((c) => c.id !== card.id))
                          }
                          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          title={t("queue.delete")}
                        >
                          <Trash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Card Content */}
                    <CardPreview
                      card={card}
                      isFlipped={flippedCardId === card.id}
                      onFlip={() =>
                        setFlippedCardId((id) => (id === card.id ? null : card.id))
                      }
                      isEditing={editingCardId === card.id}
                      onEdit={() => setEditingCardId(card.id)}
                      onSaveEdit={(updates) => handleEditCard(card.id, updates)}
                      sourceExcerpt={contextSelection.excerpt}
                      imageAssets={imageAssets}
                      defaultImageAssetId={selectedImageAssetIds[0]}
                    />
                  </div>
                ))
              )}
            </div>

            {/* FloppyDisk Action */}
            {draftCards.length > 0 && (
              <div className="border-t border-border bg-card px-4 pt-4 pb-[calc(max(1rem,env(safe-area-inset-bottom))+var(--shell-mobile-nav-height,0px))]">
                <button
                  onClick={handleSaveSelected}
                  disabled={isSaving || stats.selected === 0}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isSaving ? (
                    <CircleNotch className="w-4 h-4 animate-spin" />
                  ) : (
                    <FloppyDisk className="w-4 h-4" />
                  )}
                  {t("flashcardStudio.saveSelectedCards", { count: stats.selected })}
                </button>
                <p className="text-center text-[10px] text-muted-foreground mt-2">
                  {t("flashcardStudio.saveShortcutHint")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile configuration sheets. Portalled to document.body at z-[9999],
          so they sit above the studio panel and their taps never bubble into
          the modal backdrop's click-outside-to-close handler. */}
      {isMobileShell && (
        <StudioSheets
          activeSheet={activeSheet}
          onClose={() => setActiveSheet(null)}
          documents={documents}
          selectedDocumentId={selectedDocumentId}
          onSelectDocument={(id) => {
            setSelectedDocumentId(id);
            // Same side effect as the desktop selector: a new document
            // invalidates whatever context was scoped to the old one.
            if (id !== selectedDocumentId) {
              setContextSelection({ ...DEFAULT_CONTEXT_SELECTION });
            }
          }}
          decks={decks}
          selectedDeckId={selectedDeckId}
          suggestedDeckName={suggestedDeckName}
          onSelectDeck={setSelectedDeckId}
          onCreateDeck={handleCreateDeck}
          imageAssets={imageAssets}
          selectedImageAssetIds={selectedImageAssetIds}
          onToggleImageAsset={toggleSelectedImageAsset}
          onOpenImageLibrary={() => setIsImageRegistryOpen(true)}
          onGenerateImageOcclusions={() => void handleGenerateImageOcclusions()}
          isImageImporting={isImageImporting}
          isSending={isSending}
          canUseVisionOcclusion={canUseVisionOcclusion}
          selectedDocument={selectedDocument}
          selectedDocumentText={selectedDocumentText ?? ""}
          contextSelection={contextSelection}
          onContextSelectionChange={setContextSelection}
          maxTokens={maxTokens}
          selectedSectionNodes={selectedSectionNodes}
          focusedSectionTokens={focusedSectionTokens}
          onRemoveSection={handleRemoveSectionById}
          viewMode={viewMode}
          onSelectViewMode={setViewMode}
          sessionCount={sessionsCache.length}
          extractCount={allExtracts.length}
          providers={enabledProviders}
          onDeviceProviders={availableOnDeviceProviders}
          selectedProviderId={selectedProviderId}
          onSelectProvider={setSelectedProviderId}
          notebookLmAvailable={notebookLmAvailable}
          notebookLmProviderId={NOTEBOOKLM_PROVIDER_ID}
          isNotebookProviderSelected={isNotebookProviderSelected}
          isNotebookLoading={isNotebookLoading}
          notebooks={notebooks}
          selectedNotebookId={selectedNotebookId}
          onSelectNotebook={(id) => void handleNotebookSelect(id)}
        />
      )}

      {isImageRegistryOpen && (
        <div className="fixed inset-0 z-[9991] flex items-center justify-center bg-black/60 p-4">
          <div className="h-[88vh] w-full max-w-7xl">
            <ImageRegistryLibrary
              initialSelectedIds={selectedImageAssetIds}
              onSelectedIdsChange={setSelectedImageAssetIds}
              onAssetsChange={setImageAssets}
              onClose={() => setIsImageRegistryOpen(false)}
              onConfirmSelection={(ids) => {
                setSelectedImageAssetIds(ids);
                setIsImageRegistryOpen(false);
              }}
              showCloseButton
              showConfirmButton
              title={t("flashcardStudio.imageLibraryTitle")}
              subtitle={t("flashcardStudio.imageLibrarySubtitle")}
              confirmLabel={t("flashcardStudio.useSelectedImages")}
            />
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Modal */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-[9992] flex items-center justify-center bg-black/50"
          onClick={() => setShowShortcuts(false)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">{t("flashcardStudio.keyboardShortcuts")}</h3>
              <button
                onClick={() => setShowShortcuts(false)}
                className="p-1 rounded hover:bg-muted"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">{t("flashcardStudio.shortcutSendMessage")}</span>
                <kbd className="px-2 py-1 bg-muted rounded text-xs">Ctrl + Enter</kbd>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">{t("flashcardStudio.shortcutSaveSelected")}</span>
                <kbd className="px-2 py-1 bg-muted rounded text-xs">Ctrl + S</kbd>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">{t("flashcardStudio.shortcutClose")}</span>
                <kbd className="px-2 py-1 bg-muted rounded text-xs">Esc</kbd>
              </div>
              <div className="flex justify-between py-2 border-b border-border">
                <span className="text-muted-foreground">{t("flashcardStudio.shortcutShow")}</span>
                <kbd className="px-2 py-1 bg-muted rounded text-xs">?</kbd>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-muted-foreground">{t("flashcardStudio.shortcutFlip")}</span>
                <kbd className="px-2 py-1 bg-muted rounded text-xs">{t("flashcardStudio.clickCard")}</kbd>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New session — confirm before abandoning unsaved drafts */}
      {showNewSessionDialog && (
        <div
          className="fixed inset-0 z-[9992] flex items-center justify-center bg-black/50"
          onClick={() => setShowNewSessionDialog(false)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                <WarningCircle className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">
                {t("flashcardStudio.discardUnsavedDraftsTitle")}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              {t("flashcardStudio.discardUnsavedDraftsBody")}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setShowNewSessionDialog(false)}
                className="px-3 py-1.5 text-sm rounded-lg text-muted-foreground hover:bg-muted"
              >
                {t("flashcardStudio.cancel")}
              </button>
              <button
                onClick={() => confirmNewSession("clean")}
                className="px-3 py-1.5 text-sm rounded-lg bg-destructive text-destructive-foreground hover:opacity-90"
              >
                {t("flashcardStudio.startClean")}
              </button>
              <button
                onClick={() => confirmNewSession("keep")}
                className="px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90"
              >
                {t("flashcardStudio.keepDrafts")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete session confirmation */}
      {deletingSessionId && (
        <div
          className="fixed inset-0 z-[9992] flex items-center justify-center bg-black/50"
          onClick={() => setDeletingSessionId(null)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 rounded-lg bg-destructive/10 text-destructive">
                <Trash className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">
                {t("flashcardStudio.deleteSession")}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              {t("flashcardStudio.deleteSessionConfirm")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeletingSessionId(null)}
                className="px-3 py-1.5 text-sm rounded-lg text-muted-foreground hover:bg-muted"
              >
                {t("flashcardStudio.cancel")}
              </button>
              <button
                onClick={confirmDeleteSession}
                className="px-3 py-1.5 text-sm rounded-lg bg-destructive text-destructive-foreground hover:opacity-90"
              >
                {t("flashcardStudio.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FlashcardStudioModal;
