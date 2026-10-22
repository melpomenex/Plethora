/**
 * Layering fixture for the New Queue dialog.
 *
 * Renders the real `SessionCustomizeModal` over a stand-in for the mobile
 * bottom navigation (`#bottom-toolbar`: fixed, 56px, `z-index: 1000` — the
 * exact values of `.mobile-bottom-nav`) so a browser check can prove that the
 * dialog and its scrim cover the navigation, that every action is the hit
 * target at its own center point, and that the destination behind the overlay
 * stays inert until dismissal.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "../styles/mobile.css";
import { ThemeProvider } from "../contexts/ThemeContext";
import { PresentationProvider } from "../contexts/PresentationContext";
import { useVisualViewport } from "../hooks/useVisualViewport";
import {
  SessionCustomizeModal,
  DEFAULT_CUSTOMIZATION,
} from "../components/review/SessionCustomizeModal";
import { useSavedQueueStore } from "../stores/savedQueueStore";
import type { SavedQueue } from "../types/savedQueue";

const crowded = new URLSearchParams(window.location.search).has("crowded");
const activeQueue: SavedQueue = {
  id: "q-active",
  name: crowded ? "Research queue with a deliberately long descriptive name for wrapping" : "All Due",
  isDefault: true,
  sortOrder: 0,
  filters: {
    categories: [],
    tags: [],
    priorityRange: { min: 0, max: 100 },
    excludeSuspended: true,
  },
  itemTypes: { documents: true, extracts: true, learningItems: true },
  sessionDurationMinutes: 60,
  maxItems: 50,
  createdAt: "2026-10-16T00:00:00Z",
  updatedAt: "2026-10-16T00:00:00Z",
};

useSavedQueueStore.setState({
  savedQueues: [activeQueue],
  activeQueueId: activeQueue.id,
  isLoading: false,
  error: null,
});

/** Observable destination state, so the check can prove the nav stayed inert. */
const harnessState = { toolbarClicks: 0, destination: "queue" };

function Harness() {
  useVisualViewport();
  const [open, setOpen] = useState(false);
  const [customization, setCustomization] = useState(DEFAULT_CUSTOMIZATION);

  return (
    <div className="min-h-dvh bg-background p-3 text-foreground">
      <header className="flex flex-col items-start gap-2">
        <button
          type="button"
          className="min-h-11 rounded border border-border px-3"
          onClick={() => setOpen(true)}
        >
          New Queue
        </button>
        <p id="destination-label">destination: {harnessState.destination}</p>
      </header>

      <nav
        id="bottom-toolbar"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: 56,
          zIndex: 1000,
          background: "#444",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <button
          id="toolbar-destination"
          style={{ minHeight: 44 }}
          onClick={() => {
            harnessState.toolbarClicks += 1;
            harnessState.destination = "documents";
            document.getElementById("destination-label")!.textContent =
              "destination: documents";
          }}
        >
          Background navigation
        </button>
      </nav>

      <SessionCustomizeModal
        isOpen={open}
        onClose={() => setOpen(false)}
        customization={customization}
        onChange={setCustomization}
        onApply={() => setOpen(false)}
        availableTags={crowded ? Array.from({ length: 100 }, (_, index) => `Research topic ${index + 1} with a longer label`) : [
          "web-import",
          "readergrev.com",
          "Rel Noopener",
          "Biology",
          "History",
          "Physics",
        ]}
        availableCategories={["Default"]}
      />
    </div>
  );
}

declare global {
  interface Window {
    sessionCustomizeHarness: typeof harnessState;
  }
}
window.sessionCustomizeHarness = harnessState;

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <PresentationProvider>
      <Harness />
    </PresentationProvider>
  </ThemeProvider>,
);
