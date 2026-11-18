import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { configurationId, FIXTURE, REFERENCE_SAMPLES, summarizeLaunchReport } from './startup-launch/report.mjs';

const help = `description: Measure and check process-cold release launches
commands[4]: init-linux, seed-linux, run-linux, check
examples[4]:
  "node scripts/startup-launch.mjs init-linux --profile /tmp/startup-fixture"
  "node scripts/startup-launch.mjs seed-linux --profile /tmp/startup-fixture"
  "node scripts/startup-launch.mjs run-linux --profile DIR --config JSON --probe JSON --artifact FILE --output REPORT -- /path/to/Plethora.AppImage"
  "node scripts/startup-launch.mjs check --report REPORT"
runOptions[3]: "--samples 20", "--timeout-ms 30000", "--legacy"
`;
const profileMarker = '.plethora-startup-profile';
const profileDirs = ['home', 'config', 'data', 'cache', 'runtime', 'tmp'];
class UsageError extends Error {}

function options(args, schema) {
  try {
    return parseArgs({ args, options: Object.fromEntries(schema.map((key) =>
      [key, { type: key === 'legacy' ? 'boolean' : 'string' }])) }).values;
  } catch (error) {
    throw new UsageError(error.message);
  }
}

function required(values, keys) {
  for (const key of keys) if (!values[key]) throw new UsageError(`--${key} is required`);
}

async function initProfile(path) {
  await mkdir(path, { mode: 0o700 });
  await Promise.all(profileDirs.map((dir) => mkdir(join(path, dir), { mode: 0o700 })));
  await writeFile(join(path, profileMarker), 'disposable launch profile\n', { flag: 'wx', mode: 0o600 });
}

async function verifiedProfile(path) {
  const resolved = await realpath(path);
  if (await readFile(join(resolved, profileMarker), 'utf8').catch(() => null) !== 'disposable launch profile\n') {
    throw new Error('create the isolated profile with init-linux before using it');
  }
  return resolved;
}

async function seedProfile(path) {
  const profile = await verifiedProfile(path);
  const database = join(profile, 'data', 'com.plethora.app', 'plethora.db');
  if (await realpath(database).catch(() => null) !== database || (await stat(database)).nlink !== 1) {
    throw new Error('warm up the isolated profile with the release app to create and migrate its database');
  }
  const { DatabaseSync } = await import('node:sqlite');
  const sql = await readFile(new URL('../src-tauri/src/startup_fixture.sql', import.meta.url), 'utf8');
  const db = new DatabaseSync(database);
  try {
    db.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
    const { documents, learningItems } = db.prepare(
      'SELECT (SELECT COUNT(*) FROM documents) AS documents, (SELECT COUNT(*) FROM learning_items) AS learningItems',
    ).get();
    if (documents !== 0 || learningItems !== 0) throw new Error('seeding requires an empty, migrated fixture');
    db.exec(sql);
    db.exec('COMMIT;');
  } finally {
    db.close();
  }
  console.log(`documents: ${FIXTURE.documents}\nlearningItems: ${FIXTURE.learningItems}`);
}

async function requireLoopbackAvailable() {
  await new Promise((accept, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error('port 9527 is occupied in this network namespace')));
    server.listen(9527, '::1', () => server.close(accept));
  });
}

function printSummary(summary, path) {
  console.log(`report: ${JSON.stringify(path)}`);
  console.log(`samples: ${summary.total}\nfailed: ${summary.failedSamples.length}\nreference: ${summary.reference}\npassed: ${summary.passed}`);
  for (const key of ['shell', 'usable']) {
    console.log(`${key}:\n  medianMs: ${summary[key].medianMs}\n  p95Ms: ${summary[key].p95Ms}`);
  }
}

