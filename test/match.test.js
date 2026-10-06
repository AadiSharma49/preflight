import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchUsage, matchUsages } from '../src/match.js';

/** A changelog note in the same shape the fetcher produces. */
const note = (body) => ({ version: '2.0.0', body, source: 'changelog', path: 'CHANGELOG.md' });

const usage = (over = {}) => ({
  file: 'src/x.ts',
  line: 3,
  column: 10,
  api: 'useScroll',
  member: null,
  kind: 'call',
  typeOnly: false,
  subpath: null,
  via: 'named',
  ...over,
});

test('a removed export is a certain break', () => {
  const m = matchUsage(
    usage(),
    new Map([['2.0.0', note('## 2.0.0\n\n### Major Changes\n\n- Removed `useScroll`')]])
  );
  assert.equal(m.signal, 'breaking');
  assert.equal(m.version, '2.0.0');
  assert.match(m.excerpt, /Removed `useScroll`/);
});

test('a renamed export is a certain break', () => {
  const m = matchUsage(
    usage(),
    new Map([['2.0.0', note('## 2.0.0\n\n- `useScroll` has been renamed to `useScrollTo`')]])
  );
  assert.equal(m.signal, 'breaking');
});

test('a signature change is a certain break', () => {
  const m = matchUsage(
    usage(),
    new Map([['2.0.0', note('## 2.0.0\n\n- The signature of `useScroll` changed')]])
  );
  assert.equal(m.signal, 'breaking');
});

test('a changed default is a maybe, not a certain break', () => {
  const m = matchUsage(
    usage(),
    new Map([['2.0.0', note('## 2.0.0\n\n### Changed\n\n- `useScroll` now defaults to `layout: true`')]])
  );
  assert.equal(m.signal, 'behavior');
});

test('a behavior change is a maybe', () => {
  const m = matchUsage(
    usage(),
    new Map([['2.0.0', note('## 2.0.0\n\n- `useScroll` no longer caches its result')]])
  );
  assert.equal(m.signal, 'behavior');
});

test('no longer supports X is a maybe, not a certain break', () => {
  const m = matchUsage(
    usage({ api: 'AnimatePresence' }),
    new Map([['2.0.0', note('## 2.0.0\n\n- `AnimatePresence` no longer supports `initial={false}`')]])
  );
  assert.equal(m.signal, 'behavior');
});

test('a newly-thrown error is a behavior change, not a certain break', () => {
  // Real case from framer-motion 12.43.0: "`motion`: Throw error when passing
  // a custom `motion` component an incorrect `ref` type."
  const m = matchUsage(
    usage({ api: 'motion', member: 'div' }),
    new Map([
      [
        '12.43.0',
        note('## 12.43.0\n\n- `motion`: Throw error when passing a custom `motion` component an incorrect `ref` type.'),
      ],
    ])
  );
  assert.equal(m.signal, 'behavior');
  assert.equal(m.version, '12.43.0');
});

test('no mention in the changelog means no signal at all', () => {
  const m = matchUsage(
    usage(),
    new Map([['2.0.0', note('## 2.0.0\n\n- Fixed a bug in `AnimatePresence`')]])
  );
  assert.equal(m, null);
});

test('a name in a section with a change elsewhere is a related maybe', () => {
  const m = matchUsage(
    usage(),
    // `useScroll` is named but has no change word; the section's other line
    // carries the change. That is a related change, not a direct one.
    new Map([
      [
        '2.0.0',
        note('## 2.0.0\n\n### Changed\n\n- `useScroll`\n- `AnimatePresence` changed to unmount synchronously'),
      ],
    ])
  );
  assert.equal(m.signal, 'related');
  // context is the raw changelog line, markdown bullet included.
  assert.equal(m.context, '- `AnimatePresence` changed to unmount synchronously');
});

test('member access matches the dotted name', () => {
  const m = matchUsage(
    usage({ api: 'motion', member: 'div' }),
    new Map([['2.0.0', note('## 2.0.0\n\n- `motion.div` no longer accepts `layout`')]])
  );
  assert.equal(m.signal, 'behavior');
});

test('a bare export name matches member mentions too', () => {
  const m = matchUsage(
    usage({ api: 'motion', member: 'div' }),
    new Map([['2.0.0', note('## 2.0.0\n\n- `motion` no longer accepts `layout`')]])
  );
  assert.equal(m.signal, 'behavior');
});

test('hyphenated package names do not match the bare export', () => {
  const m = matchUsage(
    usage({ api: 'motion' }),
    new Map([['2.0.0', note('## 2.0.0\n\n- framer-motion now requires React 19')]])
  );
  assert.equal(m, null);
});

test('a newer equal-strength match wins over an older one', () => {
  const m = matchUsage(
    usage(),
    new Map([
      ['1.5.0', note('## 1.5.0\n\n- `useScroll` now defaults to `layout: true`')],
      ['2.0.0', note('## 2.0.0\n\n- `useScroll` now defaults to `layout: false`')],
    ])
  );
  assert.equal(m.version, '2.0.0');
});

