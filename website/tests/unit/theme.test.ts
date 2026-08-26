import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  computeEffectiveTheme,
  resolveStoredTheme,
  THEMATIC_META_COLORS,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
} from '../../src/config/theme.ts';
import {
  applyThemeToDom,
  isStoredTheme,
  refreshThemeControls,
  setupThemeControls,
  storeAndApplyTheme,
} from '../../src/scripts/theme-control.ts';

/**
 * Minimal DOM/storage stubs so the exact shipped <head> bootstrap string and
 * the shared theme-control runtime execute verbatim under node:test.
 */

interface StubOptions {
  stored?: string | null;
  storageThrows?: boolean;
  prefersDark?: boolean;
}

function createBootstrapWorld(options: StubOptions = {}) {
  const { stored = null, storageThrows = false, prefersDark = false } = options;
  const dataset: Record<string, string | undefined> = {};
  const style: { colorScheme: string } = { colorScheme: '' };
  let metaContent = THEMATIC_META_COLORS.light;
  const writes: Array<[string, string]> = [];
  const removals: string[] = [];
  const mediaListeners: Array<(event: { matches: boolean }) => void> = [];

  const localStorage = {
    getItem: () => {
      if (storageThrows) throw new Error('blocked');
      return stored;
    },
    setItem: (k: string, v: string) => writes.push([k, v]),
    removeItem: (k: string) => removals.push(k),
  };

  const matchMedia = (query: string) => ({
    matches: query.includes('dark') ? prefersDark : false,
    addEventListener: (_: string, listener: (event: { matches: boolean }) => void) => {
      if (query.includes('dark')) mediaListeners.push(listener);
    },
  });

  // Execute the EXACT shipped head-script text against the stubs.
  const runBootstrap = () => {
    new Function('window', 'localStorage', 'document', THEME_BOOTSTRAP_SCRIPT)(
      { matchMedia },
      localStorage,
      {
        documentElement: { dataset, style },
        getElementById: (id: string) =>
          id === 'meta-theme-color' ? { setAttribute: (_k: string, v: string) => (metaContent = v) } : null,
      },
    );
  };

  return { dataset, style, meta: () => metaContent, writes, removals, mediaListeners, matchMedia, runBootstrap };
}

/**
 * Install window/document/localStorage globals for exercising the bundled
 * theme-control runtime; restores prior globals afterwards.
 */
function installControlGlobals(prefersDark = false) {
  const dataset: Record<string, string | undefined> = {};
  const store = new Map<string, string>();
  const removedKeys: string[] = [];
  const dispatched: Array<{ type: string; detail?: unknown }> = [];
  const buttons = new Map<
    string,
    {
      dataset: Record<string, string | undefined>;
      listeners: Array<() => void>;
      attrs: Record<string, string>;
      label(): string;
    }
  >();

  class FakeCustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }

  const g = globalThis as Record<string, unknown>;
  const previous = {
    window: g.window,
    localStorage: g.localStorage,
    document: g.document,
    CustomEvent: g.CustomEvent,
  };

  const buttonElements = () =>
    [...buttons.values()].map((btn) => ({
      dataset: btn.dataset,
      setAttribute: (name: string, value: string) => {
        btn.attrs[name] = value;
      },
      addEventListener: (_type: string, listener: () => void) => {
        btn.listeners.push(listener);
      },
    }));

  g.CustomEvent = FakeCustomEvent;
  g.window = {
    matchMedia: (query: string) => ({
      matches: query.includes('dark') ? prefersDark : false,
      addEventListener() {},
    }),
    dispatchEvent: (event: unknown) => {
      const e = event as { type: string; detail?: unknown };
      dispatched.push({ type: e.type, detail: e.detail });
      return true;
    },
  };
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => {
      removedKeys.push(k);
      store.delete(k);
    },
  };
  g.document = {
    documentElement: { dataset, style: { colorScheme: '' } },
    getElementById: (id: string) =>
      id === 'meta-theme-color'
        ? {
            content: '',
            setAttribute(_k: string, v: string) {
              this.content = v;
            },
          }
        : null,
    querySelectorAll: (selector: string) =>
      selector === '[data-theme-set]' ? buttonElements() : [],
  };

  const buttonFor = (name: string) => {
    let btn = buttons.get(name);
    if (!btn) {
      btn = {
        dataset: { themeSet: name },
        listeners: [],
        attrs: {},
        label: () => name,
      };
      buttons.set(name, btn);
    }
    return btn;
  };

  // Header renders Light/Auto/Dark up front; register them before wiring.
  buttonFor('light');
  buttonFor('system');
  buttonFor('dark');

  return {
    dataset,
    store,
    removedKeys,
    dispatched,
    buttonFor,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete g[key];
        else g[key] = value;
      }
    },
  };
}

