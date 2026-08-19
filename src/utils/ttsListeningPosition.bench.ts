import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import { ReaderSpeechIndex } from "./readerSpeechIndex";
import { resolveListeningPosition, fingerprintDocument } from "./ttsListeningPosition";

const rand = seededRandom(7);
let sink=0;
const sections = Array.from({length:20},(_,i)=>({ key:`sec-${i}`, text: Array.from({length:200},()=>String.fromCharCode(97+Math.floor(rand()*26))).join(" ")}));
const idx = new ReaderSpeechIndex(sections);
const pos = { documentId:"doc1", profileId:"anon", updatedAt: Date.now(), textFingerprint: fingerprintDocument(sections.map(s=>s.text).join(" ")), speechFingerprint:"", provider:"fal", model:"m", voiceId:"v", stableAnchor: idx.chunks[Math.floor(idx.chunks.length/2)]?.words[0]?.anchor ?? { kind:"text" as const, surface:"a", startOffset:0 }, chunkIndex:5, chunkTextHash:"", wordIndex:0, normalizedCharOffset:0, intraChunkMs: null, surroundingText:"hello world", scrollPercentHint: null, cfi:null, pageNumber:null };

bench("resolveListeningPosition", () => {
  const r = resolveListeningPosition(idx, pos as any);
  sink = r ? r.chunkIndex : -1;
});
bench("fingerprintDocument", () => {
  const f = fingerprintDocument(sections.map(s=>s.text).join(" "));
  sink = f.length;
});
export { sink };
