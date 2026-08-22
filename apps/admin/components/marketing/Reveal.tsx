'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Public website polish (this date). A dependency-free scroll-reveal wrapper: one
 * IntersectionObserver per instance, disconnected the moment it fires (never re-observes, never
 * re-hides on scroll-away -- a marketing page should settle, not flicker). Motion is plain CSS
 * opacity/transform driven by a single boolean class flip, so app/globals.css's existing global
 * `prefers-reduced-motion: reduce` rule (forces every animation/transition-duration to ~0) already
 * neutralizes this automatically -- no separate reduced-motion branch needed here.
 */
export function Reveal({
  children,
  className = '',
  delayMs = 0,
}: {
  children: ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: visible ? `${delayMs}ms` : '0ms' }}
      className={`transition-all duration-700 ease-out ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
      } ${className}`}
    >
      {children}
    </div>
  );
}
