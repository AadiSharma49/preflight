import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSubdir, repoPath } from '../action/repo-path.js';

test('repoPath with no subdir returns the bare filename', () => {
  assert.equal(repoPath('', 'package.json'), 'package.json');
  assert.equal(repoPath(undefined, 'package.json'), 'package.json');
});

test('repoPath joins a subdirectory', () => {
  assert.equal(repoPath('apps/web', 'package.json'), 'apps/web/package.json');
});

test('repoPath tolerates leading and trailing slashes on the subdir', () => {
  assert.equal(repoPath('/apps/web/', 'package-lock.json'), 'apps/web/package-lock.json');
});

test('normalizeSubdir strips leading and trailing slashes', () => {
  assert.equal(normalizeSubdir('/apps/web/'), 'apps/web');
  assert.equal(normalizeSubdir('apps/web'), 'apps/web');
  assert.equal(normalizeSubdir(''), '');
  assert.equal(normalizeSubdir(undefined), '');
});
