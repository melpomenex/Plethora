import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../index.css";
import { AudioDockPresentation } from "../../components/audio/MiniAudioPlayer";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { getGlobalAudioController } from "../../services/audio/audioRuntime";
import { useAudioPlaybackStore } from "../../stores/audioPlaybackStore";
import { storeBrowserFile } from "../../lib/browser-file-store";
import { openDatabase } from "../../lib/database";

// Deterministic PCM fixture. Production rollout stays off; this page opts into presentation only.
async function seedAudio() {
  const seconds = 120;
  const rate = 8000;
  const buffer = new ArrayBuffer(44 + seconds * rate * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, "WAVEfmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, buffer.byteLength - 44, true);
  for (let index = 0; index < seconds * rate; index++) view.setInt16(44 + index * 2, Math.round(Math.sin(index * 2 * Math.PI * 220 / rate) * 2000), true);
  const path = storeBrowserFile(new File([buffer], "deterministic-navigation.wav", { type: "audio/wav" }));
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("documents", "readwrite");
    tx.objectStore("documents").put({ id: "audio-owner-fixture", title: "A very long audiobook title for persistent playback during reading and review", file_type: "audio", file_path: path, content_hash: "fixture-v1", collection_id: "default", tags: "[]", date_added: new Date().toISOString(), date_modified: new Date().toISOString(), position_json: '{"type":"time","seconds":0}', metadata: "{}" });
    tx.objectStore("documents").put({ id: "audio-queue-fixture", title: "Next audiobook", file_type: "audio", file_path: path, content_hash: "fixture-v1", collection_id: "default", tags: "[]", date_added: new Date().toISOString(), date_modified: new Date().toISOString(), position_json: '{"type":"time","seconds":0}', metadata: "{}" });
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}

function Fixture() {
  const [page, setPage] = useState("Library");
  const [sourceOpen, setSourceOpen] = useState(true);
  const [answer, setAnswer] = useState(false);
  const mobile = new URLSearchParams(location.search).has("mobile");
  const queue = new URLSearchParams(location.search).has("queue") ? ["audio-owner-fixture", "audio-queue-fixture"].map(sourceId => ({ profileKey: "fixture", kind: "audiobook" as const, sourceId })) : undefined;
  const loaded = useAudioPlaybackStore(state => state.snapshot !== null);
  return <div className="adaptive-shell-root" style={{ "--shell-mobile-nav-height": mobile ? "58px" : "0px" } as React.CSSProperties}>
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 gap-3 border-b border-border p-4">{["Library", "Reader", "Notes", "Review"].map(name => <button key={name} onClick={() => setPage(name)}>{name}</button>)}</header>
      <main className="min-h-0 flex-1 overflow-auto p-4" style={{ paddingBottom: mobile && loaded ? "122px" : undefined }}>
        <h1 className="mb-4 text-xl font-medium">{page}</h1>
        {page === "Library" && sourceOpen && <section data-testid="source-view"><p>Deterministic audiobook source</p><button className="my-3 min-h-12 rounded-full bg-primary px-5 text-on-primary" onClick={() => void getGlobalAudioController().load({ profileKey: "fixture", kind: "audiobook", sourceId: "audio-owner-fixture" }, { intent: "play", queue })}>Play fixture</button><button className="ml-4" onClick={() => setSourceOpen(false)}>Close source tab</button></section>}
        {page === "Reader" && <article data-testid="reader" className="max-w-prose"><p>Reading position and annotations remain independent of audio.</p>{Array.from({ length: 24 }, (_, index) => <p key={index} className="my-4">Paragraph {index + 1}: The audio owner stays above navigation, responsive layout, and the source tab.</p>)}</article>}
        {page === "Notes" && <textarea aria-label="Notes" className="min-h-40 w-full border border-outline bg-surface p-3" defaultValue="Keep my notes" />}
        {page === "Review" && <section data-testid="review"><p>What owns playback?</p><button onClick={() => setAnswer(true)}>Reveal answer</button>{answer && <p>The application owner</p>}<button className="ml-3">Grade card</button></section>}
      </main>
      <AudioDockPresentation mobile={mobile} fullscreen={false} />
      {mobile && <nav style={{ position: "fixed", bottom: 0, height: 58, left: 0, right: 0 }} className="border-t border-outline bg-surface p-4">Mobile navigation</nav>}
    </div>
  </div>;
}

if (import.meta.env.DEV) {
  await seedAudio();
  getGlobalAudioController().initialize();
  createRoot(document.getElementById("root")!).render(<StrictMode><ThemeProvider><Fixture /></ThemeProvider></StrictMode>);
}
