'use client';

import { useState } from 'react';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions). Say nothing
      // rather than pretending it worked.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      // Borderless: in a window title bar a bordered button competes with the chrome.
      className="relative z-10 shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] text-faint transition-colors hover:text-fg"
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}
