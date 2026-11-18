import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { readFile, readlink, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';

const windowTitle = '^Plethora$';
const traceLimit = 256;
const markerPattern = /\[startup:(native|frontend)\] (\{.*\})/;
const phasePattern = /^[a-z][a-z0-9-]{1,63}$/;

export function readMarker(line, observedMs) {
  const match = line.length <= 4096 && markerPattern.exec(line);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[2]);
    const { phase, elapsedMs, sequence, surface, outcome } = parsed;
    if (!phasePattern.test(phase ?? '') || !Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
    const marker = { phase, elapsedMs, observedMs, clock: match[1] === 'native' ? 'rust' : 'frontend' };
    if (Number.isSafeInteger(sequence) && sequence > 0) marker.sequence = sequence;
    if (['queue', 'documents', 'dashboard', 'continue-reading', 'startup'].includes(surface)) marker.surface = surface;
    if (['empty', 'populated', 'timeout', 'success', 'error', 'retrying'].includes(outcome)) marker.outcome = outcome;
    for (const key of ['request', 'attempt', 'durationMs', 'documents', 'queueItems', 'dueCount']) {
      if (Number.isSafeInteger(parsed[key]) && parsed[key] >= 0) marker[key] = parsed[key];
    }
    return marker;
  } catch {
    return null;
  }
}

function observe(stream, sinceLaunch, phases) {
  // Drain both streams throughout the launch. Drop oversized lines without
  // accumulating Tauri output, OCR text, or a child's command payloads.
  let pending = '';
  let discard = false;
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const parts = chunk.split('\n');
    for (const [index, part] of parts.entries()) {
      if (pending.length + part.length > 4096) discard = true;
      if (!discard) pending += part;
      if (index === parts.length - 1) break;
      if (!discard && phases.length < traceLimit) {
        const marker = readMarker(pending, sinceLaunch());
        if (marker) phases.push(marker);
      }
      pending = '';
      discard = false;
    }
  });
}

function call(tool, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(tool, args, { timeout: 1600, maxBuffer: 2 * 1024 * 1024, encoding: 'buffer' },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function viewableWindow() {
  try {
    const ids = String(await call('xdotool', ['search', '--onlyvisible', '--name', windowTitle])).trim().split('\n');
    return ids.length === 1 && /^\d+$/.test(ids[0]) ? ids[0] : null;
  } catch (error) {
    if (error.code === 1) return null;
    throw error;
  }
}

async function frame(window, region, sinceLaunch) {
  const geometry = String(await call('xdotool', ['getwindowgeometry', '--shell', window]));
  const x = Number(/^X=(-?\d+)$/m.exec(geometry)?.[1]);
  const y = Number(/^Y=(-?\d+)$/m.exec(geometry)?.[1]);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0) return null;
  const [left, top, width, height] = region;
  const ms = sinceLaunch();
  const png = await call('import', ['-window', 'root', '-crop', `${width}x${height}+${x + left}+${y + top}`, '+repage', 'png:-']);
  const text = String(await call('tesseract', ['stdin', 'stdout', '--psm', '11'], png));
  return { ms, text: text.replace(/\s+/g, ' ').trim() };
}

async function focused(window) {
  return String(await call('xdotool', ['getwindowfocus'])).trim() === window;
}

async function launchMode(window) {
  const pid = String(await call('xdotool', ['getwindowpid', window])).trim();
  if (!/^\d+$/.test(pid)) return null;
  const exe = await readlink(`/proc/${pid}/exe`);
  const mounts = await readFile(`/proc/${pid}/mountinfo`, 'utf8');
  if (mounts.split('\n').some((line) => {
    const [mount, filesystem] = line.split(' - ');
    const path = mount.split(' ')[4];
    return filesystem?.startsWith('fuse.') && exe.startsWith(`${path}/`);
  })) return 'fuse';
  if (exe.includes('/appimage_extracted_')) return 'extract-and-run';
  const variables = await readFile(`/proc/${pid}/environ`);
  return variables.includes(Buffer.from('\0APPDIR=')) ? 'extracted' : 'native';
}

export function visibleTransition(before, after, expectation) {
  return expectation.before.test(before) && !expectation.after.test(before) && expectation.after.test(after);
}

function markForEndpoint(phases, stage, surface) {
  return phases.some((marker) => stage === 'shell'
    ? marker.phase === 'shell-painted'
    : marker.phase === 'interaction-ready' && marker.surface === surface
      && ['empty', 'populated'].includes(marker.outcome));
}

async function probe(window, expectation, canProbe, sinceLaunch, timeoutMs) {
  while (sinceLaunch() < timeoutMs) {
    if (canProbe() && await focused(window)) {
      const before = await frame(window, expectation.region, sinceLaunch);
      if (before && expectation.before.test(before.text) && !expectation.after.test(before.text)) {
        const [x, y] = expectation.click;
        await call('xdotool', ['mousemove', '--window', window, String(x), String(y), 'click', '1']);
        const responseDeadline = Math.min(sinceLaunch() + 800, timeoutMs);
        while (sinceLaunch() < responseDeadline) {
          const after = await frame(window, expectation.region, sinceLaunch);
          if (after && visibleTransition(before.text, after.text, expectation) && await focused(window)) {
            return { ms: after.ms, paint: true, input: true };
          }
        }
      }
    }
    await sleep(30);
  }
  return null;
}

const legacyPhases = new Map([
  ['startup: main begin', 'native-entry'],
  ['startup: begin', 'setup-entry'],
  ['startup: database initialized', 'database-open-complete'],
  ['startup: migrations complete', 'migrations-complete'],
  ['startup: backend ready', 'native-ready'],
]);

async function observeLegacy(legacyLogs, startedUnixMs) {
  const phases = [];
  for (const { path, offset } of legacyLogs) {
    const size = (await stat(path).catch(() => null))?.size ?? 0;
    if (size <= offset || size - offset > 65536) continue;
    const lines = createInterface({ input: createReadStream(path, { start: offset }) });
    for await (const line of lines) {
      const match = /^\[([^\]]+)\] (.*)$/.exec(line);
      if (!match || phases.length >= traceLimit) continue;
      const wallMs = Date.parse(match[1]) - startedUnixMs;
      if (!Number.isFinite(wallMs) || wallMs < 0) continue;
      const message = match[2];
      const cache = /^\[runtime\].*\bgst-plugin-cache=(reused|staged|appdir-fallback)\b/.exec(message)?.[1];
      const phase = cache ? `linux-runtime-cache-${cache}`
        : message.startsWith('[runtime]') ? 'linux-runtime-complete'
        : message.startsWith('[graphics]') ? 'linux-graphics-complete'
        : legacyPhases.get(message);
      if (phase) phases.push({ phase, elapsedMs: wallMs, clock: 'legacy-wall' });
    }
  }
  return phases.sort((a, b) => a.elapsedMs - b.elapsedMs);
}

