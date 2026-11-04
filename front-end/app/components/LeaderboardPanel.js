"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getLeaderboard } from "../../lib/api";
import { profileColor, profileSticker } from "../../lib/profile-style";

export default function LeaderboardPanel() {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLeaderboard({ limit: 5 })
      .then((data) => setEntries(data.entries))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <aside className="h-fit border-4 border-ink bg-soft-purple p-4 shadow-[6px_6px_0_var(--color-shadow)] md:sticky md:top-24">
      <p className="font-note text-xl leading-none">weekly reactions</p>
      <h2 className="font-display text-2xl font-extrabold">Top Painer</h2>
      <p className="mt-1 text-xs font-bold text-ink/70">Posts people related to most this week.</p>
      {loading ? <p className="mt-3 font-note text-lg">Counting the votes…</p> : null}
      {error ? <p className="mt-3 text-sm font-bold text-danger">{error}</p> : null}
      {!loading && !error && entries.length === 0 ? <p className="mt-3 text-sm font-semibold">No votes this week yet.</p> : null}
      <ol className="mt-3 space-y-2">
        {entries.map((entry) => (
          <li key={entry.post.id} className="border-2 border-ink bg-white p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-sm font-extrabold">{entry.rank}. {entry.post.is_anonymous ? "Anonymous" : `@${entry.post.author?.username ?? "someone"}`}</span>
              {entry.post.author && !entry.post.is_anonymous ? <span className="rounded-full px-1.5 text-on-brand" style={{ backgroundColor: profileColor(entry.post.author.profile_color) }}>{profileSticker(entry.post.author.profile_sticker)}</span> : null}
            </div>
            <p className="mt-1 line-clamp-2 text-xs font-semibold">{entry.post.body}</p>
            <p className="mt-1 text-[10px] font-extrabold uppercase tracking-wide">{entry.weekly_votes} {entry.weekly_votes === 1 ? "vote" : "votes"}</p>
          </li>
        ))}
      </ol>
      <Link href="/leaderboard" className="mt-3 block border-2 border-ink bg-lime px-3 py-2 text-center text-sm font-extrabold text-on-brand">
        Load more ↗
      </Link>
    </aside>
  );
}
