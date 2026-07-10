import { useMemo } from "react";
import {
  type SectionNode,
  buildDocumentSections,
  convertPdfOutlineToSectionNodes,
  convertEpubTocToSectionNodes,
  buildSectionFocusedContext,
  flattenTree,
  buildIdMap,
  getCache,
  setCache,
  makeCacheKey,
  estimateTokens,
} from "../utils/sectionIndex";
import { useDocumentOutlineStore } from "../stores/documentOutlineStore";

interface UseDocumentSectionsOptions {
  documentId?: string;
  content?: unknown;
  pdfOutline?: Array<{ title: string; pageNumber?: number; items?: unknown[] }>;
  epubToc?: Array<{ label?: string; title?: string; href?: string; subitems?: unknown[] }>;
  contentHash?: string;
  useStoreOutline?: boolean;
}

interface UseDocumentSectionsReturn {
  tree: SectionNode[];
  flat: SectionNode[];
  isLoading: boolean;
  getById: (id: string) => SectionNode | undefined;
  breadcrumbsFor: (id: string) => string[];
  buildSectionFocusedContext: (ids: string[] | SectionNode[], maxTokens?: number) => string;
  getOutlineHash: string;
  tokenEstimateFor: (id: string) => number;
}

function normalizeContent(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Uint8Array) {
    try {
      return new TextDecoder().decode(input.slice(0, 10000));
    } catch {
      return "";
    }
  }
  if (Array.isArray(input) && input.length > 0 && typeof input[0] === "number") {
    try {
      return String.fromCharCode(...(input as number[]).slice(0, 5000));
    } catch {
      return "";
    }
  }
  if (input && typeof (input as any).toString === "function") {
    const s = (input as any).toString();
    if (s !== "[object Object]" && typeof s === "string") return s;
  }
  return "";
}

function hashContent(content: unknown): string {
  const str = normalizeContent(content);
  if (!str) return "empty";
  let h = 0;
  const len = Math.min(str.length, 2000);
  for (let i = 0; i < len; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return `${str.length}-${h}`;
}

function hashOutline(outline: unknown): string {
  if (!outline) return "no-outline";
  try {
    const s = JSON.stringify(outline);
    let h = 0;
    for (let i = 0; i < Math.min(s.length, 2000); i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return `${s.length}-${h}`;
  } catch {
    return "outline";
  }
}

export function useDocumentSections(options: UseDocumentSectionsOptions): UseDocumentSectionsReturn {
  const { documentId, content: rawContent = "", pdfOutline, epubToc, contentHash, useStoreOutline = true } = options;

  const content = useMemo(() => normalizeContent(rawContent), [rawContent]);

  const outlineStore = useDocumentOutlineStore((s) => s.outlineByDocId);

  const resolvedPdfOutline = useMemo(() => {
    if (pdfOutline) return pdfOutline;
    if (useStoreOutline && documentId) {
      const entry = outlineStore.get(documentId);
      return entry?.pdfOutline;
    }
    return undefined;
  }, [pdfOutline, outlineStore, documentId, useStoreOutline]);

  const resolvedEpubToc = useMemo(() => {
    if (epubToc) return epubToc;
    if (useStoreOutline && documentId) {
      const entry = outlineStore.get(documentId);
      return entry?.epubToc;
    }
    return undefined;
  }, [epubToc, outlineStore, documentId, useStoreOutline]);

  const contentHashResolved = useMemo(() => {
    if (contentHash) return contentHash;
    return hashContent(content);
  }, [contentHash, content]);

  const outlineHash = useMemo(() => {
    return `${hashOutline(resolvedPdfOutline)}:${hashOutline(resolvedEpubToc)}`;
  }, [resolvedPdfOutline, resolvedEpubToc]);

  const { tree, flat } = useMemo(() => {
    if (!content && !resolvedPdfOutline && !resolvedEpubToc) {
      return { tree: [] as SectionNode[], flat: [] as SectionNode[] };
    }

    const docId = documentId || "unknown";
    const cacheKey = makeCacheKey(docId, contentHashResolved, outlineHash);
    const cached = getCache(cacheKey);
    if (cached) {
      return { tree: cached.tree, flat: cached.flat };
    }

    let outlineNodes: SectionNode[] = [];

    if (resolvedPdfOutline && resolvedPdfOutline.length > 0) {
      outlineNodes = convertPdfOutlineToSectionNodes(resolvedPdfOutline, content);
    } else if (resolvedEpubToc && resolvedEpubToc.length > 0) {
      outlineNodes = convertEpubTocToSectionNodes(resolvedEpubToc as never);
    }

    const { tree: builtTree, flat: builtFlat } = buildDocumentSections(content, outlineNodes.length > 0 ? outlineNodes : undefined);

    const finalTree = builtTree;
    const finalFlat = builtFlat.length > 0 ? builtFlat : flattenTree(finalTree);

    setCache(cacheKey, { tree: finalTree, flat: finalFlat, hash: `${contentHashResolved}:${outlineHash}` });

    return { tree: finalTree, flat: finalFlat };
  }, [content, resolvedPdfOutline, resolvedEpubToc, contentHashResolved, outlineHash, documentId]);

  const idMap = useMemo(() => buildIdMap(flat), [flat]);

  const getById = useMemo(() => {
    return (id: string) => idMap.get(id);
  }, [idMap]);

  const breadcrumbsFor = useMemo(() => {
    return (id: string) => {
      const node = idMap.get(id);
      if (!node) return [];
      return [...node.breadcrumb, node.title];
    };
  }, [idMap]);

  const buildContext = useMemo(() => {
    return (ids: string[] | SectionNode[], maxTokens = 4000) => {
      const nodes: SectionNode[] = (ids as unknown[]).map((item) => {
        if (typeof item === "string") return idMap.get(item);
        return item as SectionNode;
      }).filter(Boolean) as SectionNode[];

      return buildSectionFocusedContext(nodes, content, { maxTokens });
    };
  }, [idMap, content]);

  const tokenEstimateFor = useMemo(() => {
    return (id: string) => {
      const node = idMap.get(id);
      if (!node) return 0;
      return estimateTokens(node.content);
    };
  }, [idMap]);

  return {
    tree,
    flat,
    isLoading: false,
    getById,
    breadcrumbsFor,
    buildSectionFocusedContext: buildContext,
    getOutlineHash: outlineHash,
    tokenEstimateFor,
  };
}
