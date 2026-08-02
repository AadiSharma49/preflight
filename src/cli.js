import { parseArgs } from 'node:util';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { scanRepo } from './scanner.js';
import { resolveCurrentVersion } from './installed.js';
import { gatherChangelog } from './changelog.js';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);

const HELP = `
preflight — see what will actually break before you upgrade an npm dependency.

Usage
  preflight <package> <target-version> [options]

Examples
  preflight react 19
  preflight lodash 4.17.21
  preflight @tanstack/react-query ^5.0.0
  preflight axios latest --cwd ../relayos

Options
  -c, --cwd <path>   Repo to scan (default: current directory)
      --json         Machine-readable output
  -h, --help         Show this help
  -v, --version      Print preflight's own version
`.trim();

// npm's own rules: optional @scope/, lowercase, no leading dot or underscore.
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

// What counts as a target: 19 | 19.0 | 19.0.0 | 19.0.0-rc.1 | ^19.0.0 | ~5.2 | a dist-tag.
const VERSION_SPEC = /^(?:[\^~]?\d+(?:\.\d+){0,2}(?:-[\w.]+)?|latest|next|beta|canary)$/;

export async function run(argv) {
  let values;
  let positionals;

  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        cwd: { type: 'string', short: 'c' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      allowPositionals: true,
    }));
  } catch (err) {
    throw new Error(`${err.message}\n\n${HELP}`);
  }

  if (values.help) {
    console.log(HELP);
    return;
  }

  if (values.version) {
    console.log(pkg.version);
    return;
  }

  const [name, target, ...extra] = positionals;

  if (!name || !target) {
    throw new Error(`expected a package name and a target version.\n\n${HELP}`);
  }
  if (extra.length) {
    throw new Error(`unexpected extra arguments: ${extra.join(' ')}\n\n${HELP}`);
  }
  if (!PACKAGE_NAME.test(name)) {
    throw new Error(`"${name}" is not a valid npm package name.`);
  }
  if (!VERSION_SPEC.test(target)) {
    throw new Error(
      `"${target}" is not a version I understand. Try 19, 19.0.0, ^19.0.0, or latest.`
    );
  }

  const repo = path.resolve(values.cwd ?? process.cwd());

  // A typo'd path must fail loudly. Scanning nothing and reporting "all clear"
  // is the one bug that would make this tool actively dangerous.
  let stat;
  try {
    stat = statSync(repo);
  } catch {
    throw new Error(`no such directory: ${repo}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`not a directory: ${repo}`);
  }

  const result = scanRepo({ repo, pkg: name });
  const current = resolveCurrentVersion({ repo, pkg: name });

  let changelog = null;
  if (!current) {
    changelog = { problem: `${name} is not a dependency of this repo` };
  } else {
    try {
      changelog = await gatherChangelog({ pkg: name, current, target });
    } catch (err) {
      changelog = { problem: err.message };
    }
  }

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          ...result,
          target,
          repo,
          current,
          changelog: changelog && {
            ...changelog,
            notes: changelog.notes ? Object.fromEntries(changelog.notes) : undefined,
          },
        },
        null,
        2
      )
    );
    return;
  }

  report({ name, target, repo, result });
  reportChangelog({ name, target, current, changelog });
}

function reportChangelog({ name, target, current, changelog }) {
  console.log(`  ── release notes ${'─'.repeat(58)}`);
  console.log('');

  if (!current) {
    console.log(`  ${name} is not a dependency of this repo.`);
    console.log('');
    return;
  }

  const note = current.exact ? '' : '  ← a range, not an installed version';
  console.log(`  current   ${current.version}   (${current.source})${note}`);

  if (!changelog || !changelog.resolvedTarget) {
    console.log(`  target    ${target}`);
    console.log('');
    console.log(`  Could not resolve release notes: ${changelog?.problem ?? 'unknown error'}`);
    console.log('');
    return;
  }

  const { currentVersion, resolvedTarget, range, repository, downgrade } = changelog;
  console.log(`  target    ${resolvedTarget}   (resolved from "${target}")`);
  if (repository) console.log(`  repo      github.com/${repository.owner}/${repository.repo}`);
  console.log('');

  if (downgrade) {
    console.log(`  ${resolvedTarget} is older than ${currentVersion} — that's a downgrade.`);
    console.log('');
    return;
  }
  if (!range.length) {
    console.log(`  Already on ${currentVersion}; nothing published between it and ${resolvedTarget}.`);
    console.log('');
    return;
  }

  console.log(
    `  ${range.length} version${range.length === 1 ? '' : 's'} to review: ${range.join(', ')}`
  );
  console.log('');

  // A problem is only fatal if it left us with nothing. A rate-limited run can
  // still come back full from the changelog file.
  if (changelog.problem && !changelog.notes?.size) {
    console.log(`  Release notes unavailable: ${changelog.problem}`);
    console.log('');
    return;
  }
  if (changelog.problem) {
    console.log(`  Note: ${changelog.problem}`);
    console.log('');
  }
  if (changelog.changelogPath) {
    console.log(`  Some notes came from ${changelog.changelogPath} (no GitHub release).`);
    console.log('');
  }

  // Newest first — the most recent breaking change is usually the one that bites.
  for (const version of [...range].reverse()) {
    const entry = changelog.notes.get(version);
    if (!entry) continue; // reported together below, rather than one block each
    console.log(`  ${'═'.repeat(70)}`);
    if (entry.source === 'changelog') {
      console.log(`  ${version}   ${entry.path}`);
    } else {
      const date = entry.publishedAt ? entry.publishedAt.slice(0, 10) : '';
      console.log(`  ${version}   ${date}   ${entry.tag}`);
      console.log(`  ${entry.url}`);
    }
    console.log('');
    console.log(entry.body.trim() || '  (release has no notes)');
    console.log('');
  }

  if (changelog.missing?.length) {
    const all = changelog.missing.length === range.length;
    console.log(`  ${'─'.repeat(70)}`);
    console.log(
      all
        ? `  None of these ${range.length} versions have GitHub releases — this project`
        : `  No GitHub release for ${changelog.missing.length} of ${range.length} versions:`
    );
    console.log(
      all
        ? '  publishes its changelog somewhere else (usually CHANGELOG.md).'
        : `  ${changelog.missing.join(', ')}`
    );
  }
  if (changelog.truncated) {
    console.log('  Stopped after 500 releases; older notes may exist further back.');
  }
  console.log('');
}

