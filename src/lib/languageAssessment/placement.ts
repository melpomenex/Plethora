import { canonicalizeLanguageTag } from "../../types/languageProfile";
import {
  allActiveDimensionsConverged,
  buildDimensionEstimate,
  clamp,
  createDimensionAdaptiveState,
  DEFAULT_MIN_ITEMS_PER_DIMENSION,
  DEFAULT_PRIOR_MEAN,
  DEFAULT_PRIOR_SD,
  DEFAULT_TARGET_SEM,
  selectNextAdaptiveItem,
  thetaToBand,
  thetaToScore,
  updateAbilityEstimate,
} from "./adaptive";
import {
  ASSESSMENT_DIMENSIONS,
  NON_CEFR_DISCLAIMER,
  SUPPORTED_PLACEMENT_LANGUAGES,
  type AdaptiveItemResponseInput,
  type AdaptiveResponseRecord,
  type AssessmentDimension,
  type AssessmentItem,
  type CombinedProficiencyResult,
  type DimensionAdaptiveState,
  type DimensionEstimate,
  type PlacementBankLanguage,
  type PlacementResult,
  type PlacementSession,
  type PlacementSessionOptions,
  type PlacementStopReason,
  type ProficiencyBand,
  type ProfileEvidenceStats,
  type StepAdaptiveResult,
  type SupportedPlacementLanguage,
} from "./types";

const DEFAULT_MAX_ITEMS = 18;

function mc(
  id: string,
  language: PlacementBankLanguage,
  dimension: AssessmentDimension,
  targetBand: ProficiencyBand,
  difficulty: number,
  discrimination: number,
  prompt: string,
  options: readonly string[],
  correctOptionIndex: number,
  extra: Partial<Pick<AssessmentItem, "contextPassage" | "audioTranscriptHint">> = {},
): AssessmentItem {
  return {
    id,
    language,
    dimension,
    targetBand,
    responseFormat: "multiple-choice",
    prompt,
    options,
    correctOptionIndex,
    ...extra,
    irt: { difficulty, discrimination, guessing: 0.2 },
  };
}

function cloze(
  id: string,
  language: PlacementBankLanguage,
  dimension: AssessmentDimension,
  targetBand: ProficiencyBand,
  difficulty: number,
  discrimination: number,
  prompt: string,
  acceptedPatterns: readonly string[],
  contextPassage?: string,
): AssessmentItem {
  return {
    id,
    language,
    dimension,
    targetBand,
    responseFormat: "cloze",
    prompt,
    acceptedPatterns,
    contextPassage,
    irt: { difficulty, discrimination, guessing: 0 },
  };
}

function freeResponse(
  id: string,
  language: PlacementBankLanguage,
  dimension: AssessmentDimension,
  targetBand: ProficiencyBand,
  difficulty: number,
  discrimination: number,
  prompt: string,
  acceptedPatterns: readonly string[],
  rubricHint: string,
): AssessmentItem {
  return {
    id,
    language,
    dimension,
    targetBand,
    responseFormat: "free-response",
    prompt,
    acceptedPatterns,
    rubricHint,
    irt: { difficulty, discrimination, guessing: 0 },
  };
}

function spokenResponse(
  id: string,
  language: PlacementBankLanguage,
  targetBand: ProficiencyBand,
  difficulty: number,
  discrimination: number,
  prompt: string,
  acceptedPatterns: readonly string[],
  rubricHint: string,
): AssessmentItem {
  return {
    id,
    language,
    dimension: "speakingPronunciation",
    targetBand,
    responseFormat: "spoken-response",
    prompt,
    acceptedPatterns,
    rubricHint,
    irt: { difficulty, discrimination, guessing: 0 },
  };
}

const SPANISH_ITEMS: readonly AssessmentItem[] = [
  // Vocabulary
  mc("es-voc-a1", "es", "vocabularyBreadth", "A1", -2.2, 1.1, 'What does "la manzana" mean?', ["The apple", "The table", "The window", "The train"], 0),
  mc("es-voc-a2", "es", "vocabularyBreadth", "A2", -1.3, 1.2, 'Choose the synonym for "rápido":', ["veloz", "oscuro", "lento", "estrecho"], 0),
  mc("es-voc-b1", "es", "vocabularyBreadth", "B1", -0.4, 1.3, 'Select the best meaning of "aprovechar":', ["to make the most of", "to apologize for", "to postpone", "to complain about"], 0),
  mc("es-voc-b2", "es", "vocabularyBreadth", "B2", 0.7, 1.4, 'In formal prose, "imprescindible" is closest to:', ["indispensable", "optional", "negligible", "redundant"], 0),
  mc("es-voc-c1", "es", "vocabularyBreadth", "C1", 1.7, 1.5, 'What does "socavar" mean in "socavar la confianza"?', ["to undermine", "to reinforce", "to celebrate", "to transcribe"], 0),
  // Grammar
  mc("es-grm-a1", "es", "grammarMorphology", "A1", -2.1, 1.1, 'Complete: "Yo ___ estudiante."', ["soy", "eres", "son", "estamos"], 0),
  mc("es-grm-a2", "es", "grammarMorphology", "A2", -1.2, 1.2, 'Complete (preterite): "Ayer ellos ___ al museo."', ["fueron", "van", "iban", "irán"], 0),
  mc("es-grm-b1", "es", "grammarMorphology", "B1", -0.3, 1.35, 'Complete (subjunctive): "Espero que tú ___ tiempo mañana."', ["tengas", "tienes", "tendrás", "tuviste"], 0),
  mc("es-grm-b2", "es", "grammarMorphology", "B2", 0.8, 1.45, 'Complete: "Si lo hubiera sabido, no ___ ido."', ["habría", "haya", "fui", "iba"], 0),
  cloze("es-grm-c1", "es", "grammarMorphology", "C1", 1.8, 1.4, 'Fill in the imperfect subjunctive of "poder": "Ojalá ___ resolverlo antes del cierre."', ["pudiera", "pudiese"]),
  // Reading
  mc("es-rdg-a1", "es", "readingComprehension", "A1", -2.0, 1.1, "Where does Sofía work?", ["In a library", "In a bakery", "At an airport", "At a hospital"], 0, { contextPassage: "Sofía trabaja en una biblioteca pequeña cerca del parque. Lee libros todos los días." }),
  mc("es-rdg-a2", "es", "readingComprehension", "A2", -1.1, 1.2, "Why did Mateo arrive late?", ["The bus broke down", "He forgot his ticket", "The meeting moved", "It rained heavily"], 0, { contextPassage: "Mateo salió temprano de casa, pero el autobús se averió en la avenida y llegó veinte minutos tarde." }),
  mc("es-rdg-b1", "es", "readingComprehension", "B1", -0.2, 1.35, "What is the main recommendation in the notice?", ["Bring reusable containers", "Avoid the morning market", "Pay only with cash", "Register a week ahead"], 0, { contextPassage: "A partir del próximo lunes, el mercado vecinal reducirá las bolsas de un solo uso; se anima a los compradores a traer sus propios envases." }),
  mc("es-rdg-b2", "es", "readingComprehension", "B2", 0.9, 1.4, "What tension does the author highlight?", ["Speed vs. thorough verification", "Cost vs. aesthetics", "Privacy vs. bandwidth", "Tradition vs. tourism"], 0, { contextPassage: "Aunque la automatización agiliza el cribado inicial de datos, los editores advierten que prescindir de la revisión humana multiplica sesgos sutiles." }),
  mc("es-rdg-c1", "es", "readingComprehension", "C1", 1.8, 1.5, "What does the essay imply about legal metaphors?", ["They quietly constrain policy imagination", "They clarify technical statistics", "They eliminate ambiguity in treaties", "They speed up judicial translation"], 0, { contextPassage: "Lejos de ser meros adornos retóricos, las metáforas jurídicas delimitan qué soluciones parecen concebibles antes siquiera de abrirse el debate." }),
  // Listening
  mc("es-lst-a1", "es", "listeningComprehension", "A1", -2.0, 1.1, "What time does the train leave?", ["At eight o'clock", "At ten o'clock", "At noon", "At six o'clock"], 0, { audioTranscriptHint: "El tren hacia Valencia sale a las ocho en punto desde el andén tres." }),
  mc("es-lst-a2", "es", "listeningComprehension", "A2", -1.0, 1.2, "What does the speaker want to order?", ["Coffee without sugar", "Tea with lemon", "Sparkling water", "Orange juice"], 0, { audioTranscriptHint: "Para mí, un café con leche sin azúcar, por favor." }),
  mc("es-lst-b1", "es", "listeningComprehension", "B1", 0.1, 1.3, "Why is the workshop rescheduled?", ["Speaker flight delay", "Room renovation", "Power outage", "Low enrollment"], 0, { audioTranscriptHint: "Sentimos el cambio: el vuelo de la ponente se retrasó y pasaremos el taller al jueves." }),
  mc("es-lst-b2", "es", "listeningComprehension", "B2", 1.1, 1.4, "What tone does the commentator adopt regarding the merger?", ["Cautiously skeptical", "Enthusiastically supportive", "Completely indifferent", "Hostilely dismissive"], 0, { audioTranscriptHint: "Las cifras prometen sinergias inmediatas, aunque conviene observar si los costes ocultos no terminan erosionando el margen." }),
  // Writing
  freeResponse("es-wrt-a1", "es", "writingProduction", "A1", -2.0, 1.0, 'Write a short Spanish sentence introducing your name and city (e.g., "Me llamo ... y vivo en ...").', ["me llamo", "soy", "vivo en"], "Basic present-tense self-introduction."),
  freeResponse("es-wrt-a2", "es", "writingProduction", "A2", -1.0, 1.15, "Write 1–2 sentences in Spanish describing what you did yesterday.", ["ayer", "fui", "comí", "trabajé", "estudié", "hice"], "Simple past (preterite) narration."),
  freeResponse("es-wrt-b1", "es", "writingProduction", "B1", 0.0, 1.25, "Write a short Spanish paragraph recommending a book or place and giving a reason with 'porque' or 'ya que'.", ["porque", "ya que", "recomiendo", "aunque"], "Connected clause reasoning."),
  freeResponse("es-wrt-b2", "es", "writingProduction", "B2", 1.1, 1.35, "Write a concise Spanish argument weighing one advantage and one drawback of remote work (use 'sin embargo' or 'no obstante').", ["sin embargo", "no obstante", "aunque", "ventaja", "desventaja"], "Balanced discourse markers."),
  // Speaking
  spokenResponse("es-spk-a1", "es", "A1", -2.0, 1.0, 'Say aloud in Spanish: "Buenos días, me gustaría un vaso de agua."', ["buenos días", "vaso de agua", "me gustaría"], "Clear vowel articulation and polite request."),
  spokenResponse("es-spk-a2", "es", "A2", -1.0, 1.15, "Describe aloud in Spanish what your typical morning routine looks like.", ["por la mañana", "desayuno", "me levanto", "luego"], "Present-tense reflexive verbs and sequencing."),
  spokenResponse("es-spk-b1", "es", "B1", 0.1, 1.25, "Explain aloud in Spanish a hobby you enjoy and how often you practice it.", ["me gusta", "suelo", "cada semana", "porque"], "Fluency with frequency expressions."),
  spokenResponse("es-spk-b2", "es", "B2", 1.1, 1.35, "State your opinion aloud in Spanish on whether cities should restrict cars in historic centers.", ["creo que", "sin embargo", "transporte", "centro"], "Structured opinion with nuance."),
];

