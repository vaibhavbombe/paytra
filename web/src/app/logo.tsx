// Same drawing as app/icon.svg (the favicon). The rupee sign is drawn as
// strokes, not a font glyph, so it looks identical on every device.
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="14" fill="#2a78d6" />
      <path
        d="M19 16H45M19 25H45M27 16C39 16 39 34 27 34H20L40 50"
        fill="none"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
