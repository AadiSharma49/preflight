import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changelogCandidates,
  parseChangelogSections,
  fetchChangelogFile,
} from '../src/changelogFile.js';
import { gatherChangelog } from '../src/changelog.js';

const KEEP_A_CHANGELOG = `# Changelog

Motion adheres to [Semantic Versioning](http://semver.org/).

## [12.43.0] 2026-07-27

### Added

-   Hardware acceleration for \`backgroundColor\` in supported browsers.

### Fixed

-   \`AnimatePresence\`: Exiting children no longer interleave with entering children.

## [12.42.2] 2026-07-01

### Fixed

-   \`animateView\`: Cropped group layers now animate \`border-radius\`.
`;

const CHANGESETS = `# Change Log

## 7.6.4

### Patch Changes

- Updated dependencies

## 7.6.3

### Major Changes

- Removed \`useSession\`
`;

test('a package changelog is looked for before the repo root one', () => {
  // In a monorepo the root file is another package's history.
  assert.equal(changelogCandidates('@clerk/nextjs')[0], 'packages/nextjs/CHANGELOG.md');

  const forMotion = changelogCandidates('framer-motion');
  assert.ok(
    forMotion.indexOf('packages/framer-motion/CHANGELOG.md') < forMotion.indexOf('CHANGELOG.md'),
    'package path must be tried before the root path'
  );
  assert.ok(forMotion.includes('CHANGELOG.md'));
});

test('Keep a Changelog headings are parsed', () => {
  const sections = parseChangelogSections(KEEP_A_CHANGELOG);
  assert.deepEqual([...sections.keys()], ['12.43.0', '12.42.2']);
  assert.match(sections.get('12.43.0'), /AnimatePresence/);
});

test('changesets headings are parsed', () => {
  const sections = parseChangelogSections(CHANGESETS);
  assert.deepEqual([...sections.keys()], ['7.6.4', '7.6.3']);
  assert.match(sections.get('7.6.3'), /Removed `useSession`/);
});

test('sub-headings stay in the body — step 4 needs to know which section a line is under', () => {
  const body = parseChangelogSections(KEEP_A_CHANGELOG).get('12.43.0');
  assert.match(body, /### Added/);
  assert.match(body, /### Fixed/);
});

test('the title and prose above the first version are not mistaken for a release', () => {
  const sections = parseChangelogSections(KEEP_A_CHANGELOG);
  assert.ok(!sections.has('Changelog'));
  assert.equal(sections.size, 2);
});

test('an empty or missing changelog yields no sections', () => {
  assert.equal(parseChangelogSections('').size, 0);
  assert.equal(parseChangelogSections(undefined).size, 0);
});

test('candidate paths are tried in order until one has content', async () => {
  const tried = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = String(url).split('/HEAD/')[1];
    tried.push(path);
    return path === 'CHANGELOG.md'
      ? new Response(KEEP_A_CHANGELOG, { status: 200 })
      : new Response('Not Found', { status: 404 });
  };

  try {
    const found = await fetchChangelogFile({ owner: 'o', repo: 'r', pkg: 'framer-motion' });
    assert.equal(found.path, 'CHANGELOG.md');
    assert.equal(found.sections.size, 2);
    assert.equal(tried[0], 'packages/framer-motion/CHANGELOG.md');
  } finally {
    globalThis.fetch = original;
  }
});

/** Registry says v2 exists; GitHub has no releases; the changelog file does. */
function stubbedWorld({ releases = [], changelog = null, githubStatus = 200 } = {}) {
  return async (url) => {
    const href = String(url);
    if (href.includes('registry.npmjs.org')) {
      return new Response(
        JSON.stringify({
          name: 'thing',
          'dist-tags': { latest: '2.0.0' },
          versions: { '1.0.0': {}, '2.0.0': {} },
          repository: { url: 'git+https://github.com/acme/thing.git' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (href.includes('api.github.com')) {
      return githubStatus === 200
        ? new Response(JSON.stringify(releases), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('', {
            status: githubStatus,
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999' },
          });
    }
    // Only the repo root has one, so the package-specific candidates 404 first.
    const path = href.split('/HEAD/')[1];
    return changelog && path === 'CHANGELOG.md'
      ? new Response(changelog, { status: 200 })
      : new Response('Not Found', { status: 404 });
  };
}

test('a repo with no GitHub releases falls back to its changelog file', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = stubbedWorld({ changelog: '## 2.0.0\n\n### Major Changes\n\n- removed `foo`\n' });

  try {
    const result = await gatherChangelog({
      pkg: 'thing',
      current: { version: '1.0.0', exact: true },
      target: '2.0.0',
    });

    assert.deepEqual(result.missing, []);
    assert.equal(result.notes.get('2.0.0').source, 'changelog');
    assert.match(result.notes.get('2.0.0').body, /removed `foo`/);
    assert.equal(result.changelogPath, 'CHANGELOG.md');
  } finally {
    globalThis.fetch = original;
  }
});

test('a rate limit no longer means no notes — the changelog file has no rate limit', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = stubbedWorld({
    githubStatus: 403,
    changelog: '## 2.0.0\n\n### Major Changes\n\n- removed `foo`\n',
  });

  try {
    const result = await gatherChangelog({
      pkg: 'thing',
      current: { version: '1.0.0', exact: true },
      target: '2.0.0',
    });

    assert.match(result.problem, /rate limit/i);
    assert.equal(result.notes.get('2.0.0').source, 'changelog');
    assert.deepEqual(result.missing, []);
  } finally {
    globalThis.fetch = original;
  }
});

test('no releases and no changelog file is still reported honestly', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = stubbedWorld({ changelog: null });

  try {
    const result = await gatherChangelog({
      pkg: 'thing',
      current: { version: '1.0.0', exact: true },
      target: '2.0.0',
    });
    assert.deepEqual(result.missing, ['2.0.0']);
    assert.equal(result.notes.size, 0);
  } finally {
    globalThis.fetch = original;
  }
});
