import type { BoundedLearnerContextPacket } from "../../../study-plans/studyMode/learnerContext";
import type { StudyModeKnowledgeAuthority } from "../../../../types/studyMode";
import { UNTRUSTED_CONTAINMENT_CLAUSE, wrapUntrustedBlock } from "../containment";
import { registerTasks } from "../registry";
import type { AISchemaDescriptor, AITaskDefinition } from "../types";

export interface StudyModeBaseInput {
  sourceId: string;
  sourceTitle: string;
  passageText: string;
  knowledgeAuthority: StudyModeKnowledgeAuthority;
  learnerContext?: BoundedLearnerContextPacket;
}

export interface StudyModeComponentInput extends StudyModeBaseInput {
  componentType:
    | "explanation"
    | "worked_example"
    | "misconceptions"
    | "memory_aid"
    | "summary"
    | "prerequisite";
  objectiveText?: string;
  styleAdjustment?: string;
}

export interface StudyModeComponentOutput {
  title: string;
  componentType: string;
  body: string;
  keyTakeaways: string[];
  citations: Array<{ sourceId: string; quote: string }>;
  isIllustrativeAnalogy?: boolean;
}

const COMPONENT_SCHEMA: AISchemaDescriptor = {
  name: "StudyModeComponentOutput",
  nativeName: "study_mode_component_output",
  json: '{"title":"string","componentType":"string","body":"string","keyTakeaways":["string"],"citations":[{"sourceId":"string","quote":"string"}],"isIllustrativeAnalogy":false}',
};

const MIND_MAP_SCHEMA: AISchemaDescriptor = {
  name: "StudyModeMindMapOutput",
  nativeName: "study_mode_mind_map_output",
  json: '{"title":"string","nodes":[{"id":"string","label":"string","definition":"string","citations":[{"sourceId":"string","quote":"string"}]}],"edges":[{"from":"string","to":"string","relation":"prerequisite|part_of|example_of|contrasts_with|supports|causes|leads_to"}]}',
};

const TIMELINE_SCHEMA: AISchemaDescriptor = {
  name: "StudyModeTimelineOutput",
  nativeName: "study_mode_timeline_output",
  json: '{"title":"string","events":[{"id":"string","order":1,"label":"string","dateOrStage":"string","description":"string","citations":[{"sourceId":"string","quote":"string"}]}]}',
};

const AUDIO_SCRIPT_SCHEMA: AISchemaDescriptor = {
  name: "StudyModeAudioScriptOutput",
  nativeName: "study_mode_audio_script_output",
  json: '{"title":"string","mode":"single_speaker|teacher_student","turns":[{"speaker":"teacher|student","text":"string","misconceptionCorrected":false}],"citations":[{"sourceId":"string","quote":"string"}]}',
};

const SLIDES_SCHEMA: AISchemaDescriptor = {
  name: "StudyModeSlidesOutput",
  nativeName: "study_mode_slides_output",
  json: '{"title":"string","slides":[{"title":"string","objective":"string","bullets":["string"],"narration":"string","citations":[{"sourceId":"string","quote":"string"}]}]}',
};

const FORMATIVE_QA_SCHEMA: AISchemaDescriptor = {
  name: "StudyModeFormativeQuestionOutput",
  nativeName: "study_mode_formative_question_output",
  json: '{"questionKind":"multiple_choice|free_recall|short_answer|fill_blank|ordering|scenario_error","prompt":"string","hint":"string","options":["string"],"correctIndex":0,"distractorMisconceptions":{"1":"string"},"expectedBlanks":["string"],"orderingItems":["string"],"correctOrder":["string"],"scenarioText":"string","explanation":"string","requiredKeyFacts":["string"],"citations":[{"sourceId":"string","quote":"string"}]}',
};

const PEDAGOGICAL_EVAL_SCHEMA: AISchemaDescriptor = {
  name: "StudyModePedagogicalEvalOutput",
  nativeName: "study_mode_pedagogical_eval_output",
  json: '{"criteria":[{"criterion":"accuracy|source_fidelity|coverage|emphasis|engagement|cognitive_load|active_learning|metacognition|motivation_curiosity|adaptability|clarity_of_intentions","rating":"pass|partial|fail|not_assessable","rationale":"string"}]}',
};

function formatContextHeader(input: StudyModeBaseInput): string {
  const ctx = input.learnerContext;
  const ctxLine = ctx
    ? `Learner preferences: level=${ctx.knowledgeLevel ?? "unspecified"}, detail=${ctx.explanationDetail}, vocab=${ctx.vocabularyTolerance}, approach=${ctx.teachingApproach}, interests=${ctx.interests.join(", ") || "none"}.`
    : "Learner preferences: default balanced explanation.";

  return [
    `Knowledge authority: ${input.knowledgeAuthority}.`,
    ctxLine,
    `Authorized sourceId: ${input.sourceId}`,
    "Source Title:",
    wrapUntrustedBlock("source-title", input.sourceTitle),
    "Source Passage:",
    wrapUntrustedBlock("source-passage", input.passageText.slice(0, 6000)),
  ].join("\n");
}

