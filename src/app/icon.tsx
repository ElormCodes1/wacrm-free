import { ImageResponse } from "next/og";

// Replaces the default Next.js favicon with the brand mark — a teal→green
// rounded square with three ascending white bars (the "growth" motif from
// the BrandLogo in `src/components/layout/brand-logo.tsx`). Next.js renders
// this at build time and auto-injects <link rel="icon"> into <head>.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 3,
          padding: "0 0 9px",
          background: "linear-gradient(135deg, #25D366, #00A884)",
          borderRadius: 7,
        }}
      >
        {[8, 13, 18].map((h) => (
          <div
            key={h}
            style={{ width: 4, height: h, borderRadius: 2, background: "#ffffff" }}
          />
        ))}
      </div>
    ),
    { ...size },
  );
}
