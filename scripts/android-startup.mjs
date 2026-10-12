#!/usr/bin/env node
// A separate package is mandatory. This CLI has no clear-data/uninstall path.
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { BENCH_PACKAGE, parseMarker, sampleFromMarkers, summarizeReport } from './android-startup/report.mjs';
import { freezeSource } from './android-startup/identity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const help = `description: Build and measure a disposable Android release startup fixture
commands: build, run, report
flags: --serial, --output, --source (baseline identity.json), --samples (20), --timeout-ms (180000), --report, --variant (baseline), --help
variants: baseline, bounded-logging, no-logging, no-haptics
examples[3]:
  node scripts/android-startup.mjs build --output /tmp/startup-baseline
  node scripts/android-startup.mjs run --serial DEVICE --output /tmp/startup-baseline
  node scripts/android-startup.mjs report --report /tmp/startup-baseline/report.json`;
const scalar = (v) => JSON.stringify(v);
let launchSequence = 0;
class UsageError extends Error {}

function adb(serial, args) {
  return execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
}

function verifyDisposableApk(apk) {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('Set ANDROID_HOME before building or measuring the disposable APK');
  const tools = readdirSync(`${sdk}/build-tools`).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const aapt = tools.map((version) => `${sdk}/build-tools/${version}/aapt2`).find(existsSync);
  if (!aapt) throw new Error('No aapt2 found; install Android SDK build-tools before measurement');
  const badging = execFileSync(aapt, ['dump', 'badging', apk], { encoding: 'utf8' });
  if (badging.match(/package: name='([^']+)'/)?.[1] !== BENCH_PACKAGE || badging.includes('application-debuggable')) {
    throw new Error('Refusing an APK that is not a non-debuggable disposable startup package');
  }
}

async function launch(serial, timeoutMs) {
  adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  const policy = adb(serial, ['shell', 'dumpsys', 'window', 'policy']);
  if (/^\s+showing=true(?:\s|$)/m.test(policy)) {
    throw new Error('Unlock the measurement phone before launching; locked-screen paint is not a usable local screen');
  }
  // Start observation before activity creation. Do not clear the device log.
  const log = spawn('adb', ['-s', serial, 'logcat', '-v', 'threadtime', '-v', 'monotonic', '-T', '1', '-s', 'PlethoraStartup:I', '*:S']);
  const markers = [];
  let buffer = '';
  let active = false;
  let pid = null;
  let finish;
  let acknowledge;
  const observerId = `${process.pid}-${++launchSequence}`;
  const observed = new Promise((resolveReady) => { acknowledge = resolveReady; });
  const done = new Promise((resolveDone) => { finish = resolveDone; });
  const timer = setTimeout(() => { acknowledge(false); finish(); }, timeoutMs);
  log.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      const marker = parseMarker(line);
      if (!marker) continue;
      if (marker.phase === 'harness-observer-ready') {
        if (marker.observerId === observerId && !active) {
          markers.length = 0; active = true; acknowledge(true);
        }
        continue;
      }
      if (!active) continue;
      if (markers.length < 512) markers.push(marker);
      if (marker.logPid === pid && (marker.phase === 'interaction-ready' || marker.phase === 'recovery-visible')) finish();
    }
    if (buffer.length > 65536) buffer = '';
  });
  log.on('error', () => { acknowledge(false); finish(); });
  log.on('exit', () => { acknowledge(false); finish(); });
  const signalObserver = () => {
    const payload = JSON.stringify({ phase: 'harness-observer-ready', elapsedMs: 0, observerId });
    try {
      adb(serial, ['shell', 'log', '-p', 'i', '-t', 'PlethoraStartup', `'${payload}'`]);
    } catch { acknowledge(false); finish(); }
  };
  let handshake;
  try {
    // Repeat until the live observer acknowledges this launch. A busy device
    // may write unrelated logs between this message and logcat's -T 1 query.
    signalObserver();
    handshake = setInterval(signalObserver, 500);
    if (!await observed) return sampleFromMarkers([]);
    clearInterval(handshake);
    adb(serial, ['shell', 'am', 'start', '-W', '-n', `${BENCH_PACKAGE}/com.plethora.app.MainActivity`]);
    pid = Number(adb(serial, ['shell', 'pidof', '-s', BENCH_PACKAGE]).trim());
    if (markers.some((m) => m.logPid === pid && ['interaction-ready', 'recovery-visible'].includes(m.phase))) finish();
    await done;
    const sample = sampleFromMarkers(markers.filter((m) => m.logPid === pid));
    const locked = /^\s+showing=true(?:\s|$)/m.test(adb(serial, ['shell', 'dumpsys', 'window', 'policy']));
    return locked ? { ...sample, status: 'incomplete', usableMs: null, deviceLocked: true } : sample;
  } finally { clearInterval(handshake); clearTimeout(timer); log.kill(); }
}

function printSummary(report, path) {
  for (const [key, value] of Object.entries(report.summary)) console.log(`${key}: ${scalar(value)}`);
  console.log(`report: ${scalar(path)}`);
}

function buildVariant(options, output) {
  const variant = options.variant;
  if (!['baseline', 'bounded-logging', 'no-logging', 'no-haptics'].includes(variant)) throw new UsageError('Unknown diagnostic variant');
  const baseline = options.source ? JSON.parse(readFileSync(resolve(options.source), 'utf8')) : undefined;
  if (baseline && (baseline.package !== BENCH_PACKAGE || baseline.variant !== 'baseline')) {
    throw new UsageError('--source must identify a disposable baseline source snapshot');
  }
  const sourceRoot = baseline?.directory ?? root;
  const overrides = {};
  const nativeOpt = process.env.PLETHORA_STARTUP_NATIVE_OPT_LEVEL;
  if (nativeOpt !== undefined && !['0', '1'].includes(nativeOpt)) {
    throw new Error('PLETHORA_STARTUP_NATIVE_OPT_LEVEL must be 0 or 1 for diagnostic-only compilation');
  }
  const optimization = {
    lto: process.env.CARGO_PROFILE_RELEASE_LTO ?? baseline?.optimization?.lto ?? 'thin',
    codegenUnits: Number(process.env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS ?? baseline?.optimization?.codegenUnits ?? 4),
    optLevel: nativeOpt ?? baseline?.optimization?.optLevel ?? 'z',
  };
  const nativeBackOverride = process.env.ORG_GRADLE_PROJECT_plethoraNativeBackEnabled ?? baseline?.nativeBackOverride ?? 'false';
  if (!['true', 'false'].includes(nativeBackOverride)) throw new UsageError('Native Back override must be true or false');
  if (nativeOpt !== undefined) {
    const cargo = readFileSync(`${sourceRoot}/src-tauri/Cargo.toml`, 'utf8');
    const section = '[profile.release.package.plethora-tauri]';
    overrides['src-tauri/Cargo.toml'] = cargo.includes(section)
      ? cargo.replace(/(\[profile\.release\.package\.plethora-tauri\]\s*\n)opt-level\s*=\s*[^\n]+/, `$1opt-level = ${nativeOpt}`)
      : `${cargo}\n${section}\nopt-level = ${nativeOpt}\n`;
  }
  // Keep the instrumented baseline's forwarding behavior unchanged. The
  // independent trace module captured the original WebView console in boot.
  if (!baseline && variant !== 'bounded-logging') {
    overrides['src/lib/consoleLogcatBridge.ts'] = execFileSync('git', ['show', 'HEAD:src/lib/consoleLogcatBridge.ts'], { cwd: root });
  } else if (baseline && variant === 'bounded-logging') {
    overrides['src/lib/consoleLogcatBridge.ts'] = readFileSync(`${root}/src/lib/consoleLogcatBridge.ts`);
  }
  if (variant === 'no-logging' || variant === 'no-haptics') {
    const path = 'src/main.tsx';
    const before = readFileSync(`${sourceRoot}/${path}`, 'utf8');
    const call = variant === 'no-logging' ? 'void installConsoleLogcatBridge();' : 'startHapticsService();';
    if (!before.includes(call)) throw new Error('Optional-initialization boundary changed; update the diagnostic variant');
    overrides[path] = before.replace(call, `/* startup diagnostic variant: ${variant} */`);
  }
  const source = freezeSource(root, overrides, baseline);
  // Tauri rewrites generated project inputs. Compile a second copy, preserving
  // the original immutable inputs for controlled variants and later inspection.
  const buildSource = freezeSource(root, {}, source);
  const version = JSON.parse(readFileSync(`${source.directory}/package.json`, 'utf8')).version;
  const buildId = `${version}+${source.sha.slice(0, 12)}+${source.sourceHash.slice(0, 16)}`;
  const build = spawnSync('npm', ['run', 'tauri:android:build', '--', '--features', 'startup-bench'], {
    cwd: buildSource.directory, stdio: ['ignore', 2, 2], env: { ...process.env,
      ORG_GRADLE_PROJECT_plethoraStartupBench: 'true', VITE_MARKETING_BUILD_ID: buildId,
      ORG_GRADLE_PROJECT_plethoraNativeBackEnabled: nativeBackOverride,
      // The CLI builds and symlinks the native library before invoking Gradle.
      // Use the project's existing packaging path instead of compiling twice.
      ORG_GRADLE_PROJECT_plethoraSkipRustBuild: 'true',
      VITE_GIT_SHA: source.sha.slice(0, 12), CARGO_TARGET_DIR: `${root}/src-tauri/target`,
      CARGO_PROFILE_RELEASE_LTO: optimization.lto,
      CARGO_PROFILE_RELEASE_CODEGEN_UNITS: String(optimization.codegenUnits),
    },
  });
  if (build.status !== 0) throw new Error('Android build failed; inspect build diagnostics on stderr');
  const apk = `${buildSource.directory}/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`;
  verifyDisposableApk(apk);
  const identity = { ...source, buildId, variant, package: BENCH_PACKAGE, baselineSourceHash: baseline?.sourceHash, nativeBackOverride,
      optimization,
    apkSha256: createHash('sha256').update(readFileSync(apk)).digest('hex'), fixture: { documents: 1000, learningItems: 5000 } };
  copyFileSync(apk, `${output}/startup.apk`);
  copyFileSync(`${source.directory}/source-manifest.json`, `${output}/source-manifest.json`);
  writeFileSync(`${output}/identity.json`, JSON.stringify(identity, null, 2) + '\n');
  console.log(`apk: ${scalar(`${output}/startup.apk`)}\nbuild: ${scalar(buildId)}`); return;
}

async function runSamples(options, output) {
  const serial = options.serial;
  const samples = Number(options.samples), timeoutMs = Number(options['timeout-ms']);
  if (!serial || !Number.isInteger(samples) || samples < 1 || samples > 100 || !Number.isInteger(timeoutMs) || timeoutMs < 15000 || timeoutMs > 180000) {
    throw new UsageError('run requires --serial DEVICE, 1–100 samples, and a 15000–180000ms timeout');
  }
  const identity = JSON.parse(readFileSync(`${output}/identity.json`, 'utf8'));
  if (identity.package !== BENCH_PACKAGE) throw new Error('Refusing a non-disposable package');
  const actualSha = createHash('sha256').update(readFileSync(`${output}/startup.apk`)).digest('hex');
  if (actualSha !== identity.apkSha256) throw new Error('APK hash differs from recorded build identity');
  verifyDisposableApk(`${output}/startup.apk`);
  const installed = adb(serial, ['install', '-r', `${output}/startup.apk`]);
  if (!installed.includes('Success')) throw new Error('Disposable APK installation did not succeed');
  const device = { model: adb(serial, ['shell', 'getprop', 'ro.product.model']).trim(),
    android: adb(serial, ['shell', 'getprop', 'ro.build.version.release']).trim(),
    webview: adb(serial, ['shell', 'dumpsys', 'webviewupdate']).match(/Current WebView package.*$/m)?.[0] ?? 'unknown' };
  adb(serial, ['shell', 'am', 'force-stop', BENCH_PACKAGE]);
  const warmup = await launch(serial, timeoutMs);
  writeFileSync(`${output}/warmup.json`, JSON.stringify(warmup, null, 2) + '\n');
  if (!warmup.markers.some((m) => m.phase === 'fixture-1000-5000-verified')) throw new Error('Fixture verification missing; no samples measured');
  const report = { identity, device, warmup, samples: [], summary: {} };
  const path = `${output}/report.json`;
  for (let i = 0; i < samples; i++) {
    adb(serial, ['shell', 'am', 'force-stop', BENCH_PACKAGE]);
    const sample = await launch(serial, timeoutMs);
    report.samples.push({ sample: i + 1, ...sample });
    report.summary = summarizeReport(report);
    writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
    console.error(`Sample ${i + 1}/${samples}: ${sample.usableMs ?? sample.status}`);
  }
  printSummary(report, path);
  if (!report.summary.passed) process.exitCode = 1;
}

async function main() {
  if (process.argv.length === 3 && ['-v', '-V', '--version'].includes(process.argv[2])) { console.log('1.0.0'); return; }
  let args;
  try { args = parseArgs({ options: {
    serial: { type: 'string' }, output: { type: 'string' }, source: { type: 'string' }, samples: { type: 'string', default: '20' },
    'timeout-ms': { type: 'string', default: '180000' }, report: { type: 'string' }, help: { type: 'boolean' },
    variant: { type: 'string', default: 'baseline' },
  }, allowPositionals: true, tokens: true }); } catch (error) { console.log(`error: ${scalar(error.message)}\n${help}`); process.exitCode = 2; return; }
  if (args.values.help || !args.positionals.length) { console.log(help); return; }
  const [command, ...extra] = args.positionals;
  if (extra.length || !['build', 'run', 'report'].includes(command)) throw new UsageError('Use build, run, or report with the documented flags');
  const allowed = { build: ['output', 'source', 'variant', 'help'], run: ['serial', 'output', 'samples', 'timeout-ms', 'help'], report: ['report', 'help'] }[command];
  const invalid = args.tokens.find((t) => t.kind === 'option' && !allowed.includes(t.name));
  if (invalid) { console.log(`error: ${scalar(`--${invalid.name} is not valid for ${command}`)}\nflags: ${allowed.map((f) => '--' + f).join(', ')}`); process.exitCode = 2; return; }
  if (command === 'report') {
    if (!args.values.report) throw new UsageError('report requires --report PATH');
    const report = JSON.parse(readFileSync(args.values.report, 'utf8'));
    report.summary = summarizeReport(report); printSummary(report, args.values.report); return;
  }
  if (!args.values.output) throw new UsageError(`${command} requires --output DIRECTORY`);
  const output = resolve(args.values.output);
  mkdirSync(output, { recursive: true });
  if (command === 'build') return buildVariant(args.values, output);
  await runSamples(args.values, output);
}

main().catch((error) => { console.log(`error: ${scalar(error.message)}\nhelp: node scripts/android-startup.mjs --help`); process.exitCode = error instanceof UsageError ? 2 : 1; });
