export type LanguageAnnotationLayer =
  | "reading-position"
  | "vocabulary"
  | "search"
  | "user-highlight"
  | "tts"
  | "selection";

/** Higher numbers win the visual foreground; lower layers remain available as background semantics. */
export const LANGUAGE_ANNOTATION_LAYER_PRECEDENCE: Readonly<Record<LanguageAnnotationLayer, number>> = {
  "reading-position": 10,
  vocabulary: 20,
  search: 30,
  "user-highlight": 40,
  tts: 50,
  selection: 60,
};

export interface AnnotationLayerPresence {
  readingPosition?: boolean;
  vocabulary?: boolean;
  search?: boolean;
  userHighlight?: boolean;
  tts?: boolean;
  selection?: boolean;
}

export interface AnnotationPrecedenceResult {
  dominant: LanguageAnnotationLayer | null;
  active: LanguageAnnotationLayer[];
  /** Stable low-to-high order for CSS classes and inspection surfaces. */
  classOrder: LanguageAnnotationLayer[];
}

const PRESENCE_TO_LAYER: ReadonlyArray<readonly [keyof AnnotationLayerPresence, LanguageAnnotationLayer]> = [
  ["readingPosition", "reading-position"],
  ["vocabulary", "vocabulary"],
  ["search", "search"],
  ["userHighlight", "user-highlight"],
  ["tts", "tts"],
  ["selection", "selection"],
];

export function resolveAnnotationPrecedence(presence: AnnotationLayerPresence): AnnotationPrecedenceResult {
  const active = PRESENCE_TO_LAYER
    .filter(([key]) => presence[key] === true)
    .map(([, layer]) => layer)
    .sort((a, b) => LANGUAGE_ANNOTATION_LAYER_PRECEDENCE[a] - LANGUAGE_ANNOTATION_LAYER_PRECEDENCE[b]);
  return {
    dominant: active.at(-1) ?? null,
    active,
    classOrder: [...active],
  };
}

export function compareAnnotationLayers(
  left: LanguageAnnotationLayer,
  right: LanguageAnnotationLayer,
): number {
  return LANGUAGE_ANNOTATION_LAYER_PRECEDENCE[left] - LANGUAGE_ANNOTATION_LAYER_PRECEDENCE[right];
}
