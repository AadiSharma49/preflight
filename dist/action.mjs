#!/usr/bin/env node
/* preflight GitHub Action bundle — do not edit. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// action/run.js
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// action/changed-deps.js
var DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
];
function dependencyMap(manifest) {
  const map = /* @__PURE__ */ new Map();
  for (const field of DEP_FIELDS) {
    for (const [name, range] of Object.entries(manifest?.[field] ?? {})) {
      map.set(name, range);
    }
  }
  return map;
}
function changedDependencies({ baseManifest, headManifest }) {
  const base = dependencyMap(baseManifest);
  const head = dependencyMap(headManifest);
  const names = /* @__PURE__ */ new Set([...base.keys(), ...head.keys()]);
  const changes = [];
  for (const name of [...names].sort()) {
    const from = base.get(name);
    const to = head.get(name);
    if (from === to) continue;
    changes.push({ name, from: from ?? null, to: to ?? null });
  }
  return changes;
}

// action/comment.js
var COMMENT_MARKER = "<!-- preflight -->";
function findingLines(entry, origin) {
  const api = entry.member ? `${entry.api}.${entry.member}` : entry.api;
  const lines = [`- \`${entry.file}:${entry.line}\` \u2014 **\`${api}\`** \`${entry.version}\` (${origin})`];
  if (entry.excerpt) lines.push(`  ${entry.excerpt}`);
  if (entry.context) lines.push(`  > context: ${entry.context}`);
  return lines;
}
function buildComment(results) {
  const certain = [];
  const maybe = [];
  for (const r of results) {
    const origin = `${r.name} ${r.from ?? "?"} \u2192 ${r.to ?? "?"}`;
    for (const e of r.certain ?? []) certain.push({ entry: e, origin });
    for (const e of r.maybe ?? []) maybe.push({ entry: e, origin });
    for (const t of r.transitive ?? []) {
      const torigin = `${t.package} (transitive)`;
      for (const e of t.certain ?? []) certain.push({ entry: e, origin: torigin });
      for (const e of t.maybe ?? []) maybe.push({ entry: e, origin: torigin });
    }
  }
  const totalCertain = certain.length;
  const totalMaybe = maybe.length;
  const lines = [];
  lines.push(COMMENT_MARKER);
  lines.push("## preflight dependency check");
  lines.push("");
  if (!totalCertain && !totalMaybe) {
    lines.push("No certain breaks or flagged maybes across the changed dependencies.");
    lines.push("");
    return lines.join("\n");
  }
  const verdict = totalCertain ? `${totalCertain} certain break${totalCertain === 1 ? "" : "s"} \xB7 ${totalMaybe} maybe \u2014 this upgrade will break code` : `${totalCertain} certain \xB7 ${totalMaybe} maybe`;
  lines.push(`**${verdict}**`);
  lines.push("");
  if (certain.length) {
    lines.push("### \u26D4 Certain \u2014 will break");
    lines.push("");
    for (const c of certain) lines.push(...findingLines(c.entry, c.origin));
    lines.push("");
  }
  if (maybe.length) {
    lines.push("### \u26A0\uFE0F Maybe \u2014 review");
    lines.push("");
    for (const m of maybe) lines.push(...findingLines(m.entry, m.origin));
    lines.push("");
  }
  return lines.join("\n");
}

// action/run.js
var API = "https://api.github.com";
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
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "preflight-action",
      ...options.headers ?? {}
    }
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `GitHub API ${res.status} \u2014 the token cannot write to this PR. Add to your workflow:

permissions:
  contents: read
  pull-requests: write

(or pass a fine-grained token with Pull requests: Read and write.) Request was: ${url}`
      );
    }
    throw new Error(`GitHub API ${res.status} for ${url}: ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}
async function fetchManifest(owner, repo, ref, token) {
  const url = `${API}/repos/${owner}/${repo}/contents/package.json?ref=${encodeURIComponent(ref)}`;
  const data = await gh(url, token);
  if (!data?.content) return null;
  return JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
}
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
function runPreflight(cliPath, workspace, name, target) {
  const out = execFileSync(
    process.execPath,
    [cliPath, name, target, "--cwd", workspace, "--json"],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );
  return JSON.parse(out);
}
async function main() {
  const token = process.env.INPUT_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) fail("no GitHub token available");
  const eventPath = env("GITHUB_EVENT_PATH");
  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const pr = event.pull_request;
  if (!pr) fail("this action only runs on pull_request events");
  const owner = event.repository.owner.login;
  const repo = event.repository.name;
  const issue = pr.number;
  const baseSha = pr.base.sha;
  const headSha = pr.head.sha;
  const workspace = env("GITHUB_WORKSPACE");
  const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "cli.mjs");
  const [baseManifest, headManifest] = await Promise.all([
    fetchManifest(owner, repo, baseSha, token),
    fetchManifest(owner, repo, headSha, token)
  ]);
  const changes = changedDependencies({ baseManifest, headManifest });
  const results = [];
  if (!changes.length) {
    const stale = await findPreflightComment(owner, repo, issue, token);
    if (stale) {
      const clear = buildComment([]);
      await gh(`${API}/repos/${owner}/${repo}/issues/comments/${stale.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ body: clear })
      });
    }
    console.log("preflight: no dependency version changes detected in this PR");
    return;
  }
  for (const change of changes) {
    const { name, to } = change;
    try {
      const json = runPreflight(cliPath, workspace, name, to);
      results.push({ ...change, ...json });
    } catch (err) {
      const stdout = err.stdout?.toString?.() ?? "";
      const match = stdout.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          results.push({ ...change, ...JSON.parse(match[0]) });
          continue;
        } catch {
        }
      }
      results.push({
        ...change,
        problem: err.message,
        certain: [],
        maybe: [],
        transitive: []
      });
    }
  }
  const body = buildComment(results);
  const existing = await findPreflightComment(owner, repo, issue, token);
  if (existing) {
    await gh(`${API}/repos/${owner}/${repo}/issues/comments/${existing.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ body })
    });
  } else {
    await gh(`${API}/repos/${owner}/${repo}/issues/${issue}/comments`, token, {
      method: "POST",
      body: JSON.stringify({ body })
    });
  }
  const totalCertain = results.reduce(
    (n, r) => n + (r.certain?.length ?? 0) + (r.transitive ?? []).reduce((m, t) => m + (t.certain?.length ?? 0), 0),
    0
  );
  if (totalCertain > 0) {
    console.log(`preflight: ${totalCertain} certain break(s) found \u2014 failing check`);
    process.exit(1);
  }
  console.log("preflight: no certain breaks found");
}
main().catch((err) => {
  console.error(`preflight action failed: ${err.message}`);
  process.exit(1);
});
