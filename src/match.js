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
 */
const BREAKING =
  /\b(?:removed|remove|removal|deleted|delete|deletion|dropped|drop|breaking|renamed|rename|renaming|moved|move|signature|signatures)\b/i;

/**
 * A line that names the export but describes a changed default or behavior is
 * a maybe — it affects the API but is not an explicit break.
 */
const BEHAVIOR =
  /\b(?:default|defaults|changed|change|changes|behavior|behaviour|cache|cached|caching|instead of|previously|deprecated|deprecation|no longer|opt-in|opt-out|throw|throws|throwing|error|errors)\b/i;

const CHANGE = new RegExp(`(?:${BREAKING.source}|${BEHAVIOR.source})`);

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
 * Match one usage against the changelog notes.
 *
 * Returns null when nothing in the changelog relates to the usage — no false
 * signal. Otherwise returns the strongest match:
 *   { version, signal: 'breaking'|'behavior'|'related', excerpt, section, context? }
 */
export function matchUsage(usage, notes) {
  const names = [usage.api];
  if (usage.member) names.push(`${usage.api}.${usage.member}`);

  let best = null;

  for (const [version, note] of notes) {
    const body = note?.body ?? '';
    if (!body) continue;

    for (const section of splitSections(body)) {
      let nameMention = null;
      let sectionHasChange = false;
      let sectionChangeLine = null;

      for (const line of section.lines) {
        const hasName = names.some((n) => mentionsName(line, n));

        if (hasName) {
          if (BREAKING.test(line)) {
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
 */
export function matchUsages({ usages, notes }) {
  const certain = [];
  const maybe = [];
  const map = asMap(notes);

  for (const usage of usages ?? []) {
    // A `*` usage (side-effect import, namespace import line) has no specific
    // export name to match against the changelog.
    if (usage.api === '*') continue;

    const match = matchUsage(usage, map);
    if (!match) continue;

    const entry = {
      ...usage,
      version: match.version,
      signal: match.signal,
      excerpt: match.excerpt,
      section: match.section,
    };
    if (match.context) entry.context = match.context;

    (match.signal === 'breaking' ? certain : maybe).push(entry);
  }

  return { certain, maybe };
}