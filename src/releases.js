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

async function getPage(owner, repo, page) {
  let res;
  try {
    res = await fetch(`${API}/repos/${owner}/${repo}/releases?per_page=100&page=${page}`, {
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
  if (res.status === 404) throw new Error(`no such GitHub repo: ${owner}/${repo}`);
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);

  return res.json();
}

/**
 * Release notes for `versions`, keyed by version.
 * Stops paging as soon as every wanted version has been found.
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
      found.set(version, {
        version,
        tag: release.tag_name,
        name: release.name,
        publishedAt: release.published_at,
        url: release.html_url,
        body: release.body ?? '',
        prerelease: release.prerelease,
      });
    }

    if (batch.length < 100) {
      exhausted = true;
      break;
    }
    if (found.size === wanted.size) break;
  }

  return {
    notes: found,
    missing: versions.filter((v) => !found.has(v)),
    pagesFetched,
    // True when we stopped at MAX_PAGES with versions still unaccounted for —
    // the notes may exist further back in history.
    truncated: !exhausted && found.size < wanted.size,
  };
}
