# preflight

See what will actually break before you upgrade an npm dependency.

**[preflight-umber.vercel.app](https://preflight-umber.vercel.app)** · [source](https://github.com/AadiSharma49/preflight)

Today, "is this upgrade safe?" means a human reads a changelog, guesses which of
their files are affected, and finds out for real in production. preflight
replaces the guessing: it scans your actual code for actual usage of the
package, cross-references the actual release notes between your current version
and the target, and tells you which lines are affected and why.

## Status

Step 3 of 6 — it finds real usage of a package in a real repo, works out which
version you're actually on, and pulls the release notes for every version
between that and your target.

- [x] 1. CLI scaffold + arg parsing
- [x] 2. AST usage scanner (`@babel/parser`) — every import, file, line, named export
- [x] 3. Current version from the lockfile + changelog fetch (npm registry + GitHub releases)
- [ ] 4. Match usage → changelog, split into **certain break** vs **maybe affected**
- [ ] 5. Transitive deps from the lockfile, not `package.json`
- [ ] 6. Plain grouped output

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
it uses `CHANGELOG.md`. That is reported plainly rather than shown as an
all-clear. Same for a missing repository field, and for the unauthenticated
GitHub rate limit (60/hour): the scan results still print, with the reason the
notes are missing.

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
