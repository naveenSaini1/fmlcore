"use client";

import { useEffect, useState } from "react";
import { getSafetyLists, setBlock, setMute } from "../../lib/api";

export default function SafetySettings() {
  const [lists, setLists] = useState({ blocks: [], mutes: [] });
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  async function load() {
    try {
      setLists(await getSafetyLists());
      setStatus("ready");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  useEffect(() => { load(); }, []);

  async function remove(kind, user) {
    setError("");
    try {
      if (kind === "blocks") await setBlock(user.id, false);
      else await setMute(user.id, false);
      setLists((current) => ({
        ...current,
        [kind]: current[kind].filter((item) => item.id !== user.id),
      }));
    } catch (err) {
      setError(err.message);
    }
  }

  function list(kind, title, empty) {
    return (
      <div>
        <h3 className="font-display text-lg font-extrabold">{title}</h3>
        {lists[kind].length ? (
          <ul className="mt-2 space-y-2">
            {lists[kind].map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 border-2 border-ink bg-paper px-3 py-2">
                <span className="font-bold">@{item.username}</span>
                <button type="button" onClick={() => remove(kind, item)} className="border-2 border-ink bg-white px-2 py-1 text-xs font-extrabold">
                  {kind === "blocks" ? "Unblock" : "Unmute"}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm font-semibold text-on-brand/70">{empty}</p>}
      </div>
    );
  }

  return (
    <section className="space-y-5 border-4 border-ink bg-lime p-5 text-on-brand shadow-[6px_6px_0_var(--color-shadow)]">
      <div>
        <p className="font-note text-2xl leading-none">your space, your rules</p>
        <h2 className="font-display text-2xl font-extrabold">Safety settings</h2>
        <p className="mt-1 text-sm font-semibold">Blocked and muted accounts disappear from your feed and comments.</p>
      </div>
      {error ? <p className="border-2 border-ink bg-coral px-3 py-2 text-sm font-bold text-on-brand" role="alert">{error}</p> : null}
      {status === "loading" ? <p className="font-note text-xl">Loading…</p> : null}
      {status === "ready" ? (
        <div className="grid gap-5 md:grid-cols-2">
          {list("blocks", "Blocked accounts", "No one blocked.")}
          {list("mutes", "Muted accounts", "No one muted.")}
        </div>
      ) : null}
      {status === "error" ? <button type="button" onClick={load} className="border-2 border-ink bg-white px-3 py-2 text-sm font-extrabold">Try again</button> : null}
    </section>
  );
}
