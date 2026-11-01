import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createVideoExtract,
  deleteVideoExtract,
  getAllVideoExtracts,
  getVideoExtractReviewCandidates,
  getVideoExtracts,
  postponeVideoExtract,
  setVideoExtractQueueMembership,
  updateVideoExtract,
  type CreateVideoExtractInput,
  type UpdateVideoExtractInput,
  type VideoExtract,
} from "../api/video-extracts";
import { useQueueStore } from "../stores/queueStore";

export { videoExtractKeys, patchVideoExtractCaches, removeVideoExtractFromCaches } from "../lib/videoExtractQueryCache";
import { videoExtractKeys, patchVideoExtractCaches, removeVideoExtractFromCaches } from "../lib/videoExtractQueryCache";

async function reconcileVideoExtractQueries(queryClient: QueryClient, extract?: VideoExtract, removedId?: string) {
  if (removedId) removeVideoExtractFromCaches(queryClient, removedId);
  if (extract) patchVideoExtractCaches(queryClient, extract);
  await queryClient.invalidateQueries({ queryKey: videoExtractKeys.all });
  const queue = useQueueStore.getState();
  queue.invalidateQueueGeneration();
  if (queue.hasCompletedFirstLoad) {
    await queue.reloadForCurrentMode();
  }
}

export function useVideoExtractList(documentId: string) {
  return useQuery({
    queryKey: videoExtractKeys.list(documentId),
    queryFn: () => getVideoExtracts(documentId),
    enabled: Boolean(documentId),
  });
}

export function useAllVideoExtracts(collectionId?: string) {
  return useQuery({
    queryKey: videoExtractKeys.library(collectionId),
    queryFn: () => getAllVideoExtracts(collectionId),
  });
}

export function useVideoExtractReviewCandidates(documentId?: string) {
  return useQuery({
    queryKey: videoExtractKeys.candidates(documentId),
    queryFn: () => getVideoExtractReviewCandidates(documentId),
  });
}

export function useCreateVideoExtract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateVideoExtractInput) => createVideoExtract(input),
    onSuccess: (extract) => reconcileVideoExtractQueries(queryClient, extract),
    // An uncertain transport failure may still have committed. Refresh the
    // source list rather than auto-retrying and creating a duplicate.
    onError: () => queryClient.invalidateQueries({ queryKey: videoExtractKeys.all }),
  });
}

export function useUpdateVideoExtract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateVideoExtractInput) => updateVideoExtract(input),
    onSuccess: (extract) => reconcileVideoExtractQueries(queryClient, extract),
  });
}

export function useDeleteVideoExtract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (extractId: string) => deleteVideoExtract(extractId),
    onSuccess: (_value, extractId) => reconcileVideoExtractQueries(queryClient, undefined, extractId),
  });
}

export function useSetVideoExtractQueueMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ extractId, queued, initialReviewDate }: {
      extractId: string;
      queued: boolean;
      initialReviewDate?: string;
    }) => setVideoExtractQueueMembership(extractId, queued, initialReviewDate),
    onSuccess: (extract) => reconcileVideoExtractQueries(queryClient, extract),
  });
}

export function usePostponeVideoExtract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ extractId, days }: { extractId: string; days: number }) =>
      postponeVideoExtract(extractId, days),
    onSuccess: (extract) => reconcileVideoExtractQueries(queryClient, extract),
  });
}

/** Patch a seen result without refetching the world. */
export function usePatchVideoExtractSnapshot() {
  const queryClient = useQueryClient();
  return (extract: VideoExtract) => {
    patchVideoExtractCaches(queryClient, extract);
    void queryClient.invalidateQueries({ queryKey: videoExtractKeys.all });
  };
}
