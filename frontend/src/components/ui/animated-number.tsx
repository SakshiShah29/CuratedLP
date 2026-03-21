"use client";

import { useEffect } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";

interface AnimatedNumberProps {
  value: number;
  className?: string;
  duration?: number;
  formatFn?: (n: number) => string;
}

export function AnimatedNumber({
  value,
  className,
  duration = 1.5,
  formatFn = (n) => n.toLocaleString(),
}: AnimatedNumberProps) {
  const count = useMotionValue(0);
  const display = useTransform(count, (v) => formatFn(Math.round(v)));

  useEffect(() => {
    const controls = animate(count, value, {
      duration,
      ease: "easeOut",
    });
    return controls.stop;
  }, [value, count, duration]);

  return <motion.span className={className}>{display}</motion.span>;
}
