import { Check, Lightning, Sparkle } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";

type ArenaReviewMode = "automatic" | "choose";

interface AlgorithmArenaModeControlProps {
  compact?: boolean;
}

const OPTIONS: Array<{
  value: ArenaReviewMode;
  icon: typeof Lightning;
  titleKey: string;
  descriptionKey: string;
}> = [
  {
    value: "automatic",
    icon: Lightning,
    titleKey: "algorithmArena.modeAutomatic",
    descriptionKey: "algorithmArena.modeAutomaticDescription",
  },
  {
    value: "choose",
    icon: Sparkle,
    titleKey: "algorithmArena.modeChoose",
    descriptionKey: "algorithmArena.modeChooseDescription",
  },
];

export function AlgorithmArenaModeControl({ compact = false }: AlgorithmArenaModeControlProps) {
  const { t } = useI18n();
  const mode = useSettingsStore(
    (state) => state.settings.learning.sm20ArenaReviewMode ?? "automatic",
  );
  const updateSettings = useSettingsStore((state) => state.updateSettings);

  const selectMode = (next: ArenaReviewMode) => {
    const learning = useSettingsStore.getState().settings.learning;
    updateSettings({
      learning: { ...learning, sm20ArenaReviewMode: next },
    });
  };

  if (compact) {
    return (
      <div className="mx-auto mt-3 flex w-full max-w-2xl flex-col items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/70 px-2.5 py-2 sm:flex-row sm:gap-3">
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Sparkle className="h-4 w-4 text-primary" weight="duotone" aria-hidden="true" />
          <span>{t("algorithmArena.afterRating")}</span>
        </div>
        <div
          role="radiogroup"
          aria-label={t("algorithmArena.modeGroupLabel")}
          className="grid w-full grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1 sm:w-auto"
        >
          {OPTIONS.map((option) => {
            const selected = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => selectMode(option.value)}
                className={`min-h-11 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  selected
                    ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                }`}
              >
                {option.value === "automatic"
                  ? t("algorithmArena.modeAutomaticShort")
                  : t("algorithmArena.modeChooseShort")}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby="arena-review-mode-title" className="space-y-3">
      <div>
        <h5 id="arena-review-mode-title" className="text-sm font-semibold text-foreground">
          {t("algorithmArena.afterRating")}
        </h5>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("algorithmArena.modeDescription")}
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label={t("algorithmArena.modeGroupLabel")}
        className="grid gap-2 sm:grid-cols-2"
      >
        {OPTIONS.map((option) => {
          const selected = mode === option.value;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => selectMode(option.value)}
              className={`relative min-h-[116px] rounded-xl border p-3.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                selected
                  ? "border-primary/70 bg-primary/[0.07] shadow-[0_0_0_1px_hsl(var(--primary)/0.12)]"
                  : "border-border bg-background/45 hover:border-primary/35 hover:bg-muted/35"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                  selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}>
                  <Icon className="h-5 w-5" weight="duotone" aria-hidden="true" />
                </span>
                {selected ? (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
                    <Check className="h-3.5 w-3.5" weight="bold" />
                  </span>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{t(option.titleKey)}</span>
                {option.value === "automatic" ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    {t("algorithmArena.recommended")}
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {t(option.descriptionKey)}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
