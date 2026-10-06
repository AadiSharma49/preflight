// action/changed-deps.js
//
// Pure: given the base and head package.json manifests, return the list of
// dependencies whose declared range changed in the PR. This is the only
// place that decides "what changed" — it is fully unit-testable.

import semver from 'semver';

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/** Flatten all four dependency fields into one { name -> range } map. */
export function dependencyMap(manifest) {
  const map = new Map();
  for (const field of DEP_FIELDS) {
    for (const [name, range] of Object.entries(manifest?.[field] ?? {})) {
      map.set(name, range);
    }
  }
  return map;
}

/**
 * Every dependency whose declared range differs between base and head.
 *
 * Each entry is { name, from, to } where `from`/`to` are the declared ranges
 * (or null when the package was added/removed). A package that moved between
 * fields with the same range is not a version change, so it is skipped.
 */
export function changedDependencies({ baseManifest, headManifest }) {
  const base = dependencyMap(baseManifest);
  const head = dependencyMap(headManifest);
  const names = new Set([...base.keys(), ...head.keys()]);

  const changes = [];
  for (const name of [...names].sort()) {
    const from = base.get(name);
    const to = head.get(name);
    if (from === to) continue;
    changes.push({ name, from: from ?? null, to: to ?? null });
  }
  return changes;
}

/**
 * The exact version of a changed dependency that the base of a PR was locked
 * to, read from the base package-lock.json. Mirrors src/installed.js but for a
 * parsed lockfile object rather than a repo directory, so the GitHub Action can
 * resolve the version the PR upgrades *away from* once the workspace checkout
 * (the head sha) already carries the new one.
 */
export function baseVersionFromLock(lockfile, name) {
  if (!lockfile) return null;

  // lockfileVersion 2/3
  const top = lockfile.packages?.[`node_modules/${name}`]?.version;
  if (top) return top;

  // lockfileVersion 1
  const v1 = lockfile.dependencies?.[name]?.version;
  if (v1) return v1;

  // Nested only (a transitive copy) — still the truth.
  for (const [key, entry] of Object.entries(lockfile.packages ?? {})) {
    if (key.endsWith(`node_modules/${name}`) && entry?.version) {
      return entry.version;
    }
  }
  return null;
}

/**
 * The version a changed dependency was on at the PR's base, or null when it
 * cannot be known. Prefers the resolved version from the base lockfile; when
 * the lockfile is missing or does not list the package, falls back to the lower
 * bound of the declared `from` range — the same reading the CLI uses for a
 * non-exact range. A newly added dependency (from === null) has no base.
 */
export function baseVersionFor({ name, from, lockfile }) {
  const resolved = baseVersionFromLock(lockfile, name);
  if (resolved) return resolved;
  if (!from) return null;
  return semver.minVersion(from)?.version ?? null;
}