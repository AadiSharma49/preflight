// src/match.js
//
// Step 4: usage → changelog matching.
//
// This module reads the output of the scanner (usages) and the changelog
// fetcher (notes) and produces a plain grouping: which usages are certainly
// broken by the upgrade, and which might be affected. It never touches the
// scanner or the changelog logic — it only reads their output.

/**
 * A line that names the export and says it was removed, moved, renamed, or
 * had its signature changed is a certain break.
 *
 * "no longer accepts/supports X" is deliberately NOT here: the export still
 * exists, only a capability is gone, and whether that breaks depends on how
 * the usage calls it — that is a `maybe`, not a certain break.
 *
 * The word "breaking" itself is also not here — it is a stronger, explicit
 * marker handled below, so an old "breaking..." line beats newer ambiguous
 * wording instead of tying with it.
 */
const BREAKING =
  /\b(?:removed|remove|removal|deleted|delete|deletion|dropped|drop|renamed|rename|renaming|moved|move|signature|signatures)\b/i;

/**
 * A line that names the export but describes a changed default or behavior is
 * a maybe — it affects the API but is not an explicit break.
 */
const BEHAVIOR =
  /\b(?:default|defaults|changed|change|changes|behavior|behaviour|cache|cached|caching|instead of|previously|deprecated|deprecation|no longer|opt-in|opt-out|throw|throws|throwing|error|errors)\b/i;

const CHANGE = new RegExp(`(?:${BREAKING.source}|${BEHAVIOR.source})`);

/**
 * Explicit breaking-change markers — the strongest signal. These describe
 * intent rather than coincidence of wording: the word "breaking" itself, the
 * "BREAKING CHANGE:" footer, or the `!:` / `)!:` conventional-commit marker.
 */
const EXPLICIT = /\bbreaking\b|\bBREAKING CHANGE\b|\)?!:/i;

/**
 * Conventional-commit subjects that carry no user-facing API change. A line
 * like "docs: remove incorrect statement that force-cache is the default..."
 * must never become a certain break, no matter which change words it happens
 * to contain. Skipped for every signal level, `related` included.
 */
const IGNORED_PREFIX = /^(?:[-*]\s+)?(?:docs|chore|test|ci|style)(?:\([^)]*\))?:\s*/i;

/**
 * The name is not at a hyphen boundary, so `motion` matches "`motion`" and
 * "motion.div" but not "framer-motion".
 */