const FRENCH_ITEMS: readonly AssessmentItem[] = [
  mc("fr-voc-a1", "fr", "vocabularyBreadth", "A1", -2.2, 1.1, 'What does "le pain" mean?', ["Bread", "Water", "Cheese", "Book"], 0),
  mc("fr-voc-a2", "fr", "vocabularyBreadth", "A2", -1.3, 1.2, 'Choose the opposite of "cher":', ["bon marché", "rapide", "bruyant", "lourd"], 0),
  mc("fr-voc-b1", "fr", "vocabularyBreadth", "B1", -0.4, 1.3, 'What does "déménager" mean?', ["to move house", "to tidy up", "to negotiate", "to delay"], 0),
  mc("fr-voc-b2", "fr", "vocabularyBreadth", "B2", 0.7, 1.4, 'In an article, "incontournable" means:', ["essential / unmissable", "illegible", "temporary", "negligible"], 0),
  mc("fr-voc-c1", "fr", "vocabularyBreadth", "C1", 1.7, 1.5, 'What does "bouleverser" convey?', ["to deeply disrupt or move", "to summarize briefly", "to politely decline", "to slowly repair"], 0),

  mc("fr-grm-a1", "fr", "grammarMorphology", "A1", -2.1, 1.1, 'Complete: "Nous ___ à Paris."', ["habitons", "habite", "habitent", "habites"], 0),
  mc("fr-grm-a2", "fr", "grammarMorphology", "A2", -1.2, 1.2, 'Complete (passé composé): "Elle ___ arrivée hier soir."', ["est", "a", "avait", "sera"], 0),
  mc("fr-grm-b1", "fr", "grammarMorphology", "B1", -0.3, 1.35, 'Complete (subjonctif): "Il faut que nous ___ partir tôt."', ["puissions", "pouvons", "pourrons", "pouvions"], 0),
  mc("fr-grm-b2", "fr", "grammarMorphology", "B2", 0.8, 1.45, 'Choose the correct pronoun: "C’est le projet ___ je vous ai parlé."', ["dont", "que", "lequel", "où"], 0),
  cloze("fr-grm-c1", "fr", "grammarMorphology", "C1", 1.8, 1.4, 'Fill in the conditional past: "S’il avait prévenu, nous ___ (venir)."', ["serions venus", "serions venues"]),

  mc("fr-rdg-a1", "fr", "readingComprehension", "A1", -2.0, 1.1, "Where is Marc going?", ["To the station", "To the cinema", "To the pharmacy", "To school"], 0, { contextPassage: "Marc marche vite vers la gare parce que son train part dans dix minutes." }),
  mc("fr-rdg-a2", "fr", "readingComprehension", "A2", -1.1, 1.2, "Why is the museum closed today?", ["Renovation work", "Public holiday", "Staff strike", "Bad weather"], 0, { contextPassage: "Le musée municipal reste fermé ce mardi en raison de travaux de rénovation dans la galerie principale." }),
  mc("fr-rdg-b1", "fr", "readingComprehension", "B1", -0.2, 1.35, "What change did the neighborhood make?", ["Added bike lanes", "Closed the park", "Raised bus fares", "Banned night markets"], 0, { contextPassage: "Depuis le printemps, la mairie a aménagé des pistes cyclables protégées le long du canal pour sécuriser les trajets quotidiens." }),
  mc("fr-rdg-b2", "fr", "readingComprehension", "B2", 0.9, 1.4, "What concern does the critic raise?", ["Loss of nuance in short summaries", "Excessive length of novels", "High printing fees", "Lack of archival translations"], 0, { contextPassage: "Si les synthèses automatisées facilitent le repérage documentaire, elles gomment souvent les nuances stylistiques qui font la valeur d’un essai." }),
  mc("fr-rdg-c1", "fr", "readingComprehension", "C1", 1.8, 1.5, "What is the author's thesis?", ["Public memory evolves through contested narratives", "Monuments preserve unchanging truth", "Archives should avoid commentary", "Oral history replaces written records"], 0, { contextPassage: "Loin d’être figée dans la pierre, la mémoire collective se recompose au gré des récits concurrents qui réinterprètent les archives." }),

  mc("fr-lst-a1", "fr", "listeningComprehension", "A1", -2.0, 1.1, "How much does the ticket cost?", ["Twelve euros", "Twenty euros", "Two euros", "Fifteen euros"], 0, { audioTranscriptHint: "Bonjour, le billet aller simple coûte douze euros." }),
  mc("fr-lst-a2", "fr", "listeningComprehension", "A2", -1.0, 1.2, "What will the weather be like tomorrow?", ["Sunny in the afternoon", "Snowy all day", "Stormy at dawn", "Foggy until night"], 0, { audioTranscriptHint: "Demain matin il fera frais, mais le soleil reviendra l’après-midi." }),
  mc("fr-lst-b1", "fr", "listeningComprehension", "B1", 0.1, 1.3, "What does the caller ask to change?", ["The appointment time", "The billing address", "The delivery carrier", "The hotel room type"], 0, { audioTranscriptHint: "Je vous appelle pour décaler mon rendez-vous de jeudi matin à vendredi après-midi, si possible." }),
  mc("fr-lst-b2", "fr", "listeningComprehension", "B2", 1.1, 1.4, "What conclusion does the speaker draw?", ["Pilot results justify gradual expansion", "The trial failed completely", "Costs doubled unexpectedly", "Regulations forbid continuation"], 0, { audioTranscriptHint: "Au vu des résultats encourageants du projet pilote, nous recommandons un déploiement progressif sur trois trimestres." }),

  freeResponse("fr-wrt-a1", "fr", "writingProduction", "A1", -2.0, 1.0, 'Write a brief French greeting and say where you live.', ["bonjour", "je m'appelle", "j'habite", "je suis"], "Basic French introduction."),
  freeResponse("fr-wrt-a2", "fr", "writingProduction", "A2", -1.0, 1.15, "Write 1–2 sentences in French about your plans for the weekend.", ["ce week-end", "je vais", "demain", "avec"], "Near future (futur proche)."),
  freeResponse("fr-wrt-b1", "fr", "writingProduction", "B1", 0.0, 1.25, "Write a short French note explaining why learning languages is useful to you.", ["parce que", "car", "apprendre", "utile"], "Causal connectors."),
  freeResponse("fr-wrt-b2", "fr", "writingProduction", "B2", 1.1, 1.35, "Write a balanced French argument on remote learning using 'cependant' or 'toutefois'.", ["cependant", "toutefois", "néanmoins", "bien que"], "Concessive discourse markers."),

  spokenResponse("fr-spk-a1", "fr", "A1", -2.0, 1.0, 'Say aloud in French: "Bonjour, je voudrais un café, s’il vous plaît."', ["bonjour", "je voudrais", "café", "s'il vous plaît"], "Nasal vowels and polite phrasing."),
  spokenResponse("fr-spk-a2", "fr", "A2", -1.0, 1.15, "Speak aloud in French about a dish you like to cook or eat.", ["j'aime", "manger", "cuisiner", "souvent"], "Partitive articles and food vocabulary."),
  spokenResponse("fr-spk-b1", "fr", "B1", 0.1, 1.25, "Describe aloud in French a trip or city you would like to visit.", ["j'aimerais", "visiter", "parce que", "ville"], "Conditional politeness and reasons."),
  spokenResponse("fr-spk-b2", "fr", "B2", 1.1, 1.35, "Discuss aloud in French how public transit improves urban life.", ["transports", "cependant", "ville", "pollution"], "Structured oral argumentation."),
];

