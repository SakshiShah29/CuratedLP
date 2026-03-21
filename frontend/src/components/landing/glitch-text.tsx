"use client";

import { cn } from "@/lib/utils";

interface GlitchTextProps {
  text: string;
  className?: string;
}

export function GlitchText({ text, className }: GlitchTextProps) {
  return (
    <>
      <span
        className={cn("glitch-text", className)}
        data-text={text}
      >
        {text}
      </span>

      <style>{`
        .glitch-text {
          position: relative;
          display: inline-block;
          color: #A7EF9E;
          text-shadow:
            0 0 10px rgba(167, 239, 158, 0.6),
            0 0 40px rgba(167, 239, 158, 0.3),
            0 0 80px rgba(167, 239, 158, 0.1);
        }

        .glitch-text::before,
        .glitch-text::after {
          content: attr(data-text);
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }

        .glitch-text::before {
          color: #6BC5F8;
          z-index: -1;
          animation: glitch-shift-1 4s infinite linear alternate-reverse;
        }

        .glitch-text::after {
          color: #FF6B6B;
          z-index: -2;
          animation: glitch-shift-2 3s infinite linear alternate-reverse;
        }

        @keyframes glitch-shift-1 {
          0%, 85% {
            clip-path: inset(0 0 0 0);
            transform: translate(0);
          }
          86% {
            clip-path: inset(20% 0 60% 0);
            transform: translate(-4px, 0);
          }
          88% {
            clip-path: inset(70% 0 10% 0);
            transform: translate(3px, 0);
          }
          90% {
            clip-path: inset(40% 0 30% 0);
            transform: translate(-2px, 0);
          }
          92% {
            clip-path: inset(0 0 0 0);
            transform: translate(0);
          }
          100% {
            clip-path: inset(0 0 0 0);
            transform: translate(0);
          }
        }

        @keyframes glitch-shift-2 {
          0%, 80% {
            clip-path: inset(0 0 0 0);
            transform: translate(0);
          }
          81% {
            clip-path: inset(60% 0 20% 0);
            transform: translate(3px, 0);
          }
          83% {
            clip-path: inset(10% 0 70% 0);
            transform: translate(-3px, 0);
          }
          85% {
            clip-path: inset(30% 0 40% 0);
            transform: translate(2px, 0);
          }
          87% {
            clip-path: inset(0 0 0 0);
            transform: translate(0);
          }
          100% {
            clip-path: inset(0 0 0 0);
            transform: translate(0);
          }
        }
      `}</style>
    </>
  );
}
