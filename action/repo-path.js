// action/repo-path.js
//
// Pure: resolve a repo-relative subdirectory into a path for the GitHub
// Contents API, which always uses forward slashes regardless of host OS.
// Exists because fetchManifest/fetchBaseLockfile in run.js previously
// hardcoded "package.json" and "package-lock.json" at the repo root, which
// 404s for any monorepo where the npm project lives in a subdirectory.

/** Strip leading and trailing slashes from a user-supplied subdirectory. */
export function normalizeSubdir(subdir) {
  return (subdir ?? '').replace(/^\/+|\/+$/g, '');
}

/** Join a (possibly empty) subdirectory and filename into a repo-relative path. */
export function repoPath(subdir, filename) {
  const clean = normalizeSubdir(subdir);
  return clean ? `${clean}/${filename}` : filename;
}
