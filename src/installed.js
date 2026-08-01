import fs from 'node:fs';
import path from 'node:path';

/**
 * What version of `pkg` is this repo actually on?
 *
 * Sources are tried most-truthful first. A lockfile records what npm resolved;
 * package.json only records what was *asked for*, which is why a range is the
 * last resort and gets flagged as inexact.
 */
export function resolveCurrentVersion({ repo, pkg }) {
  return (
    fromNpmLock(repo, pkg) ??
    fromYarnLock(repo, pkg) ??
    fromPnpmLock(repo, pkg) ??
    fromNodeModules(repo, pkg) ??
    fromManifest(repo, pkg) ??
    null
  );
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function fromNpmLock(repo, pkg) {
  const data = readJson(path.join(repo, 'package-lock.json'));
  if (!data) return null;

  // lockfileVersion 2/3
  const top = data.packages?.[`node_modules/${pkg}`]?.version;
  if (top) return { version: top, source: 'package-lock.json', exact: true };

  // lockfileVersion 1
  const v1 = data.dependencies?.[pkg]?.version;
  if (v1) return { version: v1, source: 'package-lock.json', exact: true };

  // Nested only (a transitive copy). Still the truth, worth saying it's nested.
  for (const [key, entry] of Object.entries(data.packages ?? {})) {
    if (key.endsWith(`node_modules/${pkg}`) && entry.version) {
      return { version: entry.version, source: `package-lock.json (${key})`, exact: true };
    }
  }
  return null;
}

function fromYarnLock(repo, pkg) {
  const text = readText(path.join(repo, 'yarn.lock'));
  if (!text) return null;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Entry keys start at column 0 and list one or more specs.
    if (!line || line.startsWith('#') || /^\s/.test(line)) continue;

    const specs = line
      .replace(/:$/, '')
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, ''));

    const mine = specs.some((s) => s.slice(0, s.lastIndexOf('@')) === pkg);
    if (!mine) continue;

    for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j += 1) {
      const m = lines[j].match(/^\s+version:?\s+"?([^"\s]+)"?/);
      if (m) return { version: m[1], source: 'yarn.lock', exact: true };
    }
  }
  return null;
}

function fromPnpmLock(repo, pkg) {
  const text = readText(path.join(repo, 'pnpm-lock.yaml'));
  if (!text) return null;

  // Both the v6 (`/pkg@1.2.3:`) and v9 (`pkg@1.2.3:`) entry shapes.
  const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`^\\s*/?${esc}@([0-9][^:(\\s']*)`, 'm'));
  return m ? { version: m[1], source: 'pnpm-lock.yaml', exact: true } : null;
}

function fromNodeModules(repo, pkg) {
  const data = readJson(path.join(repo, 'node_modules', ...pkg.split('/'), 'package.json'));
  return data?.version
    ? { version: data.version, source: 'node_modules', exact: true }
    : null;
}

function fromManifest(repo, pkg) {
  const data = readJson(path.join(repo, 'package.json'));
  if (!data) return null;

  const range =
    data.dependencies?.[pkg] ??
    data.devDependencies?.[pkg] ??
    data.peerDependencies?.[pkg] ??
    data.optionalDependencies?.[pkg];

  // Inexact on purpose: "^12.0.0" is what was requested, not what is installed.
  return range ? { version: range, source: 'package.json', exact: false } : null;
}
