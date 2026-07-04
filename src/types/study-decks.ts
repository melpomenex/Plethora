export interface StudyDeck {
  id: string;
  name: string;
  tagFilters: string[];
  documentId?: string;
  createdAt?: string;
  updatedAt?: string;

  // Custom smart filters
  filterType?: "all" | "tags" | "cram" | "difficulty";
  difficultyFilters?: number[]; // e.g. [1, 2, 3, 4, 5]
  stateFilters?: string[]; // e.g. ["New", "Learning", "Review", "Relearning"]
}

export type StudyDeckId = string;
