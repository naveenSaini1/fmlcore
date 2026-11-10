"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getMe, updateSkin } from "../../lib/api";
import { DEFAULT_SKIN, isSkinId } from "../../lib/skins";

const SkinContext = createContext(null);
const GUEST_SKIN_KEY = "fmlcore-guest-skin";
const CACHE_KEY = "fmlcore-skin-cache";

function readLocal(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeLocal(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* Storage may be disabled. */ }
}

export function SkinProvider({ children }) {
  const [skin, setSkinState] = useState(DEFAULT_SKIN);
  const [userId, setUserId] = useState(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const queue = useRef(Promise.resolve());

  const apply = useCallback((next) => {
    const safe = isSkinId(next) ? next : DEFAULT_SKIN;
    setSkinState(safe);
    document.documentElement.dataset.skin = safe;
    return safe;
  }, []);

  useEffect(() => {
    let alive = true;
    const cached = readLocal(CACHE_KEY);
    if (isSkinId(cached)) apply(cached);
    let generation = 0;
    async function sync() {
      const request = ++generation;
      try {
        const user = await getMe();
        if (!alive || request !== generation) return;
        setUserId(user.id);
        writeLocal(CACHE_KEY, apply(user.skin));
      } catch {
        if (!alive || request !== generation) return;
        setUserId(null);
        writeLocal(CACHE_KEY, apply(readLocal(GUEST_SKIN_KEY)));
      } finally {
        if (alive && request === generation) setReady(true);
      }
    }
    sync();
    const onAuth = () => { setReady(false); sync(); };
    window.addEventListener("fmlcore:auth-change", onAuth);
    return () => { alive = false; window.removeEventListener("fmlcore:auth-change", onAuth); };
  }, [apply]);

  const chooseSkin = useCallback(async (next) => {
    if (!isSkinId(next) || !ready || saving) return false;
    const previous = skin;
    apply(next);
    setError("");
    if (!userId) {
      writeLocal(GUEST_SKIN_KEY, next);
      writeLocal(CACHE_KEY, next);
      return true;
    }
    setSaving(true);
    queue.current = queue.current.catch(() => {}).then(() => updateSkin(next));
    try {
      await queue.current;
      writeLocal(CACHE_KEY, next);
      return true;
    } catch (err) {
      apply(previous);
      setError(err.message || "Could not save your skin.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [apply, userId, ready, saving, skin]);

  return <SkinContext.Provider value={{ skin, chooseSkin, ready, saving, error }}>{children}</SkinContext.Provider>;
}

export function useSkin() {
  const value = useContext(SkinContext);
  if (!value) throw new Error("useSkin must be used inside SkinProvider.");
  return value;
}
