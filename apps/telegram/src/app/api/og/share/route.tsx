import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

export const runtime = "nodejs";

async function loadGoogleFont(font: string, weight: number, text: string) {
  const url = `https://fonts.googleapis.com/css2?family=${font}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const resource = css.match(
    /src: url\((.+)\) format\('(opentype|truetype)'\)/
  );

  if (resource) {
    const response = await fetch(resource[1]);
    if (response.status === 200) {
      return await response.arrayBuffer();
    }
  }

  throw new Error("failed to load font data");
}

const formatUsd = (value: string | null) => {
  if (!value) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return `≈$${value}`;
  return `≈$${parsed.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const truncateAddress = (value: string, maxLength = 12) => {
  if (value.length <= maxLength) return value;
  const side = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, side)}…${value.slice(-side)}`;
};

const formatSol = (value: string | null, secure?: boolean) => {
  if (!value) return null;
  const label = secure ? "Secure SOL" : "SOL";
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return `${value} ${label}`;
  return `+${parsed.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })} ${label}`;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sender = truncateAddress(
      searchParams.get("sender") || "@username"
    );
    const receiver = truncateAddress(
      searchParams.get("receiver") || "2fKB…Nhtj"
    );
    const solAmount = searchParams.get("solAmount");
    const usdAmount = searchParams.get("usdAmount");
    const secure = searchParams.get("secure") === "1";

    const solText = formatSol(solAmount, secure) || "+15.0988 SOL";
    const usdText = formatUsd(usdAmount) || "≈$2,869.77";

    const allText = `You receivedLoyal${solText}${usdText}FromTo${sender}${receiver}`;

    const [fontRegular, fontMedium, fontSemiBold, backgroundData] =
      await Promise.all([
        loadGoogleFont("Geist", 400, allText),
        loadGoogleFont("Geist", 500, allText),
        loadGoogleFont("Geist", 600, allText),
        readFile(join(process.cwd(), "public/share/BG.png")),
      ]);

    const backgroundBase64 = `data:image/png;base64,${backgroundData.toString("base64")}`;

    return new ImageResponse(
      (
        <div
          style={{
            width: 1200,
            height: 630,
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "56px 56px 60px 56px",
            fontFamily: "Geist",
          }}
        >
          {/* Background image */}
          <img
            src={backgroundBase64}
            alt=""
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 1200,
              height: 630,
            }}
          />

          {/* Top section */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              zIndex: 1,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "20px",
              }}
            >
              {/* Red circle icon with arrow */}
              <div
                style={{
                  width: 72,
                  height: 72,
                  background: "#FF3347",
                  borderRadius: 120,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 16,
                }}
              >
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 47 47"
                  fill="none"
                >
                  <path
                    d="M23.4424 39.0708L23.4424 7.81372"
                    stroke="white"
                    stroke-width="4.69"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M35.0713 27.4424L23.4427 39.0711L11.814 27.4424"
                    stroke="white"
                    stroke-width="4.69"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </div>
              <span
                style={{
                  fontWeight: 500,
                  fontSize: "47px",
                  lineHeight: 1,
                  color: "black",
                  letterSpacing: "-0.47px",
                }}
              >
                You received
              </span>
            </div>
            <span
              style={{
                fontWeight: 500,
                fontSize: "57px",
                lineHeight: 1,
                color: "black",
                letterSpacing: "-0.57px",
              }}
            >
              Loyal
            </span>
          </div>

          {/* Bottom section */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "44px",
              zIndex: 1,
            }}
          >
            {/* Amount section */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "24px",
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "86px",
                  lineHeight: 1,
                  color: "black",
                  letterSpacing: "-0.86px",
                }}
              >
                {solText}
              </div>
              <div
                style={{
                  fontSize: "40px",
                  lineHeight: 1,
                  color: "black",
                  opacity: 0.5,
                }}
              >
                {usdText}
              </div>
            </div>

            {/* From/To section - stacked vertically */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "28px",
                maxWidth: 640,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: "32px",
                    lineHeight: 1,
                    color: "black",
                    opacity: 0.5,
                    letterSpacing: "-0.32px",
                  }}
                >
                  From
                </div>
                <div
                  style={{
                    fontSize: "44px",
                    lineHeight: 1,
                    color: "black",
                  }}
                >
                  {sender}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: "32px",
                    lineHeight: 1,
                    color: "black",
                    opacity: 0.5,
                    letterSpacing: "-0.32px",
                  }}
                >
                  To
                </div>
                <div
                  style={{
                    fontSize: "44px",
                    lineHeight: 1,
                    color: "black",
                  }}
                >
                  {receiver}
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        fonts: [
          {
            name: "Geist",
            data: fontRegular,
            style: "normal",
            weight: 400,
          },
          {
            name: "Geist",
            data: fontMedium,
            style: "normal",
            weight: 500,
          },
          {
            name: "Geist",
            data: fontSemiBold,
            style: "normal",
            weight: 600,
          },
        ],
      }
    );
  } catch (e) {
    console.error("OG Image generation failed:", e);
    return new Response("Failed to generate the image", {
      status: 500,
    });
  }
}
