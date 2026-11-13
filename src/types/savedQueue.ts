export interface SavedQueueFilters {
  categories: string[];
  tags: string[];
  priorityRange: { min: number; max: number };
  excludeSuspended: boolean;
}

export interface SavedQueueItemTypes {
  documents: boolean;
  extracts: boolean;
  learningItems: boolean;
}

export interface SavedQueue {
  id: string;
  name: string;
  icon?: string;
  collectionId?: string | null;
  filters: SavedQueueFilters;
  itemTypes: SavedQueueItemTypes;
  sessionDurationMinutes: number;
  maxItems: number;
  daqePresetId?: string;
  sessionGoal?: string;
  isDefault: boolean;
  sortOrder: number;
  /** Pinned queue ordering mode: "adaptive" | "strict_manual"; undefined = Adaptive. */
  orderingMode?: 'adaptive' | 'strict_manual';
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedQueueInput {
  name: string;
  icon?: string;
  collectionId?: string | null;
  filters?: Partial<SavedQueueFilters>;
  itemTypes?: Partial<SavedQueueItemTypes>;
  sessionDurationMinutes?: number;
  maxItems?: number;
  daqePresetId?: string;
  sessionGoal?: string;
  isDefault?: boolean;
  orderingMode?: 'adaptive' | 'strict_manual';
}

export interface UpdateSavedQueueInput {
  name?: string;
  icon?: string;
  collectionId?: string | null;
  filters?: Partial<SavedQueueFilters>;
  itemTypes?: Partial<SavedQueueItemTypes>;
  sessionDurationMinutes?: number;
  maxItems?: number;
  daqePresetId?: string;
  sessionGoal?: string;
  isDefault?: boolean;
  sortOrder?: number;
  orderingMode?: 'adaptive' | 'strict_manual';
}