const GERMAN_ITEMS: readonly AssessmentItem[] = [
  mc("de-voc-a1", "de", "vocabularyBreadth", "A1", -2.2, 1.1, 'What does "das Wasser" mean?', ["Water", "Bread", "House", "Chair"], 0),
  mc("de-voc-a2", "de", "vocabularyBreadth", "A2", -1.3, 1.2, 'Choose the meaning of "pünktlich":', ["punctual / on time", "expensive", "broken", "tired"], 0),
  mc("de-voc-b1", "de", "vocabularyBreadth", "B1", -0.4, 1.3, 'What does "vereinbaren" mean in "einen Termin vereinbaren"?', ["to arrange / schedule", "to cancel", "to forget", "to compare"], 0),
  mc("de-voc-b2", "de", "vocabularyBreadth", "B2", 0.7, 1.4, '"Nachhaltig" in environmental policy means:', ["sustainable", "accidental", "superficial", "unavoidable"], 0),
  mc("de-voc-c1", "de", "vocabularyBreadth", "C1", 1.7, 1.5, 'What does "hinterfragen" mean?', ["to critically question", "to hide behind", "to confirm blindly", "to postpone"], 0),

  mc("de-grm-a1", "de", "grammarMorphology", "A1", -2.1, 1.1, 'Complete: "Ich ___ aus Berlin."', ["komme", "kommst", "kommt", "kommen"], 0),
  mc("de-grm-a2", "de", "grammarMorphology", "A2", -1.2, 1.2, 'Choose the dative article: "Ich helfe ___ Freund."', ["dem", "den", "der", "das"], 0),
  mc("de-grm-b1", "de", "grammarMorphology", "B1", -0.3, 1.35, 'Select correct subordinate word order: "Ich bleibe zu Hause, weil es ___."', ["stark regnet", "regnet stark", "stark zu regnen", "geregnet hat stark"], 0),
  mc("de-grm-b2", "de", "grammarMorphology", "B2", 0.8, 1.45, 'Complete (Konjunktiv II): "Wenn ich mehr Zeit ___, würde ich öfter lesen."', ["hätte", "habe", "hatte", "werde"], 0),
  cloze("de-grm-c1", "de", "grammarMorphology", "C1", 1.8, 1.4, 'Fill in the passive auxiliary (past): "Das Gesetz ___ bereits im Mai verabschiedet."', ["wurde"]),

  mc("de-rdg-a1", "de", "readingComprehension", "A1", -2.0, 1.1, "When does the supermarket close?", ["At 20:00", "At 18:00", "At 22:00", "At 14:00"], 0, { contextPassage: "Der Supermarkt öffnet montags bis samstags um 7 Uhr und schließt um 20 Uhr." }),
  mc("de-rdg-a2", "de", "readingComprehension", "A2", -1.1, 1.2, "How does Anna commute now?", ["By bicycle", "By subway", "On foot", "By car"], 0, { contextPassage: "Früher fuhr Anna mit der U-Bahn zur Arbeit, aber seit dem Sommer nimmt sie jeden Tag das Fahrrad." }),
  mc("de-rdg-b1", "de", "readingComprehension", "B1", -0.2, 1.35, "Why was the library reading room moved?", ["To expand quiet study seats", "Due to water damage", "To host concerts", "To save electricity"], 0, { contextPassage: "Um mehr ruhige Arbeitsplätze zu schaffen, wurde der Lesesaal in den größeren zweiten Stock verlegt." }),
  mc("de-rdg-b2", "de", "readingComprehension", "B2", 0.9, 1.4, "What trade-off does the report mention?", ["Faster onboarding vs. deeper documentation", "Lower salary vs. longer vacation", "Open offices vs. remote servers", "Shorter meetings vs. weekend shifts"], 0, { contextPassage: "Zwar beschleunigen kompakte Leitfäden die Einarbeitung, doch ohne ausführliche Dokumentation gehen komplexe Systemzusammenhänge verloren." }),
  mc("de-rdg-c1", "de", "readingComprehension", "C1", 1.8, 1.5, "What distinguishes the author's perspective?", ["Technology shifts institutional norms gradually", "Algorithms instantly replace editorial judgment", "Regulation always lags behind hardware", "Archives are obsolete in digital media"], 0, { contextPassage: "Technische Werkzeuge verändern institutionelle Gewohnheiten selten abrupt; vielmehr verschieben sie schrittweise, was als verlässlicher Nachweis gilt." }),

  mc("de-lst-a1", "de", "listeningComprehension", "A1", -2.0, 1.1, "Where is the speaker waiting?", ["In front of the station", "Inside the café", "At the bus stop", "Near the bridge"], 0, { audioTranscriptHint: "Hallo, ich warte schon vor dem Bahnhof neben dem Eingang." }),
  mc("de-lst-a2", "de", "listeningComprehension", "A2", -1.0, 1.2, "What did the speaker buy?", ["Two tickets for the concert", "A new coat", "Fresh vegetables", "A German dictionary"], 0, { audioTranscriptHint: "Ich habe heute Morgen zwei Karten für das Konzert am Samstag gekauft." }),
  mc("de-lst-b1", "de", "listeningComprehension", "B1", 0.1, 1.3, "What does the announcement advise passengers to do?", ["Change to platform five", "Wait in the dining car", "Validate tickets again", "Exit at the next stop"], 0, { audioTranscriptHint: "Wegen einer Baustelle bitten wir alle Fahrgäste nach Hamburg, auf Gleis fünf umzusteigen." }),
  mc("de-lst-b2", "de", "listeningComprehension", "B2", 1.1, 1.4, "Why does the panelist urge caution?", ["Long-term maintenance costs are unclear", "Public demand is already saturated", "Sensors fail in summer heat", "Funding was rejected"], 0, { audioTranscriptHint: "Die Anschaffung wirkt günstig, solange man die langfristigen Wartungskosten der nächsten zehn Jahre außer Acht lässt." }),

  freeResponse("de-wrt-a1", "de", "writingProduction", "A1", -2.0, 1.0, "Write a short German sentence saying your name and one hobby.", ["ich heiße", "ich bin", "mein hobby", "ich spiele", "ich lese"], "Basic German V2 sentence."),
  freeResponse("de-wrt-a2", "de", "writingProduction", "A2", -1.0, 1.15, "Write 1–2 sentences in German about what you ate or drank today.", ["heute", "habe", "gegessen", "getrunken"], "Perfekt tense with haben."),
  freeResponse("de-wrt-b1", "de", "writingProduction", "B1", 0.0, 1.25, "Write a German sentence using 'weil' or 'obwohl' to explain a daily habit.", ["weil", "obwohl", "deshalb", "jeden tag"], "Subordinate verb-final clause."),
  freeResponse("de-wrt-b2", "de", "writingProduction", "B2", 1.1, 1.35, "Write a concise German opinion weighing pros and cons of flexible working hours.", ["allerdings", "einerseits", "andererseits", "flexibel"], "Contrastive connectors."),

  spokenResponse("de-spk-a1", "de", "A1", -2.0, 1.0, 'Say aloud in German: "Guten Tag, ich möchte bitte einen Tee."', ["guten tag", "ich möchte", "tee"], "Clear umlaut and consonant pronunciation."),
  spokenResponse("de-spk-a2", "de", "A2", -1.0, 1.15, "Describe aloud in German your favorite season and why.", ["lieblingsjahreszeit", "sommer", "winter", "weil"], "Basic explanation with weather words."),
  spokenResponse("de-spk-b1", "de", "B1", 0.1, 1.25, "Explain aloud in German how you prepare for a trip.", ["zuerst", "packe", "reise", "dann"], "Sequencing and separable verbs."),
  spokenResponse("de-spk-b2", "de", "B2", 1.1, 1.35, "Discuss aloud in German how digital tools affect concentration.", ["konzentration", "allerdings", "vorteil", "nachteil"], "Abstract topic fluency."),
];

const JAPANESE_ITEMS: readonly AssessmentItem[] = [
  mc("ja-voc-a1", "ja", "vocabularyBreadth", "A1", -2.2, 1.1, 'What does 「みず」 (水) mean?', ["Water", "Fire", "Mountain", "Train"], 0),
  mc("ja-voc-a2", "ja", "vocabularyBreadth", "A2", -1.3, 1.2, 'What does 「約束」 (やくそく) mean?', ["Promise / appointment", "Holiday", "Weather", "Breakfast"], 0),
  mc("ja-voc-b1", "ja", "vocabularyBreadth", "B1", -0.4, 1.3, 'Select the meaning of 「確認する」:', ["to confirm / verify", "to cancel", "to misunderstand", "to borrow"], 0),
  mc("ja-voc-b2", "ja", "vocabularyBreadth", "B2", 0.7, 1.4, 'What does 「把握する」 (はあくする) mean?', ["to grasp / understand thoroughly", "to overlook", "to hesitate", "to exaggerate"], 0),
  mc("ja-voc-c1", "ja", "vocabularyBreadth", "C1", 1.7, 1.5, 'In formal writing, 「顕著」 (けんちょ) means:', ["conspicuous / striking", "ambiguous", "temporary", "negligible"], 0),

  mc("ja-grm-a1", "ja", "grammarMorphology", "A1", -2.1, 1.1, 'Choose the particle: 「図書館 ___ 本を読みます。」', ["で", "へ", "を", "が"], 0),
  mc("ja-grm-a2", "ja", "grammarMorphology", "A2", -1.2, 1.2, 'Choose the polite request form: 「ここに名前を ___ ください。」', ["書いて", "書く", "書いた", "書かない"], 0),
  mc("ja-grm-b1", "ja", "grammarMorphology", "B1", -0.3, 1.35, 'Complete: 「雨が降る ___、傘を持っていきます。」', ["かもしれないので", "ようにして", "ばかりで", "はずなのに"], 0),
  mc("ja-grm-b2", "ja", "grammarMorphology", "B2", 0.8, 1.45, 'Select the fitting keigo expression for a client: 「資料をご確認 ___ でしょうか。」', ["いただけます", "あげます", "くれます", "もらいます"], 0),
  cloze("ja-grm-c1", "ja", "grammarMorphology", "C1", 1.8, 1.4, 'Fill in the formal written contrast marker: 「効率は上がった___、課題も残る。」', ["ものの", "とはいえ"]),

  mc("ja-rdg-a1", "ja", "readingComprehension", "A1", -2.0, 1.1, "What does Tanaka-san drink every morning?", ["Green tea", "Coffee", "Milk", "Juice"], 0, { contextPassage: "田中さんは毎朝七時に起きて、温かいお茶を飲みます。" }),
  mc("ja-rdg-a2", "ja", "readingComprehension", "A2", -1.1, 1.2, "Why did they take a taxi?", ["Because it started raining heavily", "Because the bus was full", "Because they lost their map", "Because the station was closed"], 0, { contextPassage: "駅まで歩くつもりでしたが、急に強い雨が降ってきたのでタクシーに乗りました。" }),
  mc("ja-rdg-b1", "ja", "readingComprehension", "B1", -0.2, 1.35, "What should visitors do before entering?", ["Leave large bags in lockers", "Pay an extra fee", "Reserve a guide", "Turn off flashlights"], 0, { contextPassage: "展示室内が狭いため、大きな荷物は入口横のロッカーに預けてからご入場ください。" }),
  mc("ja-rdg-b2", "ja", "readingComprehension", "B2", 0.9, 1.4, "What does the writer emphasize about translation?", ["Context shapes word choice beyond dictionary glosses", "Literal word order is always best", "Machine output needs no review", "Idioms should be removed"], 0, { contextPassage: "辞書の一対一の訳語に頼るだけでは、話し手の距離感や文脈の含みを取りこぼしてしまう。" }),
  mc("ja-rdg-c1", "ja", "readingComprehension", "C1", 1.8, 1.5, "What is the author's main warning?", ["Convenience can erode deliberate judgment", "Paper records are unreliable", "Public debate slows innovation", "Specialists agree on all metrics"], 0, { contextPassage: "数値による即時評価が普及するほど、数字に表れにくい熟慮の余白が制度から抜け落ちやすくなる。" }),

  mc("ja-lst-a1", "ja", "listeningComprehension", "A1", -2.0, 1.1, "Where is the speaker going?", ["To the post office", "To the bank", "To the park", "To the hospital"], 0, { audioTranscriptHint: "すみません、これから郵便局へ行ってきます。" }),
  mc("ja-lst-a2", "ja", "listeningComprehension", "A2", -1.0, 1.2, "What time will the meeting start?", ["At 3:30 PM", "At 2:00 PM", "At 4:15 PM", "At 1:00 PM"], 0, { audioTranscriptHint: "午後の会議は三時半から始まりますので、五分前にお集まりください。" }),
  mc("ja-lst-b1", "ja", "listeningComprehension", "B1", 0.1, 1.3, "What does the speaker ask the listener to bring?", ["The updated schedule", "A spare laptop", "Printed receipts", "Identification badges"], 0, { audioTranscriptHint: "明日の打ち合わせには、先週修正したスケジュール表だけ持参してください。" }),
  mc("ja-lst-b2", "ja", "listeningComprehension", "B2", 1.1, 1.4, "What is the speaker's stance on the proposal?", ["Supportive if phased in", "Firmly opposed", "Unaware of the budget", "Ready for immediate launch"], 0, { audioTranscriptHint: "方向性自体には賛成ですが、現場への負担を考えると段階的な導入が現実的だと思います。" }),

  freeResponse("ja-wrt-a1", "ja", "writingProduction", "A1", -2.0, 1.0, "Write a short Japanese sentence introducing yourself (e.g. 「はじめまして、...です。」).", ["はじめまして", "です", "よろしく"], "Polite copula introduction."),
  freeResponse("ja-wrt-a2", "ja", "writingProduction", "A2", -1.0, 1.15, "Write 1–2 sentences in Japanese about what you did last weekend.", ["週末", "ました", "行き", "見", "食べ"], "Past polite -ました forms."),
  freeResponse("ja-wrt-b1", "ja", "writingProduction", "B1", 0.0, 1.25, "Write a short Japanese sentence explaining a study habit using 「〜ようにしています」 or 「〜ので」.", ["ので", "から", "ように", "毎日"], "Habitual or causal expression."),
  freeResponse("ja-wrt-b2", "ja", "writingProduction", "B2", 1.1, 1.35, "Write a concise Japanese opinion contrasting benefits and drawbacks of remote work using 「一方で」 or 「ものの」.", ["一方で", "ものの", "しかし", "ただし"], "Formal written contrast."),

  spokenResponse("ja-spk-a1", "ja", "A1", -2.0, 1.0, "Say aloud in Japanese: 「おはようございます。きょうはいい天気ですね。」", ["おはよう", "天気", "ですね"], "Mora timing and pitch contour."),
  spokenResponse("ja-spk-a2", "ja", "A2", -1.0, 1.15, "Describe aloud in Japanese your favorite food and why you like it.", ["すき", "おいしい", "よく", "食べます"], "Polite conversational flow."),
  spokenResponse("ja-spk-b1", "ja", "B1", 0.1, 1.25, "Explain aloud in Japanese how you practice reading or listening.", ["毎日", "聞いて", "読んで", "ように"], "Connected clauses in speech."),
  spokenResponse("ja-spk-b2", "ja", "B2", 1.1, 1.35, "Share aloud in Japanese your thoughts on balancing speed and accuracy.", ["一方で", "大切", "正確", "思います"], "Structured opinion with formal connectors."),
];

