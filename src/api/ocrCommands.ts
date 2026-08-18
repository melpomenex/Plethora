/**
 * OCR Commands API
 * Frontend API for OCR Tauri commands
 */

import { invokeCommand } from "../lib/tauri";

/**
 * OCR configuration
 */
export interface OCRConfig {
  default_provider: string;
  tesseract_path?: string;
  /** OCR language code passed through to providers that support one. */
  language?: string;
  google_document_ai?: GoogleDocumentAIConfig;
  aws_textract?: AWSTextractConfig;
  azure_vision?: AzureVisionConfig;
  marker_path?: string;
  nougat_path?: string;
  glm_ocr?: GLMOCRConfig;
  mistral_ocr?: MistralOCRConfig;
}

export interface GoogleDocumentAIConfig {
  project_id: string;
  location: string;
  processor_id: string;
  credentials_path: string;
}

export interface AWSTextractConfig {
  region: string;
  access_key: string;
  secret_key: string;
}

export interface AzureVisionConfig {
  endpoint: string;
  api_key: string;
}

export interface GLMOCRConfig {
  endpoint: string;
  model: string;
  api_key?: string;
}

export interface MistralOCRConfig {
  api_key: string;
  model?: string;
}

export interface GLMRuntimeStatus {
  backend: string;
  installed: boolean;
  running: boolean;
  endpoint: string;
  models_dir: string;
  last_error?: string;
}

export interface NougatRuntimeStatus {
  supported: boolean;
  installed: boolean;
  managed: boolean;
  repair_required: boolean;
  executable_path?: string;
  install_root?: string;
  package: string;
  detail?: string;
}

export interface NougatInstallProgress {
  stage:
    | "downloading-installer"
    | "installing-manager"
    | "installing-python"
    | "installing-package"
    | "verifying"
    | "complete";
  progress: number;
  message: string;
}

/**
 * OCR image file request
 */
export interface OCRImageRequest {
  image_path: string[];
  provider?: string;
  language?: string;
}

/**
 * OCR image bytes request
 */
export interface OCRBytesRequest {
  image_data: string;
  provider?: string;
  language?: string;
}

/**
 * OCR response
 */
export interface OCRResponse {
  text: string;
  confidence: number;
  line_count: number;
  word_count: number;
  processing_time_ms: number;
  provider: string;
  format?: string;
  success: boolean;
  error?: string;
  /**
   * Detected text lines with percent boxes when the provider exposes them
   * (design D18). Absent for providers without box support.
   */
  lines?: OcrResponseLine[];
}

/**
 * One OCR text line; `bbox_percent` is `[x, y, width, height]` in percent
 * 0–100 of the source image.
 */
export interface OcrResponseLine {
  text: string;
  confidence: number;
  bbox_percent?: [number, number, number, number];
}

/**
 * A unified OCR label for the AI image-occlusion flow: the same shape comes
 * from the Android ML Kit plugin and from the desktop Rust providers.
 */
