import * as db from "../../lib/database";
import { isMarketingCaptureNamespace } from "../../lib/marketingCapture/namespace";
import { ISSUE6_CLOCK, ISSUE6_IDS, ISSUE6_SECTIONED_CONTENT } from "./fixtures";

/** Recreate only in the application's explicitly disposable IndexedDB namespace. */
export async function recreateIssue6BrowserFixture() {
  const name = db.getActiveDatabaseName();
  if (!isMarketingCaptureNamespace(name)) throw new Error("Issue 6 fixture requires a disposable database namespace.");
  db.closeDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Disposable fixture database is still open."));
  });
  await db.createDocument({
    id: ISSUE6_IDS.document, title: "Sectioned document", file_type: "md",
    content: ISSUE6_SECTIONED_CONTENT, date_added: ISSUE6_CLOCK,
    priority_slider: 75, priority_rating: 4, priority_score: 75,
    next_reading_date: "2026-10-22T12:00:00Z", stability: 8, difficulty: 4, reps: 2,
  });
  for (const [id, file_type] of [["issue6-html", "html"], ["issue6-pdf", "pdf"], ["issue6-epub", "epub"], [ISSUE6_IDS.video, "youtube"]]) {
    await db.createDocument({ id, file_type, title: `Fixture ${file_type}`, content: ISSUE6_SECTIONED_CONTENT, date_added: ISSUE6_CLOCK });
  }
  await db.createExtract({
    id: ISSUE6_IDS.extract, document_id: ISSUE6_IDS.document, content: "Second section body.",
    date_created: ISSUE6_CLOCK, next_review_date: "2026-10-28T12:00:00Z", review_count: 1, reps: 1,
  });
  await db.createImageAsset({
    id: "issue6-image", mime_type: "image/png", width: 1, height: 1, created_at: ISSUE6_CLOCK,
    base64_data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5WX2sAAAAASUVORK5CYII=",
  });
  for (const [index, id] of ISSUE6_IDS.cards.entries()) {
    const question = index === 2 ? "The {{c1::answer::hint}} is hidden." : "Fixture question?";
    await db.createLearningItem({
      id, document_id: ISSUE6_IDS.document, extract_id: ISSUE6_IDS.extract,
      item_type: index === 0 ? "basic" : index === 2 ? "cloze" : "qa", question, answer: "Answer",
      cloze_text: index === 2 ? question : undefined,
      image_asset_ids: index === 3 ? ["issue6-image"] : [],
      interaction_metadata: index === 3 ? { imageOcclusionAssetId: "issue6-image", imageOcclusionRegions: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.5 }] } : undefined,
      date_created: ISSUE6_CLOCK, due_date: "2026-10-28T12:00:00Z", review_count: 2,
      memory_state: { stability: 7, difficulty: 5 },
    });
  }
  return { document: await db.getDocument(ISSUE6_IDS.document), extract: await db.getExtract(ISSUE6_IDS.extract), cards: await db.getLearningItemsByDocument(ISSUE6_IDS.document) };
}
