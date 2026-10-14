/**
 * Minimal note composer (title / body / Save / Cancel), reference-scoped.
 *
 * Draft state lives in `paletteNoteDraftStore` so leaving the composer (or the
 * palette) never loses unsaved work; only a successful save clears it. The
 * body is a native multiline textarea, focused on entry, and Escape returns
 * to the hub retaining the draft (handled by the hub's Escape precedence).
 */

import { useEffect, useRef } from "react";
import { useI18n } from "../../../lib/i18n";
import type { PaletteNoteDraft } from "../../../commandPalette/noteDraft";

export interface PaletteNoteComposerProps {
  draft: PaletteNoteDraft;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onChange: (patch: Partial<PaletteNoteDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function PaletteNoteComposer({
  draft,
  dirty,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: PaletteNoteComposerProps) {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bodyRef.current?.focus();
  }, []);

  const canSave =
    !saving && (draft.title.trim().length > 0 || draft.body.trim().length > 0);

  return (
    <div className="ch-note">
      <div className="ch-note-head">
        <h3 className="ch-section-title">{t("palette.note.title")}</h3>
        {dirty && <span className="ch-note-draft">{t("palette.note.draftSaved")}</span>}
      </div>

      <label className="ch-note-field">
        <span className="ch-note-label">{t("palette.note.titleLabel")}</span>
        <input
          type="text"
          className="ch-note-input"
          value={draft.title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder={t("palette.note.titlePlaceholder")}
          disabled={saving}
        />
      </label>

      <textarea
        ref={bodyRef}
        className="ch-note-body"
        value={draft.body}
        onChange={(event) => onChange({ body: event.target.value })}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSave) {
            event.preventDefault();
            onSave();
          }
        }}
        placeholder={t("palette.note.bodyPlaceholder")}
        aria-label={t("palette.note.bodyLabel")}
        disabled={saving}
        rows={8}
      />

      {error && (
        <p className="ch-note-error" role="alert">
          {t("palette.note.saveError", { message: error })}
        </p>
      )}

      <div className="ch-note-actions">
        <button
          type="button"
          className="ch-btn ch-btn--secondary"
          onClick={onCancel}
          disabled={saving}
        >
          {t("palette.note.cancel")}
        </button>
        <button
          type="button"
          className="ch-btn ch-btn--primary"
          onClick={onSave}
          disabled={!canSave}
        >
          {saving ? t("palette.note.saving") : t("palette.note.save")}
        </button>
      </div>
    </div>
  );
}
