// Keep this runner outside Node's test-*.js auto-discovery pattern.
const { spawnSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve, dirname } = require('node:path');

const root = resolve(__dirname, '..');
const stages = [
  { id: 'build', name: 'JavaScript syntax', args: ['scripts/build.js'] },
  { id: 'tests', name: 'Automated API and workflow tests', args: ['--test'] },
  { id: 'database', name: 'Real database schema and read-only SQL', args: ['scripts/check-pipeline-db.js'], json: true },
  { id: 'http', name: 'Running server and browser preflight', args: ['scripts/check-pipeline-http.js'], json: true },
];

const report = { startedAt: new Date().toISOString(), ok: false, stages: [] };
for (const stage of stages) {
  console.log(`\n[Pipeline] ${stage.name}`);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, stage.args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const entry = {
    id: stage.id,
    name: stage.name,
    ok: result.status === 0 && !result.error,
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
  };
  if (result.error) entry.error = result.error.code || 'PROCESS_ERROR';
  if (stage.json) {
    try { entry.result = JSON.parse(result.stdout || ''); } catch { entry.outputFormatError = true; entry.ok = false; }
    if (entry.result?.ok !== true) entry.ok = false;
  }
  report.stages.push(entry);
}
report.ok = report.stages.every((stage) => stage.ok);
report.finishedAt = new Date().toISOString();
console.log('\n[Pipeline] Summary');
for (const stage of report.stages) console.log(`${stage.ok ? 'PASS' : 'FAIL'} ${stage.name}`);
console.log(report.ok ? 'Pipeline passed all gates.' : 'Pipeline failed; inspect the failed gates above.');

const reportArg = process.argv.indexOf('--report');
if (reportArg !== -1) {
  if (!process.argv[reportArg + 1]) {
    console.error('--report requires a file path');
    process.exitCode = 1;
  } else {
    const target = resolve(root, process.argv[reportArg + 1]);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Report: ${target}`);
  }
}
if (!report.ok) process.exitCode = 1;
