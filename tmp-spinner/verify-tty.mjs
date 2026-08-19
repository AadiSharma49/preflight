// Verify the spinner actually animates when force-enabled (simulating a TTY).
import { withSpinner } from '../../src/spinner.js';

const out = await withSpinner(
  'Testing spinner...',
  () => new Promise((r) => setTimeout(r, 400)),
  { enabled: true }
);
// After completion the line is cleared; write a marker so we can see the result.
console.log('DONE');