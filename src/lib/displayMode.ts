/**
 * Display Mode resolution, persistence, and E-Ink device capability detection.
 *
 * Persisted per-device in localStorage to avoid propagating an e-reader's E-Ink
 * display preference to a desktop or tablet instance over cloud/Yjs sync.
 */

import { isNativeMobile, isTauri } from './tauri';
import type { DisplayMode, EinkCapabilities, EinkSettings } from '../types/display';

const DISPLAY_MODE_STORAGE_KEY = 'incrementum-display-mode';
const EINK_SETTINGS_STORAGE_KEY = 'incrementum-eink-settings';

export const DEFAULT_EINK_SETTINGS: EinkSettings = {
  displayMode: 'standard',
  highContrast: true,
  preferPaginated: true,
  tapZones: true,
  volumeTurnPages: true,
  invertVolumeKeys: false,
  grayscaleContent: false,
};

/**
 * Detect E-Ink / e-paper hardware capabilities conservatively.
 */
export function detectEinkCapabilities(): EinkCapabilities {
  if (typeof window === 'undefined') {
    return {
      isEinkDevice: false,
      supportsHardwareKeys: false,
      supportsNativeRefreshControl: false,
    };
  }

  const ua = (navigator.userAgent || '').toUpperCase();
  const platform = (navigator.platform || '').toUpperCase();

  // Known E-Ink device families and manufacturers
  const knownEinkSignatures = [
    'ONYX',
    'BOOX',
    'PALMA',
    'PAGE',
    'POKE',
    'TAB MINI',
    'TAB ULTRA',
    'TAB XC',
    'NOTE AIR',
    'MAX LUMI',
    'BIGME',
    'MEEBOOK',
    'MOAAN',
    'INKPALM',
    'SUPERNOTE',
    'RATTA',
    'DASUNG',
    'HISENSE',
    'YOTAPHONE',
  ];

  let detectedManufacturer: string | undefined;
  let detectedModel: string | undefined;

  for (const sig of knownEinkSignatures) {
    if (ua.includes(sig)) {
      detectedManufacturer = sig;
      detectedModel = sig;
      break;
    }
  }

  // Web media query heuristics for slow-update or monochrome displays
  const matchesSlowUpdate = Boolean(window.matchMedia?.('(update: slow)').matches);
  const matchesMonochrome = Boolean(window.matchMedia?.('(monochrome)').matches);

  const isEinkDevice = Boolean(detectedManufacturer || matchesSlowUpdate || matchesMonochrome);
  const isAndroidNative = isNativeMobile() && (ua.includes('ANDROID') || platform.includes('ANDROID'));
  const supportsHardwareKeys = isAndroidNative;

  return {
    isEinkDevice,
    supportsHardwareKeys,
    supportsNativeRefreshControl: Boolean(detectedManufacturer?.includes('ONYX') || detectedManufacturer?.includes('BOOX')),
    detectedManufacturer,
    detectedModel,
  };
}

let _cachedCapabilities: EinkCapabilities | null = null;

export function getEinkCapabilities(): EinkCapabilities {
  if (!_cachedCapabilities) {
    _cachedCapabilities = detectEinkCapabilities();
  }
  return _cachedCapabilities;
}

export function resetEinkCapabilitiesCache(): void {
  _cachedCapabilities = null;
}

/**
 * Load saved display mode preference from device-local storage.
 */
export function loadSavedDisplayMode(): DisplayMode {
  if (typeof window === 'undefined') return 'standard';
  try {
    const stored = localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
    if (stored === 'standard' || stored === 'eink' || stored === 'auto') {
      return stored;
    }
  } catch (err) {
    console.warn('[DisplayMode] Failed to load display mode:', err);
  }
  return 'standard';
}

/**
 * Save display mode preference to device-local storage.
 */
export function saveDisplayMode(mode: DisplayMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, mode);
  } catch (err) {
    console.warn('[DisplayMode] Failed to save display mode:', err);
  }
}

/**
 * Load device-local E-Ink settings.
 */
export function loadSavedEinkSettings(): EinkSettings {
  const mode = loadSavedDisplayMode();
  if (typeof window === 'undefined') return { ...DEFAULT_EINK_SETTINGS, displayMode: mode };
  try {
    const stored = localStorage.getItem(EINK_SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_EINK_SETTINGS,
        ...parsed,
        displayMode: mode,
      };
    }
  } catch (err) {
    console.warn('[DisplayMode] Failed to load eink settings:', err);
  }
  return { ...DEFAULT_EINK_SETTINGS, displayMode: mode };
}

/**
 * Save device-local E-Ink settings.
 */
export function saveEinkSettings(settings: Partial<EinkSettings>): void {
  if (typeof window === 'undefined') return;
  try {
    const current = loadSavedEinkSettings();
    const updated = { ...current, ...settings };
    if (settings.displayMode) {
      saveDisplayMode(settings.displayMode);
    }
    localStorage.setItem(EINK_SETTINGS_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('[DisplayMode] Failed to save eink settings:', err);
  }
}

/**
 * Resolve whether E-Ink optimizations should be actively applied.
 */
export function resolveEffectiveEinkMode(mode: DisplayMode): boolean {
  if (mode === 'eink') return true;
  if (mode === 'standard') return false;
  return getEinkCapabilities().isEinkDevice;
}