function validateNonEmptyObject(raw: unknown): raw is Record<string, unknown> {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw));
}

export const studyModeComponentTask: AITaskDefinition<
  StudyModeComponentInput,
  StudyModeComponentOutput
> = {
  id: "study-mode-generate-component",
  taskType: "prompt",
  modelClass: "full",
  outputKind: "structured",
  schema: COMPONENT_SCHEMA,
  systemInstruction: [
    UNTRUSTED_CONTAINMENT_CLAUSE,
    "Generate a concise, source-grounded educational supplement for Plethora Study Mode.",
    "Preserve technical definitions, equations, and qualifications.",
    "Every citation quote MUST be an exact substring from the untrusted source passage.",
  ].join("\n"),
  maxOutputTokens: 2048,
  timeoutMs: 120_000,
  streaming: false,
  buildInput: (input) => ({
    text: [
      formatContextHeader(input),
      `Requested componentType: ${input.componentType}`,
      input.objectiveText ? `Learning objective: ${input.objectiveText}` : "",
      input.styleAdjustment ? `Inline style adjustment: ${input.styleAdjustment}` : "",
      `Respond ONLY with JSON matching: ${COMPONENT_SCHEMA.json}`,
    ]
      .filter(Boolean)
      .join("\n"),
  }),
  validate: (raw) => {
    if (!validateNonEmptyObject(raw)) {
      return { ok: false, errors: ["Expected JSON object"] };
    }
    if (typeof raw.title !== "string" || typeof raw.body !== "string") {
      return { ok: false, errors: ["Missing title or body"] };
    }
    return { ok: true, value: raw as unknown as StudyModeComponentOutput };
  },
};

export const studyModeMindMapTask: AITaskDefinition<
  StudyModeBaseInput,
  Record<string, unknown>
> = {
  id: "study-mode-mind-map",
  taskType: "prompt",
  modelClass: "full",
  outputKind: "structured",
  schema: MIND_MAP_SCHEMA,
  systemInstruction: [
    UNTRUSTED_CONTAINMENT_CLAUSE,
    "Generate a bounded, source-grounded educational mind map with typed pedagogical relationships.",
    "Do not invent relationships unsupported by the source.",
  ].join("\n"),
  maxOutputTokens: 2048,
  timeoutMs: 120_000,
  streaming: false,
  buildInput: (input) => ({
    text: `${formatContextHeader(input)}\nRespond ONLY with JSON matching: ${MIND_MAP_SCHEMA.json}`,
  }),
  validate: (raw) =>
    validateNonEmptyObject(raw) && Array.isArray(raw.nodes) && Array.isArray(raw.edges)
      ? { ok: true, value: raw }
      : { ok: false, errors: ["Mind map requires nodes and edges arrays"] },
};

export const studyModeTimelineTask: AITaskDefinition<
  StudyModeBaseInput,
  Record<string, unknown>
> = {
  id: "study-mode-timeline",
  taskType: "prompt",
  modelClass: "full",
  outputKind: "structured",
  schema: TIMELINE_SCHEMA,
  systemInstruction: [
    UNTRUSTED_CONTAINMENT_CLAUSE,
    "Extract a chronological or causal sequence strictly from the source passage.",
    "Never fabricate dates or causal links.",
  ].join("\n"),
  maxOutputTokens: 2048,
  timeoutMs: 120_000,
  streaming: false,
  buildInput: (input) => ({
    text: `${formatContextHeader(input)}\nRespond ONLY with JSON matching: ${TIMELINE_SCHEMA.json}`,
  }),
  validate: (raw) =>
    validateNonEmptyObject(raw) && Array.isArray(raw.events)
      ? { ok: true, value: raw }
      : { ok: false, errors: ["Timeline requires events array"] },
};

export const studyModeAudioScriptTask: AITaskDefinition<
  StudyModeBaseInput & { mode: "single_speaker" | "teacher_student" },
  Record<string, unknown>
> = {
  id: "study-mode-audio-script",
  taskType: "prompt",
  modelClass: "full",
  outputKind: "structured",
  schema: AUDIO_SCRIPT_SCHEMA,
  systemInstruction: [
    UNTRUSTED_CONTAINMENT_CLAUSE,
    "Write a source-grounded educational audio lesson script.",
    "If teacher_student mode is used and the student voices a misconception, the teacher MUST explicitly correct it.",
  ].join("\n"),
  maxOutputTokens: 2048,
  timeoutMs: 120_000,
  streaming: false,
  buildInput: (input) => ({
    text: `${formatContextHeader(input)}\nRequested mode: ${input.mode}\nRespond ONLY with JSON matching: ${AUDIO_SCRIPT_SCHEMA.json}`,
  }),
  validate: (raw) =>
    validateNonEmptyObject(raw) && Array.isArray(raw.turns)
      ? { ok: true, value: raw }
      : { ok: false, errors: ["Audio script requires turns array"] },
};

