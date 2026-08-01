import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCurrentVersion } from '../src/installed.js';

/** Build a throwaway repo from a {relativePath: contents} map. */
function repoWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  return dir;
}

test('package-lock v3 is read from the packages map', () => {
  const repo = repoWith({
    'package-lock.json': {
      lockfileVersion: 3,
      packages: { 'node_modules/framer-motion': { version: '12.40.0' } },
    },
  });
  assert.deepEqual(resolveCurrentVersion({ repo, pkg: 'framer-motion' }), {
    version: '12.40.0',
    source: 'package-lock.json',
    exact: true,
  });
});

test('package-lock v1 is read from the dependencies map', () => {
  const repo = repoWith({
    'package-lock.json': {
      lockfileVersion: 1,
      dependencies: { lodash: { version: '4.17.21' } },
    },
  });
  assert.equal(resolveCurrentVersion({ repo, pkg: 'lodash' }).version, '4.17.21');
});

test('yarn.lock entries are parsed', () => {
  const repo = repoWith({
    'yarn.lock': `# yarn lockfile v1


"framer-motion@^12.0.0":
  version "12.40.0"
  resolved "https://registry.yarnpkg.com/framer-motion/-/framer-motion-12.40.0.tgz"
`,
  });
  const got = resolveCurrentVersion({ repo, pkg: 'framer-motion' });
  assert.equal(got.version, '12.40.0');
  assert.equal(got.source, 'yarn.lock');
});

test('pnpm-lock entries are parsed', () => {
  const repo = repoWith({
    'pnpm-lock.yaml': `lockfileVersion: '9.0'

packages:

  framer-motion@12.40.0:
    resolution: {integrity: sha512-abc}
`,
  });
  const got = resolveCurrentVersion({ repo, pkg: 'framer-motion' });
  assert.equal(got.version, '12.40.0');
  assert.equal(got.source, 'pnpm-lock.yaml');
});

test('node_modules is preferred over a package.json range', () => {
  const repo = repoWith({
    'package.json': { dependencies: { react: '^19.0.0' } },
    'node_modules/react/package.json': { name: 'react', version: '19.2.4' },
  });
  const got = resolveCurrentVersion({ repo, pkg: 'react' });
  assert.equal(got.version, '19.2.4');
  assert.equal(got.exact, true);
});

test('with no lockfile the package.json range is used and flagged inexact', () => {
  const repo = repoWith({ 'package.json': { dependencies: { react: '^19.0.0' } } });
  assert.deepEqual(resolveCurrentVersion({ repo, pkg: 'react' }), {
    version: '^19.0.0',
    source: 'package.json',
    exact: false,
  });
});

test('devDependencies count too', () => {
  const repo = repoWith({ 'package.json': { devDependencies: { typescript: '^5.0.0' } } });
  assert.equal(resolveCurrentVersion({ repo, pkg: 'typescript' }).version, '^5.0.0');
});

test('a package the repo does not depend on resolves to null', () => {
  const repo = repoWith({ 'package.json': { dependencies: { react: '^19.0.0' } } });
  assert.equal(resolveCurrentVersion({ repo, pkg: 'vue' }), null);
});

test('a corrupt lockfile falls through instead of throwing', () => {
  const repo = repoWith({
    'package-lock.json': '{ this is not json',
    'package.json': { dependencies: { react: '^19.0.0' } },
  });
  assert.equal(resolveCurrentVersion({ repo, pkg: 'react' }).source, 'package.json');
});
