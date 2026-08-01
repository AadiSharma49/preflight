const REGISTRY = 'https://registry.npmjs.org';

/**
 * The GitHub owner/repo behind an npm `repository` field, or null.
 * Handles the git+https, git://, ssh, and `github:owner/repo` shorthands.
 */
export function parseRepository(repository) {
  if (!repository) return null;
  const url = typeof repository === 'string' ? repository : repository.url;
  if (!url) return null;

  const full = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?]|$)/i);
  if (full) return { owner: full[1], repo: full[2] };

  const short = url.match(/^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (short) return { owner: short[1], repo: short[2] };

  return null;
}

/**
 * Full packument from the npm registry. We ask for the full document rather
 * than the abbreviated one because the abbreviated form omits `repository`,
 * which is the whole reason we're here.
 */
export async function fetchPackument(pkg) {
  const url = `${REGISTRY}/${pkg.replace('/', '%2F')}`;

  let res;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (err) {
    throw new Error(`could not reach the npm registry: ${err.message}`);
  }

  if (res.status === 404) throw new Error(`package not found on npm: ${pkg}`);
  if (!res.ok) throw new Error(`npm registry returned ${res.status} for ${pkg}`);

  const data = await res.json();
  const latest = data['dist-tags']?.latest;

  return {
    name: data.name,
    versions: Object.keys(data.versions ?? {}),
    distTags: data['dist-tags'] ?? {},
    // Some packages only carry `repository` on the version manifest.
    repository:
      parseRepository(data.repository) ??
      parseRepository(data.versions?.[latest]?.repository) ??
      parseRepository(data.homepage),
  };
}