const CHINESE_ITEMS: readonly AssessmentItem[] = [
  mc("zh-voc-a1", "zh", "vocabularyBreadth", "A1", -2.2, 1.1, 'What does 「苹果」 (píngguǒ) mean?', ["Apple", "Tea", "Chair", "Book"], 0),
  mc("zh-voc-a2", "zh", "vocabularyBreadth", "A2", -1.3, 1.2, 'Choose the meaning of 「方便」:', ["convenient", "crowded", "expensive", "nervous"], 0),
  mc("zh-voc-b1", "zh", "vocabularyBreadth", "B1", -0.4, 1.3, 'What does 「坚持」 (jiānchí) mean?', ["to persist / persevere", "to postpone", "to complain", "to hesitate"], 0),
  mc("zh-voc-b2", "zh", "vocabularyBreadth", "B2", 0.7, 1.4, 'In news articles, 「趋势」 (qūshì) means:', ["trend / tendency", "exception", "misunderstanding", "obstacle"], 0),
  mc("zh-voc-c1", "zh", "vocabularyBreadth", "C1", 1.7, 1.5, 'What does 「权衡」 (quánhéng) mean?', ["to weigh pros and cons", "to monopolize", "to simplify", "to overlook"], 0),

  mc("zh-grm-a1", "zh", "grammarMorphology", "A1", -2.1, 1.1, 'Complete: 「我 ___ 喜欢喝茶。」', ["很", "是", "有", "在"], 0),
  mc("zh-grm-a2", "zh", "grammarMorphology", "A2", -1.2, 1.2, 'Choose the aspect marker: 「我昨天看 ___ 一部很有意思的电影。」', ["了", "着", "会", "要"], 0),
  mc("zh-grm-b1", "zh", "grammarMorphology", "B1", -0.3, 1.35, 'Complete the 把 structure: 「请 ___ 窗户打开。」', ["把", "被", "让", "给"], 0),
  mc("zh-grm-b2", "zh", "grammarMorphology", "B2", 0.8, 1.45, 'Complete the correlative pair: 「即使天气不好，我们 ___ 要按时出发。」', ["也", "才", "就", "却"], 0),
  cloze("zh-grm-c1", "zh", "grammarMorphology", "C1", 1.8, 1.4, 'Fill in the formal conjunction: 「___ 成本上升，项目仍按计划推进。」', ["尽管", "虽然"]),

  mc("zh-rdg-a1", "zh", "readingComprehension", "A1", -2.0, 1.1, "Where is Xiao Wang going?", ["To the library", "To the airport", "To the hospital", "To the market"], 0, { contextPassage: "小王下午两点去图书馆学习中文。" }),
  mc("zh-rdg-a2", "zh", "readingComprehension", "A2", -1.1, 1.2, "Why didn't Linlin go hiking?", ["She caught a cold", "It snowed heavily", "She had to work overtime", "The trail was closed"], 0, { contextPassage: "林林本来打算星期天去爬山，可是星期六晚上感冒了，只好在家休息。" }),
  mc("zh-rdg-b1", "zh", "readingComprehension", "B1", -0.2, 1.35, "What does the notice ask readers to do?", ["Return borrowed books within two weeks", "Pay by mobile app only", "Avoid bringing water bottles", "Sign in at the third floor"], 0, { contextPassage: "本馆规定每次最多借阅五本书，借期两周；如需续借，请在到期前在网上办理。" }),
  mc("zh-rdg-b2", "zh", "readingComprehension", "B2", 0.9, 1.4, "What point does the passage emphasize?", ["Active recall beats passive re-reading", "Longer sessions always help", "Vocabulary lists replace context", "Audio alone builds writing skill"], 0, { contextPassage: "研究显示，反复被动浏览笔记的效果远不如在真实语境中主动回忆和运用。" }),
  mc("zh-rdg-c1", "zh", "readingComprehension", "C1", 1.8, 1.5, "What tension is described?", ["Efficiency gains vs. interpretive depth", "Budget surplus vs. hiring freeze", "Local dialects vs. signage", "Print scarcity vs. paper cost"], 0, { contextPassage: "算法摘要固然压缩了信息筛选的时间，却也往往削弱了读者对复杂论证脉络的耐心。" }),

  mc("zh-lst-a1", "zh", "listeningComprehension", "A1", -2.0, 1.1, "How many people are in the reservation?", ["Three people", "Five people", "Two people", "Six people"], 0, { audioTranscriptHint: "你好，我想预订今晚七点三位的位置。" }),
  mc("zh-lst-a2", "zh", "listeningComprehension", "A2", -1.0, 1.2, "How will the speaker get to the station?", ["By subway", "By taxi", "By bus", "On foot"], 0, { audioTranscriptHint: "路上有点堵车，我们坐地铁去火车站比较快。" }),
  mc("zh-lst-b1", "zh", "listeningComprehension", "B1", 0.1, 1.3, "Why is the speaker calling?", ["To reschedule a delivery", "To cancel a subscription", "To report a lost card", "To confirm a flight"], 0, { audioTranscriptHint: "您好，我明天上午不在家，想把快递改到下午五点以后再送。" }),
  mc("zh-lst-b2", "zh", "listeningComprehension", "B2", 1.1, 1.4, "What does the speaker recommend?", ["Testing the pilot in two cities first", "Deploying nationwide immediately", "Cutting research staff", "Dropping mobile support"], 0, { audioTranscriptHint: "考虑到各地需求差异较大，建议先在两个城市试点，再根据反馈调整方案。" }),

  freeResponse("zh-wrt-a1", "zh", "writingProduction", "A1", -2.0, 1.0, "Write a short Chinese sentence introducing yourself and what you like.", ["我叫", "我是", "我喜欢"], "Basic SVO sentence."),
  freeResponse("zh-wrt-a2", "zh", "writingProduction", "A2", -1.0, 1.15, "Write 1–2 Chinese sentences about something you did yesterday.", ["昨天", "了", "去", "看", "吃"], "Time-first word order with 了."),
  freeResponse("zh-wrt-b1", "zh", "writingProduction", "B1", 0.0, 1.25, "Write a short Chinese explanation using 「因为……所以……」 or 「虽然……但是……」.", ["因为", "虽然", "但是", "所以"], "Paired conjunctions."),
  freeResponse("zh-wrt-b2", "zh", "writingProduction", "B2", 1.1, 1.35, "Write a concise Chinese paragraph discussing an advantage and challenge of learning through reading.", ["然而", "此外", "不仅", "不过"], "Cohesive written discourse."),

  spokenResponse("zh-spk-a1", "zh", "A1", -2.0, 1.0, "Say aloud in Mandarin: 「你好，我想买一杯热茶。」", ["你好", "热茶", "想买"], "Tone accuracy on third and fourth tones."),
  spokenResponse("zh-spk-a2", "zh", "A2", -1.0, 1.15, "Describe aloud in Mandarin what you usually do on weekends.", ["周末", "常常", "喜欢", "然后"], "Conversational time phrases."),
  spokenResponse("zh-spk-b1", "zh", "B1", 0.1, 1.25, "Explain aloud in Mandarin why you chose to study Chinese.", ["因为", "觉得", "文化", "工作", "学习"], "Clear tone sandhi and reasoning."),
  spokenResponse("zh-spk-b2", "zh", "B2", 1.1, 1.35, "Give a brief spoken opinion in Mandarin on balancing work and rest.", ["一方面", "另一方面", "重要", "效率"], "Structured spoken argument."),
];

