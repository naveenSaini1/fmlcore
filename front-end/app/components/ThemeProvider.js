"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getMe, getPlatformDefaultTheme, updateTheme } from "../../lib/api";
import { isThemeKey } from "../../lib/themes";

const ThemeContext = createContext(null);
const GUEST_THEME_KEY = "fmlcore-guest-theme";
const DEFAULT_THEME = "acid-lime";

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(DEFAULT_THEME);
  const [userId, setUserId] = useState(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const saveQueue = useRef(Promise.resolve());
  const saveSequence = useRef(0);

  useEffect(() => {
    const guestTheme = window.localStorage.getItem(GUEST_THEME_KEY);
    if (isThemeKey(guestTheme)) {
      setThemeState(guestTheme);
      document.documentElement.dataset.theme = guestTheme;
    }

    let alive = true;
    async function syncAccountTheme() {
      const platformTheme = await getPlatformDefaultTheme().then((result) => result.theme).catch(() => DEFAULT_THEME);
      if (!alive) return;
      try {
        const user = await getMe();
        if (!alive) return;
        setUserId(user.id);
        const accountTheme = isThemeKey(user.theme) ? user.theme : platformTheme;
        setThemeState(accountTheme);
        document.documentElement.dataset.theme = accountTheme;
      } catch {
        if (!alive) return;
        setUserId(null);
        const localTheme = isThemeKey(guestTheme) ? guestTheme : platformTheme;
        setThemeState(localTheme);
        document.documentElement.dataset.theme = localTheme;
      } finally {
        if (alive) setReady(true);
      }
    }

    syncAccountTheme();
    const onAuthChange = () => {
      setReady(false);
      syncAccountTheme();
    };
    window.addEventListener("fmlcore:auth-change", onAuthChange);
    return () => {
      alive = false;
      window.removeEventListener("fmlcore:auth-change", onAuthChange);
    };
  }, []);

  const chooseTheme = useCallback(async (nextTheme) => {
    if (!isThemeKey(nextTheme)) return;
    setThemeState(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    setError("");
    if (!userId) {
      window.localStorage.setItem(GUEST_THEME_KEY, nextTheme);
      return;
    }
    const sequence = ++saveSequence.current;
    setSaving(true);
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => updateTheme(nextTheme));
    try {
      await saveQueue.current;
    } catch (err) {
      if (sequence === saveSequence.current) setError(err.message);
    } finally {
      if (sequence === saveSequence.current) setSaving(false);
    }
  }, [userId]);

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
