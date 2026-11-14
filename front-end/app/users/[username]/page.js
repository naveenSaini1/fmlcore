"use client";

import { useErrorToast } from "../../components/ErrorToast";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, mediaUrl } from "../../../lib/api";
import { useSession } from "../../../lib/session";
import PostCard from "../../components/PostCard";

export default function PublicProfilePage() {
  const { username } = useParams();
  const { user, ready } = useSession();
  const [profile, setProfile] = useState(null);
  const [surface, setSurface] = useState("feed");
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState("");
  useErrorToast(error);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const key = `${username}:${surface}:${user?.id || "guest"}`;
  const [loadedKey, setLoadedKey] = useState("");
  const currentKey = useRef(key);
  currentKey.current = key;

  useEffect(() => {
    if (!ready) return;
    let active = true;
    setLoading(true); setMoreLoading(false); setError(""); setProfile(null); setPosts([]); setCursor(null);
    const path = `/users/${encodeURIComponent(username)}`;
    Promise.all([api(path), api(`${path}/posts?surface=${surface}`)])
      .then(([person, feed]) => {
        if (!active) return;
        setProfile(person); setPosts(feed.posts); setCursor(feed.next_cursor); setLoadedKey(key);
      })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [username, surface, ready, user?.id]);

  async function loadMore() {
    if (!cursor || moreLoading) return;
    const requestKey = key;
    setMoreLoading(true); setError("");
    try {
      const feed = await api(`/users/${encodeURIComponent(username)}/posts?surface=${surface}&cursor=${encodeURIComponent(cursor)}`);
      if (currentKey.current !== requestKey) return;
      setPosts((prev) => [...prev, ...feed.posts.filter((p) => !prev.some((old) => old.id === p.id))]);
      setCursor(feed.next_cursor);
    } catch (err) { if (currentKey.current === requestKey) setError(err.message); }
    finally { if (currentKey.current === requestKey) setMoreLoading(false); }
  }

  return <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
    {loading ? <p role="status">Loading profile…</p> : null}
    {profile ? <>
      <header className="border-4 border-ink bg-paper p-6 shadow-[6px_6px_0_var(--color-shadow)]">
        <div className="flex items-center gap-4">
          {profile.avatar_url ? <img src={mediaUrl(profile.avatar_url)} alt="" className="h-20 w-20 rounded-full border-2 border-ink object-cover" /> : <span aria-hidden="true" className="grid h-20 w-20 place-items-center rounded-full border-2 border-ink bg-lime text-3xl font-bold">{profile.username.slice(0, 1).toUpperCase()}</span>}
          <div><h1 className="font-display text-3xl font-extrabold break-all">@{profile.username}</h1><p className="text-sm">Joined {new Date(profile.joined_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p></div>
        </div>
        {profile.bio ? <p className="mt-4 whitespace-pre-wrap break-words">{profile.bio}</p> : null}
      </header>
      <div className="flex gap-3" aria-label="Profile content">
        {[ ["feed", "Posts"], ["confession", "Confessions"] ].map(([value, label]) => <button key={value} type="button" aria-pressed={surface === value} onClick={() => setSurface(value)} className={`border-2 border-ink px-4 py-2 font-bold ${surface === value ? "bg-lime" : "bg-paper"}`}>{label}</button>)}
      </div>
      {loadedKey === key && !loading ? <>
        {posts.length ? posts.map((post, index) => <PostCard key={post.id} post={post} index={index} viewerId={user?.id} />) : <p className="border-2 border-dashed border-ink p-6">No public {surface === "feed" ? "posts" : "confessions"} to show.</p>}
        {cursor ? <button disabled={moreLoading} onClick={loadMore} className="border-2 border-ink bg-paper px-4 py-2 font-bold">{moreLoading ? "Loading…" : "Load more"}</button> : null}
      </> : null}
    </> : null}
  </main>;
}
