import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Moon,
  Sparkle,
  Sun,
  UploadSimple,
} from "@phosphor-icons/react";
import { ResponsiveDialogSheet } from "../adaptive/ResponsiveDialogSheet";
import { useTheme } from "../../contexts/ThemeContext";
import {
  prepareBackdropImage,
  saveBackdropImage,
  type PreparedBackdropImage,
} from "../../themes/imageStorage";
import {
  animatedImagePosterKey,
} from "../../themes/animatedImage/storage";
import {
  cancelAnimatedImagePreparation,
  prepareAnimatedImageFile,
} from "../../themes/animatedImage/prepareAnimatedImage";
import type {
  AnimatedImagePreparationStage,
  PreparedAnimatedImage,
} from "../../themes/animatedImage/contracts";
import {
  extractPaletteFromWeightedSamples,
  extractPaletteFromPixels,
  getMoodDefaults,
  synthesizeThemeFromPalette,
  type ExtractedImagePalette,
  type ImageThemeMood,
} from "../../themes/imageThemeExtractor";
import type { Theme, ThemeVariant } from "../../types/theme";
import { isNativeMobile } from "../../lib/tauri";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";

interface ImageThemeModalProps {
  onClose: () => void;
  onSaved?: (theme: Theme) => void;
}

const MOODS: Array<{ id: ImageThemeMood; label: string; hint: string }> = [
  { id: "vibrant", label: "Vibrant", hint: "Rich, expressive accents" },
  { id: "editorial", label: "Editorial", hint: "Muted, calm surfaces" },
  { id: "deep-glass", label: "Deep Glass", hint: "More image, frosted panels" },
  { id: "high-contrast", label: "High Contrast", hint: "Crisp 7:1 text legibility" },
];

type PreparedImage =
  | { readonly kind: "still"; readonly value: PreparedBackdropImage }
  | { readonly kind: "gif"; readonly value: PreparedAnimatedImage };

interface PreparationProgress {
  readonly stage: AnimatedImagePreparationStage;
  readonly fraction: number;
}

