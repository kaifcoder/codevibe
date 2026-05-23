import { ImageResponse } from "next/og";

export const runtime = "edge";

// Next.js convention: this filename auto-registers as the og:image and
// twitter:image for the root layout. 1200×630 is the canonical OG size.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "CodeVibe — Build apps with AI in your browser";

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "80px",
          background:
            "linear-gradient(135deg, #0a0a0a 0%, #111827 50%, #1e293b 100%)",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "16px",
              background:
                "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)",
              boxShadow: "0 0 60px rgba(59, 130, 246, 0.5)",
            }}
          />
          <div style={{ fontSize: "36px", fontWeight: 600 }}>CodeVibe</div>
        </div>
        <div
          style={{
            fontSize: "72px",
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            maxWidth: "900px",
          }}
        >
          Build apps with AI in your browser.
        </div>
        <div
          style={{
            fontSize: "28px",
            color: "#94a3b8",
            marginTop: "32px",
            maxWidth: "900px",
          }}
        >
          Describe an app. Get a working Next.js project in a live sandbox.
        </div>
      </div>
    ),
    { ...size },
  );
}
