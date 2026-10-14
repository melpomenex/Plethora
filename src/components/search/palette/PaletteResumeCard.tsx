/**
 * Resume reading card (three-part reference composition):
 * cover footprint | real metadata + actions | last-position inset.
 *
 * Everything shown is real user data. Missing cover/summary/passage render
 * honest fallbacks (glyph footprint, omitted rows) and a modification
 * timestamp is labeled as such. The overflow menu publishes its open state
 * through PaletteUiContext so Escape dismisses the menu first.
 */

import { useEffect, useRef, useState } from "react";
import {
  ArrowSquareOut,
  BookOpen,
  Copy,
  DotsThree,
  FileText,
  Info,
} from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import type {
  PaletteActionId,
  PaletteHomeModel,
  PaletteResumeItem,
} from "../../../commandPalette/types";
import { usePaletteUi } from "./paletteUi";

export interface PaletteResumeCardProps {
  home: PaletteHomeModel;
  onAction: (id: PaletteActionId, documentId?: string) => void;
}

function ResumeSkeleton() {
  return (
    <div className="ch-resume ch-resume--loading" aria-busy="true">
      <div className="ch-cover ch-skeleton" />
      <div className="ch-resume-main">
        <div className="ch-skeleton ch-skeleton-line ch-skeleton-title" />
        <div className="ch-skeleton ch-skeleton-line" />
        <div className="ch-skeleton ch-skeleton-line ch-skeleton-short" />
      </div>
      <div className="ch-resume-inset">
        <div className="ch-skeleton ch-skeleton-line ch-skeleton-short" />
        <div className="ch-skeleton ch-skeleton-line" />
      </div>
    </div>
  );
}

interface ResumeEmptyProps {
  firstUse: boolean;
  onAction: (id: PaletteActionId) => void;
}

