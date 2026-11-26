import type { Morphology } from "../types";
import { normalizeForLookup, tokenKind, wordSegments } from "../unicode";
import {
  baseLanguageCode,
  buildChunkFromAnalysis,
  createCapabilityDeclarations,
  createSimpleAdapter,
  resolvePackEntry,
  segmentSentencesMultilingual,
  throwIfAborted,
  type RawTokenInput,
} from "./shared";

export const ROMANCE_ADAPTER_ID = "local-romance";
const ROMANCE_ADAPTER_VERSION = "1.0.0";

type RomanceLang = "es" | "fr" | "pt" | "it";

interface LexiconCandidate {
  lemma: string;
  pos: string;
  features: Readonly<Record<string, string>>;
  confidence: number;
}

type CandidateTable = Map<string, LexiconCandidate[]>;

function addCandidate(table: CandidateTable, form: string, candidate: LexiconCandidate): void {
  const key = form.normalize("NFC").toLowerCase();
  const existing = table.get(key) ?? [];
  // Never merge distinct homographs with conflicting POS into one entry.
  const duplicate = existing.find(
    (item) => item.lemma === candidate.lemma && item.pos === candidate.pos,
  );
  if (!duplicate) {
    existing.push(candidate);
    table.set(key, existing);
  }
}

function addVerbForms(
  table: CandidateTable,
  lemma: string,
  entries: readonly [string, Record<string, string>][],
  confidence = 0.94,
): void {
  addCandidate(table, lemma, {
    lemma,
    pos: "verb",
    features: { verbForm: "infinitive" },
    confidence,
  });
  for (const [form, features] of entries) {
    addCandidate(table, form, {
      lemma,
      pos: "verb",
      features,
      confidence,
    });
  }
}

function addClosedClass(
  table: CandidateTable,
  pos: string,
  forms: readonly string[],
  features: Record<string, string> = {},
  confidence = 0.94,
): void {
  for (const form of forms) {
    addCandidate(table, form, {
      lemma: form,
      pos,
      features,
      confidence,
    });
  }
}

function addNouns(
  table: CandidateTable,
  pairs: readonly [string, string | null, Record<string, string>?][],
  confidence = 0.94,
): void {
  for (const [singular, plural, extra] of pairs) {
    addCandidate(table, singular, {
      lemma: singular,
      pos: "noun",
      features: { number: "singular", ...(extra ?? {}) },
      confidence,
    });
    if (plural) {
      addCandidate(table, plural, {
        lemma: singular,
        pos: "noun",
        features: { number: "plural", ...(extra ?? {}) },
        confidence,
      });
    }
  }
}

function f(
  tense: string,
  person?: string,
  number?: string,
  mood = "indicative",
): Record<string, string> {
  const out: Record<string, string> = { tense, mood };
  if (person) out.person = person;
  if (number) out.number = number;
  return out;
}

