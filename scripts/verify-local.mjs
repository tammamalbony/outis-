import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditManifest } from './manifest-audit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, '.verification');
const steps = ['test', 'test:parser', 'test:integration', 'typecheck', 'build'];
const startedAt = new Date().toISOString();
function git(args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 15000 });
  return r.status === 0 ? r.stdout.trim() : null;
}
const head = git(['rev-parse', 'HEAD']);
const before = git(['status', '--porcelain', '--untracked-files=normal']);
const report = { startedAt, node: process.version, platform: process.platform, head, cleanBefore: before === '', steps: [], result: 'FAILED' };
mkdirSync(out, { recursive: true });
const reportPath = resolve(out, 'report.json');
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
function run(step) {
  const manager = process.env.npm_execpath;
  if (!manager) throw new Error('Run this script using pnpm verify.');
  const isScript = /\.(?:c?js|mjs)$/i.test(manager);
  const r = spawnSync(isScript ? process.execPath : manager, [...(isScript ? [manager] : []), 'run', step], {
    cwd: root, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  });
  const log = (r.stdout ?? '') + '\n' + (r.stderr ?? '') + (r.error ? '\n' + r.error.message : '');
  const name = step.replaceAll(':', '-') + '.log';
  writeFileSync(resolve(out, name), log);
  process.stdout.write(log + '\n');
  report.steps.push({ step, passed: r.status === 0 && !r.error, exitCode: r.status, log: name });
  save();
  if (r.status !== 0 || r.error) throw new Error('Verification stopped at ' + step);
}
save();
try {
  for (const step of steps) {
    if (step === 'build') rmSync(resolve(root, '.output/chrome-mv3'), { recursive: true, force: true });
    run(step);
  }
  const manifest = JSON.parse(readFileSync(resolve(root, '.output/chrome-mv3/manifest.json'), 'utf8'));
  auditManifest(manifest);
  report.steps.push({ step: 'manifest-permissions', passed: true });
  report.result = 'PASSED';
} catch (e) {
  report.error = e instanceof Error ? e.message : String(e);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  report.cleanAfter = git(['status', '--porcelain', '--untracked-files=normal']) === '';
  report.headAfter = git(['rev-parse', 'HEAD']);
  report.commitEvidence = report.result === 'PASSED' && Boolean(head) && head === report.headAfter && report.cleanBefore && report.cleanAfter;
  save();
  console.log('Local report: ' + reportPath);
  if (!report.commitEvidence) console.log('Not clean-commit evidence; review report before sharing.');
}
