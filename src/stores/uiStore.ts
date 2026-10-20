import { create } from "zustand";
import { ViewName } from "../types";

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

  // Theme
  theme: "light" | "dark";

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
}));
