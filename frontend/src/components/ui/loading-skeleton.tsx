"use client";

import { cn } from "@/lib/utils";

interface LoadingSkeletonProps {
  className?: string;
}

export function LoadingSkeleton({ className }: LoadingSkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-xl bg-bg-tertiary border border-border",
        className
      )}
    />
  );
}

export function StatCardSkeleton() {
  return <LoadingSkeleton className="h-[120px]" />;
}

export function ChartSkeleton() {
  return <LoadingSkeleton className="h-[380px]" />;
}
