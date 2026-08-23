import type { MarketingSceneApplication } from "./sceneApplicators";

const BLOCKING_TEXT = [
  "Loading...",
  "Preparing article",
  "Startup Error",
  "No preview available.",
  "PLACEHOLDER",
];

function sameOriginDocuments(root: Document): Document[] {
  const documents = [root];
  for (const frame of Array.from(root.querySelectorAll("iframe"))) {
    try {
      if (frame.contentDocument) documents.push(...sameOriginDocuments(frame.contentDocument));
    } catch {
      // Cross-origin frames cannot participate in a deterministic capture.
    }
  }
  return documents;
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style?.display !== "none" && style?.visibility !== "hidden";
}

function renderedText(documents: Document[]): string {
  return documents.map((doc) => doc.body?.innerText ?? doc.body?.textContent ?? "").join("\n");
}

export function marketingReadinessIssue(
  application: MarketingSceneApplication,
  root: Document = document,
): string | null {
  const body = root.body;
  if (body.dataset.marketingFixtureCommitted !== "true") return "fixture transaction is not committed";
  if (body.dataset.marketingStateApplied !== "true") return "scene state is not applied";
  if (body.dataset.marketingSurface !== application.surface) return "resolved product surface does not match the scene";
  if (body.dataset.marketingReaderReady === "error") return body.dataset.marketingError ?? "reader scene failed";
  if (application.reader && body.dataset.marketingReaderReady !== "1") return "reader target geometry is not applied";
  if (application.connectionContext && body.dataset.marketingConnectionsReady !== "1") {
    return "connection graph viewport is not settled";
  }

  const documents = sameOriginDocuments(root);
  const text = renderedText(documents);
  for (const sentinel of application.sentinels) {
    if (!text.includes(sentinel)) return `missing sentinel: ${sentinel}`;
  }
  for (const blocked of BLOCKING_TEXT) {
    if (text.includes(blocked)) return `blocking placeholder text is visible: ${blocked}`;
  }

  for (const doc of documents) {
    const skeleton = Array.from(doc.querySelectorAll(".animate-pulse[aria-hidden=\"true\"]")).find(isVisible);
    if (skeleton) return "visible skeleton remains";
    const alert = Array.from(doc.querySelectorAll(".toast-container [role=\"alert\"]")).find(isVisible);
    if (alert) return `visible toast remains: ${(alert.textContent ?? "").trim()}`;
    for (const image of Array.from(doc.images)) {
      if (isVisible(image) && (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0)) {
        return `visible image is not decoded: ${image.currentSrc || image.src || image.alt}`;
      }
    }
  }
  return null;
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function layoutSnapshot(root: Document): string {
  const documents = sameOriginDocuments(root);
  const measurements = documents.flatMap((doc, documentIndex) =>
    Array.from(doc.querySelectorAll("[data-showcase-action], [data-showcase-region], img"))
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return [documentIndex, element.getAttribute("data-showcase-action") ?? element.getAttribute("data-showcase-region") ?? element.tagName, rect.x, rect.y, rect.width, rect.height];
      }),
  );
  return JSON.stringify(measurements);
}

async function awaitFontsAndImages(root: Document): Promise<void> {
  const documents = sameOriginDocuments(root);
  await Promise.all(documents.map((doc) => doc.fonts?.ready ?? Promise.resolve()));
  await Promise.all(documents.flatMap((doc) =>
    Array.from(doc.images)
      .filter(isVisible)
      .map((image) => image.decode()),
  ));
}

export async function waitForMarketingReadiness(
  application: MarketingSceneApplication,
  options: { root?: Document; timeoutMs?: number } = {},
): Promise<void> {
  const root = options.root ?? document;
  const timeoutMs = options.timeoutMs ?? 45_000;
  const deadline = performance.now() + timeoutMs;
  let issue = "scene has not rendered";
  while (performance.now() < deadline) {
    issue = marketingReadinessIssue(application, root) ?? "";
    if (!issue) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (issue) throw new Error(`Marketing scene readiness timed out: ${issue}`);

  await awaitFontsAndImages(root);
  let previous = "";
  let stableFrames = 0;
  while (performance.now() < deadline && stableFrames < 3) {
    await frame();
    const next = layoutSnapshot(root);
    stableFrames = next === previous ? stableFrames + 1 : 0;
    previous = next;
  }
  if (stableFrames < 3) throw new Error("Marketing scene layout did not stabilize across animation frames");
  const finalIssue = marketingReadinessIssue(application, root);
  if (finalIssue) throw new Error(`Marketing scene became unready: ${finalIssue}`);
}
