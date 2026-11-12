"use client";

import { useEffect, useState } from "react";

function StoryList({ userId, surface, label, api, dateLabel }) {
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(nextCursor, signal) {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ surface, limit: "10" });
    if (nextCursor) params.set("cursor", nextCursor);

    try {
      const result = await api(`/admin/users/${encodeURIComponent(userId)}/stories?${params}`, { signal });
      if (signal?.aborted) return;
      setPosts(current => nextCursor ? [...current, ...result.posts] : result.posts);
      setCursor(result.next_cursor);
    } catch (err) {
      if (!signal?.aborted) setError(err.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    load(null, controller.signal);
    return () => controller.abort();
  }, [userId, surface]);

  return <section className="user-story-list" aria-label={label}>
    <h4>{label}</h4>
    {error && <p className="error" role="alert">{error}</p>}
    {!loading && !error && posts.length === 0 && <p className="panel-subtitle">No {label.toLowerCase()} yet.</p>}
    {posts.map(post => <article className="user-story" key={post.id}>
      <time dateTime={post.created_at}>{dateLabel(post.created_at)}</time>
      <span className="user-story-visibility">{post.visibility === "private" ? "Private" : "Public"}{post.is_anonymous ? " · Anonymous" : ""}</span>
      <p>{post.body}</p>
      {post.image_url?.startsWith("/admin/stories/") && <img src={`/api${post.image_url}`} alt="Image attached to the story" loading="lazy" />}
    </article>)}
    {loading && <p className="panel-subtitle" role="status">Loading {label.toLowerCase()}…</p>}
    {cursor && <button className="btn btn-quiet" type="button" disabled={loading} onClick={() => load(cursor)}>Load more {label.toLowerCase()}</button>}
    {error && !cursor && <button className="btn btn-quiet" type="button" disabled={loading} onClick={() => load(null)}>Retry</button>}
  </section>;
}

export default function UserStories({ userId, api, dateLabel }) {
  return <div className="user-stories">
    <p className="panel-subtitle">Posts and confessions associated with this account.</p>
    <StoryList userId={userId} surface="feed" label="Posts" api={api} dateLabel={dateLabel} />
    <StoryList userId={userId} surface="confession" label="Confessions" api={api} dateLabel={dateLabel} />
  </div>;
}
