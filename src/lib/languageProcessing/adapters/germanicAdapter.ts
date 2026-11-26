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

export const GERMANIC_ADAPTER_ID = "local-germanic";
const GERMANIC_ADAPTER_VERSION = "1.0.0";

type GermanicLang = "de" | "nl";

interface VerbEntry {
  lemma: string;
  features: Readonly<Record<string, string>>;
}

/**
 * Umlaut and eszett-aware lookup normalization:
 * preserves NFC lowercase while folding `ß -> ss` so `Straße` and `Strasse`
 * map to the same lookup key without mutating the source `surface`.
 */
export function normalizeGermanicLookup(value: string, languageTag: string = "de"): string {
  return normalizeForLookup(value, languageTag).replace(/ß/gu, "ss");
}

function foldGermanicUmlautsAscii(value: string): string {
  return normalizeGermanicLookup(value)
    .replace(/ä/gu, "ae")
    .replace(/ö/gu, "oe")
    .replace(/ü/gu, "ue");
}

function stripUmlautForStem(value: string): string {
  return normalizeGermanicLookup(value)
    .replace(/äu/gu, "au")
    .replace(/ä/gu, "a")
    .replace(/ö/gu, "o")
    .replace(/ü/gu, "u");
}

function buildGermanVerbs(): Map<string, VerbEntry> {
  const m = new Map<string, VerbEntry>();
  const add = (lemma: string, forms: readonly [string, Record<string, string>][]) => {
    m.set(normalizeGermanicLookup(lemma), { lemma, features: { verbForm: "infinitive" } });
    for (const [form, features] of forms) {
      m.set(normalizeGermanicLookup(form), { lemma, features });
    }
  };
  add("sein", [
    ["bin", { tense: "present", person: "1", number: "singular" }],
    ["bist", { tense: "present", person: "2", number: "singular" }],
    ["ist", { tense: "present", person: "3", number: "singular" }],
    ["sind", { tense: "present", person: "1|3", number: "plural" }],
    ["seid", { tense: "present", person: "2", number: "plural" }],
    ["war", { tense: "past", person: "1|3", number: "singular" }],
    ["warst", { tense: "past", person: "2", number: "singular" }],
    ["waren", { tense: "past", person: "1|3", number: "plural" }],
    ["wart", { tense: "past", person: "2", number: "plural" }],
    ["gewesen", { verbForm: "participle" }],
    ["wäre", { tense: "past", mood: "subjunctive", number: "singular" }],
    ["wären", { tense: "past", mood: "subjunctive", number: "plural" }],
  ]);
  add("haben", [
    ["habe", { tense: "present", person: "1", number: "singular" }],
    ["hast", { tense: "present", person: "2", number: "singular" }],
    ["hat", { tense: "present", person: "3", number: "singular" }],
    ["habt", { tense: "present", person: "2", number: "plural" }],
    ["hatte", { tense: "past", person: "1|3", number: "singular" }],
    ["hattest", { tense: "past", person: "2", number: "singular" }],
    ["hatten", { tense: "past", person: "1|3", number: "plural" }],
    ["gehabt", { verbForm: "participle" }],
    ["hätte", { tense: "past", mood: "subjunctive", number: "singular" }],
  ]);
  add("werden", [
    ["werde", { tense: "present", person: "1", number: "singular" }],
    ["wirst", { tense: "present", person: "2", number: "singular" }],
    ["wird", { tense: "present", person: "3", number: "singular" }],
    ["werdet", { tense: "present", person: "2", number: "plural" }],
    ["wurde", { tense: "past", person: "1|3", number: "singular" }],
    ["wurdest", { tense: "past", person: "2", number: "singular" }],
    ["wurden", { tense: "past", person: "1|3", number: "plural" }],
    ["geworden", { verbForm: "participle" }],
    ["würde", { tense: "past", mood: "subjunctive", number: "singular" }],
  ]);
  add("können", [
    ["kann", { tense: "present", person: "1|3", number: "singular" }],
    ["kannst", { tense: "present", person: "2", number: "singular" }],
    ["könnt", { tense: "present", person: "2", number: "plural" }],
    ["konnte", { tense: "past", person: "1|3", number: "singular" }],
    ["konnten", { tense: "past", person: "1|3", number: "plural" }],
    ["gekonnt", { verbForm: "participle" }],
    ["könnte", { tense: "past", mood: "subjunctive", number: "singular" }],
  ]);
  add("müssen", [
    ["muss", { tense: "present", person: "1|3", number: "singular" }],
    ["musst", { tense: "present", person: "2", number: "singular" }],
    ["müsst", { tense: "present", person: "2", number: "plural" }],
    ["musste", { tense: "past", person: "1|3", number: "singular" }],
    ["mussten", { tense: "past", person: "1|3", number: "plural" }],
    ["müsste", { tense: "past", mood: "subjunctive", number: "singular" }],
  ]);
  add("dürfen", [
    ["darf", { tense: "present", person: "1|3", number: "singular" }],
    ["darfst", { tense: "present", person: "2", number: "singular" }],
    ["durfte", { tense: "past", person: "1|3", number: "singular" }],
  ]);
  add("sollen", [
    ["soll", { tense: "present", person: "1|3", number: "singular" }],
    ["sollst", { tense: "present", person: "2", number: "singular" }],
    ["sollte", { tense: "past", person: "1|3", number: "singular" }],
  ]);
  add("wollen", [
    ["will", { tense: "present", person: "1|3", number: "singular" }],
    ["willst", { tense: "present", person: "2", number: "singular" }],
    ["wollte", { tense: "past", person: "1|3", number: "singular" }],
  ]);
  add("wissen", [
    ["weiß", { tense: "present", person: "1|3", number: "singular" }],
    ["weißt", { tense: "present", person: "2", number: "singular" }],
    ["wusste", { tense: "past", person: "1|3", number: "singular" }],
    ["gewusst", { verbForm: "participle" }],
  ]);
  add("sprechen", [
    ["spreche", { tense: "present", person: "1", number: "singular" }],
    ["sprichst", { tense: "present", person: "2", number: "singular" }],
    ["spricht", { tense: "present", person: "3", number: "singular" }],
    ["sprecht", { tense: "present", person: "2", number: "plural" }],
    ["sprach", { tense: "past", person: "1|3", number: "singular" }],
    ["sprachen", { tense: "past", person: "1|3", number: "plural" }],
    ["gesprochen", { verbForm: "participle" }],
  ]);
  add("gehen", [
    ["gehe", { tense: "present", person: "1", number: "singular" }],
    ["gehst", { tense: "present", person: "2", number: "singular" }],
    ["geht", { tense: "present", person: "3", number: "singular" }],
    ["ging", { tense: "past", person: "1|3", number: "singular" }],
    ["gingen", { tense: "past", person: "1|3", number: "plural" }],
    ["gegangen", { verbForm: "participle" }],
  ]);
  add("stehen", [
    ["stehe", { tense: "present", person: "1", number: "singular" }],
    ["stehst", { tense: "present", person: "2", number: "singular" }],
    ["steht", { tense: "present", person: "3", number: "singular" }],
    ["stand", { tense: "past", person: "1|3", number: "singular" }],
    ["standen", { tense: "past", person: "1|3", number: "plural" }],
    ["gestanden", { verbForm: "participle" }],
  ]);
  add("kommen", [
    ["komme", { tense: "present", person: "1", number: "singular" }],
    ["kommst", { tense: "present", person: "2", number: "singular" }],
    ["kommt", { tense: "present", person: "3", number: "singular" }],
    ["kam", { tense: "past", person: "1|3", number: "singular" }],
    ["kamen", { tense: "past", person: "1|3", number: "plural" }],
    ["gekommen", { verbForm: "participle" }],
  ]);
  add("nehmen", [
    ["nehme", { tense: "present", person: "1", number: "singular" }],
    ["nimmst", { tense: "present", person: "2", number: "singular" }],
    ["nimmt", { tense: "present", person: "3", number: "singular" }],
    ["nahm", { tense: "past", person: "1|3", number: "singular" }],
    ["nahmen", { tense: "past", person: "1|3", number: "plural" }],
    ["genommen", { verbForm: "participle" }],
  ]);
  add("geben", [
    ["gebe", { tense: "present", person: "1", number: "singular" }],
    ["gibst", { tense: "present", person: "2", number: "singular" }],
    ["gibt", { tense: "present", person: "3", number: "singular" }],
    ["gab", { tense: "past", person: "1|3", number: "singular" }],
    ["gaben", { tense: "past", person: "1|3", number: "plural" }],
    ["gegeben", { verbForm: "participle" }],
  ]);
  add("sehen", [
    ["sehe", { tense: "present", person: "1", number: "singular" }],
    ["siehst", { tense: "present", person: "2", number: "singular" }],
    ["sieht", { tense: "present", person: "3", number: "singular" }],
    ["sah", { tense: "past", person: "1|3", number: "singular" }],
    ["sahen", { tense: "past", person: "1|3", number: "plural" }],
    ["gesehen", { verbForm: "participle" }],
  ]);
  add("fahren", [
    ["fahre", { tense: "present", person: "1", number: "singular" }],
    ["fährst", { tense: "present", person: "2", number: "singular" }],
    ["fährt", { tense: "present", person: "3", number: "singular" }],
    ["fuhr", { tense: "past", person: "1|3", number: "singular" }],
    ["fuhren", { tense: "past", person: "1|3", number: "plural" }],
    ["gefahren", { verbForm: "participle" }],
  ]);
  add("lesen", [
    ["lese", { tense: "present", person: "1", number: "singular" }],
    ["liest", { tense: "present", person: "2|3", number: "singular" }],
    ["las", { tense: "past", person: "1|3", number: "singular" }],
    ["gelesen", { verbForm: "participle" }],
  ]);
  add("schreiben", [
    ["schreibe", { tense: "present", person: "1", number: "singular" }],
    ["schreibst", { tense: "present", person: "2", number: "singular" }],
    ["schreibt", { tense: "present", person: "3", number: "singular" }],
    ["schrieb", { tense: "past", person: "1|3", number: "singular" }],
    ["geschrieben", { verbForm: "participle" }],
  ]);
  add("essen", [
    ["esse", { tense: "present", person: "1", number: "singular" }],
    ["isst", { tense: "present", person: "2|3", number: "singular" }],
    ["aß", { tense: "past", person: "1|3", number: "singular" }],
    ["gegessen", { verbForm: "participle" }],
  ]);
  add("trinken", [
    ["trinke", { tense: "present", person: "1", number: "singular" }],
    ["trinkst", { tense: "present", person: "2", number: "singular" }],
    ["trinkt", { tense: "present", person: "3", number: "singular" }],
    ["trank", { tense: "past", person: "1|3", number: "singular" }],
    ["getrunken", { verbForm: "participle" }],
  ]);
  add("finden", [
    ["finde", { tense: "present", person: "1", number: "singular" }],
    ["findest", { tense: "present", person: "2", number: "singular" }],
    ["findet", { tense: "present", person: "3", number: "singular" }],
    ["fand", { tense: "past", person: "1|3", number: "singular" }],
    ["gefunden", { verbForm: "participle" }],
  ]);
  add("machen", [
    ["mache", { tense: "present", person: "1", number: "singular" }],
    ["machst", { tense: "present", person: "2", number: "singular" }],
    ["macht", { tense: "present", person: "3", number: "singular" }],
    ["machte", { tense: "past", person: "1|3", number: "singular" }],
    ["gemacht", { verbForm: "participle" }],
  ]);
  add("kaufen", [
    ["kaufe", { tense: "present", person: "1", number: "singular" }],
    ["kaufst", { tense: "present", person: "2", number: "singular" }],
    ["kauft", { tense: "present", person: "3", number: "singular" }],
    ["kaufte", { tense: "past", person: "1|3", number: "singular" }],
    ["gekauft", { verbForm: "participle" }],
  ]);
  add("fangen", [
    ["fange", { tense: "present", person: "1", number: "singular" }],
    ["fängst", { tense: "present", person: "2", number: "singular" }],
    ["fängt", { tense: "present", person: "3", number: "singular" }],
    ["fing", { tense: "past", person: "1|3", number: "singular" }],
    ["gefangen", { verbForm: "participle" }],
  ]);
  return m;
}

