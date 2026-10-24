export interface PausableVideo {
  pauseVideo(): void | Promise<void>;
  getPlayerState(): number | Promise<number>;
}

/** YouTube's pause command is asynchronous; focus cannot transfer until its player stops. */
export async function acknowledgeVideoPause(player: PausableVideo, alive: () => boolean = () => true): Promise<void> {
  if (!alive()) return;
  await player.pauseVideo();
  const deadline = Date.now() + 1800;
  while (alive()) {
    const state = await player.getPlayerState();
    if (state !== 1 && state !== 3) return;
    if (Date.now() >= deadline) throw new Error("Video did not acknowledge pause");
    await new Promise(resolve => setTimeout(resolve, 40));
  }
}
