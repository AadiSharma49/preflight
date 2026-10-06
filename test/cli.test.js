import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/cli.js';

/** Build a throwaway repo from a {relativePath: contents} map. */
function repoWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-cli-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  return dir;
}

/** Run `fn` with global fetch replaced, then always put it back. */
async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const json = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

// A small, real-shaped `next` packument. No `repository` on purpose: gatherChangelog
// stops right after computing the range, so the mock never has to fake GitHub.
const nextPackument = () =>
  json({
    name: 'next',
    'dist-tags': { latest: '16.3.8' },
    versions: { '15.0.0': {}, '15.3.9': {}, '16.0.0': {}, '16.3.8': {} },
  });

/** Run the CLI in --json mode and return the printed report object. */
async function jsonReport(args) {
  const log = mock.method(console, 'log');
  try {
    await run(args);
  } finally {
    log.mock.restore();
  }
  const printed = log.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
  return JSON.parse(printed);
}

test('a head lockfile at 16.x with --from 15.x gives a non-empty range', async () => {
  // The PR's head checkout: the lockfile already resolves next to 16.3.8.
  const repo = repoWith({
    'package-lock.json': {
      lockfileVersion: 3,
      packages: { 'node_modules/next': { version: '16.3.8' } },
    },
  });

  const report = await withFetch(
    (url) => (String(url).includes('registry.npmjs.org') ? nextPackument() : json([])),
    () => jsonReport(['next', '16.3.8', '--from', '15.3.9', '--cwd', repo, '--json'])
  );

  // The override is visible in the report...
  assert.equal(report.current.version, '15.3.9');
  assert.equal(report.current.source, '--from');
  // ...and it is what makes the diff range non-empty.
  assert.deepEqual(report.changelog.range, ['16.0.0', '16.3.8']);
});

test('without --from the same head lockfile would report an empty range', async () => {
  // Documents the bug: current === target, so every PR reports all clear.
  const repo = repoWith({
    'package-lock.json': {
      lockfileVersion: 3,
      packages: { 'node_modules/next': { version: '16.3.8' } },
    },
  });

  const report = await withFetch(
    (url) => (String(url).includes('registry.npmjs.org') ? nextPackument() : json([])),
    () => jsonReport(['next', '16.3.8', '--cwd', repo, '--json'])
  );

  assert.equal(report.current.source, 'package-lock.json');
  assert.deepEqual(report.changelog.range, []);
});

test('--from rejects anything that is not an exact semver version', async () => {
  const repo = repoWith({});
  await assert.rejects(
    () => run(['next', '16.3.8', '--from', '^15.0.0', '--cwd', repo, '--json']),
    /"--from" must be an exact semver version/
  );
});