function buildDutchVerbs(): Map<string, VerbEntry> {
  const m = new Map<string, VerbEntry>();
  const add = (lemma: string, forms: readonly [string, Record<string, string>][]) => {
    m.set(lemma, { lemma, features: { verbForm: "infinitive" } });
    for (const [form, features] of forms) m.set(form, { lemma, features });
  };
  add("zijn", [
    ["ben", { tense: "present", person: "1", number: "singular" }],
    ["bent", { tense: "present", person: "2", number: "singular" }],
    ["is", { tense: "present", person: "3", number: "singular" }],
    ["was", { tense: "past", person: "1|3", number: "singular" }],
    ["waren", { tense: "past", person: "1|3", number: "plural" }],
    ["geweest", { verbForm: "participle" }],
  ]);
  add("hebben", [
    ["heb", { tense: "present", person: "1", number: "singular" }],
    ["hebt", { tense: "present", person: "2", number: "singular" }],
    ["heeft", { tense: "present", person: "3", number: "singular" }],
    ["had", { tense: "past", person: "1|3", number: "singular" }],
    ["hadden", { tense: "past", person: "1|3", number: "plural" }],
    ["gehad", { verbForm: "participle" }],
  ]);
  add("worden", [
    ["word", { tense: "present", person: "1", number: "singular" }],
    ["wordt", { tense: "present", person: "2|3", number: "singular" }],
    ["werd", { tense: "past", person: "1|3", number: "singular" }],
    ["werden", { tense: "past", person: "1|3", number: "plural" }],
    ["geworden", { verbForm: "participle" }],
  ]);
  add("kunnen", [
    ["kan", { tense: "present", person: "1|3", number: "singular" }],
    ["kunt", { tense: "present", person: "2", number: "singular" }],
    ["kon", { tense: "past", person: "1|3", number: "singular" }],
    ["konden", { tense: "past", person: "1|3", number: "plural" }],
  ]);
  add("gaan", [
    ["ga", { tense: "present", person: "1", number: "singular" }],
    ["gaat", { tense: "present", person: "2|3", number: "singular" }],
    ["ging", { tense: "past", person: "1|3", number: "singular" }],
    ["gingen", { tense: "past", person: "1|3", number: "plural" }],
    ["gegaan", { verbForm: "participle" }],
  ]);
  add("staan", [
    ["sta", { tense: "present", person: "1", number: "singular" }],
    ["staat", { tense: "present", person: "2|3", number: "singular" }],
    ["stond", { tense: "past", person: "1|3", number: "singular" }],
    ["gestaan", { verbForm: "participle" }],
  ]);
  add("komen", [
    ["kom", { tense: "present", person: "1", number: "singular" }],
    ["komt", { tense: "present", person: "2|3", number: "singular" }],
    ["kwam", { tense: "past", person: "1|3", number: "singular" }],
    ["gekomen", { verbForm: "participle" }],
  ]);
  add("spreken", [
    ["spreek", { tense: "present", person: "1", number: "singular" }],
    ["spreekt", { tense: "present", person: "2|3", number: "singular" }],
    ["sprak", { tense: "past", person: "1|3", number: "singular" }],
    ["gesproken", { verbForm: "participle" }],
  ]);
  return m;
}

