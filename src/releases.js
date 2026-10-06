import semver from 'semver';

const API = 'https://api.github.com';

// Unauthenticated GitHub allows 60 requests/hour, so a whole-repo crawl is not
// an option. Five pages is 500 releases, enough for any realistic upgrade range.
const MAX_PAGES = 5;

export class RateLimitError extends Error {
  constructor(resetEpochSeconds) {
    const reset = resetEpochSeconds ? new Date(resetEpochSeconds * 1000) : null;
    super(
      reset
        ? `GitHub API rate limit reached (60/hour unauthenticated). Resets at ${reset.toLocaleTimeString()}.`
        : 'GitHub API rate limit reached (60/hour unauthenticated).'
    );
    this.name = 'RateLimitError';
    this.reset = reset;
  }
}

/**
 * Extract the version a release tag refers to, or null if it isn't ours.
 *
 * Four conventions seen in the wild, all of which have to work:
 *   v1.3.25              lenis, next
 *   7.9.1                prisma
 *   @clerk/nextjs@7.5.2  clerk (monorepo, package-scoped)
 *   framer-motion@12.0.0 monorepo, unscoped
 *
 * The monorepo case is the one that matters: in clerk/javascript a tag of
 * `@clerk/vue@2.4.22` must NOT be read as version 2.4.22 of `@clerk/nextjs`.
 */
export function versionFromTag(tag, pkg) {
  if (!tag) return null;

  const at = tag.lastIndexOf('@');
  if (at > 0) {
    if (tag.slice(0, at) !== pkg) return null; // a sibling package's release
    return semver.valid(semver.coerce(tag.slice(at + 1))) ? tag.slice(at + 1) : null;
  }

  const bare = tag.replace(/^v/i, '');
  return semver.valid(bare) ? bare : null;
}

/** GET `url`, raising the same typed errors every caller needs, but leaving
 * the status otherwise unexamined so each caller can decide what 404 means
 * to it (a crawl treats it as "no such repo"; a single-tag lookup treats it
 * as "this version has no release").
 */
async function githubGet(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'preflight',
        Accept: 'application/vnd.github+json',
      },
    });
  } catch (err) {
    throw new Error(`could not reach the GitHub API: ${err.message}`);
  }

  if (res.status === 403 || res.status === 429) {
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      throw new RateLimitError(Number(res.headers.get('x-ratelimit-reset')));
    }
    throw new Error(`GitHub API returned ${res.status}`);
  }

  return res;
}

async function getPage(owner, repo, page) {
  const res = await githubGet(`${API}/repos/${owner}/${repo}/releases?per_page=100&page=${page}`);
  if (res.status === 404) throw new Error(`no such GitHub repo: ${owner}/${repo}`);
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  return res.json();
}

/**
 * Fetch one release directly by tag, trying every convention we support in
 * turn: v1.2.3, 1.2.3, pkg@1.2.3. A 404 on all three means this version truly
 * has no GitHub release (common — plenty of projects skip some versions) and
 * is not an error.
 */
async function getReleaseByTag(owner, repo, pkg, version) {
  for (const tag of [`v${version}`, version, `${pkg}@${version}`]) {
    const res = await githubGet(`${API}/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`);
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    const release = await res.json();
    // Defend against a response that isn't a real release object (the tag
    // endpoint always returns one on 200, but a malformed body must not be
    // mistaken for a found release).
    if (release && typeof release === 'object' && !Array.isArray(release) && release.tag_name) {
      return release;
    }
  }
  return null;
}

function toNote(release, version) {
  return {
    version,
    tag: release.tag_name,
    name: release.name,
    publishedAt: release.published_at,
    url: release.html_url,
    body: release.body ?? '',
    prerelease: release.prerelease,
  };
}

/**
 * Release notes for `versions`, keyed by version.
 *
 * Pages the releases list newest-first, stopping as soon as every wanted
 * version has been found or the page cap is hit. Paging alone misses an
 * older version once a repo has published more than MAX_PAGES * 100
 * releases (vercel/next.js, for one) — whatever is still unaccounted for
 * afterward is fetched directly by tag instead, which finds it in one
 * request without having to crawl the rest of the repo's history.
 */
export async function fetchReleaseNotes({ owner, repo, pkg, versions }) {
  const wanted = new Set(versions);
  const found = new Map();
  let pagesFetched = 0;
  let exhausted = false;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await getPage(owner, repo, page);
    pagesFetched = page;

    for (const release of batch) {
      const version = versionFromTag(release.tag_name, pkg);
      if (!version || !wanted.has(version) || found.has(version)) continue;
      found.set(version, toNote(release, version));
    }

    if (batch.length < 100) {
      exhausted = true;
      break;
    }
    if (found.size === wanted.size) break;
  }

  // True when we stopped at MAX_PAGES with versions still unaccounted for —
  // recorded before the direct-tag fallback below so it still reflects
  // whether paging itself hit the cap, independent of what the fallback
  // then managed to recover.
  const truncated = !exhausted && found.size < wanted.size;

  for (const version of versions) {
    if (found.has(version)) continue;
    const release = await getReleaseByTag(owner, repo, pkg, version);
    if (release) found.set(version, toNote(release, version));
  }

  return {
    notes: found,
    missing: versions.filter((v) => !found.has(v)),
    pagesFetched,
    truncated,
  };
}