function ResumeEmpty({ firstUse, onAction }: ResumeEmptyProps) {
  const { t } = useI18n();
  return (
    <div className="ch-resume ch-resume--empty">
      <div className="ch-resume-empty-icon" aria-hidden="true">
        <BookOpen className="ch-empty-glyph" />
      </div>
      <div className="ch-resume-empty-body">
        <p className="ch-resume-empty-title">
          {firstUse ? t("palette.resume.emptyLibrary") : t("palette.resume.empty")}
        </p>
        <p className="ch-resume-empty-hint">{t("palette.resume.emptyHint")}</p>
        <div className="ch-resume-empty-actions">
          <button
            type="button"
            className="ch-btn ch-btn--secondary"
            onClick={() => onAction("palette.openLibrary")}
          >
            {t("palette.resume.openLibrary")}
          </button>
          <button
            type="button"
            className="ch-btn ch-btn--secondary"
            onClick={() => onAction("palette.importDocument")}
          >
            {t("palette.resume.importDocument")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResumeDetails({
  item,
  onAction,
}: {
  item: PaletteResumeItem;
  onAction: (id: PaletteActionId, documentId?: string) => void;
}) {
  const { t } = useI18n();
  const { transient, openTransient, closeTransient } = usePaletteUi();
  const [coverFailed, setCoverFailed] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuOpen = transient === "overflow";

  useEffect(() => {
    setCoverFailed(false);
  }, [item.documentId]);

  // When the menu closes (including via Escape), return focus to its trigger.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (menuOpen) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      menuButtonRef.current?.focus();
    }
  }, [menuOpen]);

  const timestampLead =
    item.timestampLeadKey === "lastRead"
      ? t("palette.resume.lastRead")
      : item.timestampLeadKey === "lastUpdated"
        ? t("palette.resume.lastUpdated")
        : null;

  const runMenuAction = (id: PaletteActionId) => {
    closeTransient();
    onAction(id, item.documentId);
  };

  return (
    <div className="ch-resume">
      <div className="ch-cover">
        {item.coverUrl && !coverFailed ? (
          <img
            src={item.coverUrl}
            alt=""
            className="ch-cover-image"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <div className="ch-cover-fallback" aria-hidden="true">
            <BookOpen className="ch-cover-glyph" />
          </div>
        )}
      </div>

      <div className="ch-resume-main">
        <h4 className="ch-resume-title" title={item.title}>
          {item.title}
        </h4>

        <div className="ch-resume-meta">
          {timestampLead && item.timestampLabel && (
            <span className="ch-resume-meta-item">
              <span className="ch-resume-meta-label">{timestampLead}</span>
              <span>{item.timestampLabel}</span>
            </span>
          )}
          {item.progressPercent !== null && (
            <span className="ch-resume-meta-item">
              <span className="ch-resume-progress" aria-hidden="true">
                <span
                  className="ch-resume-progress-fill"
                  style={{ width: `${item.progressPercent}%` }}
                />
              </span>
              <span>
                {t("palette.resume.percentComplete", {
                  percent: Math.round(item.progressPercent),
                })}
              </span>
            </span>
          )}
          {item.formatLabel && (
            <span className="ch-resume-meta-item">
              <FileText className="ch-resume-meta-glyph" aria-hidden="true" />
              <span>{item.formatLabel}</span>
            </span>
          )}
          {item.pageCount !== null && (
            <span className="ch-resume-meta-item">
              {t("palette.resume.pageCount", { count: item.pageCount })}
            </span>
          )}
        </div>

        <p className="ch-resume-desc">{t("palette.resume.description")}</p>

        <div className="ch-resume-actions">
          <button
            type="button"
            className="ch-btn ch-btn--primary"
            onClick={() => onAction("palette.resume", item.documentId)}
          >
            <FileText className="ch-btn-glyph" aria-hidden="true" />
            {t("palette.resume.continueReading")}
          </button>
          <button
            type="button"
            className="ch-btn ch-btn--secondary"
            onClick={() => onAction("doc.viewInLibrary", item.documentId)}
          >
            <BookOpen className="ch-btn-glyph" aria-hidden="true" />
            {t("palette.resume.viewInLibrary")}
          </button>
          <button
            ref={menuButtonRef}
            type="button"
            className="ch-btn ch-btn--icon"
            aria-label={t("palette.resume.moreActions")}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => (menuOpen ? closeTransient() : openTransient("overflow"))}
          >
            <DotsThree className="ch-btn-glyph" weight="bold" aria-hidden="true" />
          </button>

          {menuOpen && (
            <div className="ch-overflow" role="menu" aria-label={t("palette.resume.moreActions")}>
              <button
                type="button"
                role="menuitem"
                className="ch-overflow-item"
                onClick={() => runMenuAction("doc.openDetails")}
              >
                <Info className="ch-overflow-glyph" aria-hidden="true" />
                {t("palette.resume.openDetails")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="ch-overflow-item"
                onClick={() => runMenuAction("doc.copyTitle")}
              >
                <Copy className="ch-overflow-glyph" aria-hidden="true" />
                {t("palette.resume.copyTitle")}
              </button>
              {item.sourceUrl && (
                <button
                  type="button"
                  role="menuitem"
                  className="ch-overflow-item"
                  onClick={() => runMenuAction("doc.copySourceLink")}
                >
                  <ArrowSquareOut className="ch-overflow-glyph" aria-hidden="true" />
                  {t("palette.resume.copySourceLink")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="ch-resume-inset">
        {(item.locationLabel || item.timestampLabel) && (
          <div className="ch-inset-top">
            {timestampLead && item.timestampLabel && (
              <span className="ch-inset-lead">
                {timestampLead} {item.timestampLabel}
              </span>
            )}
            {item.locationLabel && (
              <span className="ch-inset-location">{item.locationLabel}</span>
            )}
          </div>
        )}
        {item.passage ? (
          <blockquote className="ch-inset-passage">
            <span>{item.passage}</span>
          </blockquote>
        ) : (
          <p className="ch-inset-muted">{t("palette.resume.noPassage")}</p>
        )}
      </div>
    </div>
  );
}

export function PaletteResumeCard({ home, onAction }: PaletteResumeCardProps) {
  const { t } = useI18n();

  return (
    <section className="ch-section" aria-label={t("palette.resumeSection")}>
      <div className="ch-section-head">
        <h3 className="ch-section-title">
          <BookOpen className="ch-section-glyph" weight="fill" aria-hidden="true" />
          {t("palette.resumeSection")}
        </h3>
      </div>

      {home.resume.status === "loading" ? (
        <ResumeSkeleton />
      ) : home.resume.item ? (
        <ResumeDetails item={home.resume.item} onAction={onAction} />
      ) : (
        <ResumeEmpty firstUse={home.firstUse} onAction={onAction} />
      )}
    </section>
  );
}
