import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSpinner } from '../src/spinner.js';

test('renders immediately for synchronous work and clears the line', async () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };

  try {
    const result = await withSpinner('Scanning repo...', () => 'done', { enabled: true });
    assert.equal(result, 'done');
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.match(writes[0], /\r\x1b\[K[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Scanning repo\.\.\./u);
  assert.equal(writes.at(-1), '\r\x1b[K');
});

test('does not write when disabled', async () => {
  const writes = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };

  try {
    await withSpinner('Fetching changelog...', () => 'done', { enabled: false });
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.deepEqual(writes, []);
});