test('a stronger signal beats a newer weaker one', () => {
  const m = matchUsage(
    usage(),
    new Map([
      ['2.0.0', note('## 2.0.0\n\n- `useScroll` now defaults to `layout: true`')],
      ['1.5.0', note('## 1.5.0\n\n- Removed `useScroll`')],
    ])
  );
  assert.equal(m.signal, 'breaking');
  assert.equal(m.version, '1.5.0');
});

test('matchUsages groups into certain and maybe, keeping file and line', () => {
  const usages = [
    usage({ file: 'src/a.ts', line: 10, api: 'useScroll' }),
    usage({ file: 'src/b.ts', line: 20, api: 'AnimatePresence' }),
    usage({ file: 'src/c.ts', line: 30, api: 'motion', member: 'div' }),
  ];
  const notes = new Map([
    [
      '2.0.0',
      note(
        '## 2.0.0\n\n### Major Changes\n\n- Removed `useScroll`\n\n### Changed\n\n- `motion.div` now defaults to `layout: true`'
      ),
    ],
  ]);

  const { certain, maybe } = matchUsages({ usages, notes });

  assert.equal(certain.length, 1);
  assert.equal(certain[0].file, 'src/a.ts');
  assert.equal(certain[0].line, 10);
  assert.equal(certain[0].signal, 'breaking');

  assert.equal(maybe.length, 1);
  assert.equal(maybe[0].file, 'src/c.ts');
  assert.equal(maybe[0].line, 30);
  assert.equal(maybe[0].signal, 'behavior');

  // AnimatePresence is not mentioned at all — no false signal.
  assert.ok(!certain.some((u) => u.api === 'AnimatePresence'));
  assert.ok(!maybe.some((u) => u.api === 'AnimatePresence'));
});

test('namespace `*` usages are skipped — no export name to match', () => {
  const usages = [usage({ api: '*', via: 'namespace' })];
  const notes = new Map([['2.0.0', note('## 2.0.0\n\n- Removed `useScroll`')]]);
  const { certain, maybe } = matchUsages({ usages, notes });
  assert.equal(certain.length, 0);
  assert.equal(maybe.length, 0);
});

test('plain-object notes are accepted as well as Maps', () => {
  const usages = [usage()];
  const notes = { '2.0.0': note('## 2.0.0\n\n- Removed `useScroll`') };
  const { certain } = matchUsages({ usages, notes });
  assert.equal(certain.length, 1);
});

test('a realistic framer-motion-style changelog flags the right things', () => {
  // Mirrors the shape of real framer-motion notes: a Major Changes section
  // that removes an export, and a Changed section that alters behavior.
  const body = `## [12.43.0] 2026-07-27

### Major Changes

- Removed \`useScroll\` in favour of \`useScrollTo\`

### Changed

- \`motion\` components now cache layout measurements by default
- \`AnimatePresence\` no longer supports \`initial={false}\`

### Fixed

- \`animateView\`: Cropped group layers now animate \`border-radius\``;

  const usages = [
    usage({ file: 'src/hooks.ts', line: 4, api: 'useScroll' }),
    usage({ file: 'src/ui.tsx', line: 12, api: 'motion', member: 'div' }),
    usage({ file: 'src/ui.tsx', line: 40, api: 'AnimatePresence' }),
    usage({ file: 'src/ui.tsx', line: 55, api: 'animateView' }),
  ];
  const notes = new Map([
    ['12.43.0', { version: '12.43.0', body, source: 'changelog', path: 'CHANGELOG.md' }],
  ]);

  const { certain, maybe } = matchUsages({ usages, notes });

  assert.deepEqual(
    certain.map((u) => u.api),
    ['useScroll']
  );
  assert.deepEqual(
    maybe.map((u) => u.api),
    ['motion', 'AnimatePresence']
  );
  // animateView is only mentioned under Fixed — no change signal, no report.
  assert.ok(!certain.some((u) => u.api === 'animateView'));
  assert.ok(!maybe.some((u) => u.api === 'animateView'));
});

test('a default import never matches the bare word "default"', () => {
  // Regression: `next/image` default imports matched the English word
  // "default", so a line like "remove the default export entirely" looked like
  // a certain break even though the import specifier is never mentioned.
  const m = matchUsage(
    usage({ api: 'default', subpath: 'image', via: 'default' }),
    new Map([['16.3.0', note('## 16.3.0\n\n### Changed\n\n- remove the default export entirely')]]),
    'next'
  );
  assert.equal(m, null);
});

test('a default import without a subpath is skipped rather than guessed', () => {
  assert.equal(
    matchUsage(
      usage({ api: 'default', subpath: null, via: 'default' }),
      new Map([['2.0.0', note('## 2.0.0\n\n- removed the default export')]]),
      'next'
    ),
    null
  );
});

