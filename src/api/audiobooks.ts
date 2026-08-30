/**
 * Audiobook API
 * 
 * Handles audiobook metadata extraction, transcript management,
 * chapter parsing, and cover art fetching.
 * 
 * Supports both local Whisper and Groq cloud transcription.
 */

import { isNativeMobile, isTauri } from "../lib/tauri";
import { migratedGetItem } from "../lib/brandMigration";
import { useSettingsStore } from "../stores/settingsStore";
import { useTranscriptionStore } from "../stores/useTranscriptionStore";
import { describeResolution, resolveTranscriptionWithReadiness } from "../lib/transcriptionProvider";
import { 
  transcribeWithGroq, 
  convertGroqToInternalFormat,
  isGroqConfigured,
  GroqTranscriptionError,
} from "./groqTranscription";
import type { Document } from "../types/document";

export interface AudiobookMetadata {
  title: string;
  author?: string;
  narrator?: string;
  duration: number; // in seconds
  chapters: AudiobookChapter[];
  coverUrl?: string;
  description?: string;
  publisher?: string;
  publishYear?: number;
  language?: string;
  genre?: string[];
  isbn?: string;
  series?: string;
  seriesNumber?: number;
}

export interface AudiobookChapter {
  id: number;
  title: string;
  startTime: number; // in seconds
  endTime?: number; // in seconds
  duration?: number; // in seconds
}

export interface AudiobookTranscript {
  segments: TranscriptSegment[];
  fullText: string;
  language?: string;
  source: "generated" | "imported" | "fetched";
  lastUpdated: string;
}

export interface TranscriptSegment {
  id: string;
  text: string;
  startTime: number; // in seconds
  endTime: number; // in seconds
  speaker?: string;
  confidence?: number;
}

export interface AudiobookImportOptions {
  filePath: string;
  title?: string;
  author?: string;
  coverUrl?: string;
  transcript?: AudiobookTranscript;
  chapters?: AudiobookChapter[];
}

// Supported audiobook formats
export { AUDIOBOOK_FORMATS, isAudiobookFile } from "../utils/audioFormats";
import { AUDIOBOOK_FORMATS } from "../utils/audioFormats";

// Multi-part detection now lives in a pure module (no API/store graph) so the
// import planner can reuse it; re-exported here for existing consumers.
export {
  detectMultiPartAudiobook,
  type MultiPartAudiobook,
} from "../utils/audiobookMultipart";

// Scan directory for audiobook files
export async function scanDirectoryForAudiobooks(dirPath: string): Promise<string[]> {
  if (!isTauri()) {
    // Browser mode - can't scan directories
    return [];
  }

  const { invokeCommand } = await import("../lib/tauri");
  return await invokeCommand<string[]>("scan_directory_for_audiobooks", {
    dirPath,
    extensions: AUDIOBOOK_FORMATS,
  });
}

// ---------------------------------------------------------------------------
// Multi-file audiobook import (one logical book, many physical chapter files)
// ---------------------------------------------------------------------------

/** One physical chapter file of a multi-file audiobook. */
export interface MultipartPartInput {
  path: string;
  fileName?: string;
  relativePath?: string;
}

export interface MultipartImportOptions {
  files: MultipartPartInput[];
  /** Explicit (user-edited) title/author — outrank embedded tags. */
  title?: string;
  author?: string;
  /** Planner-derived (directory/filename) title/author — lowest priority. */
  fallbackTitle?: string;
  fallbackAuthor?: string;
  coverUrl?: string;
  tags?: string[];
  collectionId?: string;
}

export interface MultipartImportResult {
  document: Document;
  editionId: string;
  sectionCount: number;
  /** Fingerprint matched an existing logical audiobook; no new document. */
  deduplicated: boolean;
  /** Local media (edition/sections/files) was attached to a synced row. */
  attachedToExisting: boolean;
}