export function ImageThemeModal({ onClose, onSaved }: ImageThemeModalProps) {
  const {
    theme,
    themes,
    addCustomTheme,
    setTheme,
    previewCustomTheme,
    beginAnimatedImagePreview,
    updateAnimatedImagePreview,
    cancelAnimatedImagePreview,
    commitAnimatedImagePreview,
  } = useTheme();
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [palette, setPalette] = useState<ExtractedImagePalette | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState<PreparationProgress | null>(null);
  const [stillFallbackReason, setStillFallbackReason] = useState<string | null>(null);
  const [playAnimation, setPlayAnimation] = useState(true);
  const [animatedPreviewUrl, setAnimatedPreviewUrl] = useState<string | null>(null);
  const [readyPreviewMediaId, setReadyPreviewMediaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileJobRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const animatedPreviewTokenRef = useRef<number | null>(null);
  const previewPreparedRef = useRef<PreparedAnimatedImage | null>(null);

  const [name, setName] = useState("Custom Image Theme");
  const [variant, setVariant] = useState<ThemeVariant>("dark");
  const [mood, setMood] = useState<ImageThemeMood>("vibrant");
  const [primaryOverride, setPrimaryOverride] = useState<string | undefined>(undefined);

  const defaults = getMoodDefaults("vibrant");
  const [blur, setBlur] = useState<number>(defaults.blur ?? 6);
  const [scrimOpacity, setScrimOpacity] = useState<number>(defaults.scrimOpacity ?? 0.48);
  const [surfaceOpacity, setSurfaceOpacity] = useState<number>(defaults.surfaceOpacity ?? 0.76);
  const [brightness, setBrightness] = useState<number>(defaults.brightness ?? 0.95);

  const baseSource = themes[0] || theme;
  const baseTokens = useMemo(
    () => ({
      typography: baseSource.typography,
      spacing: baseSource.spacing,
      radius: baseSource.radius,
      shadows: baseSource.shadows,
    }),
    [baseSource],
  );

  const synthesizedTheme = useMemo(() => {
    if (!prepared || !palette) return null;
    const backgroundImageId = prepared.kind === "gif"
      ? animatedImagePosterKey(prepared.value.mediaId)
      : prepared.value.imageId;
    const imageAnimation = prepared.kind === "gif" && prepared.value.pack
      ? {
          version: 1 as const,
          mediaId: prepared.value.mediaId,
          sourceFormat: "gif" as const,
          enabled: playAnimation,
        }
      : undefined;
    const synthesized = synthesizeThemeFromPalette(palette, {
      id: prepared.kind === "gif"
        ? `custom-img-${prepared.value.mediaId}`
        : `custom-img-preview-${prepared.value.imageId}`,
      name,
      variant,
      mood,
      primaryOverride,
      backgroundImage: {
        imageId: backgroundImageId,
        thumbnailDataUrl: prepared.value.thumbnailDataUrl,
        blur,
        scrimOpacity,
        surfaceOpacity,
        brightness,
        ...(prepared.kind === "gif" ? { protectedSurfaces: true } : {}),
      },
      baseTokens,
    });
    return {
      ...synthesized,
      effects: {
        ...synthesized.effects,
        ...(imageAnimation ? { imageAnimation } : {}),
      },
    };
  }, [
    prepared,
    palette,
    name,
    variant,
    mood,
    primaryOverride,
    blur,
    scrimOpacity,
    surfaceOpacity,
    brightness,
    baseTokens,
    playAnimation,
  ]);

  const previewCustomThemeRef = useRef(previewCustomTheme);
  previewCustomThemeRef.current = previewCustomTheme;

  const cancelCurrentPreview = useCallback(() => {
    const token = animatedPreviewTokenRef.current;
    if (token !== null) {
      cancelAnimatedImagePreview?.(token);
      animatedPreviewTokenRef.current = null;
      previewPreparedRef.current = null;
    } else {
      previewCustomTheme?.(null);
    }
  }, [cancelAnimatedImagePreview, previewCustomTheme]);

  // The provider owns the prepared bytes; this component only updates the scoped lease.
  useEffect(() => {
    if (!prepared || !synthesizedTheme) return;
    if (prepared.kind === "gif") {
      if (!beginAnimatedImagePreview || !updateAnimatedImagePreview) return;
      if (previewPreparedRef.current !== prepared.value || animatedPreviewTokenRef.current === null) {
        const token = beginAnimatedImagePreview(prepared.value, synthesizedTheme);
        animatedPreviewTokenRef.current = token;
        previewPreparedRef.current = prepared.value;
        setReadyPreviewMediaId(prepared.value.mediaId);
      } else {
        updateAnimatedImagePreview(animatedPreviewTokenRef.current, synthesizedTheme);
      }
      return;
    }

    const existingToken = animatedPreviewTokenRef.current;
    if (existingToken !== null) {
      cancelAnimatedImagePreview?.(existingToken);
      animatedPreviewTokenRef.current = null;
      previewPreparedRef.current = null;
    }
    if (!previewCustomTheme) return;
    let cancelled = false;
    void saveBackdropImage(prepared.value.imageId, prepared.value.dataUrl).then(() => {
      if (!cancelled) previewCustomTheme(synthesizedTheme);
    });
    return () => { cancelled = true; };
  }, [
    prepared,
    synthesizedTheme,
    beginAnimatedImagePreview,
    updateAnimatedImagePreview,
    cancelAnimatedImagePreview,
    previewCustomTheme,
  ]);

  useEffect(() => {
    if (!prepared || prepared.kind !== "gif") {
      setAnimatedPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(prepared.value.poster);
    setAnimatedPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [prepared]);

  // Revert preview on unmount.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      cancelAnimatedImagePreparation();
      const token = animatedPreviewTokenRef.current;
      if (token !== null) cancelAnimatedImagePreview?.(token);
      else previewCustomThemeRef.current?.(null);
    };
  }, [cancelAnimatedImagePreview]);

  const fileInputId = "image-theme-file-input";

  const handleFile = useCallback(async (file: File) => {
    const hasImageExt = /\.(png|jpe?g|webp|gif|avif|bmp|heic|heif)$/i.test(file.name || "");
    const hasKnownNonImageMime =
      Boolean(file.type) &&
      !file.type.startsWith("image/") &&
      file.type !== "application/octet-stream";
    if (hasKnownNonImageMime && !hasImageExt) {
      setError("Please select an image file (PNG, JPEG, WebP, GIF, or AVIF).");
      return;
    }
    const job = ++fileJobRef.current;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    cancelAnimatedImagePreparation();
    setError(null);
    setProgress({ stage: "validating", fraction: 0 });
    setStillFallbackReason(null);
    setIsProcessing(true);
    try {
      const isCompact = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 640px)").matches;
      const tier = isNativeMobile() || isCompact
        ? "mobile"
        : "desktop";
      let animated: PreparedAnimatedImage | null = null;
      let fallbackReason: string | null = null;
      try {
        animated = await prepareAnimatedImageFile(file, {
          tier,
          signal: abortController.signal,
          onProgress: (next) => {
            if (fileJobRef.current === job) setProgress({ stage: next.stage, fraction: next.fraction });
          },
        });
      } catch (prepareError) {
        const failureCode = prepareError instanceof Error && "code" in prepareError
          ? String((prepareError as Error & { code?: unknown }).code)
          : "";
        if (["worker-unavailable", "decoder-unavailable", "deadline-exceeded"].includes(failureCode)) {
          fallbackReason = t("theme.imageAnimationStillFallback");
        } else {
          throw prepareError;
        }
      }
      if (fileJobRef.current !== job) return;

      let extracted: ExtractedImagePalette;
      if (animated) {
        extracted = extractPaletteFromWeightedSamples(animated.paletteSamples);
        setPrepared({ kind: "gif", value: animated });
        setPalette(extracted);
        setStillFallbackReason(animated.outcome === "still" ? t("theme.imageAnimationStillOnly") : null);
        setPlayAnimation(animated.outcome === "animated");
      } else {
        const result = await prepareBackdropImage(file);
        if (fileJobRef.current !== job) return;
        extracted = extractPaletteFromPixels(
          result.samplePixels,
          result.sampleWidth,
          result.sampleHeight
        );
        await saveBackdropImage(result.imageId, result.dataUrl);
        if (fileJobRef.current !== job) return;
        setPrepared({ kind: "still", value: result });
        setPalette(extracted);
        setStillFallbackReason(fallbackReason);
        setPlayAnimation(false);
      }
      setVariant(extracted.suggestedVariant);
      setPrimaryOverride(undefined);
      const baseName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]+/g, " ").trim();
      if (baseName) {
        setName(baseName.slice(0, 36));
      }
    } catch (err) {
      if (fileJobRef.current === job) {
        setError(err instanceof Error ? err.message : t("theme.imageProcessingFailed"));
      }
    } finally {
      if (fileJobRef.current === job) {
        setIsProcessing(false);
        setProgress(null);
        abortControllerRef.current = null;
      }
    }
  }, [t]);

  const handleMoodChange = (nextMood: ImageThemeMood) => {
    setMood(nextMood);
    const d = getMoodDefaults(nextMood);
    setBlur(d.blur ?? 6);
    setScrimOpacity(d.scrimOpacity ?? 0.48);
    setSurfaceOpacity(d.surfaceOpacity ?? 0.76);
    setBrightness(d.brightness ?? 0.95);
  };

  const handleSave = async () => {
    if (!prepared || !palette || !synthesizedTheme) return;
    setIsSaving(true);
    setError(null);
    try {
      if (prepared.kind === "gif") {
        const token = animatedPreviewTokenRef.current;
        if (token === null || !commitAnimatedImagePreview) {
          throw new Error(t("theme.imageSaveFailed"));
        }
        await commitAnimatedImagePreview(token);
        animatedPreviewTokenRef.current = null;
        previewPreparedRef.current = null;
        onSaved?.(synthesizedTheme);
      } else {
        await saveBackdropImage(prepared.value.imageId, prepared.value.dataUrl);
        const finalTheme: Theme = {
          ...synthesizedTheme,
          id: `custom-img-${Date.now()}`,
        };
        previewCustomTheme?.(null);
        addCustomTheme(finalTheme);
        setTheme(finalTheme.id);
        onSaved?.(finalTheme);
      }
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("theme.imageSaveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    cancelAnimatedImagePreparation();
    cancelCurrentPreview();
    onClose();
  };

  const previewReady = prepared?.kind !== "gif" || prepared.value.mediaId === readyPreviewMediaId;
  const footer = (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={handleCancel}
        className="rounded-lg border border-border px-3.5 py-2 text-sm text-foreground hover:bg-muted"
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={!synthesizedTheme || !previewReady || isProcessing || isSaving}
        onClick={() => void handleSave()}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSaving ? t("theme.imageSaving") : t("theme.imageSaveApply")}
      </button>
    </div>
  );

  return (
    <ResponsiveDialogSheet
      open
      onClose={handleCancel}
      title={
        <span className="flex items-center gap-2">
          <Sparkle className="h-5 w-5 shrink-0 text-primary" />
          <span>Create Theme from Image</span>
        </span>
      }
      description={t("theme.imageThemeDescription")}
      desktopMaxWidth="42rem"
      footer={footer}
    >
      <div className="space-y-5">
          {/* Dropzone / Preview */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
            className={cn(
              "relative flex flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors",
              prepared ? "h-44 border-border" : "h-40 border-border hover:border-primary/60",
              isDragging && "border-primary bg-primary/10"
            )}
          >
            <input
              id={fileInputId}
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />

            {prepared ? (
              <>
                <img
                  src={prepared.kind === "still"
                    ? prepared.value.dataUrl
                    : animatedPreviewUrl || prepared.value.thumbnailDataUrl}
                  alt="Backdrop preview"
                  className="h-full w-full object-cover"
                  style={{
                    filter: `blur(${Math.min(blur, 12)}px) brightness(${brightness}) saturate(1.08)`,
                    transform: "scale(1.06)",
                  }}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundColor: synthesizedTheme?.colors.background ?? "#121426",
                    opacity: scrimOpacity,
                  }}
                />
                <div className="relative z-10 flex items-center gap-3 rounded-lg border border-white/15 bg-black/45 px-3.5 py-2 text-xs text-white backdrop-blur-md">
                  <ImageIcon className="h-4 w-4" />
                  <span>{prepared.value.width}×{prepared.value.height}</span>
                  <label
                    htmlFor={fileInputId}
                    className="cursor-pointer rounded bg-white/15 px-2.5 py-1.5 font-medium hover:bg-white/25"
                  >
                    {t("theme.imageChange")}
                  </label>
                </div>
              </>
            ) : (
              <label
                htmlFor={fileInputId}
                className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 px-4 text-center"
              >
                <UploadSimple className="h-7 w-7 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  {isProcessing ? t("theme.imagePreparing") : t("theme.imageChoose")}
                </p>
                <p className="text-xs text-muted-foreground">{t("theme.imageFormats")}</p>
              </label>
            )}
          </div>

          {progress && (
            <div className="space-y-1" role="status" aria-live="polite">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t(`theme.imageProgress.${progress.stage}`)}</span>
                <span>{Math.round(progress.fraction * 100)}%</span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label={t("theme.imagePreparationProgress")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress.fraction * 100)}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                />
              </div>
            </div>
          )}

          {stillFallbackReason && (
            <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground" role="status">
              {stillFallbackReason}
            </p>
          )}

          {error && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          {palette && synthesizedTheme && (
            <>
              {/* Name + Variant */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    {t("theme.imageThemeName")}
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("theme.imageThemeNamePlaceholder")}
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    {t("theme.imageMode")}
                  </label>
                  <div className="flex rounded-lg border border-border bg-background p-0.5">
                    <button
                      type="button"
                      onClick={() => setVariant("dark")}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        variant === "dark" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Moon className="h-3.5 w-3.5" />
                      {t("theme.imageDark")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setVariant("light")}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        variant === "light" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Sun className="h-3.5 w-3.5" />
                      {t("theme.imageLight")}
                    </button>
                  </div>
                </div>
              </div>

              {/* Mood Presets */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  {t("theme.imageMood")}
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {MOODS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleMoodChange(m.id)}
                      className={cn(
                        "rounded-lg border px-2.5 py-2 text-left transition-colors",
                        mood === m.id
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <div className="text-xs font-semibold">{m.label}</div>
                      <div className="mt-0.5 text-[11px] opacity-80">{m.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              {prepared.kind === "gif" && prepared.value.pack && (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={playAnimation}
                    onChange={(event) => setPlayAnimation(event.target.checked)}
                    aria-label={t("theme.playAnimation")}
                    className="h-4 w-4 accent-primary"
                  />
                  <span>{t("theme.playAnimation")}</span>
                </label>
              )}

              {prepared.kind === "gif" && prepared.value.outcome === "still" && (
                <p className="text-xs text-muted-foreground" role="status">
                  {prepared.value.stillReason === "unsafe-flashing"
                    ? t("theme.imageUnsafeAnimation")
                    : t("theme.imageAnimationStillOnly")}
                </p>
              )}

              {/* Extracted Swatches */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    Extracted Accent Palette (click to pick primary)
                  </label>
                  {primaryOverride && (
                    <button
                      type="button"
                      onClick={() => setPrimaryOverride(undefined)}
                      className="text-xs text-primary hover:underline"
                    >
                      Reset to auto
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {palette.swatches.map((swatch) => {
                    const active = primaryOverride === swatch.hex;
                    return (
                      <button
                        key={swatch.hex}
                        type="button"
                        title={`Use ${swatch.hex} as primary accent`}
                        onClick={() => setPrimaryOverride(swatch.hex)}
                        className={cn(
                          "h-8 w-8 rounded-full border-2 transition-transform hover:scale-110",
                          active ? "border-foreground ring-2 ring-primary ring-offset-2 ring-offset-card" : "border-border"
                        )}
                        style={{ backgroundColor: swatch.hex }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Atmosphere Sliders */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Backdrop Blur</span>
                    <span>{blur}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={28}
                    step={1}
                    value={blur}
                    onChange={(e) => setBlur(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </label>

                <label className="space-y-1 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Background Dim</span>
                    <span>{Math.round(scrimOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.15}
                    max={0.88}
                    step={0.02}
                    value={scrimOpacity}
                    onChange={(e) => setScrimOpacity(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </label>

                <label className="space-y-1 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Panel Glass Opacity</span>
                    <span>{Math.round(surfaceOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.45}
                    max={0.96}
                    step={0.02}
                    value={surfaceOpacity}
                    onChange={(e) => setSurfaceOpacity(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </label>

                <label className="space-y-1 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Image Brightness</span>
                    <span>{Math.round(brightness * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.4}
                    max={1.3}
                    step={0.05}
                    value={brightness}
                    onChange={(e) => setBrightness(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </label>
              </div>
            </>
          )}
      </div>
    </ResponsiveDialogSheet>
  );
}
