import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionFromTag, fetchReleaseNotes, RateLimitError } from '../src/releases.js';
import { gatherChangelog, resolveTarget, versionsBetween } from '../src/changelog.js';
import { parseRepository } from '../src/registry.js';

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

const rateLimited = () =>
  new Response('', {
    status: 403,
    headers: {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
    },
  });

const packument = (extra = {}) =>
  json({
    name: 'thing',
    'dist-tags': { latest: '2.0.0' },
    versions: { '1.0.0': {}, '1.5.0': {}, '2.0.0': {} },
    repository: { url: 'git+https://github.com/acme/thing.git' },
    ...extra,
  });

test('release tags: every convention seen in the wild', () => {
  assert.equal(versionFromTag('v1.3.25', 'lenis'), '1.3.25');
  assert.equal(versionFromTag('7.9.1', 'prisma'), '7.9.1');
  assert.equal(versionFromTag('@clerk/nextjs@7.5.2', '@clerk/nextjs'), '7.5.2');
  assert.equal(versionFromTag('framer-motion@12.0.0', 'framer-motion'), '12.0.0');
  assert.equal(versionFromTag('v16.3.0-canary.105', 'next'), '16.3.0-canary.105');
});

test('a sibling package in the same monorepo is not our release', () => {
  // clerk/javascript tags every package in one repo. Reading this as version
  // 2.4.22 of @clerk/nextjs would attach the wrong changelog to the wrong upgrade.
  assert.equal(versionFromTag('@clerk/vue@2.4.22', '@clerk/nextjs'), null);
  assert.equal(versionFromTag('@clerk/backend@1.0.0', '@clerk/nextjs'), null);
});

test('tags that are not versions are ignored', () => {
  assert.equal(versionFromTag('nightly', 'x'), null);
  assert.equal(versionFromTag('release-candidate', 'x'), null);
  assert.equal(versionFromTag('', 'x'), null);
  assert.equal(versionFromTag(null, 'x'), null);
});

test('version range excludes current and includes target', () => {
  const versions = ['1.0.0', '1.1.0', '1.2.0', '2.0.0', '2.1.0'];
  assert.deepEqual(versionsBetween(versions, '1.0.0', '2.0.0'), [
    '1.1.0',
    '1.2.0',
    '2.0.0',
  ]);
});

test('prereleases are skipped unless the target is itself a prerelease', () => {
  const versions = ['1.0.0', '1.1.0-beta.1', '1.1.0'];
  assert.deepEqual(versionsBetween(versions, '1.0.0', '1.1.0'), ['1.1.0']);
  assert.deepEqual(versionsBetween(versions, '1.0.0', '1.1.0-beta.1'), ['1.1.0-beta.1']);
});

test('an empty range is a normal answer, not an error', () => {
  assert.deepEqual(versionsBetween(['1.0.0', '2.0.0'], '2.0.0', '2.0.0'), []);
});

test('target resolution handles majors, ranges, exact versions and dist-tags', () => {
  const packument = {
    versions: ['11.0.0', '11.5.2', '12.0.0', '12.40.0', '13.0.0'],
    distTags: { latest: '13.0.0', next: '13.0.0' },
  };
  assert.equal(resolveTarget('12', packument), '12.40.0');
  assert.equal(resolveTarget('^11.0.0', packument), '11.5.2');
  assert.equal(resolveTarget('12.0.0', packument), '12.0.0');
  assert.equal(resolveTarget('latest', packument), '13.0.0');
});

test('an unmatchable target is an error, not a silent empty range', () => {
  assert.throws(
    () => resolveTarget('99', { versions: ['1.0.0'], distTags: {} }),
    /no published version/
  );
});

test('repository URLs in every shape npm allows', () => {
  assert.deepEqual(
    parseRepository({ url: 'git+https://github.com/motiondivision/motion.git' }),
    { owner: 'motiondivision', repo: 'motion' }
  );
  assert.deepEqual(parseRepository('https://github.com/vercel/next.js'), {
    owner: 'vercel',
    repo: 'next.js',
  });
  assert.deepEqual(parseRepository({ url: 'git://github.com/a/b.git' }), {
    owner: 'a',
    repo: 'b',
  });
  assert.deepEqual(parseRepository('github:owner/repo'), {
    owner: 'owner',
    repo: 'repo',
  });
  assert.equal(parseRepository('https://gitlab.com/a/b'), null);
  assert.equal(parseRepository(null), null);
});

