"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createConfession, getConfessions, getMe, getRandomConfession, viewConfession } from "../../lib/api";
import { CATEGORIES, MOODS, moodByKey } from "../../lib/taxonomy";
import PostCard from "../components/PostCard";
import "./sky.css";
import "./interaction.css";

const COLORS = ["pink", "purple", "lime", "coral", "blue", "yellow", "orange", "mint", "lavender"];
const EMPTY_SKY = ["pink", "blue", "lavender", "mint", "yellow", "coral", "purple", "orange"];

function Balloon({ post, index, onPick, selected, onPop, onGone }) {
  const [popped, setPopped] = useState(false);
  const [gone, setGone] = useState(false);
  const mood = moodByKey(post.mood);
  const position = (post._skySlot ?? index) % 8;
  const x = [3, 26, 51, 76, 14, 38, 63, 83][position];
  const target = [95, 300, 175, 390, 455, 220, 345, 125][position];
  const drift = [-16, 13, -11, 18, 12, -17, 15, -12][position];
  const size = .82;
  const style = { "--x": `${x}%`, "--delay": `${position * 2.6}s`, "--duration": `${Math.max(.85, target / 40.05)}s`, "--target-y": `${target}px`, "--drift": `${drift}px`, "--size": `${size}`, "--balloon-width": `${90 * size}px`, "--balloon-height": `${208 * size}px` };
  if (gone) return null;
  return <button type="button" aria-label={post.body ? `Pop confession: ${post.body.slice(0, 60)}` : "Release the first confession"} onClick={async () => { if (!post.id) return onPick?.(post); if (popped) return; setPopped(true); try { const viewed = await viewConfession(post.id); onPop?.(viewed); onPick?.(viewed); setTimeout(() => { setGone(true); onGone?.(post.id); }, 760); } catch { setPopped(false); } }} className={`sky-balloon ${selected ? "is-selected" : ""} ${popped ? "is-popping" : ""}`} style={style}>
    <span className="balloon-rig"><span className={`balloon-body balloon-${post.balloon_color || "pink"}`}><i /></span><span className="balloon-knot" /><span className="balloon-string" /><span className="balloon-tag"><b>{mood.emoji} {mood.label}</b><small>{post.view_count || 0} views</small></span></span>
  </button>;
}

export default function ConfessionSkyPage() {
  const [user, setUser] = useState(null), [posts, setPosts] = useState([]), [cursor, setCursor] = useState(null), [selected, setSelected] = useState(null), [open, setOpen] = useState(false), [error, setError] = useState(""), [popMessage, setPopMessage] = useState("");
  const [form, setForm] = useState({ body: "", category: "Confessions", mood: "soft", isAnonymous: true, visibility: "public", balloonColor: "pink" });
  const [sending, setSending] = useState(false);
  const loadingCursor = useRef(false);
  const visible = useMemo(() => posts.slice(0, 8), [posts]);
  const nextSlot = useRef(0);
  useEffect(() => { getMe().then(setUser).catch(() => setUser(null)); getConfessions().then((d) => { setPosts(d.posts.map((post) => ({ ...post, _skySlot: nextSlot.current++ % 8 }))); setCursor(d.next_cursor); }).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    if (posts.length >= 8 || !cursor || loadingCursor.current) return;
    loadingCursor.current = true;
    getConfessions(cursor).then((data) => {
      const additions = data.posts.map((post) => ({ ...post, _skySlot: nextSlot.current++ % 8 }));
      setPosts((current) => [...current, ...additions]);
      setCursor(data.next_cursor);
    }).catch((err) => setError(err.message)).finally(() => { loadingCursor.current = false; });
  }, [posts.length, cursor]);
  async function random() { const post = await getRandomConfession(); if (post) setSelected(post); }
  function updateViewed(post) { setPosts((items) => items.map((item) => item.id === post.id ? { ...post, _skySlot: item._skySlot } : item)); setPopMessage(`You popped it · ${post.view_count} views`); window.setTimeout(() => setPopMessage(""), 2600); }
  function removePopped(id) { setPosts((items) => items.filter((item) => item.id !== id)); }
  async function submit(e) { e.preventDefault(); if (!user) return setError("Log in to release a balloon."); setSending(true); setError(""); try { const post = await createConfession(form); if (post.visibility === "public") { const fallbackSlot = nextSlot.current++ % 8; setPosts((current) => { const [first, ...rest] = current; return [{ ...post, _skySlot: first?._skySlot ?? fallbackSlot }, ...rest, ...(first ? [first] : [])]; }); } setSelected(post); setOpen(false); setForm((f) => ({ ...f, body: "" })); } catch (err) { setError(err.message); } finally { setSending(false); } }
  return <>
    <main className="confession-sky">
      <header className="confession-page-header relative mx-auto mb-0 flex max-w-6xl flex-wrap items-center justify-between gap-4 border-4 border-ink bg-coral px-5 py-5 text-on-brand shadow-[7px_7px_0_var(--color-shadow)]">
        <div>
          <p className="font-note text-3xl leading-none">Some things are easier to tell strangers.</p>
          <h1 className="mt-2 font-display text-4xl font-extrabold leading-none sm:text-5xl">The Confession Sky</h1>
        </div>
        <button onClick={() => setOpen(true)} className="release">+ Release a balloon</button>
      </header>
      <section className="sky-layout"><div className="sky-canvas" aria-label="Floating public confessions">{visible.map((p, i) => <Balloon key={p.id} post={p} index={p._skySlot ?? i} selected={selected?.id === p.id} onPick={setSelected} onPop={updateViewed} onGone={removePopped} />)}{!visible.length && !error ? <><div className="empty-balloons" aria-hidden>{EMPTY_SKY.map((color, i) => <Balloon key={color} index={i} post={{ balloon_color: color, category: "NEW", _skySlot: i }} onPick={() => setOpen(true)} />)}</div><p className="sky-empty">The sky is waiting for its first real confession.</p></> : null}<button onClick={random} className="sky-random">Find me something random</button></div><aside className="sky-detail">{selected ? <><button onClick={() => setSelected(null)} className="detail-close">× close</button><PostCard post={selected} viewerId={user?.id} /></> : <div className="sky-intro"><span>☁</span><h2>Pick a balloon</h2><p>Every tag holds a thought someone needed to release.</p></div>}</aside></section>{open ? <div className="composer-backdrop"><form onSubmit={submit} className="sky-composer"><button type="button" onClick={() => setOpen(false)} className="detail-close">× close</button><h2>LET IT OUT.</h2><p>What&apos;s been living inside your head?</p><textarea required maxLength="1000" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="write it down…" /><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((x) => <option key={x}>{x}</option>)}</select><select value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value })}>{MOODS.map((x) => <option key={x.key} value={x.key}>{x.emoji} {x.label}</option>)}</select><div className="color-picks">{COLORS.map((c) => <button type="button" key={c} onClick={() => setForm({ ...form, balloonColor: c })} className={`pick balloon-${c} ${form.balloonColor === c ? "chosen" : ""}`} aria-label={c} />)}</div><label><input type="checkbox" checked={form.isAnonymous} onChange={(e) => setForm({ ...form, isAnonymous: e.target.checked })} /> Stay anonymous</label><label><input type="checkbox" checked={form.visibility === "private"} onChange={(e) => setForm({ ...form, visibility: e.target.checked ? "private" : "public" })} /> Keep private (only you can see it)</label>{error ? <p role="alert">{error}</p> : null}<button disabled={sending} className="release">{sending ? "Releasing…" : "RELEASE MY CONFESSION"}</button></form></div> : null}
    </main>
  </>;
}
