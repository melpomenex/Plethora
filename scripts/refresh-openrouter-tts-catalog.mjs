import { writeFile } from "node:fs/promises";

const url = "https://openrouter.ai/api/v1/models?output_modalities=speech";
const response = await fetch(url);
if (!response.ok) throw new Error(`OpenRouter catalog request failed: ${response.status}`);
const payload = await response.json();
const models = Array.isArray(payload.data) ? payload.data : [];
await writeFile(
  new URL("../src/api/tts/openrouter-speech-models.snapshot.json", import.meta.url),
  `${JSON.stringify(models, null, 2)}\n`,
);
console.log(`Wrote ${models.length} OpenRouter speech models.`);