function buildSpanishTable(): CandidateTable {
  const t: CandidateTable = new Map();
  addVerbForms(t, "ser", [
    ["soy", f("present", "1", "singular")],
    ["eres", f("present", "2", "singular")],
    ["es", f("present", "3", "singular")],
    ["somos", f("present", "1", "plural")],
    ["sois", f("present", "2", "plural")],
    ["son", f("present", "3", "plural")],
    ["era", f("imperfect", "1|3", "singular")],
    ["eras", f("imperfect", "2", "singular")],
    ["éramos", f("imperfect", "1", "plural")],
    ["eran", f("imperfect", "3", "plural")],
    ["fui", f("preterite", "1", "singular")],
    ["fuiste", f("preterite", "2", "singular")],
    ["fue", f("preterite", "3", "singular")],
    ["fuimos", f("preterite", "1", "plural")],
    ["fueron", f("preterite", "3", "plural")],
    ["seré", f("future", "1", "singular")],
    ["serás", f("future", "2", "singular")],
    ["será", f("future", "3", "singular")],
    ["seremos", f("future", "1", "plural")],
    ["serán", f("future", "3", "plural")],
    ["sea", f("present", "1|3", "singular", "subjunctive")],
    ["seas", f("present", "2", "singular", "subjunctive")],
    ["seamos", f("present", "1", "plural", "subjunctive")],
    ["sean", f("present", "3", "plural", "subjunctive")],
    ["sido", { verbForm: "participle" }],
    ["siendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "estar", [
    ["estoy", f("present", "1", "singular")],
    ["estás", f("present", "2", "singular")],
    ["está", f("present", "3", "singular")],
    ["estamos", f("present", "1", "plural")],
    ["estáis", f("present", "2", "plural")],
    ["están", f("present", "3", "plural")],
    ["estaba", f("imperfect", "1|3", "singular")],
    ["estaban", f("imperfect", "3", "plural")],
    ["estuve", f("preterite", "1", "singular")],
    ["estuviste", f("preterite", "2", "singular")],
    ["estuvo", f("preterite", "3", "singular")],
    ["estuvimos", f("preterite", "1", "plural")],
    ["estuvieron", f("preterite", "3", "plural")],
    ["estaré", f("future", "1", "singular")],
    ["estará", f("future", "3", "singular")],
    ["esté", f("present", "1|3", "singular", "subjunctive")],
    ["estado", { verbForm: "participle" }],
    ["estando", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "tener", [
    ["tengo", f("present", "1", "singular")],
    ["tienes", f("present", "2", "singular")],
    ["tiene", f("present", "3", "singular")],
    ["tenemos", f("present", "1", "plural")],
    ["tenéis", f("present", "2", "plural")],
    ["tienen", f("present", "3", "plural")],
    ["tenía", f("imperfect", "1|3", "singular")],
    ["tuve", f("preterite", "1", "singular")],
    ["tuviste", f("preterite", "2", "singular")],
    ["tuvo", f("preterite", "3", "singular")],
    ["tuvimos", f("preterite", "1", "plural")],
    ["tuvieron", f("preterite", "3", "plural")],
    ["tendré", f("future", "1", "singular")],
    ["tendrá", f("future", "3", "singular")],
    ["tenga", f("present", "1|3", "singular", "subjunctive")],
    ["tenido", { verbForm: "participle" }],
    ["teniendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "ir", [
    ["voy", f("present", "1", "singular")],
    ["vas", f("present", "2", "singular")],
    ["va", f("present", "3", "singular")],
    ["vamos", f("present", "1", "plural")],
    ["vais", f("present", "2", "plural")],
    ["van", f("present", "3", "plural")],
    ["iba", f("imperfect", "1|3", "singular")],
    ["ibas", f("imperfect", "2", "singular")],
    ["íbamos", f("imperfect", "1", "plural")],
    ["iban", f("imperfect", "3", "plural")],
    ["fui", f("preterite", "1", "singular")],
    ["fuiste", f("preterite", "2", "singular")],
    ["fue", f("preterite", "3", "singular")],
    ["fuimos", f("preterite", "1", "plural")],
    ["fueron", f("preterite", "3", "plural")],
    ["iré", f("future", "1", "singular")],
    ["irá", f("future", "3", "singular")],
    ["vaya", f("present", "1|3", "singular", "subjunctive")],
    ["ido", { verbForm: "participle" }],
    ["yendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "hacer", [
    ["hago", f("present", "1", "singular")],
    ["haces", f("present", "2", "singular")],
    ["hace", f("present", "3", "singular")],
    ["hacemos", f("present", "1", "plural")],
    ["hacen", f("present", "3", "plural")],
    ["hacía", f("imperfect", "1|3", "singular")],
    ["hice", f("preterite", "1", "singular")],
    ["hiciste", f("preterite", "2", "singular")],
    ["hizo", f("preterite", "3", "singular")],
    ["hicimos", f("preterite", "1", "plural")],
    ["hicieron", f("preterite", "3", "plural")],
    ["haré", f("future", "1", "singular")],
    ["hará", f("future", "3", "singular")],
    ["haga", f("present", "1|3", "singular", "subjunctive")],
    ["hecho", { verbForm: "participle" }],
    ["haciendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "poder", [
    ["puedo", f("present", "1", "singular")],
    ["puedes", f("present", "2", "singular")],
    ["puede", f("present", "3", "singular")],
    ["podemos", f("present", "1", "plural")],
    ["pueden", f("present", "3", "plural")],
    ["podía", f("imperfect", "1|3", "singular")],
    ["pude", f("preterite", "1", "singular")],
    ["pudiste", f("preterite", "2", "singular")],
    ["pudo", f("preterite", "3", "singular")],
    ["pudimos", f("preterite", "1", "plural")],
    ["pudieron", f("preterite", "3", "plural")],
    ["podré", f("future", "1", "singular")],
    ["podrá", f("future", "3", "singular")],
    ["pueda", f("present", "1|3", "singular", "subjunctive")],
    ["podido", { verbForm: "participle" }],
    ["pudiendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "haber", [
    ["he", f("present", "1", "singular")],
    ["has", f("present", "2", "singular")],
    ["ha", f("present", "3", "singular")],
    ["hay", f("present", "3", "singular")],
    ["hemos", f("present", "1", "plural")],
    ["han", f("present", "3", "plural")],
    ["había", f("imperfect", "1|3", "singular")],
    ["hube", f("preterite", "1", "singular")],
    ["hubo", f("preterite", "3", "singular")],
    ["habré", f("future", "1", "singular")],
    ["haya", f("present", "1|3", "singular", "subjunctive")],
    ["habido", { verbForm: "participle" }],
    ["habiendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "decir", [
    ["digo", f("present", "1", "singular")],
    ["dices", f("present", "2", "singular")],
    ["dice", f("present", "3", "singular")],
    ["decimos", f("present", "1", "plural")],
    ["dicen", f("present", "3", "plural")],
    ["dije", f("preterite", "1", "singular")],
    ["dijo", f("preterite", "3", "singular")],
    ["dijeron", f("preterite", "3", "plural")],
    ["diré", f("future", "1", "singular")],
    ["diga", f("present", "1|3", "singular", "subjunctive")],
    ["dicho", { verbForm: "participle" }],
    ["diciendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "venir", [
    ["vengo", f("present", "1", "singular")],
    ["vienes", f("present", "2", "singular")],
    ["viene", f("present", "3", "singular")],
    ["venimos", f("present", "1", "plural")],
    ["vienen", f("present", "3", "plural")],
    ["vine", f("preterite", "1", "singular")],
    ["vino", f("preterite", "3", "singular")],
    ["vinieron", f("preterite", "3", "plural")],
    ["vendré", f("future", "1", "singular")],
    ["venga", f("present", "1|3", "singular", "subjunctive")],
    ["venido", { verbForm: "participle" }],
    ["viniendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "ver", [
    ["veo", f("present", "1", "singular")],
    ["ves", f("present", "2", "singular")],
    ["ve", f("present", "3", "singular")],
    ["vemos", f("present", "1", "plural")],
    ["ven", f("present", "3", "plural")],
    ["veía", f("imperfect", "1|3", "singular")],
    ["vi", f("preterite", "1", "singular")],
    ["vio", f("preterite", "3", "singular")],
    ["vieron", f("preterite", "3", "plural")],
    ["veré", f("future", "1", "singular")],
    ["vea", f("present", "1|3", "singular", "subjunctive")],
    ["visto", { verbForm: "participle" }],
    ["viendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "dar", [
    ["doy", f("present", "1", "singular")],
    ["das", f("present", "2", "singular")],
    ["da", f("present", "3", "singular")],
    ["damos", f("present", "1", "plural")],
    ["dan", f("present", "3", "plural")],
    ["di", f("preterite", "1", "singular")],
    ["dio", f("preterite", "3", "singular")],
    ["dieron", f("preterite", "3", "plural")],
    ["daré", f("future", "1", "singular")],
    ["dé", f("present", "1|3", "singular", "subjunctive")],
    ["dado", { verbForm: "participle" }],
    ["dando", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "saber", [
    ["sé", f("present", "1", "singular")],
    ["sabes", f("present", "2", "singular")],
    ["sabe", f("present", "3", "singular")],
    ["sabemos", f("present", "1", "plural")],
    ["saben", f("present", "3", "plural")],
    ["supe", f("preterite", "1", "singular")],
    ["supo", f("preterite", "3", "singular")],
    ["sabré", f("future", "1", "singular")],
    ["sepa", f("present", "1|3", "singular", "subjunctive")],
    ["sabido", { verbForm: "participle" }],
    ["sabiendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "querer", [
    ["quiero", f("present", "1", "singular")],
    ["quieres", f("present", "2", "singular")],
    ["quiere", f("present", "3", "singular")],
    ["queremos", f("present", "1", "plural")],
    ["quieren", f("present", "3", "plural")],
    ["quise", f("preterite", "1", "singular")],
    ["quiso", f("preterite", "3", "singular")],
    ["querré", f("future", "1", "singular")],
    ["quiera", f("present", "1|3", "singular", "subjunctive")],
    ["querido", { verbForm: "participle" }],
    ["queriendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "poner", [
    ["pongo", f("present", "1", "singular")],
    ["pones", f("present", "2", "singular")],
    ["pone", f("present", "3", "singular")],
    ["ponemos", f("present", "1", "plural")],
    ["ponen", f("present", "3", "plural")],
    ["puse", f("preterite", "1", "singular")],
    ["puso", f("preterite", "3", "singular")],
    ["pondré", f("future", "1", "singular")],
    ["ponga", f("present", "1|3", "singular", "subjunctive")],
    ["puesto", { verbForm: "participle" }],
    ["poniendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "hablar", [
    ["hablo", f("present", "1", "singular")],
    ["hablas", f("present", "2", "singular")],
    ["habla", f("present", "3", "singular")],
    ["hablamos", f("present", "1", "plural")],
    ["habláis", f("present", "2", "plural")],
    ["hablan", f("present", "3", "plural")],
    ["hablé", f("preterite", "1", "singular")],
    ["hablaste", f("preterite", "2", "singular")],
    ["habló", f("preterite", "3", "singular")],
    ["hablaron", f("preterite", "3", "plural")],
    ["hablaba", f("imperfect", "1|3", "singular")],
    ["hablaré", f("future", "1", "singular")],
    ["hablarás", f("future", "2", "singular")],
    ["hablará", f("future", "3", "singular")],
    ["hablarán", f("future", "3", "plural")],
    ["hablando", { verbForm: "gerund" }],
    ["hablado", { verbForm: "participle" }],
  ]);
  addVerbForms(t, "comer", [
    ["como", f("present", "1", "singular")],
    ["comes", f("present", "2", "singular")],
    ["come", f("present", "3", "singular")],
    ["comemos", f("present", "1", "plural")],
    ["comen", f("present", "3", "plural")],
    ["comí", f("preterite", "1", "singular")],
    ["comió", f("preterite", "3", "singular")],
    ["comiendo", { verbForm: "gerund" }],
    ["comido", { verbForm: "participle" }],
  ]);
  addVerbForms(t, "librar", [["libro", f("present", "1", "singular")]]);
  addVerbForms(t, "trabajar", [["trabajo", f("present", "1", "singular")]]);
  addVerbForms(t, "parar", [["para", f("present", "3", "singular")]]);
  addVerbForms(t, "sobrar", [["sobre", f("present", "1|3", "singular", "subjunctive")]]);

  addClosedClass(t, "determiner", ["el", "la", "los", "las", "un", "una", "unos", "unas", "este", "esta", "estos", "estas", "ese", "esa", "mi", "tu", "su", "mis", "tus", "sus", "nuestro", "nuestra"]);
  addClosedClass(t, "pronoun", ["yo", "tú", "él", "ella", "usted", "nosotros", "nosotras", "vosotros", "ellos", "ellas", "ustedes", "me", "te", "se", "nos", "lo", "le", "les", "que", "quien"]);
  addClosedClass(t, "preposition", ["de", "en", "a", "con", "por", "para", "sin", "sobre", "entre", "hacia", "desde", "hasta", "bajo", "tras"]);
  addClosedClass(t, "conjunction", ["y", "e", "o", "u", "pero", "sino", "porque", "aunque", "como", "cuando", "si"]);
  addClosedClass(t, "adverb", ["no", "sí", "muy", "más", "menos", "ya", "ahora", "aquí", "allí", "bien", "mal", "siempre", "nunca", "también", "tampoco"]);

  addNouns(t, [
    ["vino", "vinos"],
    ["libro", "libros"],
    ["trabajo", "trabajos"],
    ["casa", "casas"],
    ["sobre", "sobres"],
    ["son", "sones"],
    ["luz", "luces"],
    ["vez", "veces"],
    ["español", "españoles"],
    ["amigo", "amigos"],
    ["amiga", "amigas"],
    ["tiempo", "tiempos"],
    ["día", "días"],
    ["ciudad", "ciudades"],
  ]);
  return t;
}

function buildFrenchTable(): CandidateTable {
  const t: CandidateTable = new Map();
  addVerbForms(t, "être", [
    ["suis", f("present", "1", "singular")],
    ["es", f("present", "2", "singular")],
    ["est", f("present", "3", "singular")],
    ["sommes", f("present", "1", "plural")],
    ["êtes", f("present", "2", "plural")],
    ["sont", f("present", "3", "plural")],
    ["étais", f("imperfect", "1|2", "singular")],
    ["était", f("imperfect", "3", "singular")],
    ["étions", f("imperfect", "1", "plural")],
    ["étaient", f("imperfect", "3", "plural")],
    ["fus", f("preterite", "1|2", "singular")],
    ["fut", f("preterite", "3", "singular")],
    ["serai", f("future", "1", "singular")],
    ["sera", f("future", "3", "singular")],
    ["serons", f("future", "1", "plural")],
    ["seront", f("future", "3", "plural")],
    ["sois", f("present", "1|2", "singular", "subjunctive")],
    ["soit", f("present", "3", "singular", "subjunctive")],
    ["été", { verbForm: "participle" }],
    ["étant", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "avoir", [
    ["ai", f("present", "1", "singular")],
    ["as", f("present", "2", "singular")],
    ["a", f("present", "3", "singular")],
    ["avons", f("present", "1", "plural")],
    ["avez", f("present", "2", "plural")],
    ["ont", f("present", "3", "plural")],
    ["avais", f("imperfect", "1|2", "singular")],
    ["avait", f("imperfect", "3", "singular")],
    ["avions", f("imperfect", "1", "plural")],
    ["avaient", f("imperfect", "3", "plural")],
    ["eus", f("preterite", "1|2", "singular")],
    ["eut", f("preterite", "3", "singular")],
    ["aurai", f("future", "1", "singular")],
    ["aura", f("future", "3", "singular")],
    ["aie", f("present", "1|2", "singular", "subjunctive")],
    ["ait", f("present", "3", "singular", "subjunctive")],
    ["eu", { verbForm: "participle" }],
    ["ayant", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "aller", [
    ["vais", f("present", "1", "singular")],
    ["vas", f("present", "2", "singular")],
    ["va", f("present", "3", "singular")],
    ["allons", f("present", "1", "plural")],
    ["allez", f("present", "2", "plural")],
    ["vont", f("present", "3", "plural")],
    ["allais", f("imperfect", "1|2", "singular")],
    ["allait", f("imperfect", "3", "singular")],
    ["allai", f("preterite", "1", "singular")],
    ["alla", f("preterite", "3", "singular")],
    ["irai", f("future", "1", "singular")],
    ["ira", f("future", "3", "singular")],
    ["aille", f("present", "1|3", "singular", "subjunctive")],
    ["allé", { verbForm: "participle" }],
    ["allant", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "faire", [
    ["fais", f("present", "1|2", "singular")],
    ["fait", f("present", "3", "singular")],
    ["faisons", f("present", "1", "plural")],
    ["faites", f("present", "2", "plural")],
    ["font", f("present", "3", "plural")],
    ["faisais", f("imperfect", "1|2", "singular")],
    ["faisait", f("imperfect", "3", "singular")],
    ["fis", f("preterite", "1|2", "singular")],
    ["fit", f("preterite", "3", "singular")],
    ["ferai", f("future", "1", "singular")],
    ["fera", f("future", "3", "singular")],
    ["fasse", f("present", "1|3", "singular", "subjunctive")],
    ["faisant", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "pouvoir", [
    ["peux", f("present", "1|2", "singular")],
    ["puis", f("present", "1", "singular")],
    ["peut", f("present", "3", "singular")],
    ["pouvons", f("present", "1", "plural")],
    ["pouvez", f("present", "2", "plural")],
    ["peuvent", f("present", "3", "plural")],
    ["pouvais", f("imperfect", "1|2", "singular")],
    ["pouvait", f("imperfect", "3", "singular")],
    ["pus", f("preterite", "1|2", "singular")],
    ["put", f("preterite", "3", "singular")],
    ["pourrai", f("future", "1", "singular")],
    ["pourra", f("future", "3", "singular")],
    ["puisse", f("present", "1|3", "singular", "subjunctive")],
    ["pu", { verbForm: "participle" }],
    ["pouvant", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "vouloir", [
    ["veux", f("present", "1|2", "singular")],
    ["veut", f("present", "3", "singular")],
    ["voulons", f("present", "1", "plural")],
    ["voulez", f("present", "2", "plural")],
    ["veulent", f("present", "3", "plural")],
    ["voulais", f("imperfect", "1|2", "singular")],
    ["voulait", f("imperfect", "3", "singular")],
    ["voulus", f("preterite", "1|2", "singular")],
    ["voulut", f("preterite", "3", "singular")],
    ["voudrai", f("future", "1", "singular")],
    ["voudra", f("future", "3", "singular")],
    ["veuille", f("present", "1|3", "singular", "subjunctive")],
    ["voulu", { verbForm: "participle" }],
    ["voulant", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "suivre", [["suis", f("present", "1|2", "singular")], ["suit", f("present", "3", "singular")], ["suivi", { verbForm: "participle" }]]);
  addVerbForms(t, "livrer", [["livre", f("present", "1|3", "singular")]]);
  addVerbForms(t, "porter", [["porte", f("present", "1|3", "singular")]]);

  addClosedClass(t, "determiner", ["le", "la", "les", "un", "une", "des", "du", "au", "aux", "ce", "cet", "cette", "ces", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses"]);
  addClosedClass(t, "pronoun", ["je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "me", "te", "se", "lui", "leur", "qui", "que", "quoi", "dont"]);
  addClosedClass(t, "preposition", ["de", "à", "en", "dans", "par", "pour", "sans", "sur", "sous", "avec", "entre", "chez", "vers"]);
  addClosedClass(t, "conjunction", ["et", "ou", "mais", "donc", "or", "ni", "car", "comme", "quand", "si", "parce"]);
  addClosedClass(t, "adverb", ["ne", "pas", "plus", "jamais", "toujours", "très", "bien", "mal", "ici", "là", "oui", "non"]);

  addNouns(t, [
    ["livre", "livres"],
    ["porte", "portes"],
    ["est", null],
    ["esprit", "esprits"],
    ["journal", "journaux"],
    ["cheval", "chevaux"],
    ["eau", "eaux"],
    ["bureau", "bureaux"],
    ["maison", "maisons"],
    ["ami", "amis"],
  ]);
  return t;
}

function buildPortugueseTable(): CandidateTable {
  const t: CandidateTable = new Map();
  addVerbForms(t, "ser", [
    ["sou", f("present", "1", "singular")],
    ["és", f("present", "2", "singular")],
    ["é", f("present", "3", "singular")],
    ["somos", f("present", "1", "plural")],
    ["são", f("present", "3", "plural")],
    ["era", f("imperfect", "1|3", "singular")],
    ["eram", f("imperfect", "3", "plural")],
    ["fui", f("preterite", "1", "singular")],
    ["foste", f("preterite", "2", "singular")],
    ["foi", f("preterite", "3", "singular")],
    ["fomos", f("preterite", "1", "plural")],
    ["foram", f("preterite", "3", "plural")],
    ["serei", f("future", "1", "singular")],
    ["será", f("future", "3", "singular")],
    ["seja", f("present", "1|3", "singular", "subjunctive")],
    ["sido", { verbForm: "participle" }],
    ["sendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "estar", [
    ["estou", f("present", "1", "singular")],
    ["estás", f("present", "2", "singular")],
    ["está", f("present", "3", "singular")],
    ["estamos", f("present", "1", "plural")],
    ["estão", f("present", "3", "plural")],
    ["estava", f("imperfect", "1|3", "singular")],
    ["estive", f("preterite", "1", "singular")],
    ["esteve", f("preterite", "3", "singular")],
    ["estiveram", f("preterite", "3", "plural")],
    ["estarei", f("future", "1", "singular")],
    ["esteja", f("present", "1|3", "singular", "subjunctive")],
    ["estado", { verbForm: "participle" }],
    ["estando", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "ter", [
    ["tenho", f("present", "1", "singular")],
    ["tens", f("present", "2", "singular")],
    ["tem", f("present", "3", "singular")],
    ["temos", f("present", "1", "plural")],
    ["têm", f("present", "3", "plural")],
    ["tinha", f("imperfect", "1|3", "singular")],
    ["tive", f("preterite", "1", "singular")],
    ["teve", f("preterite", "3", "singular")],
    ["tiveram", f("preterite", "3", "plural")],
    ["terei", f("future", "1", "singular")],
    ["tenha", f("present", "1|3", "singular", "subjunctive")],
    ["tido", { verbForm: "participle" }],
    ["tendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "ir", [
    ["vou", f("present", "1", "singular")],
    ["vais", f("present", "2", "singular")],
    ["vai", f("present", "3", "singular")],
    ["vamos", f("present", "1", "plural")],
    ["vão", f("present", "3", "plural")],
    ["ia", f("imperfect", "1|3", "singular")],
    ["fui", f("preterite", "1", "singular")],
    ["foi", f("preterite", "3", "singular")],
    ["foram", f("preterite", "3", "plural")],
    ["irei", f("future", "1", "singular")],
    ["vá", f("present", "1|3", "singular", "subjunctive")],
    ["ido", { verbForm: "participle" }],
    ["indo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "fazer", [
    ["faço", f("present", "1", "singular")],
    ["fazes", f("present", "2", "singular")],
    ["faz", f("present", "3", "singular")],
    ["fazemos", f("present", "1", "plural")],
    ["fazem", f("present", "3", "plural")],
    ["fazia", f("imperfect", "1|3", "singular")],
    ["fiz", f("preterite", "1", "singular")],
    ["fez", f("preterite", "3", "singular")],
    ["fizeram", f("preterite", "3", "plural")],
    ["farei", f("future", "1", "singular")],
    ["faça", f("present", "1|3", "singular", "subjunctive")],
    ["feito", { verbForm: "participle" }],
    ["fazendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "poder", [
    ["posso", f("present", "1", "singular")],
    ["podes", f("present", "2", "singular")],
    ["pode", f("present", "3", "singular")],
    ["podemos", f("present", "1", "plural")],
    ["podem", f("present", "3", "plural")],
    ["pude", f("preterite", "1", "singular")],
    ["pôde", f("preterite", "3", "singular")],
    ["puderam", f("preterite", "3", "plural")],
    ["poderei", f("future", "1", "singular")],
    ["possa", f("present", "1|3", "singular", "subjunctive")],
    ["podido", { verbForm: "participle" }],
    ["podendo", { verbForm: "gerund" }],
  ]);
  addClosedClass(t, "determiner", ["o", "a", "os", "as", "um", "uma", "uns", "umas", "este", "esta", "meu", "minha", "seu", "sua"]);
  addClosedClass(t, "pronoun", ["eu", "tu", "ele", "ela", "você", "nós", "eles", "elas", "vocês", "me", "te", "se", "nos", "que"]);
  addClosedClass(t, "preposition", ["de", "em", "a", "com", "por", "para", "sem", "sobre", "entre", "até", "desde"]);
  addClosedClass(t, "conjunction", ["e", "ou", "mas", "porque", "como", "quando", "se"]);
  addClosedClass(t, "adverb", ["não", "sim", "muito", "mais", "menos", "já", "aqui", "bem", "mal", "sempre", "nunca"]);
  addNouns(t, [
    ["livro", "livros"],
    ["coração", "corações"],
    ["animal", "animais"],
    ["casa", "casas"],
    ["amigo", "amigos"],
  ]);
  return t;
}

function buildItalianTable(): CandidateTable {
  const t: CandidateTable = new Map();
  addVerbForms(t, "essere", [
    ["sono", f("present", "1|3", "singular|plural")],
    ["sei", f("present", "2", "singular")],
    ["è", f("present", "3", "singular")],
    ["siamo", f("present", "1", "plural")],
    ["siete", f("present", "2", "plural")],
    ["ero", f("imperfect", "1", "singular")],
    ["eri", f("imperfect", "2", "singular")],
    ["era", f("imperfect", "3", "singular")],
    ["eravamo", f("imperfect", "1", "plural")],
    ["erano", f("imperfect", "3", "plural")],
    ["fui", f("preterite", "1", "singular")],
    ["fosti", f("preterite", "2", "singular")],
    ["fu", f("preterite", "3", "singular")],
    ["fummo", f("preterite", "1", "plural")],
    ["furono", f("preterite", "3", "plural")],
    ["sarò", f("future", "1", "singular")],
    ["sarà", f("future", "3", "singular")],
    ["sia", f("present", "1|3", "singular", "subjunctive")],
    ["stato", { verbForm: "participle" }],
    ["essendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "avere", [
    ["ho", f("present", "1", "singular")],
    ["hai", f("present", "2", "singular")],
    ["ha", f("present", "3", "singular")],
    ["abbiamo", f("present", "1", "plural")],
    ["avete", f("present", "2", "plural")],
    ["hanno", f("present", "3", "plural")],
    ["avevo", f("imperfect", "1", "singular")],
    ["aveva", f("imperfect", "3", "singular")],
    ["ebbi", f("preterite", "1", "singular")],
    ["ebbe", f("preterite", "3", "singular")],
    ["ebbero", f("preterite", "3", "plural")],
    ["avrò", f("future", "1", "singular")],
    ["avrà", f("future", "3", "singular")],
    ["abbia", f("present", "1|3", "singular", "subjunctive")],
    ["avuto", { verbForm: "participle" }],
    ["avendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "andare", [
    ["vado", f("present", "1", "singular")],
    ["vai", f("present", "2", "singular")],
    ["va", f("present", "3", "singular")],
    ["andiamo", f("present", "1", "plural")],
    ["andate", f("present", "2", "plural")],
    ["vanno", f("present", "3", "plural")],
    ["andavo", f("imperfect", "1", "singular")],
    ["andai", f("preterite", "1", "singular")],
    ["andò", f("preterite", "3", "singular")],
    ["andrò", f("future", "1", "singular")],
    ["vada", f("present", "1|3", "singular", "subjunctive")],
    ["andato", { verbForm: "participle" }],
    ["andando", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "fare", [
    ["faccio", f("present", "1", "singular")],
    ["fai", f("present", "2", "singular")],
    ["fa", f("present", "3", "singular")],
    ["facciamo", f("present", "1", "plural")],
    ["fate", f("present", "2", "plural")],
    ["fanno", f("present", "3", "plural")],
    ["facevo", f("imperfect", "1", "singular")],
    ["feci", f("preterite", "1", "singular")],
    ["fece", f("preterite", "3", "singular")],
    ["fecero", f("preterite", "3", "plural")],
    ["farò", f("future", "1", "singular")],
    ["faccia", f("present", "1|3", "singular", "subjunctive")],
    ["fatto", { verbForm: "participle" }],
    ["facendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "potere", [
    ["posso", f("present", "1", "singular")],
    ["puoi", f("present", "2", "singular")],
    ["può", f("present", "3", "singular")],
    ["possiamo", f("present", "1", "plural")],
    ["potete", f("present", "2", "plural")],
    ["possono", f("present", "3", "plural")],
    ["potei", f("preterite", "1", "singular")],
    ["potè", f("preterite", "3", "singular")],
    ["potrò", f("future", "1", "singular")],
    ["possa", f("present", "1|3", "singular", "subjunctive")],
    ["potuto", { verbForm: "participle" }],
    ["potendo", { verbForm: "gerund" }],
  ]);
  addVerbForms(t, "volere", [
    ["voglio", f("present", "1", "singular")],
    ["vuoi", f("present", "2", "singular")],
    ["vuole", f("present", "3", "singular")],
    ["vogliamo", f("present", "1", "plural")],
    ["volete", f("present", "2", "plural")],
    ["vogliono", f("present", "3", "plural")],
    ["volli", f("preterite", "1", "singular")],
    ["volle", f("preterite", "3", "singular")],
    ["vorrò", f("future", "1", "singular")],
    ["voglia", f("present", "1|3", "singular", "subjunctive")],
    ["voluto", { verbForm: "participle" }],
    ["volendo", { verbForm: "gerund" }],
  ]);
  addClosedClass(t, "determiner", ["il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "questo", "questa", "mio", "mia", "tuo", "suo"]);
  addClosedClass(t, "pronoun", ["io", "tu", "lui", "lei", "noi", "voi", "loro", "mi", "ti", "si", "ci", "vi", "che", "chi"]);
  addClosedClass(t, "preposition", ["di", "a", "da", "in", "con", "su", "per", "tra", "fra", "senza", "sopra", "sotto"]);
  addClosedClass(t, "conjunction", ["e", "o", "ma", "perché", "come", "quando", "se"]);
  addClosedClass(t, "adverb", ["non", "sì", "molto", "più", "meno", "già", "qui", "bene", "male", "sempre", "mai"]);
  addNouns(t, [
    ["libro", "libri"],
    ["amico", "amici"],
    ["casa", "case"],
    ["porta", "porte"],
  ]);
  return t;
}

const TABLES: Record<RomanceLang, CandidateTable> = {
  es: buildSpanishTable(),
  fr: buildFrenchTable(),
  pt: buildPortugueseTable(),
  it: buildItalianTable(),
};

interface SuffixRule {
  suffix: string;
  ending: string;
  pos: string;
  features: Record<string, string>;
  minStem: number;
}

const SPANISH_RULES: readonly SuffixRule[] = [
  { suffix: "ando", ending: "ar", pos: "verb", features: { verbForm: "gerund" }, minStem: 2 },
  { suffix: "iendo", ending: "er", pos: "verb", features: { verbForm: "gerund" }, minStem: 2 },
  { suffix: "ado", ending: "ar", pos: "verb", features: { verbForm: "participle" }, minStem: 2 },
  { suffix: "ido", ending: "er", pos: "verb", features: { verbForm: "participle" }, minStem: 2 },
  { suffix: "aremos", ending: "ar", pos: "verb", features: f("future", "1", "plural"), minStem: 2 },
  { suffix: "eremos", ending: "er", pos: "verb", features: f("future", "1", "plural"), minStem: 2 },
  { suffix: "iremos", ending: "ir", pos: "verb", features: f("future", "1", "plural"), minStem: 2 },
  { suffix: "arán", ending: "ar", pos: "verb", features: f("future", "3", "plural"), minStem: 2 },
  { suffix: "erán", ending: "er", pos: "verb", features: f("future", "3", "plural"), minStem: 2 },
  { suffix: "irán", ending: "ir", pos: "verb", features: f("future", "3", "plural"), minStem: 2 },
  { suffix: "aré", ending: "ar", pos: "verb", features: f("future", "1", "singular"), minStem: 2 },
  { suffix: "eré", ending: "er", pos: "verb", features: f("future", "1", "singular"), minStem: 2 },
  { suffix: "iré", ending: "ir", pos: "verb", features: f("future", "1", "singular"), minStem: 2 },
  { suffix: "arás", ending: "ar", pos: "verb", features: f("future", "2", "singular"), minStem: 2 },
  { suffix: "ará", ending: "ar", pos: "verb", features: f("future", "3", "singular"), minStem: 2 },
  { suffix: "erá", ending: "er", pos: "verb", features: f("future", "3", "singular"), minStem: 2 },
  { suffix: "irá", ending: "ir", pos: "verb", features: f("future", "3", "singular"), minStem: 2 },
  { suffix: "ábamos", ending: "ar", pos: "verb", features: f("imperfect", "1", "plural"), minStem: 2 },
  { suffix: "aban", ending: "ar", pos: "verb", features: f("imperfect", "3", "plural"), minStem: 2 },
  { suffix: "abas", ending: "ar", pos: "verb", features: f("imperfect", "2", "singular"), minStem: 2 },
  { suffix: "aba", ending: "ar", pos: "verb", features: f("imperfect", "1|3", "singular"), minStem: 2 },
  { suffix: "ían", ending: "er", pos: "verb", features: f("imperfect", "3", "plural"), minStem: 2 },
  { suffix: "ías", ending: "er", pos: "verb", features: f("imperfect", "2", "singular"), minStem: 2 },
  { suffix: "ía", ending: "er", pos: "verb", features: f("imperfect", "1|3", "singular"), minStem: 2 },
  { suffix: "aron", ending: "ar", pos: "verb", features: f("preterite", "3", "plural"), minStem: 2 },
  { suffix: "ieron", ending: "er", pos: "verb", features: f("preterite", "3", "plural"), minStem: 2 },
  { suffix: "aste", ending: "ar", pos: "verb", features: f("preterite", "2", "singular"), minStem: 2 },
  { suffix: "iste", ending: "er", pos: "verb", features: f("preterite", "2", "singular"), minStem: 2 },
  { suffix: "amos", ending: "ar", pos: "verb", features: f("present", "1", "plural"), minStem: 2 },
  { suffix: "emos", ending: "er", pos: "verb", features: f("present", "1", "plural"), minStem: 2 },
  { suffix: "imos", ending: "ir", pos: "verb", features: f("present", "1", "plural"), minStem: 2 },
  { suffix: "áis", ending: "ar", pos: "verb", features: f("present", "2", "plural"), minStem: 2 },
  { suffix: "éis", ending: "er", pos: "verb", features: f("present", "2", "plural"), minStem: 2 },
  { suffix: "ó", ending: "ar", pos: "verb", features: f("preterite", "3", "singular"), minStem: 2 },
  { suffix: "é", ending: "ar", pos: "verb", features: f("preterite", "1", "singular"), minStem: 2 },
  { suffix: "ió", ending: "er", pos: "verb", features: f("preterite", "3", "singular"), minStem: 2 },
  { suffix: "as", ending: "ar", pos: "verb", features: f("present", "2", "singular"), minStem: 3 },
  { suffix: "an", ending: "ar", pos: "verb", features: f("present", "3", "plural"), minStem: 3 },
  { suffix: "o", ending: "ar", pos: "verb", features: f("present", "1", "singular"), minStem: 3 },
];

const FRENCH_RULES: readonly SuffixRule[] = [
  { suffix: "issons", ending: "ir", pos: "verb", features: f("present", "1", "plural"), minStem: 2 },
  { suffix: "issez", ending: "ir", pos: "verb", features: f("present", "2", "plural"), minStem: 2 },
  { suffix: "issent", ending: "ir", pos: "verb", features: f("present", "3", "plural"), minStem: 2 },
  { suffix: "erai", ending: "er", pos: "verb", features: f("future", "1", "singular"), minStem: 2 },
  { suffix: "eras", ending: "er", pos: "verb", features: f("future", "2", "singular"), minStem: 2 },
  { suffix: "era", ending: "er", pos: "verb", features: f("future", "3", "singular"), minStem: 2 },
  { suffix: "erons", ending: "er", pos: "verb", features: f("future", "1", "plural"), minStem: 2 },
  { suffix: "erez", ending: "er", pos: "verb", features: f("future", "2", "plural"), minStem: 2 },
  { suffix: "eront", ending: "er", pos: "verb", features: f("future", "3", "plural"), minStem: 2 },
  { suffix: "ais", ending: "er", pos: "verb", features: f("imperfect", "1|2", "singular"), minStem: 2 },
  { suffix: "ait", ending: "er", pos: "verb", features: f("imperfect", "3", "singular"), minStem: 2 },
  { suffix: "ions", ending: "er", pos: "verb", features: f("imperfect", "1", "plural"), minStem: 2 },
  { suffix: "aient", ending: "er", pos: "verb", features: f("imperfect", "3", "plural"), minStem: 2 },
  { suffix: "ons", ending: "er", pos: "verb", features: f("present", "1", "plural"), minStem: 2 },
  { suffix: "ez", ending: "er", pos: "verb", features: f("present", "2", "plural"), minStem: 2 },
  { suffix: "ent", ending: "er", pos: "verb", features: f("present", "3", "plural"), minStem: 3 },
  { suffix: "ant", ending: "er", pos: "verb", features: { verbForm: "gerund" }, minStem: 3 },
  { suffix: "é", ending: "er", pos: "verb", features: { verbForm: "participle" }, minStem: 2 },
];

const PORTUGUESE_RULES: readonly SuffixRule[] = [
  { suffix: "ando", ending: "ar", pos: "verb", features: { verbForm: "gerund" }, minStem: 2 },
  { suffix: "endo", ending: "er", pos: "verb", features: { verbForm: "gerund" }, minStem: 2 },
  { suffix: "indo", ending: "ir", pos: "verb", features: { verbForm: "gerund" }, minStem: 2 },
  { suffix: "ado", ending: "ar", pos: "verb", features: { verbForm: "participle" }, minStem: 2 },
  { suffix: "ido", ending: "er", pos: "verb", features: { verbForm: "participle" }, minStem: 2 },
  { suffix: "amos", ending: "ar", pos: "verb", features: f("present", "1", "plural"), minStem: 2 },
  { suffix: "emos", ending: "er", pos: "verb", features: f("present", "1", "plural"), minStem: 2 },
  { suffix: "imos", ending: "ir", pos: "verb", features: f("present", "1", "plural"), minStem: 2 },
  { suffix: "ava", ending: "ar", pos: "verb", features: f("imperfect", "1|3", "singular"), minStem: 2 },
  { suffix: "arei", ending: "ar", pos: "verb", features: f("future", "1", "singular"), minStem: 2 },
  { suffix: "ará", ending: "ar", pos: "verb", features: f("future", "3", "singular"), minStem: 2 },
  { suffix: "ou", ending: "ar", pos: "verb", features: f("preterite", "3", "singular"), minStem: 2 },
  { suffix: "ei", ending: "ar", pos: "verb", features: f("preterite", "1", "singular"), minStem: 2 },
];

const ITALIAN_RULES: readonly SuffixRule[] = [
  { suffix: "ando", ending: "are", pos: "verb", features: { verbForm: "gerund" }, minStem: 2 },
  { suffix: "endo", ending: "ere", pos: "verb", features: { verbForm: "gerund" }, minStem: 2 },
  { suffix: "ato", ending: "are", pos: "verb", features: { verbForm: "participle" }, minStem: 2 },
  { suffix: "uto", ending: "ere", pos: "verb", features: { verbForm: "participle" }, minStem: 2 },
  { suffix: "ito", ending: "ire", pos: "verb", features: { verbForm: "participle" }, minStem: 2 },
  { suffix: "iamo", ending: "are", pos: "verb", features: f("present", "1", "plural"), minStem: 2 },
  { suffix: "ano", ending: "are", pos: "verb", features: f("present", "3", "plural"), minStem: 3 },
  { suffix: "ono", ending: "ere", pos: "verb", features: f("present", "3", "plural"), minStem: 3 },
  { suffix: "isco", ending: "ire", pos: "verb", features: f("present", "1", "singular"), minStem: 2 },
  { suffix: "isci", ending: "ire", pos: "verb", features: f("present", "2", "singular"), minStem: 2 },
  { suffix: "isce", ending: "ire", pos: "verb", features: f("present", "3", "singular"), minStem: 2 },
  { suffix: "avo", ending: "are", pos: "verb", features: f("imperfect", "1", "singular"), minStem: 2 },
  { suffix: "ava", ending: "are", pos: "verb", features: f("imperfect", "3", "singular"), minStem: 2 },
  { suffix: "erò", ending: "are", pos: "verb", features: f("future", "1", "singular"), minStem: 2 },
];

const RULES_BY_LANG: Record<RomanceLang, readonly SuffixRule[]> = {
  es: SPANISH_RULES,
  fr: FRENCH_RULES,
  pt: PORTUGUESE_RULES,
  it: ITALIAN_RULES,
};

const SUBJECT_PRONOUN_CUES: Record<RomanceLang, ReadonlySet<string>> = {
  es: new Set(["yo", "tú", "él", "ella", "usted", "nosotros", "ellos", "ellas", "no"]),
  fr: new Set(["je", "j", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "ne"]),
  pt: new Set(["eu", "tu", "ele", "ela", "você", "nós", "eles", "elas", "não"]),
  it: new Set(["io", "tu", "lui", "lei", "noi", "voi", "loro", "non"]),
};

const DETERMINER_CUES: Record<RomanceLang, ReadonlySet<string>> = {
  es: new Set(["el", "la", "los", "las", "un", "una", "unos", "unas", "mi", "tu", "su", "este", "esta", "ese", "esa", "del", "al"]),
  fr: new Set(["le", "la", "les", "un", "une", "des", "du", "au", "aux", "ce", "cet", "cette", "ces", "mon", "ma", "mes", "ton", "son", "l"]),
  pt: new Set(["o", "a", "os", "as", "um", "uma", "uns", "umas", "este", "esta", "meu", "minha", "seu", "sua", "do", "da"]),
  it: new Set(["il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "questo", "questa", "mio", "mia", "tuo", "suo", "del", "della"]),
};

const POS_PRIORITY_NO_CONTEXT: readonly string[] = ["preposition", "conjunction", "determiner", "pronoun", "adverb", "noun", "verb"];

function pickHomographCandidate(
  candidates: readonly LexiconCandidate[],
  prevNormalized: string | undefined,
  lang: RomanceLang,
): LexiconCandidate {
  if (candidates.length === 1) return candidates[0];
  if (prevNormalized && DETERMINER_CUES[lang].has(prevNormalized)) {
    const noun = candidates.find((c) => c.pos === "noun");
    if (noun) return noun;
  }
  if (prevNormalized && SUBJECT_PRONOUN_CUES[lang].has(prevNormalized)) {
    const verb = candidates.find((c) => c.pos === "verb");
    if (verb) return verb;
  }
  for (const pos of POS_PRIORITY_NO_CONTEXT) {
    const match = candidates.find((c) => c.pos === pos);
    if (match) return match;
  }
  return candidates[0];
}

function stripFrenchElision(surface: string, normalized: string): { clitic?: string; stem: string } {
  const match = /^([cdjlmnst]|qu)['’](.+)$/iu.exec(normalized);
  if (!match) return { stem: normalized };
  void surface;
  return { clitic: `${match[1]}'`, stem: match[2] };
}

function heuristicRomanceAnalysis(
  normalized: string,
  lang: RomanceLang,
  prevNormalized: string | undefined,
): { lemma: string; pos: string; features: Record<string, string>; confidence: number } {
  // Infinitive forms
  if (
    (lang === "es" && /(?:ar|er|ir)$/u.test(normalized) && normalized.length >= 4) ||
    (lang === "pt" && /(?:ar|er|ir|ôr)$/u.test(normalized) && normalized.length >= 4) ||
    (lang === "fr" && /(?:er|ir|re)$/u.test(normalized) && normalized.length >= 4) ||
    (lang === "it" && /(?:are|ere|ire)$/u.test(normalized) && normalized.length >= 5)
  ) {
    return {
      lemma: normalized,
      pos: "verb",
      features: { verbForm: "infinitive" },
      confidence: 0.76,
    };
  }

  // If preceded by determiner, prefer noun plural heuristic before verb suffix rules.
  const determinerPrecedes = Boolean(prevNormalized && DETERMINER_CUES[lang].has(prevNormalized));

  if (!determinerPrecedes) {
    for (const rule of RULES_BY_LANG[lang]) {
      if (normalized.endsWith(rule.suffix) && normalized.length - rule.suffix.length >= rule.minStem) {
        const stem = normalized.slice(0, normalized.length - rule.suffix.length);
        return {
          lemma: `${stem}${rule.ending}`,
          pos: rule.pos,
          features: { ...rule.features },
          confidence: 0.76,
        };
      }
    }
  }

  // Plural noun/adjective rules
  if (lang === "es" || lang === "pt") {
    if (lang === "es" && normalized.endsWith("ces") && normalized.length >= 5) {
      return { lemma: `${normalized.slice(0, -3)}z`, pos: "noun", features: { number: "plural" }, confidence: 0.76 };
    }
    if (lang === "pt" && normalized.endsWith("ões") && normalized.length >= 5) {
      return { lemma: `${normalized.slice(0, -3)}ão`, pos: "noun", features: { number: "plural" }, confidence: 0.76 };
    }
    if (normalized.endsWith("es") && normalized.length >= 5 && /[bcdfghjklmnpqrstvwxyz]es$/u.test(normalized)) {
      return { lemma: normalized.slice(0, -2), pos: "noun", features: { number: "plural" }, confidence: 0.76 };
    }
    if (normalized.endsWith("s") && normalized.length >= 4 && !normalized.endsWith("ss")) {
      return { lemma: normalized.slice(0, -1), pos: "noun", features: { number: "plural" }, confidence: 0.76 };
    }
  } else if (lang === "fr") {
    if (normalized.endsWith("aux") && normalized.length >= 5) {
      return { lemma: `${normalized.slice(0, -3)}al`, pos: "noun", features: { number: "plural" }, confidence: 0.76 };
    }
    if ((normalized.endsWith("eaux") || normalized.endsWith("eux")) && normalized.length >= 5) {
      return { lemma: normalized.slice(0, -1), pos: "noun", features: { number: "plural" }, confidence: 0.76 };
    }
    if (normalized.endsWith("s") && normalized.length >= 4 && !/(?:is|us|os|as)$/u.test(normalized)) {
      return { lemma: normalized.slice(0, -1), pos: "noun", features: { number: "plural" }, confidence: 0.76 };
    }
  } else if (lang === "it") {
    if ((normalized.endsWith("chi") || normalized.endsWith("ghi")) && normalized.length >= 5) {
      return { lemma: `${normalized.slice(0, -2)}o`, pos: "noun", features: { number: "plural" }, confidence: 0.76 };
    }
    if (normalized.endsWith("i") && normalized.length >= 4) {
      return { lemma: `${normalized.slice(0, -1)}o`, pos: "noun", features: { number: "plural" }, confidence: 0.76 };
    }
    if (normalized.endsWith("e") && normalized.length >= 4) {
      return { lemma: `${normalized.slice(0, -1)}a`, pos: "noun", features: { number: "plural" }, confidence: 0.76 };
    }
  }

  return {
    lemma: normalized,
    pos: determinerPrecedes ? "noun" : "other",
    features: determinerPrecedes ? { number: "singular" } : {},
    confidence: 0.76,
  };
}

export const romanceAdapter = createSimpleAdapter({
  id: ROMANCE_ADAPTER_ID,
  version: ROMANCE_ADAPTER_VERSION,
  supportedLanguageTags: ["es", "fr", "pt", "it"],
  capabilities: createCapabilityDeclarations({
    sentenceSegment: 0.96,
    tokenize: 0.96,
    normalize: 0.98,
    lemma: 0.86,
    pos: 0.84,
    morphology: 0.84,
    script: 0.99,
  }),
  privacyDisclosure:
    "Runs locally on this device using Romance verb paradigm tables and morphological rules. No text leaves the device.",
  async analyze(request, languageTag, manifest, signal) {
    const lang = (baseLanguageCode(languageTag) as RomanceLang) || "es";
    const table = TABLES[lang] ?? TABLES.es;
    const sentenceParts = segmentSentencesMultilingual(request.text, String(languageTag));
    const segments = wordSegments(request.text, String(languageTag));
    const rawTokens: RawTokenInput[] = [];
    let prevNormalized: string | undefined;

    for (const part of segments) {
      throwIfAborted(signal, ROMANCE_ADAPTER_ID);
      const kind = tokenKind(part.segment, part.isWordLike);
      const normalized = normalizeForLookup(part.segment, languageTag);
      if (kind !== "word") {
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          confidenceScore: 0.98,
        });
        if (kind === "punctuation") prevNormalized = undefined;
        continue;
      }

      const pack = await resolvePackEntry(part.segment, normalized, String(languageTag));
      if (pack && (pack.lemma || pack.pos)) {
        const morphology: Morphology | undefined = pack.morphology
          ? { features: pack.morphology }
          : undefined;
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: pack.lemma ?? normalized,
          pos: pack.pos,
          morphology,
          confidenceScore: pack.confidence ?? 0.96,
        });
        prevNormalized = normalized;
        continue;
      }

      const elision = lang === "fr" ? stripFrenchElision(part.segment, normalized) : { stem: normalized };
      const lookupStem = elision.stem;
      const candidates = table.get(lookupStem);

      if (candidates && candidates.length > 0) {
        const chosen = pickHomographCandidate(candidates, prevNormalized, lang);
        const features: Record<string, string> = { ...chosen.features };
        if (elision.clitic) features.clitic = elision.clitic;
        if (candidates.length > 1) {
          features.homograph = "true";
          features.alternatePos = candidates
            .filter((c) => c.pos !== chosen.pos)
            .map((c) => c.pos)
            .join("|");
        }
        rawTokens.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: chosen.lemma,
          pos: chosen.pos,
          morphology: Object.keys(features).length > 0 ? { features } : undefined,
          confidenceScore: chosen.confidence,
        });
        prevNormalized = lookupStem;
        continue;
      }

      const heuristic = heuristicRomanceAnalysis(lookupStem, lang, prevNormalized);
      const features: Record<string, string> = { ...heuristic.features };
      if (elision.clitic) features.clitic = elision.clitic;
      rawTokens.push({
        start: part.start,
        end: part.end,
        surface: part.segment,
        kind,
        normalized,
        lemma: heuristic.lemma,
        pos: heuristic.pos,
        morphology: Object.keys(features).length > 0 ? { features, isPartial: true } : undefined,
        confidenceScore: heuristic.confidence,
      });
      prevNormalized = lookupStem;
    }

    return buildChunkFromAnalysis({
      adapterId: ROMANCE_ADAPTER_ID,
      adapterVersion: ROMANCE_ADAPTER_VERSION,
      manifest,
      request,
      languageTag,
      sentenceParts,
      rawTokens,
    });
  },
});