/**
 * Import a multi-file audiobook as ONE library document with one ready
 * imported Audio Edition and one section per physical file. Atomic Rust-side:
 * on failure nothing is persisted and staged files are removed.
 *
 * Tauri only — the folder/multipart pipeline needs native staging. Browser
 * mode throws a clear error (folder picks are unavailable there anyway).
 */
export async function importMultipartAudiobook(
  options: MultipartImportOptions,
): Promise<MultipartImportResult> {
  if (!isTauri()) {
    throw new Error("Multi-file audiobook import requires the Plethora desktop or mobile app.");
  }
  const { invokeCommand } = await import("../lib/tauri");
  return await invokeCommand<MultipartImportResult>("import_multipart_audiobook", {
    parts: options.files,
    title: options.title ?? null,
    author: options.author ?? null,
    fallbackTitle: options.fallbackTitle ?? null,
    fallbackAuthor: options.fallbackAuthor ?? null,
    coverUrl: options.coverUrl ?? null,
    tags: options.tags ?? null,
    collectionId: options.collectionId ?? null,
  });
}

// Batch audiobook import result
export interface BatchImportResult {
  successful: Array<{
    filePath: string;
    document: Document;
    metadata: Partial<AudiobookMetadata>;
  }>;
  failed: Array<{
    filePath: string;
    error: string;
  }>;
  total: number;
}

export async function parseAudiobookMetadata(filePath: string): Promise<AudiobookMetadata> {
  if (isTauri()) {
    // In Tauri, use backend to parse metadata
    const { invokeCommand } = await import("../lib/tauri");
    return await invokeCommand<AudiobookMetadata>("parse_audiobook_metadata", { filePath });
  }
  
  // Browser fallback - create basic metadata
  return createBasicMetadata(filePath);
}

// Create basic metadata from filename (browser fallback)
function createBasicMetadata(filePath: string): AudiobookMetadata {
  const fileName = filePath.split("/").pop()?.split("\\").pop() || "Unknown";
  const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
  
  // Try to parse "Author - Title" format
  const parts = nameWithoutExt.split(" - ");
  let title = nameWithoutExt;
  let author: string | undefined;
  
  if (parts.length >= 2) {
    author = parts[0].trim();
    title = parts.slice(1).join(" - ").trim();
  }
  
  return {
    title,
    author,
    duration: 0,
    chapters: [{
      id: 1,
      title: "Chapter 1",
      startTime: 0,
    }],
  };
}

// Search for audiobook cover art
export async function searchAudiobookCover(
  title: string,
  author?: string
): Promise<string[]> {
  try {
    // Use OpenLibrary or Google Books API for cover images
    const query = author ? `${title} ${author}` : title;
    const encodedQuery = encodeURIComponent(query);
    
    // Try Google Books first
    const response = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodedQuery}&maxResults=5`
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const covers: string[] = [];
    
    for (const item of data.items || []) {
      const imageLinks = item.volumeInfo?.imageLinks;
      if (imageLinks) {
        if (imageLinks.extraLarge) covers.push(imageLinks.extraLarge);
        else if (imageLinks.large) covers.push(imageLinks.large);
        else if (imageLinks.medium) covers.push(imageLinks.medium);
        else if (imageLinks.thumbnail) covers.push(imageLinks.thumbnail);
      }
    }
    
    return covers;
  } catch (error) {
    console.error("Failed to search audiobook cover:", error);
    return [];
  }
}

export async function extractAudioCoverArt(filePath: string): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }

  try {
    const { invokeCommand } = await import("../lib/tauri");
    const result = await invokeCommand<string | null>("extract_audio_cover_art", { filePath });
    return result;
  } catch (error) {
    console.error("Failed to extract audio cover art:", error);
    return null;
  }
}

// Search for audiobook metadata
export async function searchAudiobookMetadata(
  title: string,
  author?: string
): Promise<Partial<AudiobookMetadata>[]> {
  try {
    const query = author ? `${title} ${author}` : title;
    const encodedQuery = encodeURIComponent(query);
    
    const response = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodedQuery}&maxResults=5`
    );
    
    if (!response.ok) return [];
    
    const data = await response.json();
    
    return (data.items || []).map((item: any) => ({
      title: item.volumeInfo?.title || title,
      author: item.volumeInfo?.authors?.[0] || author,
      description: item.volumeInfo?.description,
      publisher: item.volumeInfo?.publisher,
      publishYear: item.volumeInfo?.publishedDate 
        ? parseInt(item.volumeInfo.publishedDate.substring(0, 4)) 
        : undefined,
      genre: item.volumeInfo?.categories,
      language: item.volumeInfo?.language,
      isbn: item.volumeInfo?.industryIdentifiers?.find(
        (id: any) => id.type === "ISBN_13" || id.type === "ISBN_10"
      )?.identifier,
      coverUrl: item.volumeInfo?.imageLinks?.thumbnail,
    }));
  } catch (error) {
    console.error("Failed to search audiobook metadata:", error);
    return [];
  }
}

