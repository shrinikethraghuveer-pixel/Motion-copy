/**
 * Official Motion brand mark — a 3D glassmorphic ribbon forming an "M"
 * with electric violet/cyan metallic chrome highlights.
 * Crisp and high-contrast by design: no glow circles, no outer halos.
 */
export function RibbonM({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Motion logo"
      role="img"
    >
      <defs>
        {/* ribbon body: violet → cyan chrome */}
        <linearGradient id="ribbon-body" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="45%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
        {/* metallic sheen band across the ribbon */}
        <linearGradient id="ribbon-sheen" x1="8" y1="6" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#f4f4f5" stopOpacity="0.95" />
          <stop offset="38%" stopColor="#e4e4e7" stopOpacity="0.25" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#67e8f9" stopOpacity="0.85" />
        </linearGradient>
        {/* glass top-face highlight */}
        <linearGradient id="ribbon-glass" x1="10" y1="6" x2="26" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* 3D ribbon "M" — one continuous folded stroke with joins mitered like bent glass */}
      <path
        d="M6 33 L6 11 Q6 8 9 9.5 L20 15.5 L31 9.5 Q34 8 34 11 L34 33"
        stroke="url(#ribbon-body)"
        strokeWidth="6.5"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
      {/* metallic chrome highlight running the same path, offset thinner */}
      <path
        d="M6 33 L6 11 Q6 8 9 9.5 L20 15.5 L31 9.5 Q34 8 34 11 L34 33"
        stroke="url(#ribbon-sheen)"
        strokeWidth="1.6"
        strokeLinejoin="miter"
        opacity="0.9"
      />
      {/* glass face reflection on the upper-left folds */}
      <path
        d="M8.2 12.5 Q8.2 10.5 10.2 11.6 L19 16.4 L27.8 11.6 Q29.8 10.5 29.8 12.5"
        stroke="url(#ribbon-glass)"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.8"
      />
      {/* center notch — the ribbon's fold-over seam at the M's valley */}
      <path d="M20 15.5 L20 20" stroke="#0a0a0c" strokeWidth="1.4" opacity="0.55" />
    </svg>
  );
}

export default RibbonM;
