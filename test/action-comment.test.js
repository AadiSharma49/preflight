import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComment, COMMENT_MARKER } from '../action/comment.js';

const finding = (over = {}) => ({
  file: 'src/app.tsx',
  line: 4,
  api: 'useThing',
  member: null,
  version: '2.0.0',
  excerpt: '- Removed `useThing`',
  ...over,
});

test('comment starts with the marker and a heading', () => {
  const body = buildComment([]);
  assert.ok(body.startsWith(`${COMMENT_MARKER}\n## preflight dependency check`));
});

test('no findings produces a clean all-clear message', () => {
  const body = buildComment([{ name: 'react', from: '^18.0.0', to: '^19.0.0', certain: [], maybe: [], transitive: [] }]);
  assert.match(body, /No certain breaks or flagged maybes/);
  assert.ok(!body.includes('### ⛔'));
  assert.ok(!body.includes('### ⚠️'));
});

test('certain breaks come first, maybes after, with origin labels', () => {
  const body = buildComment([
    {
      name: 'fake-pkg',
      from: '^1.0.0',
      to: '^2.0.0',
      certain: [finding({ line: 4 })],
      maybe: [finding({ line: 9, api: 'useOther', excerpt: '- `useOther` now defaults to `true`' })],
      transitive: [],
    },
  ]);

  const certainIdx = body.indexOf('### ⛔ Certain — will break');
  const maybeIdx = body.indexOf('### ⚠️ Maybe — review');
  assert.ok(certainIdx !== -1);
  assert.ok(maybeIdx !== -1);
  assert.ok(certainIdx < maybeIdx, 'certain section must come before maybe');

  assert.match(body, /fake-pkg \^1\.0\.0 → \^2\.0\.0/);
  assert.match(body, /1 certain break · 1 maybe — this upgrade will break code/);
  assert.match(body, /`src\/app\.tsx:4` — \*\*`useThing`\*\* `2\.0\.0`/);
  assert.match(body, /- Removed `useThing`/);
});

test('transitive findings are labelled as transitive', () => {
  const body = buildComment([
    {
      name: 'fake-pkg',
      from: '^1.0.0',
      to: '^2.0.0',
      certain: [],
      maybe: [],
      transitive: [
        {
          package: 'motion-dom',
          certain: [],
          maybe: [finding({ line: 12, api: 'animate', excerpt: '- `animate` changed' })],
        },
      ],
    },
  ]);

  assert.match(body, /motion-dom \(transitive\)/);
  assert.match(body, /`src\/app\.tsx:12` — \*\*`animate`\*\*/);
});

test('a dependency with missing release notes makes the comment say incomplete, never all-clear', () => {
  const body = buildComment([
    {
      name: 'next',
      from: '15.0.0',
      to: '16.3.4',
      certain: [],
      maybe: [],
      transitive: [],
      changelog: { missing: ['16.0.0', '16.0.1', '16.0.9'] },
    },
  ]);

  assert.match(body, /Incomplete/i);
  assert.match(body, /16\.0\.0/);
  assert.match(body, /16\.0\.1/);
  assert.match(body, /16\.0\.9/);
  assert.ok(!/No certain breaks or flagged maybes/.test(body));
});

test('the same evidence line repeated across usages in one file is shown once, with every line', () => {
  // Regression: a module-level match (default/namespace import matched by
  // specifier) repeats across every usage site in a file. The comment must
  // not print the same finding once per usage.
  const body = buildComment([
    {
      name: 'next',
      from: '15.5.25',
      to: '16.3.4',
      certain: [],
      maybe: [
        finding({
          file: 'app/page.tsx',
          line: 2,
          api: 'default',
          excerpt: '- breaking(next/image)!: remove 16px from default images.imageSizes config',
          tag: 'module-level change',
        }),
        finding({
          file: 'app/page.tsx',
          line: 6,
          api: 'default',
          excerpt: '- breaking(next/image)!: remove 16px from default images.imageSizes config',
          tag: 'module-level change',
        }),
        finding({
          file: 'app/page.tsx',
          line: 7,
          api: 'default',
          excerpt: '- breaking(next/image)!: remove 16px from default images.imageSizes config',
          tag: 'module-level change',
        }),
      ],
      transitive: [],
    },
  ]);

  assert.match(body, /0 certain · 1 maybe/);
  assert.match(body, /`app\/page\.tsx:2,6,7` — \*\*`default`\*\*/);
  assert.match(body, /tag: module-level change/);
  assert.equal(body.split('images.imageSizes config').length - 1, 1);
});

test('a certain break stays visible in the headline alongside an incomplete warning', () => {
  // Requirement: the headline leads with the real counts; incomplete is a
  // warning appended to it, never a replacement that hides a real finding.
  const body = buildComment([
    {
      name: 'next',
      from: '15.0.0',
      to: '16.3.4',
      certain: [finding({ line: 4 })],
      maybe: [],
      transitive: [],
      changelog: { missing: ['16.0.0'] },
    },
  ]);

  const verdictLine = body.split('\n').find((l) => l.startsWith('**'));
  assert.match(verdictLine, /^\*\*1 certain break.*Incomplete.*16\.0\.0/);
  assert.match(body, /### ⛔ Certain — will break/);
  assert.match(body, /- Removed `useThing`/);
});

test('multiple changed dependencies are consolidated into one comment', () => {
  const body = buildComment([
    {
      name: 'react',
      from: '^18.0.0',
      to: '^19.0.0',
      certain: [finding({ line: 2, api: 'createRoot' })],
      maybe: [],
      transitive: [],
    },
    {
      name: 'lodash',
      from: '^4.17.20',
      to: '^4.17.21',
      certain: [],
      maybe: [finding({ line: 30, api: 'chunk', excerpt: '- `chunk` now defaults to `false`' })],
      transitive: [],
    },
  ]);

  assert.match(body, /react \^18\.0\.0 → \^19\.0\.0/);
  assert.match(body, /lodash \^4\.17\.20 → \^4\.17\.21/);
  assert.match(body, /1 certain break · 1 maybe — this upgrade will break code/);
});