const GERMAN_VERBS = buildGermanVerbs();
const DUTCH_VERBS = buildDutchVerbs();

const GERMAN_SEPARABLE_PREFIXES = [
  "zusammen", "zurück", "weiter", "wieder", "ab", "an", "auf", "aus",
  "bei", "ein", "fest", "fort", "her", "hin", "los", "mit", "nach", "vor", "weg", "zu",
] as const;

const DUTCH_SEPARABLE_PREFIXES = [
  "voor", "over", "door", "aan", "af", "bij", "in", "mee", "na", "om", "op", "toe", "uit", "weg",
] as const;

const GERMAN_STEMS: ReadonlyMap<string, string> = new Map([
  ["hand", "Hand"],
  ["schuh", "Schuh"],
  ["bahn", "Bahn"],
  ["hof", "Hof"],
  ["wort", "Wort"],
  ["worter", "Wort"],
  ["wörter", "Wort"],
  ["buch", "Buch"],
  ["bücher", "Buch"],
  ["haus", "Haus"],
  ["häuser", "Haus"],
  ["tür", "Tür"],
  ["zimmer", "Zimmer"],
  ["arbeit", "Arbeit"],
  ["zeit", "Zeit"],
  ["tag", "Tag"],
  ["nacht", "Nacht"],
  ["wasser", "Wasser"],
  ["stadt", "Stadt"],
  ["land", "Land"],
  ["schule", "Schule"],
  ["kind", "Kind"],
  ["freund", "Freund"],
  ["straße", "Straße"],
  ["strasse", "Straße"],
  ["baum", "Baum"],
  ["wald", "Wald"],
  ["berg", "Berg"],
  ["tisch", "Tisch"],
  ["stuhl", "Stuhl"],
  ["fenster", "Fenster"],
  ["kopf", "Kopf"],
  ["fuss", "Fuß"],
  ["auge", "Auge"],
  ["herz", "Herz"],
  ["welt", "Welt"],
  ["leben", "Leben"],
  ["sprache", "Sprache"],
  ["kraft", "Kraft"],
  ["werk", "Werk"],
  ["zeug", "Zeug"],
  ["flug", "Flug"],
  ["zug", "Zug"],
  ["geld", "Geld"],
  ["licht", "Licht"],
  ["bild", "Bild"],
  ["spiel", "Spiel"],
  ["schlüssel", "Schlüssel"],
  ["tasche", "Tasche"],
  ["uhr", "Uhr"],
  ["mann", "Mann"],
  ["frau", "Frau"],
  ["lehrer", "Lehrer"],
  ["platz", "Platz"],
  ["weg", "Weg"],
  ["plan", "Plan"],
  ["garten", "Garten"],
  ["zimmer", "Zimmer"],
  ["kaffee", "Kaffee"],
  ["brot", "Brot"],
  ["sommer", "Sommer"],
  ["winter", "Winter"],
]);

