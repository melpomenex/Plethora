let capture: symbol | undefined;
/** Shared by composer and existing lecture capture. A busy owner is never stopped. */
export function acquireAudioCapture(): () => void {
  if (capture) throw new Error("busy: Another microphone session is active. Stop it before dictating.");
  const token = Symbol("audio-capture"); capture = token;
  return () => { if (capture === token) capture = undefined; };
}