test('namespace `*` usages never match, even when matchUsage is called directly', () => {
  assert.equal(
    matchUsage(
      usage({ api: '*', via: 'namespace' }),
      new Map([['2.0.0', note('## 2.0.0\n\n- removed everything')]])
    ),
    null
  );
});

test('docs, chore, test, ci, and style lines are never a signal', () => {
  const body = `## 2.0.0

### Changed

- docs: remove the old \`useScroll\` implementation
- chore: drop \`useScroll\` from an example
- test: fix the \`useScroll\` tests
- ci: remove \`useScroll\` from the matrix
- style: rename the \`useScroll\` variable`;
  const m = matchUsage(usage(), new Map([['2.0.0', note(body)]]));
  assert.equal(m, null);
});

test('a docs-prefixed change line cannot feed a related signal', () => {
  const m = matchUsage(
    usage(),
    new Map([['2.0.0', note('## 2.0.0\n\n### Changed\n\n- docs: remove the old implementation\n- `useScroll`')]])
  );
  assert.equal(m, null);
});

test('an explicit breaking marker beats a newer non-marker breaking line', () => {
  const m = matchUsage(
    usage(),
    new Map([
      ['1.5.0', note('## 1.5.0\n\n- breaking!: removed `useScroll`')],
      ['2.0.0', note('## 2.0.0\n\n- removed `useScroll`')],
    ])
  );
  assert.equal(m.signal, 'explicit');
  assert.equal(m.version, '1.5.0');
});

test('the BREAKING CHANGE footer is an explicit marker', () => {
  const m = matchUsage(
    usage(),
    new Map([
      ['2.0.0', note('## 2.0.0\n\n- `useScroll` removed\n\nBREAKING CHANGE: the `useScroll` signature changed')],
    ])
  );
  assert.equal(m.signal, 'explicit');
});

test('a module-level match is never certain, even with an explicit marker', () => {
  // Regression: a default import matched by its specifier (next/image) is a
  // mention of the whole module, not of a specific export, member, or prop
  // the code actually uses. An unrelated line about `images.imageSizes` that
  // happens to carry a `!:` marker must not read as a certain break on every
  // usage of `next/image` — that was the reported bug (6 false "will break"
  // findings citing an unrelated images config change).
  const usages = [usage({ api: 'default', subpath: 'image', via: 'default' })];
  const notes = new Map([
    [
      '16.3.4',
      note('## 16.3.4\n\n- breaking(next/image)!: remove 16px from default images.imageSizes config'),
    ],
  ]);

  const m = matchUsage(usages[0], notes, 'next');
  assert.equal(m.signal, 'behavior');
  assert.equal(m.version, '16.3.4');
  assert.match(m.excerpt, /next\/image/);

  const { certain, maybe } = matchUsages({ usages, notes, pkg: 'next' });
  assert.equal(certain.length, 0);
  assert.equal(maybe.length, 1);
  assert.equal(maybe[0].signal, 'behavior');
  assert.equal(maybe[0].tag, 'module-level change');
});

test('an "add" line never reads as certain, even with an explicit marker', () => {
  // Regression: "feat(next/image)!: add support for `dangerouslyAllowLocalIP`"
  // describes a new capability, not a removal. The `!:` marker signals a
  // notable change worth flagging, not a break — it must cap at `behavior`,
  // the same as any other non-removal wording, for a named export too (not
  // only for a module-level match).
  const m = matchUsage(
    usage({ api: 'useScroll' }),
    new Map([['2.0.0', note('## 2.0.0\n\n- feat!: add support for a new `useScroll` option')]])
  );
  assert.equal(m.signal, 'behavior');
});

test('a bracketed [Breaking] marker on an "add" line is also capped at behavior', () => {
  const m = matchUsage(
    usage({ api: 'useScroll' }),
    new Map([['2.0.0', note('## 2.0.0\n\n- [Breaking] Added `useScroll` support for horizontal containers')]])
  );
  assert.equal(m.signal, 'behavior');
});

test('a module-level usage is tagged, even when the signal is already a maybe', () => {
  const m = matchUsages({
    usages: [usage({ api: 'default', subpath: 'image', via: 'default' })],
    notes: new Map([['2.0.0', note('## 2.0.0\n\n- `next/image` now caches results by default')]]),
    pkg: 'next',
  });
  assert.equal(m.certain.length, 0);
  assert.equal(m.maybe.length, 1);
  assert.equal(m.maybe[0].tag, 'module-level change');
});

test('the reported false positive: a docs commit about the default is ignored', () => {
  // Real run: next 15.5.25 → 16.3.4 on create-next-app. The evidence line was
  // "docs: remove incorrect statement that force-cache is the default for ..."
  // from 16.3.0, matched against a default import of next/image. It must not
  // produce any signal: the line is docs-prefixed and never names the specifier.
  const m = matchUsage(
    usage({ api: 'default', subpath: 'image', via: 'default' }),
    new Map([
      ['16.3.0', note('## 16.3.0\n\n- docs: remove incorrect statement that force-cache is the default for fetch')],
    ]),
    'next'
  );
  assert.equal(m, null);
});