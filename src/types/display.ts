/**
 * Display Mode and E-Ink Capabilities Types
 */

export type DisplayMode = 'standard' | 'eink' | 'auto';

export interface EinkCapabilities {
  /** True if hardware detection or OS characteristics indicate an e-paper / E-Ink device. */
  isEinkDevice: boolean;
  /** True if hardware volume buttons can be used for page navigation on this platform. */
  supportsHardwareKeys: boolean;
  /** True if vendor-level EPD refresh mode control is available. */
  supportsNativeRefreshControl: boolean;
  /** Detected manufacturer string (e.g., 'ONYX', 'BOOX') if available. */
  detectedManufacturer?: string;
  /** Detected device model if available. */
  detectedModel?: string;
}

export interface EinkSettings {
  /** Effective or configured display mode. */
  displayMode: DisplayMode;
  /** High contrast monochrome visual profile (always on in E-Ink mode). */
  highContrast: boolean;
  /** Prefer paginated reading over smooth continuous scrolling. */
  preferPaginated: boolean;
  /** Enable left/right reader tap zones for one-handed page turning. */
  tapZones: boolean;
  /** Intercept hardware volume keys when reading to turn pages. */
  volumeTurnPages: boolean;
  /** Invert volume key navigation (Volume Up = Next, Volume Down = Prev). */
  invertVolumeKeys: boolean;
  /** Render document illustrations/images in grayscale instead of original color. */
  grayscaleContent: boolean;
}
