"use client";

import { useEffect, useState } from "react";

function ContentList({ userId, surface, label, api, dateLabel }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(nextCursor, signal) {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ limit: "10" });
    if (surface) params.set("surface", surface);
    if (nextCursor) params.set("cursor", nextCursor);

    try {
      const endpoint = surface ? "stories" : "comments";
      const result = await api(`/admin/users/${encodeURIComponent(userId)}/${endpoint}?${params}`, { signal });
      const entries = surface ? result.posts : result.comments;
      if (signal?.aborted) return;
      setItems(current => nextCursor ? [...current, ...entries] : entries);
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
    {!loading && !error && items.length === 0 && <p className="panel-subtitle">No {label.toLowerCase()} yet.</p>}
    {items.map(post => <article className="user-story" key={post.id}>
      <time dateTime={post.created_at}>{dateLabel(post.created_at)}</time>
      <span className="user-story-visibility">{post.visibility === "private" ? "Private" : "Public"}{post.is_anonymous ? " · Anonymous" : ""}</span>
      {!surface && <span className="user-story-visibility">{post.is_reply ? "Reply" : "Comment"} on {post.surface === "confession" ? "a confession" : "a post"}</span>}
      <p>{post.body}</p>
      {!surface && post.visibility === "public" && <a href={`https://fmlcore.com/posts/${post.post_id}?comment=${post.id}#comment-${post.id}`} target="_blank" rel="noopener noreferrer">View conversation ↗</a>}
      {post.image_url?.startsWith("/admin/stories/") && <img src={`/api${post.image_url}`} alt="Image attached to the story" loading="lazy" />}
    </article>)}
    {loading && <p className="panel-subtitle" role="status">Loading {label.toLowerCase()}…</p>}
    {cursor && <button className="btn btn-quiet" type="button" disabled={loading} onClick={() => load(cursor)}>Load more {label.toLowerCase()}</button>}
    {error && !cursor && <button className="btn btn-quiet" type="button" disabled={loading} onClick={() => load(null)}>Retry</button>}
  </section>;
}

export default function UserStories({ userId, api, dateLabel }) {
  return <div className="user-stories">
    <p className="panel-subtitle">Posts, confessions, and comments associated with this account.</p>
    <ContentList userId={userId} surface="feed" label="Posts" api={api} dateLabel={dateLabel} />
    <ContentList userId={userId} surface="confession" label="Confessions" api={api} dateLabel={dateLabel} />
    <ContentList userId={userId} label="Comments" api={api} dateLabel={dateLabel} />
  </div>;
}
