import type { QueryClient } from "@tanstack/react-query";
import type { VideoExtract } from "../api/video-extracts";

export const videoExtractKeys = {
  all: ["video-extracts"] as const,
  list: (documentId: string) => ["video-extracts", "document", documentId] as const,
  library: (collectionId?: string) => ["video-extracts", "all", collectionId ?? "default"] as const,
  candidates: (documentId?: string) => ["video-extracts", "candidates", documentId ?? "all"] as const,
};

export function patchVideoExtractCaches(queryClient: QueryClient, extract: VideoExtract): void {
  queryClient.setQueryData<VideoExtract[]>(videoExtractKeys.list(extract.document_id), (items) => {
    if (!items) return items;
    const index = items.findIndex((item) => item.id === extract.id);
    if (index < 0) return [...items, extract].sort((a, b) => a.start_time - b.start_time);
    return items.map((item) => item.id === extract.id ? extract : item);
  });
  queryClient.setQueriesData<VideoExtract[]>({ queryKey: videoExtractKeys.all }, (items) => {
    if (!Array.isArray(items)) return items;
    const index = items.findIndex((item) => item.id === extract.id);
    if (index < 0) return items;
    return items.map((item) => item.id === extract.id ? extract : item);
  });
}

export function removeVideoExtractFromCaches(queryClient: QueryClient, extractId: string): void {
  queryClient.setQueriesData<VideoExtract[]>({ queryKey: videoExtractKeys.all }, (items) => {
    if (!Array.isArray(items)) return items;
    return items.filter((item) => item.id !== extractId);
  });
}
