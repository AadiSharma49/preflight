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

/** Run the CLI in its normal text mode and return everything it printed. */
async function textReport(args) {
  const log = mock.method(console, 'log');
  try {
    await run(args);
  } finally {
    log.mock.restore();
  }
  return log.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
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

test('a version missing everywhere makes the summary say incomplete, never clear', async () => {
  // Regression: next 15.5.25 -> 16.3.4 reported "no GitHub release for
  // 16.0.0, 16.0.1, 16.0.9. Stopped after 500 releases" as plain diagnostic
  // noise, while the top-line verdict still read "nothing flagged" — a false
  // all-clear, since 16.0.0 held the actual breaking change.
  const repo = repoWith({
    'package-lock.json': {
      lockfileVersion: 3,
      packages: { 'node_modules/next': { version: '16.0.0' } },
    },
  });

  const packument = () =>
    json({
      name: 'next',
      'dist-tags': { latest: '16.0.0' },
      versions: { '15.0.0': {}, '16.0.0': {} },
      repository: { url: 'git+https://github.com/vercel/next.js.git' },
    });

  const body = await withFetch((url) => {
    const u = String(url);
    if (u.includes('registry.npmjs.org')) return packument();
    // GitHub releases (paging and direct-tag) and the raw changelog file all
    // come back empty/404 — this version has no notes anywhere.
    if (u.includes('api.github.com/repos/vercel/next.js/releases?')) return json([]);
    if (u.includes('/releases/tags/')) return new Response('', { status: 404 });
    return new Response('', { status: 404 });
  }, () => textReport(['next', '16.0.0', '--from', '15.0.0', '--cwd', repo]));

  assert.match(body, /incomplete/i);
  assert.match(body, /16\.0\.0/);
  assert.ok(!/nothing flagged/i.test(body));
  assert.ok(!/all clear/i.test(body));
});

test('--from rejects anything that is not an exact semver version', async () => {
  const repo = repoWith({});
  await assert.rejects(
    () => run(['next', '16.3.8', '--from', '^15.0.0', '--cwd', repo, '--json']),
    /"--from" must be an exact semver version/
  );
});