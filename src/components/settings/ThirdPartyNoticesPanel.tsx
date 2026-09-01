import { THIRD_PARTY_NOTICES } from "../../lib/thirdPartyNotices";
import { useI18n } from "../../lib/i18n";

export function ThirdPartyNoticesPanel() {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-foreground">{t("settings.openSourceNotices")}</h4>
        <p className="text-xs text-muted-foreground mt-1">{t("settings.openSourceNoticesDesc")}</p>
      </div>
      <ul className="space-y-3">
        {THIRD_PARTY_NOTICES.map((notice) => (
          <li
            key={notice.name}
            className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm"
          >
            <div className="font-medium text-foreground">{notice.name}</div>
            <p className="text-xs text-muted-foreground mt-1">{notice.description}</p>
            <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
              <div>
                <dt className="inline font-medium text-foreground">{t("settings.noticeLicense")}: </dt>
                <dd className="inline">{notice.license}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">{t("settings.noticeCopyright")}: </dt>
                <dd className="inline">{notice.copyright}</dd>
              </div>
            </dl>
            <a
              href={notice.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-xs text-primary-600 hover:underline"
            >
              {notice.homepage}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
