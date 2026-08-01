import type { ReactNode } from 'react';
import { CopyButton } from './copy-button';

/**
 * A framed block of real terminal output, styled as a macOS window: chrome on
 * top, prompt and output in the body. The copy button copies the command only —
 * the output below is not something anyone wants on their clipboard.
 */
export function Terminal({
  command,
  title = 'preflight',
  copyValue,
  children,
}: {
  command: string;
  title?: string;
  copyValue?: string;
  children?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow)]">
      <div className="relative flex items-center justify-between border-b border-border bg-titlebar px-4 py-2.5">
        <TrafficLights />

        {/* Absolutely centred so it stays optically centred in the window, not
            centred in the space left over between the dots and the button. */}
        <span className="pointer-events-none absolute inset-x-0 select-none text-center font-mono text-[11.5px] text-faint">
          {title}
        </span>

        <CopyButton value={copyValue ?? command} />
      </div>

      <div className="overflow-x-auto px-4 py-3.5">
        <pre className="font-mono text-[12.5px] leading-[1.7] text-muted">
          <span className="text-fg">
            <span className="select-none text-faint">$ </span>
            {command}
          </span>
          {children ? (
            <>
              {'\n\n'}
              {children}
            </>
          ) : null}
        </pre>
      </div>
    </div>
  );
}

function TrafficLights() {
  // The rim is what stops these reading as three flat circles.
  const rim = 'shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.16)]';
  return (
    <span className="flex shrink-0 items-center gap-[6px]" aria-hidden="true">
      <span className={`size-[11px] rounded-full bg-[#ff5f57] ${rim}`} />
      <span className={`size-[11px] rounded-full bg-[#febc2e] ${rim}`} />
      <span className={`size-[11px] rounded-full bg-[#28c840] ${rim}`} />
    </span>
  );
}

/** One row of scanner output: location, API, and how it's used. */
export function Row({
  loc,
  api,
  kind,
  flagged = false,
}: {
  loc: string;
  api: string;
  kind: string;
  flagged?: boolean;
}) {
  return (
    <>
      {'  '}
      <span className="text-faint">{loc.padEnd(9)}</span>
      <span className={flagged ? 'text-accent' : 'text-fg'}>{api.padEnd(18)}</span>
      <span className={flagged ? 'text-accent' : 'text-muted'}>{kind}</span>
      {'\n'}
    </>
  );
}

export function FileLine({ path }: { path: string }) {
  return (
    <span className="text-fg">
      {path}
      {'\n'}
    </span>
  );
}