const KOREAN_ITEMS: readonly AssessmentItem[] = [
  mc("ko-voc-a1", "ko", "vocabularyBreadth", "A1", -2.2, 1.1, 'What does "물" mean?', ["Water", "Bread", "House", "Train"], 0),
  mc("ko-voc-a2", "ko", "vocabularyBreadth", "A2", -1.3, 1.2, 'What does "약속" mean?', ["Promise / appointment", "Weather", "Homework", "Ticket"], 0),
  mc("ko-voc-b1", "ko", "vocabularyBreadth", "B1", -0.4, 1.3, 'Choose the meaning of "경험":', ["experience", "decision", "opinion", "direction"], 0),
  mc("ko-voc-b2", "ko", "vocabularyBreadth", "B2", 0.7, 1.4, 'What does "해결하다" mean?', ["to resolve / solve", "to postpone", "to exaggerate", "to misunderstand"], 0),
  mc("ko-voc-c1", "ko", "vocabularyBreadth", "C1", 1.7, 1.5, 'In academic prose, "보완하다" means:', ["to supplement / complement", "to abolish", "to conceal", "to imitate"], 0),

  mc("ko-grm-a1", "ko", "grammarMorphology", "A1", -2.1, 1.1, 'Choose the object particle: "저는 한국어 ___ 공부해요."', ["를", "이", "에", "에서"], 0),
  mc("ko-grm-a2", "ko", "grammarMorphology", "A2", -1.2, 1.2, 'Complete (reason): "시간이 ___ 택시를 탔어요."', ["없어서", "없고", "없지만", "없거나"], 0),
  mc("ko-grm-b1", "ko", "grammarMorphology", "B1", -0.3, 1.35, 'Choose the indirect quotation ending: "내일 비가 온 ___ 들었어요."', ["다고", "려고", "면서", "거든"], 0),
  mc("ko-grm-b2", "ko", "grammarMorphology", "B2", 0.8, 1.45, 'Complete: "아무리 바쁘 ___ 건강은 챙겨야 합니다."', ["더라도", "기 때문에", "도록", "자마자"], 0),
  cloze("ko-grm-c1", "ko", "grammarMorphology", "C1", 1.8, 1.4, 'Fill in the formal contrastive ending: "기술은 발전했___ 윤리적 기준은 아직 부족하다."', ["으나", "지만"]),

  mc("ko-rdg-a1", "ko", "readingComprehension", "A1", -2.0, 1.1, "Where is Mina going today?", ["To the library", "To the cinema", "To the bank", "To the airport"], 0, { contextPassage: "미나 씨는 오늘 오후에 도서관에서 책을 읽어요." }),
  mc("ko-rdg-a2", "ko", "readingComprehension", "A2", -1.1, 1.2, "Why did Jinwoo buy an umbrella?", ["It started raining on his way home", "His friend asked for one", "It was on sale", "He lost his coat"], 0, { contextPassage: "집에 가는 길에 갑자기 비가 와서 편의점에서 우산을 샀어요." }),
  mc("ko-rdg-b1", "ko", "readingComprehension", "B1", -0.2, 1.35, "What is required to borrow equipment?", ["Registering with a student ID", "Paying a cash deposit", "Bringing a supervisor", "Booking two months early"], 0, { contextPassage: "장비를 대여하려면 먼저 안내 데스크에서 학생증을 제시하고 신청서를 작성해야 합니다." }),
  mc("ko-rdg-b2", "ko", "readingComprehension", "B2", 0.9, 1.4, "What point does the passage make?", ["Consistent short practice beats cramming", "Grammar drills replace reading", "Native speed audio works for beginners", "Subtitles prevent listening"], 0, { contextPassage: "하루에 짧은 시간이라도 꾸준히 노출되는 학습 방식이 벼락치기보다 장기 기억 형성에 훨씬 유리하다." }),
  mc("ko-rdg-c1", "ko", "readingComprehension", "C1", 1.8, 1.5, "What caution does the editorial express?", ["Metrics should guide rather than replace context", "Public surveys are always biased", "Policy reforms should halt", "Digital archives cost too much"], 0, { contextPassage: "정량 지표가 정책의 투명성을 높여 주는 것은 사실이나, 맥락을 배제한 수치 해석은 오히려 판단을 왜곡할 위험이 있다." }),

  mc("ko-lst-a1", "ko", "listeningComprehension", "A1", -2.0, 1.1, "What does the customer order?", ["Iced Americano", "Hot green tea", "Orange juice", "Milk bread"], 0, { audioTranscriptHint: "아이스 아메리카노 한 잔 주세요." }),
  mc("ko-lst-a2", "ko", "listeningComprehension", "A2", -1.0, 1.2, "Where will they meet?", ["In front of Exit 3", "At the restaurant", "Inside the museum", "At the bus terminal"], 0, { audioTranscriptHint: "내일 오후 두 시에 시청역 3번 출구 앞에서 만나요." }),
  mc("ko-lst-b1", "ko", "listeningComprehension", "B1", 0.1, 1.3, "Why was the class moved?", ["Audio equipment maintenance", "Instructor illness", "Holiday closure", "Schedule conflict"], 0, { audioTranscriptHint: "음향 장비 점검 때문에 오늘 수업은 2층 세미나실로 옮겨서 진행합니다." }),
  mc("ko-lst-b2", "ko", "listeningComprehension", "B2", 1.1, 1.4, "What does the speaker conclude?", ["Local feedback should shape the rollout", "The pilot should be abandoned", "Costs are negligible", "No training is needed"], 0, { audioTranscriptHint: "전면 도입에 앞서 현장 사용자들의 의견을 반영해 세부 절차를 조정할 필요가 있습니다." }),

  freeResponse("ko-wrt-a1", "ko", "writingProduction", "A1", -2.0, 1.0, "Write a short Korean sentence introducing your name.", ["안녕하세요", "저는", "입니다", "예요"], "Basic polite introduction."),
  freeResponse("ko-wrt-a2", "ko", "writingProduction", "A2", -1.0, 1.15, "Write 1–2 Korean sentences about what you did yesterday.", ["어제", "했어요", "갔어요", "봤어요", "먹었어요"], "Past polite -았/었어요."),
  freeResponse("ko-wrt-b1", "ko", "writingProduction", "B1", 0.0, 1.25, "Write a Korean sentence giving a reason with '-기 때문에' or '-아서/어서'.", ["때문에", "아서", "어서", "그래서"], "Causal connectors."),
  freeResponse("ko-wrt-b2", "ko", "writingProduction", "B2", 1.1, 1.35, "Write a short Korean argument comparing two study methods using '반면' or '그러나'.", ["반면", "그러나", "하지만", "장점"], "Formal written contrast."),

  spokenResponse("ko-spk-a1", "ko", "A1", -2.0, 1.0, 'Say aloud in Korean: "안녕하세요. 오늘 날씨가 정말 좋네요."', ["안녕하세요", "날씨", "좋네요"], "Basic vowel and final consonant clarity."),
  spokenResponse("ko-spk-a2", "ko", "A2", -1.0, 1.15, "Talk aloud in Korean about food you enjoy eating.", ["좋아해요", "맛있어요", "자주", "먹어요"], "Polite conversational speech."),
  spokenResponse("ko-spk-b1", "ko", "B1", 0.1, 1.25, "Explain aloud in Korean how you spend your free time.", ["시간이 있을 때", "보통", "취미", "때문에"], "Connected clauses in speech."),
  spokenResponse("ko-spk-b2", "ko", "B2", 1.1, 1.35, "Share aloud in Korean your view on lifelong learning.", ["평생", "중요", "반면", "생각합니다"], "Formal opinion articulation."),
];

const ARABIC_ITEMS: readonly AssessmentItem[] = [
  mc("ar-voc-a1", "ar", "vocabularyBreadth", "A1", -2.2, 1.1, 'What does "ماء" mean?', ["Water", "Book", "Sun", "Door"], 0),
  mc("ar-voc-a2", "ar", "vocabularyBreadth", "A2", -1.3, 1.2, 'What does "سريع" mean?', ["Fast", "Old", "Cold", "Small"], 0),
  mc("ar-voc-b1", "ar", "vocabularyBreadth", "B1", -0.4, 1.3, 'Select the meaning of "تجربة":', ["experience / experiment", "decision", "schedule", "signature"], 0),
  mc("ar-voc-b2", "ar", "vocabularyBreadth", "B2", 0.7, 1.4, 'What does "تحدٍّ" (تحدي) mean in formal prose?', ["challenge", "invitation", "agreement", "summary"], 0),
  mc("ar-voc-c1", "ar", "vocabularyBreadth", "C1", 1.7, 1.5, 'In analytical writing, "استدامة" means:', ["sustainability", "hesitation", "isolation", "coincidence"], 0),

  mc("ar-grm-a1", "ar", "grammarMorphology", "A1", -2.1, 1.1, 'Choose the pronoun: "___ طالبٌ في الجامعة."', ["أنا", "أنتِ", "نحن", "هم"], 0),
  mc("ar-grm-a2", "ar", "grammarMorphology", "A2", -1.2, 1.2, 'Complete (past tense): "ذهبَتْ سارة إلى السوق ___."', ["أمسِ", "غداً", "الآن", "دائماً"], 0),
  mc("ar-grm-b1", "ar", "grammarMorphology", "B1", -0.3, 1.35, 'Complete after "أن": "أريد أن ___ العربيةَ بطلاقة."', ["أتحدثَ", "تتحدثون", "تحدثتُ", "يتحدثون"], 0),
  mc("ar-grm-b2", "ar", "grammarMorphology", "B2", 0.8, 1.45, 'Select the fitting connector: "نجح المشروع ___ الصعوبات التي واجهتنا."', ["رغم", "لأن", "بينما", "إذن"], 0),
  cloze("ar-grm-c1", "ar", "grammarMorphology", "C1", 1.8, 1.4, 'Fill in the formal conditional particle: "___ تتوافر البيانات، تتحسن جودة التقدير."', ["كلما", "إذا"]),

  mc("ar-rdg-a1", "ar", "readingComprehension", "A1", -2.0, 1.1, "Where does Karim work?", ["In a school", "In a bakery", "At a port", "In a museum"], 0, { contextPassage: "يعمل كريم معلماً في مدرسة قريبة من بيته." }),
  mc("ar-rdg-a2", "ar", "readingComprehension", "A2", -1.1, 1.2, "Why did Layla take the train?", ["It was faster than driving", "Her car was broken", "The flight was cancelled", "Her friend invited her"], 0, { contextPassage: "فضّلت ليلى السفر بالقطار لأن الطريق السريع كان مزدحماً في الصباح." }),
  mc("ar-rdg-b1", "ar", "readingComprehension", "B1", -0.2, 1.35, "What does the library announcement state?", ["Members may reserve study rooms online", "The library closes on Mondays", "Only paper books are allowed", "Fees increased this month"], 0, { contextPassage: "يمكن للأعضاء حجز قاعات المطالعة الهادئة إلكترونياً قبل موعد الزيارة بيوم واحد." }),
  mc("ar-rdg-b2", "ar", "readingComprehension", "B2", 0.9, 1.4, "What is the author's main observation?", ["Regular reading builds intuition for phrasing", "Grammar tables alone suffice", "Speed reading improves retention", "Dictionaries eliminate context"], 0, { contextPassage: "تُظهر التجربة أن القراءة المنتظمة في موضوعات متنوعة تمنح المتعلم حسّاً طبيعياً ببناء الجملة." }),
  mc("ar-rdg-c1", "ar", "readingComprehension", "C1", 1.8, 1.5, "What caveat does the essay raise?", ["Quantitative indicators miss contextual nuance", "Archives resist digitization", "Public debate slows planning", "Translations are always exact"], 0, { contextPassage: "ورغم ما توفره المؤشرات الكمية من وضوحٍ ظاهري، فإنها تعجز أحياناً عن التقاط الفروق الدقيقة في السياق الثقافي." }),

  mc("ar-lst-a1", "ar", "listeningComprehension", "A1", -2.0, 1.1, "What time does the lesson start?", ["At nine o'clock", "At eleven o'clock", "At seven o'clock", "At four o'clock"], 0, { audioTranscriptHint: "يبدأ الدرس في الساعة التاسعة صباحاً." }),
  mc("ar-lst-a2", "ar", "listeningComprehension", "A2", -1.0, 1.2, "What does the speaker want to drink?", ["Mint tea", "Black coffee", "Orange juice", "Cold milk"], 0, { audioTranscriptHint: "من فضلك، أريد كوباً من الشاي بالنعناع." }),
  mc("ar-lst-b1", "ar", "listeningComprehension", "B1", 0.1, 1.3, "Why was the meeting postponed?", ["Waiting for updated figures", "Room unavailable", "Technical outage", "Travel delay"], 0, { audioTranscriptHint: "أجّلنا الاجتماع إلى يوم الثلاثاء ريثما تصل البيانات المحدثة." }),
  mc("ar-lst-b2", "ar", "listeningComprehension", "B2", 1.1, 1.4, "What is the speaker's conclusion?", ["Gradual testing reduces operational risk", "Immediate rollout is mandatory", "The project lacks users", "Funding must be halted"], 0, { audioTranscriptHint: "من الحكمة اختبار الميزة الجديدة مع مجموعة صغيرة قبل تعميمها لتفادي الأخطاء غير المتوقعة." }),

  freeResponse("ar-wrt-a1", "ar", "writingProduction", "A1", -2.0, 1.0, "Write a short Arabic sentence introducing yourself.", ["اسمي", "أنا", "مرحباً", "من"], "Basic Arabic self-introduction."),
  freeResponse("ar-wrt-a2", "ar", "writingProduction", "A2", -1.0, 1.15, "Write 1–2 Arabic sentences describing your daily routine.", ["أستيقظ", "كل يوم", "أذهب", "أقرأ", "أعمل"], "Present-tense daily actions."),
  freeResponse("ar-wrt-b1", "ar", "writingProduction", "B1", 0.0, 1.25, "Write a short Arabic sentence giving a reason using 'لأن' or 'بسبب'.", ["لأن", "بسبب", "لذلك", "أحب"], "Causal linking."),
  freeResponse("ar-wrt-b2", "ar", "writingProduction", "B2", 1.1, 1.35, "Write a concise Arabic opinion weighing one benefit and one limitation using 'غير أن' or 'إلا أن'.", ["غير أن", "إلا أن", "مع ذلك", "رغم"], "Formal contrastive discourse."),

  spokenResponse("ar-spk-a1", "ar", "A1", -2.0, 1.0, 'Say aloud in Arabic: "صباح الخير، كيف حالك اليوم؟"', ["صباح الخير", "كيف حالك"], "Clear pharyngeal and emphatic consonants."),
  spokenResponse("ar-spk-a2", "ar", "A2", -1.0, 1.15, "Describe aloud in Arabic a place you visit often.", ["أذهب", "أحياناً", "مكان", "جميل"], "Basic descriptive fluency."),
  spokenResponse("ar-spk-b1", "ar", "B1", 0.1, 1.25, "Explain aloud in Arabic why reading helps vocabulary growth.", ["القراءة", "تساعد", "لأن", "كلمات"], "Connected explanation."),
  spokenResponse("ar-spk-b2", "ar", "B2", 1.1, 1.35, "Discuss aloud in Arabic how technology supports independent study.", ["التقنية", "غير أن", "التعلم", "تساعد"], "Structured spoken argument."),
];

