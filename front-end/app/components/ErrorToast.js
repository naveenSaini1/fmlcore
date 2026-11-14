"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const ERROR_EVENT = "fmlcore:error-toast";

export function showErrorToast(message) {
  if (message) window.dispatchEvent(new CustomEvent(ERROR_EVENT, { detail: message }));
}

export function useErrorToast(message) {
  useEffect(() => {
    showErrorToast(message);
  }, [message]);
}

export default function ErrorToast() {
  const [toast, setToast] = useState(null);
  const sequence = useRef(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    function show(event) {
      setToast({ message: event.detail, id: ++sequence.current });
    }

    window.addEventListener(ERROR_EVENT, show);
    return () => window.removeEventListener(ERROR_EVENT, show);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div className="pointer-events-none fixed right-3 top-20 z-[100] w-max max-w-[min(17rem,calc(100vw-1.5rem))] sm:right-6 sm:w-[min(22rem,calc(100vw-2rem))] sm:max-w-none">
      <AnimatePresence mode="wait">
        {toast && (
          <motion.div
            key={toast.id}
            initial={reducedMotion ? false : { x: 52, opacity: 0, rotate: -8 }}
            animate={{ x: 0, opacity: 1, rotate: reducedMotion ? 0 : -2 }}
            exit={reducedMotion ? { opacity: 0 } : { x: 40, opacity: 0, rotate: 5 }}
            transition={reducedMotion ? { duration: 0 } : { type: "tween", duration: 0.25, ease: "easeOut" }}
            className="pointer-events-auto flex items-center gap-2 border-2 border-ink bg-coral py-1 pl-2 pr-1 text-on-brand shadow-[3px_3px_0_var(--color-shadow)] sm:items-start sm:gap-3 sm:border-4 sm:p-3 sm:shadow-[5px_5px_0_var(--color-shadow)]"
          >
            <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center border-2 border-ink bg-ink text-xs font-extrabold text-on-ink sm:h-7 sm:w-7 sm:text-base">!</span>
            <p role="alert" className="min-w-0 flex-1 break-words text-sm font-extrabold sm:pt-1">{toast.message}</p>
            <button type="button" aria-label="Dismiss error" onClick={() => setToast(null)} className="h-9 w-9 shrink-0 cursor-pointer text-xl leading-none sm:h-7 sm:w-7">×</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
