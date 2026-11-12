"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getPlatformDefaultTheme, updateTheme } from "../../lib/api";
import { useSession } from "../../lib/session";
import { isThemeKey } from "../../lib/themes";

const ThemeContext = createContext(null);
const GUEST_THEME_KEY = "fmlcore-guest-theme";
const DEFAULT_THEME = "acid-lime";
function readLocal() {
  try { return window.localStorage.getItem(GUEST_THEME_KEY); } catch { return null; }
}
function writeLocal(value) {
  try { window.localStorage.setItem(GUEST_THEME_KEY, value); } catch { /* Storage is optional. */ }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(DEFAULT_THEME);
  const { user, ready: sessionReady } = useSession();
  const userId = user?.id;
  const [platformTheme, setPlatformTheme] = useState(DEFAULT_THEME);
  const [platformReady, setPlatformReady] = useState(false);
  const ready = sessionReady && platformReady;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);

  useEffect(() => {
    const guestTheme = readLocal();
    if (isThemeKey(guestTheme)) {
      setThemeState(guestTheme);
      document.documentElement.dataset.theme = guestTheme;
    }
    let alive = true;
    getPlatformDefaultTheme().then((result) => {
      if (alive) setPlatformTheme(isThemeKey(result.theme) ? result.theme : DEFAULT_THEME);
    }).catch(() => {}).finally(() => { if (alive) setPlatformReady(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const preferred = user ? user.theme : readLocal();
    const next = isThemeKey(preferred) ? preferred : platformTheme;
    setThemeState(next);
    document.documentElement.dataset.theme = next;
  }, [ready, user?.id, user?.theme, platformTheme]);

  const chooseTheme = useCallback(async (nextTheme) => {
    if (!isThemeKey(nextTheme) || !ready || savingRef.current || nextTheme === theme) return false;
    const previous = theme;
    setThemeState(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    setError("");
    if (!userId) {
      writeLocal(nextTheme);
      return true;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await updateTheme(nextTheme);
      return true;
    } catch (err) {
      setThemeState(previous);
      document.documentElement.dataset.theme = previous;
      setError(err.message || "Could not save your colors.");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [userId, ready, theme]);

  return (
    <ThemeContext.Provider value={{ theme, chooseTheme, ready, saving, error }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider.");
  return value;
}
