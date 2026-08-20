import { createLearningItem, type LearningItem } from "./learning-items";
import { createLanguageMemorizationLink } from "./languageKnowledge";
import { createLanguageLearningDraft, type LanguageLearningDraft } from "../lib/languageSrs";

export interface MemorizeLanguageDraftResult {
  item: LearningItem;
  linked: boolean;
}

/**
 * The only API in this module that creates a learning item. Callers must
 * invoke it from an explicit Memorize action; suggestions and passive events
 * use the pure draft/scoring contracts instead.
 */
export async function memorizeLanguageDraft(draftInput: Omit<LanguageLearningDraft, "draftKey"> & { draftKey?: string }): Promise<MemorizeLanguageDraftResult> {
  const draft = createLanguageLearningDraft(draftInput);
  const item = await createLearningItem({
    item_type: draft.itemType,
    question: draft.question,
    answer: draft.answer,
    cloze_text: draft.clozeText,
    document_id: draft.documentId,
    tags: draft.tags,
    allow_duplicate: false,
    interaction_metadata: {
      ...draft.interactionMetadata,
      origin: draft.provenance.origin,
      languageDraftKey: draft.draftKey,
      languageProfileId: draft.provenance.profileId,
      lexicalEntryId: draft.provenance.lexicalEntryId,
      phraseId: draft.provenance.phraseId,
      sentenceId: draft.provenance.sentenceId,
      sourceAnchor: draft.provenance.sourceAnchor,
      providerId: draft.provenance.providerId,
      providerVersion: draft.provenance.providerVersion,
    },
  });

  let linked = false;
  if (draft.provenance.lexicalEntryId) {
    await createLanguageMemorizationLink({
      profileId: draft.provenance.profileId,
      entryId: draft.provenance.lexicalEntryId,
      learningItemId: item.id,
      relation: "explicit",
    });
    linked = true;
  }
  return { item, linked };
}
