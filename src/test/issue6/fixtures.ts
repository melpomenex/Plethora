/** Stable issue #6 source and provider data shared by workflow tests. */
export const ISSUE6_CLOCK = "2026-10-29T12:00:00Z";
export const ISSUE6_IDS = {
  document: "issue6-document",
  extract: "issue6-extract",
  video: "issue6-video",
  videoExtract: "issue6-video-extract",
  playlist: "issue6-playlist",
  cards: ["issue6-basic", "issue6-qa", "issue6-cloze", "issue6-occlusion"],
} as const;

export const ISSUE6_SECTIONED_CONTENT = [
  "# First",
  "First section body.",
  "## Shared",
  "First shared body.",
  "# Second",
  "Second section body.",
  "## Shared",
  "Second shared body.",
].join("\n");

export interface Issue6ProviderRequest {
  documentId: string;
  sourceContent: string;
}

/** An offline provider boundary with an observable request history. */
export function createIssue6Provider(options: { error?: Error } = {}) {
  const requests: Issue6ProviderRequest[] = [];
  return {
    requests,
    async generate(request: Issue6ProviderRequest) {
      requests.push({ ...request });
      if (options.error) throw options.error;
      return {
        cards: [{
          type: "qa" as const,
          question: "What is in the second section?",
          answer: "Second section body.",
        }],
      };
    },
  };
}
