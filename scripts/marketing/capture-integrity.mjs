function fail(message) {
  throw new Error(`showcase-capture-integrity: ${message}`);
}

export async function assertCapturePageIntegrity(page, options) {
  const externalRequests = options.requestUrls.filter((url) => {
    if (url.startsWith("data:") || url.startsWith("blob:")) return false;
    try {
      return new URL(url).origin !== options.captureOrigin;
    } catch {
      return true;
    }
  });
  if (externalRequests.length > 0) fail(`unexpected request domains: ${externalRequests.join(", ")}`);

  const result = await page.evaluate(({ scene, expected, fixtureTitles }) => {
    const documents = [document];
    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
      try {
        if (frame.contentDocument) documents.push(frame.contentDocument);
      } catch {}
    }
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden";
    };
    const text = documents.map((doc) => doc.body?.innerText ?? doc.body?.textContent ?? "").join("\n");
    const problems = [];
    if (text.replace(/\s+/g, " ").trim().length < 80) problems.push("zero-document/insufficient rendered text");
    if (/PLACEHOLDER|placeholder-unreleased|Preparing article|Loading\.\.\.|Startup Error/i.test(text)) {
      problems.push("placeholder or loading label is visible");
    }
    for (const doc of documents) {
      if (Array.from(doc.querySelectorAll('.animate-pulse[aria-hidden="true"]')).some(visible)) problems.push("visible skeleton");
      if (Array.from(doc.querySelectorAll('.toast-container [role="alert"]')).some(visible)) problems.push("visible error/info toast");
      for (const image of Array.from(doc.images).filter(visible)) {
        const source = image.currentSrc || image.src;
        if (source && !source.startsWith("blob:") && !source.startsWith("data:") && new URL(source, location.href).origin !== location.origin) {
          problems.push(`unexpected image domain: ${source}`);
        }
        if (image.alt && !fixtureTitles.includes(image.alt) && image.alt !== "Plethora") {
          problems.push(`unexpected visible image title: ${image.alt}`);
        }
      }
    }
    for (const action of scene.actions) {
      const matches = Array.from(document.querySelectorAll(action.selector)).filter(visible);
      if (matches.length !== 1) problems.push(`missing or duplicate control ${action.id}: ${matches.length}`);
    }
    const bootstrap = globalThis.__PLETHORA_MARKETING_CAPTURE__;
    const identity = {
      fixtureHash: document.body.dataset.marketingFixtureHash,
      fixtureVersion: document.body.dataset.marketingFixtureVersion,
      buildId: document.body.dataset.marketingBuildId,
      bootstrapHash: bootstrap?.fixtureHash,
    };
    if (identity.fixtureHash !== expected.fixtureHash || identity.bootstrapHash !== expected.fixtureHash) problems.push("fixture hash mismatch");
    if (identity.fixtureVersion !== expected.fixtureVersion) problems.push("fixture version mismatch");
    if (identity.buildId !== expected.buildId) problems.push("capture build ID mismatch");
    return { problems, identity };
  }, {
    scene: options.scene,
    expected: {
      fixtureHash: options.catalog.metadata.fixtureHash,
      fixtureVersion: options.catalog.metadata.fixtureVersion,
      buildId: options.buildId,
    },
    fixtureTitles: options.fixtureTitles,
  });
  if (result.problems.length > 0) fail(`${options.scene.id}/${options.layout}: ${result.problems.join("; ")}`);
  return result;
}
