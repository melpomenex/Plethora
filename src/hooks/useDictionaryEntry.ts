/**
 * useDictionaryEntry — cached dictionary access for the selection stack
 * (spec: dictionary-peek; change: unify-selection-dictionary-lookup, D5).
 *
 * Wraps `lookupDictionaryEntry` in React Query with `staleTime: Infinity`:
 * a looked-up word never refetches in-session, and repeat lookups (including
 * offline ones) resolve from cache. Successful fetches record the word in the
 * vocabulary history store (once per actual fetch — cached re-views don't
 * inflate the count).
 *
 * The query key is the structurally-identical tuple of
 * `queryKeys.dictionary(word)` (src/main.tsx); it is inlined here to avoid a
 * circular import main → app tree → this hook.
 */

import { useQuery } from "@tanstack/react-query";
import { dictionaryQueryForText } from "../components/viewer/selectionInteraction/intent";
import { useVocabularyHistoryStore } from "../stores/vocabularyHistoryStore";
import { useLanguageProfileStore } from "../stores/languageProfileStore";
import { recordLanguageLookup } from "../api/languageLexicon";
import { lookupDictionaryEntry, type DictionaryEntryResult } from "../utils/dictionaryLookup";
import { languagePeekService } from "../lib/languagePeek";
import type { LanguagePeekTargetContext } from "../lib/languagePeek";

const dictionaryQueryKey = (word: string, context?: LanguagePeekTargetContext) => [
  "dictionary",
  word,
  context?.profileId ?? null,
  context?.languageTag ?? null,
  context?.analysis?.processingKey ?? null,
  context?.phrase?.phraseId ?? null,
] as const;

function dictionaryResultFromPeek(
  peekResult: Awaited<ReturnType<typeof languagePeekService.lookup>>,
): DictionaryEntryResult {
  if (peekResult.ok === true && peekResult.result.dictionary) {
    return { ok: true, entry: peekResult.result.dictionary };
  }
  if (peekResult.ok === true) {
    return { ok: false, failure: { kind: "unavailable", message: "The selected provider returned no dictionary entry." } };
  }
  const failure = peekResult.failure;
  return {
    ok: false,
    failure: failure.kind === "not-found" || failure.kind === "unavailable" || failure.kind === "offline-uncached"
      ? failure
      : { kind: "unavailable", message: failure.kind },
  };
}

export function useDictionaryEntry(
  text: string | null | undefined,
  documentId?: string | null,
  languageContext?: LanguagePeekTargetContext,
) {
  const recordLookup = useVocabularyHistoryStore((s) => s.recordLookup);
  // Normalize through the shared resolver so punctuated selections
  // (`"ephemeral,"`) hit the same cache entry as the clean word.
  const query = text ? dictionaryQueryForText(text) : "";

  return useQuery<DictionaryEntryResult>({
    queryKey: dictionaryQueryKey(query, languageContext),
    queryFn: async () => {
      const peekResult = languageContext
        ? await languagePeekService.lookup(query, languageContext)
        : null;
      const result: DictionaryEntryResult = peekResult
        ? dictionaryResultFromPeek(peekResult)
        : await lookupDictionaryEntry(query);
      if (result.ok) {
        const profileState = useLanguageProfileStore.getState();
        // Keep the legacy store as a compatibility projection while sending
        // new lookup evidence to the durable profile-scoped model. A failed
        // native/browser persistence call must never make Dictionary Peek
        // unavailable.
        void recordLanguageLookup({
          profileId: profileState.activeProfileId || undefined,
          languageTag: profileState.profiles.find((profile) => profile.id === profileState.activeProfileId)?.targetLanguage,
          surface: result.entry.word,
          documentId,
        }).catch(() => undefined);
        recordLookup(result.entry.word, documentId);
      }
      return result;
    },
    enabled: query.length > 0,
    staleTime: Infinity,
    retry: 1,
  });
}
