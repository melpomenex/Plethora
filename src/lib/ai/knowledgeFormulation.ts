/**
 * Dr. Piotr Wozniak's 20 Rules of Knowledge Formulation Engine
 *
 * Provides shared definitions, metadata, educational reminders, prompt builders,
 * and command parsing for generating atomic, high-retention flashcards adhering to
 * SuperMemo / incremental reading cognitive formulation principles.
 * Reference: https://supermemo.guru/wiki/20_rules_of_knowledge_formulation
 */

export interface KnowledgeRule {
  id: number;
  title: string;
  summary: string;
  detail: string;
}

export const TWENTY_RULES_OF_KNOWLEDGE_FORMULATION: KnowledgeRule[] = [
  {
    id: 1,
    title: "Do not learn if you do not understand",
    summary: "Comprehension must precede memorization. Never memorize incomprehensible text.",
    detail: "Trying to memorize without understanding is a waste of time. Build comprehension first before creating review items.",
  },
  {
    id: 2,
    title: "Learn before you memorize",
    summary: "Build an overall big-picture model before memorizing individual facts.",
    detail: "Individual facts stick best when they attach to a coherent conceptual structure.",
  },
  {
    id: 3,
    title: "Build upon the basics",
    summary: "Master foundational concepts first; never skip elementary fundamentals.",
    detail: "Lapses on basic facts disrupt higher-order reasoning. Simple foundational models are easy to retain.",
  },
  {
    id: 4,
    title: "Stick to the Minimum Information Principle",
    summary: "Items must be atomic. Questions and answers should be as brief and simple as possible.",
    detail: "Simple items activate a single clean neural trace. Complex items cause context interference and high lapse rates.",
  },
  {
    id: 5,
    title: "Cloze deletion is easy and effective",
    summary: "Use cloze deletions (fill-in-the-blank) with clear context anchors for fast, powerful retention.",
    detail: "Cloze deletions preserve the original sentence context and act as effective mnemonic anchors.",
  },
  {
    id: 6,
    title: "Use imagery",
    summary: "Leverage visual memory whenever possible; a picture is worth a thousand words.",
    detail: "Visual encoding creates durable memory traces and significantly accelerates recall.",
  },
  {
    id: 7,
    title: "Use mnemonic techniques",
    summary: "Employ peg lists, vivid acronyms, and associative memory techniques for arbitrary facts.",
    detail: "Mnemonic associations bridge arbitrary data to existing strong memories.",
  },
  {
    id: 8,
    title: "Graphic deletion is as good as cloze deletion",
    summary: "Occlude parts of diagrams, flowcharts, or maps for visual recall.",
    detail: "Image occlusion tests spatial and structural memory with high precision.",
  },
  {
    id: 9,
    title: "Avoid sets",
    summary: "Never test unordered lists or collections in a single card. Break them into binary items.",
    detail: "Recalling sets in bulk has high failure rates. Formulate individual relationship questions instead.",
  },
  {
    id: 10,
    title: "Avoid enumerations",
    summary: "Break ordered sequences into overlapping 2-element pairs or cloze chain steps.",
    detail: "Convert steps 1, 2, 3 into: Step 1 leads to [Step 2], and Step 2 is followed by [Step 3].",
  },
  {
    id: 11,
    title: "Combat interference",
    summary: "Clearly distinguish confusable concepts and subtle differences with distinct cues.",
    detail: "Similar memories interfere with each other. Highlight contrasting attributes to differentiate them.",
  },
  {
    id: 12,
    title: "Optimize wording",
    summary: "Trim unnecessary words. Maximize semantic density and cue clarity.",
    detail: "Short, crisp phrasing reduces reading time during repetitions and sharpens recall.",
  },
  {
    id: 13,
    title: "Refer to other memories",
    summary: "Anchor new cards to already well-established concepts and prior knowledge.",
    detail: "Connecting new items to existing mental models strengthens associative networks.",
  },
  {
    id: 14,
    title: "Personalize and provide examples",
    summary: "Relate concepts to personal experiences, real-world examples, and concrete scenarios.",
    detail: "Personalized examples ground abstract theory in meaningful episodic memory.",
  },
  {
    id: 15,
    title: "Rely on emotional states",
    summary: "Use vivid, dramatic, funny, or striking phrasing to make items memorable.",
    detail: "Emotionally resonant items stand out and resist decay over long repetition intervals.",
  },
  {
    id: 16,
    title: "Context cues simplify wording",
    summary: "Use concise category or subject tags instead of lengthy question preambles.",
    detail: "Context labels (e.g. [Cardiology], [French Syntax]) set the domain immediately.",
  },
  {
    id: 17,
    title: "Redundancy does not contradict Minimum Information Principle",
    summary: "Formulate key concepts from multiple angles (active + passive, definition + application).",
    detail: "Knowledge Darwinism: multiple distinct formulations build a resilient concept network.",
  },
  {
    id: 18,
    title: "Provide sources and references",
    summary: "Attach citations, document titles, or author references for traceability.",
    detail: "References allow you to verify facts and refresh context when questions become ambiguous.",
  },
  {
    id: 19,
    title: "Provide date stamping",
    summary: "Include time/date anchors for facts that may evolve or change over time.",
    detail: "Time stamping prevents obsolete knowledge from remaining unquestioned in your collection.",
  },
  {
    id: 20,
    title: "Prioritize (High Applicability)",
    summary: "Focus on abstract rules, mechanisms, and high-utility concepts over isolated trivia.",
    detail: "Abstract rules (e.g. 2+2=4) apply across endless scenarios and yield higher cognitive leverage.",
  },
];

