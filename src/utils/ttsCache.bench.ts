import { bench } from "vitest";
import { digestText128, digestJson128, makeTTSCacheKeyV2 } from "./ttsCache";
import { seededRandom } from "../test/bench-support";

const rand = seededRandom(42);
let sink = 0;
const texts = Array.from({ length: 100 }, () => Array.from({ length: 80 }, () => String.fromCharCode(97 + Math.floor(rand()*26))).join(""));

bench("digestText128", () => {
  let s=0;
  for (const t of texts) s+=digestText128(t).length;
  sink=s;
});
bench("digestJson128", () => {
  let s=0;
  for (let i=0;i<50;i++) s+=digestJson128({a:i,b:texts[i%texts.length]}).length;
  sink=s;
});
bench("makeTTSCacheKeyV2", () => {
  let s=0;
  for (let i=0;i<50;i++) s+=makeTTSCacheKeyV2({ provider:"elevenlabs", model:"m", voice:"v", speed:1, format:"mp3", text:texts[i%texts.length], instructions:"hello", presetDigest:"", supportsInstructions:true, supportsLanguage:false }).length;
  sink=s;
});
export { sink };
