/** Development-only fixture: all documents and saved answers below are synthetic. */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { ThemeProvider, useTheme } from "../contexts/ThemeContext";
import { PresentationProvider } from "../contexts/PresentationContext";
import { DocumentQATab } from "../components/tabs/DocumentQATab";
import { createSession, saveSessions, setActiveSessionId } from "../components/tabs/documentQaSessions";
import { useDocumentQAStore } from "../stores/documentQAStore";
import { useDocumentStore } from "../stores/documentStore";
import { useTabsStore } from "../stores/tabsStore";
import { useCollectionStore } from "../stores/collectionStore";
import { createDocument as seedDocument } from "../lib/database";
import type { Document } from "../types/document";
import { useLibraryAskHandoffStore } from "../commandPalette/libraryAskHandoff";

// Match the application's default UI-font setup; the fixture does not run main.tsx.
const fontPin = document.createElement("style");
fontPin.textContent = ':root { --font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif !important; }';
document.head.appendChild(fontPin);

const passage = "Retrieval practice strengthens long-term retention by requiring learners to reconstruct an idea from memory.";
const passageTwo = "Spacing learning over time improves retention, particularly when retrieval requires effort.";
const docs = [
  { id: "qa-fixture-memory", title: "How We Learn: Memory and Attention", content: passage },
  { id: "qa-fixture-spacing", title: "Spacing, Retrieval, and the Science of Remembering", content: passageTwo },
].map((doc) => ({ ...doc, filePath: `/fixture/${doc.id}.md`, fileType: "markdown", tags: [], dateModified: "2026-10-15", collectionId: "qa-fixture" })) as Document[];
await Promise.all(docs.map((doc) => seedDocument({ id: doc.id, title: doc.title, file_type: doc.fileType, file_path: doc.filePath, content: doc.content })));
useCollectionStore.setState({ activeCollectionId: "qa-fixture", collections: [] });

function seed(scenario: string) {
  useDocumentQAStore.setState({ messages: [], isProcessing: false });
  useLibraryAskHandoffStore.getState().consumeAsk();
  useDocumentStore.setState({ documents: scenario === "empty-library" ? [] : docs, currentDocument: null, hasCompletedFirstLoad: true });
  const past = createSession({ title: "Memory and attention", selectedDocumentId: docs[0].id, documentName: docs[0].title,
    draft: { text: "How does attention affect recall?", sections: [] }, messages: [] });
  const active = createSession({ selectedDocumentId: scenario === "missing-source" ? "deleted-document" : "",
    messages: scenario === "conversation" ? [
      { id: "fixture-question", role: "user", content: "How do retrieval practice and spacing work together?", timestamp: 1792022400000 },
      { id: "fixture-answer", role: "assistant", content: "Retrieval practice asks you to reconstruct an idea rather than reread it. Spacing makes that reconstruction more effortful by allowing time to pass. Together, they help make knowledge easier to recall later. [1] [2]\n\nA useful routine is to close the source, explain the idea in your own words, then return to it after a delay.", timestamp: 1792022401000,
        submittedScope: { label: "Whole Library", documentIds: docs.map((doc) => doc.id), webSearch: false },
        evidence: { level: "supported", mode: "semantic", retrievalOnly: false, documentCount: 2 },
        citations: docs.map((doc, index) => ({ documentId: doc.id, documentTitle: doc.title, chunkIndex: 0, chunkText: doc.content!, score: 1, citationNumber: index + 1 })),
      },
    ] : [],
  });
  saveSessions([active, past]); setActiveSessionId(active.id);
}
seed("start");

function Harness() {
  const { themes, setTheme } = useTheme();
  const [version, setVersion] = useState(0);
  const pendingTheme = useRef("obsidian-noir");
  useEffect(() => { if (themes.some((theme) => theme.id === pendingTheme.current)) setTheme(pendingTheme.current); }, [themes, setTheme]);
  window.qaHarness = {
    scenario: (name) => { seed(name); setVersion((value) => value + 1); },
    setTheme: (name) => { pendingTheme.current = name; setTheme(name); },
    openedTabs: () => useTabsStore.getState().tabs.map((tab) => ({ type: tab.type, data: tab.data })),
  };
  return <main style={{ height: "100dvh" }}><DocumentQATab key={version} /></main>;
}

declare global {
  interface Window { qaHarness: {
    scenario: (name: string) => void; setTheme: (name: string) => void;
    openedTabs: () => { type: string; data?: Record<string, unknown> }[];
  }; }
}
createRoot(document.getElementById("root")!).render(<ThemeProvider defaultTheme="obsidian-noir"><PresentationProvider><Harness /></PresentationProvider></ThemeProvider>);
