"use client";

import { useEffect, useState } from "react";
import PostCard from "../components/PostCard";
import { getLeaderboard, getMe } from "../../lib/api";

export default function LeaderboardPage() {
  const [user, setUser] = useState(null);
  const [entries, setEntries] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [status, setStatus] = useState("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getMe().then(setUser).catch(() => setUser(null));
    getLeaderboard({ limit: 5 })
      .then((data) => {
        setEntries(data.entries);
        setNextOffset(data.next_offset);
        setStatus("ready");
      })
      .catch((err) => {
        setError(err.message);
        setStatus("error");
      });
  }, []);

  async function loadMore() {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const data = await getLeaderboard({ limit: 5, offset: nextOffset });
      setEntries((current) => [...current, ...data.entries]);
      setNextOffset(data.next_offset);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <header className="mb-7 border-4 border-ink bg-coral p-5 text-on-brand shadow-[7px_7px_0_var(--color-shadow)]">
          <p className="font-note text-3xl leading-none">the stories that hit home</p>
          <h1 className="font-display text-5xl font-extrabold leading-none">Top Painer</h1>
          <p className="mt-3 max-w-xl font-semibold">Posts ranked by reactions received in the last seven days. Anonymous stories stay anonymous.</p>
        </header>

        {status === "loading" ? <p className="font-note text-2xl">Counting the votes…</p> : null}
        {error ? <p className="mb-4 border-4 border-ink bg-coral p-3 font-bold text-on-brand" role="alert">{error}</p> : null}
        {status === "ready" && entries.length === 0 ? (
          <div className="border-4 border-dashed border-ink bg-white p-8 text-center">
            <p className="font-display text-2xl font-extrabold">No votes this week yet.</p>
            <p className="mt-2 font-semibold">The leaderboard will wake up when people react.</p>
          </div>
        ) : null}
        <div className="space-y-7">
          {entries.map((entry, index) => (
            <section key={entry.post.id} className="space-y-3">
              <div className="flex items-center justify-between border-4 border-ink bg-lime px-4 py-2 shadow-[4px_4px_0_var(--color-shadow)]">
                <h2 className="font-display text-xl font-extrabold">#{entry.rank} this week</h2>
                <span className="font-extrabold">{entry.weekly_votes} {entry.weekly_votes === 1 ? "vote" : "votes"}</span>
              </div>
              <PostCard post={entry.post} index={index} viewerId={user?.id} />
            </section>
          ))}
        </div>
        {nextOffset !== null ? (
          <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-7 w-full border-4 border-ink bg-white px-4 py-3 font-extrabold shadow-[4px_4px_0_var(--color-shadow)] disabled:opacity-60">
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </main>
    </>
  );
}
