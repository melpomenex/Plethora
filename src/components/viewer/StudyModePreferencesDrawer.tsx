import React, { useEffect, useState } from "react";
import {
  deleteStudyLearnerPreference,
  listStudyLearnerPreferences,
  upsertStudyLearnerPreference,
} from "../../api/study-mode";
import type { StudyLearnerPreference } from "../../types/studyMode";

interface StudyModePreferencesDrawerProps {
  subjectKey: string;
  onClose: () => void;
  onUpdated: (prefs: StudyLearnerPreference[]) => void;
}

export const StudyModePreferencesDrawer: React.FC<StudyModePreferencesDrawerProps> = ({
  subjectKey,
  onClose,
  onUpdated,
}) => {
  const [scope, setScope] = useState<string>(subjectKey || "__global__");
  const [knowledgeLevel, setKnowledgeLevel] = useState("intermediate");
  const [explanationDetail, setExplanationDetail] = useState("balanced");
  const [vocabularyTolerance, setVocabularyTolerance] = useState("standard");
  const [teachingApproach, setTeachingApproach] = useState("balanced");
  const [interestsText, setInterestsText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    listStudyLearnerPreferences().then((prefs) => {
      if (!active) return;
      const match = prefs.find((p) => p.subjectKey === scope) ?? prefs.find((p) => p.subjectKey === "__global__");
      if (match) {
        setKnowledgeLevel(match.knowledgeLevel ?? "intermediate");
        setExplanationDetail(match.explanationDetail);
        setVocabularyTolerance(match.vocabularyTolerance);
        setTeachingApproach(match.teachingApproach);
        setInterestsText(match.interests.join(", "));
      }
    });
    return () => {
      active = false;
    };
  }, [scope]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertStudyLearnerPreference({
        subjectKey: scope,
        knowledgeLevel,
        explanationDetail,
        vocabularyTolerance,
        teachingApproach,
        interests: interestsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      const updated = await listStudyLearnerPreferences();
      onUpdated(updated);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await deleteStudyLearnerPreference(scope);
      const updated = await listStudyLearnerPreferences();
      onUpdated(updated);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-lg border border-border bg-card p-4 space-y-3"
      role="region"
      aria-label="Customize Study Mode Preferences"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Customize Study Preferences (Optional)</h4>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
        >
          Close
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <label className="space-y-1">
          <span className="font-medium text-foreground">Preference Scope</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1.5"
          >
            <option value="__global__">Global Default</option>
            {subjectKey && subjectKey !== "__global__" && (
              <option value={subjectKey}>Subject: {subjectKey}</option>
            )}
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-medium text-foreground">Knowledge Level</span>
          <select
            value={knowledgeLevel}
            onChange={(e) => setKnowledgeLevel(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1.5"
          >
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-medium text-foreground">Explanation Detail</span>
          <select
            value={explanationDetail}
            onChange={(e) => setExplanationDetail(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1.5"
          >
            <option value="concise">Concise</option>
            <option value="balanced">Balanced</option>
            <option value="detailed">Detailed</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="font-medium text-foreground">Technical Vocabulary</span>
          <select
            value={vocabularyTolerance}
            onChange={(e) => setVocabularyTolerance(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1.5"
          >
            <option value="plain">Plain language</option>
            <option value="standard">Standard</option>
            <option value="technical">Full technical</option>
          </select>
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="font-medium text-foreground">Interests / Familiar Analogies (comma-separated)</span>
          <input
            type="text"
            value={interestsText}
            onChange={(e) => setInterestsText(e.target.value)}
            placeholder="e.g., music, software architecture, cooking"
            className="w-full rounded border border-border bg-background px-2 py-1.5"
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleReset}
          disabled={saving}
          className="px-2.5 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
        >
          Clear Scope
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
        >
          {saving ? "Saving..." : "Save Preferences"}
        </button>
      </div>
    </div>
  );
};
