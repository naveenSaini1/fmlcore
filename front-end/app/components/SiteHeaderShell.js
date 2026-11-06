"use client";

import { useCallback, useEffect, useState } from "react";
import SiteHeader from "./SiteHeader";
import { getMe } from "../../lib/api";

export default function SiteHeaderShell() {
  const [user, setUser] = useState(null);
  const refreshUser = useCallback(() => {
    getMe().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    refreshUser();
    window.addEventListener("fmlcore:auth-change", refreshUser);
    return () => window.removeEventListener("fmlcore:auth-change", refreshUser);
  }, [refreshUser]);

  return <SiteHeader user={user} />;
}
