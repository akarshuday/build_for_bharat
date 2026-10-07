import { useEffect, useRef, useState } from 'react';

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** Counts from 0 to `target` once the element scrolls into view. */
export function useCountUp(target: number, index = 0) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    let raf = 0;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        obs.disconnect();
        const duration = 1500 + index * 80;
        let start: number | null = null;
        const tick = (now: number) => {
          if (start === null) start = now;
          const p = Math.min((now - start) / duration, 1);
          setValue(target * ease(p));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.25 }
    );
    obs.observe(el);
    return () => { obs.disconnect(); cancelAnimationFrame(raf); };
  }, [target, index]);

  return { ref, value };
}
