// src/spinner.js
//
// A minimal terminal loading indicator for the slow steps (repo scan, network
// changelog fetch). It is deliberately isolated to the CLI's output layer:
// it only wraps calls, it never touches the logic inside them.
//
// Rules:
//   - Only animates when stdout is an interactive TTY. In CI (GitHub Actions)
//     or piped output, it does nothing at all — spinner characters would look
//     broken in captured logs.
//   - Clears the line cleanly when the step finishes, so no leftover frames
//     or garbage characters remain in the output.
//   - Never writes anything when `enabled` is false (e.g. --json mode), so
//     machine-readable output stays clean.

import { isatty } from 'node:tty';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Run `fn` with a spinner shown while it works.
 *
 * @param {string} message  Short status text, e.g. "Fetching changelog..."
 * @param {() => Promise<T> | T} fn  The slow work to wrap.
 * @param {{ enabled?: boolean }} [opts]  Force the spinner on or off. When
 *   omitted, defaults to auto-detecting an interactive TTY.
 * @returns {Promise<T>} The result of `fn`.
 */
export async function withSpinner(message, fn, { enabled } = {}) {
  // With no explicit override, piped or CI output never gets spinner
  // characters. The CLI only uses `true` in tests; normal runs auto-detect.
  const show = enabled ?? Boolean(process.stdout.isTTY && isatty(process.stdout.fd));
  if (!show) return fn();

  let frame = 0;
  const render = () => {
    process.stdout.write(`\r\x1b[K${FRAMES[frame % FRAMES.length]} ${message}`);
    frame += 1;
  };

  render();
  const timer = setInterval(() => {
    render();
  }, 80);

  try {
    return await fn();
  } finally {
    clearInterval(timer);
    // Clear the spinner line entirely so the next output starts clean.
    process.stdout.write('\r\x1b[K');
  }
}