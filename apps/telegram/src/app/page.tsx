"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { track } from "@/lib/core/analytics";

const SPLASH_DURATION = 2400; // ms - time before redirect

export default function SplashPage() {
  const router = useRouter();
  const hasRedirected = useRef(false);

  useEffect(() => {
    track("View /", { path: "/" });
  }, []);

  useEffect(() => {
    if (hasRedirected.current) return;
    hasRedirected.current = true;
    const timer = setTimeout(() => {
      router.replace("/telegram");
    }, SPLASH_DURATION);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{ background: "#16161a" }}
    >
      <svg
        width="240"
        height="70"
        viewBox="0 0 96 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="animate-logo"
      >
        {/* Red geometric shape */}
        <g className="animate-icon">
          <path
            d="M5.24998 24.4999L0 12.25H15.75V0L22.7499 12.25L24.4999 0L34.9999 27.9999L5.24998 24.4999Z"
            fill="#F9363C"
          />
        </g>

        {/* Eye (white + pupil) - blinks together */}
        <g className="animate-eye">
          <path
            d="M19.369 15.141C22.2645 15.2927 24.5052 17.45 24.3737 19.9595L13.8881 19.41C14.0196 16.9005 16.4735 14.9892 19.369 15.141Z"
            fill="white"
          />
          <mask
            id="mask0_splash"
            style={{ maskType: "alpha" }}
            maskUnits="userSpaceOnUse"
            x="13"
            y="15"
            width="12"
            height="5"
          >
            <path
              d="M19.3693 15.141C22.2648 15.2927 24.5054 17.45 24.3739 19.9595L13.8883 19.41C14.0199 16.9005 16.4737 14.9892 19.3693 15.141Z"
              fill="white"
            />
          </mask>
          <g mask="url(#mask0_splash)">
            <circle
              cx="19.2498"
              cy="17.4126"
              r="2.36249"
              transform="rotate(3 19.2498 17.4126)"
              fill="black"
            />
          </g>
        </g>

        {/* Text "loyal" - stroke draws, fill follows with delay */}
        <defs>
          <clipPath id="text-reveal">
            <rect className="text-reveal-rect" x="41" y="0" width="52" height="30" />
          </clipPath>
        </defs>

        {/* Stroke layer - draws left to right */}
        <g className="animate-text">
          <path
            className="text-stroke"
            d="M41.9846 7H45.1102V20.9674C45.1102 21.5779 45.452 21.9197 46.0625 21.9197H47.0393V24.3372H45.2567C43.3032 24.3372 41.9846 23.1162 41.9846 21.0895V7Z"
            stroke="white"
            strokeWidth="0.5"
            fill="none"
          />
          <path
            className="text-stroke"
            d="M53.6975 24.6304C49.8149 24.6304 47.2754 21.9688 47.2754 17.8665C47.2754 13.7642 49.8149 11.1025 53.6975 11.1025C57.5556 11.1025 60.0951 13.7642 60.0951 17.8665C60.0951 21.9688 57.5556 24.6304 53.6975 24.6304ZM50.5231 17.8665C50.5231 20.5281 51.6707 22.0909 53.6975 22.0909C55.6998 22.0909 56.8719 20.5281 56.8719 17.8665C56.8719 15.2049 55.6998 13.6421 53.6975 13.6421C51.6707 13.6421 50.5231 15.2049 50.5231 17.8665Z"
            stroke="white"
            strokeWidth="0.5"
            fill="none"
          />
          <path
            className="text-stroke"
            d="M59.4871 11.3955H62.515L65.9824 21.0652L69.3277 11.3955H72.3556L67.2033 25.7048C66.6417 27.292 65.5917 28.0001 63.858 28.0001H61.7336V25.6071H63.3208C64.0777 25.6071 64.444 25.3629 64.7126 24.7524L65.0789 23.8001H64.1754L59.4871 11.3955Z"
            stroke="white"
            strokeWidth="0.5"
            fill="none"
          />
          <path
            className="text-stroke"
            d="M72.1551 15.3514C72.6679 12.6409 74.7434 11.1025 77.9423 11.1025C81.6783 11.1025 83.6318 13.0316 83.6318 16.67V21.1141C83.6318 21.8467 83.9492 22.0665 84.4376 22.0665H84.9504V24.3374L84.2178 24.3618C83.2167 24.3862 81.1655 24.4106 80.9213 22.3595C80.3109 23.6537 78.8457 24.6304 76.5992 24.6304C73.9865 24.6304 71.9353 23.2385 71.9353 20.9432C71.9353 18.4525 73.8155 17.5979 76.8678 17.0118L80.4818 16.3037C80.4818 14.3014 79.6271 13.349 77.9423 13.349C76.5504 13.349 75.6469 14.106 75.3539 15.5223L72.1551 15.3514ZM75.183 20.8455C75.183 21.7246 75.9399 22.4327 77.4539 22.4327C79.212 22.4327 80.555 21.1386 80.555 18.599V18.4281L78.0888 18.8676C76.4527 19.1607 75.183 19.3804 75.183 20.8455Z"
            stroke="white"
            strokeWidth="0.5"
            fill="none"
          />
          <path
            className="text-stroke"
            d="M85.9453 7H89.0709V20.9674C89.0709 21.5779 89.4127 21.9197 90.0232 21.9197H90.9999V24.3372H89.2174C87.2639 24.3372 85.9453 23.1162 85.9453 21.0895V7Z"
            stroke="white"
            strokeWidth="0.5"
            fill="none"
          />
        </g>

        {/* Fill layer - reveals left to right with delay */}
        <g className="animate-text" clipPath="url(#text-reveal)">
          <path
            d="M41.9846 7H45.1102V20.9674C45.1102 21.5779 45.452 21.9197 46.0625 21.9197H47.0393V24.3372H45.2567C43.3032 24.3372 41.9846 23.1162 41.9846 21.0895V7Z"
            fill="white"
          />
          <path
            d="M53.6975 24.6304C49.8149 24.6304 47.2754 21.9688 47.2754 17.8665C47.2754 13.7642 49.8149 11.1025 53.6975 11.1025C57.5556 11.1025 60.0951 13.7642 60.0951 17.8665C60.0951 21.9688 57.5556 24.6304 53.6975 24.6304ZM50.5231 17.8665C50.5231 20.5281 51.6707 22.0909 53.6975 22.0909C55.6998 22.0909 56.8719 20.5281 56.8719 17.8665C56.8719 15.2049 55.6998 13.6421 53.6975 13.6421C51.6707 13.6421 50.5231 15.2049 50.5231 17.8665Z"
            fill="white"
          />
          <path
            d="M59.4871 11.3955H62.515L65.9824 21.0652L69.3277 11.3955H72.3556L67.2033 25.7048C66.6417 27.292 65.5917 28.0001 63.858 28.0001H61.7336V25.6071H63.3208C64.0777 25.6071 64.444 25.3629 64.7126 24.7524L65.0789 23.8001H64.1754L59.4871 11.3955Z"
            fill="white"
          />
          <path
            d="M72.1551 15.3514C72.6679 12.6409 74.7434 11.1025 77.9423 11.1025C81.6783 11.1025 83.6318 13.0316 83.6318 16.67V21.1141C83.6318 21.8467 83.9492 22.0665 84.4376 22.0665H84.9504V24.3374L84.2178 24.3618C83.2167 24.3862 81.1655 24.4106 80.9213 22.3595C80.3109 23.6537 78.8457 24.6304 76.5992 24.6304C73.9865 24.6304 71.9353 23.2385 71.9353 20.9432C71.9353 18.4525 73.8155 17.5979 76.8678 17.0118L80.4818 16.3037C80.4818 14.3014 79.6271 13.349 77.9423 13.349C76.5504 13.349 75.6469 14.106 75.3539 15.5223L72.1551 15.3514ZM75.183 20.8455C75.183 21.7246 75.9399 22.4327 77.4539 22.4327C79.212 22.4327 80.555 21.1386 80.555 18.599V18.4281L78.0888 18.8676C76.4527 19.1607 75.183 19.3804 75.183 20.8455Z"
            fill="white"
          />
          <path
            d="M85.9453 7H89.0709V20.9674C89.0709 21.5779 89.4127 21.9197 90.0232 21.9197H90.9999V24.3372H89.2174C87.2639 24.3372 85.9453 23.1162 85.9453 21.0895V7Z"
            fill="white"
          />
        </g>
      </svg>

      <style jsx>{`
        @keyframes fadeScaleIn {
          0% {
            opacity: 0;
            transform: scale(0.8);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes blink {
          0%,
          100% {
            transform: scaleY(1);
          }
          40%,
          60% {
            transform: scaleY(0.05);
          }
        }

        @keyframes eyeOpen {
          0% {
            transform: scaleY(0);
            opacity: 0;
          }
          100% {
            transform: scaleY(1);
            opacity: 1;
          }
        }

        @keyframes drawStroke {
          0% {
            stroke-dashoffset: 100;
          }
          100% {
            stroke-dashoffset: 0;
          }
        }

        @keyframes revealFill {
          0% {
            width: 0;
          }
          100% {
            width: 52px;
          }
        }

        .animate-logo {
          opacity: 0;
          animation: fadeScaleIn 0.5s ease-out 0.1s forwards;
        }

        .animate-icon {
          transform-origin: 17px 14px;
        }

        .animate-eye {
          transform-origin: 19px 17.5px;
          opacity: 0;
          animation: eyeOpen 0.3s ease-out 0.4s forwards,
            blink 1.2s ease-in-out 1.2s infinite;
        }

        .animate-text {
          opacity: 0;
          animation: fadeScaleIn 0.3s ease-out 0.2s forwards;
        }

        .text-stroke {
          stroke-dasharray: 100;
          stroke-dashoffset: 100;
          animation: drawStroke 0.8s ease-out 0.4s forwards;
        }

        .text-reveal-rect {
          width: 0;
          animation: revealFill 0.8s ease-out 0.55s forwards;
        }
      `}</style>
    </div>
  );
}
