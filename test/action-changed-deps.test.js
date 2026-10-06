import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dependencyMap,
  changedDependencies,
  baseVersionFromLock,
  baseVersionFor,
} from '../action/changed-deps.js';

test('dependencyMap flattens all four dependency fields', () => {
  const map = dependencyMap({
    dependencies: { react: '^19.0.0' },
    devDependencies: { typescript: '^5.0.0' },
    peerDependencies: { react: '^19.0.0' },
    optionalDependencies: { fsevents: '^2.3.0' },
  });
  assert.equal(map.get('react'), '^19.0.0');
  assert.equal(map.get('typescript'), '^5.0.0');
  assert.equal(map.get('fsevents'), '^2.3.0');
});

test('a version bump is detected', () => {
  const changes = changedDependencies({
    baseManifest: { dependencies: { react: '^18.0.0' } },
    headManifest: { dependencies: { react: '^19.0.0' } },
  });
  assert.deepEqual(changes, [{ name: 'react', from: '^18.0.0', to: '^19.0.0' }]);
});

test('a newly added dependency has from = null', () => {
  const changes = changedDependencies({
    baseManifest: { dependencies: {} },
    headManifest: { dependencies: { lodash: '^4.17.21' } },
  });
  assert.deepEqual(changes, [{ name: 'lodash', from: null, to: '^4.17.21' }]);
});

test('a removed dependency has to = null', () => {
  const changes = changedDependencies({
    baseManifest: { dependencies: { lodash: '^4.17.21' } },
    headManifest: { dependencies: {} },
  });
  assert.deepEqual(changes, [{ name: 'lodash', from: '^4.17.21', to: null }]);
});

test('moving between fields with the same range is not a version change', () => {
  const changes = changedDependencies({
    baseManifest: { dependencies: { react: '^19.0.0' } },
    headManifest: { devDependencies: { react: '^19.0.0' } },
  });
  assert.deepEqual(changes, []);
});

test('unchanged dependencies are not reported', () => {
  const changes = changedDependencies({
    baseManifest: { dependencies: { react: '^19.0.0', vue: '^3.0.0' } },
    headManifest: { dependencies: { react: '^19.0.0' } },
  });
  assert.deepEqual(changes, [{ name: 'vue', from: '^3.0.0', to: null }]);
});

test('missing manifests are handled without error', () => {
  assert.deepEqual(changedDependencies({ baseManifest: null, headManifest: null }), []);
  assert.deepEqual(
    changedDependencies({ baseManifest: null, headManifest: { dependencies: { a: '^1.0.0' } } }),
    [{ name: 'a', from: null, to: '^1.0.0' }]
  );
});

test('base version is read from a lockfileVersion 3 packages map', () => {
  const lock = { lockfileVersion: 3, packages: { 'node_modules/next': { version: '15.3.9' } } };
  assert.equal(baseVersionFromLock(lock, 'next'), '15.3.9');
  assert.equal(
    baseVersionFor({ name: 'next', from: '^16.0.0', lockfile: lock }),
    '15.3.9'
  );
});

test('base version is read from a lockfileVersion 1 dependencies tree', () => {
  const lock = { lockfileVersion: 1, dependencies: { next: { version: '15.3.9' } } };
  assert.equal(
    baseVersionFor({ name: 'next', from: '^16.0.0', lockfile: lock }),
    '15.3.9'
  );
});

test('the fallback path: no base lockfile gives the lower bound of the from range', () => {
  assert.equal(baseVersionFor({ name: 'next', from: '^15.3.0', lockfile: null }), '15.3.0');
  assert.equal(baseVersionFor({ name: 'next', from: '15.x', lockfile: null }), '15.0.0');
  assert.equal(baseVersionFor({ name: 'next', from: '15.3.9', lockfile: null }), '15.3.9');
});

test('the fallback path: a base lockfile that never listed the package', () => {
  assert.equal(baseVersionFor({ name: 'next', from: '^15.3.0', lockfile: { lockfileVersion: 3, packages: {} } }), '15.3.0');
});

test('a newly added dependency (no from) has no base version', () => {
  assert.equal(baseVersionFor({ name: 'next', from: null, lockfile: null }), null);
});