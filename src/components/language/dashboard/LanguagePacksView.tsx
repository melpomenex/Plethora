import { useCallback, useEffect, useState } from "react";
import { CheckCircle, Download, Package, ShieldCheck, Trash, WarningCircle } from "@phosphor-icons/react";
import { useLanguageProfileStore } from "../../../stores/languageProfileStore";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../utils/cn";
import {
  installLanguagePackWithEntries,
  listLanguagePacks,
  removeLanguagePack,
  verifyLanguagePack,
  type LanguageDictionaryEntryRecord,
  type LanguagePackRecord,
} from "../../../api/languagePacks";
import { LANGUAGE_PACK_CATALOG, filterCatalogPacks, getStarterPackEntries } from "../../../lib/languagePacks/catalog";

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

function packRecordFromCatalogItem(item: (typeof LANGUAGE_PACK_CATALOG)[number], entryCount: number): LanguagePackRecord {
  return {
    id: item.id,
    languageTag: item.languageTag,
    targetLanguage: item.targetLanguage,
    baseLanguage: item.baseLanguage,
    name: item.name,
    kind: item.kind as LanguagePackRecord["kind"],
    format: item.format as LanguagePackRecord["format"],
    version: item.version,
    sourceUrl: item.homepageUrl ?? item.downloadUrl,
    sha256: item.sha256,
    sizeBytes: item.sizeBytes,
    entryCount,
    license: item.license,
    attribution: item.attribution,
    capabilities: item.capabilities as unknown as Record<string, unknown>,
    status: "installed",
    installedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Installed packs + offline catalog for language packs. */
export function LanguagePacksView() {
  const { t } = useI18n();
  const activeProfile = useLanguageProfileStore((state) => state.activeProfile);
  const targetLanguage = activeProfile?.targetLanguage ?? "es";

  const [installed, setInstalled] = useState<LanguagePackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInstalled(await listLanguagePacks());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const verifyPack = useCallback(
    async (packId: string) => {
      setBusyId(packId);
      setError(null);
      try {
        await verifyLanguagePack(packId);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const installStarter = useCallback(
    async (item: (typeof LANGUAGE_PACK_CATALOG)[number]) => {
      setBusyId(item.id);
      setError(null);
      try {
        const entries = getStarterPackEntries(item.id);
        if (!entries || entries.length === 0) {
          setError(t("languageLearning.packs.noStarter"));
          return;
        }
        const record = packRecordFromCatalogItem(item, entries.length);
        const records: LanguageDictionaryEntryRecord[] = entries.map((entry) => ({
          id: `${item.id}:${entry.normalizedHeadword}`,
          packId: item.id,
          languageTag: item.languageTag,
          headword: entry.headword,
          normalizedHeadword: entry.normalizedHeadword,
          reading: entry.reading,
          lemma: entry.lemma,
          partOfSpeech: entry.pos,
          morphology: entry.morphology ?? {},
          senses: entry.senses.map((sense) => ({
            definition: sense.definition,
            glosses: sense.glosses,
            tags: sense.tags,
          })),
          examples: entry.examples ?? [],
          frequencyRank: entry.frequencyRank,
        }));
        await installLanguagePackWithEntries(record, records);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyId(null);
      }
    },
    [refresh, t],
  );

  const catalogItems = filterCatalogPacks(LANGUAGE_PACK_CATALOG, { languageTag: targetLanguage }).filter(
    (item) => getStarterPackEntries(item.id) !== null,
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-5">
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Package className="h-4 w-4 text-primary" />
          {t("languageLearning.packs.installed")}
        </h3>
        {error ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <WarningCircle className="h-4 w-4" />
            {error}
          </div>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("languageLearning.loading")}</p>
        ) : installed.length === 0 ? (
          <p className="rounded-lg bg-card p-4 text-sm text-muted-foreground ring-1 ring-inset ring-border">
            {t("languageLearning.packs.noInstalled")}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl ring-1 ring-inset ring-border bg-card">
            {installed.map((pack) => (
              <li key={pack.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{pack.name}</span>
                    {pack.status === "corrupt" ? (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive ring-1 ring-inset ring-destructive/40">
                        {t("languageLearning.packs.corrupt")}
                      </span>
                    ) : (
                      <CheckCircle className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {pack.languageTag} · {formatBytes(pack.sizeBytes)} · {pack.entryCount} {t("languageLearning.packs.entries")}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyId === pack.id}
                    onClick={() => void verifyPack(pack.id)}
                    className="inline-flex items-center gap-1 rounded-full bg-surface-container px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-inset ring-border hover:bg-surface-container-highest disabled:opacity-40"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {t("languageLearning.packs.verify")}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === pack.id}
                    onClick={() => void removeLanguagePack(pack.id).then(refresh).catch((cause) => setError(String(cause)))}
                    className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive ring-1 ring-inset ring-destructive/40 hover:bg-destructive/20 disabled:opacity-40"
                  >
                    <Trash className="h-3.5 w-3.5" />
                    {t("languageLearning.packs.remove")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-foreground">{t("languageLearning.packs.available")}</h3>
        {catalogItems.length === 0 ? (
          <p className="rounded-lg bg-card p-4 text-sm text-muted-foreground ring-1 ring-inset ring-border">
            {t("languageLearning.packs.noAvailable")}
          </p>
        ) : (
          <ul className="space-y-2">
            {catalogItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-card p-3 ring-1 ring-inset ring-border">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{item.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {formatBytes(item.sizeBytes)} · {item.license}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void installStarter(item)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors",
                    "bg-secondary-container text-on-secondary-container ring-primary/40 md-state md-focus-ring disabled:opacity-40",
                  )}
                >
                  <Download className="h-3.5 w-3.5" />
                  {busyId === item.id ? t("languageLearning.packs.installing") : t("languageLearning.packs.install")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t("languageLearning.packs.attributionNote")}</p>
      </section>
    </div>
  );
}
