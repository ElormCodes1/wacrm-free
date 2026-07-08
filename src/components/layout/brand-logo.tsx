import { cn } from "@/lib/utils";

/**
 * Brand mark for the app: a rounded speech bubble (WhatsApp identity)
 * holding three ascending bars (CRM growth / pipeline), in the app's
 * teal→green gradient. Self-contained SVG so it scales crisply and can be
 * reused in the sidebar, login, and empty states.
 */
export function BrandLogo({ className }: { className?: string }) {
  // Unique gradient id per render isn't needed — a stable id is fine since
  // the gradient definition is identical wherever the logo appears.
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="Logo"
      className={cn("h-8 w-8", className)}
    >
      <defs>
        <linearGradient id="brandLogoGradient" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#25D366" />
          <stop offset="1" stopColor="#00A884" />
        </linearGradient>
      </defs>
      {/* Rounded badge */}
      <rect x="0" y="0" width="32" height="32" rx="9" fill="url(#brandLogoGradient)" />
      {/* Speech bubble with a downward tail, drawn as a white cutout */}
      <path
        d="M9 7.5h14a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5h-6.3L12 24.5V23H9a2.5 2.5 0 0 1-2.5-2.5V10A2.5 2.5 0 0 1 9 7.5Z"
        fill="#FFFFFF"
      />
      {/* Ascending bars inside the bubble — chat that grows (CRM) */}
      <g fill="url(#brandLogoGradient)">
        <rect x="10.5" y="15.5" width="2.6" height="3.5" rx="1.3" />
        <rect x="14.7" y="13" width="2.6" height="6" rx="1.3" />
        <rect x="18.9" y="10.5" width="2.6" height="8.5" rx="1.3" />
      </g>
    </svg>
  );
}
