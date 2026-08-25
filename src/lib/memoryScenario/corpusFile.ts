/**
 * Corpus file access for the scenario host: read a provisioned corpus file
 * as text. Reuses the documents API's file read (the same command the
 * document import path uses); inert outside scenario mode because only the
 * executor calls it.
 */

import { readDocumentFile } from "../../api/documents";

export async function readFileText(path: string): Promise<string> {
  const bytes = await readDocumentFile(path);
  return new TextDecoder("utf-8").decode(bytes);
}
