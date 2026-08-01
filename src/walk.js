import fs from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';

// Directories that are never source-of-truth for what a repo imports. Skipped
// before .gitignore is even consulted, because some repos commit their build
// output and we'd otherwise report the same usage twice.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.vercel',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
]);

const EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
]);

/**
 * Every source file in `root` worth parsing, absolute paths, sorted.
 * Honours the repo's root .gitignore.
 */
export function findSourceFiles(root) {
  const ig = loadGitignore(root);
  const found = [];
  walk(root, root, ig, found);
  return found.sort();
}

function loadGitignore(root) {
  const ig = ignore();
  try {
    ig.add(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'));
  } catch {
    // No .gitignore is normal, not an error.
  }
  return ig;
}

function walk(dir, root, ig, found) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Unreadable directory (permissions, race). Skip it rather than die.
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    // `ignore` only understands posix-style relative paths.
    const rel = path.relative(root, full).split(path.sep).join('/');

    // Note: symlinked directories report isDirectory() === false here, so we
    // never follow them. That's deliberate — it makes cycles impossible.
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (ig.ignores(`${rel}/`)) continue;
      walk(full, root, ig, found);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    if (ig.ignores(rel)) continue;
    found.push(full);
  }
}
