"use client";

import { motion, useReducedMotion, type Variants } from "motion/react";
import type { ComponentProps, ReactNode } from "react";

const EASE = [0.23, 1, 0.32, 1] as const;

// The figure owns the one trigger; every mark inside inherits "hidden" → "shown" by variant propagation.
export function Figure({ children, className, ...rest }: { children: ReactNode; className?: string } & ComponentProps<"figure">) {
  const reduce = useReducedMotion();
  return (
    <motion.figure
      className={className}
      initial={reduce ? "shown" : "hidden"}
      whileInView="shown"
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      {...(rest as object)}
    >
      {children}
    </motion.figure>
  );
}

const grow: Variants = {
  hidden: { scaleX: 0 },
  shown: (delay: number = 0) => ({ scaleX: 1, transition: { duration: 0.7, ease: EASE, delay } }),
};

const rise: Variants = {
  hidden: { scaleY: 0 },
  shown: (delay: number = 0) => ({ scaleY: 1, transition: { duration: 0.7, ease: EASE, delay } }),
};

export function GrowRect({ delay = 0, vertical = false, ...rect }: { delay?: number; vertical?: boolean } & ComponentProps<"rect">) {
  return (
    <motion.rect
      {...(rect as object)}
      custom={delay}
      variants={vertical ? rise : grow}
      style={{ transformBox: "fill-box", transformOrigin: vertical ? "bottom" : "left" }}
    />
  );
}

const draw: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  shown: (delay: number = 0) => ({
    pathLength: 1,
    opacity: 1,
    transition: { pathLength: { duration: 0.9, ease: EASE, delay }, opacity: { duration: 0.01, delay } },
  }),
};

export function DrawPath({ delay = 0, ...path }: { delay?: number } & ComponentProps<"path">) {
  return <motion.path {...(path as object)} custom={delay} variants={draw} />;
}

const appear: Variants = {
  hidden: { opacity: 0 },
  shown: (delay: number = 0) => ({ opacity: 1, transition: { duration: 0.3, ease: EASE, delay } }),
};

export function Appear({ delay = 0, children, ...g }: { delay?: number; children?: ReactNode } & ComponentProps<"g">) {
  return (
    <motion.g {...(g as object)} custom={delay} variants={appear}>
      {children}
    </motion.g>
  );
}

export function AppearBlock({ delay = 0, children, className }: { delay?: number; children?: ReactNode; className?: string }) {
  return (
    <motion.div className={className} custom={delay} variants={appear}>
      {children}
    </motion.div>
  );
}
