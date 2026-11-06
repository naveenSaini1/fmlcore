"use client";

import { useEffect, useState } from "react";
import { deletePost, getMyPosts } from "../../lib/api";
import PostCard from "./PostCard";

export default function MyContent({ user, onTabChange }) {
  const [tab, setTab] = useState("feed");
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
  async function removePost(id) {
    if (!window.confirm("Delete this post permanently?")) return;
    setDeleting(id); setError("");
    try { await deletePost(id); setPosts((items) => items.filter((item) => item.id !== id)); }
    catch (err) { setError(err.message); }
    finally { setDeleting(null); }
  }
  useEffect(() => {
    getMyPosts(tab).then((data) => setPosts(data.posts)).catch((e) => setError(e.message));
    const addCreated = (event) => {
      const post = event.detail;
      if ((tab === "confession") === (post.surface === "confession")) setPosts((items) => [post, ...items.filter((item) => item.id !== post.id)]);
    };
    window.addEventListener("fmlcore:post-created", addCreated);
    return () => window.removeEventListener("fmlcore:post-created", addCreated);
  }, [tab]);
  return <section className="mb-6 border-4 border-ink bg-paper p-4">
    <div className="flex flex-wrap items-center justify-end gap-3">
      <div className="flex gap-2"><button type="button" onClick={() => { setTab("feed"); onTabChange?.("feed"); }} aria-pressed={tab === "feed"} className={`border-2 border-ink px-3 py-2 text-sm font-extrabold ${tab === "feed" ? "bg-lime" : "bg-white"}`}>My posts</button><button type="button" onClick={() => { setTab("confession"); onTabChange?.("confession"); }} aria-pressed={tab === "confession"} className={`border-2 border-ink px-3 py-2 text-sm font-extrabold ${tab === "confession" ? "bg-purple" : "bg-white"}`}>My confessions</button></div>
    </div>
    {error ? <p role="alert" className="mt-3 font-bold text-danger">{error}</p> : posts.length ? <div className="mt-4 space-y-4">{posts.map((post) => <div key={post.id}>{tab === "confession" ? <p className="mb-2 border-2 border-ink bg-white px-3 py-2 text-sm font-extrabold">Balloon views: {post.view_count || 0}</p> : null}<PostCard post={post} viewerId={user.id} onDelete={() => removePost(post.id)} deleting={deleting === post.id} /></div>)}</div> : <p className="mt-3 font-semibold">No {tab === "confession" ? "confessions" : "posts"} yet.</p>}
  </section>;
}
