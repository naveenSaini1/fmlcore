"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getDailyPrompt,
  getExplorePosts,
  getRandomPost,
} from "../../lib/api";
import PostCard from "./PostCard";
import LeaderboardPanel from "./LeaderboardPanel";

export default function Explore({ user }) {
  const [prompt, setPrompt] = useState(null);
  const [random, setRandom] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    getDailyPrompt().then(setPrompt)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setError("");
    const request = random
      ? getRandomPost().then(post => ({ items: post ? [post] : [], nextCursor: null }))
      : getExplorePosts().then(data => ({ items: data.posts, nextCursor: data.next_cursor }));

    request.then(({ items, nextCursor }) => {
        if (active) {
          setPosts(items);
          setCursor(nextCursor);
          setStatus("ready");
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setStatus("error");
        }
      });
    return () => { active = false; };
  }, [random, refreshKey]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await getExplorePosts({ cursor });
      setPosts((current) => [...current, ...data.posts]);
      setCursor(data.next_cursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  function findAnother() {
    if (!random) setRandom(true);
    else setRefreshKey((key) => key + 1);
  }

  const promptHref = user && prompt ? `/?prompt=${encodeURIComponent(prompt.prompt)}` : "/signup";

  return (
    <main className="explore-page mx-auto max-w-6xl px-4 py-8">
      <div className="discovery-layout grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
      <header className="page-introduction mb-7">
        <p className="font-note text-3xl leading-none">take a left turn</p>
        <h1 className="font-display text-5xl font-extrabold leading-[0.9] tracking-tight md:text-6xl">
          Explore the weird.
        </h1>
        <p className="mt-3 max-w-xl text-lg font-semibold">Find a story that feels familiar, or one you never saw coming.</p>
      </header>

      <section className="discovery-prompts mb-8 grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="daily-prompt border-4 border-ink bg-lime p-5 text-on-brand shadow-[6px_6px_0_var(--color-shadow)]">
          <p className="font-display text-xs font-extrabold uppercase tracking-widest">Today&apos;s prompt · {prompt?.date ?? "…"}</p>
          <h2 className="mt-2 font-note text-4xl leading-none">{prompt?.prompt ?? "Loading today's thought…"}</h2>
          <Link href={promptHref} className="mt-4 inline-block border-2 border-ink bg-ink px-3 py-2 text-sm font-extrabold text-on-ink">
            {user ? "Use this prompt" : "Join to write about it"}
          </Link>
        </div>
        <div className="random-prompt flex min-w-52 flex-col justify-between border-4 border-ink bg-purple p-5 text-on-brand shadow-[6px_6px_0_var(--color-shadow)]">
          <p className="font-note text-2xl leading-none">one story, picked at random</p>
          <button
            type="button"
            onClick={findAnother}
            className="mt-4 border-2 border-ink bg-white px-3 py-2 text-sm font-extrabold"
          >
            Surprise me ↗
          </button>
        </div>
      </section>

      <section aria-label="Browse stories">
        {random && <button type="button" onClick={() => setRandom(false)} className="border-2 border-ink bg-white px-3 py-2 text-sm font-extrabold">Back to all stories</button>}

        <div className="story-list mt-6 space-y-6">
          {status === "loading" ? <p className="font-note text-3xl leading-none">looking around…</p> : null}
          {status === "error" ? (
            <div className="border-4 border-ink bg-coral p-4 font-bold text-on-brand" role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => setRefreshKey((key) => key + 1)} className="mt-3 border-2 border-white px-3 py-1 font-extrabold">Try again</button>
            </div>
          ) : null}
          {status === "ready" && posts.length === 0 ? (
            <div className="border-4 border-dashed border-ink bg-white p-8 text-center">
              <p className="font-display text-2xl font-extrabold">No stories found in this corner.</p>
            </div>
          ) : null}
          {posts.map((post, index) => <PostCard key={post.id} post={post} index={index} viewerId={user?.id} />)}
          {!random && status === "ready" && cursor ? (
            <button type="button" onClick={loadMore} disabled={loadingMore} className="w-full border-4 border-ink bg-white px-4 py-3 font-extrabold shadow-[4px_4px_0_var(--color-shadow)] disabled:opacity-60">
              {loadingMore ? "Looking…" : "Load more stories"}
            </button>
          ) : null}
        </div>
      </section>
      {user ? <p className="mt-8 text-center text-sm font-bold">Signed in as @{user.username}</p> : null}
      </div>
      <LeaderboardPanel />
      </div>
    </main>
  );
}
