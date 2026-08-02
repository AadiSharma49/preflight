/**
 * The preflight mark: an ascent that doesn't complete.
 *
 * Drawn on the same 24-unit grid at 2-unit stroke weight as the rest of the
 * icon set. The amber segment is the fracture — it is the only coloured part,
 * and it uses the same accent the CLI uses to flag a finding.
 */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M4 16.5 L12 7.5 L14.8 10.65" stroke="currentColor" />
      <path d="M17.44 13.62 L20 16.5" stroke="var(--accent)" />
    </svg>
  );
}
