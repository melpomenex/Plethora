import type { ImageOcclusionRegion } from "../types/learningItemInteractions";
import { clampPercent, isDuplicateRegion } from "./occlusion";

/**
 * AI occlusion-region proposal support.
 *
 * The vision prompt and the 0–1000 bbox → percent normalization were moved
 * out of `FlashcardStudioModal.tsx` so the Image Occlusion Composer and the
 * studio share one module. The prompt is single-image (a composer session
 * always authoring one image) and carries an optional refinement block that
 * tells the model which areas are already covered so re-runs propose
 * different regions.
 */

/** System prompt for a single-image occlusion proposal request. */
export const IMAGE_OCCLUSION_SYSTEM_PROMPT = `You propose image occlusion regions for one study image.

Return a JSON code block with this exact schema:

\`\`\`json
{
  "regions": [
    { "bbox": [ymin, xmin, ymax, xmax], "label": "optional short label" }
  ]
}
\`\`\`

Rules:
- Return ONLY the JSON code block.
- bbox is [ymin, xmin, ymax, xmax] with each value in the range 0-1000, normalized to the full image dimensions.
- Create 1-4 useful hidden regions when the image supports it.
- Hide labels, terms, callouts, diagram parts, answers, or key visual anchors.
- Do not create tiny unusable boxes. Keep regions readable and reasonably tight.
- If the image does not contain good occlusion targets, return "regions": [].
- Keep labels concise.`;

/**
 * Build the refinement instruction for a re-run: names the areas already
 * covered (accepted + manually drawn regions) so the model proposes
 * different ones. Returns an empty string when nothing is covered yet.
 */
export function buildImageOcclusionRefinementInstruction(
  coveredRegions: ImageOcclusionRegion[],
): string {
  if (coveredRegions.length === 0) return "";
  const covered = coveredRegions
    .map((region) => {
      const label = region.label ? ` (label: ${region.label})` : "";
      return (
        `[${region.x.toFixed(1)}, ${region.y.toFixed(1)}, ` +
        `${(region.x + region.width).toFixed(1)}, ${(region.y + region.height).toFixed(1)}]` +
        label
      );
    })
    .join(", ");
  return (
    `The following areas are already covered by existing regions ` +
    `(percent bounds [xmin, ymin, xmax, ymax]): ${covered}. ` +
    `Propose different areas that do not substantially overlap the covered ones.`
  );
}

/**
 * Whether a provider/model combination can accept image input. Mirrors the
 * allow-list the Flashcard Studio uses (now shared so the composer's
 * "Suggest regions" action can decide its disabled state from one place).
 */
export function modelSupportsImageInput(provider: string, model?: string, baseUrl?: string): boolean {
  const normalizedModel = (model || "").trim().toLowerCase();
  const normalizedBaseUrl = (baseUrl || "").trim().toLowerCase();

  if (!normalizedModel) return false;

  if (provider === "anthropic") {
    return /claude-3|claude-3-5|claude-3\.5|claude-3-7|claude-sonnet|claude-opus|claude-haiku/.test(normalizedModel);
  }

  if (provider === "openai") {
    return /gpt-4o|gpt-4\.1|gpt-5|gpt-4-turbo|\bo1\b|\bo3\b|vision|vl|llava|glm-4v|qwen.*vl|minicpm-v|gemma-?3|llama-3\.2-vision/.test(normalizedModel)
      || (normalizedBaseUrl.includes("localhost") && /llava|vision|vl|glm-4v|qwen.*vl|minicpm-v|gemma-?3/.test(normalizedModel));
  }

  if (provider === "openrouter") {
    return /gpt-4o|gpt-4\.1|gpt-5|\bo1\b|\bo3\b|claude|gemini|gemma-?3|grok-4|grok-2-vision|vision|vl|llava|pixtral|glm-4v|qwen.*vl|minicpm-v|llama-3\.1|llama-3\.2|llama-4|mistral-small|phi-3\.5-vision|phi-4/.test(normalizedModel);
  }

  if (provider === "ollama") {
    return /llava|bakllava|vision|vl|qwen.*vl|minicpm-v|gemma-?3|llama-3\.2-vision/.test(normalizedModel);
  }

  if (provider === "gemini") {
    return /gemini/.test(normalizedModel);
  }

  return false;
}

/**
 * Extract the first balanced JSON object/array from a model response,
 * tolerating stray prose, missing fences, and trailing commas. Returns the
 * parsed value, or null when nothing parseable is present.
 */