test('hitting the GitHub rate limit raises a typed, explanatory error', async () => {
  await withFetch(rateLimited, async () => {
    await assert.rejects(
      () => fetchReleaseNotes({ owner: 'a', repo: 'b', pkg: 'x', versions: ['1.0.0'] }),
      (err) => err instanceof RateLimitError && /rate limit/i.test(err.message)
    );
  });
});

test('a rate limit degrades the answer instead of killing the command', async () => {
  const result = await withFetch(
    (url) => (String(url).includes('registry.npmjs.org') ? packument() : rateLimited()),
    () => gatherChangelog({ pkg: 'thing', current: { version: '1.0.0', exact: true }, target: '2.0.0' })
  );

  assert.match(result.problem, /rate limit/i);
  // Everything that did not depend on GitHub still came back.
  assert.equal(result.resolvedTarget, '2.0.0');
  assert.deepEqual(result.range, ['1.5.0', '2.0.0']);
});

test('a package with no GitHub repo explains itself rather than failing', async () => {
  const result = await withFetch(
    () => packument({ repository: undefined }),
    () => gatherChangelog({ pkg: 'thing', current: { version: '1.0.0', exact: true }, target: '2.0.0' })
  );

  assert.match(result.problem, /no GitHub repository/i);
  assert.deepEqual(result.range, ['1.5.0', '2.0.0']);
});

test('a package.json range is resolved to its lower bound and still works', async () => {
  const result = await withFetch(
    (url) => (String(url).includes('registry.npmjs.org') ? packument() : json([])),
    () =>
      gatherChangelog({
        pkg: 'thing',
        current: { version: '^1.0.0', exact: false },
        target: '2.0.0',
      })
  );

  assert.equal(result.currentVersion, '1.0.0');
  assert.deepEqual(result.range, ['1.5.0', '2.0.0']);
});

test('a version beyond the 500-release page cap is found via direct tag lookup', async () => {
  // Regression: vercel/next.js has published far more than 500 releases, so
  // paging newest-first and stopping at MAX_PAGES (5 pages of 100) never
  // reaches an older version like 16.0.0 — the bug reported it as having "no
  // GitHub release" when it actually just wasn't on the first 500.
  let pageRequests = 0;
  const tagRequests = [];

  const handler = (url) => {
    const u = String(url);
    if (u.includes('/releases/tags/')) {
      tagRequests.push(u);
      if (u.endsWith(encodeURIComponent('v16.0.0'))) {
        return json({
          tag_name: 'v16.0.0',
          name: 'v16.0.0',
          published_at: '2025-10-21T00:00:00Z',
          html_url: 'https://github.com/vercel/next.js/releases/tag/v16.0.0',
          body: 'Removed the old `images.domains` config.',
          prerelease: false,
        });
      }
      return new Response('', { status: 404 });
    }

    // Every page is a full, unrelated batch, so paging never finds anything
    // and never sees a short page — it runs all the way to the cap.
    pageRequests += 1;
    const batch = Array.from({ length: 100 }, (_, i) => ({
      tag_name: `v99.${pageRequests}.${i}`,
      body: '',
    }));
    return json(batch);
  };

  const result = await withFetch(handler, () =>
    fetchReleaseNotes({ owner: 'vercel', repo: 'next.js', pkg: 'next', versions: ['16.0.0', '16.9.9'] })
  );

  // Paging stopped at the cap — it never crawled further back in history.
  assert.equal(pageRequests, 5);
  assert.equal(result.truncated, true);

  // 16.0.0 was found via the direct tag lookup, in one request, not by paging.
  assert.ok(result.notes.has('16.0.0'));
  assert.equal(result.notes.get('16.0.0').body, 'Removed the old `images.domains` config.');
  assert.ok(tagRequests.some((u) => u.endsWith(encodeURIComponent('v16.0.0'))));

  // 16.9.9 was never released at all — the fallback tries all three tag
  // conventions and gives up, correctly, rather than guessing.
  assert.deepEqual(result.missing, ['16.9.9']);
});

test('a target older than current is reported as a downgrade', async () => {
  const result = await withFetch(
    () => packument(),
    () =>
      gatherChangelog({
        pkg: 'thing',
        current: { version: '2.0.0', exact: true },
        target: '1.0.0',
      })
  );

  assert.equal(result.downgrade, true);
  assert.deepEqual(result.range, []);
});