const NAME_START = /(?:^|[\s`'"([{])/;
const NAME_END = /(?:$|[\s`'".,;)\]}>!?])/;

function mentionsName(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${NAME_START.source}${escaped}${NAME_END.source}`).test(text);
}

/** Split a note body into `###`-headed sections, keeping the heading. */
function splitSections(body) {
  const sections = [];
  let current = { title: null, lines: [] };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{1,3}\s/.test(line)) {
      sections.push(current);
      current = { title: line.replace(/^#{1,3}\s+/, ''), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections;
}

function rank(signal) {
  if (signal === 'explicit') return 4;
  if (signal === 'breaking') return 3;
  if (signal === 'behavior') return 2;
  return 1; // related
}

// Notes are iterated in ascending version order, so a later equal-rank match
// is a newer version — and the most recent change is usually the one that
// bites. Stronger signals always beat newer versions.
function better(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (rank(b.signal) !== rank(a.signal)) return rank(b.signal) > rank(a.signal) ? b : a;
  return b;
}

/**
 * The mentionable names for one usage.
 *
 * Most usages are an export name — "motion" or "motion.div". A `default`
 * import has no export name: only the specifier it came from ("next/image",
 * built from the scanned package plus the usage's subpath) is a real mention.
 * Never match on the English word "default" itself.
 *
 * Returns an empty array for `*` usages (no name at all) and for `default`
 * usages without a subpath or package (no entry point to name) — the caller
 * skips those entirely rather than guess.
 */
function mentionNames(usage, pkg) {
  if (usage.api === '*') return [];
  if (usage.api === 'default') {
    if (!pkg || !usage.subpath) return [];
    return [`${pkg}/${usage.subpath}`];
  }
  const names = [usage.api];
  if (usage.member) names.push(`${usage.api}.${usage.member}`);
  return names;
}

/**
 * Match one usage against the changelog notes.
 *
 * Returns null when nothing in the changelog relates to the usage — no false
 * signal. Otherwise returns the strongest match:
 *   { version, signal: 'explicit'|'breaking'|'behavior'|'related', excerpt, section, context? }
 *
 * @param {object} usage  A scanner usage record.
 * @param {Map<string, object>} notes  Changelog notes keyed by version.
 * @param {string} [pkg]  The package being scanned; needed to name the
 *   specifier a `default` import came from (e.g. "next" + subpath "image").
 */
export function matchUsage(usage, notes, pkg) {
  const names = mentionNames(usage, pkg);
  if (!names.length) return null;

  let best = null;

  for (const [version, note] of notes) {
    const body = note?.body ?? '';
    if (!body) continue;

    for (const section of splitSections(body)) {
      let nameMention = null;
      let sectionHasChange = false;
      let sectionChangeLine = null;

      for (const line of section.lines) {
        // Docs/chore/test/ci/style housekeeping carries no API change and must
        // not feed any signal level — not even `related`.
        if (IGNORED_PREFIX.test(line)) continue;

        const hasName = names.some((n) => mentionsName(line, n));

        if (hasName) {
          if (EXPLICIT.test(line)) {
            best = better(best, {
              version,
              signal: 'explicit',
              excerpt: line,
              section: section.title,
            });
          } else if (BREAKING.test(line)) {
            best = better(best, {
              version,
              signal: 'breaking',
              excerpt: line,
              section: section.title,
            });
          } else if (BEHAVIOR.test(line)) {
            best = better(best, {
              version,
              signal: 'behavior',
              excerpt: line,
              section: section.title,
            });
          } else {
            nameMention ??= line;
          }
        }

        if (CHANGE.test(line)) {
          sectionHasChange = true;
          sectionChangeLine ??= line;
        }
      }

      // The name appears in a section that has a change elsewhere — a related
      // change near that area, without the changelog naming the exact export.
      if (nameMention && sectionHasChange) {
        best = better(best, {
          version,
          signal: 'related',
          excerpt: nameMention,
          context: sectionChangeLine,
          section: section.title,
        });
      }
    }
  }

  return best;
}

function asMap(notes) {
  if (notes instanceof Map) return notes;
  if (notes && typeof notes === 'object') return new Map(Object.entries(notes));
  return new Map();
}

/**
 * Group scanner usage into `certain` and `maybe` based on the changelog.
 *
 * Each entry carries the full usage (file, line, column, api, member, kind,
 * typeOnly, subpath, via) plus the changelog match that triggered it:
 * version, signal, excerpt, section, and context (for `related` matches).
 *
 * @param {Array<object>} usages  Scanner usage records.
 * @param {Map<string, object>|object} notes  Changelog notes keyed by version.
 * @param {string} [pkg]  The package being scanned; needed to name the
 *   specifier a `default` import came from (e.g. "next" + subpath "image").
 */
export function matchUsages({ usages, notes, pkg }) {
  const certain = [];
  const maybe = [];
  const map = asMap(notes);

  for (const usage of usages ?? []) {
    // A `*` usage (side-effect import, namespace import line) has no specific
    // export name to match against the changelog. A `default` usage without a
    // subpath has no entry point to name, so it is skipped rather than guessed.
    if (usage.api === '*') continue;
    if (usage.api === 'default' && !usage.subpath) continue;

    const match = matchUsage(usage, map, pkg);
    if (!match) continue;

    const entry = {
      ...usage,
      version: match.version,
      signal: match.signal,
      excerpt: match.excerpt,
      section: match.section,
    };
    if (match.context) entry.context = match.context;

    (match.signal === 'breaking' || match.signal === 'explicit' ? certain : maybe).push(entry);
  }

  return { certain, maybe };
}