export interface OcclusionOcrLabel {
  id: string;
  text: string;
  confidence?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Result of the unified OCR-labels call. */
export interface OcclusionOcrLabelsResult {
  labels: OcclusionOcrLabel[];
  /** Source dimensions in pixels when known (always known on Android). */
  sourceWidth?: number;
  sourceHeight?: number;
  truncated?: boolean;
  /** Which backend produced the labels. */
  backend: "android-mlkit" | "rust-ocr";
  provider?: string;
}

/**
 * OCR PDF file request
 */
export interface OCRPdfRequest {
  pdf_path: string;
  provider?: string;
  language?: string;
}

/**
 * OCR PDF page
 */
export interface OCRPdfPage {
  page_number: number;
  text: string;
}

/**
 * OCR PDF response
 */
export interface OCRPdfResponse {
  pages: OCRPdfPage[];
  combined_text: string;
  confidence: number;
  line_count: number;
  word_count: number;
  processing_time_ms: number;
  provider: string;
  format: string;
  page_count: number;
  success: boolean;
  error?: string;
}

/**
 * Key phrase request
 */
export interface KeyPhraseRequest {
  text: string;
  max_phrases?: number;
}

/**
 * Key phrase
 */
export interface KeyPhrase {
  text: string;
  score: number;
}

/**
 * Key phrase response
 */
export interface KeyPhraseResponse {
  phrases: KeyPhrase[];
}

/**
 * Initialize OCR with configuration
 */
export async function initOCR(config: OCRConfig): Promise<void> {
  return invokeCommand("init_ocr", { config });
}

/**
 * Perform OCR on an image file
 */
export async function ocrImageFile(request: OCRImageRequest): Promise<OCRResponse> {
  return invokeCommand("ocr_image_file", { request });
}

/**
 * Perform OCR on image bytes (base64)
 */
export async function ocrImageBytes(request: OCRBytesRequest): Promise<OCRResponse> {
  return invokeCommand("ocr_image_bytes", { request });
}

// ──────────────────────────────────────────────────────────────────────────
// Unified OCR labels for the AI image-occlusion flow (design D18 / task 3.2)
// ──────────────────────────────────────────────────────────────────────────

/** Deterministic label id for a desktop OCR line (ordinal + text hash). */
function stableOcrLineId(ordinal: number, text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `ocr-${ordinal}-${hash.toString(16)}`;
}

/**
 * OCR one base64 image into percent-boxed labels for occlusion assistance.
 *
 * Android: the bundled ML Kit Text Recognition plugin command (offline,
 * per-line boxes, source dims).
 * Everywhere else: the configured Rust OCR providers via `ocr_image_bytes`
 * (whose response carries `lines[].bbox_percent` when the provider supplies
 * boxes). Throws when neither backend yields labels — the caller surfaces an
 * OCRFailed state and manual authoring stays fully usable.
 */
export async function ocrImageLabelsForOcclusion(
  base64Image: string,
  options?: { maxResults?: number; provider?: string }
): Promise<OcclusionOcrLabelsResult> {
  // Prefer the on-device plugin; fall back on any typed "not here" failure.
  try {
    const { getOnDeviceOcrLabels } = await import("../lib/ai/onDeviceAI");
    const result = await getOnDeviceOcrLabels(base64Image, options?.maxResults);
    return {
      labels: result.labels.map((label) => ({
        id: label.id,
        text: label.text,
        confidence: label.confidence,
        x: label.x,
        y: label.y,
        width: label.width,
        height: label.height,
      })),
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      truncated: result.truncated,
      backend: "android-mlkit",
    };
  } catch {
    // platform_unsupported / not this device — fall through to Rust OCR.
  }

  const response = await ocrImageBytes({
    image_data: base64Image,
    provider: options?.provider,
  });
  if (!response.success) {
    throw new Error(response.error || "OCR failed");
  }
  const usable = (response.lines ?? []).filter((line) => line.bbox_percent);
  return {
    labels: usable.map((line, index) => {
      const [x, y, width, height] = line.bbox_percent!;
      return {
        id: stableOcrLineId(index, line.text),
        text: line.text,
        confidence: line.confidence > 0 ? line.confidence / 100 : undefined,
        x,
        y,
        width,
        height,
      };
    }),
    backend: "rust-ocr",
    provider: response.provider,
  };
}

/**
 * Perform OCR on a PDF file (multi-page)
 */
export async function ocrPdfFile(request: OCRPdfRequest): Promise<OCRPdfResponse> {
  return invokeCommand("ocr_pdf_file", { request });
}

/**
 * Extract key phrases from text
 */
export async function extractKeyPhrases(request: KeyPhraseRequest): Promise<KeyPhraseResponse> {
  return invokeCommand("extract_key_phrases", { request });
}

/**
 * Get available OCR providers
 */
export async function getAvailableOCRProviders(): Promise<string[]> {
  return invokeCommand("get_available_ocr_providers");
}

/**
 * Check if a provider is available
 */
export async function isProviderAvailable(provider: string): Promise<boolean> {
  return invokeCommand("is_provider_available", { provider });
}

/**
 * Get current OCR configuration
 */
export async function getOCRConfig(): Promise<OCRConfig> {
  return invokeCommand("get_ocr_config");
}

/**
 * Update OCR configuration
 */
export async function updateOCRConfig(config: OCRConfig): Promise<void> {
  return invokeCommand("update_ocr_config", { config });
}

/**
 * Inspect a configured or app-managed Nougat installation.
 */
export async function getNougatRuntimeStatus(nougatPath?: string): Promise<NougatRuntimeStatus> {
  return invokeCommand("nougat_runtime_status", { nougat_path: nougatPath });
}

/**
 * Install Nougat into Incrementum's isolated app-data runtime.
 */
export async function installManagedNougat(): Promise<NougatRuntimeStatus> {
  return invokeCommand("nougat_install_managed_runtime");
}

/**
 * Get GLM-OCR runtime status
 */
export async function getGLMRuntimeStatus(params: {
  backend: string;
  endpoint: string;
  ollama_path?: string;
}): Promise<GLMRuntimeStatus> {
  return invokeCommand("glm_runtime_status", params);
}

/**
 * Download Ollama installer (platform-specific)
 */
export async function downloadOllamaInstaller(): Promise<string> {
  return invokeCommand("glm_download_ollama_installer");
}

/**
 * Open installer in OS shell
 */
export async function openInstaller(path: string): Promise<void> {
  return invokeCommand("glm_open_installer", { path });
}

/**
 * Start Ollama runtime
 */
export async function startOllamaRuntime(params: {
  endpoint: string;
  ollama_path?: string;
}): Promise<void> {
  return invokeCommand("glm_start_ollama_runtime", params);
}

/**
 * Stop Ollama runtime
 */
export async function stopOllamaRuntime(): Promise<void> {
  return invokeCommand("glm_stop_ollama_runtime");
}

/**
 * Pull Ollama model
 */
export async function pullOllamaModel(params: {
  model: string;
  ollama_path?: string;
}): Promise<string> {
  return invokeCommand("glm_pull_ollama_model", params);
}
