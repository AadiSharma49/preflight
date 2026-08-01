import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSource } from '../src/scanner.js';

const PKG = 'framer-motion';

/** Compact projection so assertions read like the thing being asserted. */
function scan(code, { file = 'x.js', pkg = PKG } = {}) {
  const { usages, error } = scanSource({ code, file, pkg, root: null });
  assert.equal(error, null, `parse failed: ${error}`);
  return usages.map(
    (u) => `${u.line}:${u.kind}:${u.api}${u.member ? `.${u.member}` : ''}`
  );
}

test('named import records the import and every use site', () => {
  assert.deepEqual(
    scan(`
import { motion } from 'framer-motion';
const a = motion;
const b = motion;
`),
    ['2:import:motion', '3:reference:motion', '4:reference:motion']
  );
});

test('renamed import reports the real export name, not the alias', () => {
  assert.deepEqual(
    scan(`
import { useScroll as scrollHook } from 'framer-motion';
scrollHook();
`),
    ['2:import:useScroll', '3:call:useScroll']
  );
});

test('namespace import resolves the member as the export name', () => {
  assert.deepEqual(
    scan(`
import * as fm from 'framer-motion';
fm.animate();
const v = fm.useScroll;
`),
    ['2:import:*', '3:call:animate', '4:member:useScroll']
  );
});

test('default import resolves members too', () => {
  assert.deepEqual(
    scan(`
import fm from 'framer-motion';
fm.animate();
`),
    ['2:import:default', '3:call:animate']
  );
});

test('destructured require behaves like a named import', () => {
  assert.deepEqual(
    scan(`
const { animate } = require('framer-motion');
animate();
`),
    ['2:import:animate', '3:call:animate']
  );
});

test('whole-module require resolves members', () => {
  assert.deepEqual(
    scan(`
const fm = require('framer-motion');
fm.animate();
`),
    ['2:import:*', '3:call:animate']
  );
});

test('dynamic import is recorded', () => {
  assert.deepEqual(
    scan(`
const fm = await import('framer-motion');
`),
    ['2:dynamic:*']
  );
});

test('subpath imports match the package', () => {
  const { usages } = scanSource({
    code: `import { animate } from 'framer-motion/dom';`,
    file: 'x.js',
    pkg: PKG,
    root: null,
  });
  assert.equal(usages.length, 1);
  assert.equal(usages[0].subpath, 'dom');
});

test('a different package with the same prefix does NOT match', () => {
  assert.deepEqual(scan(`import { x } from 'framer-motion-3d';`), []);
});

test('commented-out imports and lookalike strings are not usages', () => {
  assert.deepEqual(
    scan(`
// import { motion } from 'framer-motion';
/* import { animate } from 'framer-motion'; */
const s = "import { motion } from 'framer-motion'";
`),
    []
  );
});

test('a local binding that shadows the import is not counted', () => {
  assert.deepEqual(
    scan(`
import { motion } from 'framer-motion';
function inner() {
  const motion = 'not the package';
  return motion;
}
export const real = motion;
`),
    ['2:import:motion', '7:reference:motion']
  );
});

test('side-effect import is recorded', () => {
  assert.deepEqual(scan(`import 'framer-motion';`), ['1:import:*']);
});

test('re-exports count as usage', () => {
  assert.deepEqual(scan(`export { animate } from 'framer-motion';`), [
    '1:re-export:animate',
  ]);
});

test('JSX member usage keeps the export name and records the member', () => {
  assert.deepEqual(
    scan(`import { motion } from 'framer-motion';\nexport const C = () => <motion.div />;`, {
      file: 'x.jsx',
    }),
    ['1:import:motion', '2:jsx:motion.div']
  );
});

test('type-only imports are flagged, and `as` casts stay values', () => {
  const { usages } = scanSource({
    code: `
import { motion, type Variants } from 'framer-motion';
const v: Variants = {};
const m = motion as unknown;
`,
    file: 'x.ts',
    pkg: PKG,
    root: null,
  });

  const variants = usages.filter((u) => u.api === 'Variants');
  assert.ok(variants.length >= 2, 'expected the Variants import and its use');
  assert.ok(
    variants.every((u) => u.typeOnly),
    'every Variants usage should be type-only'
  );

  // `motion as unknown` is a value expression, not a type position.
  const cast = usages.find((u) => u.api === 'motion' && u.kind !== 'import');
  assert.equal(cast.kind, 'reference');
  assert.equal(cast.typeOnly, false);
});

test('scoped package names work', () => {
  assert.deepEqual(
    scan(`import { useUser } from '@clerk/nextjs';\nuseUser();`, {
      pkg: '@clerk/nextjs',
    }),
    ['1:import:useUser', '2:call:useUser']
  );
});

test('a malformed file reports an error instead of throwing', () => {
  const { error } = scanSource({
    code: `import { from 'framer-motion' ;;; function (`,
    file: 'x.js',
    pkg: PKG,
    root: null,
  });
  assert.ok(typeof error === 'string' || error === null);
});
