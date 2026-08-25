/**
 * Typed interfaces for Canonical Product Documentation and Ask Plethora Contextual Help System.
 */

import type { RegisteredHelpActionId } from "./registeredHelpActions";

export type ProductDomain =
  | "reading"
  | "imports"
  | "queue"
  | "scheduling"
  | "review"
  | "language"
  | "tts"
  | "ai"
  | "media"
  | "platform"
  | "search"
  | "settings"
  | "concepts"
  | "troubleshooting";

export type FeatureStatus = "implemented" | "partial" | "experimental" | "deprecated" | "planned";

export type TargetPlatform =
  | "desktop-macos"
  | "desktop-windows"
  | "desktop-linux"
  | "mobile-android"
  | "mobile-ios"
  | "eink"
  | "pwa"
  | "all";

export interface DocActionRef {
  id: RegisteredHelpActionId | string;
  label: string;
  shortcut?: string;
}

export interface ProductDocFrontmatter {
  id: string;
  title: string;
  domain: ProductDomain;
  status: FeatureStatus;
  platforms: TargetPlatform[];
  summary: string;
  how_to: string;
  why: string;
  aliases: string[];
  settings: string[];
  actions: DocActionRef[];
  related: string[];
  version_added?: string;
  last_verified_commit?: string;
}

export interface ProductDocArticle extends ProductDocFrontmatter {
  filePath: string;
  body?: string;
  sections: Record<string, string>;
}

export interface HelpDocChunk {
  /** Unique chunk id (e.g. `tts.word_highlighting#summary` or `tts.word_highlighting#rules`) */
  id: string;
  docId: string;
  title: string;
  domain: ProductDomain;
  section: string;
  content: string;
  aliases: string[];
  tags: string[];
  platforms: TargetPlatform[];
  actions: DocActionRef[];
  filePath: string;
}

export interface HelpAppContext {
  activeView:
    | "queue"
    | "document-viewer"
    | "review"
    | "rss"
    | "podcast"
    | "audiobook"
    | "settings"
    | "analytics"
    | "dashboard"
    | "documents";
  documentFormat?: "pdf" | "epub" | "html" | "markdown" | "video" | "audio" | "other";
  platform: TargetPlatform;
  ttsActive: boolean;
  ttsProvider?: string;
  activeAlgorithm: "fsrs" | "adaptive" | "precision" | "classic" | "classic_5" | "classic_8" | "classic_15";
  einkActive: boolean;
  activeSettingsTab?: string;
}

export interface HelpSearchResult {
  chunk: HelpDocChunk;
  score: number;
  baseScore: number;
  boostMultiplier: number;
  matchReasons: string[];
}

export interface DirectLookupResult {
  featureId: string;
  title: string;
  summary: string;
  how_to: string;
  why: string;
  confidence: number;
  primaryAction?: DocActionRef;
  related: string[];
}

export interface HelpCitationRef {
  index: number;
  docId: string;
  refId: string;
  title: string;
  section?: string;
  snippet?: string;
  quote: string;
}

export type UserHelpIntent =
  | { kind: "navigation"; actionId: string; targetPath: string; label: string }
  | { kind: "direct_lookup"; directResult: DirectLookupResult }
  | { kind: "product_help"; query: string; forcedPrefix: boolean }
  | { kind: "document_content"; query: string };