/**
 * Generate transcript using local Whisper
 */
async function generateTranscriptWithLocalWhisper(
  filePath: string,
  modelId: string,
  language: string,
  onProgress?: (progress: number) => void
): Promise<AudiobookTranscript> {
  const { invokeCommand, listen } = await import("../lib/tauri");
  
  // Listen for progress events
  let unlisten: (() => void) | undefined;
  if (onProgress) {
    unlisten = await listen<{ progress: number }>("transcription://progress", (event) => {
      onProgress(event.payload.progress);
    });
  }

  try {
    // Use Tauri backend with Whisper
    const result = await invokeCommand<{
      segments: TranscriptSegment[];
      language?: string;
    }>("generate_audiobook_transcript", { 
      filePath,
      model: modelId,
      language: language === 'auto' ? undefined : language,
    });
    
    const fullText = result.segments.map(s => s.text).join(" ");
    
    return {
      segments: result.segments,
      fullText,
      language: result.language,
      source: "generated",
      lastUpdated: new Date().toISOString(),
    };
  } finally {
    if (unlisten) {
      try {
        unlisten();
      } catch {
        // Ignore errors during cleanup - listener may already be removed
      }
    }
  }
}

/**
 * Generate transcript using Groq API
 * Automatically handles chunking for large files
 */
