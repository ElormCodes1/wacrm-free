import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import { DEFAULT_MODE, MODE_STORAGE_KEY } from "@/lib/themes";

export const metadata: Metadata = {
  title: {
    default: "WaCRM",
    template: "%s — WaCRM",
  },
  description: "A self-hosted WhatsApp CRM.",
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

// Inline boot script — runs before React hydrates so the resolved mode
// (data-mode) is on the <html> element before first paint. Without this
// every page load flashes a default for a frame before React mounts.
//
// It reads the stored PREFERENCE ("system" | "light" | "dark"); an
// explicit light/dark is used as-is, while "system" (or a missing value)
// resolves against the OS via prefers-color-scheme. Kept dependency-free
// (no imports, no JSX) so the browser can run it as a single <script>.
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    var pref = localStorage.getItem(${JSON.stringify(MODE_STORAGE_KEY)});
    var mode;
    if (pref === "light" || pref === "dark") {
      mode = pref;
    } else {
      mode = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    d.dataset.mode = mode;
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
      className="h-full antialiased"
      // `data-mode` is intentionally NOT set here as a JSX prop: the
      // `theme-boot` script sets it before hydration and the
      // ThemeProvider owns it thereafter. Rendering it as a literal prop
      // would make React reconcile it back to that literal on client
      // navigations — the "theme reverts to dark on navigate" bug.
      // suppressHydrationWarning silences the expected server/client
      // difference on this element's own attributes; genuine mismatches
      // in children still surface.
      suppressHydrationWarning
    >
      <head>
        {/*
          Plain synchronous inline script — the browser runs it while
          parsing <head>, BEFORE it paints the body, so the resolved
          mode is on <html> for the very first frame (no dark→light
          flash on reload). Deliberately NOT next/script: its
          `beforeInteractive` strategy does not guarantee pre-paint
          execution in the App Router, which caused the flash.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
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
