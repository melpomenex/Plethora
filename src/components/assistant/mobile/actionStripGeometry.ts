/** Optional chrome yields before the sheet loses its partial stop. */
export function actionStripGeometry(chrome: number, renderedStripHeight: number, partialHeight: number, suppressed: boolean) {
  const optionalHeight = renderedStripHeight > 0 ? renderedStripHeight + 8 : 56;
  const baseChrome = chrome - (renderedStripHeight > 0 ? optionalHeight : 0);
  return {
    suppress: baseChrome + 96 + optionalHeight > partialHeight - (suppressed ? 16 : 0),
    singleDetent: baseChrome + 96 > partialHeight,
  };
}
