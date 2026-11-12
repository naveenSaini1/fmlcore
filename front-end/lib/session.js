"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getMe } from "./api";
import { sessionStore } from "./session-store";

export function useSession() {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot, sessionStore.getServerSnapshot);
}

export function SessionProvider({ children }) {
  useEffect(() => {
    const sync = () => { getMe().catch(() => {}); };
    const crossTab = (event) => {
      if (event.key !== "fmlcore-session-change") return;
      sessionStore.invalidate();
      sync();
    };
    sync();
    window.addEventListener("storage", crossTab);
    // Legacy callers can announce auth/profile changes; successful mutations
    // already updated the store, so these calls reuse the same snapshot.
    window.addEventListener("fmlcore:auth-change", sync);
    window.addEventListener("fmlcore:profile-change", sync);
    return () => {
      window.removeEventListener("storage", crossTab);
      window.removeEventListener("fmlcore:auth-change", sync);
      window.removeEventListener("fmlcore:profile-change", sync);
    };
  }, []);
  return children;
}