const DUTCH_STEMS: ReadonlyMap<string, string> = new Map([
  ["hand", "hand"],
  ["schoen", "schoen"],
  ["trein", "trein"],
  ["station", "station"],
  ["woord", "woord"],
  ["woorden", "woord"],
  ["boek", "boek"],
  ["huis", "huis"],
  ["deur", "deur"],
  ["kamer", "kamer"],
  ["werk", "werk"],
  ["tijd", "tijd"],
  ["dag", "dag"],
  ["water", "water"],
  ["stad", "stad"],
  ["land", "land"],
  ["school", "school"],
  ["taal", "taal"],
  ["fiets", "fiets"],
  ["weg", "weg"],
]);

function splitCompoundGermanic(
  surface: string,
  lang: GermanicLang,
): string[] | null {
  const stems = lang === "de" ? GERMAN_STEMS : DUTCH_STEMS;
  const norm = normalizeGermanicLookup(surface, lang);
  if (norm.length < 6) return null;

  const findStem = (piece: string): string | undefined => {
    const direct = stems.get(piece);
    if (direct) return direct;
    const stripped = stripUmlautForStem(piece);
    return stems.get(stripped);
  };

  if (findStem(norm)) return null;

  const linkers = ["", "s", "es", "n", "en", "er", "e"];
  for (let splitAt = 3; splitAt <= norm.length - 3; splitAt += 1) {
    const leftRaw = norm.slice(0, splitAt);
    const left = findStem(leftRaw);
    if (!left) continue;
    const rest = norm.slice(splitAt);
    for (const linker of linkers) {
      if (linker && !rest.startsWith(linker)) continue;
      const rightRaw = rest.slice(linker.length);
      if (rightRaw.length < 3) continue;
      const right = findStem(rightRaw);
      if (right) {
        return [left, right];
      }
      // Also allow linker attached to left stem (e.g. Wörter + buch)
    }
  }
  return null;
}

