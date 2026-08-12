"use client";

import Image from "next/image";
import Link from "next/link";

import { Footer } from "@/components/footer";

export default function NotFound() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: "#FFFFFF",
      }}
    >
      {/* Main content */}
      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          padding: "120px 16px 64px",
          maxWidth: "1200px",
          margin: "0 auto",
          width: "100%",
        }}
      >
        <div>
          <div>
            {/* Logotype */}
            <div style={{ marginBottom: "80px" }}>
              <Link href="/">
                <Image
                  alt="Loyal"
                  height={20}
                  priority
                  src="/hero-new/Logotype.svg"
                  width={48}
                />
              </Link>
            </div>

            {/* Heading */}
            <h1
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "36px",
                fontWeight: 600,
                lineHeight: 1.3,
                margin: 0,
              }}
            >
              <span style={{ color: "#F9363C" }}>404</span>
              <span style={{ color: "#000000" }}> is never the end</span>
            </h1>
            <p
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "36px",
                fontWeight: 500,
                lineHeight: 1.3,
                margin: 0,
                color: "#000000",
              }}
            >
              It&apos;s a way{" "}
              <Link
                href="/"
                style={{
                  color: "#000000",
                  textDecoration: "underline",
                  textUnderlineOffset: "4px",
                  textDecorationColor: "#F9363C",
                  textDecorationThickness: "3px",
                }}
              >
                home
              </Link>
              {" "}
              <Image
                alt="Loyal dog"
                height={36}
                priority
                src="/hero-new/dog-excited.svg"
                style={{
                  display: "inline-block",
                  verticalAlign: "middle",
                  marginBottom: "4px",
                }}
                width={45}
              />
            </p>
          </div>
        </div>
      </main>

      <Footer />

    </div>
  );
}
