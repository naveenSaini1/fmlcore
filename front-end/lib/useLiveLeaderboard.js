"use client";

import { useEffect, useState } from "react";
import { useSession } from "./session";
import { getLeaderboard, invalidateApiReads } from "./api";

const emptySnapshot = { entries: [], nextOffset: null, loading: true, error: "" };

export function useLiveLeaderboard(limit = 5) {
  const { user, ready } = useSession();
  const scope = user?.id ?? null;
  const [snapshot, setSnapshot] = useState({ ...emptySnapshot, scope });
  useEffect(() => {
    if (!ready) return;
    let active = true;
    let revision = 0;
    let timer;
    let source;
    let connected = false;
    setSnapshot(current => ({
      ...(current.scope === scope ? current : emptySnapshot),
      scope,
      loading: true,
      error: "",
    }));
    async function refresh() {
      const version = ++revision;
      invalidateApiReads(["content"]);
      try {
        const entries = [];
        let nextOffset = 0;
        while (entries.length < limit && nextOffset !== null) {
          const data = await getLeaderboard({ limit: Math.min(20, limit - entries.length), offset: nextOffset, fresh: true });
          if (!active || version !== revision) return;
          entries.push(...data.entries);
          nextOffset = data.next_offset;
        }
        setSnapshot({ entries, nextOffset, loading: false, error: "", scope });
      } catch (error) {
        if (active && version === revision) setSnapshot(current => ({ ...current, loading: false, error: error.message }));
      }
    }
    const schedule = () => {
      if (!timer) timer = setTimeout(() => { timer = null; refresh(); }, 150);
    };
    const visible = () => { if (document.visibilityState === "visible") schedule(); };
    refresh();
    if (typeof EventSource !== "undefined") {
      source = new EventSource("/api/leaderboard/events");
      source.onopen = () => { connected = true; };
      source.onerror = () => { connected = false; };
      source.addEventListener("changed", schedule);
    }
    // Reconcile rolling-week expiry; keep working if streaming is unavailable.
    let ticks = 0;
    const fallback = setInterval(() => {
      if (document.visibilityState === "visible" && (!connected || ++ticks % 4 === 0)) schedule();
    }, 15000);
    window.addEventListener("fmlcore:leaderboard-change", schedule);
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false; revision += 1; clearTimeout(timer); clearInterval(fallback); source?.close();
      window.removeEventListener("fmlcore:leaderboard-change", schedule);
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [ready, scope, limit]);
  return ready && snapshot.scope === scope ? snapshot : emptySnapshot;
}