async function generateTranscriptWithGroq(
  filePath: string,
  onProgress?: (progress: number) => void
): Promise<AudiobookTranscript> {
  if (!isGroqConfigured()) {
    throw new Error("Groq API key not configured. Please add your API key in Audio Transcription settings.");
  }
  
  const settings = useSettingsStore.getState().settings.audioTranscription;
  const language = settings.language === 'auto' ? undefined : settings.language;
  
  try {
    // Use the transcribeWithGroq API with filePath - it handles chunking automatically
    const response = await transcribeWithGroq({
      filePath,
      language,
      responseFormat: 'verbose_json',
      timestampGranularities: ['segment'],
      temperature: 0,
      onProgress,
    });
    
    const converted = convertGroqToInternalFormat(response);
    
    // Map to our segment format
    const segments: TranscriptSegment[] = converted.segments.map((seg, index) => ({
      id: `segment-${index}`,
      text: seg.text,
      startTime: seg.start_ms / 1000,
      endTime: seg.end_ms / 1000,
      confidence: seg.confidence,
    }));
    
    return {
      segments,
      fullText: converted.text,
      language: response.language,
      source: "generated",
      lastUpdated: new Date().toISOString(),
    };
    
  } catch (error) {
    if (error instanceof GroqTranscriptionError) {
      // Enhance error messages for audiobook context
      if (error.code === 'RATE_LIMITED') {
        throw new Error(
          `Groq rate limit reached. ${error.message} ` +
          `You can switch to local Whisper in settings or wait until your limits reset.`
        );
      }
      if (error.code === 'FILE_TOO_LARGE' || error.code === 'CHUNKING_FAILED') {
        throw new Error(
          `This audiobook is too large for Groq's free tier. ` +
          `Consider switching to local Whisper in settings for large audiobooks.`
        );
      }
      throw new Error(`Groq transcription failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Generate transcript using local models (Whisper/Parakeet) or Groq (Web/PWA)
 * Automatically uses the configured provider (local or Groq)
 * 
 * @param filePath Path to the audio file
 * @param onProgress Progress callback (0-100)
 * @returns Transcript with segments
 */
export async function generateTranscript(
  filePath: string,
  onProgress?: (progress: number) => void
): Promise<AudiobookTranscript> {
  const audioSettings = useSettingsStore.getState().settings.audioTranscription;
  const transcriptionStore = useTranscriptionStore.getState();
  let profiles = transcriptionStore.profiles;
  if (profiles.length === 0 && isTauri()) {
    await transcriptionStore.fetchProfiles();
    profiles = useTranscriptionStore.getState().profiles;
  }
  const resolution = await resolveTranscriptionWithReadiness(
    audioSettings,
    profiles,
    isNativeMobile() ? "native-mobile" : "desktop",
  );
  if (resolution.ok === false) {
    if (resolution.reason === "model-not-installed") {
      throw new Error(`Model '${resolution.modelId}' is not installed`);
    }
    if (resolution.reason === "missing-groq-key") {
      throw new Error("Groq API key not configured. Please add your API key in Audio Transcription settings.");
    }
    throw new Error(describeResolution(resolution));
  }

  if (resolution.provider === 'groq') {
    if (!isTauri()) {
      const { getBrowserFile } = await import("../lib/browser-file-store");
      const file = getBrowserFile(filePath);
      if (!file) throw new Error("Audio file not found in browser");
      
      const { transcribeWithGroq, convertGroqToInternalFormat } = await import("./groqTranscription");
      const language = useSettingsStore.getState().settings.audioTranscription.language;
      
      const response = await transcribeWithGroq({
        file,
        language: language === 'auto' ? undefined : language,
        responseFormat: 'verbose_json',
        timestampGranularities: ['segment'],
        temperature: 0,
        onProgress,
      });

      const converted = convertGroqToInternalFormat(response);
      const segments: TranscriptSegment[] = converted.segments.map((seg, index) => ({
        id: `segment-${index}`,
        text: seg.text,
        startTime: seg.start_ms / 1000,
        endTime: seg.end_ms / 1000,
        confidence: seg.confidence,
      }));

      return {
        segments,
        fullText: converted.text,
        language: response.language,
        source: "generated",
        lastUpdated: new Date().toISOString(),
      };
    } else {
      return generateTranscriptWithGroq(filePath, onProgress);
    }
  } else {
    return generateTranscriptWithLocalWhisper(
      filePath,
      resolution.modelId,
      audioSettings.language,
      onProgress,
    );
  }
}

/**
 * Get the currently configured transcription provider
 */
export function getTranscriptionProvider(): 'local' | 'groq' {
  const audioSettings = useSettingsStore.getState().settings.audioTranscription;
  const explicitCloud =
    audioSettings.sttProvider === "openrouter" ||
    (audioSettings.provider === "groq" &&
      audioSettings.sttProvider !== "local" &&
      audioSettings.sttProvider !== "automatic");
  return explicitCloud ? 'groq' : 'local';
}

/**
 * Check if transcription is available based on current provider and configuration
 */
export function isTranscriptionAvailable(): boolean {
  const provider = getTranscriptionProvider();
  
  if (provider === 'groq') {
    return isGroqConfigured();
  }
  
  return true;
}

export async function importTranscriptFromFile(
  filePath: string
): Promise<AudiobookTranscript> {
  const { readDocumentFile } = await import("./documents");
  
  // Read file content
  const content = await readDocumentFile(filePath);
  const text = new TextDecoder("utf-8").decode(content);
  
  // Try to parse as JSON first
  try {
    const json = JSON.parse(text);
    if (json.segments) {
      return {
        segments: json.segments,
        fullText: json.segments.map((s: TranscriptSegment) => s.text).join(" "),
        language: json.language,
        source: "imported",
        lastUpdated: new Date().toISOString(),
      };
    }
  } catch {
    // Not JSON, treat as plain text
  }
  
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  const segments: TranscriptSegment[] = paragraphs.map((text, index) => ({
    id: `segment-${index}`,
    text: text.trim(),
    startTime: 0, // Unknown timing for plain text
    endTime: 0,
  }));
  
  return {
    segments,
    fullText: text,
    source: "imported",
    lastUpdated: new Date().toISOString(),
  };
}

// Search for existing transcript online
export async function searchExistingTranscript(
  _title: string,
  _author?: string
): Promise<AudiobookTranscript | null> {
  // This could search various transcript repositories
  // For now, return null - would need to integrate with specific APIs
  return null;
}

export async function parseChapters(filePath: string): Promise<AudiobookChapter[]> {
  if (isTauri()) {
    const { invokeCommand } = await import("../lib/tauri");
    return await invokeCommand<AudiobookChapter[]>("parse_audiobook_chapters", { filePath });
  }
  
  return [{
    id: 1,
    title: "Chapter 1",
    startTime: 0,
  }];
}

export async function prepareAudiobookPlayback(filePath: string): Promise<string> {
  if (!isTauri()) {
    return filePath;
  }

  const { invokeCommand } = await import("../lib/tauri");
  return await invokeCommand<string>("prepare_audiobook_playback", { filePath });
}

// Format duration in seconds to human readable
export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return "0:00";
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

// Format file size
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export async function extractAudioSample(
  filePath: string,
  startTime: number,
  duration: number
): Promise<string> {
  if (!isTauri()) {
    throw new Error("Audio sample extraction requires the desktop app");
  }
  
  const { invokeCommand } = await import("../lib/tauri");
  return await invokeCommand<string>("extract_audio_sample", {
    filePath,
    startTime,
    duration,
  });
}

/**
 * Enrich a freshly-imported audiobook document with metadata + cover art derived
 * from its filename and an online lookup (Google Books). Used by the main import
 * path (which doesn't run the full AudiobookImportDialog flow) so that audiobooks
 * imported via the quick "+" import still get a title, author, description, and
 * cover attached. Best-effort and non-blocking — failures are swallowed.
 *
 * @param doc The document as imported (title is likely the filename).
 * @param filePath The staged readable filesystem path of the audio file.
 */
export async function enrichAudiobookDocument(doc: Document, filePath: string): Promise<void> {
  try {
    const fileName = filePath.split("/").pop()?.split("\\").pop() || filePath;
    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, "");
    // Parse "Author - Title" (the most common audiobook naming convention).
    const parts = nameWithoutExt.split(" - ");
    const titleGuess = parts.length >= 2 ? parts.slice(1).join(" - ").trim() : nameWithoutExt;
    const authorGuess = parts.length >= 2 ? parts[0].trim() : undefined;

    // Online metadata + cover lookup in parallel.
    const [metaResults, covers] = await Promise.all([
      searchAudiobookMetadata(titleGuess, authorGuess),
      searchAudiobookCover(titleGuess, authorGuess),
    ]);

    const best = metaResults[0] || {};
    const finalTitle = best.title || titleGuess;
    const finalAuthor = best.author || authorGuess;
    const coverUrl = best.coverUrl || covers[0];

    // Persist the enriched fields. Only attach what we found.
    const { updateDocument: updateDocumentApi } = await import("./documents");
    await updateDocumentApi(doc.id, {
      ...doc,
      title: finalTitle,
      coverImageUrl: coverUrl ?? doc.coverImageUrl,
      fileType: "audio",
      tags: ["audiobook", "audio", ...(best.genre || [])],
      metadata: {
        ...(doc.metadata || {}),
        author: finalAuthor,
        subject: best.description?.substring(0, 200),
        keywords: best.genre,
        language: best.language,
      },
    } as Document);
  } catch (err) {
    console.error("[audiobook] enrichAudiobookDocument failed (non-critical):", err);
  }
}

/**
 * Transcribe a local audiobook file via Groq cloud transcription, entirely on
 * the Rust side (read file → ffmpeg-free chunking → per-chunk Groq upload →
 * persist segments to the document transcript tables). This is the path used on
 * mobile, where local Whisper/Parakeet/SenseVoice sidecars are unavailable and
 * the auto-transcription queue worker has no Groq branch. Also works on desktop
 * when the user's provider is Groq.
 *
 * The Rust command persists segments into the same `transcripts`/`
 * transcript_segments` tables `get_transcript` reads from (keyed by
 * book_id=chapter_id=document_id), and writes the combined text to
 * `documents.content`. So once this resolves, the viewer's transcript panel,
 * karaoke highlight, and auto-scroll (book sync) all work automatically.
 *
 * Emits `audiobook://transcription-progress` / `-complete` / `-error` events
 * keyed by `documentId` (these are also emitted from Rust during processing).
 * Returns the number of transcribed segments.
 */
export async function transcribeAudiobookWithGroq(
  documentId: string,
  filePath: string,
  language?: string,
): Promise<number> {
  if (!isTauri()) {
    throw new Error("Groq audiobook transcription requires the app (Tauri) backend.");
  }

  // Read the Groq key + model from persisted settings — the Rust command runs
  // server-side and can't read the JS store. Mirrors the podcast path.
  const { apiKey, model } = (() => {
    try {
      const raw = migratedGetItem("plethora-settings");
      const parsed = raw ? JSON.parse(raw) : null;
      const g = parsed?.state?.settings?.audioTranscription?.groq;
      return { apiKey: g?.apiKey || "", model: g?.model || "whisper-large-v3-turbo" };
    } catch {
      return { apiKey: "", model: "whisper-large-v3-turbo" };
    }
  })();
  if (!apiKey) {
    throw new Error("Groq API key not configured. Please add your API key in Audio Transcription settings.");
  }

  const { invokeCommand } = await import("../lib/tauri");
  const segmentCount = await invokeCommand<number>("transcribe_audio_file_groq", {
    documentId,
    filePath,
    language: language ?? null,
    groqApiKey: apiKey,
    groqModel: model,
  });
  return segmentCount;
}

/**
 * Transcribe an imported audiobook entirely on device (Android sherpa-onnx
 * engine — SenseVoice multilingual / Parakeet English). Fully offline and
 * key-free; the Rust command runs the job (decode → VAD → recognizer) and
 * persists timed segments with per-poll checkpointing, so an interrupted run
 * resumes from where it stopped on retry. Mirrors the Groq wrapper: same
 * `audiobook://transcription-progress` / `-complete` events (keyed by
 * documentId) and the same transcripts/transcript_segments output, so the
 * viewer's transcript panel and player sync work unchanged.
 */
export async function transcribeAudiobookOnDevice(
  documentId: string,
  filePath: string,
  language?: string,
): Promise<number> {
  if (!isTauri()) {
    throw new Error("On-device transcription requires the app (Tauri) backend.");
  }

  // Model + pacing preferences live in the JS settings store; the Rust
  // command takes them explicitly (same split as the Groq key).
  const { modelId, pacing } = (() => {
    try {
      const raw = migratedGetItem("plethora-settings");
      const parsed = raw ? JSON.parse(raw) : null;
      const od = parsed?.state?.settings?.audioTranscription?.androidOnDevice;
      return {
        modelId: od?.modelId || "",
        pacing: od?.pacing === "full" ? "full" : "capped",
      };
    } catch {
      return { modelId: "", pacing: "capped" };
    }
  })();

  const { invokeCommand } = await import("../lib/tauri");
  const segmentCount = await invokeCommand<number>("transcribe_audio_file_on_device", {
    documentId,
    filePath,
    language: language ?? null,
    modelId: modelId || null,
    pacing,
    title: null,
  });
  return segmentCount;
}
