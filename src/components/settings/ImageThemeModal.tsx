import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image as ImageIcon,
  Moon,
  Sparkle,
  Sun,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { useTheme } from "../../contexts/ThemeContext";
import {
  prepareBackdropImage,
  saveBackdropImage,
  type PreparedBackdropImage,
} from "../../themes/imageStorage";
import {
  extractPaletteFromPixels,
  getMoodDefaults,
  synthesizeThemeFromPalette,
  type ExtractedImagePalette,
  type ImageThemeMood,
} from "../../themes/imageThemeExtractor";
import type { Theme, ThemeVariant } from "../../types/theme";
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

export function ImageThemeModal({ onClose, onSaved }: ImageThemeModalProps) {
  const { theme, themes, addCustomTheme, setTheme, previewCustomTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [prepared, setPrepared] = useState<PreparedBackdropImage | null>(null);
  const [palette, setPalette] = useState<ExtractedImagePalette | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("Custom Image Theme");
  const [variant, setVariant] = useState<ThemeVariant>("dark");
  const [mood, setMood] = useState<ImageThemeMood>("vibrant");
  const [primaryOverride, setPrimaryOverride] = useState<string | undefined>(undefined);

  const defaults = getMoodDefaults("vibrant");
  const [blur, setBlur] = useState<number>(defaults.blur ?? 6);
  const [scrimOpacity, setScrimOpacity] = useState<number>(defaults.scrimOpacity ?? 0.48);
  const [surfaceOpacity, setSurfaceOpacity] = useState<number>(defaults.surfaceOpacity ?? 0.76);
  const [brightness, setBrightness] = useState<number>(defaults.brightness ?? 0.95);

  const baseTokens = useMemo(() => {
    const source = themes[0] || theme;
    return {
      typography: source.typography,
      spacing: source.spacing,
      radius: source.radius,
      shadows: source.shadows,
    };
  }, [themes, theme]);

  const synthesizedTheme = useMemo(() => {
    if (!prepared || !palette) return null;
    return synthesizeThemeFromPalette(palette, {
      id: `custom-img-preview-${prepared.imageId}`,
      name,
      variant,
      mood,
      primaryOverride,
      backgroundImage: {
        imageId: prepared.imageId,
        thumbnailDataUrl: prepared.thumbnailDataUrl,
        blur,
        scrimOpacity,
        surfaceOpacity,
        brightness,
      },
      baseTokens,
    });
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
  ]);

  // Live-apply preview across the entire app while the modal is open.
  useEffect(() => {
    if (!previewCustomTheme) return;
    if (prepared && synthesizedTheme) {
      // Ensure image is in memory cache so ThemeBackdrop renders it immediately.
      void saveBackdropImage(prepared.imageId, prepared.dataUrl).then(() => {
        previewCustomTheme(synthesizedTheme);
      });
    }
  }, [prepared, synthesizedTheme, previewCustomTheme]);

  // Revert preview on unmount.
  useEffect(() => {
    return () => {
      previewCustomTheme?.(null);
    };
  }, [previewCustomTheme]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file (PNG, JPEG, WebP, GIF, or AVIF).");
      return;
    }
    setError(null);
    setIsProcessing(true);
    try {
      const result = await prepareBackdropImage(file);
      const extracted = extractPaletteFromPixels(
        result.samplePixels,
        result.sampleWidth,
        result.sampleHeight
      );
      await saveBackdropImage(result.imageId, result.dataUrl);
      setPrepared(result);
      setPalette(extracted);
      setVariant(extracted.suggestedVariant);
      setPrimaryOverride(undefined);
      const baseName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]+/g, " ").trim();
      if (baseName) {
        setName(baseName.slice(0, 36));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process image.");
    } finally {
      setIsProcessing(false);
    }
  }, []);

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
    await saveBackdropImage(prepared.imageId, prepared.dataUrl);
    const finalTheme: Theme = {
      ...synthesizedTheme,
      id: `custom-img-${Date.now()}`,
    };
    previewCustomTheme?.(null);
    addCustomTheme(finalTheme);
    setTheme(finalTheme.id);
    onSaved?.(finalTheme);
    onClose();
  };

  const handleCancel = () => {
    previewCustomTheme?.(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Create Theme from Image"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Sparkle className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Create Theme from Image</h2>
              <p className="text-xs text-muted-foreground">
                Upload a photo or artwork — Plethora extracts an OKLCH palette and themes the app live.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
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
              prepared ? "h-44 border-border" : "h-40 cursor-pointer border-border hover:border-primary/60",
              isDragging && "border-primary bg-primary/10"
            )}
            onClick={() => !prepared && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />

            {prepared ? (
              <>
                <img
                  src={prepared.dataUrl}
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
                  <span>{prepared.width}×{prepared.height}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className="rounded bg-white/15 px-2 py-1 font-medium hover:bg-white/25"
                  >
                    Change image
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 text-center">
                <UploadSimple className="h-7 w-7 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  {isProcessing ? "Extracting OKLCH palette…" : "Drop an image here or click to browse"}
                </p>
                <p className="text-xs text-muted-foreground">PNG, JPEG, WebP, AVIF, or GIF</p>
              </div>
            )}
          </div>

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
                    Theme Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My Image Theme"
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Mode
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
                      Dark
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
                      Light
                    </button>
                  </div>
                </div>
              </div>

              {/* Mood Presets */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Mood
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

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-lg border border-border px-3.5 py-2 text-sm text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!synthesizedTheme || isProcessing}
            onClick={() => void handleSave()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save &amp; Apply Theme
          </button>
        </div>
      </div>
    </div>
  );
}