export const TWENTY_RULES_COMMAND = "/20rules";
export const TWENTY_RULES_ALIASES = ["/20rules", "/formulate", "/twenty-rules", "/rules"] as const;

export const TWENTY_RULES_PROMPT_TEMPLATE =
  "Apply Dr. Piotr Wozniak's 20 Rules of Knowledge Formulation to extract atomic, high-retention flashcards from this content. Focus on the Minimum Information Principle (atomic items, shortest possible answers), cloze deletions for terminology, rule-based abstract principles over isolated facts, and zero complex lists or enumerations.";

export interface TwentyRulesCommandMatch {
  isMatch: boolean;
  matchedCommand?: string;
  query: string;
}

/**
 * Check whether a user input text starts with a 20-rules command or alias.
 */
export function matchTwentyRulesCommand(rawInput: string): TwentyRulesCommandMatch {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { isMatch: false, query: "" };
  }

  for (const alias of TWENTY_RULES_ALIASES) {
    if (trimmed.toLowerCase() === alias) {
      return { isMatch: true, matchedCommand: alias, query: "" };
    }
    if (trimmed.toLowerCase().startsWith(`${alias} `)) {
      const query = trimmed.slice(alias.length).trim();
      return { isMatch: true, matchedCommand: alias, query };
    }
  }

  return { isMatch: false, query: trimmed };
}

/**
 * Check if text contains or matches the 20 rules command.
 */
export function isTwentyRulesCommand(rawInput: string): boolean {
  return matchTwentyRulesCommand(rawInput).isMatch;
}

/**
 * Strip the command prefix from the input.
 */
export function stripTwentyRulesCommand(rawInput: string): string {
  const match = matchTwentyRulesCommand(rawInput);
  return match.isMatch ? match.query : rawInput.trim();
}

/**
 * Generate formatted LLM system prompt instructions enforcing the 20 Rules of Knowledge Formulation.
 */
export function buildTwentyRulesSystemPrompt(customContext?: string): string {
  return `You are an expert cognitive learning assistant applying Dr. Piotr Wozniak's 20 Rules of Knowledge Formulation (SuperMemo / Incremental Reading).

CRITICAL KNOWLEDGE FORMULATION MANDATES:
1. MINIMUM INFORMATION PRINCIPLE (Atomic Cards): Every flashcard MUST test exactly ONE atomic fact or concept. Keep questions concise and answers as short as humanly possible (1-5 words or a single key phrase).
2. NO ENUMERATIONS OR COMPLEX LISTS: NEVER ask "What are the 5 stages of X?" or produce bulleted lists as answers. Split multi-item concepts into individual binary associations or chained cloze pairs (e.g. Stage 1 triggers {{Stage 2}}).
3. CLOZE DELETIONS AS MNEMONIC ANCHORS: Use cloze deletions ({{term}}) for key definitions, equations, and terminology with sufficient sentence context to make the answer inferable.
4. HIGH APPLICABILITY & ABSTRACT RULES: Prioritize fundamental rules, mechanisms ("why" and "how"), and causal connections over isolated trivia.
5. COMBAT INTERFERENCE: If concepts are easily confused, provide explicit distinguishing context cues (e.g., "[Physics: Optics]" or "[Thermodynamics]").
6. REDUNDANCY FROM MULTIPLE ANGLES: For core ideas, create complementary cards from both active and passive perspectives (e.g., Concept -> Mechanism AND Scenario -> Concept).
7. PLEASURE OF LEARNING: Ensure items are clean, unambiguous, and enjoyable to review without cognitive friction.

OUTPUT FORMAT:
When generating flashcards, you MUST output standard executable tool calls (create_qa_card or create_cloze_card) to save them to the database.${
    customContext ? `\n\n${customContext}` : ""
  }`;
}

/**
 * Educational summary of the 20 Rules in Markdown for dialogs, help screens, and tooltips.
 */
export function getTwentyRulesReminderMarkdown(): string {
  return `### 🧠 20 Rules of Knowledge Formulation (Dr. Piotr Wozniak)

Formulating knowledge properly makes learning 10× faster and prevents memory decay:

1. **Understand First**: Never memorize what you do not comprehend.
2. **Big Picture First**: Learn the overall structure before isolated facts.
3. **Build Upon Basics**: Solid fundamentals prevent memory lapses.
4. **Minimum Information Principle**: Cards must be **atomic**; keep answers as short as possible.
5. **Cloze Deletion**: Fast, contextual fill-in-the-blank with clear mnemonic anchors.
6. **Use Imagery**: Leverage visual encoding whenever possible.
7. **Use Mnemonics**: Associate arbitrary facts with vivid mental anchors.
8. **Graphic Deletion**: Occlude diagrams and maps to test visual structures.
9. **Avoid Sets**: Never test unordered lists; break into binary relationships.
10. **Avoid Enumerations**: Split ordered sequences into overlapping 2-step clozes.
11. **Combat Interference**: Disambiguate similar terms with clear context tags.
12. **Optimize Wording**: Trim verbose filler; maximize semantic density.
13. **Refer to Prior Knowledge**: Anchor new cards to known concepts.
14. **Personalize & Examples**: Use concrete real-world use cases.
15. **Vivid & Emotional**: Memorable, striking phrasing sticks longer.
16. **Context Cues**: Use domain tags (e.g. \`[Cardiology]\`) to simplify questions.
17. **Redundancy (Knowledge Darwinism)**: Ask from multiple complementary angles.
18. **Provide Sources**: Keep citations and references for traceability.
19. **Date Stamping**: Anchor time-sensitive facts with dates.
20. **High Applicability**: Focus on rules and reasoning over raw trivia.`;
}
