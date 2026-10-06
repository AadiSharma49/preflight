#!/usr/bin/env node
// action/run.js
//
// The GitHub Action entry point. Runs on pull_request events:
//   1. Reads the PR's base and head package.json (via the GitHub API).
//   2. Detects which dependency ranges changed.
//   3. Runs the preflight CLI (--json) against each changed dependency.
//   4. Posts one consolidated PR comment (certain first, maybes after).
//   5. Exits 1 if any certain break exists — that fails the check.
//
// This file is bundled (with the whole CLI) into dist/action.mjs by
// scripts/build-action.mjs. GitHub Actions does not run npm install for
// JavaScript actions, so the committed bundle is the source of truth.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedDependencies, baseVersionFor } from './changed-deps.js';
import { buildComment, COMMENT_MARKER } from './comment.js';

const API = 'https://api.github.com';

function fail(msg) {
  console.error(`preflight action: ${msg}`);
  process.exit(1);
}

function env(name) {
  const v = process.env[name];
  if (!v) fail(`missing environment variable ${name}`);
  return v;
}

async function gh(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'preflight-action',
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();

    // The single most common setup failure: the workflow has no
    // pull-requests: write permission, so the comment POST/PATCH is rejected.
    // Fail loudly with the fix, never silently skip.
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `GitHub API ${res.status} — the token cannot write to this PR. ` +
          `Add to your workflow:\n\n` +
          `permissions:\n  contents: read\n  pull-requests: write\n\n` +
          `(or pass a fine-grained token with Pull requests: Read and write.) ` +
          `Request was: ${url}`
      );
    }
    const error = new Error(`GitHub API ${res.status} for ${url}: ${body.slice(0, 300)}`);
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  return options.raw ? res.text() : res.json();
}

/** Fetch package.json at a ref, or null when it does not exist there. */
async function fetchManifest(owner, repo, ref, token) {
  const url = `${API}/repos/${owner}/${repo}/contents/package.json?ref=${encodeURIComponent(ref)}`;
  const data = await gh(url, token);
  if (!data?.content) return null;
  return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
}

/**
 * Fetch package-lock.json at a ref, or null when it does not exist there.
 *
 * Uses the raw media type on purpose: the default JSON response base64-encodes
 * the file and returns empty `content` for anything over 1MB, and lockfiles
 * routinely exceed that. The raw body is the file itself, no decoding needed.
 */
async function fetchBaseLockfile(owner, repo, ref, token) {
  const url = `${API}/repos/${owner}/${repo}/contents/package-lock.json?ref=${encodeURIComponent(ref)}`;
  let text;
  try {
    text = await gh(url, token, {
      headers: { Accept: 'application/vnd.github.raw+json' },
      raw: true,
    });
  } catch (err) {
    if (err.status === 404) return null; // no lockfile committed at the base
    throw err;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null; // corrupt base lockfile — the CLI keeps its own fallbacks
  }
}

/** Find the action's previous comment on the PR, if any. */
async function findPreflightComment(owner, repo, issue, token) {
  let page = 1;
  while (page <= 10) {
    const comments = await gh(
      `${API}/repos/${owner}/${repo}/issues/${issue}/comments?per_page=100&page=${page}`,
      token
    );
    if (!comments.length) break;
    const found = comments.find((c) => c.body?.includes(COMMENT_MARKER));
    if (found) return found;
    if (comments.length < 100) break;
    page += 1;
  }
  return null;
}

/** Run preflight for one dependency and return its JSON output. */
function runPreflight(cliPath, workspace, name, target, from) {
  const args = [cliPath, name, target, '--cwd', workspace, '--json'];
  // The checkout is the head sha, whose lockfile already records `target`.
  // Telling the CLI the base version this PR upgrades away from is what makes
  // the diff range (and therefore the matching) non-empty.
  if (from != null) args.push('--from', from);
  const out = execFileSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(out);
}

async function main() {
  const token = process.env.INPUT_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) fail('no GitHub token available');

  const eventPath = env('GITHUB_EVENT_PATH');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const pr = event.pull_request;
  if (!pr) fail('this action only runs on pull_request events');

  const owner = event.repository.owner.login;
  const repo = event.repository.name;
  const issue = pr.number;
  const baseSha = pr.base.sha;
  const headSha = pr.head.sha;
  const workspace = env('GITHUB_WORKSPACE');

  // The bundled CLI lives at dist/cli.mjs, next to this bundled action file
  // (dist/action.mjs). Resolve it from this file's own location via
  // import.meta.url — Node provides this natively, so we never depend on a
  // GitHub env var (GITHUB_ACTION_PATH is not reliably set for non-composite
  // node20 actions). It has no runtime node_modules dependency.
  const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.mjs');

  const [baseManifest, headManifest] = await Promise.all([
    fetchManifest(owner, repo, baseSha, token),
    fetchManifest(owner, repo, headSha, token),
  ]);

  const changes = changedDependencies({ baseManifest, headManifest });
  const results = [];

  if (!changes.length) {
    // Clean skip — but if a previous commit on this PR left a preflight
    // comment with findings, replace it with an all-clear so stale red flags
    // do not linger.
    const stale = await findPreflightComment(owner, repo, issue, token);
    if (stale) {
      const clear = buildComment([]);
      await gh(`${API}/repos/${owner}/${repo}/issues/comments/${stale.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ body: clear }),
      });
    }
    console.log('preflight: no dependency version changes detected in this PR');
    return;
  }

  // The PR checkout lands on the head sha, so the workspace lockfile already
  // contains the new version and the CLI's own resolution would report
  // current === target with an empty range — an automatic all-clear. Read the
  // base lockfile once and tell the CLI (via --from) which version each changed
  // dependency actually upgrades away from.
  const baseLockfile = await fetchBaseLockfile(owner, repo, baseSha, token);

  for (const change of changes) {
    const { name, to } = change;
    // Prefer the version resolved in the base lockfile; fall back to the lower
    // bound of the declared base range when there is no base lockfile.
    const baseVersion = baseVersionFor({ name, from: change.from, lockfile: baseLockfile });
    try {
      const json = runPreflight(cliPath, workspace, name, to, baseVersion);
      results.push({ ...change, ...json });
    } catch (err) {
      // preflight exits 1 when certain breaks exist — that is a finding, not
      // an action failure. Its stdout still carries the JSON report.
      const stdout = err.stdout?.toString?.() ?? '';
      const match = stdout.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          results.push({ ...change, ...JSON.parse(match[0]) });
          continue;
        } catch {
          // fall through to the problem record below
        }
      }
      results.push({
        ...change,
        problem: err.message,
        certain: [],
        maybe: [],
        transitive: [],
      });
    }
  }

  const body = buildComment(results);
  const existing = await findPreflightComment(owner, repo, issue, token);
  if (existing) {
    await gh(`${API}/repos/${owner}/${repo}/issues/comments/${existing.id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
  } else {
    await gh(`${API}/repos/${owner}/${repo}/issues/${issue}/comments`, token, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  const totalCertain = results.reduce(
    (n, r) =>
      n +
      (r.certain?.length ?? 0) +
      (r.transitive ?? []).reduce((m, t) => m + (t.certain?.length ?? 0), 0),
    0
  );

  if (totalCertain > 0) {
    console.log(`preflight: ${totalCertain} certain break(s) found — failing check`);
    process.exit(1);
  }
  console.log('preflight: no certain breaks found');
}

main().catch((err) => {
  console.error(`preflight action failed: ${err.message}`);
  process.exit(1);
});