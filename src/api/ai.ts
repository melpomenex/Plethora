import { invokeCommand, isTauri } from "../lib/tauri";

/**
 * AI Provider types
 */
export enum LLMProviderType {
  OpenAI = "OpenAI",
  Anthropic = "Anthropic",
  OpenRouter = "OpenRouter",
  Ollama = "Ollama",
  DeepSeek = "DeepSeek",
}

/**
 * AI Configuration
 */
export interface AIConfig {
  default_provider: LLMProviderType;
  api_keys: APIKeys;
  models: ModelPreferences;
  local_settings: LocalSettings;
}

/**
 * API Keys for different providers
 */
export interface APIKeys {
  openai?: string;
  anthropic?: string;
  openrouter?: string;
  brave?: string;
  deepseek?: string;
}

/**
 * Model preferences
 */
export interface ModelPreferences {
  openai_model: string;
  anthropic_model: string;
  openrouter_model: string;
  ollama_model: string;
  deepseek_model?: string;
  temperature: number;
  max_tokens: number;
}

/**
 * Local LLM settings
 */
export interface LocalSettings {
  ollama_base_url: string;
  timeout_secs: number;
  openai_base_url?: string;
  deepseek_base_url?: string;
  ollama_context_tokens?: number;
  ollama_model_context_windows?: Record<string, number>;
}

/**
 * Generated flashcard
 */
export interface GeneratedFlashcard {
  question: string;
  answer: string;
  card_type: string;
  tags: string[];
  /** Cloze-deletion text for cloze cards; absent for plain Q&A cards. */
  cloze_text?: string;
}

/**
 * Flashcard generation options
 */
export interface FlashcardGenerationOptions {
  count: number;
  include_cloze: boolean;
  include_qa: boolean;
  difficulty?: number;
}

/**
 * Simplification levels
 */
export type SimplificationLevel = "elementary" | "highschool" | "college" | "expert";

/**
 * Get AI configuration
 */
export async function getAIConfig(): Promise<AIConfig | null> {
  return await invokeCommand<AIConfig | null>("get_ai_config");
}

/**
 * Set AI configuration
 */
export async function setAIConfig(config: AIConfig): Promise<void> {
  return await invokeCommand("set_ai_config", { config });
}

/**
 * Set API key for a provider (stores in OS keychain)
 */
export async function setApiKey(provider: string, apiKey: string): Promise<void> {
  return await invokeCommand("set_api_key", { provider, apiKey });
}

/**
 * Get a masked API key (last 4 characters visible)
 */
export async function getMaskedApiKey(provider: string): Promise<string | null> {
  return await invokeCommand<string | null>("get_masked_api_key", { provider });
}

/**
 * Remove an API key from keychain
 */
export async function removeApiKey(provider: string): Promise<void> {
  return await invokeCommand("remove_api_key", { provider });
}

/** Check if a string looks like a masked key (contains asterisks) */
export function isMaskedKey(key: string): boolean {
  return key.includes("*");
}

/**
 * Generate flashcards from an extract
 */
export async function generateFlashcardsFromExtract(
  extractId: string,
  options: FlashcardGenerationOptions
): Promise<GeneratedFlashcard[]> {
  return await invokeCommand<GeneratedFlashcard[]>("generate_flashcards_from_extract", {
    extractId,
    options,
  });
}

/**
 * Generate flashcards from content
 */
export async function generateFlashcardsFromContent(
  content: string,
  count: number
): Promise<GeneratedFlashcard[]> {
  return await invokeCommand<GeneratedFlashcard[]>("generate_flashcards_from_content", {
    content,
    count,
  });
}

/**
 * Answer a question with document context
 */
export async function answerQuestion(
  question: string,
  context: string
): Promise<string> {
  return await invokeCommand<string>("answer_question", { question, context });
}

/**
 * Answer a question about an extract
 */
export async function answerAboutExtract(
  extractId: string,
  question: string
): Promise<string> {
  return await invokeCommand<string>("answer_about_extract", { extractId, question });
}

/**
 * Summarize content
 */
export async function summarizeContent(
  content: string,
  maxWords: number
): Promise<string> {
  return await invokeCommand<string>("summarize_content", { content, maxWords });
}

/**
 * Extract key points from content
 */
export async function extractKeyPoints(
  content: string,
  count: number
): Promise<string[]> {
  return await invokeCommand<string[]>("extract_key_points", { content, count });
}

/**
 * Generate title for content
 */
export async function generateTitle(content: string): Promise<string> {
  return await invokeCommand<string>("generate_title", { content });
}

/**
 * Simplify content
 */
export async function simplifyContent(
  content: string,
  level: SimplificationLevel
): Promise<string> {
  return await invokeCommand<string>("simplify_content", { content, level });
}

