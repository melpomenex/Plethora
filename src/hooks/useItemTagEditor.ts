import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";
import { useToast } from "../components/common/Toast";
import { addTag as appendTag, normalizeTagInput, removeTag as removeTagFromList } from "../lib/tagEditing/normalize";
import { persistItemTags } from "../lib/tagEditing/mutationAdapter";
import { publishItemTagsUpdated } from "../lib/tagEditing/itemTagEvents";
import type { ItemTagTarget } from "../lib/tagEditing/types";

export interface ItemTagEditorApi {
  /** The current tag list (optimistic during an in-flight mutation). */
  tags: string[];
  /** Raw text currently in the add-input. */
  input: string;
  /** True while a mutation for this item is in flight — controls disabled. */
  busy: boolean;
  /** Localized error from the last failed mutation, or null. */
  error: string | null;
  setInput: (value: string) => void;
  /** Submit the current input as a new tag (Enter / add button). */
  addTag: () => void;
  /** Remove one assigned tag. */
  removeTag: (tag: string) => void;
  /** Reset the input (e.g. after the surface closes). */
  resetInput: () => void;
  /** Reset to the persisted/seed tag list (e.g. when the target changes). */
  resetTags: (tags: string[]) => void;
}

export interface UseItemTagEditorOptions {
  /**
   * Called with the persisted tag list after a successful mutation. Lets the
   * owning surface reconcile its local snapshot (e.g. the expanded schedule
   * row's item) in addition to the store-level reconciliation.
   */
  onTagsPersisted?: (tags: string[]) => void;
}

/**
 * Controlled optimistic tag state for ONE item. Serializes mutations per item
 * (a second submission while one is in flight is ignored — the busy state
 * also disables controls), applies optimistic updates immediately, reconciles
 * from the persisted response, rolls back to the last persisted list on
 * failure with localized error feedback, and publishes a typed
 * item-tags-updated notification after success so mounted consumers converge.
 */
export function useItemTagEditor(
  target: ItemTagTarget,
  options?: UseItemTagEditorOptions
): ItemTagEditorApi {
  const { t } = useI18n();
  const toast = useToast();
  const [tags, setTags] = useState<string[]>(target.tags ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const tagsRef = useRef(tags);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // Identity of the item this editor was created for. If the host swaps the
  // target while a mutation is in flight, the persisted result must NOT land
  // on the new item; the editor resets to the new item's list.
  const targetKeyRef = useRef(`${target.type}:${target.id}`);
  useEffect(() => {
    if (pendingRef.current) return;
    if (targetKeyRef.current === `${target.type}:${target.id}`) return;
    targetKeyRef.current = `${target.type}:${target.id}`;
    const next = target.tags ?? [];
    tagsRef.current = next;
    setTags(next);
    setInput("");
    setError(null);
  }, [target.type, target.id]);

  // Keep a ref in sync so queued handlers always read the latest optimistic
  // list without stale closure captures.
  useEffect(() => {
    tagsRef.current = tags;
  }, [tags]);

  // Reconcile EXTERNAL tag changes (a different surface persisted a new list
  // for this item, or the host re-fetched details). Never clobber the editor's
  // own optimistic state while a mutation is in flight.
  useEffect(() => {
    if (pendingRef.current) return;
    const next = target.tags ?? [];
    const current = tagsRef.current;
    const changed =
      next.length !== current.length ||
      next.some((tag, index) => tag !== current[index]);
    if (changed) {
      tagsRef.current = next;
      setTags(next);
    }
  }, [target.tags]);

  const mutate = useCallback(
    async (
      nextTags: string[],
      rollbackTags: string[],
      onRollback?: () => void,
      failureLabel?: string
    ) => {
      if (pendingRef.current) return; // serialize per item: no overlapping writes
      pendingRef.current = true;
      setBusy(true);
      setError(null);
      const mutationTargetKey = `${target.type}:${target.id}`;
      const stillSameItem = () => targetKeyRef.current === mutationTargetKey;
      try {
        const persisted = await persistItemTags(target, nextTags);
        // If the host swapped the target mid-flight, the persisted result
        // belongs to the OLD item — don't apply it to the new one.
        if (!stillSameItem()) return;
        tagsRef.current = persisted;
        setTags(persisted);
        publishItemTagsUpdated({ itemType: target.type, id: target.id, tags: persisted });
        optionsRef.current?.onTagsPersisted?.(persisted);
      } catch (err) {
        if (!stillSameItem()) return;
        console.error(`Failed to update tags for ${target.type} ${target.id}`, err);
        tagsRef.current = rollbackTags;
        setTags(rollbackTags);
        onRollback?.();
        const message = err instanceof Error ? err.message : t("itemDetails.pleaseTryAgain");
        setError(message);
        toast.error(failureLabel ?? t("itemDetails.tagAddFailed"), message);
      } finally {
        pendingRef.current = false;
        setBusy(false);
      }
    },
    [target, t, toast]
  );

  const addTag = useCallback(() => {
    if (pendingRef.current) return;
    const result = appendTag(tagsRef.current, input);
    if (!result.added) {
      // Empty/duplicate input: clear quietly, never send a mutation.
      if (result.rejected === "duplicate") setInput("");
      return;
    }
    setInput("");
    const previous = tagsRef.current;
    void mutate(result.tags, previous, () => setInput(normalizeTagInput(input)), t("itemDetails.tagAddFailed"));
  }, [input, mutate, t]);

  const removeTag = useCallback(
    (tag: string) => {
      if (pendingRef.current) return;
      const previous = tagsRef.current;
      const next = removeTagFromList(previous, tag);
      void mutate(next, previous, undefined, t("itemDetails.tagRemoveFailed"));
    },
    [mutate, t]
  );

  const resetInput = useCallback(() => setInput(""), []);
  const resetTags = useCallback((next: string[]) => {
    tagsRef.current = next;
    setTags(next);
  }, []);

  return {
    tags,
    input,
    busy,
    error,
    setInput,
    addTag,
    removeTag,
    resetInput,
    resetTags,
  };
}
