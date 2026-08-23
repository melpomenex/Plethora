import type { Document, Extract, LearningItem } from "../database";

export interface MarketingFixtureMetadata {
  schemaVersion: 2;
  fixtureId: "marketing-fixture-v2";
  fixtureVersion: "2.0.0";
  fixtureHash: string;
  sourceHash: string;
  storyId: "memory-sleep-cognition";
  logicalTime: string;
  rngSeed: number;
  sourcePath: string;
}

export interface MarketingFixtureFileRecord {
  id: string;
  source_file_id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  bytes_base64: string;
  created_at: string;
}

export interface MarketingFixtureAuxiliaryRecords {
  queue: Array<{ documentId: string; position: number; priorityScore: number; dueAt: string }>;
  readingProgress: Array<{ documentId: string; progressPercent: number; currentPage: number; currentScrollPercent: number; updatedAt: string }>;
  reviewEvents: Array<{ id: string; learningItemId: string; ratedAt: string; rating: number; scheduledDays: number }>;
  notes: Array<{ id: string; documentId: string; body: string }>;
  tags: Array<{ id: string; name: string; color: string }>;
  connections: Array<{ id: string; fromId: string; toId: string; label: string }>;
}

export interface MarketingCompiledFixture {
  metadata: MarketingFixtureMetadata;
  media: Array<{ path: string; byteSize: number; sha256: string }>;
  records: MarketingFixtureAuxiliaryRecords & {
    documents: Document[];
    extracts: Extract[];
    learningItems: LearningItem[];
    files: MarketingFixtureFileRecord[];
  };
}

declare global {
  var __PLETHORA_CAPTURE_DATABASE__: string | undefined;
  var __PLETHORA_MARKETING_CAPTURE__: import("./browserAdapter").MarketingCaptureBootstrap | undefined;
  var __PLETHORA_MARKETING_SCENE__: import("./sceneApplicators").MarketingSceneApplication | undefined;
}
