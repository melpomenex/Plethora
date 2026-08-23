function fail(message) {
  throw new Error(`showcase-hotspots-v2: ${message}`);
}

const round = (value) => Number(value.toFixed(6));

export function normalizeBoundingBox(box, viewport) {
  if (!box || !viewport || viewport.width <= 0 || viewport.height <= 0) {
    fail("missing bounding box or viewport");
  }
  const clipped = {
    x: Math.max(0, box.x),
    y: Math.max(0, box.y),
    right: Math.min(viewport.width, box.x + box.width),
    bottom: Math.min(viewport.height, box.y + box.height),
  };
  if (clipped.right <= clipped.x || clipped.bottom <= clipped.y) {
    fail("control is outside the capture viewport");
  }
  return {
    x: round(clipped.x / viewport.width),
    y: round(clipped.y / viewport.height),
    width: round((clipped.right - clipped.x) / viewport.width),
    height: round((clipped.bottom - clipped.y) / viewport.height),
  };
}

async function uniqueVisibleLocator(page, selector, actionId) {
  const locator = page.locator(selector);
  const count = await locator.count();
  const visible = [];
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) visible.push(candidate);
  }
  if (visible.length !== 1) {
    fail(`action ${actionId} resolved to ${visible.length} visible controls (${count} total)`);
  }
  return visible[0];
}

export async function measureSceneHotspots(page, scene, viewport) {
  const hotspots = [];
  for (const action of scene.actions) {
    const control = await uniqueVisibleLocator(page, action.selector, action.id);
    const box = await control.boundingBox();
    if (!box) fail(`action ${action.id} has no rendered bounding box`);
    let rect;
    try {
      rect = normalizeBoundingBox(box, viewport);
    } catch (error) {
      fail(`action ${action.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    hotspots.push({
      id: action.id,
      actionLabel: action.label,
      nextSceneId: action.nextSceneId,
      selector: action.selector,
      rect,
    });
  }
  return hotspots;
}
