import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

export const runtime = "nodejs";

type ThemeVariant = "black" | "white" | "red";

const THEME_CONFIG: Record<
  ThemeVariant,
  {
    bg: string;
    dogPrefix: string;
    textColor: string;
    dateOpacity: number;
    brandKey: "brandDark" | "brandRed" | "brandWhite";
  }
> = {
  black: {
    bg: "bg_black.png",
    dogPrefix: "Dark",
    textColor: "#FFFFFF",
    dateOpacity: 0.6,
    brandKey: "brandDark",
  },
  white: {
    bg: "bg_white.png",
    dogPrefix: "Red",
    textColor: "#000000",
    dateOpacity: 0.6,
    brandKey: "brandWhite",
  },
  red: {
    bg: "bg_red.png",
    dogPrefix: "Red",
    textColor: "#FFFFFF",
    dateOpacity: 0.8,
    brandKey: "brandRed",
  },
};

const THEMES: ThemeVariant[] = ["black", "white", "red"];
const DOG_VARIANTS = Array.from({ length: 21 }, (_, i) =>
  String(i + 1).padStart(2, "0")
);

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

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3).trimEnd() + "...";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const text = searchParams.get("text") || "";
    const date = searchParams.get("date") || "";
    const imagesParam = searchParams.get("images") || "";
    const brandUrls = {
      brandDark: searchParams.get("brandDark") || "",
      brandRed: searchParams.get("brandRed") || "",
      brandWhite: searchParams.get("brandWhite") || "",
    };

    const imageUrls = imagesParam
      ? imagesParam
          .split(",")
          .map((u) => u.trim())
          .filter(Boolean)
      : [];

    const truncatedText = truncateText(text, 200);

    // Randomize theme and dog variant
    const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
    const dogVariant =
      DOG_VARIANTS[Math.floor(Math.random() * DOG_VARIANTS.length)];
    const config = THEME_CONFIG[theme];

    // Strip {img} markers for font loading
    const plainText = truncatedText.replace(/\{img\}/g, " ");
    const allText = `${date}Summary${plainText}`;

    // Select brand URL based on theme
    const brandUrl = brandUrls[config.brandKey];

    const [fontMedium, fontRegular, backgroundData, dogData] = await Promise.all([
      loadGoogleFont("Geist", 500, allText),
      loadGoogleFont("Geist", 400, "Summary"),
      readFile(join(process.cwd(), `public/share_summary/bgs/${config.bg}`)),
      readFile(
        join(
          process.cwd(),
          `public/share_summary/dogs/${config.dogPrefix}${dogVariant}.png`
        )
      ),
    ]);

    const backgroundBase64 = `data:image/png;base64,${backgroundData.toString("base64")}`;
    const dogBase64 = `data:image/png;base64,${dogData.toString("base64")}`;

    // Parse text with {img} placeholders into interleaved words and images
    const textSegments = truncatedText.split("{img}");
    const IMG_SIZE = 52;

    const inlineElements: { type: "word" | "image"; value: string }[] = [];
    let imgIdx = 0;
    for (let i = 0; i < textSegments.length; i++) {
      const words = textSegments[i].split(/\s+/).filter(Boolean);
      for (const word of words) {
        inlineElements.push({ type: "word", value: word });
      }
      if (i < textSegments.length - 1 && imgIdx < imageUrls.length) {
        inlineElements.push({ type: "image", value: imageUrls[imgIdx] });
        imgIdx++;
      }
    }

    return new ImageResponse(
      (
        <div
          style={{
            width: 1200,
            height: 630,
            position: "relative",
            display: "flex",
            fontFamily: "Geist",
          }}
        >
          {/* Background */}
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

          {/* Date - top right */}
          <div
            style={{
              position: "absolute",
              top: 56,
              right: 56,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              color: config.textColor,
            }}
          >
            <div
              style={{
                fontSize: 56,
                fontWeight: 500,
                lineHeight: 1.2,
                letterSpacing: "-1.12px",
              }}
            >
              {date}
            </div>
            <div
              style={{
                fontSize: 30,
                fontWeight: 400,
                lineHeight: 1,
                opacity: config.dateOpacity,
                marginTop: 2,
              }}
            >
              Summary
            </div>
          </div>

          {/* Main text with inline images */}
          <div
            style={{
              position: "absolute",
              top: 56,
              left: 56,
              width: 750,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 0,
              fontWeight: 500,
              fontSize: 56,
              lineHeight: 1.2,
              letterSpacing: "-1.12px",
              color: config.textColor,
            }}
          >
            {inlineElements.map((el, idx) =>
              el.type === "word" ? (
                <span key={idx} style={{ marginRight: 16 }}>
                  {el.value}
                </span>
              ) : (
                <img
                  key={idx}
                  src={el.value}
                  alt=""
                  style={{
                    width: IMG_SIZE,
                    height: IMG_SIZE,
                    borderRadius: IMG_SIZE / 2,
                    objectFit: "cover",
                    marginLeft: 4,
                    marginRight: 16,
                  }}
                />
              )
            )}
          </div>

          {/* Dog mascot */}
          <img
            src={dogBase64}
            alt=""
            style={{
              position: "absolute",
              bottom: 0,
              right: 0,
              width: 450,
              height: 450,
              objectFit: "contain",
              objectPosition: "bottom right",
            }}
          />

          {/* Brand - bottom left (only if provided) */}
          {brandUrl && (
            <img
              src={brandUrl}
              alt=""
              style={{
                position: "absolute",
                bottom: 47,
                left: 56,
                height: 56,
              }}
            />
          )}
        </div>
      ),
      {
        width: 1200,
        height: 630,
        fonts: [
          {
            name: "Geist",
            data: fontMedium,
            style: "normal",
            weight: 500,
          },
          {
            name: "Geist",
            data: fontRegular,
            style: "normal",
            weight: 400,
          },
        ],
      }
    );
  } catch (e) {
    console.error("OG Summary Image generation failed:", e);
    return new Response("Failed to generate the image", {
      status: 500,
    });
  }
}
