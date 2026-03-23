"use client";

import { motion } from "motion/react";

import { TrackedExternalLink } from "@/components/analytics/tracked-external-link";
import { usePublicEnv } from "@/contexts/public-env-context";
import { trackFrontendLinkClick } from "@/lib/core/analytics";

const socialLinks = [
  {
    name: "X",
    url: "https://x.com/loyal_hq",
    icon: (
      <svg
        fill="currentColor"
        height="20"
        viewBox="0 0 24 24"
        width="20"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    name: "Email",
    url: "mailto:main@askloyal.com",
    icon: (
      <svg
        fill="currentColor"
        height="20"
        viewBox="0 0 24 24"
        width="20"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
      </svg>
    ),
  },
  {
    name: "Telegram",
    url: "https://t.me/loyal_tgchat",
    icon: (
      <svg
        fill="currentColor"
        height="20"
        viewBox="0 0 24 24"
        width="20"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
      </svg>
    ),
  },
  {
    name: "Discord",
    url: "https://discord.askloyal.com",
    icon: (
      <svg
        fill="currentColor"
        height="20"
        viewBox="0 0 24 24"
        width="20"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    ),
  },
  {
    name: "GitHub",
    url: "https://github.com/loyal-labs",
    icon: (
      <svg
        fill="currentColor"
        height="20"
        viewBox="0 0 24 24"
        width="20"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
      </svg>
    ),
  },
];

const legalLinks = [
  {
    name: "Trade $LOYAL on Jupiter",
    url: "https://jup.ag/tokens/LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta",
  },
  { name: "Join Discord community", url: "https://discord.askloyal.com" },
  { name: "Join Telegram community", url: "https://t.me/loyal_tgchat" },
  {
    name: "Q4 2025 Report",
    url: "/Loyal_Public_Transparency_Report_Q4_2025.pdf",
  },
];

export function Footer() {
  const publicEnv = usePublicEnv();

  return (
    <footer
      id="footer-section"
      style={{
        background: "#FFFFFF",
        borderTop: "1px solid rgba(0, 0, 0, 0.08)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        className="footer-content"
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "64px 16px 32px",
        }}
      >
        {/* Social Links */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "32px",
            marginBottom: "48px",
          }}
        >
          {socialLinks.map((link) => (
            <motion.a
              aria-label={link.name}
              href={link.url}
              key={link.name}
              onClick={() => {
                trackFrontendLinkClick(publicEnv, {
                  href: link.url,
                  linkText: link.name,
                  source: "footer_social",
                });
              }}
              rel="noopener noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "48px",
                height: "48px",
                flexShrink: 0,
                borderRadius: "9999px",
                background: "rgba(249, 54, 60, 0.08)",
                color: "rgba(60, 60, 67, 0.6)",
                transition: "all 0.3s ease",
                textDecoration: "none",
              }}
              target="_blank"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              {link.icon}
            </motion.a>
          ))}
        </div>

        {/* Regular Links */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "32px",
            flexWrap: "wrap",
            marginBottom: "48px",
          }}
        >
          {legalLinks.map((link) => (
            <TrackedExternalLink
              href={link.url}
              key={link.name}
              linkText={link.name}
              source="footer_link"
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "16px",
                fontWeight: 400,
                lineHeight: "20px",
                color: "rgba(60, 60, 67, 0.6)",
                fontFeatureSettings: "'liga' off, 'clig' off",
                textDecoration: "none",
                transition: "color 0.2s ease",
              }}
              target="_blank"
            >
              {link.name}
            </TrackedExternalLink>
          ))}
        </div>

        {/* Stay Loyal + Copyright wrapper */}
        <div
          style={{
            position: "relative",
          }}
        >
          {/* Stay Loyal - large background text */}
          <div
            style={{
              position: "relative",
              overflow: "hidden",
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "clamp(6rem, 16vw, 220px)",
                fontWeight: 700,
                textAlign: "center",
                color: "rgba(249, 54, 60, 0.08)",
                lineHeight: 0.85,
                margin: 0,
                letterSpacing: "-0.02em",
                paddingBottom: "48px",
              }}
            >
              Stay Loyal
            </h2>
            {/* Gradient fade to white at bottom */}
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "40%",
                background:
                  "linear-gradient(to bottom, transparent, #FFFFFF)",
                pointerEvents: "none",
              }}
            />
          </div>

          {/* Copyright and Status */}
          <div
            id="footer-copyright"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "14px",
              fontWeight: 400,
              lineHeight: "20px",
              color: "rgba(60, 60, 67, 0.6)",
              paddingTop: "16px",
              flexWrap: "wrap",
              gap: "16px",
            }}
          >
            <div>© {new Date().getFullYear()} Loyal. All rights reserved.</div>
            <iframe
              frameBorder="0"
              height="30"
              scrolling="no"
              src="https://status.askloyal.com/badge?theme=light"
              style={{
                colorScheme: "normal",
                border: "none",
              }}
              title="Status Badge"
              width="250"
            />
          </div>
        </div>
      </div>
      <style jsx>{`
        @media (max-width: 767px) {
          .footer-content {
            padding-bottom: 12rem !important;
          }
        }
      `}</style>
    </footer>
  );
}
