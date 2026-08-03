#!/usr/bin/env node
import { run } from '../src/cli.js';

// Exit codes are the CI contract: 0 when no certain break was found, 1 when
// at least one certain break exists. A thrown error (bad args, bad path,
// network failure while fetching) is always exit 1.
run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((err) => {
    console.error(`\npreflight: ${err.message}\n`);
    process.exit(1);
  });