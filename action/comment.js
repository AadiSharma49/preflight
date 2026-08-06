// action/comment.js
//
// Pure: builds the consolidated PR comment from preflight's JSON output.
// Certain breaks always come first, across all changed dependencies and their
// transitive findings; maybes after. This mirrors the CLI's text report
// grouping but renders as GitHub-flavored markdown for a PR comment.

export const COMMENT_MARKER = '<!-- preflight -->';

/** One finding line, with the dependency + version range as the origin. */
function findingLines(entry, origin) {
  const api = entry.member ? `${entry.api}.${entry.member}` : entry.api;
  const lines = [`- \`${entry.file}:${entry.line}\` — **\`${api}\`** \`${entry.version}\` (${origin})`];
  if (entry.excerpt) lines.push(`  ${entry.excerpt}`);
  if (entry.context) lines.push(`  > context: ${entry.context}`);
  return lines;
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

  for (const r of results) {
    const origin = `${r.name} ${r.from ?? '?'} → ${r.to ?? '?'}`;
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
  lines.push('## preflight dependency check');
  lines.push('');

  if (!totalCertain && !totalMaybe) {
    lines.push('No certain breaks or flagged maybes across the changed dependencies.');
    lines.push('');
    return lines.join('\n');
  }

  const verdict = totalCertain
    ? `${totalCertain} certain break${totalCertain === 1 ? '' : 's'} · ${totalMaybe} maybe — this upgrade will break code`
    : `${totalCertain} certain · ${totalMaybe} maybe`;
  lines.push(`**${verdict}**`);
  lines.push('');

  if (certain.length) {
    lines.push('### ⛔ Certain — will break');
    lines.push('');
    for (const c of certain) lines.push(...findingLines(c.entry, c.origin));
    lines.push('');
  }

  if (maybe.length) {
    lines.push('### ⚠️ Maybe — review');
    lines.push('');
    for (const m of maybe) lines.push(...findingLines(m.entry, m.origin));
    lines.push('');
  }

  return lines.join('\n');
}