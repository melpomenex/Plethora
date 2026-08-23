import { invokeApple } from "./plugin";
import { appleErrorFromUnknown } from "./errors";

export async function appleEmbedTexts(texts: string[], language?: string) {
  try {
    return await invokeApple<{
      vectors: number[][];
      dimension: number;
      provider: string;
      language: string;
      revision: string;
    }>("apple_nl_embed_texts", { payload: { texts, language } });
  } catch (error) {
    throw appleErrorFromUnknown(error);
  }
}
