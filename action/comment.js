// action/comment.js
//
// Pure: builds the consolidated PR comment from preflight's JSON output.
// Certain breaks always come first, across all changed dependencies and their
// transitive findings; maybes after. This mirrors the CLI's text report
// grouping but renders as GitHub-flavored markdown for a PR comment.

export const COMMENT_MARKER = '<!-- preflight -->';

/** One finding line, with every line it was seen at and the origin. */
function findingLines(entry) {
  const api = entry.member ? `${entry.api}.${entry.member}` : entry.api;
  const lines = [
    `- \`${entry.file}:${entry.lines.join(',')}\` — **\`${api}\`** \`${entry.version}\` (${entry.origin})`,
  ];
  if (entry.excerpt) lines.push(`  ${entry.excerpt}`);
  if (entry.context) lines.push(`  > context: ${entry.context}`);
  if (entry.tag) lines.push(`  tag: ${entry.tag}`);
  return lines;
}

/**
 * The same evidence line can match many usages in one file — several
 * `<Image>` elements all importing `next/image` by default, say. Collapse
 * those into one finding per (origin, file, api, version, signal, excerpt,
 * tag), carrying every line number it was seen at, instead of repeating the
 * whole block once per usage.
 */
function groupByEvidence(list) {
  const groups = new Map();
  const order = [];
  for (const { entry, origin } of list) {
    const api = entry.member ? `${entry.api}.${entry.member}` : entry.api;
    const key = JSON.stringify([origin, entry.file, api, entry.version, entry.signal, entry.excerpt, entry.tag]);
    let group = groups.get(key);
    if (!group) {
      group = { ...entry, origin, lines: [] };
      groups.set(key, group);
      order.push(group);
    }
    group.lines.push(entry.line);
  }
  for (const group of order) group.lines.sort((a, b) => a - b);
  return order;
}

/**
 * Build the markdown comment body from preflight JSON results.
 *
 * @param {Array<{name, from, to, certain, maybe, transitive}>} results
 *   Each result is one changed dependency: the CLI's `--json` output plus the
 *   declared `from`/`to` ranges. `certain`/`maybe` are the direct findings;
 *   `transitive` is an array of { package, certain, maybe }.
 * @returns {string} the full comment body (no trailing newline included)
 */
export function buildComment(results) {
  const certain = [];
  const maybe = [];
  // Versions with no release notes anywhere, direct or transitive — a
  // missing version may hold the breaking change that matters, so the
  // comment must name it and never read as all-clear for a result that is
  // actually just incomplete.
  const missingByOrigin = [];

  for (const r of results) {
    const origin = `${r.name} ${r.from ?? '?'} → ${r.to ?? '?'}`;
    for (const e of r.certain ?? []) certain.push({ entry: e, origin });
    for (const e of r.maybe ?? []) maybe.push({ entry: e, origin });
    if (r.changelog?.missing?.length) missingByOrigin.push(`${r.name} (${r.changelog.missing.join(', ')})`);

    for (const t of r.transitive ?? []) {
      const torigin = `${t.package} (transitive)`;
      for (const e of t.certain ?? []) certain.push({ entry: e, origin: torigin });
      for (const e of t.maybe ?? []) maybe.push({ entry: e, origin: torigin });
      if (t.changelog?.missing?.length) {
        missingByOrigin.push(`${t.package} (${t.changelog.missing.join(', ')})`);
      }
    }
  }

  const groupedCertain = groupByEvidence(certain);
  const groupedMaybe = groupByEvidence(maybe);
  const totalCertain = groupedCertain.length;
  const totalMaybe = groupedMaybe.length;
  const incomplete = missingByOrigin.length > 0;

  const lines = [];
  lines.push(COMMENT_MARKER);
  lines.push('## preflight dependency check');
  lines.push('');

  if (!totalCertain && !totalMaybe && !incomplete) {
    lines.push('No certain breaks or flagged maybes across the changed dependencies.');
    lines.push('');
    return lines.join('\n');
  }

  // The headline always leads with the real counts — incomplete is a warning
  // appended to it, never a replacement. A certain break must stay visible
  // even when some other version in range has no notes.
  const counts = totalCertain
    ? `${totalCertain} certain break${totalCertain === 1 ? '' : 's'} · ${totalMaybe} maybe — this upgrade will break code`
    : `${totalCertain} certain · ${totalMaybe} maybe`;
  const verdict = incomplete
    ? `${counts} — ⚠️ Incomplete: no release notes for ${missingByOrigin.join('; ')}`
    : counts;
  lines.push(`**${verdict}**`);
  lines.push('');

  if (groupedCertain.length) {
    lines.push('### ⛔ Certain — will break');
    lines.push('');
    for (const c of groupedCertain) lines.push(...findingLines(c));
    lines.push('');
  }

  if (groupedMaybe.length) {
    lines.push('### ⚠️ Maybe — review');
    lines.push('');
    for (const m of groupedMaybe) lines.push(...findingLines(m));
    lines.push('');
  }

  return lines.join('\n');
}