import { expect, it } from "vitest";
import { GLOBAL_AUDIO_PLAYBACK_ENABLED } from "../audioPlaybackRollout";

it("keeps production ownership disabled until platform and feature parity acceptance", () => {
  expect(GLOBAL_AUDIO_PLAYBACK_ENABLED).toBe(false);
});
