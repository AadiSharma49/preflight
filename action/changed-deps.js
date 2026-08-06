// action/changed-deps.js
//
// Pure: given the base and head package.json manifests, return the list of
// dependencies whose declared range changed in the PR. This is the only
// place that decides "what changed" — it is fully unit-testable.

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