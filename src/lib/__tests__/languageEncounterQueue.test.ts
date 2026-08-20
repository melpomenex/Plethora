import { describe, expect, it, vi } from "vitest";
import { LanguageEncounterQueue } from "../languageEncounterQueue";
import type { EncounterInput } from "../../types/languageLexicon";

const input = (tokenId: string): EncounterInput => ({
  profileId: "profile-1",
  languageTag: "es",
  surface: tokenId,
  tokenId,
});
describe("LanguageEncounterQueue", () => {
  it("coalesces stable source identities and merges interaction flags", async () => {
    const writer = vi.fn().mockResolvedValue({ accepted: 1, coalesced: 0, entries: [] });
    const queue = new LanguageEncounterQueue({ writer, retryDelayMs: 0 });
    queue.enqueue({ ...input("hola"), wasInteracted: false });
    queue.enqueue({ ...input("hola"), wasInteracted: true, contextText: "Hola mundo" });
    expect(queue.size()).toBe(1);
    await queue.flush();
    expect(writer).toHaveBeenCalledWith([expect.objectContaining({ wasInteracted: true, contextText: "Hola mundo" })]);
  });

  it("retries transient failures and supports cancellation", async () => {
    const writer = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ accepted: 1, coalesced: 0, entries: [] });
    const queue = new LanguageEncounterQueue({ writer, maxRetries: 2, retryDelayMs: 0 });
    queue.enqueue(input("hola"));
    await queue.flush();
    expect(writer).toHaveBeenCalledTimes(2);
    queue.enqueue(input("adios"));
    queue.cancel();
    await queue.flush();
    expect(queue.size()).toBe(0);
  });
});