async function runLinux(values, command) {
  const keys = ['profile', 'config', 'probe', 'artifact', 'output'];
  required(values, keys);
  const limit = Number(values.samples ?? REFERENCE_SAMPLES);
  const timeoutMs = Number(values['timeout-ms'] ?? 30000);
  if (!command.length || !Number.isSafeInteger(limit) || limit < 1 || limit > 200
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 180000) {
    throw new UsageError('specify a command after --, 1–200 samples, and a 1000–180000 ms timeout');
  }
  if (process.platform !== 'linux' || !process.env.DISPLAY || !process.env.DBUS_SESSION_BUS_ADDRESS) {
    throw new Error('run-linux requires an exclusive X11 display and a private D-Bus session');
  }
  const path = await verifiedProfile(values.profile);
  const env = {
    ...process.env,
    HOME: join(path, 'home'), XDG_CONFIG_HOME: join(path, 'config'), XDG_DATA_HOME: join(path, 'data'),
    XDG_CACHE_HOME: join(path, 'cache'), XDG_RUNTIME_DIR: join(path, 'runtime'), TMPDIR: join(path, 'tmp'),
    GDK_BACKEND: 'x11', PLETHORA_STARTUP_TRACE: '1', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
  };
  const { launchLinux, loadProbe } = await import('./startup-launch/linux.mjs');
  const expectations = await loadProbe(values.probe);
  const metadata = JSON.parse(await readFile(values.config, 'utf8'));
  if (!['linux-appimage', 'linux-installed'].includes(metadata.platform)) {
    throw new UsageError('configuration platform must be linux-appimage or linux-installed');
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(values.artifact)) hash.update(chunk);
  const configuration = {
    ...metadata,
    artifactSha256: hash.digest('hex'),
    probeSha256: createHash('sha256').update(await readFile(values.probe)).digest('hex'),
  };
  const configId = configurationId(configuration);
  const legacyPaths = [
    join(path, 'tmp', 'plethora-startup.log'),
    join(path, 'data', 'com.plethora.app', 'logs', 'startup.log'),
  ];
  const report = { configuration, samples: [] };
  const output = resolve(values.output);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  for (let sample = 1; sample <= limit; sample++) {
    let observation;
    try {
      await requireLoopbackAvailable();
      observation = await launchLinux({ command, env, expectations, timeoutMs, legacy: values.legacy, legacyPaths });
    } catch (error) {
      console.error(`Sample preflight: ${error.message}`);
      observation = { processCold: false, status: 'preflight-failed', shell: null, usable: null, phases: [] };
    }
    report.samples.push({ sample, configurationId: configId, ...observation });
    report.summary = summarizeLaunchReport(report);
    const temporary = `${output}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temporary, output);
    console.error(`Sample ${sample}/${limit}: ${observation.status}`);
  }
  printSummary(report.summary, output);
  return report.summary.passed ? 0 : 1;
}

async function main([action, ...args]) {
  const boundary = args.indexOf('--');
  const flags = boundary < 0 ? args : args.slice(0, boundary);
  if (!action || action === '--help' || flags.includes('--help')) { console.log(help); return 0; }
  if (action === '--version' && args.length === 0) { console.log('version: "1.0.0"'); return 0; }
  if (action === 'run-linux') {
    return runLinux(
      options(flags, ['profile', 'config', 'probe', 'artifact', 'output', 'samples', 'timeout-ms', 'legacy']),
      boundary < 0 ? [] : args.slice(boundary + 1),
    );
  }
  if (action === 'init-linux' || action === 'seed-linux') {
    const values = options(args, ['profile']);
    required(values, ['profile']);
    if (action === 'seed-linux') {
      await seedProfile(values.profile);
      return 0;
    }
    await initProfile(values.profile);
    console.log(`profile: ${JSON.stringify(resolve(values.profile))}`);
    return 0;
  }
  if (action === 'check') {
    const values = options(args, ['report']);
    required(values, ['report']);
    const report = JSON.parse(await readFile(values.report, 'utf8'));
    if (!Array.isArray(report.samples)) throw new UsageError('report needs a samples array');
    const summary = summarizeLaunchReport(report);
    printSummary(summary, resolve(values.report));
    return summary.passed ? 0 : 1;
  }
  throw new UsageError(`unknown command ${action}`);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  const usage = error instanceof UsageError;
  console.log(`error: ${JSON.stringify(error.message)}`);
  if (usage) console.log('help: Run node scripts/startup-launch.mjs --help');
  process.exitCode = usage ? 2 : 1;
}
