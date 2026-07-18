import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "pux.sh — know why your build failed before you open GitHub";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          backgroundColor: "#0a0a0a",
          padding: "60px",
        }}
      >
        <pre
          style={{
            fontSize: 48,
            color: "#22d3ee",
            fontFamily: "monospace",
            marginBottom: 24,
          }}
        >
          {` /\\_/\\\n( o.o )\n > ^ <`}
        </pre>
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            color: "#e4e4e7",
            fontFamily: "monospace",
            marginBottom: 16,
          }}
        >
          pux.sh
        </div>
        <div
          style={{
            fontSize: 28,
            color: "#71717a",
            fontFamily: "monospace",
            textAlign: "center",
            maxWidth: 800,
          }}
        >
          know why your build failed before you open GitHub
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: 48,
            backgroundColor: "#141414",
            border: "1px solid #2a2a2a",
            borderRadius: 12,
            padding: "16px 32px",
          }}
        >
          <span style={{ color: "#71717a", fontSize: 24, fontFamily: "monospace" }}>
            $ npm install -g pux.sh
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
