'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * Entrance animation wrapper.
 *
 * Framer Motion is a client-side library, so every animated surface has to be a
 * client component. Isolating the animation here keeps the pages themselves
 * server components — a dashboard that ships its scoring data as client-side
 * props would put provider payloads in the browser bundle.
 *
 * `useReducedMotion` is not decoration: on a dashboard where dozens of cards
 * enter at once, the honoured OS setting is the difference between "premium" and
 * "unusable" for motion-sensitive users. The CSS in `globals.css` covers
 * declarative animations; this covers the JS-driven ones.
 */
export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** Seconds to wait before starting — stagger a list by passing index * 0.04. */
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduced ? 0 : 0.4,
        delay: reduced ? 0 : delay,
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