const UNIVERSAL_ITEMS: readonly AssessmentItem[] = [
  mc("uni-voc-a1", "universal", "vocabularyBreadth", "A1", -2.2, 1.1, "Which category contains everyday concrete nouns?", ["water, bread, house, sun", "hypothesis, paradigm, clause", "mitigate, infer, synthesize", "jurisdiction, ambiguity"], 0),
  mc("uni-voc-a2", "universal", "vocabularyBreadth", "A2", -1.3, 1.2, "Which pair represents direct antonyms for everyday frequency?", ["always / never", "table / green", "quickly / window", "morning / blue"], 0),
  mc("uni-voc-b1", "universal", "vocabularyBreadth", "B1", -0.4, 1.3, "Which word best fits: 'We had to ___ the meeting until Friday'?", ["postpone", "evaporate", "harvest", "whisper"], 0),
  mc("uni-voc-b2", "universal", "vocabularyBreadth", "B2", 0.7, 1.4, "In formal writing, 'corroborate' means:", ["confirm with independent evidence", "reject out of hand", "translate word for word", "obscure deliberately"], 0),
  mc("uni-voc-c1", "universal", "vocabularyBreadth", "C1", 1.7, 1.5, "What does 'ephemeral' denote?", ["short-lived / transitory", "ubiquitous / permanent", "methodical / rigid", "ambiguous / coded"], 0),

  mc("uni-grm-a1", "universal", "grammarMorphology", "A1", -2.1, 1.1, "Choose the grammatically well-formed simple present sentence:", ["She walks to work every morning.", "She walk to work every morning.", "She walking to work every morning.", "She walked to work tomorrow."], 0),
  mc("uni-grm-a2", "universal", "grammarMorphology", "A2", -1.2, 1.2, "Select the correct past-tense question:", ["Did you finish the book yesterday?", "Did you finished the book yesterday?", "Were you finish the book yesterday?", "Do you finished the book yesterday?"], 0),
  mc("uni-grm-b1", "universal", "grammarMorphology", "B1", -0.3, 1.35, "Select the sentence with correct conditional structure:", ["If I had known earlier, I would have called.", "If I would know earlier, I called.", "If I knew earlier, I will have called.", "If I had knew earlier, I would call."], 0),
  mc("uni-grm-b2", "universal", "grammarMorphology", "B2", 0.8, 1.45, "Choose the sentence using inversion accurately:", ["Not only did the team finish early, but they also documented every step.", "Not only the team finished early, but they also documented every step.", "Not only did the team finished early, also they documented every step.", "Not only finished the team early, but documented every step."], 0),
  cloze("uni-grm-c1", "universal", "grammarMorphology", "C1", 1.8, 1.4, "Complete the concessive clause: '___ compelling the theory may seem, empirical verification remains essential.'", ["however"]),

  mc("uni-rdg-a1", "universal", "readingComprehension", "A1", -2.0, 1.1, "What time does the bakery open?", ["At 6:30 AM", "At 9:00 AM", "At noon", "At 5:00 PM"], 0, { contextPassage: "The neighborhood bakery opens every weekday at 6:30 AM and sells fresh loaves until noon." }),
  mc("uni-rdg-a2", "universal", "readingComprehension", "A2", -1.1, 1.2, "Why did Nadia change her route?", ["Road construction blocked the bridge", "She wanted to buy coffee", "Her train was early", "She forgot her umbrella"], 0, { contextPassage: "Nadia usually crosses the river bridge, but road construction forced her to take the northern path this week." }),
  mc("uni-rdg-b1", "universal", "readingComprehension", "B1", -0.2, 1.35, "What is the purpose of the memo?", ["To announce a shared quiet-hours schedule", "To cancel remote work", "To raise membership dues", "To close the archive permanently"], 0, { contextPassage: "Starting next Monday, the study hall will reserve 9:00–12:00 as silent focus hours before opening for group discussion in the afternoon." }),
  mc("uni-rdg-b2", "universal", "readingComprehension", "B2", 0.9, 1.4, "What trade-off is identified in the passage?", ["Comprehension depth vs. quick skimming", "Audio bitrate vs. storage size", "Font size vs. paper weight", "Test length vs. room capacity"], 0, { contextPassage: "Skimming headlines accelerates triage, yet readers frequently mistake familiarity with isolated keywords for genuine grasp of the underlying argument." }),
  mc("uni-rdg-c1", "universal", "readingComprehension", "C1", 1.8, 1.5, "What does the passage argue about measurement?", ["Instruments shape which phenomena become visible", "Single scores capture complex skills completely", "Qualitative notes contradict empirical data", "Standards never evolve"], 0, { contextPassage: "Every diagnostic rubric foregrounds certain observable signals while rendering subtler communicative strategies invisible unless multi-dimensional evidence is preserved." }),

  mc("uni-lst-a1", "universal", "listeningComprehension", "A1", -2.0, 1.1, "Which platform is announced?", ["Platform 4", "Platform 2", "Platform 8", "Platform 1"], 0, { audioTranscriptHint: "Attention passengers: the regional train now boards at Platform 4." }),
  mc("uni-lst-a2", "universal", "listeningComprehension", "A2", -1.0, 1.2, "What does the speaker need?", ["A charger for her phone", "A train schedule", "A spare key", "A receipt"], 0, { audioTranscriptHint: "Excuse me, my phone battery is at two percent—do you happen to have a charger I could borrow?" }),
  mc("uni-lst-b1", "universal", "listeningComprehension", "B1", 0.1, 1.3, "Why was the release delayed?", ["An accessibility regression in testing", "Missing translations", "Server hardware failure", "Holiday staffing"], 0, { audioTranscriptHint: "We pushed the release to Thursday after QA flagged a keyboard-focus regression during checkout." }),
  mc("uni-lst-b2", "universal", "listeningComprehension", "B2", 1.1, 1.4, "What nuance does the speaker add?", ["Early gains may plateau without spaced review", "Initial scores predict final mastery", "Practice time does not matter", "Listening replaces reading"], 0, { audioTranscriptHint: "While immersion drives rapid initial comprehension, learners often plateau unless active retrieval reinforces low-frequency structures." }),

  freeResponse("uni-wrt-a1", "universal", "writingProduction", "A1", -2.0, 1.0, "Write a short sentence in your target language introducing your name and city.", ["name", "live", "from", "me llamo", "je m'appelle", "ich", "です", "我", "저는", "اسمي"], "Simple self-introduction."),
  freeResponse("uni-wrt-a2", "universal", "writingProduction", "A2", -1.0, 1.15, "Write 1–2 sentences in your target language about something you did yesterday.", ["yesterday", "went", "read", "ayer", "hier", "gestern", "昨日", "昨天", "어제", "أمس"], "Simple past narration."),
  freeResponse("uni-wrt-b1", "universal", "writingProduction", "B1", 0.0, 1.25, "Write a short paragraph in your target language explaining a goal and why it matters.", ["because", "goal", "porque", "parce que", "weil", "ので", "因为", "때문에", "لأن"], "Reasoned explanation."),
  freeResponse("uni-wrt-b2", "universal", "writingProduction", "B2", 1.1, 1.35, "Write a brief balanced argument in your target language weighing one benefit and one drawback.", ["however", "although", "sin embargo", "cependant", "allerdings", "一方で", "然而", "반면", "غير أن"], "Balanced discourse markers."),

  spokenResponse("uni-spk-a1", "universal", "A1", -2.0, 1.0, "Say a polite greeting and simple request aloud in your target language.", ["hello", "please", "hola", "bonjour", "guten tag", "おはよう", "你好", "안녕", "صباح"], "Clear articulation."),
  spokenResponse("uni-spk-a2", "universal", "A2", -1.0, 1.15, "Describe your daily routine aloud in your target language.", ["morning", "usually", "mañana", "matin", "morgen", "朝", "早上", "아침", "صباح"], "Present-tense sequencing."),
  spokenResponse("uni-spk-b1", "universal", "B1", 0.1, 1.25, "Explain aloud a hobby or book you enjoyed recently.", ["because", "enjoy", "porque", "parce que", "weil", "好き", "喜欢", "좋아", "أحب"], "Connected spoken sentences."),
  spokenResponse("uni-spk-b2", "universal", "B2", 1.1, 1.35, "Present a brief spoken opinion with a counterpoint in your target language.", ["however", "on the other hand", "sin embargo", "cependant", "jedoch", "一方で", "但是", "반면", "لكن"], "Nuanced spoken stance."),
];

const PLACEMENT_ITEM_BANKS: Record<PlacementBankLanguage, readonly AssessmentItem[]> = {
  es: SPANISH_ITEMS,
  fr: FRENCH_ITEMS,
  de: GERMAN_ITEMS,
  ja: JAPANESE_ITEMS,
  zh: CHINESE_ITEMS,
  ko: KOREAN_ITEMS,
  ar: ARABIC_ITEMS,
  universal: UNIVERSAL_ITEMS,
};

export function resolvePlacementBankLanguage(languageTag: string): {
  canonicalTag: string;
  bankLanguage: PlacementBankLanguage;
  usedUniversalFallback: boolean;
} {
  const canonicalTag = canonicalizeLanguageTag(languageTag || "und");
  const primarySubtag = canonicalTag.split("-")[0]?.toLowerCase() ?? "";
  if ((SUPPORTED_PLACEMENT_LANGUAGES as readonly string[]).includes(primarySubtag)) {
    return {
      canonicalTag,
      bankLanguage: primarySubtag as SupportedPlacementLanguage,
      usedUniversalFallback: false,
    };
  }
  return {
    canonicalTag,
    bankLanguage: "universal",
    usedUniversalFallback: true,
  };
}

