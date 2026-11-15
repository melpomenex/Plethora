import { create } from "zustand";
import { ViewName } from "../types";

export type UIDensityMode = "zen" | "architect";
export const UI_DENSITY_STORAGE_KEY = "plethora_ui_density_mode";

function readInitialDensityMode(): UIDensityMode {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem(UI_DENSITY_STORAGE_KEY);
      if (saved === "zen" || saved === "architect") {
        return saved;
      }
    }
  } catch {
    // Ignore storage errors
  }
  return "zen";
}

function persistDensityMode(mode: UIDensityMode): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(UI_DENSITY_STORAGE_KEY, mode);
    }
  } catch {
    // Ignore storage errors
  }
}

export interface CaptureImportInitialData {
  filePath?: string;
  filePaths?: string[];
  fileName?: string;
  fileNames?: string[];
  url?: string;
  title?: string;
  collectionId?: string;
  contentType?: "lecture" | "meeting" | "interview" | "study";
}

interface UIState {
  // Navigation
  currentView: ViewName;
  sidebarCollapsed: boolean;
  dockPanelCollapsed: boolean;

  // Modals
  activeModal: string | null;
  modalData: Record<string, unknown>;

  // Command Palette
  commandPaletteOpen: boolean;
  lectureCaptureRequested: boolean;
  commandPaletteQuery: string;

  // Capture & Import / Active Recording
  captureImportDialogOpen: boolean;
  captureImportInitialRoute?: "record" | "import-media" | "import-transcript" | "import-url";
  captureImportInitialData?: CaptureImportInitialData;
  activeRecordingOpen: boolean;

  // Paste Extract Dialog
  pasteExtractDialogOpen: boolean;

  // Twitter / X Video Import Dialog
  twitterImportDialogOpen: boolean;

  // Theme & Density
  theme: "light" | "dark";
  densityMode: UIDensityMode;

  // Actions
  setCurrentView: (view: ViewName) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setDockPanelCollapsed: (collapsed: boolean) => void;
  openModal: (modal: string, data?: Record<string, unknown>) => void;
  closeModal: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setLectureCaptureRequested: (requested: boolean) => void;
  setCaptureImportDialogOpen: (
    open: boolean,
    initialRoute?: "record" | "import-media" | "import-transcript" | "import-url",
    initialData?: CaptureImportInitialData
  ) => void;
  setActiveRecordingOpen: (open: boolean) => void;
  setCommandPaletteQuery: (query: string) => void;
  setPasteExtractDialogOpen: (open: boolean) => void;
  setTwitterImportDialogOpen: (open: boolean) => void;
  setTheme: (theme: "light" | "dark") => void;
  setDensityMode: (mode: UIDensityMode) => void;
  toggleDensityMode: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  // Initial State
  currentView: "queue",
  sidebarCollapsed: false,
  dockPanelCollapsed: false,
  activeModal: null,
  modalData: {},
  commandPaletteOpen: false,
  lectureCaptureRequested: false,
  commandPaletteQuery: "",
  captureImportDialogOpen: false,
  captureImportInitialRoute: undefined,
  captureImportInitialData: undefined,
  activeRecordingOpen: false,
  pasteExtractDialogOpen: false,
  twitterImportDialogOpen: false,
  theme: "dark",
  densityMode: readInitialDensityMode(),

  // Actions
  setCurrentView: (currentView) => set({ currentView }),

  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

  setDockPanelCollapsed: (dockPanelCollapsed) => set({ dockPanelCollapsed }),

  openModal: (activeModal, modalData = {}) =>
    set({
      activeModal,
      modalData,
    }),

  closeModal: () =>
    set({
      activeModal: null,
      modalData: {},
    }),

  setCommandPaletteOpen: (commandPaletteOpen) =>
    set({
      commandPaletteOpen,
      commandPaletteQuery: commandPaletteOpen ? "" : "",
    }),

  setLectureCaptureRequested: (lectureCaptureRequested) =>
    set({
      lectureCaptureRequested,
      captureImportDialogOpen: lectureCaptureRequested ? true : false,
      captureImportInitialRoute: lectureCaptureRequested ? "record" : undefined,
      captureImportInitialData: undefined,
    }),

  setCaptureImportDialogOpen: (captureImportDialogOpen, captureImportInitialRoute, captureImportInitialData) =>
    set({ captureImportDialogOpen, captureImportInitialRoute, captureImportInitialData }),

  setActiveRecordingOpen: (activeRecordingOpen) => set({ activeRecordingOpen }),

  setCommandPaletteQuery: (commandPaletteQuery) => set({ commandPaletteQuery }),
  setPasteExtractDialogOpen: (pasteExtractDialogOpen) => set({ pasteExtractDialogOpen }),
  setTwitterImportDialogOpen: (twitterImportDialogOpen) => set({ twitterImportDialogOpen }),

  setTheme: (theme) => set({ theme }),

  setDensityMode: (densityMode) => {
    persistDensityMode(densityMode);
    set({ densityMode });
  },

  toggleDensityMode: () =>
    set((state) => {
      const next: UIDensityMode = state.densityMode === "zen" ? "architect" : "zen";
      persistDensityMode(next);
      return { densityMode: next };
    }),
}));
