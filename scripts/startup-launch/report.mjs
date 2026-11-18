import { createHash } from 'node:crypto';

export const REFERENCE_SAMPLES = 20;
export const FIXTURE = Object.freeze({ documents: 1000, learningItems: 5000 });
const DESKTOP = Object.freeze({ shellMs: 1000, usableMs: 2000 });
const MOBILE = Object.freeze({ shellMs: 1500, usableMs: 3000 });
const budgets = new Map([
  ['linux-appimage', DESKTOP], ['linux-installed', DESKTOP], ['macos', DESKTOP],
  ['windows', DESKTOP], ['pwa-installed', DESKTOP], ['android', MOBILE], ['ios', MOBILE],
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function configurationId(configuration) {
  return createHash('sha256').update(JSON.stringify(canonical(configuration))).digest('hex');
}

export function statistics(values) {
  const times = values.toSorted((a, b) => a - b);
  const n = times.length;
  return {
    medianMs: n ? (times[Math.floor((n - 1) / 2)] + times[Math.floor(n / 2)]) / 2 : null,
    p95Ms: n ? times[Math.ceil(n * 0.95) - 1] : null,
  };
}

function validReference(config) {
  const identity = ['launcher', 'os', 'hardware', 'engine', 'display', 'cache', 'connectivity', 'animation'];
  return config?.release === true
    && /^[a-f0-9]{64}$/.test(config.artifactSha256 ?? '')
    && identity.every((key) => typeof config[key] === 'string' && config[key].trim())
    && config.fixture?.documents === FIXTURE.documents
    && config.fixture?.learningItems === FIXTURE.learningItems
    && (config.platform !== 'linux-appimage' || config.mode === 'packaged');
}

function validEndpoint(endpoint) {
  return Number.isFinite(endpoint?.ms) && endpoint.ms >= 0
    && endpoint.paint === true && endpoint.input === true;
}

export function summarizeLaunchReport({ configuration, samples }) {
  const id = configurationId(configuration ?? null);
  const budget = budgets.get(configuration?.platform);
  const reference = Boolean(budget && validReference(configuration));
  const shellTimes = [];
  const usableTimes = [];
  const failedSamples = [];
  for (const [index, sample] of samples.entries()) {
    const valid = sample?.configurationId === id && sample.sample === index + 1
      && sample.processCold === true;
    const shell = valid && validEndpoint(sample.shell);
    const usable = shell && validEndpoint(sample.usable) && sample.usable.ms >= sample.shell.ms;
    if (shell) shellTimes.push(sample.shell.ms);
    if (usable) usableTimes.push(sample.usable.ms);
    const packaged = configuration?.platform !== 'linux-appimage' || configuration.mode !== 'packaged'
      || sample?.mode === 'fuse';
    if (!usable || !packaged || sample.status !== 'usable') failedSamples.push(index + 1);
  }
  const shell = statistics(shellTimes);
  const usable = statistics(usableTimes);
  return {
    reference, total: samples.length, failedSamples, shell, usable,
    passed: reference && samples.length >= REFERENCE_SAMPLES && failedSamples.length === 0
      && shell.p95Ms <= budget.shellMs && usable.p95Ms <= budget.usableMs,
  };
}
