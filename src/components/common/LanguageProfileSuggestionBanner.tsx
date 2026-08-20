import { useEffect, useState } from "react";
import { useLanguageProfileStore } from "../../stores/languageProfileStore";
import type { ContentType, DetectionEvidence, LanguageProfileSuggestion } from "../../types/languageProfile";

interface LanguageProfileSuggestionBannerProps {
  contentType: ContentType;
  contentId: string;
  evidence: DetectionEvidence;
}

/** Non-blocking, reversible language detection prompt for reader hosts. */
export function LanguageProfileSuggestionBanner({ contentType, contentId, evidence }: LanguageProfileSuggestionBannerProps) {
  const suggestion = useLanguageProfileStore((state) => state.suggestions[`${contentType}:${contentId}`]);
  const loadSuggestion = useLanguageProfileStore((state) => state.loadSuggestion);
  const associateContent = useLanguageProfileStore((state) => state.associateContent);
  const dismissSuggestion = useLanguageProfileStore((state) => state.dismissSuggestion);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    void loadSuggestion(contentType, contentId, evidence);
  }, [contentId, contentType, evidence, loadSuggestion]);

  if (!visible || !suggestion) return null;

  const accept = async () => {
    await associateContent({
      profileId: suggestion.profile.id,
      contentType,
      contentId,
      mode: "enabled",
      detectionEvidence: evidence,
    });
    setVisible(false);
  };

  const dismiss = async (disable: boolean) => {
    if (disable) {
      await associateContent({
        profileId: suggestion.profile.id,
        contentType,
        contentId,
        mode: "disabled",
        detectionEvidence: evidence,
        suggestionDismissed: true,
      });
    } else {
      await dismissSuggestion(suggestion);
    }
    setVisible(false);
  };

  return (
    <aside className="rounded border border-border bg-card p-3 text-sm shadow-sm" role="status" aria-label="Language learning suggestion">
      <p className="font-medium">Study this as {suggestion.profile.targetLanguage}?</p>
      <p className="mt-1 text-muted-foreground">This does not change the source document or reading position.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="min-h-10 rounded bg-primary px-3 text-primary-foreground" onClick={() => void accept()}>Study as {suggestion.profile.name}</button>
        <button type="button" className="min-h-10 rounded border border-border px-3" onClick={() => void dismiss(false)}>Not now</button>
        <button type="button" className="min-h-10 rounded border border-border px-3 text-destructive" onClick={() => void dismiss(true)}>Disable for this content</button>
      </div>
    </aside>
  );
}

export type { LanguageProfileSuggestion };
