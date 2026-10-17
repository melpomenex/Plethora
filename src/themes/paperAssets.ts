import type { ResolvedPaper } from "./resolveThemeAppearance";
const decodes = new Map<string, Promise<void>>();
function decode(url: string): Promise<void> {
  if (!decodes.has(url)) {
    const image = new Image();
    image.src = url;
    const promise =
      typeof image.decode === "function"
        ? image.decode()
        : new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("Paper asset unavailable"));
          });
    decodes.set(url, promise);
    if (decodes.size > 4) decodes.delete(decodes.keys().next().value);
  }
  return decodes.get(url)!;
}
export function preparePaperAssets(paper: ResolvedPaper): Promise<void> {
  return Promise.all([decode(paper.grainUrl), decode(paper.variationUrl)]).then(() => undefined);
}
