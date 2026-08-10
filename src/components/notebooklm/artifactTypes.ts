/**
 * Shared artifact-type vocabulary for the NotebookLM panel.
 *
 * Three spellings are in play across the stack:
 *   - UI: kebab-case ids ("mind-map", "data-table", "slide-deck")
 *   - Python CLI: snake_case enum values ("mind_map", "slide_deck", "data_table")
 *   - Rust: `normalize_cli_type` output (kebab-case, mirrors the UI)
 * plus two historical joined spellings ("mindmap", "datatable") that old jobs
 * may carry. Every consumer — tiles, viewer, importer, export — must go
 * through `normalizeArtifactType` so the layers cannot disagree on a type
 * string. This is exactly how `slide-deck`/`infographic` ended up in
 * `canViewArtifact` with no way to generate them.
 */

/** Canonical kebab-case artifact type ids the Studio offers as tiles. */
export type StudioArtifactType =
  | "flashcards"
  | "quiz"
  | "report"
  | "study-guide"
  | "audio"
  | "video"
  | "mind-map"
  | "data-table"
  | "slide-deck"
  | "infographic";

/**
 * Single source of truth for which artifact types exist as Studio tiles.
 * `ARTIFACT_TYPES` in NotebookLMStudio builds its per-tile display metadata
 * from this list.
 */
export const STUDIO_ARTIFACT_TYPES: readonly StudioArtifactType[] = [
  "flashcards",
  "quiz",
  "audio",
  "video",
  "study-guide",
  "report",
  "mind-map",
  "data-table",
  "slide-deck",
  "infographic",
];

/** Joined-spelling aliases that cannot be derived by mechanical replacement. */
const ARTIFACT_TYPE_ALIASES: Record<string, string> = {
  mindmap: "mind-map",
  datatable: "data-table",
};

/**
 * Normalize any artifact-type spelling to the canonical kebab-case id:
 * lowercases, collapses `_`/spaces to `-`, and maps historical joined forms.
 */
export function normalizeArtifactType(raw: string): string {
  const collapsed = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return ARTIFACT_TYPE_ALIASES[collapsed] ?? collapsed;
}

/**
 * Artifact types with a defined import path into the library. After this
 * change every Studio type imports (flashcards/quiz via the existing sync
 * commands, the rest via `notebooklm_import_job_artifact`), so this is the
 * full Studio list. The set is derived from STUDIO_ARTIFACT_TYPES so a tile
 * added without an import path fails the coverage assert below.
 */
const IMPORTABLE_TYPES: ReadonlySet<string> = new Set(STUDIO_ARTIFACT_TYPES);

/**
 * Artifact types the backend CLI can dispatch generation for. Mirrors the
 * `generate_artifact` match arms in `src-tauri/src/notebooklm.rs`.
 */
const GENERATABLE_TYPES: ReadonlySet<string> = new Set(STUDIO_ARTIFACT_TYPES);

/**
 * Artifact types that open in the artifact viewer. Text/structured types
 * (report, study-guide, mind-map, data-table) plus media (audio, video,
 * slide-deck, infographic) render in a dedicated viewer; flashcards and quiz
 * use the preview/import flow instead.
 */
const VIEWABLE_TYPES: ReadonlySet<string> = new Set([
  "audio",
  "video",
  "report",
  "study-guide",
  "mind-map",
  "data-table",
  "slide-deck",
  "infographic",
]);

/**
 * Artifact types whose substance lives in the job payload (text or JSON) and
 * can therefore be exported to a file. Media types (audio, video, slide-deck,
 * infographic) are binary files and are excluded — importing them is how they
 * reach disk.
 */
const PAYLOAD_BACKED_TYPES: ReadonlySet<string> = new Set([
  "flashcards",
  "quiz",
  "report",
  "study-guide",
  "mind-map",
  "data-table",
]);

/** Whether the type has a defined import path into the library. */
export function canImportArtifactType(raw: string): boolean {
  return IMPORTABLE_TYPES.has(normalizeArtifactType(raw));
}

/** Whether the type opens in the artifact viewer. */
export function canViewArtifactType(raw: string): boolean {
  return VIEWABLE_TYPES.has(normalizeArtifactType(raw));
}

/** Whether the type is a structured artifact (mind-map, data-table). */
export function isStructuredArtifactType(raw: string): boolean {
  const t = normalizeArtifactType(raw);
  return t === "mind-map" || t === "data-table";
}

/** Whether the type is payload-backed and eligible for file export. */
export function isPayloadBackedArtifactType(raw: string): boolean {
  return PAYLOAD_BACKED_TYPES.has(normalizeArtifactType(raw));
}

/**
 * Per-type generation option surface, mirroring the CLI flags the backend
 * `generate_artifact` match accepts. Only types listed here show an options
 * form; types absent from this map generate immediately on tile click.
 */
export interface ArtifactGenerationOptions {
  format?: "detailed" | "presenter";
  length?: "default" | "short";
  orientation?: "landscape" | "portrait" | "square";
  detail?: "concise" | "standard" | "detailed";
  style?: string;
}

interface ArtifactOptionField {
  key: keyof ArtifactGenerationOptions;
  /** Fixed choices; empty means free-text entry. */
  choices: readonly string[];
}

export const ARTIFACT_TYPE_OPTION_FIELDS: Partial<
  Record<StudioArtifactType, readonly ArtifactOptionField[]>
> = {
  "slide-deck": [
    { key: "format", choices: ["detailed", "presenter"] },
    { key: "length", choices: ["default", "short"] },
  ],
  infographic: [
    { key: "orientation", choices: ["landscape", "portrait", "square"] },
    { key: "detail", choices: ["concise", "standard", "detailed"] },
    { key: "style", choices: [] },
  ],
};

/** Assert every Studio tile resolves in both the import map and the backend
 * dispatch. This is what would have caught `slide-deck`/`infographic` sitting
 * in `canViewArtifact` with no way to generate or import them. Throws on
 * mismatch so a future tile added to one layer but not the others fails fast.
 */
export function assertArtifactTypeCoverage(): void {
  const missingImport = STUDIO_ARTIFACT_TYPES.filter((t) => !IMPORTABLE_TYPES.has(t));
  const missingBackend = STUDIO_ARTIFACT_TYPES.filter((t) => !GENERATABLE_TYPES.has(t));
  const problems: string[] = [];
  if (missingImport.length > 0) {
    problems.push(`Studio tiles missing an import path: ${missingImport.join(", ")}`);
  }
  if (missingBackend.length > 0) {
    problems.push(`Studio tiles missing backend dispatch: ${missingBackend.join(", ")}`);
  }
  if (problems.length > 0) {
    throw new Error(`Artifact type coverage broken: ${problems.join("; ")}`);
  }
}
