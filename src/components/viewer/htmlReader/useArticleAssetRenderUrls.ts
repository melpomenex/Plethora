import { useEffect, useState } from "react";
import { getImageAssetById } from "../../../api/image-registry";
import { extractArticleAssetIds } from "../../../utils/articleImport/articleAssetScheme";

/**
 * Resolve `plethora-asset://` references in canonical article HTML to render URLs.
 */
export function useArticleAssetRenderUrls(html: string | undefined): Record<string, string> {
  const [renderUrls, setRenderUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!html?.trim()) {
      setRenderUrls({});
      return;
    }
    const ids = extractArticleAssetIds(html);
    if (ids.length === 0) {
      setRenderUrls({});
      return;
    }

    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            const asset = await getImageAssetById(id);
            if (asset?.data_url) next[id] = asset.data_url;
          } catch {
            // Missing assets degrade gracefully (prepareHtmlDocument drops the img).
          }
        })
      );
      if (!cancelled) setRenderUrls(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [html]);

  return renderUrls;
}