interface DeterminerCue {
  pos: string;
  features: Record<string, string>;
}

const GERMAN_DETERMINERS: Readonly<Record<string, DeterminerCue>> = {
  der: { pos: "determiner", features: { case: "nominative|genitive|dative", gender: "masculine|feminine", number: "singular|plural" } },
  die: { pos: "determiner", features: { case: "nominative|accusative", gender: "feminine|plural", number: "singular|plural" } },
  das: { pos: "determiner", features: { case: "nominative|accusative", gender: "neuter", number: "singular" } },
  den: { pos: "determiner", features: { case: "accusative|dative", gender: "masculine|plural", number: "singular|plural" } },
  dem: { pos: "determiner", features: { case: "dative", gender: "masculine|neuter", number: "singular" } },
  des: { pos: "determiner", features: { case: "genitive", gender: "masculine|neuter", number: "singular" } },
  ein: { pos: "determiner", features: { case: "nominative|accusative", gender: "masculine|neuter", number: "singular" } },
  eine: { pos: "determiner", features: { case: "nominative|accusative", gender: "feminine", number: "singular" } },
  einen: { pos: "determiner", features: { case: "accusative", gender: "masculine", number: "singular" } },
  einem: { pos: "determiner", features: { case: "dative", gender: "masculine|neuter", number: "singular" } },
  eines: { pos: "determiner", features: { case: "genitive", gender: "masculine|neuter", number: "singular" } },
  einer: { pos: "determiner", features: { case: "genitive|dative", gender: "feminine", number: "singular" } },
};

const DUTCH_DETERMINERS: Readonly<Record<string, DeterminerCue>> = {
  de: { pos: "determiner", features: { gender: "common", number: "singular|plural" } },
  het: { pos: "determiner", features: { gender: "neuter", number: "singular" } },
  een: { pos: "determiner", features: { number: "singular" } },
};

const GERMAN_PRONOUNS: Readonly<Record<string, Record<string, string>>> = {
  ich: { person: "1", number: "singular", case: "nominative" },
  mich: { person: "1", number: "singular", case: "accusative" },
  mir: { person: "1", number: "singular", case: "dative" },
  du: { person: "2", number: "singular", case: "nominative" },
  dich: { person: "2", number: "singular", case: "accusative" },
  dir: { person: "2", number: "singular", case: "dative" },
  er: { person: "3", number: "singular", gender: "masculine", case: "nominative" },
  ihn: { person: "3", number: "singular", gender: "masculine", case: "accusative" },
  ihm: { person: "3", number: "singular", gender: "masculine|neuter", case: "dative" },
  sie: { person: "3", number: "singular|plural", case: "nominative|accusative" },
  es: { person: "3", number: "singular", gender: "neuter", case: "nominative|accusative" },
  wir: { person: "1", number: "plural", case: "nominative" },
  uns: { person: "1", number: "plural", case: "accusative|dative" },
  ihr: { person: "2", number: "plural", case: "nominative" },
  euch: { person: "2", number: "plural", case: "accusative|dative" },
  ihnen: { person: "3", number: "plural", case: "dative" },
};

const GERMAN_PREPOSITIONS: Readonly<Record<string, string>> = {
  mit: "dative",
  von: "dative",
  zu: "dative",
  bei: "dative",
  nach: "dative",
  aus: "dative",
  seit: "dative",
  für: "accusative",
  durch: "accusative",
  gegen: "accusative",
  ohne: "accusative",
  um: "accusative",
  wegen: "genitive",
  trotz: "genitive",
  während: "genitive",
  in: "dative|accusative",
  an: "dative|accusative",
  auf: "dative|accusative",
};

