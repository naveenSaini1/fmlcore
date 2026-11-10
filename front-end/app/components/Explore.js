"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getDailyPrompt,
  getExplorePosts,
  getExploreTaxonomy,
  getRandomPost,
  getTrending,
} from "../../lib/api";
import { moodByKey } from "../../lib/taxonomy";
import PostCard from "./PostCard";
import LeaderboardPanel from "./LeaderboardPanel";

const TABS = [
  { key: "recent", label: "Fresh stories" },
  { key: "trending", label: "Trending" },
  { key: "random", label: "Random story" },
];

export default function Explore({ user }) {
  const [taxonomy, setTaxonomy] = useState({ categories: [], moods: [] });
  const [prompt, setPrompt] = useState(null);
  const [category, setCategory] = useState("");
  const [mood, setMood] = useState("");
  const [mode, setMode] = useState("recent");
  const [refreshKey, setRefreshKey] = useState(0);
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getExploreTaxonomy(), getDailyPrompt()])
      .then(([terms, daily]) => {
        setTaxonomy(terms);
        setPrompt(daily);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setError("");
    const filters = { category, mood };
    const request = mode === "trending"
      ? getTrending(filters).then((items) => ({ items, nextCursor: null }))
      : mode === "random"
        ? getRandomPost(filters).then((post) => ({ items: post ? [post] : [], nextCursor: null }))
        : getExplorePosts(filters).then((data) => ({ items: data.posts, nextCursor: data.next_cursor }));

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
  }, [category, mood, mode, refreshKey]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await getExplorePosts({ category, mood, cursor });
      setPosts((current) => [...current, ...data.posts]);
      setCursor(data.next_cursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  function findAnother() {
    if (mode !== "random") setMode("random");
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
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Explore feeds">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={mode === tab.key}
              onClick={() => setMode(tab.key)}
              className={`border-2 border-ink px-3 py-2 text-sm font-extrabold ${mode === tab.key ? "bg-ink text-on-ink" : "bg-white"}`}
            >
              {tab.label}
            </button>
          ))}
          {mode === "random" ? (
            <button type="button" onClick={findAnother} className="border-2 border-ink bg-coral px-3 py-2 text-sm font-extrabold text-on-brand">
              Another one ↻
            </button>
          ) : null}
        </div>

        <div className="story-filters mt-4 flex flex-wrap items-end gap-3 border-4 border-ink bg-white p-4">
          <label className="flex flex-col gap-1 text-xs font-extrabold uppercase tracking-wide">
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="min-w-48 border-2 border-ink bg-paper px-3 py-2 text-sm font-bold normal-case tracking-normal">
              <option value="">All categories</option>
              {taxonomy.categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-extrabold uppercase tracking-wide">
            Mood
            <select value={mood} onChange={(event) => setMood(event.target.value)} className="min-w-48 border-2 border-ink bg-paper px-3 py-2 text-sm font-bold normal-case tracking-normal">
              <option value="">All moods</option>
              {taxonomy.moods.map((key) => {
                const item = moodByKey(key);
                return <option key={key} value={key}>{item.emoji} {item.label}</option>;
              })}
            </select>
          </label>
          {(category || mood) ? (
            <button type="button" onClick={() => { setCategory(""); setMood(""); }} className="px-2 py-2 text-sm font-extrabold underline">Clear filters</button>
          ) : null}
        </div>

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
              <p className="mt-2 font-semibold">Try another mood or category.</p>
            </div>
          ) : null}
          {posts.map((post, index) => <PostCard key={post.id} post={post} index={index} viewerId={user?.id} />)}
          {mode === "recent" && status === "ready" && cursor ? (
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
