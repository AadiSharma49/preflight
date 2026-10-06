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

test('repeated usages of the same module in one file are shown once, with every line', async () => {
  // Regression: a stock create-next-app page importing next/image reported 6
  // certain "will break" findings all citing the same unrelated images-config
  // line — one per JSX `<Image>` element (plus the import itself) — because
  // every usage got its own copy of the same evidence. After the fix, the
  // module-level match is also capped at `maybe` (see match.test.js), but the
  // repeated-evidence problem is separate: even a `maybe` must not be printed
  // once per usage site. It should appear once, naming every line.
  const repo = repoWith({
    'package-lock.json': {
      lockfileVersion: 3,
      packages: { 'node_modules/next': { version: '16.3.4' } },
    },
    'app/page.tsx': `
import Image from 'next/image';
export default function Page() {
  return (
    <>
      <Image src="/a.png" alt="a" width={10} height={10} />
      <Image src="/b.png" alt="b" width={10} height={10} />
      <Image src="/c.png" alt="c" width={10} height={10} />
    </>
  );
}
`,
  });

  const packument = () =>
    json({
      name: 'next',
      'dist-tags': { latest: '16.3.4' },
      versions: { '15.0.0': {}, '16.3.4': {} },
      repository: { url: 'git+https://github.com/vercel/next.js.git' },
    });

  const body = await withFetch(
    (url) => {
      const u = String(url);
      if (u.includes('registry.npmjs.org')) return packument();
      if (u.includes('api.github.com/repos/vercel/next.js/releases?')) {
        return json([
          {
            tag_name: 'v16.3.4',
            name: 'v16.3.4',
            published_at: '2025-10-01T00:00:00Z',
            html_url: 'https://github.com/vercel/next.js/releases/tag/v16.3.4',
            body: '- breaking(next/image)!: remove 16px from default images.imageSizes config',
            prerelease: false,
          },
        ]);
      }
      return new Response('', { status: 404 });
    },
    () => textReport(['next', '16.3.4', '--from', '15.0.0', '--cwd', repo])
  );

  // Never certain — this is a module-level (specifier-only) match.
  assert.match(body, /^\s*0 certain/m);
  assert.match(body, /tag: module-level change/);
  // One finding, naming every line it was seen at: the import (line 2) and
  // all three JSX usages (lines 6, 7, 8).
  assert.match(body, /app[\\/]page\.tsx:2,6,7,8/);
  // The evidence line itself must appear exactly once in the findings
  // section, not once per usage (the separate release-notes dump below
  // prints the full note body regardless, which is unrelated to this).
  const findingsSection = body.slice(0, body.indexOf('── release notes'));
  const occurrences = findingsSection.split('images.imageSizes config').length - 1;
  assert.equal(occurrences, 1);
});

test('a certain break stays visible in the headline alongside an incomplete warning', async () => {
  // Requirement: the headline leads with the real certain/maybe counts, and
  // an incomplete result only appends a warning — it must never suppress or
  // replace a real finding that was actually found. Range is [16.0.0, 16.3.4]:
  // 16.3.4 has a release with a genuine certain break; 16.0.0 has no notes
  // anywhere, so the result is also incomplete.
  const repo = repoWith({
    'package-lock.json': {
      lockfileVersion: 3,
      packages: { 'node_modules/next': { version: '16.3.4' } },
    },
    'app/foo.ts': `
import { foo } from 'next';
foo();
`,
  });

  const packument = () =>
    json({
      name: 'next',
      'dist-tags': { latest: '16.3.4' },
      versions: { '15.0.0': {}, '16.0.0': {}, '16.3.4': {} },
      repository: { url: 'git+https://github.com/vercel/next.js.git' },
    });

  const body = await withFetch(
    (url) => {
      const u = String(url);
      if (u.includes('registry.npmjs.org')) return packument();
      if (u.includes('api.github.com/repos/vercel/next.js/releases?')) {
        // Only 16.3.4 has a GitHub release; 16.0.0 is absent from this page
        // and from every direct-tag lookup tried below.
        return json([
          {
            tag_name: 'v16.3.4',
            name: 'v16.3.4',
            published_at: '2025-10-01T00:00:00Z',
            html_url: 'https://github.com/vercel/next.js/releases/tag/v16.3.4',
            body: '- Removed `foo`',
            prerelease: false,
          },
        ]);
      }
      if (u.includes('/releases/tags/')) return new Response('', { status: 404 });
      return new Response('', { status: 404 });
    },
    () => textReport(['next', '16.3.4', '--from', '15.0.0', '--cwd', repo])
  );

  const summaryLine = body.split('\n').find((l) => /\d+ certain/.test(l));
  assert.ok(summaryLine, 'expected a summary line with the certain count');
  // Leads with the real count, and the incomplete warning comes after it.
  assert.match(summaryLine, /^\s*1 certain · 0 maybe.*incomplete.*16\.0\.0/);
  // The real finding is still printed in full, not swallowed by "incomplete".
  assert.match(body, /── certain — will break/);
  assert.match(body, /Removed `foo`/);
});

test('--from rejects anything that is not an exact semver version', async () => {
  const repo = repoWith({});
  await assert.rejects(
    () => run(['next', '16.3.8', '--from', '^15.0.0', '--cwd', repo, '--json']),
    /"--from" must be an exact semver version/
  );
});