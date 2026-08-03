import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  directDependencies,
  lockfilePackages,
  resolveDependencyKind,
  listTransitiveDeps,
} from '../src/transitive.js';

/** Build a throwaway repo from a {relativePath: contents} map. */
function repoWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-trans-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  return dir;
}

test('directDependencies reads all four dependency fields', () => {
  const repo = repoWith({
    'package.json': {
      dependencies: { react: '^19.0.0' },
      devDependencies: { typescript: '^5.0.0' },
      peerDependencies: { react: '^19.0.0' },
      optionalDependencies: { fsevents: '^2.3.0' },
    },
  });
  const direct = directDependencies(repo);
  assert.ok(direct.has('react'));
  assert.ok(direct.has('typescript'));
  assert.ok(direct.has('fsevents'));
  assert.equal(direct.size, 3); // react appears once despite being in two fields
});

test('lockfilePackages reads lockfileVersion 3 packages map', () => {
  const repo = repoWith({
    'package-lock.json': {
      lockfileVersion: 3,
      packages: {
        '': { name: 'app', dependencies: { react: '^19.0.0' } },
        'node_modules/react': { version: '19.2.4' },
        'node_modules/scheduler': { version: '0.25.0' },
        'node_modules/react/node_modules/loose-envify': { version: '1.4.0' },
      },
    },
  });
  const names = lockfilePackages(repo);
  assert.ok(names.has('react'));
  assert.ok(names.has('scheduler'));
  assert.ok(names.has('loose-envify'));
  assert.equal(names.size, 3); // the root "" entry is not a package
});

test('lockfilePackages reads lockfileVersion 1 dependencies tree', () => {
  const repo = repoWith({
    'package-lock.json': {
      lockfileVersion: 1,
      dependencies: {
        react: { version: '19.2.4', dependencies: { scheduler: { version: '0.25.0' } } },
      },
    },
  });
  const names = lockfilePackages(repo);
  assert.ok(names.has('react'));
  assert.ok(names.has('scheduler'));
});

test('a missing lockfile yields an empty set, not an error', () => {
  const repo = repoWith({ 'package.json': { dependencies: { react: '^19.0.0' } } });
  assert.equal(lockfilePackages(repo).size, 0);
});

test('resolveDependencyKind separates direct, transitive, and absent', () => {
  const repo = repoWith({
    'package.json': { dependencies: { react: '^19.0.0' } },
    'package-lock.json': {
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { react: '^19.0.0' } },
        'node_modules/react': { version: '19.2.4' },
        'node_modules/scheduler': { version: '0.25.0' },
      },
    },
  });

  assert.equal(resolveDependencyKind({ repo, pkg: 'react' }), 'direct');
  assert.equal(resolveDependencyKind({ repo, pkg: 'scheduler' }), 'transitive');
  assert.equal(resolveDependencyKind({ repo, pkg: 'vue' }), null);
});

test('listTransitiveDeps returns only non-direct packages, sorted', () => {
  const repo = repoWith({
    'package.json': { dependencies: { react: '^19.0.0' } },
    'package-lock.json': {
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { react: '^19.0.0' } },
        'node_modules/react': { version: '19.2.4' },
        'node_modules/scheduler': { version: '0.25.0' },
        'node_modules/loose-envify': { version: '1.4.0' },
      },
    },
  });

  assert.deepEqual(listTransitiveDeps(repo), ['loose-envify', 'scheduler']);
});

test('a scoped transitive package is handled', () => {
  const repo = repoWith({
    'package.json': { dependencies: { react: '^19.0.0' } },
    'package-lock.json': {
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { react: '^19.0.0' } },
        'node_modules/react': { version: '19.2.4' },
        'node_modules/@babel/runtime': { version: '7.0.0' },
      },
    },
  });
  assert.equal(resolveDependencyKind({ repo, pkg: '@babel/runtime' }), 'transitive');
  assert.deepEqual(listTransitiveDeps(repo), ['@babel/runtime']);
});