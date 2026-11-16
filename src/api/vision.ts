import { invokeCommand } from "../lib/tauri";
import type { ImageOcclusionPoint, ImageOcclusionRegion } from "../types/learningItemInteractions";
import type { Extract, LearningItem } from "../types";

export type MirageSection = "scene" | "objects" | "text" | "relations";

export interface MirageRequestOptions {
  sections?: MirageSection[];
  conf?: number;
  textConf?: number;
  maskFormat?: "polygons" | "bitmap";
}

export interface MirageObject {
  id: string;
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
  attributes: string[];
  polygon: Array<[number, number]>;
}

export interface MirageTextBlock {
  id: string;
  text: string;
  confidence: number;
  bbox: [number, number, number, number];
  polygon: Array<[number, number]>;
}

export interface MirageRelation {
  subjectId: string;
  predicate: string;
  objectId: string;
  confidence: number;
}

export interface MirageResponse {
  scene: string;
  objects: MirageObject[];
  text: MirageTextBlock[];
  relations: MirageRelation[];
  inferenceMs: number;
  imageWidth: number;
  imageHeight: number;
}

export interface MirageStatus {
  available: boolean;
  libraryLoaded: boolean;
  modelLoaded: boolean;
  modelCached: boolean;
  modelPath?: string | null;
  libraryPath?: string | null;
  reason?: string | null;
}

export interface PairedFigure {
  objectId: string;
  label: string;
  bbox: [number, number, number, number];
  polygon: Array<[number, number]>;
  relation: string;
  distance: number;
  croppedAssetId?: string | null;
}

export interface PairedExtractChunk {
  text: string;
  bbox: [number, number, number, number];
  pairedFigures: PairedFigure[];
}

export interface MirageAnalyzeResult {
  response: MirageResponse;
  regions: Array<ImageOcclusionRegion & { id: string; points?: ImageOcclusionPoint[] }>;
  readingOrderText: string;
  pairedChunks: PairedExtractChunk[];
}

export interface MirageSnapExtractResult {
  extract: Extract;
  sourceAssetId: string;
  croppedFigureAssetIds: string[];
  scene: string;
  readingOrderText: string;
  pairedChunks: PairedExtractChunk[];
}

export interface VisualSearchMatch {
  assetId: string;
  sceneDescription: string;
  ocrText: string;
  tags: string[];
  score: number;
  fileName?: string | null;
  mimeType?: string | null;
}

export async function getMirageStatus(): Promise<MirageStatus> {
  return invokeCommand<MirageStatus>("mirage_status");
}

export async function ensureMirageModel(downloadUrl?: string): Promise<string> {
  return invokeCommand<string>("mirage_ensure_model", { downloadUrl });
}

export async function analyzeImageWithMirage(params: {
  base64Data?: string;
  filePath?: string;
  assetId?: string;
  options?: MirageRequestOptions;
}): Promise<MirageAnalyzeResult> {
  return invokeCommand<MirageAnalyzeResult>("mirage_analyze_image", params);
}

export async function snapImageToExtract(params: {
  base64Data?: string;
  filePath?: string;
  documentId: string;
  sourceUrl?: string;
  note?: string;
  tags?: string[];
  pageNumber?: number;
}): Promise<MirageSnapExtractResult> {
  return invokeCommand<MirageSnapExtractResult>("mirage_snap_to_extract", params);
}

export async function generateMirageOcclusionCards(params: {
  assetId?: string;
  base64Data?: string;
  documentId?: string;
  prompt?: string;
  includeText?: boolean;
  includeObjects?: boolean;
}): Promise<LearningItem[]> {
  return invokeCommand<LearningItem[]>("mirage_generate_occlusion_cards", params);
}

export async function createMirageRegionOcclusionCard(params: {
  assetId: string;
  region: ImageOcclusionRegion;
  allRegions?: ImageOcclusionRegion[];
  documentId?: string;
  prompt?: string;
}): Promise<LearningItem> {
  return invokeCommand<LearningItem>("mirage_create_region_occlusion_card", params);
}

export async function searchVisualAssets(
  query: string,
  limit = 20
): Promise<VisualSearchMatch[]> {
  return invokeCommand<VisualSearchMatch[]>("mirage_search_visual", { query, limit });
}

export async function indexImageAssetWithMirage(assetId: string): Promise<string[]> {
  return invokeCommand<string[]>("mirage_index_asset", { assetId });
}
