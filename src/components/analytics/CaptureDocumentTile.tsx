import { useId, useState } from "react";
import { ArrowRight, ArrowSquareOut, BookOpen, FileText, Headphones, ImageSquare, PlayCircle } from "@phosphor-icons/react";
import type { BrowserCaptureDocument } from "../../api/capture-activity";
import { useI18n } from "../../lib/i18n";
import { extractYouTubeVideoId } from "../../utils/youtubeEmbed";
import { getYouTubeThumbnail } from "../../api/youtube";
import { formatLocalizedRelativeTime } from "../../utils/relativeTime";
import { validCaptureUrl } from "../../utils/captureSource";
import "./captureActivity.css";

function coverUrl(document: BrowserCaptureDocument): string | null {
  const cover = document.coverImageUrl?.trim();
  if (cover && (validCaptureUrl(cover) || /^(data:image\/(png|jpe?g|webp|gif|avif);base64,|blob:|asset:\/\/localhost\/|\/api\/documents\/)/i.test(cover))) return cover;
  const videoId = document.fileType === "youtube" ? extractYouTubeVideoId(document.sourceUrl) : null;
  return videoId ? getYouTubeThumbnail(videoId) : null;
}

const TYPES = {
  html: { label: "article", icon: BookOpen }, markdown: { label: "article", icon: BookOpen },
  youtube: { label: "video", icon: PlayCircle }, video: { label: "video", icon: PlayCircle },
  pdf: { label: "pdf", icon: FileText }, epub: { label: "ebook", icon: BookOpen },
  audio: { label: "audio", icon: Headphones }, image: { label: "image", icon: ImageSquare },
  other: { label: "document", icon: FileText },
} as const;

export interface CaptureDocumentTileProps {
  document: BrowserCaptureDocument;
  onOpen: (document: BrowserCaptureDocument) => void;
  onOpenOriginal: (document: BrowserCaptureDocument) => void;
}

export function CaptureDocumentTile({ document, onOpen, onOpenOriginal }: CaptureDocumentTileProps) {
  const { t, locale } = useI18n();
  const metadataId = useId();
  const imageUrl = coverUrl(document);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const title = document.title.trim() || t("dashboardTab.untitled");
  const host = new URL(document.sourceUrl).hostname.replace(/^www\./, "");
  const { label, icon: TypeIcon } = TYPES[document.fileType];
  const date = new Date(document.dateAdded);
  const absoluteTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);

  return (
    <li className="capture-document-tile">
      <button className="capture-document-primary" onClick={() => onOpen(document)} aria-label={t("dashboard.browserSaves.openSaved", { title })} aria-describedby={metadataId}>
        <div className="capture-document-media">
          {imageUrl && imageUrl !== failedUrl ? (
            <img src={imageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
              className="capture-document-cover" onError={() => setFailedUrl(imageUrl)}
              onLoad={(event) => { if (event.currentTarget.naturalWidth < 80 || event.currentTarget.naturalHeight < 40) setFailedUrl(imageUrl); }} />
          ) : (
            <div className="capture-document-fallback" aria-hidden="true">
              <TypeIcon /><span>{host}</span>
            </div>
          )}
          <span className="capture-document-type"><TypeIcon aria-hidden="true" />{t(`dashboard.browserSaves.type.${label}`)}</span>
        </div>
        <div className="capture-document-info">
          <h3 title={title}>{title}</h3>
          <div id={metadataId} className="capture-document-meta"><span title={host}>{host}</span>
            <time dateTime={document.dateAdded} title={absoluteTime} aria-label={absoluteTime}>
              {formatLocalizedRelativeTime(date.getTime(), locale)}
            </time>
          </div>
        </div>
      <div className="capture-document-actions">
        <span className="capture-document-read" aria-hidden="true">{t("dashboard.browserSaves.read")}<ArrowRight /></span>
      </div>
      </button>
        <button className="capture-document-original" onClick={() => onOpenOriginal(document)} aria-label={t("dashboard.browserSaves.openOriginal", { title })}>
          {t("dashboard.browserSaves.original")}<ArrowSquareOut aria-hidden="true" />
        </button>
    </li>
  );
}
