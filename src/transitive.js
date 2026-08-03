// src/transitive.js
//
// Step 5: transitive dependency resolution.
//
// preflight's scanner and matcher work on any package name — direct or not.
// What was missing was the ability to tell a *direct* dependency (one the
// project asked for in package.json) from a *transitive* one (one that arrived
// indirectly, because something else depends on it). This module reads the
// lockfile to make that distinction, so a user is never confused about why a
// package they never installed themselves is showing up.

import fs from 'node:fs';
import path from 'node:path';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The set of package names the project depends on directly, from package.json.
 * A package is "direct" if it appears in any of the four dependency fields.
 */
export function directDependencies(repo) {
  const data = readJson(path.join(repo, 'package.json'));
  if (!data) return new Set();

  return new Set([
    ...Object.keys(data.dependencies ?? {}),
    ...Object.keys(data.devDependencies ?? {}),
    ...Object.keys(data.peerDependencies ?? {}),
    ...Object.keys(data.optionalDependencies ?? {}),
  ]);
}

/**
 * Every package name recorded in package-lock.json — direct and transitive.
 *
 * In lockfileVersion 2/3 the `packages` map keys are install paths like
 * `node_modules/foo` or `node_modules/foo/node_modules/bar`. The package name
 * is the last `node_modules/` segment. lockfileVersion 1 uses a `dependencies`
 * tree instead, which we also walk.
 */
export function lockfilePackages(repo) {
  const data = readJson(path.join(repo, 'package-lock.json'));
  if (!data) return new Set();

  const names = new Set();

  // lockfileVersion 2/3
  for (const key of Object.keys(data.packages ?? {})) {
    if (key === '') continue; // the root project entry, not a package
    const idx = key.lastIndexOf('node_modules/');
    if (idx === -1) continue;
    const name = key.slice(idx + 'node_modules/'.length);
    if (name) names.add(name);
  }

  // lockfileVersion 1
  const walk = (node) => {
    for (const [name, child] of Object.entries(node ?? {})) {
      names.add(name);
      walk(child.dependencies);
    }
  };
  walk(data.dependencies);

  return names;
}

/**
 * Is `pkg` a direct dependency, a transitive one, or not a dependency at all?
 *
 * Returns 'direct' | 'transitive' | null.
 */
export function resolveDependencyKind({ repo, pkg }) {
  if (directDependencies(repo).has(pkg)) return 'direct';
  if (lockfilePackages(repo).has(pkg)) return 'transitive';
  return null;
}

/**
 * The transitive dependency names — everything in the lockfile that is not a
 * direct dependency. Sorted for stable output.
 */
export function listTransitiveDeps(repo) {
  const direct = directDependencies(repo);
  return [...lockfilePackages(repo)]
    .filter((name) => !direct.has(name))
    .sort();
}