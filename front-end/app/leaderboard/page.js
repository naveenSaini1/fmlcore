"use client";

import { useErrorToast } from "../components/ErrorToast";
import { useState } from "react";
import { useSession } from "../../lib/session";
import PostCard from "../components/PostCard";
import { useLiveLeaderboard } from "../../lib/useLiveLeaderboard";

export default function LeaderboardPage() {
  const { user } = useSession();
  const [limit, setLimit] = useState(5);
  const { entries, nextOffset, loading, error } = useLiveLeaderboard(limit);
  useErrorToast(error);
  const status = loading ? "loading" : "ready";

  return (
    <>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <header className="mb-7 border-4 border-ink bg-coral p-5 text-on-brand shadow-[7px_7px_0_var(--color-shadow)]">
          <p className="font-note text-3xl leading-none">the stories that hit home</p>
          <h1 className="font-display text-5xl font-extrabold leading-none">Top Painer</h1>
          <p className="mt-3 max-w-xl font-semibold">Posts ranked by reactions received in the last seven days. Anonymous stories stay anonymous.</p>
        </header>

        {loading && entries.length === 0 ? <p className="font-note text-2xl">Counting the votes…</p> : null}
        {status === "ready" && entries.length === 0 ? (
          <div className="border-4 border-dashed border-ink bg-white p-8 text-center">
            <p className="font-display text-2xl font-extrabold">No votes this week yet.</p>
            <p className="mt-2 font-semibold">The leaderboard will wake up when people react.</p>
          </div>
        ) : null}
        <div className="space-y-7">
          {entries.map((entry, index) => (
            <section key={entry.post.id} id={`leaderboard-post-${entry.post.id}`} className="scroll-mt-24 space-y-3">
              <div className="flex items-center justify-between border-4 border-ink bg-lime px-4 py-2 shadow-[4px_4px_0_var(--color-shadow)]">
                <h2 className="font-display text-xl font-extrabold">#{entry.rank} this week</h2>
                <span className="font-extrabold">{entry.weekly_votes} {entry.weekly_votes === 1 ? "vote" : "votes"}</span>
              </div>
              <PostCard post={entry.post} index={index} viewerId={user?.id} />
            </section>
          ))}
        </div>
        {nextOffset !== null ? (
          <button type="button" onClick={() => setLimit(value => value + 5)} disabled={loading} className="mt-7 w-full border-4 border-ink bg-white px-4 py-3 font-extrabold shadow-[4px_4px_0_var(--color-shadow)] [overflow-anchor:none] disabled:opacity-60">
            {loading ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </main>
    </>
  );
}
