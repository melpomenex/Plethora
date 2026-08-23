import { invokeApple } from "./plugin";
import { appleErrorFromUnknown } from "./errors";

export interface AppleVisionDocument {
  text: string;
  html: string;
  blocks: Array<{ id: string; text: string }>;
  pageCount?: number;
  handwritingAdvertised?: boolean;
}

export async function applePresentScanner(): Promise<AppleVisionDocument> {
  try {
    return await invokeApple("apple_vision_present_scanner");
  } catch (error) {
    throw appleErrorFromUnknown(error);
  }
}

export async function appleRecognizeDocument(
  source: "bytes" | "camera" | "photo",
  bytesBase64?: string,
  path?: string,
): Promise<AppleVisionDocument> {
  try {
    return await invokeApple("apple_vision_recognize_document", {
      payload: { source, bytesBase64, path },
    });
  } catch (error) {
    throw appleErrorFromUnknown(error);
  }
}
