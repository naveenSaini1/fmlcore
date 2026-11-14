"use client";

import Link from "next/link";
import { useErrorToast } from "./ErrorToast";
import { useLiveLeaderboard } from "../../lib/useLiveLeaderboard";
import { profileSticker } from "../../lib/profile-style";

export default function LeaderboardPanel() {
  const { entries, error, loading } = useLiveLeaderboard(5);
  useErrorToast(error);

  return (
    <aside className="community-panel h-fit border-4 border-ink bg-soft-purple p-4 shadow-[6px_6px_0_var(--color-shadow)] md:sticky md:top-24">
      <div className="leaderboard-panel-heading">
        <p className="leaderboard-eyebrow">THIS WEEK</p>
        <h2>Top Painer <span aria-hidden="true">↗</span></h2>
        <p className="leaderboard-description">The stories that hit home.</p>
      </div>
      {loading ? <p className="mt-3 font-note text-lg">Counting the votes…</p> : null}
      {!loading && !error && entries.length === 0 ? <p className="mt-3 text-sm font-semibold">No votes this week yet.</p> : null}
      <ol className="leaderboard-list">
        {entries.map((entry) => (
          <li key={entry.post.id} className="leaderboard-row">
            <Link href={`/leaderboard#leaderboard-post-${entry.post.id}`} className="leaderboard-entry" aria-label={`View number ${entry.rank} on the leaderboard`}>
              <span className="leaderboard-rank" aria-hidden="true">{String(entry.rank).padStart(2, "0")}</span>
              <div className="leaderboard-story">
                <div className="leaderboard-author"><span>{entry.post.is_anonymous ? "Anonymous" : `@${entry.post.author?.username ?? "someone"}`}</span>{entry.post.author && !entry.post.is_anonymous && <span className="leaderboard-sticker" aria-hidden="true">{profileSticker(entry.post.author.profile_sticker)}</span>}</div>
                <p className="leaderboard-excerpt">{entry.post.body}</p>
              </div>
              <span className="leaderboard-votes"><strong>{entry.weekly_votes}</strong><span>{entry.weekly_votes === 1 ? "vote" : "votes"}</span></span>
            </Link>
          </li>
        ))}
      </ol>
      <Link href="/leaderboard" className="leaderboard-view-all">
        View leaderboard <span aria-hidden="true">↗</span>
      </Link>
    </aside>
  );
}
