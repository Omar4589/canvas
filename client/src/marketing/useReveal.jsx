import { useEffect, useRef } from 'react';

// Scroll-reveal for marketing sections: adds data-visible="true" the first time
// the element scrolls into view. Under prefers-reduced-motion the element is
// marked visible immediately (index.css also neutralizes transitions globally
// as a backstop), so content is never hidden from anyone.
export default function useReveal() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      el.dataset.visible = 'true';
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.dataset.visible = 'true';
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return ref;
}

// Convenience wrapper: fades + rises its children on first view.
export function Reveal({ children, className = '', delay = 0 }) {
  const ref = useReveal();
  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`translate-y-4 opacity-0 transition-all duration-700 ease-out data-[visible=true]:translate-y-0 data-[visible=true]:opacity-100 ${className}`}
    >
      {children}
    </div>
  );
}