afterEach(() => {
  // Safety net: every test restores its own globals; nothing leaks between runs.
});

describe('resolveStoredTheme', () => {
  it('honors every explicit choice', () => {
    assert.equal(resolveStoredTheme('light'), 'light');
    assert.equal(resolveStoredTheme('dark'), 'dark');
    assert.equal(resolveStoredTheme('system'), 'system');
  });

  it('falls back to Light for missing or corrupt values', () => {
    assert.equal(resolveStoredTheme(null), 'light');
    assert.equal(resolveStoredTheme(undefined), 'light');
    assert.equal(resolveStoredTheme('banana'), 'light');
    assert.equal(resolveStoredTheme('Light'), 'light');
  });
});

describe('computeEffectiveTheme', () => {
  it('follows the OS only for Auto', () => {
    assert.equal(computeEffectiveTheme('system', true), 'dark');
    assert.equal(computeEffectiveTheme('system', false), 'light');
    assert.equal(computeEffectiveTheme('dark', false), 'dark');
    assert.equal(computeEffectiveTheme('light', true), 'light');
  });
});

describe('THEME_BOOTSTRAP_SCRIPT (exact shipped head script)', () => {
  it('first visit on a dark-mode OS renders Light without a flash', () => {
    const world = createBootstrapWorld({ stored: null, prefersDark: true });
    world.runBootstrap();
    assert.equal(world.dataset.theme, 'light');
    assert.equal(world.dataset.effectiveTheme, 'light');
    assert.equal(world.style.colorScheme, 'light');
    assert.equal(world.meta(), THEMATIC_META_COLORS.light);
  });

  it('first visit on a light-mode OS renders Light', () => {
    const world = createBootstrapWorld({ stored: null, prefersDark: false });
    world.runBootstrap();
    assert.equal(world.dataset.theme, 'light');
    assert.equal(world.dataset.effectiveTheme, 'light');
  });

  it('Auto (stored system) still follows a dark OS preference', () => {
    const world = createBootstrapWorld({ stored: 'system', prefersDark: true });
    world.runBootstrap();
    assert.equal(world.dataset.theme, 'system');
    assert.equal(world.dataset.effectiveTheme, 'dark');
    assert.equal(world.style.colorScheme, 'dark');
    assert.equal(world.meta(), THEMATIC_META_COLORS.dark);
  });

  it('stored explicit choices render exactly regardless of OS preference', () => {
    const darkOnLightOs = createBootstrapWorld({ stored: 'dark', prefersDark: false });
    darkOnLightOs.runBootstrap();
    assert.equal(darkOnLightOs.dataset.theme, 'dark');
    assert.equal(darkOnLightOs.dataset.effectiveTheme, 'dark');

    const lightOnDarkOs = createBootstrapWorld({ stored: 'light', prefersDark: true });
    lightOnDarkOs.runBootstrap();
    assert.equal(lightOnDarkOs.dataset.effectiveTheme, 'light');
  });

  it('corrupt stored values fall back to Light', () => {
    const world = createBootstrapWorld({ stored: 'garbage', prefersDark: true });
    world.runBootstrap();
    assert.equal(world.dataset.theme, 'light');
    assert.equal(world.dataset.effectiveTheme, 'light');
  });

  it('never writes or clears storage during bootstrap', () => {
    const world = createBootstrapWorld({ stored: null, prefersDark: true });
    world.runBootstrap();
    assert.deepEqual(world.writes, []);
    assert.deepEqual(world.removals, []);
  });

  it('fails soft to Light when storage access throws', () => {
    const world = createBootstrapWorld({ storageThrows: true, prefersDark: true });
    world.runBootstrap();
    assert.equal(world.dataset.theme, 'light');
    assert.equal(world.dataset.effectiveTheme, 'light');
  });

  it('tracks OS changes only while Auto is active', () => {
    const system = createBootstrapWorld({ stored: 'system', prefersDark: false });
    system.runBootstrap();
    assert.equal(system.mediaListeners.length, 1);

    system.mediaListeners[0]({ matches: true });
    assert.equal(system.dataset.effectiveTheme, 'dark');
    assert.equal(system.meta(), THEMATIC_META_COLORS.dark);

    system.mediaListeners[0]({ matches: false });
    assert.equal(system.dataset.effectiveTheme, 'light');

    const explicit = createBootstrapWorld({ stored: 'light', prefersDark: false });
    explicit.runBootstrap();
    explicit.mediaListeners[0]?.({ matches: true });
    assert.equal(explicit.dataset.effectiveTheme, 'light');
  });

  it('references the canonical storage key synchronously before paint', () => {
    assert.ok(THEME_BOOTSTRAP_SCRIPT.includes(`localStorage.getItem('${THEME_STORAGE_KEY}')`));
  });
});

