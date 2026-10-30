import { expect, test } from "@playwright/test";

test("issue 6 browser fixture recreates an isolated production IndexedDB", async ({ page }) => {
  await page.goto("/src/lib/marketingCapture/namespace.ts");
  const result = await page.evaluate(async () => {
    (globalThis as typeof globalThis & { __PLETHORA_CAPTURE_DATABASE__: string }).__PLETHORA_CAPTURE_DATABASE__ = "plethora-marketing-capture-v2-0000000000000006";
    const modulePath = "/src/test/issue6/browserFixture.ts";
    const fixture = await import(/* @vite-ignore */ modulePath);
    const first = await fixture.recreateIssue6BrowserFixture();
    const second = await fixture.recreateIssue6BrowserFixture();
    const cardModule = "/src/lib/browserAssistantCards.ts";
    const databaseModule = "/src/lib/database.ts";
    const { createBrowserAssistantCard } = await import(/* @vite-ignore */ cardModule);
    const db = await import(/* @vite-ignore */ databaseModule);
    const providerModule = "/src/test/issue6/fixtures.ts";
    const { createIssue6Provider } = await import(/* @vite-ignore */ providerModule);
    const provider = createIssue6Provider();
    const generated = await provider.generate({ documentId: "issue6-document", sourceContent: "Second section body." });
    const receipt = await createBrowserAssistantCard("qa", { document_id: "extract:issue6-extract", ...generated.cards[0] });
    const persisted = await db.getLearningItem(receipt.id);
    let rejected = false;
    try {
      await createBrowserAssistantCard("qa", { document_id: "issue6-html", extract_id: "issue6-extract", question: "Q", answer: "A" });
    } catch { rejected = true; }
    const after = await db.getLearningItems();
    return { first, second, receipt, persisted, rejected, countAfter: after.length };
  });
  for (const snapshot of [result.first, result.second]) {
    expect(snapshot.document.id).toBe("issue6-document");
    expect(snapshot.document.learning_item_count).toBe(4);
    expect(snapshot.extract.document_id).toBe("issue6-document");
    expect(snapshot.cards).toHaveLength(4);
    expect(snapshot.cards.every((card: { extract_id: string }) => card.extract_id === "issue6-extract")).toBe(true);
    expect(snapshot.cards.find((card: { id: string }) => card.id === "issue6-cloze").due_date).toBe("2026-10-28T12:00:00Z");
  }
  expect(result.receipt).toMatchObject({ success: true, document_id: "issue6-document", extract_id: "issue6-extract" });
  expect(result.persisted).toMatchObject({ document_id: "issue6-document", extract_id: "issue6-extract", question: "What is in the second section?", answer: "Second section body." });
  expect(result.rejected).toBe(true);
  expect(result.countAfter).toBe(5);
});
