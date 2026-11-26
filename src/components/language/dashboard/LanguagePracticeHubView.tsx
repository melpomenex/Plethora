import { useEffect, useState } from "react";
import { ChatsCircle, Keyboard, Microphone, PencilLine, Waveform, WarningCircle } from "@phosphor-icons/react";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";
import { useI18n } from "../../../lib/i18n";
import { isAnyAiAvailable } from "../../../lib/ai/provider";
import { useAiAvailability } from "../../../lib/ai/useAiAvailability";
import { createConfiguredShadowingProviders } from "../../../lib/languageShadowing";
import { isGroqConfigured } from "../../../api/groqTranscription";
import { listLanguagePracticeAttempts } from "../../../api/languagePractice";
import { LanguageVoiceConversation } from "../LanguageVoiceConversation";
import { createCanonicalTab } from "../../tabs/TabRegistry";
import { useTabsStore } from "../../../stores";

interface PracticeModeCard {
  id: string;
  icon: React.ElementType;
  titleKey: string;
  descriptionKey: string;
  available: boolean;
  reasonKey?: string;
}

/** Capability-gated Practice & Tutor Hub with an honest history summary. */
export function LanguagePracticeHubView() {
  const { t } = useI18n();
  const activeProfile = useLanguageProfileStore((state) => state.activeProfile);
  const profileId = activeProfile?.id ?? null;

  const [aiAvailable, setAiAvailable] = useState(false);
  const [attempts, setAttempts] = useState<Awaited<ReturnType<typeof listLanguagePracticeAttempts>>>([]);
  const [attemptsLoading, setAttemptsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promptAi = useAiAvailability("prompt");

  useEffect(() => {
    let current = true;
    void isAnyAiAvailable("prompt").then((available) => {
      if (current) setAiAvailable(available);
    });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!profileId) return;
    let current = true;
    setAttemptsLoading(true);
    listLanguagePracticeAttempts(profileId, { limit: 20 })
      .then((rows) => {
        if (current) setAttempts(rows);
      })
      .catch((cause) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (current) setAttemptsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [profileId]);

  const shadowingAvailable = createConfiguredShadowingProviders().length > 0 || isGroqConfigured();
  const tutorAvailable = aiAvailable;
  const writingAvailable = aiAvailable;

  const modes: PracticeModeCard[] = [
    {
      id: "tutor",
      icon: ChatsCircle,
      titleKey: "languageLearning.practice.tutor",
      descriptionKey: "languageLearning.practice.tutorDesc",
      available: tutorAvailable,
      reasonKey: "languageLearning.practice.reasonAi",
    },
    {
      id: "dictation",
      icon: Keyboard,
      titleKey: "languageLearning.practice.dictation",
      descriptionKey: "languageLearning.practice.dictationDesc",
      available: shadowingAvailable,
      reasonKey: "languageLearning.practice.reasonStt",
    },
    {
      id: "shadowing",
      icon: Waveform,
      titleKey: "languageLearning.practice.shadowing",
      descriptionKey: "languageLearning.practice.shadowingDesc",
      available: shadowingAvailable,
      reasonKey: "languageLearning.practice.reasonStt",
    },
    {
      id: "pronunciation",
      icon: Microphone,
      titleKey: "languageLearning.practice.pronunciation",
      descriptionKey: "languageLearning.practice.pronunciationDesc",
      available: shadowingAvailable,
      reasonKey: "languageLearning.practice.reasonStt",
    },
    {
      id: "writing",
      icon: PencilLine,
      titleKey: "languageLearning.practice.writing",
      descriptionKey: "languageLearning.practice.writingDesc",
      available: writingAvailable,
      reasonKey: "languageLearning.practice.reasonAi",
    },
  ];

  const openDocuments = () => {
    useTabsStore.getState().addTab(createCanonicalTab("documents"), undefined, "bootstrap");
    window.dispatchEvent(new CustomEvent("navigate", { detail: "/documents" }));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-5">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">{t("languageLearning.practice.modes")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {modes.map((mode) => {
            const Icon = mode.icon;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={mode.available ? openDocuments : undefined}
                className={`rounded-xl p-4 text-left ring-1 ring-inset transition-colors ${
                  mode.available
                    ? "bg-card ring-border hover:bg-surface-container"
                    : "bg-card ring-border opacity-70"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`h-5 w-5 ${mode.available ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="text-sm font-medium text-foreground">{t(mode.titleKey)}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t(mode.descriptionKey)}</p>
                {!mode.available && mode.reasonKey ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">{t(mode.reasonKey)}</p>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{t("languageLearning.practice.hint")}</p>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">{t("languageLearning.practice.history")}</h3>
        {error ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <WarningCircle className="h-4 w-4" />
            {error}
          </div>
        ) : null}
        {attemptsLoading ? (
          <p className="text-sm text-muted-foreground">{t("languageLearning.loading")}</p>
        ) : attempts.length === 0 ? (
          <p className="rounded-lg bg-card p-4 text-sm text-muted-foreground ring-1 ring-inset ring-border">
            {t("languageLearning.practice.emptyHistory")}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl ring-1 ring-inset ring-border bg-card">
            {attempts.slice(0, 8).map((attempt) => (
              <li key={attempt.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-foreground">
                    {t(`languageLearning.practice.modeName.${attempt.mode}`)}
                  </div>
                  <div className="text-xs text-muted-foreground">{new Date(attempt.createdAt).toLocaleString()}</div>
                </div>
                {attempt.comparison?.score != null ? (
                  <span className="rounded-full bg-surface-container px-3 py-1 text-xs font-medium text-foreground ring-1 ring-inset ring-border">
                    {Math.round(attempt.comparison.score * 100)}%
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">{t("languageLearning.practice.voice")}</h3>
        <LanguageVoiceConversation />
      </section>

      {!promptAi.available ? (
        <p className="rounded-lg bg-card p-4 text-sm text-muted-foreground ring-1 ring-inset ring-border">
          {t("languageLearning.practice.aiUnavailable")}
        </p>
      ) : null}
    </div>
  );
}
