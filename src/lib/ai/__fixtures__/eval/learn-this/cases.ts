/**
 * Evaluation fixtures for the "Learn this" task (design D29, task 2.8).
 *
 * Labeled cases per knowledge type plus two adversarial cases. Each fixture
 * replays a deterministic canned structured output through the REAL
 * `runTask` + validation pipeline via `FakeAIProvider` — tests assert
 * structural semantics (knowledge-type classification, card-type mapping,
 * caps, grounding verdicts), never exact prose.
 *
 * Grounded fixtures keep answers keyword-overlapping the passage so
 * `checkAnswerGrounding` passes (≥ 0.7 keyword ratio); the adversarial
 * ungrounded fixture deliberately does not.
 */

import type { KnowledgeType, LearningCardType } from "../../../schemas/learningMaterial";

export interface LearnThisEvalCase {
  label: string;
  expectedKnowledgeType: KnowledgeType;
  /** Card types the proposal is expected to carry (structural assertion). */
  expectedCardTypes: LearningCardType[];
  /** The source passage (selection). */
  passage: string;
  /** Raw model output, as a strict-JSON text response. */
  responseText: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Grounded cases
// ──────────────────────────────────────────────────────────────────────────

const DEFINITION_PASSAGE =
  "Osmosis is the diffusion of water across a semipermeable membrane from a region of lower solute concentration to a region of higher solute concentration, until equilibrium is reached. Unlike active transport, osmosis requires no cellular energy input.";

const ENUMERATION_PASSAGE =
  "The three primary states of matter are solid, liquid, and gas. In a solid, particles vibrate in fixed positions within a crystal lattice. In a liquid, particles slide past one another while remaining in close contact. In a gas, particles move freely and independently, filling the available volume.";

const PROCESS_PASSAGE =
  "Photosynthesis occurs in two stages. First, in the light-dependent reactions, chlorophyll in the thylakoid membranes absorbs sunlight and splits water molecules, releasing oxygen and producing ATP and NADPH. Second, in the Calvin cycle, the enzymes in the stroma use ATP and NADPH to fix carbon dioxide into glucose.";

const COMPARISON_PASSAGE =
  "Mitosis and meiosis differ in outcome and purpose. Mitosis produces two genetically identical diploid cells and serves growth and tissue repair. Meiosis produces four genetically distinct haploid gametes and serves sexual reproduction. Mitosis involves one division; meiosis involves two successive divisions.";

const FORMULA_PASSAGE =
  "Ohm's law states that the current through a conductor between two points is directly proportional to the voltage across the two points, expressed as V = IR, where V is voltage in volts, I is current in amperes, and R is resistance in ohms. Resistance limits the flow of current in the circuit.";

const CAUSE_EFFECT_PASSAGE =
  "Plate tectonics causes earthquakes when two plates suddenly slip along a fault boundary, releasing accumulated stress as seismic waves. The shaking occurs because stored elastic energy in the rocks transforms into wave energy that propagates through the crust, which is why damage concentrates near the epicenter.";

const DATE_EVENT_PASSAGE =
  "The Berlin Wall fell on November 9, 1989, after the East German government announced that border crossings would open. The wall had stood since August 13, 1961, dividing the city for twenty-eight years. Its fall led to German reunification on October 3, 1990.";

export const LEARN_THIS_EVAL_CASES: LearnThisEvalCase[] = [
  {
    label: "definition-passage",
    expectedKnowledgeType: "definition",
    expectedCardTypes: ["definition", "qa"],
    passage: DEFINITION_PASSAGE,
    responseText: JSON.stringify({
      importance: 0.9,
      knowledgeType: "definition",
      concepts: ["osmosis", "diffusion", "semipermeable membrane"],
      suggestedCards: [
        {
          cardType: "definition",
          concept: "osmosis",
          conceptKeys: ["osmosis"],
          question: "Define osmosis.",
          answer:
            "Osmosis is the diffusion of water across a semipermeable membrane from lower to higher solute concentration.",
          evidenceQuote: "Osmosis is the diffusion of water across a semipermeable membrane",
        },
        {
          cardType: "qa",
          concept: "osmosis",
          conceptKeys: ["osmosis", "active transport"],
          question: "How does osmosis differ from active transport?",
          answer: "Osmosis requires no cellular energy input, unlike active transport.",
        },
      ],
      prerequisites: ["diffusion"],
      tags: ["biology", "membranes"],
      rationale: "A core definition that later transport mechanisms build on.",
    }),
  },
  {
    label: "enumeration-passage",
    expectedKnowledgeType: "enumeration",
    expectedCardTypes: ["cloze", "enumeration"],
    passage: ENUMERATION_PASSAGE,
    responseText: JSON.stringify({
      importance: 0.8,
      knowledgeType: "enumeration",
      concepts: ["states of matter", "solid", "liquid", "gas"],
      suggestedCards: [
        {
          cardType: "cloze",
          concept: "states of matter",
          conceptKeys: ["states of matter"],
          question: "The three primary states of matter are {{c1::solid}}, {{c2::liquid}}, and {{c3::gas}}.",
          answer: "solid, liquid, and gas",
          clozeText:
            "The three primary states of matter are {{c1::solid}}, {{c2::liquid}}, and {{c3::gas}}.",
        },
        {
          cardType: "enumeration",
          concept: "states of matter",
          conceptKeys: ["states of matter", "gas"],
          question: "List the three primary states of matter.",
          answer: "Solid, liquid, and gas.",
        },
      ],
      prerequisites: [],
      tags: ["physics", "matter"],
      rationale: "The enumeration of states is the passage's organizing fact.",
    }),
  },
  {
    label: "process-passage",
    expectedKnowledgeType: "process",
    expectedCardTypes: ["process"],
    passage: PROCESS_PASSAGE,
    responseText: JSON.stringify({
      importance: 0.95,
      knowledgeType: "process",
      concepts: ["photosynthesis", "light-dependent reactions", "Calvin cycle"],
      suggestedCards: [
        {
          cardType: "process",
          concept: "photosynthesis stages",
          conceptKeys: ["photosynthesis", "stages"],
          question: "In what order do the two stages of photosynthesis occur?",
          answer:
            "First the light-dependent reactions split water and produce ATP and NADPH, then the Calvin cycle fixes carbon dioxide into glucose.",
        },
        {
          cardType: "process",
          concept: "light-dependent reactions",
          conceptKeys: ["light-dependent reactions", "thylakoid"],
          question: "What happens during the light-dependent reactions?",
          answer:
            "Chlorophyll in the thylakoid membranes absorbs sunlight, splits water molecules, and produces ATP and NADPH.",
        },
      ],
      prerequisites: ["chlorophyll"],
      tags: ["biology", "photosynthesis"],
      rationale: "The passage describes an ordered two-stage process.",
    }),
  },
  {
    label: "comparison-passage",
    expectedKnowledgeType: "comparison",
    expectedCardTypes: ["comparison"],
    passage: COMPARISON_PASSAGE,
    responseText: JSON.stringify({
      importance: 0.85,
      knowledgeType: "comparison",
      concepts: ["mitosis", "meiosis"],
      suggestedCards: [
        {
          cardType: "comparison",
          concept: "mitosis vs meiosis",
          conceptKeys: ["mitosis", "meiosis"],
          question: "Compare the outcomes of mitosis and meiosis.",
          answer:
            "Mitosis produces two identical diploid cells; meiosis produces four distinct haploid gametes.",
        },
        {
          cardType: "comparison",
          concept: "division count",
          conceptKeys: ["mitosis", "meiosis", "division"],
          question: "Mitosis vs meiosis: how many divisions does each involve?",
          answer: "Mitosis involves one division; meiosis involves two successive divisions.",
        },
      ],
      prerequisites: ["diploid", "haploid"],
      tags: ["biology", "cell division"],
      rationale: "The passage is organized as a direct contrast between two processes.",
    }),
  },
  {
    label: "formula-passage",
    expectedKnowledgeType: "formula",
    expectedCardTypes: ["formula"],
    passage: FORMULA_PASSAGE,
    responseText: JSON.stringify({
      importance: 0.9,
      knowledgeType: "formula",
      concepts: ["Ohm's law", "voltage", "current", "resistance"],
      suggestedCards: [
        {
          cardType: "formula",
          concept: "Ohm's law",
          conceptKeys: ["ohms law", "voltage", "current", "resistance"],
          question: "State Ohm's law and name each quantity.",
          answer: "V = IR, where V is voltage, I is current, and R is resistance.",
        },
        {
          cardType: "formula",
          concept: "resistance",
          conceptKeys: ["resistance", "current"],
          question: "What does resistance do in a circuit?",
          answer: "Resistance limits the flow of current in the circuit.",
        },
      ],
      prerequisites: ["voltage", "electric current"],
      tags: ["physics", "electricity"],
      rationale: "A definitional formula with its variable meanings.",
    }),
  },
  {
    label: "causeEffect-passage",
    expectedKnowledgeType: "causeEffect",
    expectedCardTypes: ["causeEffect"],
    passage: CAUSE_EFFECT_PASSAGE,
    responseText: JSON.stringify({
      importance: 0.85,
      knowledgeType: "causeEffect",
      concepts: ["plate tectonics", "earthquakes", "seismic waves"],
      suggestedCards: [
        {
          cardType: "causeEffect",
          concept: "earthquake cause",
          conceptKeys: ["earthquakes", "plates", "fault"],
          question: "Why do plate tectonics cause earthquakes?",
          answer:
            "Two plates suddenly slip along a fault boundary, releasing accumulated stress as seismic waves.",
        },
        {
          cardType: "causeEffect",
          concept: "epicenter damage",
          conceptKeys: ["epicenter", "damage", "wave energy"],
          question: "Why does damage concentrate near the epicenter?",
          answer:
            "Stored elastic energy transforms into wave energy propagating through the crust near the epicenter.",
        },
      ],
      prerequisites: ["plate boundaries"],
      tags: ["geology", "earthquakes"],
      rationale: "The passage explains a causal mechanism and its observable effect.",
    }),
  },
  {
    label: "dateEvent-passage",
    expectedKnowledgeType: "dateEvent",
    expectedCardTypes: ["qa"],
    passage: DATE_EVENT_PASSAGE,
    responseText: JSON.stringify({
      importance: 0.7,
      knowledgeType: "dateEvent",
      concepts: ["Berlin Wall", "German reunification"],
      suggestedCards: [
        {
          cardType: "qa",
          concept: "Berlin Wall fall",
          conceptKeys: ["berlin wall", "fall"],
          question: "When did the Berlin Wall fall?",
          answer: "The Berlin Wall fell on November 9, 1989.",
        },
        {
          cardType: "qa",
          concept: "German reunification",
          conceptKeys: ["german reunification"],
          question: "When did German reunification take place?",
          answer: "German reunification on October 3, 1990.",
        },
      ],
      prerequisites: [],
      tags: ["history", "cold war"],
      rationale: "Key dates tied to events in modern European history.",
    }),
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Adversarial cases
// ──────────────────────────────────────────────────────────────────────────

/** 10 cards where the first three share one concept — caps must keep ≤ 8 total and ≤ 2/concept. */
export const ADVERSARIAL_OVER_CAP_CASE: LearnThisEvalCase = {
  label: "adversarial-over-cap",
  expectedKnowledgeType: "enumeration",
  expectedCardTypes: ["enumeration", "cloze"],
  passage: ENUMERATION_PASSAGE,
  responseText: JSON.stringify({
    importance: 0.8,
    knowledgeType: "enumeration",
    concepts: ["states of matter"],
    suggestedCards: Array.from({ length: 10 }, (_, i) => {
      // Cards 0-2 share a concept so the ≤2-per-concept cap also fires.
      const concept = i < 3 ? "states of matter" : `matter property ${i}`;
      const isCloze = i % 2 === 1;
      if (isCloze) {
        return {
          cardType: "cloze",
          concept,
          conceptKeys: ["states of matter"],
          question: `In a gas, particles {{c1::move freely}} and fill the available volume. (variant ${i})`,
          answer: "move freely",
          clozeText: `In a gas, particles {{c1::move freely}} and fill the available volume. (variant ${i})`,
        };
      }
      return {
        cardType: "enumeration",
        concept,
        conceptKeys: ["states of matter"],
        question: `List the states of matter mentioned (${i}).`,
        answer: "Solid, liquid, and gas.",
      };
    }),
    prerequisites: [],
    tags: ["physics"],
    rationale: "Deliberately exceeds the caps to exercise cap enforcement.",
  }),
};

/** Answers fabricated outside the passage — the pipeline must flag ungrounded. */
export const ADVERSARIAL_UNGROUNDED_CASE: LearnThisEvalCase = {
  label: "adversarial-ungrounded",
  expectedKnowledgeType: "definition",
  // Only the strict-JSON repair loop would reject this shape; the two-stage
  // task validation accepts the well-formed envelope and the pipeline flags.
  expectedCardTypes: ["definition"],
  passage: DEFINITION_PASSAGE,
  responseText: JSON.stringify({
    importance: 0.9,
    knowledgeType: "definition",
    concepts: ["osmosis"],
    suggestedCards: [
      {
        cardType: "definition",
        concept: "osmosis",
        conceptKeys: ["osmosis"],
        question: "Define osmosis.",
        // Fabricated: none of these keywords appear in the passage.
        answer: "Osmosis is the quantum tunneling of hydrogen bonds across a metallic lattice.",
        evidenceQuote: "quantum tunneling of hydrogen bonds",
      },
      {
        cardType: "cloze",
        concept: "cloze not in source",
        conceptKeys: ["osmosis"],
        // Deletion "phagocytosis" never appears in the passage.
        question: "Osmosis is a form of {{c1::phagocytosis}} in plant cells.",
        answer: "phagocytosis",
        clozeText: "Osmosis is a form of {{c1::phagocytosis}} in plant cells.",
      },
    ],
    prerequisites: [],
    tags: ["biology"],
    rationale: "Adversarial fabricated answers.",
  }),
};

export const ALL_LEARN_THIS_EVAL_CASES: LearnThisEvalCase[] = [
  ...LEARN_THIS_EVAL_CASES,
  ADVERSARIAL_OVER_CAP_CASE,
  ADVERSARIAL_UNGROUNDED_CASE,
];