function report({ name, target, repo, result }) {
  const { usages, filesScanned, filesMatched, errors } = result;

  console.log('');
  console.log(`  preflight v${pkg.version}   ${name} → ${target}`);
  console.log(`  ${repo}`);
  console.log('');

  if (!usages.length) {
    console.log(`  No usage of ${name} found in ${filesScanned} source files.`);
    console.log('');
    return;
  }

  const byFile = new Map();
  for (const u of usages) {
    if (!byFile.has(u.file)) byFile.set(u.file, []);
    byFile.get(u.file).push(u);
  }

  for (const [file, list] of byFile) {
    console.log(`  ${file}`);
    for (const u of list) {
      const loc = `${u.line}:${u.column}`.padEnd(8);
      const label = u.member ? `${u.api}.${u.member}` : u.api;
      const notes = [u.kind, u.typeOnly ? 'type-only' : null, u.subpath]
        .filter(Boolean)
        .join(' · ');
      console.log(`    ${loc} ${label.padEnd(26)} ${notes}`);
    }
    console.log('');
  }

  // The distinct API list is the handoff to step 4: these are the names to look
  // for in the changelog.
  const apis = [...new Set(usages.filter((u) => u.api !== '*').map((u) => u.api))].sort();

  console.log(
    `  ${usages.length} usages · ${apis.length} distinct APIs · ${filesMatched} of ${filesScanned} files`
  );
  if (apis.length) console.log(`  APIs in use: ${apis.join(', ')}`);
  if (errors.length) {
    console.log('');
    console.log(`  ${errors.length} file(s) could not be parsed:`);
    for (const e of errors.slice(0, 5)) console.log(`    ${e.file}`);
  }
  console.log('');
}
