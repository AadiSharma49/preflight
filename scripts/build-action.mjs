// scripts/build-action.mjs
//
// Bundles the two entry points the GitHub Action needs into self-contained
// files under dist/. GitHub Actions does not run npm install for JavaScript
// actions, so every runtime dependency (including @babel/parser, @babel/
// traverse, semver, ignore) must live inside the committed bundle.
//
//   dist/action.mjs  -> the action entry (action/run.js + its pure modules)
//   dist/cli.mjs     -> the preflight CLI (bin/cli.js + src/*, ESM format)
//
// `path` and other node built-ins stay external and are resolved at runtime
// by the action runner's Node.

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  legalComments: 'none',
};

await Promise.all([
  build({
    ...common,
    entryPoints: ['action/run.js'],
    outfile: 'dist/action.mjs',
    // The action entry spawns the CLI as a child process by path; the CLI
    // bundle must be resolvable without any installed node_modules.
    banner: {
      js: [
        `/* preflight GitHub Action bundle — do not edit. */`,
        `import { createRequire } from 'node:module';`,
        `const require = createRequire(import.meta.url);`,
      ].join('\n'),
    },
  }),
  build({
    ...common,
    entryPoints: ['bin/cli.js'],
    outfile: 'dist/cli.mjs',
    banner: {
      js: [
        `/* preflight CLI bundle — do not edit. */`,
        `import { createRequire } from 'node:module';`,
        `const require = createRequire(import.meta.url);`,
      ].join('\n'),
    },
  }),
]);

console.log('built dist/action.mjs and dist/cli.mjs');