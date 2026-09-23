"use client";

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface MotionLogoProps {
  /** Show the themed "Motion" wordmark beside the icon. */
  showWordmark?: boolean;
  size?: "sm" | "md" | "lg";
  /** Wrap in a link (defaults to home). Pass `null` for a static mark. */
  href?: string | null;
  className?: string;
}

/**
 * Icon now overflows its nominal box slightly (like a physical mark sitting on
 * the canvas) while the wordmark height keeps the lockup rhythm.
 */
const ICON_SIZES = { sm: 32, md: 44, lg: 56 } as const;
const WORDMARK_HEIGHTS = { sm: "h-5", md: "h-7", lg: "h-9" } as const;

/**
 * MotionLogo — official brand lockup.
 *
 * The liquid-glass mark (public/logo.png — transparent PNG, verified) renders
 * directly on the canvas: no background box, no border, no padding. The
 * wordmark swaps per theme via `dark:` classes without an extra request.
 */
export function MotionLogo({ showWordmark = true, size = "md", href = "/", className = "" }: MotionLogoProps) {
  const content = (
    <div className={cn("flex select-none items-center gap-3", className)}>
      {/* Glass mark, floating free on the canvas */}
      <Image
        alt="Motion Icon"
        className="object-contain drop-shadow-md transition-transform duration-300 hover:scale-105"
        height={ICON_SIZES[size]}
        priority
        src="/logo.png"
        width={ICON_SIZES[size]}
      />

      {/* Dynamic theme wordmark image */}
      {showWordmark && (
        <span className="relative flex items-center">
          {/* Light mode wordmark (dark text) */}
          {/* eslint-disable-next-line @next/next/no-img-element -- wordmark swaps per theme without layout shift */}
          <img
            src="/motion-wordmark-light.png"
            alt=""
            aria-hidden="true"
            className={cn("block w-auto object-contain dark:hidden", WORDMARK_HEIGHTS[size])}
          />
          {/* Dark mode wordmark (glowing white text) */}
          {/* eslint-disable-next-line @next/next/no-img-element -- wordmark swaps per theme without layout shift */}
          <img
            src="/motion-wordmark-dark.png"
            alt=""
            aria-hidden="true"
            className={cn("hidden w-auto object-contain dark:block", WORDMARK_HEIGHTS[size])}
          />
          <span className="sr-only">Motion</span>
        </span>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} aria-label="Motion — home" className="inline-flex">
        {content}
      </Link>
    );
  }

  return content;
}

export default MotionLogo;