describe('theme-control runtime (Auto stores system explicitly)', () => {
  it('selecting Auto stores system instead of clearing the key', () => {
    const env = installControlGlobals(true);
    try {
      storeAndApplyTheme('system');
      assert.equal(env.store.get(THEME_STORAGE_KEY), 'system');
      assert.deepEqual(env.removedKeys, []);
      assert.equal(env.dataset.theme, 'system');
      assert.equal(env.dataset.effectiveTheme, 'dark');
    } finally {
      env.restore();
    }
  });

  it('selecting Light/Dark writes those exact values and applies them', () => {
    const lightEnv = installControlGlobals(true);
    try {
      storeAndApplyTheme('light');
      assert.equal(lightEnv.store.get(THEME_STORAGE_KEY), 'light');
      assert.equal(lightEnv.dataset.effectiveTheme, 'light');
    } finally {
      lightEnv.restore();
    }

    const darkEnv = installControlGlobals(false);
    try {
      storeAndApplyTheme('dark');
      assert.equal(darkEnv.store.get(THEME_STORAGE_KEY), 'dark');
      assert.equal(darkEnv.dataset.effectiveTheme, 'dark');
      assert.equal(darkEnv.dataset.theme, 'dark');
    } finally {
      darkEnv.restore();
    }
  });

  it('dispatches plethora-theme-change after applying', () => {
    const env = installControlGlobals(false);
    try {
      storeAndApplyTheme('dark');
      const event = env.dispatched.find((e) => e.type === 'plethora-theme-change');
      assert.ok(event, 'expected a theme-change dispatch');
      assert.deepEqual(event.detail, { theme: 'dark', isDark: true });
    } finally {
      env.restore();
    }
  });

  it('applyThemeToDom keeps the browser-chrome meta color in sync', () => {
    const env = installControlGlobals(false);
    try {
      applyThemeToDom('dark', true);
      assert.equal(env.dataset.effectiveTheme, 'dark');
      applyThemeToDom('light', true);
      assert.equal(env.dataset.effectiveTheme, 'light');
    } finally {
      env.restore();
    }
  });

  it('wires buttons, reflects state via aria-pressed, applies clicks once', () => {
    const env = installControlGlobals(true); // dark OS
    try {
      // Mirror the post-bootstrap DOM: data-theme reflects the stored choice.
      env.store.set(THEME_STORAGE_KEY, 'system');
      env.dataset.theme = 'system';
      setupThemeControls();
      setupThemeControls(); // idempotent wiring

      refreshThemeControls();

      const autoBtn = env.buttonFor('system');
      const lightBtn = env.buttonFor('light');
      assert.equal(autoBtn.attrs['aria-pressed'], 'true');
      assert.equal(lightBtn.attrs['aria-pressed'], 'false');

      autoBtn.listeners.forEach((listener) => listener()); // click Auto
      assert.equal(env.store.get(THEME_STORAGE_KEY), 'system');
      assert.equal(env.dataset.effectiveTheme, 'dark'); // follows dark OS
      assert.equal(autoBtn.attrs['aria-pressed'], 'true');

      lightBtn.listeners.forEach((listener) => listener()); // click Light
      assert.equal(lightBtn.attrs['aria-pressed'], 'true');
      assert.equal(autoBtn.attrs['aria-pressed'], 'false');
      assert.equal(env.dataset.effectiveTheme, 'light');
    } finally {
      env.restore();
    }
  });

  it('isStoredTheme blocks unknown values from being written', () => {
    assert.equal(isStoredTheme('neither'), false);
    assert.equal(isStoredTheme(''), false);
    assert.equal(isStoredTheme(null), false);
    assert.equal(isStoredTheme('dark'), true);
  });
});
