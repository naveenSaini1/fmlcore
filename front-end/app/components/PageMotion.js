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
        className="app-content min-h-screen"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export function NavigationProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [destination, setDestination] = useState("your next page");
  const startedAt = useRef(0);
  const fromPath = useRef("");
  const watchdog = useRef(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target.closest?.("a[href]");
      if (!anchor || anchor.target === "_blank") return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname === window.location.pathname) return;
      startedAt.current = Date.now();
      fromPath.current = window.location.pathname;
      const label = anchor.getAttribute("aria-label") || anchor.textContent?.trim() || destination.pathname.split("/").filter(Boolean).pop() || "Home";
      setDestination(label.replace(/\s+/g, " "));
      setActive(true);
      if (watchdog.current) window.clearTimeout(watchdog.current);
      watchdog.current = window.setTimeout(() => setActive(false), 15000);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!active || pathname === fromPath.current) return undefined;
    const remaining = Math.max(0, 650 - (Date.now() - startedAt.current));
    const timeout = window.setTimeout(() => {
      setActive(false);
      if (watchdog.current) window.clearTimeout(watchdog.current);
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [pathname, active]);

  return (
    <AnimatePresence>
      {active ? (
        <motion.div
          className="navigation-overlay"
          role="status"
          aria-live="polite"
          aria-label={`Loading ${destination}`}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.18, ease: "easeOut" }}
        >
          <motion.div
            className="navigation-loader-card"
            initial={reduce ? false : { y: 12, scale: 0.96 }}
            animate={{ y: 0, scale: 1 }}
            exit={reduce ? undefined : { y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 24 }}
          >
            <div className="navigation-robot" aria-hidden="true">
              <span className="robot-antenna" />
              <span className="robot-head"><i /><i /><b /></span>
              <span className="robot-body"><b>FML</b></span>
              <span className="robot-arm robot-arm-left" />
              <span className="robot-arm robot-arm-right" />
              <span className="robot-leg robot-leg-left" />
              <span className="robot-leg robot-leg-right" />
            </div>
            <p className="font-note text-3xl leading-none">on the way…</p>
            <p className="mt-2 font-display text-lg font-extrabold">Opening {destination}</p>
            <span className="navigation-loader-track" aria-hidden="true"><i /></span>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
