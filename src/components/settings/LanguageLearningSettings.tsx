import { useEffect, useState, type FormEvent } from "react";
import { useLanguageProfileStore } from "../../stores/languageProfileStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { isValidBcp47, type LanguageProfileCreate } from "../../types/languageProfile";

const EMPTY_FORM: LanguageProfileCreate = {
  name: "",
  targetLanguage: "",
  baseLanguage: "en",
  proficiency: "",
};

/** Profile management is explicit: creating/selecting a profile never enables
 * Language Mode for a document until its association is confirmed. */
export function LanguageLearningSettings() {
  const profiles = useLanguageProfileStore((state) => state.profiles);
  const activeProfileId = useLanguageProfileStore((state) => state.activeProfileId);
  const loading = useLanguageProfileStore((state) => state.loading);
  const error = useLanguageProfileStore((state) => state.error);
  const createProfile = useLanguageProfileStore((state) => state.createProfile);
  const setActiveProfile = useLanguageProfileStore((state) => state.setActiveProfile);
  const archiveProfile = useLanguageProfileStore((state) => state.archiveProfile);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const enabled = useSettingsStore(
    (state) => state.settings.languageLearning?.enabled === true,
  );
  const suggestionsEnabled = useSettingsStore(
    (state) => state.settings.languageLearning?.suggestionsEnabled !== false,
  );
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void useLanguageProfileStore.getState().load();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const targetLanguage = form.targetLanguage.trim();
    const baseLanguage = form.baseLanguage.trim();
    if (!form.name.trim() || !isValidBcp47(targetLanguage) || !isValidBcp47(baseLanguage)) {
      setFormError("Enter a profile name and valid BCP-47 target/base languages.");
      return;
    }
    setFormError(null);
    await createProfile({ ...form, name: form.name.trim(), targetLanguage, baseLanguage });
    setForm(EMPTY_FORM);
  };

  return (
    <div className="space-y-6" data-testid="language-learning-settings">
      <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="language-learning-master-title">
        <h2 id="language-learning-master-title" className="text-lg font-semibold text-foreground">
          Language Learning
        </h2>
        <label className="mt-3 flex items-start gap-3" data-testid="language-learning-master-toggle">
          <input
            type="checkbox"
            role="switch"
            aria-labelledby="language-learning-master-title"
            className="mt-1 h-5 w-5 accent-primary"
            checked={enabled}
            onChange={(event) =>
              updateSettings({
                languageLearning: {
                  enabled: event.target.checked,
                  suggestionsEnabled,
                  showUnavailableProviders:
                    useSettingsStore.getState().settings.languageLearning
                      ?.showUnavailableProviders !== false,
                },
              })
            }
          />
          <span className="text-sm text-muted-foreground">
            Show language-learning tools in readers (Language Mode, dictionary peek, translation and
            practice overlays). Off by default; ordinary reading is never affected.
          </span>
        </label>
        <label className="mt-3 flex items-start gap-3" data-testid="language-suggestions-toggle">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5 accent-primary"
            checked={suggestionsEnabled}
            disabled={!enabled}
            onChange={(event) =>
              updateSettings({
                languageLearning: {
                  enabled,
                  suggestionsEnabled: event.target.checked,
                  showUnavailableProviders:
                    useSettingsStore.getState().settings.languageLearning
                      ?.showUnavailableProviders !== false,
                },
              })
            }
          />
          <span className="text-sm text-muted-foreground">
            Suggest studying a document as your target language when one is detected.
          </span>
        </label>
      </section>
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold text-foreground">Language learning profiles</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Profiles are separate from the application language. Selecting one does not change ordinary readers or create cards.
        </p>

        <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={submit} aria-label="Create language learning profile">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Profile name</span>
            <input className="min-h-11 w-full rounded border border-border bg-background px-3" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Target language</span>
            <input className="min-h-11 w-full rounded border border-border bg-background px-3" placeholder="es" value={form.targetLanguage} onChange={(event) => setForm({ ...form, targetLanguage: event.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Explanation language</span>
            <input className="min-h-11 w-full rounded border border-border bg-background px-3" placeholder="en" value={form.baseLanguage} onChange={(event) => setForm({ ...form, baseLanguage: event.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Proficiency (optional)</span>
            <select className="min-h-11 w-full rounded border border-border bg-background px-3" value={form.proficiency ?? ""} onChange={(event) => setForm({ ...form, proficiency: event.target.value })}>
              <option value="">Not set</option>
              {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <button type="submit" className="min-h-11 rounded bg-primary px-4 text-sm font-medium text-primary-foreground" disabled={loading}>Create profile</button>
          </div>
        </form>
        {(formError || error) && <p className="mt-3 text-sm text-destructive" role="alert">{formError ?? error}</p>}
      </section>

      <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="language-profile-list-title">
        <h3 id="language-profile-list-title" className="text-base font-semibold">Your profiles</h3>
        {profiles.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No language profile is active. Ordinary reading remains unchanged.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded border border-border">
            {profiles.filter((profile) => profile.lifecycle !== "deleted").map((profile) => {
              const active = profile.id === activeProfileId;
              return (
                <li key={profile.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{profile.name}</p>
                    <p className="text-xs text-muted-foreground">{profile.targetLanguage} · explanations in {profile.baseLanguage}{profile.proficiency ? ` · ${profile.proficiency}` : ""}</p>
                  </div>
                  <button type="button" aria-pressed={active} className="min-h-10 rounded border border-border px-3 text-sm" onClick={() => void setActiveProfile(active ? null : profile.id)}>
                    {active ? "Active" : "Use profile"}
                  </button>
                  {!active && <button type="button" className="min-h-10 rounded border border-border px-3 text-sm text-destructive" onClick={() => void archiveProfile(profile.id)}>Archive</button>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