/**
 * Generate questions from content
 */
export async function generateQuestions(
  content: string,
  count: number
): Promise<string[]> {
  return await invokeCommand<string[]>("generate_questions", { content, count });
}

/**
 * List available Ollama models
 */
export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  return await invokeCommand<string[]>("list_ollama_models", { baseUrl });
}

/**
 * Test AI connection
 */
export async function testAIConnection(providerType: LLMProviderType): Promise<string> {
  return await invokeCommand<string>("test_ai_connection", { providerType });
}

export interface ProgressiveSummaryEntry {
  level: number;
  summary: string;
  word_count: number;
}

/**
 * Generate progressive disclosure summaries for an extract.
 * Summaries are cached in the database after generation.
 */
export async function generateProgressiveSummaries(
  extractId: string
): Promise<ProgressiveSummaryEntry[]> {
  if (!isTauri()) return Promise.reject(new Error("This feature requires the desktop app"));
  return await invokeCommand<ProgressiveSummaryEntry[]>(
    "generate_progressive_summaries",
    { extractId }
  );
}

/**
 * Keychain provider names for the DAQE decision models.
 *
 * OpenRouter is deliberately absent: one OpenRouter key serves both chat
 * completions and the `decisions` modality, so a user who already configured one
 * should not be asked for a second.
 */
export const DECISION_KEY_PROVIDERS = {
  jev: "jev",
  clef: "clef",
  /** Shared with the chat provider, on purpose. */
  openrouter: "openrouter",
  /** Shared with the chat provider, on purpose. */
  openai: "openai",
} as const;

export type DecisionKeyProvider =
  (typeof DECISION_KEY_PROVIDERS)[keyof typeof DECISION_KEY_PROVIDERS];

/**
 * Store a decision-provider key in the OS keychain.
 *
 * Returns the masked form (last four characters) so the UI can confirm what was
 * saved without ever holding the secret in component state after the write.
 */
export async function setDecisionApiKey(
  provider: DecisionKeyProvider,
  apiKey: string,
): Promise<string | null> {
  await setApiKey(provider, apiKey);
  return getMaskedApiKey(provider);
}

/** Whether a decision-provider key is present, without revealing it. */
export async function hasDecisionApiKey(provider: DecisionKeyProvider): Promise<boolean> {
  return (await getMaskedApiKey(provider)) !== null;
}

/** Delete a decision-provider key from the keychain. */
export async function clearDecisionApiKey(provider: DecisionKeyProvider): Promise<void> {
  await removeApiKey(provider);
}

/**
 * Perform one decision-model request from the **backend**.
 *
 * ## Why not from the webview
 *
 * A `POST` with `content-type: application/json` and an `Authorization` header
 * triggers a CORS preflight. `api.cloudflare.com` does not answer preflight for
 * browser origins, so the request never leaves the renderer — and WebKit
 * reports that as `Load failed`, indistinguishable from a dead host. Routing
 * through Rust removes the renderer from the request path entirely, which is how
 * every other paid AI call in this app already works.
 *
 * The Rust side also assembles the endpoint, which is not incidental: Workers AI
 * addresses a model in the *path* (`/ai/run/@cf/cloudflare/clef`) while System One
 * providers use `/v1/systemone`. Assembling that in one place is what stopped a
 * Clef URL from being built as `…/accounts/{id}/v1/systemone`, which 404s while
 * looking exactly like a wrong account id.
 */
export type DaqeHttpProvider =
  | "jev"
  | "clef"
  | "openrouter-decisions"
  | "openai-decisions"
  | "system-one";

export interface DaqeHttpRequest {
  provider: DaqeHttpProvider;
  baseUrl?: string;
  model?: string;
  cloudflareAccountId?: string;
  state: unknown;
  questions: unknown;
  timeoutMs?: number;
}

export interface DaqeHttpResponse {
  ok: boolean;
  status: number;
  body?: unknown;
  /** The endpoint actually called, after provider assembly. */
  url: string;
  error?: string;
  reason?: string;
}

export async function daqueDecisionRequest(
  request: DaqeHttpRequest,
): Promise<DaqeHttpResponse> {
  return invokeCommand<DaqeHttpResponse>("daqe_decision_request", { request });
}

/** Map a DAQE provider id onto the backend's wire name. */
export function daqueHttpProviderFor(providerId: string): DaqeHttpProvider | null {
  switch (providerId) {
    case "jev":
      return "jev";
    case "clef":
      return "clef";
    case "openrouter-decisions":
      return "openrouter-decisions";
    case "openai-decisions":
      return "openai-decisions";
    case "laya":
    case "local-decision-engine":
      return "system-one";
    default:
      // "none" and the AI spine have no System One endpoint of their own.
      return null;
  }
}
