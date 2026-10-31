export const CARD_TOOL_NAMES = new Set([
  "create_qa_card",
  "create_cloze_card",
  "batch_create_cards",
]);

const CLOZE_MARKER = /\{\{[\s\S]*?\}\}|\[\[[\s\S]*?\]\]/;

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      const joined = value
        .map((item) => nonEmptyString(item) ?? "")
        .filter(Boolean)
        .join(" ")
        .trim();
      if (joined) return joined;
      continue;
    }
    const text = nonEmptyString(value);
    if (text) return text;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function unwrapArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
      if (isRecord(parsed) && Array.isArray(parsed.cards)) return parsed.cards;
    } catch {
      return undefined;
    }
  }
  if (isRecord(value) && Array.isArray(value.cards)) return value.cards;
  return undefined;
}

function normalizeCardType(value: string | undefined): "qa" | "cloze" | undefined {
  const key = value?.toLowerCase().replace(/[\s_\-&/]+/g, "");
  if (!key) return undefined;
  if (["cloze", "clozedeletion", "deletion", "fillintheblank", "fillblank"].includes(key)) return "cloze";
  if (["qa", "questionanswer", "question", "basic", "flashcard", "standard", "frontback"].includes(key)) return "qa";
  return undefined;
}

export function normalizeCardCandidate(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return {};
    return CLOZE_MARKER.test(text)
      ? { type: "cloze", question: text, text }
      : { type: "qa", question: text };
  }
  if (!isRecord(value)) return {};

  const card: Record<string, unknown> = { ...value };
  const explicitType = normalizeCardType(firstString(card.type, card.card_type, card.cardType, card.kind));
  const textValue = firstString(card.text, card.cloze, card.clozeText, card.cloze_text, card.content, card.sentence, card.cloze_sentence);
  const question = firstString(card.question, card.front, card.prompt, card.term, card.Q, card.q, card.question_text, card.questionText);
  const answer = firstString(card.answer, card.back, card.response, card.definition, card.A, card.a, card.answer_text, card.answerText);

  const inferredCloze = explicitType === "cloze"
    || (!answer && Boolean(textValue))
    || (!answer && CLOZE_MARKER.test(question ?? ""));
  const type = explicitType === "qa" && answer ? "qa" : inferredCloze ? "cloze" : explicitType ?? "qa";
  card.type = type;

  if (type === "cloze") {
    const clozeText = textValue ?? question;
    if (clozeText) {
      card.question = clozeText;
      card.text = clozeText;
    }
  } else {
    if (question) card.question = question;
    if (answer) card.answer = answer;
  }
  return card;
}

export function isUsableCardCandidate(value: unknown): boolean {
  const card = normalizeCardCandidate(value);
  if (!firstString(card.question, card.text)) return false;
  if (card.type === "cloze") return true;
  return Boolean(firstString(card.answer));
}

export function normalizeCardToolParameters(
  toolName: string,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  if (!CARD_TOOL_NAMES.has(toolName)) return parameters;
  const normalized: Record<string, unknown> = { ...parameters };

  if (toolName === "batch_create_cards") {
    const cards = unwrapArray(normalized.cards)
      ?? unwrapArray(normalized.items)
      ?? unwrapArray(normalized.flashcards)
      ?? unwrapArray(normalized.card_list);
    if (cards) normalized.cards = cards.map((card) => normalizeCardCandidate(card));
    return normalized;
  }

  const card = normalizeCardCandidate({
    ...normalized,
    type: toolName === "create_cloze_card" ? "cloze" : "qa",
  });
  if (toolName === "create_cloze_card") {
    const text = firstString(card.text, card.question);
    if (text) normalized.text = text;
    return normalized;
  }
  const question = firstString(card.question);
  const answer = firstString(card.answer);
  if (question) normalized.question = question;
  if (answer) normalized.answer = answer;
  return normalized;
}

export function isUsableCardToolCall(
  call: { name: string; parameters: Record<string, unknown> },
): boolean {
  if (!CARD_TOOL_NAMES.has(call.name)) return false;
  const parameters = normalizeCardToolParameters(call.name, call.parameters);
  if (call.name === "batch_create_cards") {
    return Array.isArray(parameters.cards) && parameters.cards.some((card) => isUsableCardCandidate(card));
  }
  if (call.name === "create_cloze_card") {
    return Boolean(firstString(parameters.text));
  }
  return Boolean(firstString(parameters.question) && firstString(parameters.answer));
}
