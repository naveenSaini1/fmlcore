"use client";

import { useEffect, useState } from "react";
import { getFeed } from "../../lib/api";
import Composer from "./Composer";
import PostCard from "./PostCard";

export default function Feed({ user }) {
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadFirst() {
    setStatus("loading");
    setError("");
    try {
      const data = await getFeed(null);
      setPosts(data.posts);
      setCursor(data.next_cursor);
      setStatus("ready");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }

  useEffect(() => {
    loadFirst();
  }, []);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const data = await getFeed(cursor);
      setPosts((prev) => [...prev, ...data.posts]);
      setCursor(data.next_cursor);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  function onCreated(post) {
    setPosts((prev) => [post, ...prev]);
  }

  return (
    <div className="space-y-6">
      <Composer user={user} onCreated={onCreated} />

      {status === "loading" ? (
        <p className="font-note text-3xl leading-none">reading the room…</p>
      ) : null}

      {status === "error" ? (
        <div className="border-4 border-ink bg-coral p-4 text-on-brand" role="alert">
          <p className="font-bold">{error}</p>
          <button onClick={loadFirst} className="mt-3 border-2 border-white px-3 py-1 font-extrabold">
            Try again
          </button>
        </div>
      ) : null}

      {status === "ready" && posts.length === 0 ? (
        <div className="border-4 border-dashed border-ink bg-white p-8 text-center">
          <p className="font-display text-2xl font-extrabold">Nothing here yet.</p>
          <p className="mt-2 font-semibold">Be the first to say the weird thing out loud.</p>
        </div>
      ) : null}

      {posts.map((post, i) => (
        <PostCard key={post.id} post={post} index={i} viewerId={user?.id} />
      ))}

      {status === "ready" && cursor ? (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full border-4 border-ink bg-white px-4 py-3 font-extrabold shadow-[4px_4px_0_var(--color-shadow)] disabled:opacity-60"
        >
          {loadingMore ? "…" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}