function resolveSeparablePrefixedVerb(
  norm: string,
  lang: GermanicLang,
): { lemma: string; prefix: string; baseVerb: string; features: Record<string, string>; confidence: number } | null {
  const verbs = lang === "de" ? GERMAN_VERBS : DUTCH_VERBS;
  const prefixes = lang === "de" ? GERMAN_SEPARABLE_PREFIXES : DUTCH_SEPARABLE_PREFIXES;
  for (const prefix of prefixes) {
    if (!norm.startsWith(prefix)) continue;
    const remainder = norm.slice(prefix.length);
    if (remainder.length < 3) continue;
    const direct = verbs.get(remainder);
    if (direct) {
      return {
        lemma: `${prefix}${direct.lemma}`,
        prefix,
        baseVerb: direct.lemma,
        features: { ...direct.features, separablePrefix: prefix, baseVerb: direct.lemma },
        confidence: 0.9,
      };
    }
    // German participle with -ge- infix: aufgestanden -> auf + ge + standen -> aufstehen
    if (lang === "de" && remainder.startsWith("ge")) {
      const partCandidate = verbs.get(remainder);
      if (partCandidate) {
        return {
          lemma: `${prefix}${partCandidate.lemma}`,
          prefix,
          baseVerb: partCandidate.lemma,
          features: { ...partCandidate.features, separablePrefix: prefix, baseVerb: partCandidate.lemma },
          confidence: 0.9,
        };
      }
      const unGe = remainder.slice(2);
      if (unGe.endsWith("t") && unGe.length >= 4) {
        const weakInf = `${unGe.slice(0, -1)}en`;
        return {
          lemma: `${prefix}${weakInf}`,
          prefix,
          baseVerb: weakInf,
          features: { verbForm: "participle", separablePrefix: prefix, baseVerb: weakInf },
          confidence: 0.78,
        };
      }
    }
  }
  return null;
}

function resolveRegularGermanicVerb(
  norm: string,
  lang: GermanicLang,
  isCapitalized: boolean,
): { lemma: string; features: Record<string, string>; confidence: number } | null {
  if (lang === "de" && isCapitalized) return null; // German nouns are capitalized
  if (lang === "de") {
    if (norm.startsWith("ge") && norm.endsWith("t") && norm.length >= 6) {
      const stem = norm.slice(2, -1);
      return { lemma: `${stem}en`, features: { verbForm: "participle" }, confidence: 0.76 };
    }
    if (norm.endsWith("en") && norm.length >= 4) {
      return { lemma: norm, features: { verbForm: "infinitive" }, confidence: 0.78 };
    }
    if (norm.endsWith("te") && norm.length >= 5) {
      return { lemma: `${norm.slice(0, -2)}en`, features: { tense: "past", person: "1|3", number: "singular" }, confidence: 0.76 };
    }
    if (norm.endsWith("ten") && norm.length >= 6) {
      return { lemma: `${norm.slice(0, -3)}en`, features: { tense: "past", person: "1|3", number: "plural" }, confidence: 0.76 };
    }
    if (norm.endsWith("st") && norm.length >= 5) {
      return { lemma: `${norm.slice(0, -2)}en`, features: { tense: "present", person: "2", number: "singular" }, confidence: 0.74 };
    }
  } else {
    if (norm.endsWith("en") && norm.length >= 4) {
      return { lemma: norm, features: { verbForm: "infinitive" }, confidence: 0.76 };
    }
    if (norm.endsWith("de") && norm.length >= 5) {
      return { lemma: `${norm.slice(0, -2)}en`, features: { tense: "past", number: "singular" }, confidence: 0.74 };
    }
  }
  return null;
}

