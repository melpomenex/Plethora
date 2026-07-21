import { useSettingsStore } from "../../stores/settingsStore";
import { OCRSettings } from "./OCRSettings";
import { useI18n } from "../../lib/i18n";
import TASSettingsPanel from "../tas/TASSettingsPanel";
import { NumericInput } from "../common";

export function DocumentsSettings() {
  const { settings, updateSettings } = useSettingsStore();
  const { updateSettingsCategory } = useSettingsStore();
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      {/* Library View */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("settingsDocs.libraryView")}</h3>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-foreground">{t("settingsDocs.compactDocumentsView")}</p>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                {t("settingsDocs.compactDocumentsViewDesc")}
              </p>
            </div>
            <label className="relative inline-flex shrink-0 cursor-pointer items-center">
              <input
                type="checkbox"
                aria-label={t("settingsDocs.compactDocumentsView")}
                checked={settings.interface.compactDocumentsView}
                onChange={(e) =>
                  updateSettingsCategory("interface", {
                    compactDocumentsView: e.target.checked,
                  })
                }
                className="peer sr-only"
              />
              <div className="h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-primary peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none dark:bg-gray-700 dark:border-gray-600" />
            </label>
          </div>
          <div className="mt-4 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
            <span className="rounded-md bg-muted/60 px-2.5 py-2">{t("settingsDocs.compactDocumentsViewSignal1")}</span>
            <span className="rounded-md bg-muted/60 px-2.5 py-2">{t("settingsDocs.compactDocumentsViewSignal2")}</span>
            <span className="rounded-md bg-muted/60 px-2.5 py-2">{t("settingsDocs.compactDocumentsViewSignal3")}</span>
          </div>
        </div>
      </div>

      {/* Import Settings */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("settingsDocs.documentImport")}</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="defaultCategory" className="block text-sm font-medium text-foreground mb-2">
              {t("settingsDocs.defaultCategory")}
            </label>
            <input
              type="text"
              id="defaultCategory"
              value={settings.documents.defaultCategory}
              onChange={(e) =>
                updateSettings({
                  documents: { ...settings.documents, defaultCategory: e.target.value },
                })
              }
              placeholder={t("settingsDocs.defaultCategory")}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">{t("settingsDocs.autoProcess")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settingsDocs.autoProcessDesc")}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={settings.documents.autoProcessOnImport}
                onChange={(e) =>
                  updateSettings({
                    documents: { ...settings.documents, autoProcessOnImport: e.target.checked },
                  })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">{t("settingsDocs.detectDuplicates")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settingsDocs.detectDuplicatesDesc")}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={settings.documents.detectDuplicates}
                onChange={(e) =>
                  updateSettings({
                    documents: { ...settings.documents, detectDuplicates: e.target.checked },
                  })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">{t("settingsDocs.preserveImages")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settingsDocs.preserveImagesDesc")}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={settings.documents.webImportPreserveImages}
                onChange={(e) =>
                  updateSettings({
                    documents: { ...settings.documents, webImportPreserveImages: e.target.checked },
                  })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>
        </div>
      </div>

      {/* PDF Settings */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("settingsDocs.pdfDocuments")}</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="pdfZoom" className="block text-sm font-medium text-foreground mb-2">
              {t("settingsDocs.defaultZoom")}
            </label>
            <select
              id="pdfZoom"
              value={settings.documents.pdfSettings.defaultZoom}
              onChange={(e) =>
                updateSettings({
                  documents: {
                    ...settings.documents,
                    pdfSettings: { ...settings.documents.pdfSettings, defaultZoom: parseFloat(e.target.value) },
                  },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            >
              <option value="{0.5}" className="text-foreground">50%</option>
              <option value="{0.75}" className="text-foreground">75%</option>
              <option value="{1.0}" className="text-foreground">100%</option>
              <option value="{1.25}" className="text-foreground">125%</option>
              <option value="{1.5}" className="text-foreground">150%</option>
              <option value="{2.0}" className="text-foreground">200%</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">{t("settingsDocs.twoPageSpread")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settingsDocs.twoPageSpreadDesc")}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={settings.documents.pdfSettings.twoPageSpread}
                onChange={(e) =>
                  updateSettings({
                    documents: {
                      ...settings.documents,
                      pdfSettings: { ...settings.documents.pdfSettings, twoPageSpread: e.target.checked },
                    },
                  })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">{t("settingsDocs.showOcrBreaks")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settingsDocs.showOcrBreaksDesc")}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={settings.documents.pdfSettings.showOcrPageBreaks}
                onChange={(e) =>
                  updateSettings({
                    documents: {
                      ...settings.documents,
                      pdfSettings: { ...settings.documents.pdfSettings, showOcrPageBreaks: e.target.checked },
                    },
                  })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>
        </div>
      </div>

      {/* EPUB Settings */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("settingsDocs.epubDocuments")}</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="epubFontSize" className="block text-sm font-medium text-foreground mb-2">
              {t("settingsDocs.defaultFontSize")}
            </label>
            <NumericInput
              id="epubFontSize"
              min={10}
              max={30}
              value={settings.documents.epubSettings.fontSize}
              onChange={(value) =>
                updateSettings({
                  documents: {
                    ...settings.documents,
                    epubSettings: { ...settings.documents.epubSettings, fontSize: value },
                  },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
          </div>

          <div>
            <label htmlFor="epubFontFamily" className="block text-sm font-medium text-foreground mb-2">
              {t("settingsDocs.fontFamily")}
            </label>
            <select
              id="epubFontFamily"
              value={settings.documents.epubSettings.fontFamily}
              onChange={(e) =>
                updateSettings({
                  documents: {
                    ...settings.documents,
                    epubSettings: { ...settings.documents.epubSettings, fontFamily: e.target.value as "serif" | "sans-serif" | "monospace" },
                  },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            >
              <option value="serif" className="text-foreground">{t("settingsDocs.serif")}</option>
              <option value="sans-serif" className="text-foreground">{t("settingsDocs.sansSerif")}</option>
              <option value="monospace" className="text-foreground">{t("settingsDocs.monospace")}</option>
            </select>
          </div>

          <div>
            <label htmlFor="epubLineHeight" className="block text-sm font-medium text-foreground mb-2">
              {t("settingsDocs.lineHeight")}
            </label>
            <NumericInput
              id="epubLineHeight"
              min={1.2}
              max={2.2}
              step={0.1}
              value={settings.documents.epubSettings.lineHeight}
              onChange={(value) =>
                updateSettings({
                  documents: {
                    ...settings.documents,
                    epubSettings: {
                      ...settings.documents.epubSettings,
                      lineHeight: value,
                    },
                  },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">{t("settingsDocs.autoScroll")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settingsDocs.autoScrollDesc")}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={settings.documents.epubSettings.autoScroll}
                onChange={(e) =>
                  updateSettings({
                    documents: {
                      ...settings.documents,
                      epubSettings: { ...settings.documents.epubSettings, autoScroll: e.target.checked },
                    },
                  })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>
        </div>
      </div>

      {/* Auto-Segmentation */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("settingsDocs.autoSegmentation")}</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="segmentationMethod" className="block text-sm font-medium text-foreground mb-2">
              {t("settingsDocs.segmentationMethod")}
            </label>
            <select
              id="segmentationMethod"
              value={settings.documents.segmentation.method}
              onChange={(e) =>
                updateSettings({
                  documents: {
                    ...settings.documents,
                    segmentation: { ...settings.documents.segmentation, method: e.target.value as any },
                  },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            >
              <option value="semantic" className="text-foreground">{t("settingsDocs.semantic")}</option>
              <option value="paragraph" className="text-foreground">{t("settingsDocs.paragraphBased")}</option>
              <option value="fixed" className="text-foreground">{t("settingsDocs.fixedLength")}</option>
              <option value="smart" className="text-foreground">{t("settingsDocs.smart")}</option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              {t("settingsDocs.segmentationDesc")}
            </p>
          </div>

          <div>
            <label htmlFor="segmentLength" className="block text-sm font-medium text-foreground mb-2">
              {t("settingsDocs.targetSegmentLength")}
            </label>
            <NumericInput
              id="segmentLength"
              min={50}
              max={1000}
              value={settings.documents.segmentation.targetLength}
              onChange={(value) =>
                updateSettings({
                  documents: {
                    ...settings.documents,
                    segmentation: { ...settings.documents.segmentation, targetLength: value },
                  },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("settingsDocs.approxWordsPerExtract")}
            </p>
          </div>

          <div>
            <label htmlFor="overlapLength" className="block text-sm font-medium text-foreground mb-2">
              {t("settingsDocs.overlapLength")}
            </label>
            <NumericInput
              id="overlapLength"
              min={0}
              max={100}
              value={settings.documents.segmentation.overlap}
              onChange={(value) =>
                updateSettings({
                  documents: {
                    ...settings.documents,
                    segmentation: { ...settings.documents.segmentation, overlap: value },
                  },
                })
              }
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("settingsDocs.overlapDesc")}
            </p>
          </div>
        </div>
      </div>

      {/* OCR Settings */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("settingsDocs.ocr")}</h3>
        <OCRSettings
          settings={settings.documents.ocr}
          onUpdateSettings={(updates) =>
            updateSettingsCategory("documents", {
              ...settings.documents,
              ocr: { ...settings.documents.ocr, ...updates },
            })
          }
        />
      </div>

      {/* Storage */}
      <div>
        <h3 className="text-lg font-semibold mb-3 text-foreground">{t("settingsDocs.storage")}</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">{t("settingsDocs.cacheContent")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settingsDocs.cacheContentDesc")}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={settings.documents.cacheContent}
                onChange={(e) =>
                  updateSettings({
                    documents: { ...settings.documents, cacheContent: e.target.checked },
                  })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-foreground">{t("settingsDocs.autoCleanup")}</p>
              <p className="text-xs text-muted-foreground">
                {t("settingsDocs.autoCleanupDesc")}
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={settings.documents.autoCleanupCache}
                onChange={(e) =>
                  updateSettings({
                    documents: { ...settings.documents, autoCleanupCache: e.target.checked },
                  })
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary"></div>
            </label>
          </div>
        </div>
      </div>

      {/* Tag-Aware Scheduling */}
      <TASSettingsPanel />
    </div>
  );
}
