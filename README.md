# preflight

See what will actually break before you upgrade an npm dependency.

**[preflight-umber.vercel.app](https://preflight-umber.vercel.app)** · [source](https://github.com/AadiSharma49/preflight)

Today, "is this upgrade safe?" means a human reads a changelog, guesses which of
their files are affected, and finds out for real in production. preflight
replaces the guessing: it scans your actual code for actual usage of the
package, cross-references the actual release notes between your current version
and the target, and tells you which lines are affected and why.

## Status

Step 6 of 6 — the full pipeline is built: it finds real usage of a package in a
real repo, works out which version you're actually on, pulls the release notes
for every version between that and your target, matches your usage against the
changelog, checks transitive dependencies too, and prints one consolidated
plain-text report with an exit code a CI check can read.

- [x] 1. CLI scaffold + arg parsing
- [x] 2. AST usage scanner (`@babel/parser`) — every import, file, line, named export
- [x] 3. Current version from the lockfile + changelog fetch (GitHub releases, with a `CHANGELOG.md` fallback)
- [x] 4. Match usage → changelog, split into **certain break** vs **maybe affected**
- [x] 5. Transitive deps from the lockfile, not `package.json`
- [x] 6. Plain grouped output — one report, certain first, with an exit code

## GitHub Action

preflight ships as a reusable GitHub Action. On every pull request it reads the
`package.json` diff, runs preflight against each dependency whose range
changed, posts one consolidated PR comment (certain breaks first, maybes
after), and fails the check if any certain break is found. If the PR no longer
changes any dependency, any previous preflight comment is replaced with an
all-clear rather than left stale.

```yaml
# .github/workflows/preflight.yml
name: preflight

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: AadiSharma49/preflight@main
        with:
          token: ${{ github.token }}
```

The action needs a token with `pull-requests: write` — the automatic
`GITHUB_TOKEN` works with the `permissions` block above. If the token lacks
this permission, the action fails loudly with instructions rather than
silently skipping.

### The action is bundled

GitHub Actions does not run `npm install` for JavaScript actions, so the
action entry and the whole CLI are bundled with esbuild into `dist/`
(`dist/action.mjs` and `dist/cli.mjs`) and committed. Both bundles are
self-contained — no `node_modules` is needed at runtime.

After changing anything under `src/`, `bin/`, or `action/`, rebuild and commit
the bundles:

```sh
npm run build:action   # writes dist/action.mjs and dist/cli.mjs
git add dist action.yml
```

## Install (local dev)

```sh
npm link          # from this folder, once
preflight react 19
```

To unlink later: `npm unlink -g preflight`.

## Usage

```
preflight <package> <target-version> [options]

  -c, --cwd <path>   Repo to scan (default: current directory)
      --json         Machine-readable output
  -h, --help         Show help
  -v, --version      Print preflight's own version
```

Examples:

```sh
preflight react 19
preflight lodash 4.17.21
preflight @tanstack/react-query ^5.0.0
preflight axios latest --cwd ../relayos
```

## Layout

```
bin/cli.js        shebang + error boundary, nothing else
src/cli.js        arg parsing, validation, report rendering
src/walk.js       file discovery — honours .gitignore, skips build output
src/scanner.js    the AST scanner
src/installed.js  what version is actually installed
src/registry.js   npm registry metadata -> the GitHub repo
src/releases.js   GitHub Releases API + release-tag parsing
src/changelog.js  resolves the target, computes the version range, fetches notes
src/match.js      usage -> changelog matching, certain vs maybe
src/transitive.js direct vs transitive from the lockfile
test/             one fixture per way the naive approach gets it wrong
site/             the landing page (Next.js, deploys separately)
```

The `site/` folder is a standalone Next.js app and is not part of the published
CLI package. On Vercel, set the project's Root Directory to `site`.

## How the scanner works

Two passes, because "the package is imported here" is not useful — "this
specific export is called on this line" is.

1. Find every import / `require` / dynamic import / re-export whose specifier
   resolves to the package. `framer-motion/dom` matches; `framer-motion-3d`
   does not.
2. For each one, resolve the **binding** and walk every reference to it. Using
   Babel's scope resolution rather than name matching is what makes aliases
   (`import { useScroll as s }`) report the real export name, and what makes a
   local variable that shadows the import correctly *not* count.

A third pass handles TypeScript type positions, because Babel's scope tracks
value references only — without it, `import type { Variants }` would show the
import line and none of the places the type is actually used.

Comments and strings that look like imports are free: the AST never sees them.

## How the changelog fetch works

`preflight framer-motion 12` only names the target. The current version is
read from the repo, most-truthful source first: `package-lock.json`, then
`yarn.lock`, then `pnpm-lock.yaml`, then `node_modules`, and only then the
range in `package.json` — which is flagged as inexact, because `^12.0.0` is
what was *asked for*, not what is installed.

The target is then resolved against the registry (`12` → the newest published
`12.x`), the range is every published version in `(current, target]`, and
release notes are fetched for each.

Matching a GitHub release to a version is less obvious than it looks. Four
conventions are in use across ordinary dependencies:

```
v1.3.25               lenis, next
7.9.1                 prisma
@clerk/nextjs@7.5.2   clerk — one monorepo, one tag per package
framer-motion@12.0.0  monorepo, unscoped
```

The monorepo case is the one that matters: in `clerk/javascript`, a tag of
`@clerk/vue@2.4.22` must not be read as version 2.4.22 of `@clerk/nextjs`, or
you attach the wrong changelog to the wrong upgrade.

Not every project publishes GitHub releases at all — `framer-motion` has none,
it keeps a `CHANGELOG.md`. When the Releases API comes up short, the changelog
file is fetched from `raw.githubusercontent.com` and split by version heading.
Both common formats are handled:

```
## [12.43.0] 2026-07-27    Keep a Changelog
## 7.6.4                   changesets
```

Package-specific paths (`packages/nextjs/CHANGELOG.md`) are tried before the
repo root, because in a monorepo the root file is another package's history.

Fetching from `raw.githubusercontent.com` rather than the API is deliberate: it
does not count against the 60/hour unauthenticated rate limit, so the fallback
still works in the exact situation where the API has run out.

If neither source has anything — no repository field, or no notes anywhere —
that is reported plainly rather than shown as an all-clear.

Run `npm test` to see every case that's covered.

## A note on the npm name

`preflight` is already taken on the public registry. That only matters at
publish time, and the fix is one line in `package.json`: publish as
`@<your-npm-username>/preflight`. Scoped names under your own username are
always available, and the installed command is still `preflight` because that
comes from the `bin` field, not the package name.

## Requirements

Node >= 18.3 (uses the built-in `util.parseArgs`). Runtime dependencies:
`@babel/parser`, `@babel/traverse`, `ignore`.
