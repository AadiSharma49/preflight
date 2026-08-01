import semver from 'semver';
import { fetchPackument } from './registry.js';
import { fetchReleaseNotes } from './releases.js';

/** Turn a CLI target ("12", "^5.0.0", "latest", "1.7.2") into a real version. */
export function resolveTarget(target, { versions, distTags }) {
  if (distTags[target]) return distTags[target];

  const includePrerelease = /-/.test(target);
  const max = semver.maxSatisfying(versions, target, { includePrerelease });
  if (max) return max;

  throw new Error(`no published version of this package matches "${target}"`);
}

/**
 * Every published version in (current, target]. Exclusive of current because
 * you already have it; inclusive of target because that's what you're moving to.
 */
export function versionsBetween(versions, current, target) {
  const includePrerelease = Boolean(semver.prerelease(target));

  return versions
    .filter((v) => semver.valid(v))
    .filter((v) => includePrerelease || !semver.prerelease(v))
    .filter((v) => semver.gt(v, current) && semver.lte(v, target))
    .sort(semver.compare);
}

/**
 * Collect release notes for the upgrade range.
 *
 * Never throws for the expected "we couldn't get notes" cases — a missing repo
 * or a rate limit comes back as a `problem` so the caller can still show
 * everything else it knows.
 */
export async function gatherChangelog({ pkg, current, target }) {
  const packument = await fetchPackument(pkg);

  // A range from package.json has no single "installed" version. Its lower
  // bound is the safest reading: assume the oldest thing that satisfies it.
  const currentVersion = current.exact
    ? current.version
    : semver.minVersion(current.version)?.version;

  if (!currentVersion || !semver.valid(currentVersion)) {
    return { problem: `could not read a usable current version from "${current.version}"` };
  }

  const resolvedTarget = resolveTarget(target, packument);
  const range = versionsBetween(packument.versions, currentVersion, resolvedTarget);

  const base = {
    currentVersion,
    resolvedTarget,
    range,
    repository: packument.repository,
    downgrade: semver.lt(resolvedTarget, currentVersion),
  };

  if (!range.length) return base;

  if (!packument.repository) {
    return {
      ...base,
      problem:
        'this package lists no GitHub repository on npm, so release notes cannot be fetched',
    };
  }

  try {
    const { owner, repo } = packument.repository;
    const result = await fetchReleaseNotes({ owner, repo, pkg, versions: range });
    return { ...base, ...result };
  } catch (err) {
    // Rate limits and API hiccups must not take the whole command down.
    return { ...base, problem: err.message };
  }
}
