const RAW = 'https://raw.githubusercontent.com';

/**
 * Where a project might keep its changelog, most-specific first.
 *
 * Order matters. In a monorepo the package's own changelog is the correct one
 * and the root file is somebody else's history, so `packages/nextjs/` has to be
 * tried before `CHANGELOG.md`.
 */
export function changelogCandidates(pkg) {
  const unscoped = pkg.startsWith('@') ? pkg.slice(pkg.indexOf('/') + 1) : pkg;
  const flattened = pkg.replace('@', '').replace('/', '-');

  return [
    ...new Set([
      `packages/${unscoped}/CHANGELOG.md`,
      `packages/${flattened}/CHANGELOG.md`,
      `packages/${pkg}/CHANGELOG.md`,
      'CHANGELOG.md',
      'changelog.md',
      'CHANGELOG.markdown',
      'docs/CHANGELOG.md',
      'History.md',
    ]),
  ];
}

/**
 * Split a changelog into { version -> body }.
 *
 * Handles the two formats that cover most of npm:
 *   ## [12.43.0] 2026-07-27   Keep a Changelog
 *   ## 7.6.4                  changesets
 *
 * Sub-headings (`### Fixed`, `### Major Changes`) stay inside the body — step 4
 * needs them, because which section a line sits under is most of the signal
 * about how dangerous it is.
 */
export function parseChangelogSections(text) {
  const sections = new Map();
  if (!text) return sections;

  const heading = /^#{1,3}\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?/;
  let version = null;
  let body = [];

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(heading);
    if (match) {
      if (version && !sections.has(version)) sections.set(version, body.join('\n').trim());
      version = match[1];
      body = [];
      continue;
    }
    if (version) body.push(line);
  }
  if (version && !sections.has(version)) sections.set(version, body.join('\n').trim());

  return sections;
}

/**
 * Find and parse a repo's changelog file.
 *
 * Uses raw.githubusercontent.com rather than the API on purpose: it does not
 * count against the 60/hour unauthenticated rate limit, so the fallback stays
 * available exactly when the Releases API has run out.
 */
export async function fetchChangelogFile({ owner, repo, pkg }) {
  for (const path of changelogCandidates(pkg)) {
    let res;
    try {
      res = await fetch(`${RAW}/${owner}/${repo}/HEAD/${path}`);
    } catch {
      return null; // network is down; no point trying six more paths
    }
    if (!res.ok) continue;

    const text = await res.text();
    const sections = parseChangelogSections(text);
    if (sections.size) return { path, sections };
  }
  return null;
}
