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