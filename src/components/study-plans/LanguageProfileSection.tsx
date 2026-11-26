/**
 * Optional Language Profile linkage section for Study Plans.
 *
 * Lets users optionally link a plan to an existing language-learning profile,
 * pick a target proficiency, and add a language focus note. The section is
 * entirely optional; standalone (non-language) study plans are unaffected.
 */

import React, { useEffect, useState } from 'react';
import { getLanguageProfiles } from '../../api/languageProfiles';
import type { LanguageProfile } from '../../types/languageProfile';
import type { StudyPlanLanguageFocus } from '../../types/learningPaths';

export interface StudyPlanLanguageLinkage {
  languageProfileId: string | null;
  targetProficiency: string | null;
  languageFocus: StudyPlanLanguageFocus | null;
}

export const EMPTY_LANGUAGE_LINKAGE: StudyPlanLanguageLinkage = {
  languageProfileId: null,
  targetProficiency: null,
  languageFocus: null,
};

const PROFICIENCY_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'native', label: 'Native' },
];

interface LanguageProfileSectionProps {
  value: StudyPlanLanguageLinkage;
  onChange: (next: StudyPlanLanguageLinkage) => void;
  disabled?: boolean;
}

export const LanguageProfileSection: React.FC<LanguageProfileSectionProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const [profiles, setProfiles] = useState<LanguageProfile[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoadingProfiles(true);
    setLoadError(null);
    getLanguageProfiles()
      .then((rows) => {
        if (active) setProfiles(rows.filter((p) => p.lifecycle === 'active'));
      })
      .catch(() => {
        if (active) setLoadError('Could not load language profiles.');
      })
      .finally(() => {
        if (active) setIsLoadingProfiles(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedProfile = profiles.find((p) => p.id === value.languageProfileId) ?? null;

  const selectClass =
    'w-full min-h-11 px-3.5 py-2 text-sm rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60';

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-xs font-bold text-surface-800 dark:text-surface-200">
        Language Profile (optional)</legend>
      <p className="text-[11px] text-surface-500 dark:text-surface-400">
        Link this plan to a language-learning profile to tailor materials. Leave
        unselected for a standalone plan.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1.5">
          <span className="block text-xs font-semibold text-surface-700 dark:text-surface-300">
            Profile</span>
          <select
            value={value.languageProfileId ?? ''}
            onChange={(e) =>
              onChange({ ...value, languageProfileId: e.target.value || null })
            }
            className={selectClass}
            disabled={disabled || isLoadingProfiles}
          >
            <option value="">
              {isLoadingProfiles ? 'Loading…' : 'None'}
            </option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.targetLanguage})
              </option>
            ))}
          </select>
          {loadError && (
            <span className="block text-[11px] text-red-500">{loadError}</span>
          )}
        </label>

        <label className="space-y-1.5">
          <span className="block text-xs font-semibold text-surface-700 dark:text-surface-300">
            Target proficiency</span>
          <select
            value={value.targetProficiency ?? ''}
            onChange={(e) =>
              onChange({ ...value, targetProficiency: e.target.value || null })
            }
            className={selectClass}
            disabled={disabled}
          >
            <option value="">Not specified</option>
            {PROFICIENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="block text-xs font-semibold text-surface-700 dark:text-surface-300">
          Language focus</span>
        <input
          type="text"
          value={value.languageFocus?.freeText ?? ''}
          onChange={(e) =>
            onChange({
              ...value,
              languageFocus: e.target.value ? { freeText: e.target.value } : null,
            })
          }
          placeholder="e.g. daily conversation, business vocabulary"
          disabled={disabled}
          className={selectClass}
        />
      </label>

      {selectedProfile && (
        <div className="flex items-center gap-2 rounded-xl border border-primary-500/30 bg-primary-500/5 px-3 py-2 text-xs">
          <span className="font-bold text-primary-700 dark:text-primary-300">
            {selectedProfile.name}
          </span>
          <span className="text-surface-500 dark:text-surface-400">
            {selectedProfile.targetLanguage}
          </span>
          {value.targetProficiency && (
            <span className="rounded-full bg-surface-200 dark:bg-surface-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-surface-600 dark:text-surface-300">
              {value.targetProficiency}
            </span>
          )}
        </div>
      )}
    </fieldset>
  );
};
