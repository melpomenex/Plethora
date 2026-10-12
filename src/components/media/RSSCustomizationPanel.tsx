/**
 * RSS Customization Panel
 *
 * Provides ultra-customizability for RSS feeds including:
 * - Funnel preferences (keywords, authors, categories)
 * - Display preferences (view mode, theme, density)
 * - Layout preferences (columns, thumbnails)
 * - Sorting preferences
 */

import { useState, useEffect, useId } from "react";
import {
  ArrowCounterClockwise,
  ArrowsVertical,
  BookOpen,
  Check,
  Eye,
  FloppyDisk,
  Funnel,
  GridFour,
} from "@phosphor-icons/react";
import { Dialog } from "../md3/Dialog";
import {
  RSS_DEFAULTS,
  RSS_PRESETS,
  resolveRssPreferences,
  type RssUserPreferenceUpdate,
} from "../../types/rssCustomization";
export type {
  RssUserPreferenceUpdate as RSSUserPreferenceUpdate,
  RssUserPreference as RSSUserPreference,
} from "../../types/rssCustomization";
import { useToast } from "../common/Toast";
import { useI18n } from "../../lib/i18n";

interface RSSCustomizationPanelProps {
  feedId?: string;
  isOpen: boolean;
  onClose: () => void;
  currentPreferences?: RSSUserPreferenceUpdate | null;
  onSave: (preferences: RSSUserPreferenceUpdate) => Promise<void>;
}

type RSSUserPreferenceUpdate = RssUserPreferenceUpdate;

type TabType = "filters" | "display" | "layout" | "sorting" | "reader";

