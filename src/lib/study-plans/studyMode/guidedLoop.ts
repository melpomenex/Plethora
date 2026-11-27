export type GuidedStudyMode = "freeform" | "guided";

export type GuidedLoopStage =
  | "introduce"
  | "anchor"
  | "understand"
  | "recall"
  | "adapt"
  | "reinforce"
  | "recap";

export interface GuidedObjectiveItem {
  id: string;
  label: string;
  excerpt: string;
}

export interface GuidedLoopState {
  mode: GuidedStudyMode;
  stage: GuidedLoopStage;
  objectives: GuidedObjectiveItem[];
  currentIndex: number;
  remediationCount: number;
  understoodObjectiveIds: string[];
  needsPracticeObjectiveIds: string[];
  promotedFlashcardCount: number;
  lastOutcome: "understood" | "partial" | "needs_review" | null;
  lastMisconception: string | null;
}

export const GUIDED_STAGE_ORDER: GuidedLoopStage[] = [
  "introduce",
  "anchor",
  "understand",
  "recall",
  "adapt",
  "reinforce",
  "recap",
];

export const GUIDED_STAGE_LABELS: Record<GuidedLoopStage, string> = {
  introduce: "1. Introduce",
  anchor: "2. Source Anchor",
  understand: "3. Build Understanding",
  recall: "4. Recall & Apply",
  adapt: "5. Adapt",
  reinforce: "6. Reinforce",
  recap: "Recap",
};

export function createInitialGuidedLoopState(
  objectives: GuidedObjectiveItem[] = []
): GuidedLoopState {
  return {
    mode: "freeform",
    stage: "introduce",
    objectives,
    currentIndex: 0,
    remediationCount: 0,
    understoodObjectiveIds: [],
    needsPracticeObjectiveIds: [],
    promotedFlashcardCount: 0,
    lastOutcome: null,
    lastMisconception: null,
  };
}

export type GuidedLoopAction =
  | { type: "START_GUIDED"; objectives: GuidedObjectiveItem[]; startIndex?: number }
  | { type: "EXIT_GUIDED" }
  | { type: "ADVANCE_STAGE" }
  | { type: "JUMP_STAGE"; stage: GuidedLoopStage }
  | {
      type: "RECORD_RECALL_OUTCOME";
      outcome: "understood" | "partial" | "needs_review";
      misconception?: string | null;
    }
  | { type: "COMPLETE_REMEDIATION_RETRY" }
  | { type: "RECORD_FLASHCARD_PROMOTED" }
  | { type: "NEXT_OBJECTIVE" };

export function guidedLoopReducer(
  state: GuidedLoopState,
  action: GuidedLoopAction
): GuidedLoopState {
  switch (action.type) {
    case "START_GUIDED": {
      const safeIndex = Math.max(
        0,
        Math.min(action.startIndex ?? 0, Math.max(0, action.objectives.length - 1))
      );
      return {
        ...createInitialGuidedLoopState(action.objectives),
        mode: "guided",
        stage: "introduce",
        currentIndex: safeIndex,
      };
    }

    case "EXIT_GUIDED":
      return {
        ...state,
        mode: "freeform",
      };

    case "JUMP_STAGE":
      return {
        ...state,
        stage: action.stage,
      };

    case "ADVANCE_STAGE": {
      switch (state.stage) {
        case "introduce":
          return { ...state, stage: "anchor" };
        case "anchor":
          return { ...state, stage: "understand" };
        case "understand":
          return { ...state, stage: "recall" };
        case "recall":
          return { ...state, stage: "reinforce" };
        case "adapt":
          return { ...state, stage: "recall" };
        case "reinforce": {
          const hasMore = state.currentIndex + 1 < state.objectives.length;
          if (hasMore) {
            return {
              ...state,
              currentIndex: state.currentIndex + 1,
              stage: "introduce",
              remediationCount: 0,
              lastOutcome: null,
              lastMisconception: null,
            };
          }
          return { ...state, stage: "recap" };
        }
        case "recap":
          return { ...state, mode: "freeform" };
      }
      return state;
    }

    case "RECORD_RECALL_OUTCOME": {
      const currentObj = state.objectives[state.currentIndex];
      const objId = currentObj?.id ?? `step-${state.currentIndex}`;
      if (action.outcome === "understood") {
        const understood = state.understoodObjectiveIds.includes(objId)
          ? state.understoodObjectiveIds
          : [...state.understoodObjectiveIds, objId];
        const needsPractice = state.needsPracticeObjectiveIds.filter((id) => id !== objId);
        return {
          ...state,
          stage: "reinforce",
          understoodObjectiveIds: understood,
          needsPracticeObjectiveIds: needsPractice,
          lastOutcome: "understood",
          lastMisconception: null,
        };
      }
      const needsPractice = state.needsPracticeObjectiveIds.includes(objId)
        ? state.needsPracticeObjectiveIds
        : [...state.needsPracticeObjectiveIds, objId];
      return {
        ...state,
        stage: "adapt",
        remediationCount: state.remediationCount + 1,
        needsPracticeObjectiveIds: needsPractice,
        lastOutcome: action.outcome,
        lastMisconception: action.misconception ?? null,
      };
    }

    case "COMPLETE_REMEDIATION_RETRY":
      return {
        ...state,
        stage: "recall",
      };

    case "RECORD_FLASHCARD_PROMOTED":
      return {
        ...state,
        promotedFlashcardCount: state.promotedFlashcardCount + 1,
      };

    case "NEXT_OBJECTIVE": {
      const hasMore = state.currentIndex + 1 < state.objectives.length;
      if (!hasMore) {
        return { ...state, stage: "recap" };
      }
      return {
        ...state,
        currentIndex: state.currentIndex + 1,
        stage: "introduce",
        remediationCount: 0,
        lastOutcome: null,
        lastMisconception: null,
      };
    }
  }
}

export function getCurrentGuidedObjective(state: GuidedLoopState): GuidedObjectiveItem | null {
  return state.objectives[state.currentIndex] ?? null;
}