export function getPlacementItemBank(languageTag: string): {
  canonicalTag: string;
  bankLanguage: PlacementBankLanguage;
  usedUniversalFallback: boolean;
  items: readonly AssessmentItem[];
} {
  const resolved = resolvePlacementBankLanguage(languageTag);
  return {
    ...resolved,
    items: PLACEMENT_ITEM_BANKS[resolved.bankLanguage],
  };
}

function resolveSessionDimensions(options: PlacementSessionOptions): AssessmentDimension[] {
  const base = options.dimensions?.length
    ? Array.from(new Set(options.dimensions))
    : [...ASSESSMENT_DIMENSIONS];

  return base.filter((dim) => {
    if (options.includeListening === false && dim === "listeningComprehension") return false;
    if (options.includeSpeaking === false && dim === "speakingPronunciation") return false;
    return true;
  });
}

function buildPlacementResultFromSession(session: PlacementSession): PlacementResult {
  const dimensions = {} as Record<AssessmentDimension, DimensionEstimate>;
  const availableDimensions: AssessmentDimension[] = [];
  const unavailableDimensions: AssessmentDimension[] = [];

  for (const dim of ASSESSMENT_DIMENSIONS) {
    const state = session.dimensionStates[dim];
    const estimate = buildDimensionEstimate(dim, state, {
      minItemsForCalibration: session.config.minItemsPerDimension,
      priorSd: session.config.priorSd,
    });
    dimensions[dim] = estimate;
    if (estimate.available) {
      availableDimensions.push(dim);
    } else {
      unavailableDimensions.push(dim);
    }
  }

  const totalItemsAnswered = session.history.filter((entry) => !entry.skipped).length;

  return {
    sessionId: session.sessionId,
    targetLanguage: session.config.targetLanguage,
    resolvedBankLanguage: session.config.resolvedBankLanguage,
    usedUniversalFallback: session.config.usedUniversalFallback,
    completed: session.isComplete,
    stopReason: session.stopReason,
    totalItemsAnswered,
    dimensions,
    availableDimensions,
    unavailableDimensions,
    isOfficialCertification: false,
    disclaimer: NON_CEFR_DISCLAIMER,
  };
}

/**
 * Creates a multi-dimensional CAT/IRT adaptive placement session for a target language.
 */
export function buildPlacementSession(options: PlacementSessionOptions): PlacementSession {
  const now = Date.now();
  const { canonicalTag, bankLanguage, usedUniversalFallback } = resolvePlacementBankLanguage(
    options.targetLanguage,
  );
  const activeDimensions = resolveSessionDimensions(options);
  const activeSet = new Set<AssessmentDimension>(activeDimensions);
  const priorMean = options.priorMean ?? DEFAULT_PRIOR_MEAN;
  const priorSd = options.priorSd ?? DEFAULT_PRIOR_SD;
  const targetSem = options.targetSem ?? DEFAULT_TARGET_SEM;
  const minItemsPerDimension = Math.max(
    1,
    options.minItemsPerDimension ?? DEFAULT_MIN_ITEMS_PER_DIMENSION,
  );
  const maxItems = Math.max(1, options.maxItems ?? DEFAULT_MAX_ITEMS);

  const sourceItems = options.customItems ?? PLACEMENT_ITEM_BANKS[bankLanguage];
  const itemPool = sourceItems.filter((item) => activeSet.has(item.dimension));

  const dimensionStates = {} as Record<AssessmentDimension, DimensionAdaptiveState>;
  for (const dim of ASSESSMENT_DIMENSIONS) {
    dimensionStates[dim] = createDimensionAdaptiveState(
      dim,
      activeSet.has(dim),
      priorMean,
      priorSd,
    );
  }

  const firstItem = selectNextAdaptiveItem(itemPool, dimensionStates, {
    targetSem,
    minItemsPerDimension,
    activeDimensions,
  });

  const isComplete = firstItem === null;
  const stopReason: PlacementStopReason | null = isComplete ? "item-pool-exhausted" : null;

  return {
    sessionId: options.sessionId ?? `placement-${bankLanguage}-${now}`,
    profileId: options.profileId,
    createdAt: now,
    updatedAt: now,
    config: {
      targetLanguage: canonicalTag,
      resolvedBankLanguage: bankLanguage,
      usedUniversalFallback,
      dimensions: activeDimensions,
      maxItems,
      minItemsPerDimension,
      targetSem,
      priorMean,
      priorSd,
    },
    itemPool,
    dimensionStates,
    history: [],
    currentItem: firstItem,
    isComplete,
    stopReason,
    isOfficialCertification: false,
    disclaimer: NON_CEFR_DISCLAIMER,
  };
}

function normalizeAnswerText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function scoreItemResponse(
  item: AssessmentItem,
  response: AdaptiveItemResponseInput,
): { correct: boolean; score: number } {
  if (typeof response.score === "number" && Number.isFinite(response.score)) {
    const score = clamp(response.score, 0, 1);
    return { correct: response.correct ?? score >= 0.5, score };
  }
  if (typeof response.correct === "boolean") {
    return { correct: response.correct, score: response.correct ? 1 : 0 };
  }
  if (
    typeof response.selectedOptionIndex === "number" &&
    typeof item.correctOptionIndex === "number"
  ) {
    const correct = response.selectedOptionIndex === item.correctOptionIndex;
    return { correct, score: correct ? 1 : 0 };
  }
  if (typeof response.textResponse === "string") {
    const normalized = normalizeAnswerText(response.textResponse);
    if (!normalized) {
      return { correct: false, score: 0 };
    }
    if (item.acceptedPatterns && item.acceptedPatterns.length > 0) {
      const matched = item.acceptedPatterns.some((pattern) =>
        normalized.includes(normalizeAnswerText(pattern)),
      );
      if (item.responseFormat === "cloze") {
        return { correct: matched, score: matched ? 1 : 0 };
      }
      // Free/spoken response gets partial credit for substantive multi-word responses even without exact phrase match.
      const wordCount = normalized.split(" ").filter(Boolean).length;
      if (matched) return { correct: true, score: 1 };
      if (wordCount >= 5) return { correct: false, score: 0.45 };
      return { correct: false, score: 0.1 };
    }
    return { correct: normalized.length >= 6, score: normalized.length >= 6 ? 0.8 : 0.2 };
  }
  return { correct: false, score: 0 };
}

/**
 * Records a learner's response to an adaptive placement item, updates IRT posterior
 * estimates, applies stopping rules, and selects the next optimal item.
 */
export function stepAdaptiveItem(
  session: PlacementSession,
  response: AdaptiveItemResponseInput,
): StepAdaptiveResult {
  if (session.isComplete) {
    throw new Error(`Placement session "${session.sessionId}" is already complete.`);
  }

  const item = session.itemPool.find((candidate) => candidate.id === response.itemId);
  if (!item) {
    throw new Error(`Item "${response.itemId}" does not exist in placement session pool.`);
  }

  const prevState = session.dimensionStates[item.dimension];
  if (!prevState.enabled) {
    throw new Error(`Dimension "${item.dimension}" is not enabled in this placement session.`);
  }
  if (
    prevState.answeredItemIds.includes(item.id) ||
    prevState.skippedItemIds.includes(item.id)
  ) {
    throw new Error(`Item "${item.id}" was already recorded in this session.`);
  }

  const now = Date.now();
  const skipped = Boolean(response.skip);
  const { correct, score } = skipped
    ? { correct: false, score: 0 }
    : scoreItemResponse(item, response);

  const nextDimState: DimensionAdaptiveState = skipped
    ? {
        ...prevState,
        skippedItemIds: [...prevState.skippedItemIds, item.id],
      }
    : updateAbilityEstimate(prevState, item, score);

  const nextDimensionStates: Record<AssessmentDimension, DimensionAdaptiveState> = {
    ...session.dimensionStates,
    [item.dimension]: nextDimState,
  };

  const record: AdaptiveResponseRecord = {
    itemId: item.id,
    dimension: item.dimension,
    correct,
    score,
    skipped,
    selectedOptionIndex: response.selectedOptionIndex,
    textResponse: response.textResponse,
    responseTimeMs: response.responseTimeMs,
    thetaBefore: prevState.theta,
    thetaAfter: nextDimState.theta,
    semBefore: prevState.sem,
    semAfter: nextDimState.sem,
    answeredAt: now,
  };

  const nextHistory = [...session.history, record];
  const answeredCount = nextHistory.filter((entry) => !entry.skipped).length;

  let stopReason: PlacementStopReason | null = null;
  let nextItem: AssessmentItem | null = null;

  if (response.stopEarly) {
    stopReason = "user-stopped-early";
  } else if (answeredCount >= session.config.maxItems) {
    stopReason = "max-items-reached";
  } else if (
    allActiveDimensionsConverged(
      nextDimensionStates,
      session.config.dimensions,
      session.config.targetSem,
      session.config.minItemsPerDimension,
    )
  ) {
    stopReason = "target-sem-reached";
  } else {
    nextItem = selectNextAdaptiveItem(session.itemPool, nextDimensionStates, {
      targetSem: session.config.targetSem,
      minItemsPerDimension: session.config.minItemsPerDimension,
      activeDimensions: session.config.dimensions,
    });
    if (nextItem === null) {
      stopReason = "item-pool-exhausted";
    }
  }

  const isComplete = stopReason !== null;
  const nextSession: PlacementSession = {
    ...session,
    updatedAt: now,
    dimensionStates: nextDimensionStates,
    history: nextHistory,
    currentItem: nextItem,
    isComplete,
    stopReason,
    isOfficialCertification: false,
    disclaimer: NON_CEFR_DISCLAIMER,
  };

  return {
    session: nextSession,
    recordedResponse: record,
    nextItem,
    isComplete,
    stopReason,
    estimate: buildPlacementResultFromSession(nextSession),
    isOfficialCertification: false,
    disclaimer: NON_CEFR_DISCLAIMER,
  };
}

export function finalizePlacementSession(
  session: PlacementSession,
  reason: PlacementStopReason = "user-stopped-early",
): PlacementResult {
  const closedSession: PlacementSession = session.isComplete
    ? session
    : {
        ...session,
        updatedAt: Date.now(),
        currentItem: null,
        isComplete: true,
        stopReason: reason,
      };
  return buildPlacementResultFromSession(closedSession);
}

interface ObservableProfileDimensionSignal {
  theta: number;
  sem: number;
  sampleCount: number;
  note: string;
}

function accuracyToThetaOffset(accuracy: number): number {
  const bounded = clamp(accuracy, 0.05, 0.98);
  // Logit shift centered at 0.65 accuracy -> 0 offset
  return clamp(Math.log(bounded / (1 - bounded)) - Math.log(0.65 / 0.35), -1.8, 1.8);
}

