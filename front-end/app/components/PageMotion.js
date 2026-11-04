"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function PageMotion({ children }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? undefined : { opacity: 0, y: -5 }}
        transition={{ duration: reduce ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="min-h-screen"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export function NavigationProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const timeout = useRef(null);

  useEffect(() => {
    const stop = () => {
      setActive(false);
      if (timeout.current) window.clearTimeout(timeout.current);
    };
    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target.closest?.("a[href]");
      if (!anchor || anchor.target === "_blank") return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname) return;
      setActive(true);
      if (timeout.current) window.clearTimeout(timeout.current);
      timeout.current = window.setTimeout(stop, 5000);
    };

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      stop();
    };
  }, []);

  useEffect(() => {
    setActive(false);
    if (timeout.current) window.clearTimeout(timeout.current);
  }, [pathname]);

  return <div className={`navigation-progress${active ? " is-active" : ""}`} aria-hidden="true" />;
}
