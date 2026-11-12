"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { updateSkin } from "../../lib/api";
import { useSession } from "../../lib/session";
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
  const { user, ready } = useSession();
  const userId = user?.id;
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
    const cached = readLocal(CACHE_KEY);
    if (isSkinId(cached)) apply(cached);
  }, [apply]);

  useEffect(() => {
    if (!ready) return;
    writeLocal(CACHE_KEY, apply(user ? user.skin : readLocal(GUEST_SKIN_KEY)));
  }, [apply, ready, user?.id, user?.skin]);

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
