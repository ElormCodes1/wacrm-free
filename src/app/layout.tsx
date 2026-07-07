import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import { DEFAULT_MODE, MODE_STORAGE_KEY, MODES } from "@/lib/themes";

export const metadata: Metadata = {
  title: {
    default: "wacrm",
    template: "%s — wacrm",
  },
  description: "Self-hostable CRM template for WhatsApp.",
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: [{ url: "/icon" }],
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0B141A",
  colorScheme: "dark light",
};

// Inline boot script — runs before React hydrates so the user's
// chosen mode (data-mode) is on the <html> element before first
// paint. Without this every page load flashes the server-rendered
// default for a frame before the React tree mounts and applies the
// picked value.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid ids is
// sourced from the MODES constant so adding one doesn't silently
// break the boot path. (The WhatsApp teal accent is fixed in CSS, so
// there's no accent axis to replay here.)
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MODE_DEFAULT = ${JSON.stringify(DEFAULT_MODE)};
    var MODES = ${JSON.stringify(MODES)};
    var savedMode = localStorage.getItem(MODE_KEY);
    d.dataset.mode = MODES.indexOf(savedMode) !== -1 ? savedMode : MODE_DEFAULT;
  } catch (_e) {
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-mode={DEFAULT_MODE}
      className="h-full antialiased"
      // The `theme-boot` script below rewrites `data-mode` on <html>
      // from localStorage before React hydrates, so for any non-default
      // choice the client DOM intentionally differs from the
      // server-rendered default. suppressHydrationWarning silences the
      // expected mismatch — it only applies to this element's own
      // attributes, so genuine mismatches in children still surface.
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <ThemeProvider>
          {children}
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