export const studyModeSlidesTask: AITaskDefinition<
  StudyModeBaseInput,
  Record<string, unknown>
> = {
  id: "study-mode-slides",
  taskType: "prompt",
  modelClass: "full",
  outputKind: "structured",
  schema: SLIDES_SCHEMA,
  systemInstruction: [
    UNTRUSTED_CONTAINMENT_CLAUSE,
    "Create a concise narrated slide deck grounded in the source passage.",
    "Narration should complement slide bullets rather than repeating them verbatim.",
  ].join("\n"),
  maxOutputTokens: 2048,
  timeoutMs: 120_000,
  streaming: false,
  buildInput: (input) => ({
    text: `${formatContextHeader(input)}\nRespond ONLY with JSON matching: ${SLIDES_SCHEMA.json}`,
  }),
  validate: (raw) =>
    validateNonEmptyObject(raw) && Array.isArray(raw.slides)
      ? { ok: true, value: raw }
      : { ok: false, errors: ["Slides require slides array"] },
};

export const studyModeFormativeQuestionTask: AITaskDefinition<
  StudyModeBaseInput & {
    questionKind:
      | "multiple_choice"
      | "short_answer"
      | "free_recall"
      | "fill_blank"
      | "ordering"
      | "scenario_error";
    targetDifficulty?: number;
    priorPrompts?: string[];
  },
  Record<string, unknown>
> = {
  id: "study-mode-generate-formative-questions",
  taskType: "prompt",
  modelClass: "full",
  outputKind: "structured",
  schema: FORMATIVE_QA_SCHEMA,
  systemInstruction: [
    UNTRUSTED_CONTAINMENT_CLAUSE,
    "Generate one fair, unambiguous formative question grounded in the source passage.",
    "Include a concise progressive hint that scaffolds without giving away the answer.",
    "For multiple_choice, include distractorMisconceptions explaining why wrong choices are flawed.",
    "For fill_blank, include ___ blanks in prompt and expectedBlanks array.",
    "For ordering, provide 3-5 shuffled orderingItems and their canonical correctOrder.",
    "For scenario_error, provide scenarioText containing a subtle conceptual error and requiredKeyFacts naming the flaw.",
    "Never repeat or paraphrase any listed prior prompts.",
  ].join("\n"),
  maxOutputTokens: 2048,
  timeoutMs: 120_000,
  streaming: false,
  buildInput: (input) => ({
    text: [
      formatContextHeader(input),
      `Question kind: ${input.questionKind}`,
      `Target difficulty (1=foundational .. 5=challenging): ${input.targetDifficulty ?? 2}`,
      input.priorPrompts && input.priorPrompts.length > 0
        ? `Avoid repeating these prior prompts:\n- ${input.priorPrompts.slice(-6).join("\n- ")}`
        : "",
      `Respond ONLY with JSON matching: ${FORMATIVE_QA_SCHEMA.json}`,
    ]
      .filter(Boolean)
      .join("\n"),
  }),
  validate: (raw) =>
    validateNonEmptyObject(raw) && typeof raw.prompt === "string"
      ? { ok: true, value: raw }
      : { ok: false, errors: ["Formative question requires prompt"] },
};

export const studyModePedagogicalEvalTask: AITaskDefinition<
  { sourcePassage: string; generatedArtifactJson: string },
  Record<string, unknown>
> = {
  id: "study-mode-pedagogical-eval",
  taskType: "prompt",
  modelClass: "fast",
  outputKind: "structured",
  schema: PEDAGOGICAL_EVAL_SCHEMA,
  systemInstruction: [
    UNTRUSTED_CONTAINMENT_CLAUSE,
    "Evaluate the educational artifact using the LearnLM Appendix B rubric (pass, partial, fail, not_assessable).",
  ].join("\n"),
  maxOutputTokens: 2048,
  timeoutMs: 120_000,
  streaming: false,
  buildInput: (input) => ({
    text: [
      "Source passage:",
      wrapUntrustedBlock("source-passage", input.sourcePassage.slice(0, 4000)),
      "Generated artifact:",
      wrapUntrustedBlock("generated-artifact", input.generatedArtifactJson.slice(0, 4000)),
      `Respond ONLY with JSON matching: ${PEDAGOGICAL_EVAL_SCHEMA.json}`,
    ].join("\n"),
  }),
  validate: (raw) =>
    validateNonEmptyObject(raw) && Array.isArray(raw.criteria)
      ? { ok: true, value: raw }
      : { ok: false, errors: ["Pedagogical eval requires criteria array"] },
};

registerTasks(
  studyModeComponentTask,
  studyModeMindMapTask,
  studyModeTimelineTask,
  studyModeAudioScriptTask,
  studyModeSlidesTask,
  studyModeFormativeQuestionTask,
  studyModePedagogicalEvalTask
);
