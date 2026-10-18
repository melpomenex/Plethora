/**
 * Harness for the Audiobooks shelf's Audio Editions layout.
 *
 * Renders the real `AudiobooksTab` against a seeded Audio Edition (long title,
 * six sections) so the responsive card layout can be measured at phone and
 * desktop pane widths. See `audiobooks-tab-layout.visual.spec.ts`.
 */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { AudiobooksTab } from "../components/tabs/AudiobooksTab";
import { createAudioEdition } from "../api/audioEditions";
import { useDocumentStore } from "../stores";
import type { Document } from "../types/document";
import type { AudioEdition, AudioEditionSection } from "../types/audioEdition";

const doc = {
  id: "doc-1",
  title: "Biology Might Not Be Quantum, but Its Math Is Quantumlike",
  author: "Michael Pollan",
  type: "epub",
  content: "",
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as Document;

const sections = Array.from({ length: 6 }, (_, i) => ({
  id: `sec-${i}`,
  editionId: "edition-1",
  index: i,
  title: `Section ${i + 1}`,
  text: "text",
  startAnchor: "",
  endAnchor: "",
  durationSec: 60,
  generationStatus: "ready",
  audioUrl: "",
})) as unknown as AudioEditionSection[];

const edition = {
  id: "edition-1",
  sourceDocumentId: "doc-1",
  provider: "pocket",
  model: "default",
  voice: "alba",
  status: "generating",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  generationSettings: {},
} as unknown as AudioEdition;

function Harness() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void createAudioEdition(edition, sections).then(() => setReady(true));
    // The tab calls loadDocuments() on mount, which replaces the list from
    // IndexedDB. Keep re-seeding until the shelf has the document.
    const seed = setInterval(() => {
      useDocumentStore.setState({ documents: [doc] });
    }, 200);
    const stop = setTimeout(() => clearInterval(seed), 5000);
    return () => {
      clearInterval(seed);
      clearTimeout(stop);
    };
  }, []);

  if (!ready) return null;
  return <AudiobooksTab />;
}

createRoot(document.getElementById("root")!).render(<Harness />);