export const germanicAdapter = createSimpleAdapter({
  id: GERMANIC_ADAPTER_ID,
  version: GERMANIC_ADAPTER_VERSION,
  supportedLanguageTags: ["de", "nl"],
  capabilities: createCapabilityDeclarations({
    sentenceSegment: 0.96,
    tokenize: 0.96,
    normalize: 0.98,
    lemma: 0.85,
    pos: 0.82,
    morphology: 0.82,
    script: 0.99,
  }),
  privacyDisclosure:
    "Runs locally on this device using German/Dutch strong verb paradigms, compound splitting, and umlaut/ß normalization. No text leaves the device.",
  async analyze(request, languageTag, manifest, signal) {
    const lang = (baseLanguageCode(languageTag) as GermanicLang) || "de";
    const verbs = lang === "de" ? GERMAN_VERBS : DUTCH_VERBS;
    const determiners = lang === "de" ? GERMAN_DETERMINERS : DUTCH_DETERMINERS;
    const sentenceParts = segmentSentencesMultilingual(request.text, String(languageTag));
    const segments = wordSegments(request.text, String(languageTag));

    interface PendingToken extends RawTokenInput {
      sentenceIndex: number;
      features: Record<string, string>;
      isCapitalized: boolean;
    }

    const pending: PendingToken[] = [];
    let prevDeterminerCue: DeterminerCue | null = null;
    let prevPrepositionCase: string | null = null;

    for (const part of segments) {
      throwIfAborted(signal, GERMANIC_ADAPTER_ID);
      const kind = tokenKind(part.segment, part.isWordLike);
      const normalized = normalizeGermanicLookup(part.segment, lang);
      const sentenceIndex = sentenceParts.findIndex((s) => part.start >= s.start && part.end <= s.end);
      const features: Record<string, string> = {};
      const asciiFolded = foldGermanicUmlautsAscii(part.segment);
      if (asciiFolded !== normalized) features.asciiFolded = asciiFolded;

      if (kind !== "word") {
        pending.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          confidenceScore: 0.98,
          sentenceIndex,
          features,
          isCapitalized: false,
        });
        if (kind === "punctuation") {
          prevDeterminerCue = null;
          prevPrepositionCase = null;
        }
        continue;
      }

      const isCapitalized = /^\p{Lu}/u.test(part.segment);
      const pack = await resolvePackEntry(part.segment, normalized, String(languageTag));
      if (pack && (pack.lemma || pack.pos || pack.compoundParts)) {
        Object.assign(features, pack.morphology ?? {});
        if (pack.compoundParts?.length) {
          features.compoundParts = pack.compoundParts.join("+");
        }
        pending.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: pack.lemma ?? normalized,
          pos: pack.pos,
          morphology: Object.keys(features).length > 0 ? { features } : undefined,
          confidenceScore: pack.confidence ?? 0.95,
          sentenceIndex,
          features,
          isCapitalized,
        });
        prevDeterminerCue = null;
        continue;
      }

      if (determiners[normalized]) {
        const cue = determiners[normalized];
        Object.assign(features, cue.features);
        if (prevPrepositionCase) {
          const prepCases = new Set(prevPrepositionCase.split("|"));
          const detCases = (cue.features.case ?? "").split("|").filter((c) => prepCases.has(c));
          if (detCases.length > 0) {
            features.case = detCases.join("|");
          } else if (!prevPrepositionCase.includes("|")) {
            features.case = prevPrepositionCase;
          }
        }
        prevDeterminerCue = { pos: cue.pos, features: { ...features } };
        pending.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: normalized,
          pos: cue.pos,
          morphology: { features },
          confidenceScore: 0.94,
          sentenceIndex,
          features,
          isCapitalized,
        });
        continue;
      }

      if (lang === "de" && GERMAN_PRONOUNS[normalized]) {
        Object.assign(features, GERMAN_PRONOUNS[normalized]);
        prevDeterminerCue = null;
        pending.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: normalized,
          pos: "pronoun",
          morphology: { features },
          confidenceScore: 0.94,
          sentenceIndex,
          features,
          isCapitalized,
        });
        continue;
      }

      if (lang === "de" && GERMAN_PREPOSITIONS[normalized]) {
        features.governsCase = GERMAN_PREPOSITIONS[normalized];
        prevPrepositionCase = GERMAN_PREPOSITIONS[normalized];
        prevDeterminerCue = null;
        pending.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: normalized,
          pos: "preposition",
          morphology: { features },
          confidenceScore: 0.92,
          sentenceIndex,
          features,
          isCapitalized,
        });
        continue;
      }

      const verbMatch = verbs.get(normalized);
      if (verbMatch && !(lang === "de" && isCapitalized && part.start > (sentenceParts[sentenceIndex]?.start ?? 0))) {
        Object.assign(features, verbMatch.features);
        prevDeterminerCue = null;
        prevPrepositionCase = null;
        pending.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: verbMatch.lemma,
          pos: "verb",
          morphology: { features },
          confidenceScore: 0.94,
          sentenceIndex,
          features,
          isCapitalized,
        });
        continue;
      }

      const sepVerb = resolveSeparablePrefixedVerb(normalized, lang);
      if (sepVerb) {
        Object.assign(features, sepVerb.features);
        prevDeterminerCue = null;
        prevPrepositionCase = null;
        pending.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: sepVerb.lemma,
          pos: "verb",
          morphology: { features },
          confidenceScore: sepVerb.confidence,
          sentenceIndex,
          features,
          isCapitalized,
        });
        continue;
      }

      const compoundParts = splitCompoundGermanic(part.segment, lang);
      if (compoundParts) {
        features.compoundParts = compoundParts.join("+");
        features.compoundHead = compoundParts[compoundParts.length - 1];
        if (prevDeterminerCue) {
          for (const key of ["case", "gender", "number"] as const) {
            if (prevDeterminerCue.features[key]) features[key] = prevDeterminerCue.features[key];
          }
        } else if (prevPrepositionCase) {
          features.case = prevPrepositionCase;
        }
        prevDeterminerCue = null;
        prevPrepositionCase = null;
        pending.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: isCapitalized ? part.segment.normalize("NFC") : normalized,
          pos: "noun",
          morphology: { features },
          confidenceScore: 0.88,
          sentenceIndex,
          features,
          isCapitalized,
        });
        continue;
      }

      const regularVerb = resolveRegularGermanicVerb(normalized, lang, isCapitalized);
      if (regularVerb) {
        Object.assign(features, regularVerb.features);
        prevDeterminerCue = null;
        prevPrepositionCase = null;
        pending.push({
          start: part.start,
          end: part.end,
          surface: part.segment,
          kind,
          normalized,
          lemma: regularVerb.lemma,
          pos: "verb",
          morphology: { features, isPartial: true },
          confidenceScore: regularVerb.confidence,
          sentenceIndex,
          features,
          isCapitalized,
        });
        continue;
      }

      // Noun / other word fallback with determiner/case cue propagation
      let inferredPos = lang === "de" && isCapitalized ? "noun" : "other";
      let inferredLemma = normalized;
      if (prevDeterminerCue) {
        inferredPos = "noun";
        for (const key of ["case", "gender", "number"] as const) {
          if (prevDeterminerCue.features[key]) features[key] = prevDeterminerCue.features[key];
        }
      } else if (prevPrepositionCase) {
        features.case = prevPrepositionCase;
      }
      if (inferredPos === "noun" && lang === "de") {
        const stem = GERMAN_STEMS.get(normalized) ?? GERMAN_STEMS.get(stripUmlautForStem(normalized));
        if (stem) inferredLemma = stem;
        else if (isCapitalized) inferredLemma = part.segment.normalize("NFC");
      }
      prevDeterminerCue = null;
      prevPrepositionCase = null;

      pending.push({
        start: part.start,
        end: part.end,
        surface: part.segment,
        kind,
        normalized,
        lemma: inferredLemma,
        pos: inferredPos,
        morphology: Object.keys(features).length > 0 ? { features } : undefined,
        confidenceScore: inferredPos === "noun" ? 0.82 : 0.74,
        sentenceIndex,
        features,
        isCapitalized,
      });
    }

    // Sentence-level separable-prefix verb linking (e.g., "Ich stehe früh auf.")
    const prefixes = new Set<string>(lang === "de" ? GERMAN_SEPARABLE_PREFIXES : DUTCH_SEPARABLE_PREFIXES);
    const clauseBreakers = new Set<string>(
      lang === "de"
        ? ["und", "aber", "oder", "denn", "sondern", "weil", "dass", "ob", "wenn"]
        : ["en", "maar", "of", "want", "omdat", "dat", "als", "toen"],
    );
    for (let i = 0; i < pending.length; i += 1) {
      const verbToken = pending[i];
      if (verbToken.pos !== "verb" || verbToken.features.separablePrefix || !verbToken.lemma) continue;
      for (let j = i + 1; j < pending.length; j += 1) {
        const candidate = pending[j];
        if (candidate.sentenceIndex !== verbToken.sentenceIndex) break;
        if (candidate.kind === "punctuation" && /[,;:.!?]/u.test(candidate.surface)) break;
        if (candidate.kind === "word" && (clauseBreakers.has(candidate.normalized) || candidate.pos === "verb")) break;
        if (candidate.kind === "word" && prefixes.has(candidate.normalized)) {
          // Only attach if candidate is at the end of the clause (next token is punctuation, end, or clause breaker)
          const next = pending[j + 1];
          const atClauseEnd =
            !next ||
            next.sentenceIndex !== verbToken.sentenceIndex ||
            next.kind === "punctuation" ||
            clauseBreakers.has(next.normalized);
          if (!atClauseEnd) continue;
          const combinedLemma = `${candidate.normalized}${verbToken.lemma}`;
          verbToken.features.separablePrefix = candidate.normalized;
          verbToken.features.baseLemma = verbToken.lemma;
          verbToken.features.separableLemma = combinedLemma;
          verbToken.lemma = combinedLemma;
          verbToken.morphology = { features: verbToken.features };

          candidate.pos = "particle";
          candidate.features.separablePrefix = candidate.normalized;
          candidate.features.separableLemma = combinedLemma;
          candidate.morphology = { features: candidate.features };
          break;
        }
      }
    }

    return buildChunkFromAnalysis({
      adapterId: GERMANIC_ADAPTER_ID,
      adapterVersion: GERMANIC_ADAPTER_VERSION,
      manifest,
      request,
      languageTag,
      sentenceParts,
      rawTokens: pending,
    });
  },
});