export function extractJsonFromResponse(content: string): unknown {
  const normalized = (content || "").replace(/\r\n/g, "\n");
  // Prefer a fenced JSON code block.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(normalized);
  const candidates: string[] = [];
  if (fence) candidates.push(fence[1]);

  // Fall back to the first balanced object/array anywhere in the text.
  const start = Math.min(
    ...[normalized.indexOf("{"), normalized.indexOf("[")].filter((i) => i >= 0),
  );
  if (Number.isFinite(start)) {
    let inString = false;
    let escaping = false;
    let depth = 0;
    let opened = false;
    for (let i = start; i < normalized.length; i++) {
      const ch = normalized[i];
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        if (inString) escaping = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{" || ch === "[") {
        opened = true;
        depth += 1;
      } else if (ch === "}" || ch === "]") {
        depth -= 1;
        if (opened && depth === 0) {
          candidates.push(normalized.slice(start, i + 1));
          break;
        }
      }
    }
  }

  for (const candidate of candidates) {
    const cleaned = candidate
      .replace(/^\s*json\s*\n/i, "")
      .trim()
      .replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(cleaned);
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/**
 * Parse an occlusion-proposal response into the raw `regions` value the
 * normalizer expects. Returns null when the response is unparseable.
 */
export function parseOcclusionResponse(content: string): unknown {
  const parsed = extractJsonFromResponse(content);
  if (parsed && typeof parsed === "object") {
    const regions = (parsed as Record<string, unknown>).regions;
    if (regions !== undefined) return regions;
  }
  return null;
}

/** Result of `normalizeOcclusionRegions`, with dropped-proposal accounting. */
export interface NormalizeOcclusionRegionsResult {
  /** Usable regions, clamped to the image bounds and deduplicated. */
  regions: ImageOcclusionRegion[];
  /** Proposals dropped because they are malformed or clamp to zero area. */
  droppedOutOfBounds: number;
  /** Proposals dropped because they duplicate an already-accepted region. */
  droppedDuplicate: number;
}

export interface NormalizeOcclusionRegionsOptions {
  /** Already-accepted regions; proposals overlapping these are dropped as duplicates. */
  existingRegions?: ImageOcclusionRegion[];
  /** IoU threshold above which a proposal counts as a duplicate (default 0.6). */
  duplicateThreshold?: number;
}

/**
 * Normalize a raw model response into percent-based occlusion regions.
 *
 * Accepts either 0–1000 `bbox: [ymin, xmin, ymax, xmax]` entries or plain
 * percent `x/y/width/height` entries. Every region is clamped to the image
 * bounds; a proposal that clamps to zero area (or is malformed) is counted in
 * `droppedOutOfBounds`, and a proposal that substantially overlaps an
 * already-accepted region is counted in `droppedDuplicate` — nothing is
 * silently swallowed.
 */
export function normalizeOcclusionRegions(
  value: unknown,
  options?: NormalizeOcclusionRegionsOptions,
): NormalizeOcclusionRegionsResult {
  if (!Array.isArray(value)) {
    return { regions: [], droppedOutOfBounds: 0, droppedDuplicate: 0 };
  }
  const threshold = options?.duplicateThreshold ?? 0.6;
  const accepted: ImageOcclusionRegion[] = [...(options?.existingRegions ?? [])];
  const result: NormalizeOcclusionRegionsResult = {
    regions: [],
    droppedOutOfBounds: 0,
    droppedDuplicate: 0,
  };

  value.forEach((entry, index) => {
    const region = entry as Record<string, unknown>;
    let x: number;
    let y: number;
    let width: number;
    let height: number;
    let xmin: number;
    let ymin: number;
    let xmax: number;
    let ymax: number;

    if (Array.isArray(region.bbox) && region.bbox.length >= 4) {
      const [bYmin, bXmin, bYmax, bXmax] = (region.bbox as unknown[]).map((v) => Number(v));
      xmin = bXmin;
      ymin = bYmin;
      xmax = bXmax;
      ymax = bYmax;
      x = clampPercent(bXmin / 10);
      y = clampPercent(bYmin / 10);
      width = clampPercent((bXmax - bXmin) / 10);
      height = clampPercent((bYmax - bYmin) / 10);
    } else {
      xmin = Number(region.x);
      ymin = Number(region.y);
      xmax = Number(region.x) + Number(region.width);
      ymax = Number(region.y) + Number(region.height);
      x = clampPercent(Number(region.x));
      y = clampPercent(Number(region.y));
      width = clampPercent(Number(region.width));
      height = clampPercent(Number(region.height));
    }

    // Malformed / non-numeric proposal — count as out of bounds.
    if (![xmin, ymin, xmax, ymax].every(Number.isFinite)) {
      result.droppedOutOfBounds += 1;
      return;
    }
    width = Math.min(width, 100 - x);
    height = Math.min(height, 100 - y);
    if (width <= 0 || height <= 0) {
      result.droppedOutOfBounds += 1;
      return;
    }

    const candidate: ImageOcclusionRegion = {
      id: (typeof region.id === "string" ? region.id : null) || `region-${index + 1}`,
      x,
      y,
      width,
      height,
      label: typeof region.label === "string" ? region.label : undefined,
      color: typeof region.color === "string" ? region.color : undefined,
    };
    if (isDuplicateRegion(candidate, accepted, threshold)) {
      result.droppedDuplicate += 1;
      return;
    }
    accepted.push(candidate);
    result.regions.push(candidate);
  });

  return result;
}
