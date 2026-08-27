import { useLanguageProfileStore } from "../../stores/languageProfileStore";
import type { ContentType } from "../../types/languageProfile";

interface LanguageProfileAssociationPromptProps {
  contentType: ContentType;
  contentId: string;
  onAssociated?: () => void;
}

/** Explicit opt-in to study a source under an active or selected profile. */
export function LanguageProfileAssociationPrompt({
  contentType,
  contentId,
  onAssociated,
}: LanguageProfileAssociationPromptProps) {
  const profiles = useLanguageProfileStore((state) => state.profiles.filter((profile) => profile.lifecycle === "active"));
  const activeProfileId = useLanguageProfileStore((state) => state.activeProfileId);
  const associateContent = useLanguageProfileStore((state) => state.associateContent);

  if (profiles.length === 0) {
    return (
      <div className="pointer-events-auto absolute left-1/2 top-16 z-30 max-w-md -translate-x-1/2 rounded-lg border border-border bg-card/95 p-3 text-sm shadow-lg backdrop-blur" role="status">
        <p className="font-medium">Create a language profile first</p>
        <p className="mt-1 text-muted-foreground">Open Settings → Language Learning to add a profile, then return here.</p>
      </div>
    );
  }

  const associate = async (profileId: string) => {
    await associateContent({
      profileId,
      contentType,
      contentId,
      mode: "enabled",
    });
    onAssociated?.();
  };

  return (
    <div className="pointer-events-auto absolute left-1/2 top-16 z-30 max-w-md -translate-x-1/2 rounded-lg border border-border bg-card/95 p-3 text-sm shadow-lg backdrop-blur" role="status" aria-label="Associate language profile">
      <p className="font-medium">Which language are you studying?</p>
      <p className="mt-1 text-muted-foreground">Language Mode needs an explicit profile for this source. This does not change the document.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {profiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            className={`min-h-10 rounded px-3 ${profile.id === activeProfileId ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
            onClick={() => void associate(profile.id)}
          >
            Study as {profile.name}
          </button>
        ))}
      </div>
    </div>
  );
}