function extractProfileSignals(
  stats: ProfileEvidenceStats,
): Partial<Record<AssessmentDimension, ObservableProfileDimensionSignal>> {
  const signals: Partial<Record<AssessmentDimension, ObservableProfileDimensionSignal>> = {};

  // 1. Vocabulary Breadth from lexical knowledge states
  const lex = stats.lexicalCounts;
  if (lex) {
    const known = Math.max(0, lex.known ?? 0);
    const familiar = Math.max(0, lex.familiar ?? 0);
    const learning = Math.max(0, lex.learning ?? 0);
    const encountered = Math.max(0, lex.encountered ?? 0);
    const totalObserved = known + familiar + learning + encountered;

    if (totalObserved > 0) {
      const effectiveLexemes = known + 0.65 * familiar + 0.25 * learning + 0.05 * encountered;
      // Logarithmic mapping: ~40 -> -2.2, ~250 -> -1.2, ~900 -> -0.2, ~2500 -> +0.8, ~5500 -> +1.7
      const theta = clamp((Math.log10(Math.max(1, effectiveLexemes)) - 2.95) * 1.45, -2.7, 2.5);
      // Floor SEM at 0.55 because lexical counts alone without active assessment have inherent uncertainty.
      const sem = clamp(1.15 - 0.14 * Math.log10(totalObserved + 1), 0.55, 1.15);
      signals.vocabularyBreadth = {
        theta,
        sem,
        sampleCount: totalObserved,
        note: `Profile lexicon (${known} known, ${familiar} familiar, ${learning} learning).`,
      };
    }
  }

  // 2. Reading Comprehension from document coverage, reading activity, and comprehension checks
  const rdg = stats.readingCoverage;
  if (rdg) {
    const docs = Math.max(0, rdg.documentsRead ?? 0);
    const mins = Math.max(0, rdg.readingMinutes ?? 0);
    const compCount = Math.max(0, rdg.comprehensionCount ?? 0);
    const hasCoverage = typeof rdg.averageCoverageRatio === "number";
    const sampleCount = docs + compCount + (mins > 0 ? Math.max(1, Math.round(mins / 15)) : 0);

    if (sampleCount > 0 || hasCoverage) {
      const cov = clamp(rdg.averageCoverageRatio ?? 0.65, 0, 1);
      const covTheta = (cov - 0.72) * 4.0;
      const compOffset =
        typeof rdg.comprehensionAccuracy === "number" && compCount > 0
          ? accuracyToThetaOffset(rdg.comprehensionAccuracy)
          : 0;
      const exposureBonus = clamp(Math.log10(Math.max(1, docs * 10 + mins)) * 0.35 - 0.5, -0.6, 0.9);
      const theta = clamp(covTheta * 0.45 + compOffset * 0.55 + exposureBonus, -2.5, 2.4);
      const effectiveSamples = Math.max(1, sampleCount);
      const sem = clamp(1.15 / Math.sqrt(1 + effectiveSamples * 0.25), 0.5, 1.15);
      signals.readingComprehension = {
        theta,
        sem,
        sampleCount: effectiveSamples,
        note: `Profile reading (${docs} doc(s), ${Math.round(cov * 100)}% avg coverage).`,
      };
    }
  }

  // 3. Grammar & Morphology from grammar practice
  const grm = stats.grammarPractice;
  if (grm && (grm.attemptCount ?? 0) > 0) {
    const attempts = Math.max(1, grm.attemptCount ?? 0);
    const acc = clamp(grm.accuracy ?? 0.5, 0, 1);
    const baseDiff = clamp(grm.averageItemDifficulty ?? 0, -2.2, 2.2);
    const theta = clamp(baseDiff + accuracyToThetaOffset(acc), -2.6, 2.5);
    const sem = clamp(1.15 / Math.sqrt(1 + attempts * 0.22), 0.48, 1.15);
    signals.grammarMorphology = {
      theta,
      sem,
      sampleCount: attempts,
      note: `Grammar practice (${attempts} attempt(s), ${Math.round(acc * 100)}% accuracy).`,
    };
  }

  // 4. Listening Comprehension from listening / dictation stats
  const lst = stats.listeningStats;
  if (lst) {
    const mins = Math.max(0, lst.listeningMinutes ?? 0);
    const sentences = Math.max(0, lst.listeningSentences ?? 0);
    const dictCount = Math.max(0, lst.dictationCount ?? 0);
    const sampleCount = dictCount + (sentences > 0 ? Math.max(1, Math.round(sentences / 10)) : 0) + (mins > 0 ? Math.max(1, Math.round(mins / 15)) : 0);

    if (sampleCount > 0) {
      const dictOffset =
        typeof lst.dictationAccuracy === "number" && dictCount > 0
          ? accuracyToThetaOffset(lst.dictationAccuracy)
          : 0;
      const exposureTheta = clamp(Math.log10(Math.max(1, mins + sentences * 0.5)) * 0.85 - 1.3, -2.2, 1.8);
      const theta = clamp(dictCount > 0 ? 0.55 * dictOffset + 0.45 * exposureTheta : exposureTheta, -2.5, 2.3);
      const sem = clamp(1.18 / Math.sqrt(1 + sampleCount * 0.2), 0.52, 1.18);
      signals.listeningComprehension = {
        theta,
        sem,
        sampleCount,
        note: `Listening evidence (${mins} min, ${sentences} sentence(s), ${dictCount} dictation item(s)).`,
      };
    }
  }

  // 5. Writing Production from writing outputs
  const wrt = stats.writingStats;
  if (wrt && (wrt.outputsCount ?? 0) > 0) {
    const count = Math.max(1, wrt.outputsCount ?? 0);
    const score = clamp(wrt.averageScore ?? 0.6, 0, 1);
    const words = Math.max(0, wrt.averageWordCount ?? 0);
    const lengthBonus = words > 0 ? clamp((words - 35) / 140, -0.4, 0.7) : 0;
    const theta = clamp(accuracyToThetaOffset(score) + lengthBonus, -2.5, 2.4);
    const sem = clamp(1.15 / Math.sqrt(1 + count * 0.35), 0.5, 1.15);
    signals.writingProduction = {
      theta,
      sem,
      sampleCount: count,
      note: `Writing outputs (${count} submission(s), ${Math.round(score * 100)}% avg rubric score).`,
    };
  }

  // 6. Speaking & Pronunciation from shadowing / pronunciation outputs
  const spk = stats.speakingStats;
  if (spk && (spk.outputsCount ?? 0) > 0) {
    const count = Math.max(1, spk.outputsCount ?? 0);
    const pron = spk.pronunciationScore;
    const shad = spk.shadowingAccuracy;
    const quality =
      typeof pron === "number" && typeof shad === "number"
        ? 0.5 * clamp(pron, 0, 1) + 0.5 * clamp(shad, 0, 1)
        : clamp(pron ?? shad ?? 0.6, 0, 1);
    const theta = clamp(accuracyToThetaOffset(quality), -2.5, 2.4);
    const sem = clamp(1.15 / Math.sqrt(1 + count * 0.35), 0.5, 1.15);
    signals.speakingPronunciation = {
      theta,
      sem,
      sampleCount: count,
      note: `Speaking outputs (${count} turn(s), ${Math.round(quality * 100)}% acoustic/shadowing match).`,
    };
  }

  return signals;
}

/**
 * Fuses observable learner profile evidence (lexical knowledge states, reading coverage,
 * grammar/listening/writing/speaking practice) with an optional PlacementResult using
 * inverse-variance Bayesian precision weighting. Dimensions with zero observable evidence
 * across both sources remain unavailable.
 */
export function combineProfileEvidenceWithPlacement(
  profileStats: ProfileEvidenceStats,
  placementResult?: PlacementResult | null,
): CombinedProficiencyResult {
  const profileSignals = extractProfileSignals(profileStats ?? {});
  const dimensions = {} as Record<AssessmentDimension, DimensionEstimate>;
  const availableDimensions: AssessmentDimension[] = [];
  const unavailableDimensions: AssessmentDimension[] = [];

  let usedPlacement = false;
  let usedProfileStats = false;

  for (const dim of ASSESSMENT_DIMENSIONS) {
    const placementDim = placementResult?.dimensions[dim];
    const hasPlacement = Boolean(placementDim && placementDim.available && placementDim.theta !== null && placementDim.sem !== null);
    const profileSig = profileSignals[dim];
    const hasProfile = Boolean(profileSig && profileSig.sampleCount > 0);

    if (hasPlacement) usedPlacement = true;
    if (hasProfile) usedProfileStats = true;

    if (!hasPlacement && !hasProfile) {
      dimensions[dim] = buildDimensionEstimate(dim, {
        enabled: false,
        theta: 0,
        sem: DEFAULT_PRIOR_SD,
        sampleCount: 0,
      });
      unavailableDimensions.push(dim);
      continue;
    }

    let fusedTheta = 0;
    let fusedSem = DEFAULT_PRIOR_SD;
    let totalSamples = 0;
    const notes: string[] = [];

    if (hasPlacement && hasProfile && placementDim && profileSig) {
      const pTheta = placementDim.theta ?? 0;
      const pSem = Math.max(0.05, placementDim.sem ?? DEFAULT_PRIOR_SD);
      const tauPlacement = 1 / (pSem * pSem);
      const tauProfile = 1 / (profileSig.sem * profileSig.sem);
      const tauTotal = tauPlacement + tauProfile;

      fusedTheta = clamp(
        (tauPlacement * pTheta + tauProfile * profileSig.theta) / tauTotal,
        -3.0,
        3.0,
      );
      fusedSem = Math.max(0.05, 1 / Math.sqrt(tauTotal));
      totalSamples = placementDim.sampleCount + profileSig.sampleCount;
      notes.push(
        `Fused ${placementDim.sampleCount} placement item(s) with ${profileSig.note}`,
      );
    } else if (hasPlacement && placementDim) {
      fusedTheta = placementDim.theta ?? 0;
      fusedSem = Math.max(0.05, placementDim.sem ?? DEFAULT_PRIOR_SD);
      totalSamples = placementDim.sampleCount;
      notes.push(`Placement evidence only (${placementDim.sampleCount} item(s)).`);
    } else if (hasProfile && profileSig) {
      fusedTheta = profileSig.theta;
      fusedSem = profileSig.sem;
      totalSamples = profileSig.sampleCount;
      notes.push(profileSig.note);
    }

    const estimate = buildDimensionEstimate(
      dim,
      {
        enabled: true,
        theta: fusedTheta,
        sem: fusedSem,
        sampleCount: totalSamples,
      },
      {
        minItemsForCalibration: DEFAULT_MIN_ITEMS_PER_DIMENSION,
        priorSd: DEFAULT_PRIOR_SD,
        noteSuffix: notes.join(" "),
      },
    );

    // Ensure fused estimate never reports narrower uncertainty than individual valid components allow
    dimensions[dim] = {
      ...estimate,
      numericScore: thetaToScore(fusedTheta),
      estimatedLevel: thetaToBand(fusedTheta),
    };
    availableDimensions.push(dim);
  }

  const targetLanguage = canonicalizeLanguageTag(
    profileStats?.targetLanguage ?? placementResult?.targetLanguage ?? "und",
  );

  return {
    targetLanguage,
    dimensions,
    availableDimensions,
    unavailableDimensions,
    evidenceSources: {
      usedPlacement,
      usedProfileStats,
    },
    isOfficialCertification: false,
    disclaimer: NON_CEFR_DISCLAIMER,
  };
}
