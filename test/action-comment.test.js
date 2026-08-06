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