export async function loadProbe(path) {
  const { shell, local, surface, restoreAfterShell } = JSON.parse(await readFile(path, 'utf8'));
  if (!['queue', 'documents'].includes(surface)) throw new Error('probe surface must be queue or documents');
  for (const entry of [shell, local]) {
    if (!Array.isArray(entry?.region) || entry.region.length !== 4
        || !Array.isArray(entry.click) || entry.click.length !== 2
        || ![...entry.region, ...entry.click].every((n) => Number.isSafeInteger(n) && n >= 0)
        || entry.region[2] < 1 || entry.region[3] < 1 || !entry.before || !entry.after) {
      throw new Error('each probe needs a crop region, click coordinates, and before and after expressions');
    }
    entry.before = new RegExp(entry.before, 'i');
    entry.after = new RegExp(entry.after, 'i');
  }
  if (restoreAfterShell && (!Array.isArray(restoreAfterShell) || restoreAfterShell.length !== 2
      || !restoreAfterShell.every((n) => Number.isSafeInteger(n) && n >= 0))) {
    throw new Error('restoreAfterShell must be a pair of click coordinates');
  }
  return { shell, local, surface, restoreAfterShell };
}

export async function launchLinux({ command, env, expectations, timeoutMs, legacy, legacyPaths }) {
  if (await viewableWindow()) throw new Error('use an exclusive display with Plethora stopped');
  const legacyLogs = await Promise.all(legacyPaths.map(async (path) => ({
    path, offset: (await stat(path).catch(() => null))?.size ?? 0,
  })));
  const phases = [];
  const startedUnixMs = Date.now();
  const started = performance.now();
  const sinceLaunch = () => Math.round(performance.now() - started);
  const child = spawn(command[0], command.slice(1), { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false;
  const closed = once(child, 'exit').catch(() => {});
  child.once('exit', () => { exited = true; });
  child.once('error', () => { exited = true; });
  observe(child.stdout, sinceLaunch, phases);
  observe(child.stderr, sinceLaunch, phases);

  let shell = null;
  let usable = null;
  let status = 'window-timeout';
  let mode = null;
  try {
    let window;
    while (!exited && sinceLaunch() < timeoutMs && !(window = await viewableWindow())) await sleep(30);
    if (window) {
      mode = await launchMode(window).catch(() => null);
      await call('xdotool', ['windowfocus', window]);
      shell = await probe(window, expectations.shell,
        () => legacy || markForEndpoint(phases, 'shell'), sinceLaunch, timeoutMs);
      status = 'shell-probe-failed';
      if (shell) {
        const restore = expectations.restoreAfterShell;
        if (restore) await call('xdotool', ['mousemove', '--window', window, ...restore.map(String), 'click', '1']);
        usable = await probe(window, expectations.local,
          () => legacy || markForEndpoint(phases, 'local', expectations.surface), sinceLaunch, timeoutMs);
        status = usable ? 'usable' : 'local-probe-failed';
      }
    }
    if (exited && status !== 'usable') status = 'process-exited';
  } catch {
    status = 'observer-failed';
  } finally {
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      await Promise.race([closed, sleep(400)]);
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
  }
  if (legacy) phases.push(...await observeLegacy(legacyLogs, startedUnixMs));
  return { processCold: true, status, mode, shell, usable, phases: phases.slice(0, traceLimit) };
}
