"use client";

import Image from "next/image";
import { memo, useEffect, useState } from "react";

import { TrackedExternalLink } from "@/components/analytics/tracked-external-link";

interface BlogPost {
  title: string;
  link: string;
  pubDate: string;
  image: string | null;
}

const SKELETON_KEYS = ["skeleton-0", "skeleton-1", "skeleton-2"];

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function BlogSectionComponent() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/blog")
      .then((res) => res.json())
      .then((data) => {
        setPosts(data.posts ?? []);
      })
      .catch(() => {
        // Silently fail - section just won't show
      })
      .finally(() => setIsLoading(false));
  }, []);

  if (!isLoading && posts.length === 0) {
    return null;
  }

  return (
    <section
      id="blog-section"
      style={{
        padding: "64px 16px",
        background: "#FFFFFF",
        position: "relative",
      }}
    >
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <h2
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "48px",
            fontWeight: 600,
            lineHeight: "48px",
            letterSpacing: "-0.96px",
            color: "#000",
            textAlign: "center",
            marginBottom: "20px",
          }}
        >
          Blog
        </h2>
        <p
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "24px",
            fontWeight: 400,
            lineHeight: "28px",
            color: "rgba(60, 60, 67, 0.6)",
            textAlign: "center",
            maxWidth: "500px",
            margin: "0 auto",
            marginBottom: "48px",
          }}
        >
          Latest from our team
        </p>

        <div
          className="blog-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "20px",
          }}
        >
          {isLoading
            ? SKELETON_KEYS.map((key) => (
                <div
                  key={key}
                  style={{
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "386.67 / 242",
                      background: "#F5F5F5",
                      borderRadius: "24px",
                      animation: "pulse 2s ease-in-out infinite",
                    }}
                  />
                  <div style={{ padding: "20px 32px 16px 0" }}>
                    <div
                      style={{
                        height: "20px",
                        width: "80%",
                        background: "#F5F5F5",
                        borderRadius: "8px",
                        marginBottom: "12px",
                        animation: "pulse 2s ease-in-out infinite",
                      }}
                    />
                    <div
                      style={{
                        height: "16px",
                        width: "35%",
                        background: "#F5F5F5",
                        borderRadius: "6px",
                        animation: "pulse 2s ease-in-out infinite",
                      }}
                    />
                  </div>
                </div>
              ))
            : posts.map((post) => (
                <TrackedExternalLink
                  className="blog-card"
                  href={post.link}
                  key={post.link}
                  linkText={post.title}
                  source="blog_card"
                  style={{
                    display: "block",
                    textDecoration: "none",
                    overflow: "hidden",
                    transition: "all 0.3s ease",
                    cursor: "pointer",
                  }}
                  target="_blank"
                >
                  {post.image && (
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: "386.67 / 242",
                        overflow: "hidden",
                        position: "relative",
                        borderRadius: "24px",
                        border: "1px solid rgba(0, 0, 0, 0.08)",
                      }}
                    >
                      <Image
                        alt={post.title}
                        fill
                        sizes="(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 33vw"
                        src={post.image}
                        style={{
                          objectFit: "cover",
                          transition: "transform 0.3s ease",
                        }}
                        unoptimized
                      />
                    </div>
                  )}
                  <div
                    style={{
                      padding: "20px 32px 16px 0",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                  >
                    <h3
                      style={{
                        fontFamily: "var(--font-geist-sans), sans-serif",
                        fontSize: "20px",
                        fontWeight: 500,
                        lineHeight: "24px",
                        color: "#000",
                        fontFeatureSettings: "'liga' off, 'clig' off",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        margin: 0,
                      }}
                    >
                      {post.title}
                    </h3>
                    <span
                      style={{
                        fontFamily: "var(--font-geist-sans), sans-serif",
                        fontSize: "16px",
                        fontWeight: 400,
                        lineHeight: "20px",
                        color: "rgba(60, 60, 67, 0.6)",
                        fontFeatureSettings: "'liga' off, 'clig' off",
                      }}
                    >
                      {formatDate(post.pubDate)}
                    </span>
                  </div>
                </TrackedExternalLink>
              ))}
        </div>
      </div>
      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .blog-card:hover {
          transform: translateY(-4px);
        }
        .blog-card:hover img {
          transform: scale(1.05);
        }
        @media (max-width: 767px) {
          .blog-grid {
            grid-template-columns: 1fr !important;
            gap: 16px !important;
          }
        }
        @media (min-width: 768px) and (max-width: 1023px) {
          .blog-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
      `}</style>
    </section>
  );
}

export const BlogSection = memo(BlogSectionComponent);