export function RSSCustomizationPanel({
  feedId,
  currentPreferences,
  isOpen,
  onClose,
  onSave,
}: RSSCustomizationPanelProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabType>("display");
  const [preferences, setPreferences] = useState<RSSUserPreferenceUpdate>({});
  const [hasChanges, setHasChanges] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [patch, setPatch] = useState<RSSUserPreferenceUpdate>({});
  useEffect(() => {
    if (!isOpen) return;
    setPreferences(resolveRssPreferences(currentPreferences ?? {}));
    setPatch({});
    setHasChanges(false);
    setSaveError(false);
  }, [isOpen, feedId, currentPreferences]);
  const resetToDefaults = () => {
    setPreferences({ ...RSS_DEFAULTS });
    setPatch({ ...RSS_DEFAULTS });
    setHasChanges(true);
  };
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await onSave(patch);
      setHasChanges(false);
      setPatch({});
      toast.success(
        t("rssCustomization.preferencesSaved"),
        t("rssCustomization.preferencesSavedDesc")
      );
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const updatePreference = <K extends keyof RSSUserPreferenceUpdate>(
    key: K,
    value: RSSUserPreferenceUpdate[K]
  ) => {
    setPreferences((prev) => ({ ...prev, [key]: value }));
    setPatch((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  if (!isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={t("rssCustomization.title")}
      className="!max-w-4xl !max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]"
      footer={
        <>
          <button
            onClick={resetToDefaults}
            disabled={saving}
            className="px-3 py-2 text-sm rounded-lg hover:bg-muted flex items-center gap-1"
          >
            <ArrowCounterClockwise className="w-4 h-4" />
            {t("rssCustomization.reset")}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!hasChanges || saving || !currentPreferences}
            className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg disabled:opacity-50 flex items-center gap-1"
          >
            <FloppyDisk className="w-4 h-4" />
            {saving ? t("rssCustomization.saving") : t("common.save")}
          </button>
        </>
      }
    >
      {saveError && (
        <p role="alert" className="text-sm text-red-600 mb-3">
          {t("rssCustomization.saveFailed")}
        </p>
      )}
      <fieldset disabled={saving || !currentPreferences} className="min-w-0">
        <div className="flex flex-col sm:flex-row min-h-0">
          {/* Tabs */}
          <div className="flex flex-wrap sm:block sm:w-44 sm:shrink-0 sm:border-r border-border p-2 gap-1 sm:space-y-1">
            <TabButton
              active={activeTab === "filters"}
              icon={Funnel}
              label={t("rssCustomization.filters")}
              onClick={() => setActiveTab("filters")}
            />
            <TabButton
              active={activeTab === "display"}
              icon={Eye}
              label={t("rssCustomization.display")}
              onClick={() => setActiveTab("display")}
            />
            <TabButton
              active={activeTab === "layout"}
              icon={GridFour}
              label={t("rssCustomization.layout")}
              onClick={() => setActiveTab("layout")}
            />
            <TabButton
              active={activeTab === "sorting"}
              icon={ArrowsVertical}
              label={t("rssCustomization.sorting")}
              onClick={() => setActiveTab("sorting")}
            />
            <TabButton
              active={activeTab === "reader"}
              icon={BookOpen}
              label={t("rssCustomization.reader")}
              onClick={() => setActiveTab("reader")}
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 p-2 sm:p-6">
            {activeTab === "filters" && (
              <FiltersTab preferences={preferences} updatePreference={updatePreference} />
            )}
            {activeTab === "display" && (
              <DisplayTab preferences={preferences} updatePreference={updatePreference} />
            )}
            {activeTab === "layout" && (
              <LayoutTab preferences={preferences} updatePreference={updatePreference} />
            )}
            {activeTab === "sorting" && (
              <SortingTab preferences={preferences} updatePreference={updatePreference} />
            )}
            {activeTab === "reader" && (
              <ReaderTab preferences={preferences} updatePreference={updatePreference} />
            )}
          </div>
        </div>
      </fieldset>
    </Dialog>
  );
}

function TabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-auto sm:w-full px-3 py-2 text-sm rounded-lg transition-colors flex items-center gap-2 ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function FiltersTab({
  preferences,
  updatePreference,
}: {
  preferences: RSSUserPreferenceUpdate;
  updatePreference: <K extends keyof RSSUserPreferenceUpdate>(
    key: K,
    value: RSSUserPreferenceUpdate[K]
  ) => void;
}) {
  return (
    <div className="space-y-6">
      <Section
        title="Keyword Filters"
        description="Funnel articles by keywords in title or content"
      >
        <FormField
          label="Include Keywords"
          description="Show articles containing these keywords (comma-separated)"
          value={preferences.keyword_include || ""}
          onChange={(value) => updatePreference("keyword_include", value)}
          placeholder="e.g., AI, machine learning, technology"
        />
        <FormField
          label="Exclude Keywords"
          description="Hide articles containing these keywords (comma-separated)"
          value={preferences.keyword_exclude || ""}
          onChange={(value) => updatePreference("keyword_exclude", value)}
          placeholder="e.g., ads, sponsored, clickbait"
        />
      </Section>

      <Section
        title="Author Filters"
        description="Funnel articles by author"
      >
        <FormField
          label="Allowed Authors"
          description="Only show articles from these authors (comma-separated)"
          value={preferences.author_whitelist || ""}
          onChange={(value) => updatePreference("author_whitelist", value)}
          placeholder="e.g., John Doe, Jane Smith"
        />
        <FormField
          label="Blocked Authors"
          description="Hide articles from these authors (comma-separated)"
          value={preferences.author_blacklist || ""}
          onChange={(value) => updatePreference("author_blacklist", value)}
          placeholder="e.g., Spam Author"
        />
      </Section>

      <Section
        title="Category Funnel"
        description="Filter articles by categories supplied by the feed"
      >
        <FormField
          label="Categories"
          description="Show only these categories (comma-separated)"
          value={preferences.category_filter || ""}
          onChange={(value) => updatePreference("category_filter", value)}
          placeholder="e.g., tech, science, politics"
        />
      </Section>
    </div>
  );
}

function DisplayTab({
  preferences,
  updatePreference,
}: {
  preferences: RSSUserPreferenceUpdate;
  updatePreference: <K extends keyof RSSUserPreferenceUpdate>(
    key: K,
    value: RSSUserPreferenceUpdate[K]
  ) => void;
}) {
  return (
    <div className="space-y-6">
      <Section
        title="View Mode"
        description="Choose how articles are displayed"
      >
        <RadioGroup
          value={preferences.view_mode || "card"}
          options={[
            { value: "card", label: "Card", description: "Rich cards with thumbnails" },
            { value: "list", label: "List", description: "Compact list view" },
            { value: "compact", label: "Compact", description: "Minimal list view" },
          ]}
          onChange={(value) => updatePreference("view_mode", value)}
        />
      </Section>

      <Section
        title="Theme"
        description="Color theme for articles"
      >
        <RadioGroup
          value={preferences.theme_mode || "system"}
          options={[
            { value: "system", label: "System", description: "Match system preference" },
            { value: "light", label: "Light", description: "Always light theme" },
            { value: "dark", label: "Dark", description: "Always dark theme" },
          ]}
          onChange={(value) => updatePreference("theme_mode", value)}
        />
      </Section>

      <Section
        title="Display Options"
        description="Toggle additional information"
      >
        <ToggleField
          label="Show Thumbnails"
          checked={preferences.show_thumbnails ?? true}
          onChange={(checked) => updatePreference("show_thumbnails", checked)}
        />
        <ToggleField
          label="Show Author"
          checked={preferences.show_author ?? true}
          onChange={(checked) => updatePreference("show_author", checked)}
        />
        <ToggleField
          label="Show Date"
          checked={preferences.show_date ?? true}
          onChange={(checked) => updatePreference("show_date", checked)}
        />
        <ToggleField
          label="Show Feed Icon"
          checked={preferences.show_feed_icon ?? true}
          onChange={(checked) => updatePreference("show_feed_icon", checked)}
        />
      </Section>

      <Section
        title="Content Preview"
        description="Configure article excerpt display"
      >
        <RangeField
          label="Excerpt Length"
          value={preferences.excerpt_length ?? 150}
          onChange={(value) => updatePreference("excerpt_length", value)}
          min={50}
          max={500}
          step={10}
          suffix="characters"
        />
      </Section>
    </div>
  );
}

function LayoutTab({
  preferences,
  updatePreference,
}: {
  preferences: RSSUserPreferenceUpdate;
  updatePreference: <K extends keyof RSSUserPreferenceUpdate>(
    key: K,
    value: RSSUserPreferenceUpdate[K]
  ) => void;
}) {
  return (
    <div className="space-y-6">
      <Section
        title="Density"
        description="Control the spacing and sizing of articles"
      >
        <RadioGroup
          value={preferences.density || "normal"}
          options={[
            {
              value: "compact",
              label: "Compact",
              description: "Tight spacing, more articles visible",
            },
            { value: "normal", label: "Normal", description: "Balanced spacing" },
            {
              value: "comfortable",
              label: "Comfortable",
              description: "More whitespace, easier reading",
            },
          ]}
          onChange={(value) => updatePreference("density", value)}
        />
      </Section>

      <Section
        title="Columns"
        description="Columns in Magazine and Grid layouts, limited by available space"
      >
        <RangeField
          label="Column Count"
          value={preferences.column_count ?? 2}
          onChange={(value) => updatePreference("column_count", value)}
          min={1}
          max={6}
          step={1}
          suffix="columns"
        />
      </Section>

      <Section
        title="Card Height"
        description="Height of article cards"
      >
        <RadioGroup
          value={preferences.card_height || "normal"}
          options={[
            { value: "compact", label: "Compact", description: "Title and metadata, without excerpt" },
            { value: "normal", label: "Normal", description: "Title + short excerpt" },
            { value: "tall", label: "Tall", description: "Title + long excerpt + metadata" },
          ]}
          onChange={(value) => updatePreference("card_height", value)}
        />
      </Section>

      <Section
        title="Thumbnails"
        description="Thumbnail image display; size applies to Card presentation"
      >
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={preferences.show_thumbnails ?? true}
              onChange={(e) => updatePreference("show_thumbnails", e.target.checked)}
              className="rounded border-border"
            />
            Show thumbnails
          </label>
          <RadioGroup
            value={
              preferences.show_thumbnails === false
                ? "hidden"
                : preferences.thumbnail_size || "small"
            }
            options={[
              { value: "hidden", label: "Hidden", description: "No thumbnails" },
              { value: "small", label: "Small", description: "Small thumbnails on the left" },
              { value: "large", label: "Large", description: "Large thumbnails above title" },
            ]}
            onChange={(value) => {
              if (value === "hidden") {
                updatePreference("show_thumbnails", false);
              } else {
                updatePreference("show_thumbnails", true);
                updatePreference("thumbnail_size", value);
              }
            }}
          />
        </div>
      </Section>
    </div>
  );
}

function SortingTab({
  preferences,
  updatePreference,
}: {
  preferences: RSSUserPreferenceUpdate;
  updatePreference: <K extends keyof RSSUserPreferenceUpdate>(
    key: K,
    value: RSSUserPreferenceUpdate[K]
  ) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <Section
        title="Sort By"
        description="Choose how articles are sorted"
      >
        <RadioGroup
          value={preferences.sort_by || "date"}
          options={[
            { value: "date", label: "Date", description: "Sort by publication date" },
            { value: "title", label: "Title", description: "Sort alphabetically by title" },
            { value: "read_status", label: "Read Status", description: "Group unread and read articles" },
            {
              value: "reading_time",
              label: "Reading Time",
              description: "Sort by estimated read time",
            },
          ]}
          onChange={(value) => updatePreference("sort_by", value)}
        />
      </Section>

      <Section
        title="Sort Order"
        description="Choose ascending or descending order"
      >
        <RadioGroup
          value={preferences.sort_order || "desc"}
          options={[
            {
              value: "desc",
              label: "Descending",
              description: "Newest, Z–A, read first, or longest first",
            },
            {
              value: "asc",
              label: "Ascending",
              description: "Oldest, A–Z, unread first, or shortest first",
            },
          ]}
          onChange={(value) => updatePreference("sort_order", value)}
        />
      </Section>

      <Section title="Smart View Modes" description="Presets for presentation and sorting">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Object.entries(RSS_PRESETS).map(([key, preset]) => (
            <SmartViewButton
              key={key}
              label={t(`rssCustomization.preset.${key}`)}
              description={t(`rssCustomization.preset.${key}Desc`)}
              onClick={() =>
                Object.entries(preset).forEach(([field, value]) =>
                  updatePreference(field as keyof RSSUserPreferenceUpdate, value)
                )
              }
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

function ReaderTab({
  preferences,
  updatePreference,
}: {
  preferences: RSSUserPreferenceUpdate;
  updatePreference: <K extends keyof RSSUserPreferenceUpdate>(
    key: K,
    value: RSSUserPreferenceUpdate[K]
  ) => void;
}) {
  return (
    <div className="space-y-6">
      <Section
        title="Typography"
        description="Customize the font and text appearance"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Font Family</label>
            <div className="grid grid-cols-1 gap-2">
              {[
                {
                  value:
                    '"Iowan Old Style", "Charter", "Source Serif 4", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
                  label: "Serif (Default)",
                  family: "serif",
                },
                {
                  value:
                    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                  label: "Sans Serif",
                  family: "sans-serif",
                },
                {
                  value:
                    '"Menlo", "Consolas", "Monaco", "Liberation Mono", "Lucida Console", monospace',
                  label: "Monospace",
                  family: "monospace",
                },
              ].map((font) => (
                <button
                  key={font.value}
                  onClick={() => updatePreference("font_family", font.value)}
                  className={`flex items-center justify-between p-3 border rounded-lg text-left transition-colors ${
                    preferences.font_family === font.value
                      ? "bg-primary/10 border-primary/50 ring-1 ring-primary/20"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <span style={{ fontFamily: font.value }} className="text-base">
                    {font.label}
                  </span>
                  {preferences.font_family === font.value && (
                    <Check className="w-4 h-4 text-primary" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <RangeField
            label="Font Size"
            value={preferences.font_size ?? 16}
            onChange={(value) => updatePreference("font_size", value)}
            min={12}
            max={32}
            step={1}
            suffix="px"
          />

          <RangeField
            label="Line Height"
            value={Math.round((preferences.line_height ?? 1.6) * 10) / 10}
            onChange={(value) => updatePreference("line_height", value)}
            min={1.0}
            max={2.5}
            step={0.1}
          />
        </div>
      </Section>

      <Section
        title="Layout"
        description="Adjust reading width and alignment"
      >
        <RangeField
          label="Max Width"
          value={preferences.content_width ?? 65}
          onChange={(value) => updatePreference("content_width", value)}
          min={40}
          max={100}
          step={5}
          suffix="ch"
        />
        
        <div className="pt-2">
          <label className="block text-sm font-medium text-foreground mb-2">Text Alignment</label>
          <div className="flex bg-muted rounded-lg p-1">
            {["left", "justify"].map((align) => (
              <button
                key={align}
                onClick={() => updatePreference("text_align", align)}
                className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-all ${
                  (preferences.text_align || "left") === align
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {align.charAt(0).toUpperCase() + align.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FormField({
  label,
  description,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return <LabeledControl label={label} description={description}>{inputId => (
    <input id={inputId} type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
  )}</LabeledControl>;
}

function LabeledControl({label, description, valueLabel, children}: {
  label: string; description?: string; valueLabel?: string;
  children: (id: string) => React.ReactNode;
}) {
  const inputId = useId();
  return <div>
    <div className="flex items-center justify-between mb-2 gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">{label}</label>
      {valueLabel && <span className="text-sm text-muted-foreground">{valueLabel}</span>}
    </div>
    {description && <p className="text-xs text-muted-foreground mb-2">{description}</p>}
    {children(inputId)}
  </div>;
}

function RadioGroup({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string; description: string }[];
  onChange: (value: string) => void;
}) {
  const groupId = useId();
  return (
    <div className="space-y-2">
      {options.map((option) => (
        <label
          key={option.value}
          className={`flex items-start gap-3 p-3 border border-border rounded-lg cursor-pointer transition-colors ${
            value === option.value
              ? "bg-primary/10 border-primary/50"
              : "hover:bg-muted"
          }`}
        >
          <input
            type="radio"
            name={groupId}
            value={option.value}
            checked={value === option.value}
            onChange={(e) => onChange(e.target.value)}
            className="mt-1"
          />
          <div>
            <div className="text-sm font-medium text-foreground">{option.label}</div>
            <div className="text-xs text-muted-foreground">{option.description}</div>
          </div>
        </label>
      ))}
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between p-3 border border-border rounded-lg hover:bg-muted transition-colors cursor-pointer">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="relative shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div
          className={`w-11 h-6 rounded-full transition-colors ${
            checked ? "bg-primary" : "bg-muted"
          }`}
        >
          <div
            className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${
              checked ? "translate-x-5" : "translate-x-0.5"
            } mt-0.5`}
          />
        </div>
      </div>
    </label>
  );
}

function RangeField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}) {
  return <LabeledControl label={label} valueLabel={`${value} ${suffix ?? ""}`}>{inputId => (
    <input id={inputId} type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow" />
  )}</LabeledControl>;
}

function SmartViewButton({
  label,
  description,
  onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="p-4 border border-border rounded-lg hover:bg-muted transition-colors text-left"
    >
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
    </button>
  );
}
